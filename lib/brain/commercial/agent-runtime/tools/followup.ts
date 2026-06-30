import { buildNativeCommercialContext } from "../../context/buildNativeCommercialContext";
import type { SalesConsultativeOperationsRepository } from "../../sales-consultative/types";
import type { AgentToolContext, AgentToolDefinition, AgentToolResult } from "./types";

/**
 * `create_follow_up_action` is a durable wait with an owner/condition
 * (ADR-006 section 16): it always carries a dueAt, never an empty
 * "wait and see". Reuses crm_agent_actions via the existing repository
 * (idempotency-keyed there), so calling this twice with the same intent in
 * one turn reuses the existing row rather than creating a duplicate.
 */
export function createFollowUpTool(repository: SalesConsultativeOperationsRepository): AgentToolDefinition {
  return {
    name: "create_follow_up_action",
    version: "1.0",
    description: "Schedule a durable follow-up for this opportunity: a specific time to check back in with the customer, with a reason.",
    inputSchema: {
      type: "object",
      properties: { dueInHours: { type: "number" }, reason: { type: "string" } },
      required: ["dueInHours", "reason"]
    },
    outputSchema: { type: "object" },
    authorizationLevel: "none",
    sideEffectLevel: "durable_write",
    idempotent: true,
    timeoutMs: 8000,
    sourceOfTruth: "crm_agent_actions",
    errorContract: ["missing_opportunity", "db_write_disabled"],
    async execute(input, context: AgentToolContext): Promise<AgentToolResult> {
      const dueInHours = typeof input.dueInHours === "number" && Number.isFinite(input.dueInHours) && input.dueInHours > 0 ? input.dueInHours : 24;
      const reason = typeof input.reason === "string" ? input.reason.trim() : "";
      if (!reason) {
        return { ok: false, output: null, warnings: [], error: "missing_reason", sourceOfTruth: "crm_agent_actions" };
      }
      const snapshot = await buildNativeCommercialContext({ conversationPublicId: context.conversationPublicId, currentTime: context.currentTime });
      if (!snapshot.opportunity) {
        return { ok: false, output: null, warnings: [], error: "missing_opportunity", sourceOfTruth: "crm_agent_actions" };
      }
      const dueAt = new Date(new Date(context.currentTime).getTime() + dueInHours * 60 * 60 * 1000).toISOString();
      const result = await repository.createFollowUpAction({
        opportunity: snapshot.opportunity,
        actionType: "schedule_follow_up",
        dueAt,
        messageText: reason,
        currentTime: context.currentTime
      });
      if (!result.ok) {
        return { ok: false, output: null, warnings: result.warning ? [result.warning] : [], error: "follow_up_persist_failed", sourceOfTruth: "crm_agent_actions" };
      }
      return { ok: true, output: { actionId: result.actionId, dueAt }, warnings: [], error: null, sourceOfTruth: "crm_agent_actions" };
    }
  };
}
