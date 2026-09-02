// SALES-AGENT-R3-A01. AgentSessionStore domain interface. No MariaDB
// implementation detail (Pool/PoolConnection/SQL) crosses this boundary -
// see mariaDbAgentSessionStore.ts and inMemoryAgentSessionStore.ts for the
// two implementations.

import type {
  AgentSession,
  AgentSessionEvent,
  AgentSessionSummary,
  AppendEventInput,
  AppendEventResult,
  EnsureSessionInput,
  LoadRecentEventsInput
} from "./types";

// Phase 9 bounded-context defaults. Deliberately small, matching the
// existing precedent this repo already proved works at this exact scale:
// RecentCatalogContext caps at 5 interactions/12 products (agent-loop/
// recentCatalogContext.ts), buildNativeCommercialContext caps recent
// conversation messages at 12 (COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES). This
// module does not invent a larger default than that established precedent.
export const AGENT_SESSION_DEFAULT_MAX_RECENT_EVENTS = 20;
export const AGENT_SESSION_HARD_MAX_RECENT_EVENTS = 100;
export const AGENT_SESSION_DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h, matching RecentCatalogContext's own window.

export interface AgentSessionStore {
  /** Idempotent: returns the existing session for conversationId if one already exists, otherwise creates it. */
  ensureSession(input: EnsureSessionInput): Promise<AgentSession>;

  /** Append-only. A repeat call with the same dedupeKey returns the original event (status: "duplicate"), never a second row. */
  appendEvent(input: AppendEventInput): Promise<AppendEventResult>;

  loadSession(sessionId: string): Promise<AgentSession | null>;

  loadSessionForConversation(conversationId: number): Promise<AgentSession | null>;

  /** Bounded per Phase 9 - maxEvents is clamped to AGENT_SESSION_HARD_MAX_RECENT_EVENTS regardless of what the caller asks for. Ascending occurredAt order. */
  loadRecentEvents(input: LoadRecentEventsInput): Promise<AgentSessionEvent[]>;

  /** The persisted, materialized summary - null if the session has no events yet. Never assumed current without rebuildSummary when correctness matters more than latency. */
  loadSummary(sessionId: string): Promise<AgentSessionSummary | null>;

  /** Recomputes the summary from the FULL session event log (never the Phase-9-bounded recent window loadRecentEvents uses - correctness matters more than latency here, and this is not a per-turn hot path) and persists it as the new materialized optimization. */
  rebuildSummary(sessionId: string): Promise<AgentSessionSummary>;

  /**
   * SALES-AGENT-R3-V1.8-D7. Atomically writes agent_sessions.compacted_prefix_json/
   * compacted_through_seq/compacted_prefix_updated_at (migration 034) as one
   * unit (task brief Section J). Monotonic-advance guard only - `applied:
   * false` (never an error) means a concurrent compaction already advanced
   * compactedThroughSeq to `throughSeq` or beyond; the caller discards its
   * own result safely (Section K) rather than retrying or overwriting.
   */
  persistCompactedPrefix(input: PersistCompactedPrefixInput): Promise<PersistCompactedPrefixResult>;
}

export type PersistCompactedPrefixInput = {
  sessionId: string;
  /** conversation_message.id boundary (inclusive) - see compactedSessionPrefixContent.ts's domain note. */
  throughSeq: number;
  prefixJson: Record<string, unknown>;
};

export type PersistCompactedPrefixResult =
  | { ok: true; applied: true }
  /** The guard rejected the write (a newer or equal compaction already exists) - not an error. */
  | { ok: true; applied: false }
  | { ok: false; applied: false; warning: string };
