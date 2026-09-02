// SALES-AGENT-R3-A01. In-memory AgentSessionStore - a test double, never a
// second production persistence engine (ADR-009 governs production; this
// never touches lib/db.ts or MariaDB). Mirrors the same pattern already
// established in this repo for exactly this purpose (agent-loop/providers/
// fakeAgentLoopProvider.ts). Semantics (dedupe-by-key, one session per
// conversationId, append-only, CAS-style summary versioning) are modeled to
// match mariaDbAgentSessionStore.ts's real guarantees as closely as possible
// so tests against this fake exercise real interface behavior, not a
// simplified stand-in.

import { AGENT_SESSION_CONTRACT_NAME, AGENT_SESSION_SCHEMA_VERSION } from "./types";
import type {
  AgentSession,
  AgentSessionEvent,
  AgentSessionSummary,
  AppendEventInput,
  AppendEventResult,
  EnsureSessionInput,
  LoadRecentEventsInput
} from "./types";
import { buildAgentSessionEventId, buildAgentSessionId } from "./dedupe";
import { sanitizeAgentSessionPayload } from "./sanitizer";
import { projectAgentSessionSummary } from "./summary";
import { AGENT_SESSION_DEFAULT_MAX_AGE_MS, AGENT_SESSION_DEFAULT_MAX_RECENT_EVENTS, AGENT_SESSION_HARD_MAX_RECENT_EVENTS, type AgentSessionStore } from "./store";

type SessionRow = AgentSession;
type SummaryRow = { summary: AgentSessionSummary; version: number };

/**
 * Shared backing store so multiple `createInMemoryAgentSessionStore()`
 * handles can simulate "repository recreation" (a fresh store instance
 * reading the same underlying data) the way resetPoolForTests() lets a real
 * MariaDB-backed test simulate a process restart. Pass the same `backing`
 * object to two store instances to get that behavior; omit it for full
 * isolation between tests.
 */
export type InMemoryAgentSessionBacking = {
  sessionsByConversationId: Map<number, SessionRow>;
  sessionsById: Map<string, SessionRow>;
  eventsBySession: Map<string, AgentSessionEvent[]>;
  eventsByDedupeKey: Map<string, AgentSessionEvent>;
  summariesBySession: Map<string, SummaryRow>;
};

export function createInMemoryAgentSessionBacking(): InMemoryAgentSessionBacking {
  return {
    sessionsByConversationId: new Map(),
    sessionsById: new Map(),
    eventsBySession: new Map(),
    eventsByDedupeKey: new Map(),
    summariesBySession: new Map()
  };
}

export function createInMemoryAgentSessionStore(backing: InMemoryAgentSessionBacking = createInMemoryAgentSessionBacking()): AgentSessionStore {
  function nowIso() {
    return new Date().toISOString();
  }

  async function ensureSession(input: EnsureSessionInput): Promise<AgentSession> {
    const existing = backing.sessionsByConversationId.get(input.conversationId);
    if (existing) return existing;

    const id = buildAgentSessionId(input.conversationId);
    const timestamp = nowIso();
    const session: AgentSession = {
      contractName: AGENT_SESSION_CONTRACT_NAME,
      schemaVersion: AGENT_SESSION_SCHEMA_VERSION,
      id,
      conversationId: input.conversationId,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
      // SALES-AGENT-R3-V1.8-D1. Mirrors mariaDbAgentSessionStore.ts: null
      // until a future compaction slice (D7) ever writes them.
      compactedPrefixJson: null,
      compactedThroughSeq: null,
      compactedPrefixUpdatedAt: null
    };
    backing.sessionsByConversationId.set(input.conversationId, session);
    backing.sessionsById.set(id, session);
    return session;
  }

  async function appendEvent(input: AppendEventInput): Promise<AppendEventResult> {
    const existing = backing.eventsByDedupeKey.get(input.dedupeKey);
    if (existing) return { ok: true, status: "duplicate", event: existing };

    // A real microtask yield here (never present in a purely synchronous
    // fake) so concurrent appendEvent() calls for the same dedupeKey can
    // genuinely interleave between this check and the write below - the
    // same async-gap race a real MariaDB round-trip has. Without this, a
    // Promise.all() of N calls would just run sequentially in one
    // microtask and never actually exercise the recheck-before-write logic.
    await Promise.resolve();

    let sanitizedPayload: Record<string, unknown>;
    try {
      sanitizedPayload = sanitizeAgentSessionPayload(input.payload);
    } catch (error) {
      return { ok: false, status: "error", event: null, warning: error instanceof Error ? error.message : String(error) };
    }

    const occurredAt = input.occurredAt?.trim() || nowIso();
    const event: AgentSessionEvent = {
      contractName: AGENT_SESSION_CONTRACT_NAME,
      schemaVersion: AGENT_SESSION_SCHEMA_VERSION,
      eventId: buildAgentSessionEventId(input.dedupeKey),
      sessionId: input.sessionId,
      conversationId: input.conversationId,
      eventType: input.eventType,
      correlationId: input.correlationId,
      causationId: input.causationId ?? null,
      dedupeKey: input.dedupeKey,
      payload: sanitizedPayload,
      occurredAt,
      createdAt: nowIso()
    };

    // Re-check after the async sanitizer step, mirroring the MariaDB
    // implementation's check-then-insert-then-recheck race handling.
    const raced = backing.eventsByDedupeKey.get(input.dedupeKey);
    if (raced) return { ok: true, status: "duplicate", event: raced };

    backing.eventsByDedupeKey.set(input.dedupeKey, event);
    const list = backing.eventsBySession.get(input.sessionId) ?? [];
    list.push(event);
    backing.eventsBySession.set(input.sessionId, list);
    return { ok: true, status: "created", event };
  }

  async function loadSession(sessionId: string): Promise<AgentSession | null> {
    return backing.sessionsById.get(sessionId) ?? null;
  }

  async function loadSessionForConversation(conversationId: number): Promise<AgentSession | null> {
    return backing.sessionsByConversationId.get(conversationId) ?? null;
  }

  /**
   * Sorts by occurredAt (intentional - lets a caller record an event that
   * logically happened earlier, e.g. a delayed redelivery, and still have
   * it read back in business-time order). Ties are left in their existing
   * relative order rather than broken by a secondary key: Array.prototype.sort
   * has been spec-guaranteed stable since ES2019, and `list` is already in
   * true append order - so two events appended in the same millisecond keep
   * their real insertion order, never an arbitrary hash-based one (the
   * eventId is a content hash of the dedupeKey, not a sequence, and must
   * never be used as an ordering tiebreaker).
   */
  function sortedEvents(sessionId: string): AgentSessionEvent[] {
    const list = backing.eventsBySession.get(sessionId) ?? [];
    return [...list].sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0));
  }

  async function loadRecentEvents(input: LoadRecentEventsInput): Promise<AgentSessionEvent[]> {
    const maxEvents = Math.min(input.maxEvents ?? AGENT_SESSION_DEFAULT_MAX_RECENT_EVENTS, AGENT_SESSION_HARD_MAX_RECENT_EVENTS);
    const maxAgeMs = input.maxAgeMs ?? AGENT_SESSION_DEFAULT_MAX_AGE_MS;
    const cutoff = Date.now() - maxAgeMs;
    const all = sortedEvents(input.sessionId).filter((event) => new Date(event.occurredAt).getTime() >= cutoff);
    return all.slice(Math.max(0, all.length - maxEvents));
  }

  async function loadSummary(sessionId: string): Promise<AgentSessionSummary | null> {
    const row = backing.summariesBySession.get(sessionId);
    return row ? { ...row.summary, version: row.version } : null;
  }

  async function rebuildSummary(sessionId: string): Promise<AgentSessionSummary> {
    const session = backing.sessionsById.get(sessionId);
    const conversationId = session?.conversationId ?? 0;
    const allEvents = sortedEvents(sessionId);
    const projected = projectAgentSessionSummary(sessionId, conversationId, allEvents);
    const previous = backing.summariesBySession.get(sessionId);
    const nextVersion = (previous?.version ?? 0) + 1;
    const stored: AgentSessionSummary = { ...projected, version: nextVersion };
    backing.summariesBySession.set(sessionId, { summary: stored, version: nextVersion });
    return stored;
  }

  return { ensureSession, appendEvent, loadSession, loadSessionForConversation, loadRecentEvents, loadSummary, rebuildSummary };
}
