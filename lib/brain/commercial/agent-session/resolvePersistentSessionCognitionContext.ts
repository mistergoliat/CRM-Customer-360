// SALES-AGENT-R3-V1.8-D5. The one I/O boundary that decides whether THIS
// turn actually uses live persistent-session cognition, and if so, what its
// historical prefix is. Unlike D4's runPersistentSessionShadow.ts (shadow-
// only, discards its own output), this module's result is a real input to
// the turn - callers must thread `historicalMessages` into the real
// provider request when `active` is true.
//
// Fallback discipline (task brief Section H): `active` is a clean boolean,
// never partial. A degraded read, a lock timeout, or any thrown error all
// collapse to `active: false` plus a non-sensitive `fallbackWarning` -
// never a thrown exception, never a half-built persistent prompt. The
// caller (salesAgentRuntime.ts) is expected to fall back to the exact
// legacy path whenever `active` is false, regardless of why.

import { loadPersistentSessionContext } from "./loadPersistentSessionContext";
import { deriveMessages } from "./deriveMessages";
import type { AgentSessionStore } from "./store";
import type { AgentLoopProviderMessage } from "../agent-loop/agentLoopProviderTypes";

export type PersistentSessionCognitionContext =
  | { active: true; historicalMessages: AgentLoopProviderMessage[]; fallbackWarning: null }
  | { active: false; historicalMessages: null; fallbackWarning: string | null };

export type ResolvePersistentSessionCognitionContextInput = {
  /** Already-composed eligibility (flag AND allowlist), resolved by the caller (runNativeAutonomousCycle.ts via shouldEnablePersistentSessionCognition) - this function never reads process.env. */
  enabled: boolean;
  conversationId: number;
  inboundMessageId: string | null;
  /**
   * SALES-AGENT-R3-V1.8.1. Extra conversation_message ids (beyond
   * inboundMessageId itself) that belong to the current settled turn - set
   * only by the turn-settlement worker when more than one raw WhatsApp
   * fragment was aggregated into this turn's customerMessage. Excluded from
   * historicalMessages alongside inboundMessageId so the aggregated text
   * appears exactly once in the assembled provider messages, never once as
   * history and again as the current turn (Section J).
   */
  additionalInboundMessageIds?: readonly string[] | null;
  /** Test/DI seam - defaults to the real, MariaDB-backed AgentSessionStore. */
  store?: AgentSessionStore;
};

export async function resolvePersistentSessionCognitionContext(
  input: ResolvePersistentSessionCognitionContextInput
): Promise<PersistentSessionCognitionContext> {
  if (!input.enabled) return { active: false, historicalMessages: null, fallbackWarning: null };
  if (!input.inboundMessageId) {
    return { active: false, historicalMessages: null, fallbackWarning: "persistent_session_cognition_fallback:no_inbound_message_id" };
  }

  try {
    const context = await loadPersistentSessionContext({ conversationId: input.conversationId, store: input.store });
    if (!context.ok) {
      return { active: false, historicalMessages: null, fallbackWarning: `persistent_session_cognition_fallback:${context.warning}` };
    }

    const derived = deriveMessages({
      transcriptMessages: context.transcriptMessages,
      events: context.events,
      compactedPrefix: context.compactedPrefix,
      currentInboundMessageId: input.inboundMessageId,
      additionalExcludedMessageIds: input.additionalInboundMessageIds
    });
    return { active: true, historicalMessages: derived.historicalMessages, fallbackWarning: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { active: false, historicalMessages: null, fallbackWarning: `persistent_session_cognition_fallback:${message}` };
  }
}

/**
 * Task brief Section D. A new object, never a mutation of the caller's own
 * commercialContextSummary - object destructuring already guarantees this.
 * Removes only the legacy conversational-history field; every other
 * authoritative key (opportunityStatus/needProfile/shippingDestination/
 * commercialLineItems/...) passes through untouched.
 */
export function stripRecentMessagesForPersistentSessionContext(commercialContextSummary: Record<string, unknown>): Record<string, unknown> {
  const { recentMessages: _recentMessages, ...rest } = commercialContextSummary;
  return rest;
}
