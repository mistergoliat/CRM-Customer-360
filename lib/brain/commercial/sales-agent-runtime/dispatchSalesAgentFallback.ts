// SALES-AGENT-R3-V1.6. R3-native fallback dispatch for every SalesAgentRuntime
// terminal outcome that must NEVER transfer conversation ownership: the four
// genuine technical failures (timeout/provider_unavailable/invalid_output/
// max_steps_exceeded) plus an ambiguous or non-eligible "handoff" (see
// dispatchSalesAgentHardHandoff.ts's own eligibility gate). Invariant this
// file exists to enforce: temporary agent incapacity does not imply
// ownership transfer - the AI stays the owner and gets another turn.
//
// Reuses dispatchGovernedSalesAgentMessage.ts (governance -> transactional
// ownership recheck -> canonical brain_message_outbox) and the existing,
// semantically neutral buildContinuityFallbackMessage renderer - never the
// R1 dispatch stack (crm_agent_actions/autonomy-sandbox/execution-gate).
//
// See docs/releases/SALES-AGENT-R3-V1.6-native-terminal-dispatch.md.

import { dispatchGovernedSalesAgentMessage } from "./dispatchGovernedSalesAgentMessage";
import { buildContinuityFallbackMessage, type ContinuityFallbackContext } from "../continuity/buildContinuityFallbackMessage";
import type { ContinuityFallbackClass } from "../continuity/salesTurnDisposition";
import type { AgentLoopTerminalReason } from "../agent-loop/agentStepTypes";
import type { SalesAgentRuntimeResponseDispatchReason } from "../events/types";

export const SALES_AGENT_FALLBACK_DISPATCHER_VERSION = "sales-agent-r3-fallback-dispatch.v1";

/** Every terminalReason this dispatcher accepts - every AgentLoopTerminalReason except "responded" (dispatchSalesAgentResponse.ts's own boundary). */
export type SalesAgentFallbackTerminalReason = Exclude<AgentLoopTerminalReason, "responded">;

export type DispatchSalesAgentFallbackInput = {
  conversationId: number;
  conversationCaseId: number | string | null;
  opportunityId: number | string | null;
  waId: string;
  inboundMessageId: string;
  correlationId?: string | null;
  currentTime: string;
  humanOwnerActive: boolean;
  aiBlocked: boolean;
  terminalReason: SalesAgentFallbackTerminalReason;
  commercialNeed: ContinuityFallbackContext;
  /** SALES-AGENT-R3-V1.8.1. Threaded straight through to dispatchGovernedSalesAgentMessage - see that type's own comment. */
  checkInboundFreshness?: boolean;
  /** SALES-AGENT-R3-V1.8.1b-A. Threaded straight through to dispatchGovernedSalesAgentMessage - see that type's own comment. */
  liveAssimilation?: { finalAssimilatedInboundMessageId: number; selfSettlementId: number | null } | null;
};

export type DispatchSalesAgentFallbackReason = SalesAgentRuntimeResponseDispatchReason;

export type DispatchSalesAgentFallbackResult = {
  attempted: boolean;
  outboxWritten: boolean;
  outboxId: number | null;
  duplicate: boolean;
  status: "dispatched" | "skipped" | "failed";
  reason: DispatchSalesAgentFallbackReason;
  messageSent: string | null;
  warnings: string[];
};

/**
 * Mirrors the R1 response dispatcher's own (private) mapTerminalReasonToFallbackClass
 * for the four genuine technical failures - a small, local duplicate rather
 * than a cross-import, per this codebase's own established "no cross-module
 * import for an 8-line mapping" discipline (see runSalesAgentRuntimeCycle.ts's
 * buildMinimalCommercialContextSummary comment) and per this task's Scope
 * Guard (the R1 response dispatcher itself must not be touched).
 *
 * "handoff" maps to the same "max_steps_exceeded" vocabulary
 * ("necesito revisar esto con mas calma... sigo apenas pueda") rather than
 * "handoff_acknowledgement" ("voy a conectar tu conversacion con alguien del
 * equipo...") - an ambiguous/non-eligible handoff never transfers ownership,
 * so telling the customer a human is joining would be false. See
 * dispatchSalesAgentHardHandoff.ts for the one path that legitimately uses
 * "handoff_acknowledgement".
 */
function mapTerminalReasonToFallbackClass(terminalReason: SalesAgentFallbackTerminalReason): ContinuityFallbackClass {
  switch (terminalReason) {
    case "invalid_output":
      return "invalid_model_result";
    case "provider_unavailable":
    case "timeout":
      return "model_unavailable";
    case "max_steps_exceeded":
    case "handoff":
      return "max_steps_exceeded";
  }
}

/**
 * R3-native dispatch of a deterministic, customer-safe fallback message.
 * Never dispatches "handoff_acknowledgement" text and never touches
 * conversation ownership - both are dispatchSalesAgentHardHandoff.ts's
 * exclusive responsibility, reached only for an eligible handoff.
 */
export async function dispatchSalesAgentFallback(input: DispatchSalesAgentFallbackInput): Promise<DispatchSalesAgentFallbackResult> {
  const fallbackClass = mapTerminalReasonToFallbackClass(input.terminalReason);
  const message = buildContinuityFallbackMessage(fallbackClass, input.commercialNeed);

  return dispatchGovernedSalesAgentMessage({
    conversationId: input.conversationId,
    conversationCaseId: input.conversationCaseId,
    opportunityId: input.opportunityId,
    waId: input.waId,
    message,
    dedupeSuffix: `fallback:${input.terminalReason}`,
    sourceAgentName: "sales-agent-r3-native-fallback-dispatcher",
    sourceAgentVersion: SALES_AGENT_FALLBACK_DISPATCHER_VERSION,
    metaPayloadExtra: { terminalReason: input.terminalReason, fallbackClass },
    inboundMessageId: input.inboundMessageId,
    currentTime: input.currentTime,
    humanOwnerActive: input.humanOwnerActive,
    aiBlocked: input.aiBlocked,
    checkInboundFreshness: input.checkInboundFreshness,
    liveAssimilation: input.liveAssimilation
  });
}
