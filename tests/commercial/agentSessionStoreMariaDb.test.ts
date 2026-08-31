import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, resetPoolForTests, withConnection } from "@/lib/db";
import { createMariaDbAgentSessionStore } from "@/lib/brain/commercial/agent-session/mariaDbAgentSessionStore";
import { resetAgentSessionShadowStoreForTests } from "@/lib/brain/commercial/agent-session/shadowRecorder";

// SALES-AGENT-R3-A01. Real MariaDB, real crm_test database (same
// local-credential convention as tests/commercial/salesAgentConfiguration.test.ts) -
// never a mock of the repository. Requires migrations/033_agent_sessions.sql
// already applied to crm_test.
//
// COULD NOT BE RUN in the implementation session for this task: no reachable
// local MariaDB (docker compose's engine was unavailable - see
// docs/releases/SALES-AGENT-R3-A01-agent-session-store.md "Known limitations").
// This file exists so the guarantees these tests assert (database-level
// dedupe, ordering under seq, process-restart resume via resetPoolForTests())
// can be verified the next time a real crm_test instance is reachable - it
// is not a substitute for tests/commercial/agentSessionStore.test.ts's
// interface-level coverage (which DID run, against the in-memory store), nor
// is it presented as already-passing evidence.

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
