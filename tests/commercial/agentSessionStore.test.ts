import assert from "node:assert/strict";
import test from "node:test";
import { AgentSessionForbiddenPayloadError } from "@/lib/brain/commercial/agent-session/sanitizer";
import {
  createInMemoryAgentSessionBacking,
  createInMemoryAgentSessionStore
} from "@/lib/brain/commercial/agent-session/inMemoryAgentSessionStore";
import type { AgentSessionStore } from "@/lib/brain/commercial/agent-session/store";
import { AGENT_SESSION_HARD_MAX_RECENT_EVENTS } from "@/lib/brain/commercial/agent-session/store";
import { buildSessionCompactedDedupeKey } from "@/lib/brain/commercial/agent-session/dedupe";
import { isValidAgentSessionCompactedPayload } from "@/lib/brain/commercial/agent-session/types";
import type { AgentSessionAssistantMessagePayload, AgentSessionCompactedPayload } from "@/lib/brain/commercial/agent-session/types";

// SALES-AGENT-R3-A01. Interface-level behavior tests against the in-memory
// AgentSessionStore (a test double, never a second production persistence
// engine - see inMemoryAgentSessionStore.ts's own header comment). These
// exercise the CONTRACT every implementation (including the real
// MariaDB-backed one, tested separately in agentSessionStoreMariaDb.test.ts)
// must satisfy: append-only, database-level-equivalent dedupe, ordering,
// bounded retrieval, session isolation, PII-safety, and summary
// determinism/rebuild. See docs/releases/SALES-AGENT-R3-A01-agent-session-store.md
// for why real-MariaDB verification of these same guarantees could not run
// in this sandbox.

function freshStore(): AgentSessionStore {
  return createInMemoryAgentSessionStore();
}

// Scenario 1 + 2: creates session, reuses same session for same conversation.
test("ensureSession creates a session and is idempotent per conversation", async () => {
  const store = freshStore();
  const first = await store.ensureSession({ conversationId: 42 });
  const second = await store.ensureSession({ conversationId: 42 });
  assert.equal(first.id, second.id);
  assert.equal(first.conversationId, 42);
  assert.equal(first.status, "active");
});

// Scenario 24: session isolation between two conversations.
test("two different conversations get two different sessions", async () => {
  const store = freshStore();
  const a = await store.ensureSession({ conversationId: 1 });
  const b = await store.ensureSession({ conversationId: 2 });
  assert.notEqual(a.id, b.id);

  await store.appendEvent({ sessionId: a.id, conversationId: 1, eventType: "USER_MESSAGE_RECEIVED", correlationId: "c1", dedupeKey: "k1", payload: {} });
  const eventsA = await store.loadRecentEvents({ sessionId: a.id });
  const eventsB = await store.loadRecentEvents({ sessionId: b.id });
  assert.equal(eventsA.length, 1);
  assert.equal(eventsB.length, 0);
});

// Scenario 3 + 4: append event, event ordering.
test("appendEvent persists events and loadRecentEvents returns ascending occurredAt order", async () => {
  const store = freshStore();
  const session = await store.ensureSession({ conversationId: 1 });

  // Relative to Date.now(), not a hardcoded calendar date: AGENT_SESSION_DEFAULT_MAX_AGE_MS
  // (24h, applied by loadRecentEvents's default window) would otherwise
  // silently filter out an absolute fixture date once real wall-clock time
  // moves more than 24h past it - this must stay green indefinitely,
  // regardless of when it runs. Same relative-offset structure as before
  // (+0s/+5s/+2s), only the anchor changed.
  const base = Date.now();
  await store.appendEvent({
    sessionId: session.id, conversationId: 1, eventType: "USER_MESSAGE_RECEIVED", correlationId: "c1",
    dedupeKey: "k-user", payload: {}, occurredAt: new Date(base).toISOString()
  });
  await store.appendEvent({
    sessionId: session.id, conversationId: 1, eventType: "ASSISTANT_MESSAGE_SENT", correlationId: "c1",
    dedupeKey: "k-assistant", payload: { outcome: "message" }, occurredAt: new Date(base + 5000).toISOString()
  });
  await store.appendEvent({
    sessionId: session.id, conversationId: 1, eventType: "READ_TOOL_REQUESTED", correlationId: "c1",
    dedupeKey: "k-tool", payload: { tool: "search_products" }, occurredAt: new Date(base + 2000).toISOString()
  });

  const events = await store.loadRecentEvents({ sessionId: session.id });
  assert.deepEqual(events.map((event) => event.eventType), ["USER_MESSAGE_RECEIVED", "READ_TOOL_REQUESTED", "ASSISTANT_MESSAGE_SENT"]);
});

// Scenario 5: append-only behavior - no update/mutation path exists on the interface at all.
test("the store interface exposes no mutation of a historical event - only append", async () => {
  const store = freshStore();
  const session = await store.ensureSession({ conversationId: 1 });
  const result = await store.appendEvent({
    sessionId: session.id, conversationId: 1, eventType: "USER_MESSAGE_RECEIVED", correlationId: "c1", dedupeKey: "k1", payload: {}
  });
  assert.ok(result.ok && result.status === "created");
  const firstEvent = result.event;

  // Re-append with the same dedupeKey but a different payload shape - must
  // return the ORIGINAL event unchanged, never overwrite it.
  const second = await store.appendEvent({
    sessionId: session.id, conversationId: 1, eventType: "USER_MESSAGE_RECEIVED", correlationId: "c1",
    dedupeKey: "k1", payload: { inboundMessageId: "different" }
  });
  assert.ok(second.ok && second.status === "duplicate");
  assert.deepEqual(second.event, firstEvent);
});

// Scenario 6: duplicate dedupeKey.
test("appendEvent with a repeated dedupeKey never creates a second row", async () => {
  const store = freshStore();
  const session = await store.ensureSession({ conversationId: 1 });
  await store.appendEvent({ sessionId: session.id, conversationId: 1, eventType: "USER_MESSAGE_RECEIVED", correlationId: "c1", dedupeKey: "k1", payload: {} });
  await store.appendEvent({ sessionId: session.id, conversationId: 1, eventType: "USER_MESSAGE_RECEIVED", correlationId: "c1", dedupeKey: "k1", payload: {} });
  await store.appendEvent({ sessionId: session.id, conversationId: 1, eventType: "USER_MESSAGE_RECEIVED", correlationId: "c1", dedupeKey: "k1", payload: {} });
  const events = await store.loadRecentEvents({ sessionId: session.id });
  assert.equal(events.length, 1);
});

// Scenario 7: concurrent duplicate append.
test("concurrent appendEvent calls with the same dedupeKey still produce exactly one event", async () => {
  const store = freshStore();
  const session = await store.ensureSession({ conversationId: 1 });
  const attempts = Array.from({ length: 10 }, () =>
    store.appendEvent({ sessionId: session.id, conversationId: 1, eventType: "COMMERCIAL_ACTION_REQUESTED", correlationId: "c1", dedupeKey: "k-race", payload: { tool: "create_quote" } })
  );
  const results = await Promise.all(attempts);
  assert.ok(results.every((result) => result.ok));
  const events = await store.loadRecentEvents({ sessionId: session.id });
  assert.equal(events.length, 1);
  const createdCount = results.filter((result) => result.ok && result.status === "created").length;
  assert.equal(createdCount, 1);
});

// Scenario 8 + 25: resume after repository recreation / process restart semantics.
test("a fresh store instance over the same backing data resumes the same session and history", async () => {
  const backing = createInMemoryAgentSessionBacking();
  const firstProcess = createInMemoryAgentSessionStore(backing);
  const session = await firstProcess.ensureSession({ conversationId: 7 });
  await firstProcess.appendEvent({ sessionId: session.id, conversationId: 7, eventType: "USER_MESSAGE_RECEIVED", correlationId: "c1", dedupeKey: "k1", payload: {} });
  await firstProcess.rebuildSummary(session.id);

  // Simulates a process restart: a brand-new store handle, same durable
  // backing (in a real deployment: the same MariaDB tables via a fresh
  // connection pool - see agentSessionStoreMariaDb.test.ts's use of
  // resetPoolForTests() for the equivalent real-DB proof).
  const afterRestart = createInMemoryAgentSessionStore(backing);
  const resumed = await afterRestart.loadSessionForConversation(7);
  assert.equal(resumed?.id, session.id);
  const events = await afterRestart.loadRecentEvents({ sessionId: session.id });
  assert.equal(events.length, 1);
  const summary = await afterRestart.loadSummary(session.id);
  assert.equal(summary?.eventCount, 1);
});

// Scenario 9 + 10: load recent events, bounded retrieval.
test("loadRecentEvents is bounded by maxEvents and never exceeds the hard cap", async () => {
  const store = freshStore();
  const session = await store.ensureSession({ conversationId: 1 });
  // Relative to Date.now(), not a hardcoded calendar date - see the ordering
  // test above for why. Same structure (30 events, 1 second apart,
  // ascending), only the anchor changed.
  const base = Date.now();
  for (let index = 0; index < 30; index += 1) {
    await store.appendEvent({
      sessionId: session.id, conversationId: 1, eventType: "READ_TOOL_REQUESTED", correlationId: "c1",
      dedupeKey: `k-${index}`, payload: { tool: "search_products" },
      occurredAt: new Date(base + index * 1000).toISOString()
    });
  }

  const defaultWindow = await store.loadRecentEvents({ sessionId: session.id });
  assert.equal(defaultWindow.length, 20); // AGENT_SESSION_DEFAULT_MAX_RECENT_EVENTS.
  // The most recent 20 by occurredAt, still ascending.
  assert.equal(defaultWindow[0].dedupeKey, "k-10");
  assert.equal(defaultWindow[defaultWindow.length - 1].dedupeKey, "k-29");

  const overRequested = await store.loadRecentEvents({ sessionId: session.id, maxEvents: 1000 });
  assert.ok(overRequested.length <= AGENT_SESSION_HARD_MAX_RECENT_EVENTS);
});

test("loadRecentEvents respects maxAgeMs", async () => {
  const store = freshStore();
  const session = await store.ensureSession({ conversationId: 1 });
  await store.appendEvent({
    sessionId: session.id, conversationId: 1, eventType: "USER_MESSAGE_RECEIVED", correlationId: "c1",
    dedupeKey: "old", payload: {}, occurredAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  });
  await store.appendEvent({
    sessionId: session.id, conversationId: 1, eventType: "USER_MESSAGE_RECEIVED", correlationId: "c1",
    dedupeKey: "recent", payload: {}
  });
  const events = await store.loadRecentEvents({ sessionId: session.id, maxAgeMs: 24 * 60 * 60 * 1000 });
  assert.equal(events.length, 1);
  assert.equal(events[0].dedupeKey, "recent");
});

// Scenario 11 + 12: summary generation, deterministic rebuild.
test("rebuildSummary reflects the current event log and is deterministic", async () => {
  const store = freshStore();
  const session = await store.ensureSession({ conversationId: 1 });
  await store.appendEvent({ sessionId: session.id, conversationId: 1, eventType: "USER_MESSAGE_RECEIVED", correlationId: "c1", dedupeKey: "k1", payload: {} });

  const first = await store.rebuildSummary(session.id);
  const second = await store.rebuildSummary(session.id);
  assert.equal(first.eventCount, 1);
  assert.equal(second.eventCount, 1);
  assert.notEqual(first.version, null);
  assert.equal(second.version, (first.version ?? 0) + 1); // each rebuild is a new materialized version, even with no new events.
});

// Scenario 13: stale summary recovery.
test("loadSummary returns null before any rebuild, then the materialized summary after one", async () => {
  const store = freshStore();
  const session = await store.ensureSession({ conversationId: 1 });
  assert.equal(await store.loadSummary(session.id), null);

  await store.appendEvent({ sessionId: session.id, conversationId: 1, eventType: "USER_MESSAGE_RECEIVED", correlationId: "c1", dedupeKey: "k1", payload: {} });
  const stale = await store.loadSummary(session.id); // no rebuild yet - still reflects "before this event".
  assert.equal(stale, null);

  const rebuilt = await store.rebuildSummary(session.id);
  const fresh = await store.loadSummary(session.id);
  assert.equal(fresh?.eventCount, rebuilt.eventCount);
});

// Scenario 14 + 15: transaction outcome projection, repeated transaction does not duplicate semantics.
test("a commercial action's completion is observable without duplicating on repeat delivery", async () => {
  const store = freshStore();
  const session = await store.ensureSession({ conversationId: 1 });

  await store.appendEvent({ sessionId: session.id, conversationId: 1, eventType: "COMMERCIAL_ACTION_REQUESTED", correlationId: "c1", dedupeKey: "req", payload: { tool: "select_products" } });
  await store.appendEvent({ sessionId: session.id, conversationId: 1, eventType: "COMMERCIAL_ACTION_COMPLETED", correlationId: "c1", dedupeKey: "done", payload: { tool: "select_products" } });
  // A retry/redelivery of the same completion (same dedupeKey) must not double-count.
  await store.appendEvent({ sessionId: session.id, conversationId: 1, eventType: "COMMERCIAL_ACTION_COMPLETED", correlationId: "c1", dedupeKey: "done", payload: { tool: "select_products" } });

  const summary = await store.rebuildSummary(session.id);
  assert.equal(summary.eventCount, 2); // requested + completed, the retry was deduped.
  assert.deepEqual(summary.lastCommercialOutcome, { tool: "select_products", outcome: "completed", occurredAt: summary.lastCommercialOutcome?.occurredAt as string });
  assert.equal(summary.pendingCommercialAction, null);
});

// Scenario 21: PII-safe session projection.
test("appendEvent rejects a payload carrying PII-shaped fields instead of silently storing it", async () => {
  const store = freshStore();
  const session = await store.ensureSession({ conversationId: 1 });
  const result = await store.appendEvent({
    sessionId: session.id,
    conversationId: 1,
    eventType: "COMMERCIAL_ACTION_COMPLETED",
    correlationId: "c1",
    dedupeKey: "k-pii",
    payload: { tool: "create_customer", phone: "+56912345678", email: "cliente@example.com" }
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.warning, /agent_session_forbidden_payload/);
  }
  const events = await store.loadRecentEvents({ sessionId: session.id });
  assert.equal(events.length, 0); // nothing persisted.
});

// Scenario 22: duplicate inbound event compatibility.
test("the same inboundMessageId never produces two USER_MESSAGE_RECEIVED events", async () => {
  const store = freshStore();
  const session = await store.ensureSession({ conversationId: 1 });
  const dedupeKey = `session:${session.id}:user_message:msg_abc`;
  await store.appendEvent({ sessionId: session.id, conversationId: 1, eventType: "USER_MESSAGE_RECEIVED", correlationId: "c1", dedupeKey, payload: { inboundMessageId: "msg_abc" } });
  await store.appendEvent({ sessionId: session.id, conversationId: 1, eventType: "USER_MESSAGE_RECEIVED", correlationId: "c2", dedupeKey, payload: { inboundMessageId: "msg_abc" } });
  const events = await store.loadRecentEvents({ sessionId: session.id });
  assert.equal(events.filter((event) => event.eventType === "USER_MESSAGE_RECEIVED").length, 1);
});

// Scenario 23: unknown event safe handling (store-level - the taxonomy is a
// closed union in TypeScript, so this proves the summary side, already
// covered in agentSessionSummary.test.ts; here we confirm the store itself
// never throws when loading/rebuilding over a log containing non-tool event
// types like GOAL_UPDATED/FOLLOWUP_SCHEDULED).
test("rebuildSummary never throws over a log containing reserved-for-future event types", async () => {
  const store = freshStore();
  const session = await store.ensureSession({ conversationId: 1 });
  await store.appendEvent({ sessionId: session.id, conversationId: 1, eventType: "GOAL_UPDATED", correlationId: "c1", dedupeKey: "k1", payload: { goal: "buy a barbell" } });
  await store.appendEvent({ sessionId: session.id, conversationId: 1, eventType: "FOLLOWUP_SCHEDULED", correlationId: "c1", dedupeKey: "k2", payload: {} });
  await assert.doesNotReject(() => store.rebuildSummary(session.id));
});

test("loadSession and loadSessionForConversation return null for an unknown id", async () => {
  const store = freshStore();
  assert.equal(await store.loadSession("agsess_does_not_exist"), null);
  assert.equal(await store.loadSessionForConversation(999999), null);
});

// SALES-AGENT-R3-V1.8-D1. SESSION_COMPACTED is a valid AgentSessionEvent
// type end to end through the real store interface - not just a sanitizer
// check (see tests/commercial/agentSessionSanitizer.test.ts for that). No
// production caller emits this yet (reserved for a future D7 compaction
// slice) - this proves the contract accepts it today regardless.

test("[D1] SESSION_COMPACTED is accepted as a valid AgentSessionEvent type", async () => {
  const store = freshStore();
  const session = await store.ensureSession({ conversationId: 1 });
  const dedupeKey = buildSessionCompactedDedupeKey(session.id, 42);
  const payload: AgentSessionCompactedPayload = { fromSeq: 1, toSeq: 42, summaryEstimatedSize: 900 };
  assert.equal(isValidAgentSessionCompactedPayload(payload), true);

  const result = await store.appendEvent({ sessionId: session.id, conversationId: 1, eventType: "SESSION_COMPACTED", correlationId: "c1", dedupeKey, payload });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.status, "created");

  const events = await store.loadRecentEvents({ sessionId: session.id });
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "SESSION_COMPACTED");
  assert.deepEqual(events[0].payload, payload);
});

test("[D1] isValidAgentSessionCompactedPayload rejects a structurally nonsensical range", () => {
  assert.equal(isValidAgentSessionCompactedPayload({ fromSeq: 10, toSeq: 5, summaryEstimatedSize: 0 }), false);
  assert.equal(isValidAgentSessionCompactedPayload({ fromSeq: -1, toSeq: 5, summaryEstimatedSize: 0 }), false);
  assert.equal(isValidAgentSessionCompactedPayload({ fromSeq: 0, toSeq: 5, summaryEstimatedSize: -1 }), false);
  assert.equal(isValidAgentSessionCompactedPayload({ fromSeq: 0, toSeq: 5, summaryEstimatedSize: 0 }), true);
});

// SALES-AGENT-R3-V1.8-D1. ASSISTANT_MESSAGE_SENT's extended payload shape -
// no call site populates outboundMessagePublicId yet (that is D2's job);
// this proves the store accepts the extended shape today, both with a real
// id and with null, and that the pre-existing (unextended) shape from every
// call site still in production remains valid unchanged.

test("[D1] ASSISTANT_MESSAGE_SENT accepts outboundMessagePublicId as a string", async () => {
  const store = freshStore();
  const session = await store.ensureSession({ conversationId: 1 });
  const payload: AgentSessionAssistantMessagePayload = {
    inboundMessageId: "msg_1",
    outcome: "message",
    terminalReason: "responded",
    outboundMessagePublicId: "b2f2b6b0-1c1e-4b3a-9c2e-0f7a1a2b3c4d"
  };
  const result = await store.appendEvent({ sessionId: session.id, conversationId: 1, eventType: "ASSISTANT_MESSAGE_SENT", correlationId: "c1", dedupeKey: "am-1", payload });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.event.payload.outboundMessagePublicId, "b2f2b6b0-1c1e-4b3a-9c2e-0f7a1a2b3c4d");
});

test("[D1] ASSISTANT_MESSAGE_SENT accepts outboundMessagePublicId = null", async () => {
  const store = freshStore();
  const session = await store.ensureSession({ conversationId: 1 });
  const payload: AgentSessionAssistantMessagePayload = { inboundMessageId: "msg_2", outcome: "handoff", terminalReason: "handoff", outboundMessagePublicId: null };
  const result = await store.appendEvent({ sessionId: session.id, conversationId: 1, eventType: "ASSISTANT_MESSAGE_SENT", correlationId: "c1", dedupeKey: "am-2", payload });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.event.payload.outboundMessagePublicId, null);
});

test("[D1] the existing (unextended) ASSISTANT_MESSAGE_SENT shape from every production call site today remains valid", async () => {
  const store = freshStore();
  const session = await store.ensureSession({ conversationId: 1 });
  // Exactly shadowRecorder.ts's real, unmodified payload shape (no
  // outboundMessagePublicId field at all - D1 does not touch this call site).
  const payload = { inboundMessageId: "msg_3", outcome: "message" as const, terminalReason: "responded" };
  const result = await store.appendEvent({ sessionId: session.id, conversationId: 1, eventType: "ASSISTANT_MESSAGE_SENT", correlationId: "c1", dedupeKey: "am-3", payload });
  assert.equal(result.ok, true);
  assert.equal(result.ok && "outboundMessagePublicId" in result.event.payload, false);
});
