import { buildNativeCommercialContext } from "../../context/buildNativeCommercialContext";
import type { SalesConsultativeOperationsRepository } from "../../sales-consultative/types";
import type { AgentToolContext, AgentToolDefinition, AgentToolResult } from "./types";

/**
 * `request_human_handoff` is the only tool that marks the conversation as
 * human-owned. The agent loop still decides *when* to call it (insistence,
 * legal/technical necessity, missing capability, policy approval, real risk,
 * or no progress after reasonable attempts) -- this tool only records that
 * decision durably so the operator sees why, and does not itself decide to
 * stop helping (the loop may keep gathering information after this call;
 * see ADR-007's exclusive_handoff vs other modes).
 */
export function createHandoffTool(repository: SalesConsultativeOperationsRepository): AgentToolDefinition {
  return {
    name: "request_human_handoff",
    version: "1.0",
    description: "Mark this conversation as needing a human owner, with a concrete reason. Does not by itself stop you from continuing to gather useful information.",
    inputSchema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
    outputSchema: { type: "object" },
    authorizationLevel: "none",
    sideEffectLevel: "durable_write",
    idempotent: true,
    timeoutMs: 5000,
    sourceOfTruth: "crm_opportunities",
    errorContract: ["missing_opportunity", "db_write_disabled"],
    async execute(input, context: AgentToolContext): Promise<AgentToolResult> {
      const reason = typeof input.reason === "string" ? input.reason.trim() : "";
      if (!reason) {
        return { ok: false, output: null, warnings: [], error: "missing_reason", sourceOfTruth: "crm_opportunities" };
      }
      const snapshot = await buildNativeCommercialContext({ conversationPublicId: context.conversationPublicId, currentTime: context.currentTime });
      if (!snapshot.opportunity) {
        return { ok: false, output: null, warnings: [], error: "missing_opportunity", sourceOfTruth: "crm_opportunities" };
      }
      const result = await repository.requestHumanHandoff({ opportunity: snapshot.opportunity, reason, currentTime: context.currentTime });
      if (!result.ok) {
        return { ok: false, output: null, warnings: result.warning ? [result.warning] : [], error: "handoff_persist_failed", sourceOfTruth: "crm_opportunities" };
      }
      return { ok: true, output: { handed_off: true }, warnings: [], error: null, sourceOfTruth: "crm_opportunities" };
    }
  };
}
