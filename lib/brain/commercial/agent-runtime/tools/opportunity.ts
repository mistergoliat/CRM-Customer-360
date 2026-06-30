import { buildNativeCommercialContext } from "../../context/buildNativeCommercialContext";
import type { SalesConsultativeOperationsRepository, SalesConsultativeStage, SalesNeedProfile } from "../../sales-consultative/types";
import type { AgentToolContext, AgentToolDefinition, AgentToolResult } from "./types";

const VALID_STAGES: SalesConsultativeStage[] = [
  "discovery",
  "qualification",
  "recommendation",
  "objection_handling",
  "purchase_intent",
  "checkout_support",
  "follow_up",
  "won",
  "lost",
  "handoff"
];

function minimalNeedProfile(currentTime: string): SalesNeedProfile {
  return {
    useCase: null,
    customerType: null,
    goals: [],
    requiredFeatures: [],
    preferredFeatures: [],
    budgetMin: null,
    budgetMax: null,
    availableSpace: null,
    location: null,
    deliveryDeadline: null,
    experienceLevel: null,
    purchaseUrgency: null,
    decisionReadiness: null,
    missingInformation: [],
    lastUpdatedAt: currentTime
  };
}

/**
 * `create_or_update_opportunity` is durable-write (Level 2: reversible
 * commercial action, autonomous within policy per the autonomy perimeter).
 * It always re-reads the current opportunity for this conversation first
 * (via buildNativeCommercialContext) so two calls in the same turn upsert
 * the same row instead of racing on stale state, and so a repeated call
 * with the same summary is a no-op update, not a duplicate.
 */
export function createOpportunityTool(repository: SalesConsultativeOperationsRepository): AgentToolDefinition {
  return {
    name: "create_or_update_opportunity",
    version: "1.0",
    description: "Create or update the durable commercial opportunity for this conversation with a summary of what the customer wants and the current stage.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        stage: { type: "string", enum: VALID_STAGES },
        status: { type: "string" }
      },
      required: ["summary"]
    },
    outputSchema: { type: "object", properties: { opportunityId: {}, opportunityKey: { type: "string" } } },
    authorizationLevel: "none",
    sideEffectLevel: "durable_write",
    idempotent: true,
    timeoutMs: 8000,
    sourceOfTruth: "crm_opportunities",
    errorContract: ["db_write_disabled", "persist_failed"],
    async execute(input, context: AgentToolContext): Promise<AgentToolResult> {
      const summary = typeof input.summary === "string" ? input.summary.trim() : "";
      if (!summary) {
        return { ok: false, output: null, warnings: [], error: "missing_summary", sourceOfTruth: "crm_opportunities" };
      }
      const stage = VALID_STAGES.includes(input.stage as SalesConsultativeStage) ? (input.stage as SalesConsultativeStage) : "discovery";
      const status = typeof input.status === "string" && input.status.trim() ? input.status.trim() : "open";

      const snapshot = await buildNativeCommercialContext({ conversationPublicId: context.conversationPublicId, currentTime: context.currentTime });
      const existingOpportunity = snapshot.opportunity;

      const result = await repository.createOrUpdateOpportunity({
        opportunity: existingOpportunity,
        profile: minimalNeedProfile(context.currentTime),
        stage,
        status,
        summary,
        nextActionType: "ask_qualification_question",
        nextActionDueAt: null,
        currentTime: context.currentTime,
        customerContext: {
          waId: context.waId,
          phoneNumberId: null,
          email: null,
          phone: null,
          idCustomer: context.customerMasterId,
          idOrder: null,
          invoiceNumber: null,
          contactId: null
        }
      });

      if (!result.ok) {
        return { ok: false, output: null, warnings: result.warning ? [result.warning] : [], error: "persist_failed", sourceOfTruth: "crm_opportunities" };
      }
      return {
        ok: true,
        output: { opportunityId: result.opportunityId, opportunityKey: result.opportunityKey },
        warnings: result.warning ? [result.warning] : [],
        error: null,
        sourceOfTruth: "crm_opportunities"
      };
    }
  };
}
