import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, resetPoolForTests, withConnection } from "@/lib/db";
import { createMariaDbAgentSessionStore } from "@/lib/brain/commercial/agent-session/mariaDbAgentSessionStore";
import { resetAgentSessionShadowStoreForTests } from "@/lib/brain/commercial/agent-session/shadowRecorder";

// SALES-AGENT-R3-A01. Real MariaDB, real crm_test database (same
// local-credential convention as tests/commercial/salesAgentConfiguration.test.ts) -
// never a mock of the repository. Requires migrations/033_agent_sessions.sql
// and migrations/034_agent_sessions_compaction_columns.sql already applied
// to crm_test.
//
// SALES-AGENT-R3-V1.8-D1: this file DID run against a real, reachable local
// MariaDB in this task's implementation session (unlike the A01 note this
// comment used to carry) - see the release doc for exact pass counts.

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "crm_test",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true"
});

async function ensureTestConversation(): Promise<number> {
  return withConnection(async (connection) => {
    // conversation.public_id is CHAR(36) (a UUID slot, migrations/008) - a
    // longer free-text id here fails ER_DATA_TOO_LONG under strict mode
    // rather than truncating (found by actually running this against a
    // real MariaDB - see docs/releases/SALES-AGENT-R3-A01-agent-session-store.md
    // "Real-database verification").
    const publicId = crypto.randomUUID();
    const externalContactId = `agsess-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const [result] = await connection.execute(
      `INSERT INTO conversation (public_id, channel, provider, channel_account_id, external_contact_id, status, owner_type)
       VALUES (?, 'whatsapp', 'meta', 'test_account', ?, 'open', 'ai_sdr')`,
      [publicId, externalContactId]
    );
    return (result as { insertId: number }).insertId;
  });
}

after(async () => {
  await resetPoolForTests();
});

test("ensureSession creates a durable row and is idempotent per conversation", async () => {
  const store = createMariaDbAgentSessionStore();
  const conversationId = await ensureTestConversation();

  const first = await store.ensureSession({ conversationId });
  const second = await store.ensureSession({ conversationId });
  assert.equal(first.id, second.id);

  const rows = await withConnection((connection) => connection.execute("SELECT COUNT(*) AS c FROM agent_sessions WHERE conversation_id = ?", [conversationId]));
  const count = Number((rows[0] as unknown as { c: number }[])[0].c);
  assert.equal(count, 1); // UNIQUE KEY uq_agent_sessions_conversation_id enforced this at the DB level.
});

test("appendEvent's dedupe_key UNIQUE KEY prevents a duplicate row at the database level", async () => {
  const store = createMariaDbAgentSessionStore();
  const conversationId = await ensureTestConversation();
  const session = await store.ensureSession({ conversationId });

  const attempts = await Promise.all(
    Array.from({ length: 5 }, () =>
      store.appendEvent({ sessionId: session.id, conversationId, eventType: "USER_MESSAGE_RECEIVED", correlationId: "c1", dedupeKey: "real-db-race", payload: {} })
    )
  );
  assert.ok(attempts.every((result) => result.ok));

  const rows = await withConnection((connection) => connection.execute("SELECT COUNT(*) AS c FROM agent_session_events WHERE dedupe_key = ?", ["real-db-race"]));
  const count = Number((rows[0] as unknown as { c: number }[])[0].c);
  assert.equal(count, 1);
});

test("session and event history survive a simulated process restart (fresh connection pool)", async () => {
  const store = createMariaDbAgentSessionStore();
  const conversationId = await ensureTestConversation();
  const session = await store.ensureSession({ conversationId });
  await store.appendEvent({ sessionId: session.id, conversationId, eventType: "USER_MESSAGE_RECEIVED", correlationId: "c1", dedupeKey: `restart-${conversationId}`, payload: {} });
  await store.rebuildSummary(session.id);

  // Simulates a real process restart's "destroy the pool" boundary, same
  // mechanism ACS-R1-05-T07's restart-recovery tests already use.
  await resetPoolForTests();
  resetAgentSessionShadowStoreForTests();
  getPool(); // forces a genuinely new mysql2 Pool on next use.

  const freshStore = createMariaDbAgentSessionStore();
  const resumed = await freshStore.loadSessionForConversation(conversationId);
  assert.equal(resumed?.id, session.id);
  const events = await freshStore.loadRecentEvents({ sessionId: session.id });
  assert.equal(events.length, 1);
  const summary = await freshStore.loadSummary(session.id);
  assert.equal(summary?.eventCount, 1);
});

test("loadRecentEvents ORDER BY occurred_at, seq returns true insertion order for same-millisecond events", async () => {
  const store = createMariaDbAgentSessionStore();
  const conversationId = await ensureTestConversation();
  const session = await store.ensureSession({ conversationId });

  // No explicit occurredAt - both rows land in the same (or adjacent)
  // millisecond in a fast test run, exercising the `seq` tiebreaker
  // (migrations/033_agent_sessions.sql) rather than relying on id (a
  // content hash, never an ordering signal).
  await store.appendEvent({ sessionId: session.id, conversationId, eventType: "COMMERCIAL_ACTION_REQUESTED", correlationId: "c1", dedupeKey: "seq-a", payload: { tool: "select_products" } });
  await store.appendEvent({ sessionId: session.id, conversationId, eventType: "COMMERCIAL_ACTION_COMPLETED", correlationId: "c1", dedupeKey: "seq-b", payload: { tool: "select_products" } });

  const events = await store.loadRecentEvents({ sessionId: session.id });
  assert.deepEqual(events.map((event) => event.eventType), ["COMMERCIAL_ACTION_REQUESTED", "COMMERCIAL_ACTION_COMPLETED"]);
});

// SALES-AGENT-R3-V1.8-D1 (migration 034). Nothing writes these columns yet
// (compaction itself is a later slice, D7) - these tests use direct,
// test-controlled SQL to populate them, then prove the existing mapper
// (mariaDbAgentSessionStore.ts#sessionRowToContract) reads them back
// correctly, exactly as V1.8-D1's own task brief allows.

test("[D1] a session row created before this migration reads back with all three compaction columns null", async () => {
  const store = createMariaDbAgentSessionStore();
  const conversationId = await ensureTestConversation();
  const session = await store.ensureSession({ conversationId });

  assert.equal(session.compactedPrefixJson, null);
  assert.equal(session.compactedThroughSeq, null);
  assert.equal(session.compactedPrefixUpdatedAt, null);

  const reloaded = await store.loadSessionForConversation(conversationId);
  assert.equal(reloaded?.compactedPrefixJson, null);
  assert.equal(reloaded?.compactedThroughSeq, null);
  assert.equal(reloaded?.compactedPrefixUpdatedAt, null);
});

test("[D1] compacted_prefix_json round-trips through the mapper once populated by test-controlled SQL", async () => {
  const store = createMariaDbAgentSessionStore();
  const conversationId = await ensureTestConversation();
  const session = await store.ensureSession({ conversationId });

  await withConnection((connection) =>
    connection.execute("UPDATE agent_sessions SET compacted_prefix_json = ? WHERE id = ?", [JSON.stringify({ note: "test-fixture-prefix" }), session.id])
  );

  const reloaded = await store.loadSession(session.id);
  assert.deepEqual(reloaded?.compactedPrefixJson, { note: "test-fixture-prefix" });
});

test("[D1] compacted_through_seq round-trips as a number, not a string/BigInt artifact", async () => {
  const store = createMariaDbAgentSessionStore();
  const conversationId = await ensureTestConversation();
  const session = await store.ensureSession({ conversationId });

  await withConnection((connection) => connection.execute("UPDATE agent_sessions SET compacted_through_seq = ? WHERE id = ?", [42, session.id]));

  const reloaded = await store.loadSession(session.id);
  assert.equal(reloaded?.compactedThroughSeq, 42);
  assert.equal(typeof reloaded?.compactedThroughSeq, "number");
});

test("[D1] compacted_prefix_updated_at round-trips as an ISO string", async () => {
  const store = createMariaDbAgentSessionStore();
  const conversationId = await ensureTestConversation();
  const session = await store.ensureSession({ conversationId });

  await withConnection((connection) => connection.execute("UPDATE agent_sessions SET compacted_prefix_updated_at = ? WHERE id = ?", ["2026-01-01 00:00:00.000", session.id]));

  const reloaded = await store.loadSession(session.id);
  assert.equal(typeof reloaded?.compactedPrefixUpdatedAt, "string");
  assert.ok(reloaded?.compactedPrefixUpdatedAt?.startsWith("2026-01-01"));
});

test("a payload with a forbidden key is rejected before any INSERT reaches the database", async () => {
  const store = createMariaDbAgentSessionStore();
  const conversationId = await ensureTestConversation();
  const session = await store.ensureSession({ conversationId });

  const result = await store.appendEvent({
    sessionId: session.id, conversationId, eventType: "COMMERCIAL_ACTION_COMPLETED", correlationId: "c1",
    dedupeKey: "forbidden-real-db", payload: { tool: "create_customer", email: "cliente@example.com" }
  });
  assert.equal(result.ok, false);

  const rows = await withConnection((connection) => connection.execute("SELECT COUNT(*) AS c FROM agent_session_events WHERE dedupe_key = ?", ["forbidden-real-db"]));
  const count = Number((rows[0] as unknown as { c: number }[])[0].c);
  assert.equal(count, 0);
});

// SALES-AGENT-R3-V1.8-D7. persistCompactedPrefix's own atomic write +
// monotonic-advance guard (task brief Section J/K) - real MariaDB, real
// concurrent connections, never a mocked UPDATE.

test("[D7-S1] persistCompactedPrefix writes all three columns atomically on a first compaction", async () => {
  const store = createMariaDbAgentSessionStore();
  const conversationId = await ensureTestConversation();
  const session = await store.ensureSession({ conversationId });

  const result = await store.persistCompactedPrefix({ sessionId: session.id, throughSeq: 30, prefixJson: { schemaVersion: 1, summaryText: "resumen 1-30" } });
  assert.deepEqual(result, { ok: true, applied: true });

  const reloaded = await store.loadSession(session.id);
  assert.equal(reloaded?.compactedThroughSeq, 30);
  assert.deepEqual(reloaded?.compactedPrefixJson, { schemaVersion: 1, summaryText: "resumen 1-30" });
  assert.ok(typeof reloaded?.compactedPrefixUpdatedAt === "string");
});

test("[D7-S2] persistCompactedPrefix advances an existing prefix forward", async () => {
  const store = createMariaDbAgentSessionStore();
  const conversationId = await ensureTestConversation();
  const session = await store.ensureSession({ conversationId });

  await store.persistCompactedPrefix({ sessionId: session.id, throughSeq: 30, prefixJson: { schemaVersion: 1, summaryText: "A" } });
  const second = await store.persistCompactedPrefix({ sessionId: session.id, throughSeq: 45, prefixJson: { schemaVersion: 1, summaryText: "A + 31-45" } });
  assert.deepEqual(second, { ok: true, applied: true });

  const reloaded = await store.loadSession(session.id);
  assert.equal(reloaded?.compactedThroughSeq, 45);
});

test("[D7-S3] the monotonic guard rejects a stale (lower or equal) throughSeq without error - a safe no-op discard", async () => {
  const store = createMariaDbAgentSessionStore();
  const conversationId = await ensureTestConversation();
  const session = await store.ensureSession({ conversationId });

  await store.persistCompactedPrefix({ sessionId: session.id, throughSeq: 50, prefixJson: { schemaVersion: 1, summaryText: "newer" } });
  const staleEqual = await store.persistCompactedPrefix({ sessionId: session.id, throughSeq: 50, prefixJson: { schemaVersion: 1, summaryText: "stale-equal" } });
  const staleLower = await store.persistCompactedPrefix({ sessionId: session.id, throughSeq: 40, prefixJson: { schemaVersion: 1, summaryText: "stale-lower" } });
  assert.deepEqual(staleEqual, { ok: true, applied: false });
  assert.deepEqual(staleLower, { ok: true, applied: false });

  const reloaded = await store.loadSession(session.id);
  assert.equal(reloaded?.compactedThroughSeq, 50);
  assert.deepEqual(reloaded?.compactedPrefixJson, { schemaVersion: 1, summaryText: "newer" });
});

test("[D7-S4] concurrent compactions racing on the same session: only the higher throughSeq ever wins, never the last writer", async () => {
  const store = createMariaDbAgentSessionStore();
  const conversationId = await ensureTestConversation();
  const session = await store.ensureSession({ conversationId });

  // The lower throughSeq (40) is intentionally started AFTER the higher one
  // (60) resolves is not guaranteed by Promise.all ordering - the guard
  // itself (not call order) must be what decides the winner.
  const [higher, lower] = await Promise.all([
    store.persistCompactedPrefix({ sessionId: session.id, throughSeq: 60, prefixJson: { schemaVersion: 1, summaryText: "through-60" } }),
    store.persistCompactedPrefix({ sessionId: session.id, throughSeq: 40, prefixJson: { schemaVersion: 1, summaryText: "through-40" } })
  ]);
  assert.ok(higher.ok && lower.ok);

  const reloaded = await store.loadSession(session.id);
  // Whichever of the two actually landed last in real time, the guard
  // guarantees the STORED value is never lower than the highest one applied.
  assert.equal(reloaded?.compactedThroughSeq, 60);
  assert.deepEqual(reloaded?.compactedPrefixJson, { schemaVersion: 1, summaryText: "through-60" });
});

test("[D7-S5] persistCompactedPrefix on an unknown sessionId matches zero rows, applied: false, never throws", async () => {
  const store = createMariaDbAgentSessionStore();
  const result = await store.persistCompactedPrefix({ sessionId: "agsess_does_not_exist", throughSeq: 1, prefixJson: { schemaVersion: 1, summaryText: "x" } });
  assert.deepEqual(result, { ok: true, applied: false });
});
