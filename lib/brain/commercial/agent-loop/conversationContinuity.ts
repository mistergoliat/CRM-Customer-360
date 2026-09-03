// SALES-AGENT-R3-V1.8.1b (Objetivo C - conversational continuity). Purely
// descriptive, derived fresh every turn from durable history already loaded
// this turn - never persisted, never a stored workflow flag
// (currentIntent/conversationStage/etc. are exactly what this is NOT). Tells
// the model whether real prior conversational turns already exist, so it can
// decide for itself whether a greeting/recap is appropriate - the model's
// own judgment, never a hardcoded phrase or textual post-processing on its
// output.

import type { AgentLoopProviderMessage } from "./agentLoopProviderTypes";

export type ConversationContinuitySignal = {
  isFirstConversationalTurn: boolean;
  hasPriorAssistantMessages: boolean;
  hasPriorCustomerMessages: boolean;
};

/**
 * Legacy fallback path (persistent-session cognition disabled/degraded this
 * turn) has no continuity evidence available at all - re-greeting an active
 * conversation is a worse defect than an occasional under-warm first
 * message, so "conversation already active" is the safer unknown-state
 * default.
 */
export const CONVERSATION_CONTINUITY_UNKNOWN: ConversationContinuitySignal = {
  isFirstConversationalTurn: false,
  hasPriorAssistantMessages: true,
  hasPriorCustomerMessages: true
};

/**
 * Persistent-session path (the default since V1.8-D6): derived directly from
 * deriveMessages()'s own historicalMessages array - the exact same durable
 * transcript already sent to the model this turn, never a second read. A
 * compacted-prefix-only array with zero real tail is not expected under the
 * current compaction policy (it always keeps a target recent-message tail),
 * and even in that edge case the prefix's own summary text already tells the
 * model prior history exists - no special compaction case is needed here.
 */
export function deriveConversationContinuityFromHistoricalMessages(
  historicalMessages: readonly AgentLoopProviderMessage[]
): ConversationContinuitySignal {
  const hasPriorAssistantMessages = historicalMessages.some((message) => message.role === "assistant");
  const hasPriorCustomerMessages = historicalMessages.some((message) => message.role === "user");
  return {
    isFirstConversationalTurn: !hasPriorAssistantMessages && !hasPriorCustomerMessages,
    hasPriorAssistantMessages,
    hasPriorCustomerMessages
  };
}

type LegacyRecentMessage = { direction?: unknown };

/**
 * Legacy fallback path: derived from the same reduced recentMessages array
 * already built into commercialContextSummary
 * (runSalesAgentRuntimeCycle.ts#buildMinimalCommercialContextSummary) -
 * never a second history read. Falls back to CONVERSATION_CONTINUITY_UNKNOWN
 * when recentMessages is missing or malformed.
 */
export function deriveConversationContinuityFromLegacyContext(commercialContextSummary: Record<string, unknown>): ConversationContinuitySignal {
  const recentMessages = commercialContextSummary.recentMessages;
  if (!Array.isArray(recentMessages)) return CONVERSATION_CONTINUITY_UNKNOWN;

  const hasPriorAssistantMessages = recentMessages.some((message) => (message as LegacyRecentMessage)?.direction === "outbound");
  const hasPriorCustomerMessages = recentMessages.some((message) => (message as LegacyRecentMessage)?.direction === "inbound");
  return {
    isFirstConversationalTurn: !hasPriorAssistantMessages && !hasPriorCustomerMessages,
    hasPriorAssistantMessages,
    hasPriorCustomerMessages
  };
}
