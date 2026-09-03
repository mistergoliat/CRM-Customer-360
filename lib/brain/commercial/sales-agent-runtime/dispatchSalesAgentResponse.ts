// SALES-AGENT-R3-V1.5. R3-native response dispatch for terminalReason
// "responded" - deliberately independent of the R1 dispatch stack
// (crm_agent_actions / autonomy-sandbox / execution-gate). A final
// conversational response is not a commercial mutation: reasoning stays
// flexible (SalesAgentRuntime), this boundary's own governance is
// deterministic, and the durable state it writes is exactly one row in the
// existing canonical brain_message_outbox (lib/brain/messaging/canonicalOutboxWriter.ts)
// - the same table/writer/worker every other runtime already uses, never a
// second outbound queue. Commercial mutations (select_products, create_quote,
// ...) are untouched by this file; they continue through
// CommercialActionRequest -> Capability Gateway, unaffected by anything here.
//
// SALES-AGENT-R3-V1.6: the governance/recheck/outbox-write chain itself now
// lives in dispatchGovernedSalesAgentMessage.ts (shared with
// dispatchSalesAgentFallback.ts) - this file is a thin, behavior-preserving
// wrapper around it plus this dispatcher's own observability event. Public
// contract (types, dedupe key, event) unchanged from V1.5.
//
// See docs/releases/SALES-AGENT-R3-V1.5-native-response-dispatch.md and
// docs/releases/SALES-AGENT-R3-V1.6-native-terminal-dispatch.md.

import { dispatchGovernedSalesAgentMessage } from "./dispatchGovernedSalesAgentMessage";
import { recordSalesAgentRuntimeResponseDispatchedEvent } from "../events/service";
import type { SalesAgentRuntimeResponseDispatchReason } from "../events/types";

export const SALES_AGENT_RESPONSE_DISPATCHER_VERSION = "sales-agent-r3-dispatch.v1";

export type DispatchSalesAgentResponseInput = {
  conversationId: number;
  conversationCaseId: number | string | null;
  opportunityId: number | string | null;
  waId: string;
  inboundMessageId: string;
  correlationId?: string | null;
  currentTime: string;
  humanOwnerActive: boolean;
  aiBlocked: boolean;
  finalMessage: string | null;
  /** SALES-AGENT-R3-V1.8.1. Threaded straight through to dispatchGovernedSalesAgentMessage - see that type's own comment. */
  checkInboundFreshness?: boolean;
};

export type DispatchSalesAgentResponseReason = SalesAgentRuntimeResponseDispatchReason;

export type DispatchSalesAgentResponseResult = {
  attempted: boolean;
  outboxWritten: boolean;
  outboxId: number | null;
  duplicate: boolean;
  status: "dispatched" | "skipped" | "failed";
  reason: DispatchSalesAgentResponseReason;
  warnings: string[];
};

async function emitObservabilityEvent(input: DispatchSalesAgentResponseInput, result: DispatchSalesAgentResponseResult): Promise<void> {
  try {
    await recordSalesAgentRuntimeResponseDispatchedEvent({
      inboundMessageId: input.inboundMessageId,
      outboxWritten: result.outboxWritten,
      outboxId: result.outboxId,
      duplicate: result.duplicate,
      reason: result.reason,
      dispatcherVersion: SALES_AGENT_RESPONSE_DISPATCHER_VERSION,
      correlationId: input.correlationId ?? null,
      conversationId: input.conversationId,
      opportunityId: input.opportunityId
    });
  } catch {
    // Observability must never break the turn - the customer already has
    // (or was correctly denied) their response regardless of this write.
  }
}

/**
 * R3-native dispatch for a SalesAgentRuntime "responded" turn. Deliberately
 * bypasses crm_agent_actions/autonomy-sandbox/execution-gate entirely -
 * those exist to govern R1's action-lifecycle (propose/approve/execute a
 * commercial mutation), which a conversational reply is not. Writes at most
 * one row to the existing brain_message_outbox (via the same canonical
 * writer/dedupe-key/worker every other runtime uses) and never throws for a
 * governed skip or a real persistence failure - callers branch on
 * `status`/`reason`, never on a caught exception.
 */
export async function dispatchSalesAgentResponse(input: DispatchSalesAgentResponseInput): Promise<DispatchSalesAgentResponseResult> {
  const governed = await dispatchGovernedSalesAgentMessage({
    conversationId: input.conversationId,
    conversationCaseId: input.conversationCaseId,
    opportunityId: input.opportunityId,
    waId: input.waId,
    message: input.finalMessage,
    dedupeSuffix: "responded",
    sourceAgentName: "sales-agent-r3-native-dispatcher",
    sourceAgentVersion: SALES_AGENT_RESPONSE_DISPATCHER_VERSION,
    metaPayloadExtra: { terminalReason: "responded" },
    inboundMessageId: input.inboundMessageId,
    currentTime: input.currentTime,
    humanOwnerActive: input.humanOwnerActive,
    aiBlocked: input.aiBlocked,
    checkInboundFreshness: input.checkInboundFreshness
  });

  const result: DispatchSalesAgentResponseResult = {
    attempted: governed.attempted,
    outboxWritten: governed.outboxWritten,
    outboxId: governed.outboxId,
    duplicate: governed.duplicate,
    status: governed.status,
    reason: governed.reason,
    warnings: governed.warnings
  };

  await emitObservabilityEvent(input, result);
  return result;
}
