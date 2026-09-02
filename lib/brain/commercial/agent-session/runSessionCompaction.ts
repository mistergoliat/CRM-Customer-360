// SALES-AGENT-R3-V1.8-D7. The compaction orchestrator - the only module that
// combines a DB read, a model call, and a DB write for this feature. Every
// step below is isolated per task brief Section H: (1) read ingredients via
// the existing, already-lock-guarded loadPersistentSessionContext (the lock
// is acquired and released INSIDE that call - never held here, and never
// across the model call in step 3, per Section K); (2) decide whether to
// compact at all (sessionCompactionPolicy.ts, pure); (3) generate the
// compaction (compactAgentSessionHistory.ts, the only I/O being the model
// call); (4) persist atomically with a monotonic-advance guard
// (AgentSessionStore.persistCompactedPrefix); (5) emit SESSION_COMPACTED,
// best-effort. Never throws - every failure mode returns a typed, inert
// result so the caller (runSalesAgentRuntimeCycle.ts, post-dispatch) can
// never have this fail the customer's turn (Section I/T, exit gate G8).

import { getDefaultAgentSessionStore } from "./defaultStore";
import type { AgentSessionStore } from "./store";
import { loadPersistentSessionContext } from "./loadPersistentSessionContext";
import { resolveValidCompactionCutoff, parseCompactedSessionPrefixContent, buildCompactedSessionPrefixContent } from "./compactedSessionPrefixContent";
import { shouldTriggerSessionCompaction, splitForCompaction } from "./sessionCompactionPolicy";
import { compactAgentSessionHistory } from "./compactAgentSessionHistory";
import { transcriptRowToProviderMessage } from "./deriveMessages";
import type { ConversationTranscriptMessage } from "./conversationTranscriptReader";
import { AGENT_SESSION_HARD_MAX_TRANSCRIPT_MESSAGES } from "./conversationTranscriptReader";
import { appendAgentSessionEventWithRetry } from "./appendWithRetry";
import { buildSessionCompactedDedupeKey } from "./dedupe";
import { isValidAgentSessionCompactedPayload, type AgentSessionCompactedPayload } from "./types";
import { createHttpAgentLoopProvider } from "../agent-loop/providers/httpAgentLoopProvider";
import type { AgentLoopProvider } from "../agent-loop/agentLoopProviderTypes";

/** Dedicated compaction provider config (task brief Section I): deterministic, no tools, bounded output. Never the main turn's provider instance - that one's temperature/thinking are configured for conversation, not summarization. */
const SESSION_COMPACTION_MAX_OUTPUT_TOKENS = 800;
const SESSION_COMPACTION_TIMEOUT_MS = 20000;

function buildDefaultCompactionProvider(): AgentLoopProvider {
  return createHttpAgentLoopProvider({ temperature: 0, maxOutputTokens: SESSION_COMPACTION_MAX_OUTPUT_TOKENS, thinking: "disabled" });
}

export type RunSessionCompactionInput = {
  conversationId: number;
  correlationId: string;
  maxRawMessages: number;
  targetRecentMessages: number;
  sessionStore?: AgentSessionStore;
  /** Test/DI seam - defaults to a dedicated, deterministic HTTP provider (see buildDefaultCompactionProvider above). */
  provider?: AgentLoopProvider;
  timeoutMs?: number;
};

export type RunSessionCompactionResult =
  | { ran: false; reason: string }
  | { ran: true; persisted: true }
  /** Generation or persistence failed/was superseded - the existing valid prefix (if any) is untouched, never a partial write. */
  | { ran: true; persisted: false; warning: string };

/**
 * Never compacts on the very first call of a cold session (no session yet)
 * or when there is nothing beyond the recent tail - both return `ran: false`,
 * not an error. Safe to call on every turn: cheap no-ops dominate, and the
 * one bounded read this performs is the same lock-guarded read the
 * persistent-session cognition path already does per turn.
 */
export async function runSessionCompactionIfEligible(input: RunSessionCompactionInput): Promise<RunSessionCompactionResult> {
  try {
    const store = input.sessionStore ?? getDefaultAgentSessionStore();

    // Always read at the hard cap here (independent of loadPersistentSessionContext's
    // own compacted-prefix-driven widening) - the compaction DECISION needs to
    // see the true uncompacted count, not whatever a caller-tuned default
    // window would show.
    const context = await loadPersistentSessionContext({
      conversationId: input.conversationId,
      maxTranscriptMessages: AGENT_SESSION_HARD_MAX_TRANSCRIPT_MESSAGES,
      store
    });
    if (!context.ok) return { ran: false, reason: `read_failed:${context.warning}` };
    if (!context.session) return { ran: false, reason: "no_session" };

    const cutoff = resolveValidCompactionCutoff(context.compactedPrefix);
    const uncompacted: ConversationTranscriptMessage[] =
      cutoff === null ? context.transcriptMessages : context.transcriptMessages.filter((row) => Number(row.id) > cutoff);

    if (!shouldTriggerSessionCompaction(uncompacted.length, input.maxRawMessages)) {
      return { ran: false, reason: "below_threshold" };
    }

    const { toCompact } = splitForCompaction(uncompacted, input.targetRecentMessages);
    if (toCompact.length === 0) return { ran: false, reason: "nothing_to_compact" };

    const previousSummaryText = cutoff !== null ? (parseCompactedSessionPrefixContent(context.compactedPrefix!.prefixJson)?.summaryText ?? null) : null;
    const messagesToCompact = toCompact.map(transcriptRowToProviderMessage).filter((m): m is NonNullable<typeof m> => m !== null);

    const startedAt = Date.now();
    const generation = await compactAgentSessionHistory({
      previousSummaryText,
      messagesToCompact,
      provider: input.provider ?? buildDefaultCompactionProvider(),
      timeoutMs: input.timeoutMs ?? SESSION_COMPACTION_TIMEOUT_MS,
      correlationId: input.correlationId
    });
    const compactionDurationMs = Date.now() - startedAt;

    if (!generation.ok) return { ran: true, persisted: false, warning: `generation_failed:${generation.reason}` };

    const newThroughSeq = Number(toCompact[toCompact.length - 1].id);
    const prefixContent = buildCompactedSessionPrefixContent(generation.summaryText);

    const persistResult = await store.persistCompactedPrefix({
      sessionId: context.session.id,
      throughSeq: newThroughSeq,
      prefixJson: prefixContent
    });
    if (!persistResult.ok) return { ran: true, persisted: false, warning: `persist_failed:${persistResult.warning}` };
    if (!persistResult.applied) return { ran: true, persisted: false, warning: "superseded_by_newer_compaction" };

    const payload: AgentSessionCompactedPayload = {
      fromSeq: cutoff ?? 0,
      toSeq: newThroughSeq,
      summaryEstimatedSize: generation.summaryText.length,
      rawMessageCount: toCompact.length,
      rawEstimatedSize: toCompact.reduce((sum, row) => sum + (row.body?.length ?? 0), 0),
      compactionDurationMs
    };
    if (isValidAgentSessionCompactedPayload(payload)) {
      try {
        await appendAgentSessionEventWithRetry(store, {
          sessionId: context.session.id,
          conversationId: input.conversationId,
          eventType: "SESSION_COMPACTED",
          correlationId: input.correlationId,
          dedupeKey: buildSessionCompactedDedupeKey(context.session.id, newThroughSeq),
          payload
        });
      } catch {
        // Observability only - a failed event write never undoes the
        // already-persisted compacted prefix, and never fails the turn.
      }
    }

    return { ran: true, persisted: true };
  } catch (error) {
    return { ran: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
