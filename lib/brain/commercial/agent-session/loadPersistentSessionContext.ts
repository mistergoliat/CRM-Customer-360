// SALES-AGENT-R3-V1.8-D3. Read-side assembly of the ingredients
// deriveMessages.ts needs - never the derived projection itself (Section C:
// this function returns raw ingredients; deriveMessages() is a separate,
// pure call over them, so a caller can re-derive without a second DB round
// trip). Shadow-only: nothing in this module is wired into any real
// customer turn yet (Section W) - buildAgentStepPromptPackage.ts, the real
// provider request path, is untouched.
//
// Concurrency (V1.8-D0 section 4/16.2): a short, existing-pattern GET_LOCK
// scoped ONLY to this function's own DB reads, mirroring
// runtime-opportunity/resolveRuntimeOpportunity.ts's exact acquire/release
// shape - never held across a provider call (this module has no provider
// dependency at all to hold it across). Failure semantics (V1.8-D0 section
// 12): DEGRADE_TO_LEGACY_CONTEXT - a lock timeout or any thrown store/query
// error inside the locked section returns a typed degraded result, never
// throws and never blocks the customer turn.

import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { withConnection } from "@/lib/db";
import { getDefaultAgentSessionStore } from "./defaultStore";
import type { AgentSessionStore } from "./store";
import type { AgentSession, AgentSessionEvent } from "./types";
import {
  AGENT_SESSION_HARD_MAX_TRANSCRIPT_MESSAGES,
  loadRecentConversationTranscript,
  type ConversationTranscriptMessage
} from "./conversationTranscriptReader";
import type { PersistentSessionCompactedPrefix } from "./deriveMessages";
import { resolveValidCompactionCutoff } from "./compactedSessionPrefixContent";

const SESSION_READ_LOCK_TIMEOUT_SECONDS = 10;

function sessionReadLockKey(conversationId: number): string {
  return `agent_session:${conversationId}`;
}

async function acquireSessionReadLock(connection: PoolConnection, conversationId: number, timeoutSeconds: number): Promise<void> {
  const [rows] = await connection.execute<RowDataPacket[]>("SELECT GET_LOCK(?, ?) AS acquired", [
    sessionReadLockKey(conversationId),
    timeoutSeconds
  ]);
  const acquired = Number((rows[0] as { acquired?: unknown } | undefined)?.acquired) === 1;
  if (!acquired) throw new Error(`agent_session_read_lock_timeout:${conversationId}`);
}

async function releaseSessionReadLock(connection: PoolConnection, conversationId: number): Promise<void> {
  try {
    await connection.execute("SELECT RELEASE_LOCK(?)", [sessionReadLockKey(conversationId)]);
  } catch {
    // Same rationale as resolveRuntimeOpportunity's own precedent - MariaDB
    // releases session advisory locks automatically once the connection
    // closes/returns, so a failed explicit release here is not fatal.
  }
}

/**
 * Validates the two compaction columns (migration 034) together - either
 * both are absent (no compaction has ever run; the normal case for every
 * session today, since D7 has no emitter yet) or both are structurally
 * valid. A one-sided or malformed pair degrades ONLY the compaction slot (a
 * warning, compactedPrefix: null) - it never fails the whole read (Section Q:
 * "invalid compaction metadata: warn/degrade, do not crash the customer turn").
 */
function extractCompactedPrefix(session: AgentSession | null): { compactedPrefix: PersistentSessionCompactedPrefix | null; warning: string | null } {
  if (!session) return { compactedPrefix: null, warning: null };
  const { compactedPrefixJson, compactedThroughSeq } = session;
  if (compactedPrefixJson === null && compactedThroughSeq === null) return { compactedPrefix: null, warning: null };

  const validSeq = typeof compactedThroughSeq === "number" && Number.isInteger(compactedThroughSeq) && compactedThroughSeq >= 0;
  const validJson = compactedPrefixJson !== null && typeof compactedPrefixJson === "object" && !Array.isArray(compactedPrefixJson);
  if (!validSeq || !validJson) {
    return { compactedPrefix: null, warning: "agent_session_invalid_compacted_prefix_metadata" };
  }
  return { compactedPrefix: { throughSeq: compactedThroughSeq as number, prefixJson: compactedPrefixJson as Record<string, unknown> }, warning: null };
}

export type LoadPersistentSessionContextInput = {
  conversationId: number;
  maxEvents?: number;
  maxTranscriptMessages?: number;
  /** Test-only override of the default 10s GET_LOCK timeout (matches resolveRuntimeOpportunity's own precedent value) - keeps a lock-exclusivity test fast without changing production behavior. */
  lockTimeoutSeconds?: number;
  /** Test/DI seam - defaults to the real, MariaDB-backed AgentSessionStore. */
  store?: AgentSessionStore;
};

export type LoadPersistentSessionContextSuccess = {
  ok: true;
  degraded: false;
  session: AgentSession | null;
  events: AgentSessionEvent[];
  /** The raw bounded window - MAY still include the current turn's own inbound message (Section K's exclusion happens in deriveMessages.ts, not here, since this function has no notion of "which turn is current"). */
  transcriptMessages: ConversationTranscriptMessage[];
  compactedPrefix: PersistentSessionCompactedPrefix | null;
  /** Observability (Section S). True when this session has no operational event history yet but a real prior transcript exists - a pre-D2 conversation's first post-D3 read. Never a separate code path: conversation_message is always read the same way (Section F/P), this is purely a signal for later telemetry. */
  bootstrapUsed: boolean;
  warnings: string[];
};

export type LoadPersistentSessionContextFailure = {
  ok: false;
  degraded: true;
  warning: string;
};

export type LoadPersistentSessionContextResult = LoadPersistentSessionContextSuccess | LoadPersistentSessionContextFailure;

/**
 * Assembles the ingredients deriveMessages.ts needs for one conversation.
 * Safe when no session exists yet (session: null, events: []) and safe on
 * any failure (DEGRADE_TO_LEGACY_CONTEXT - a typed degraded result, never a
 * throw, never an unbounded retry).
 */
export async function loadPersistentSessionContext(input: LoadPersistentSessionContextInput): Promise<LoadPersistentSessionContextResult> {
  const store = input.store ?? getDefaultAgentSessionStore();
  const lockTimeoutSeconds = input.lockTimeoutSeconds ?? SESSION_READ_LOCK_TIMEOUT_SECONDS;

  try {
    return await withConnection(async (connection) => {
      await acquireSessionReadLock(connection, input.conversationId, lockTimeoutSeconds);
      try {
        const session = await store.loadSessionForConversation(input.conversationId);
        const events = session ? await store.loadRecentEvents({ sessionId: session.id, maxEvents: input.maxEvents }) : [];
        const { compactedPrefix, warning } = extractCompactedPrefix(session);
        // SALES-AGENT-R3-V1.8-D7 (Section M, no-gap invariant). Once a valid
        // compacted prefix exists, the recency-bounded window above
        // (default AGENT_SESSION_DEFAULT_MAX_TRANSCRIPT_MESSAGES) could be
        // smaller than "everything since the last compaction," silently
        // dropping a middle slice that is in neither the compacted prefix
        // nor the raw tail. Widening to the existing hard cap whenever a
        // valid cutoff exists guarantees the full post-cutoff span is read
        // (deriveMessages.ts then filters out anything at/before the
        // cutoff) as long as the compaction trigger keeps the true
        // uncompacted count under that cap - see
        // sessionCompactionPolicy.ts's own SESSION_COMPACTION_MAX_RAW_MESSAGES_CEILING.
        // No change at all when no valid compacted prefix exists (the
        // normal case for every session before D7 ever runs) - byte-
        // identical to D3-D6 in that case.
        const effectiveMaxTranscriptMessages =
          resolveValidCompactionCutoff(compactedPrefix) !== null ? AGENT_SESSION_HARD_MAX_TRANSCRIPT_MESSAGES : input.maxTranscriptMessages;
        const transcriptMessages = await loadRecentConversationTranscript(input.conversationId, effectiveMaxTranscriptMessages);

        return {
          ok: true as const,
          degraded: false as const,
          session,
          events,
          transcriptMessages,
          compactedPrefix,
          bootstrapUsed: events.length === 0 && transcriptMessages.length > 0,
          warnings: warning ? [warning] : []
        };
      } finally {
        await releaseSessionReadLock(connection, input.conversationId);
      }
    });
  } catch (error) {
    return { ok: false, degraded: true, warning: error instanceof Error ? error.message : String(error) };
  }
}
