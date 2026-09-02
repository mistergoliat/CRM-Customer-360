// SALES-AGENT-R3-V1.8-D4. The one I/O orchestrator for the persistent-
// session shadow: loads (D3's loadPersistentSessionContext), derives (D3's
// deriveMessages), compares (persistentSessionShadowComparison.ts), emits a
// single non-sensitive commercial_event, and discards everything else.
//
// FAILURE ISOLATION (task brief Section O): the entire body is one
// try/catch. A lock timeout, a thrown store error, a malformed compaction
// fixture, or an event-write failure can only ever produce a warning string
// for the caller to push onto its own warnings array - never a thrown
// exception. Nothing here can alter the real turn: salesAgentRuntime.ts
// builds and closes over its own loopInput before this function is ever
// called, and this module never returns historicalMessages/comparison data
// to the caller at all - only ok/warning.

import { loadPersistentSessionContext } from "./loadPersistentSessionContext";
import { deriveMessages } from "./deriveMessages";
import { buildPersistentSessionShadowComparison } from "./persistentSessionShadowComparison";
import type { PersistentSessionShadowLegacyMessage } from "./persistentSessionShadowComparison";
import type { AgentSessionStore } from "./store";
import { recordPersistentSessionShadowComparedEvent } from "../events/service";

export type RunPersistentSessionShadowComparisonInput = {
  conversationId: number;
  inboundMessageId: string;
  correlationId: string;
  legacyRecentMessages: readonly PersistentSessionShadowLegacyMessage[];
  /** Test/DI seam - defaults to the real, MariaDB-backed AgentSessionStore (same default loadPersistentSessionContext itself uses). */
  store?: AgentSessionStore;
};

export type RunPersistentSessionShadowComparisonResult = {
  /** Non-null only when something went wrong (a read/derive/event-write failure) - the caller pushes this onto its own warnings array, the same idiom every other non-blocking write in this runtime already uses. */
  warning: string | null;
};

export async function runPersistentSessionShadowComparison(
  input: RunPersistentSessionShadowComparisonInput
): Promise<RunPersistentSessionShadowComparisonResult> {
  try {
    const readStartedAt = Date.now();
    const context = await loadPersistentSessionContext({ conversationId: input.conversationId, store: input.store });
    const readMs = Date.now() - readStartedAt;

    const deriveStartedAt = Date.now();
    const derived = context.ok
      ? deriveMessages({
          transcriptMessages: context.transcriptMessages,
          events: context.events,
          compactedPrefix: context.compactedPrefix,
          currentInboundMessageId: input.inboundMessageId
        })
      : { historicalMessages: [], toolActivityObservations: [] };
    const deriveMs = Date.now() - deriveStartedAt;

    const comparison = buildPersistentSessionShadowComparison({
      legacyRecentMessages: input.legacyRecentMessages,
      historicalMessages: derived.historicalMessages,
      toolActivityCount: derived.toolActivityObservations.length,
      bootstrapUsed: context.ok ? context.bootstrapUsed : false,
      degraded: !context.ok,
      currentInboundMessageId: input.inboundMessageId
    });

    await recordPersistentSessionShadowComparedEvent({
      inboundMessageId: input.inboundMessageId,
      correlationId: input.correlationId,
      conversationId: input.conversationId,
      legacyRecentMessageCount: comparison.legacy.recentMessageCount,
      legacyInboundCount: comparison.legacy.inboundCount,
      legacyOutboundCount: comparison.legacy.outboundCount,
      persistentHistoryMessageCount: comparison.persistent.historyMessageCount,
      persistentUserCount: comparison.persistent.userCount,
      persistentAssistantCount: comparison.persistent.assistantCount,
      persistentToolActivityCount: comparison.persistent.toolActivityCount,
      bootstrapUsed: comparison.persistent.bootstrapUsed,
      degraded: comparison.persistent.degraded,
      currentInboundExcluded: comparison.comparison.currentInboundExcluded,
      duplicateTranscriptMessageCount: comparison.comparison.duplicateTranscriptMessageCount,
      persistentOlderMessageCount: comparison.comparison.persistentOlderMessageCount,
      persistentAdditionalAssistantCount: comparison.comparison.persistentAdditionalAssistantCount,
      readMs,
      deriveMs,
      shadowTotalMs: readMs + deriveMs
    });

    return { warning: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { warning: `persistent_session_shadow_failed:${message}` };
  }
}
