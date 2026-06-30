import { buildNativeCommercialContext } from "../../context/buildNativeCommercialContext";
import type { AgentToolContext, AgentToolDefinition, AgentToolResult } from "./types";

/**
 * Wraps the already-built, already-tested buildNativeCommercialContext
 * (PR-03/PR-03A) rather than re-querying master_customer/conversation/
 * crm_opportunities directly. This is also where an open identity conflict
 * (PR-03A) surfaces to the agent: when present, the tool returns it as a
 * structured warning instead of a resolved customer, so the agent cannot
 * silently act on an ambiguous identity.
 */
export function createCustomerContextTool(): AgentToolDefinition {
  return {
    name: "get_customer_context",
    version: "1.0",
    description: "Get the real customer/conversation/opportunity context for this conversation: who the customer is, recent messages, any existing opportunity, and any unresolved identity conflict.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: { type: "object" },
    authorizationLevel: "none",
    sideEffectLevel: "read",
    idempotent: true,
    timeoutMs: 5000,
    sourceOfTruth: "native_mariadb",
    errorContract: ["conversation_not_found"],
    async execute(_input, context: AgentToolContext): Promise<AgentToolResult> {
      const snapshot = await buildNativeCommercialContext({
        conversationPublicId: context.conversationPublicId,
        currentTime: context.currentTime
      });
      if (snapshot.status === "not_found") {
        return { ok: false, output: null, warnings: [], error: "conversation_not_found", sourceOfTruth: "native_mariadb" };
      }
      return {
        ok: true,
        output: {
          customer: snapshot.customer,
          opportunity: snapshot.opportunity
            ? {
                id: snapshot.opportunity.id,
                status: snapshot.opportunity.status,
                stage: snapshot.opportunity.stage,
                currentSummary: snapshot.opportunity.currentSummary,
                productInterests: snapshot.opportunity.productInterests
              }
            : null,
          recentMessages: snapshot.recentMessages.slice(-10),
          signals: snapshot.signals,
          identityConflict: snapshot.identityConflict
        },
        warnings: snapshot.warnings,
        error: null,
        sourceOfTruth: "native_mariadb"
      };
    }
  };
}
