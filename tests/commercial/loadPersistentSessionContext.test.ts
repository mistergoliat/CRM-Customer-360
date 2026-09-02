import assert from "node:assert/strict";
import test, { after } from "node:test";
import { resetPoolForTests, withConnection } from "@/lib/db";
import { createMariaDbAgentSessionStore } from "@/lib/brain/commercial/agent-session/mariaDbAgentSessionStore";
import { loadPersistentSessionContext } from "@/lib/brain/commercial/agent-session/loadPersistentSessionContext";
import { loadRecentConversationTranscript } from "@/lib/brain/commercial/agent-session/conversationTranscriptReader";
import { deriveConversationMessages } from "@/lib/brain/commercial/agent-session/deriveMessages";
import type { AgentSessionStore } from "@/lib/brain/commercial/agent-session/store";

// SALES-AGENT-R3-V1.8-D3. Real MariaDB, real crm_test database - same
// local-credential convention as agentSessionStoreMariaDb.test.ts. Proves
// the bounded transcript reader, the read-side contract (session absent,
// bootstrap, compacted-prefix validation, degrade-on-failure), and the short
// per-conversation GET_LOCK guard (V1.8-D0 section 4) against real
// concurrent connections - never a mock of MariaDB's own locking behavior.

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

after(async () => {
  await resetPoolForTests();
});

async function ensureTestConversation(): Promise<number> {
  return withConnection(async (connection) => {
    const publicId = crypto.randomUUID();
    const externalContactId = `d3-read-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const [result] = await connection.execute(
      `INSERT INTO conversation (public_id, channel, provider, channel_account_id, external_contact_id, status, owner_type)
       VALUES (?, 'whatsapp', 'meta', 'test_account', ?, 'open', 'ai_sdr')`,
      [publicId, externalContactId]
    );
    return (result as { insertId: number }).insertId;
  });
}

async function insertTestMessage(conversationId: number, direction: string, body: string | null, createdAt: string): Promise<number> {
  return withConnection(async (connection) => {
    const publicId = crypto.randomUUID();
    const [result] = await connection.execute(
      `INSERT INTO conversation_message (public_id, conversation_id, provider, direction, sender_type, message_type, body, status, created_at)
       VALUES (?, ?, 'meta', ?, 'customer', 'text', ?, 'received', ?)`,
      [publicId, conversationId, direction, body, createdAt]
    );
    return (result as { insertId: number }).insertId;
  });
}

function throwingStore(): AgentSessionStore {
  return {
    ensureSession: () => {
      throw new Error("should not be called by the read side");
    },
    appendEvent: () => {
      throw new Error("should not be called by the read side");
    },
    loadSession: () => {
      throw new Error("should not be called by the read side");
    },
    loadSessionForConversation: async () => {
      throw new Error("simulated_session_read_failure");
    },
    loadRecentEvents: async () => [],
    loadSummary: async () => null,
    rebuildSummary: () => {
      throw new Error("should not be called by the read side");
    }
  };
}

test("[D3-T1] a conversation with no agent_sessions row reads back session: null, events: [] safely", async () => {
  const conversationId = await ensureTestConversation();
  const result = await loadPersistentSessionContext({ conversationId });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.session, null);
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.transcriptMessages, []);
  assert.equal(result.compactedPrefix, null);
  assert.equal(result.bootstrapUsed, false);
});

test("[D3-T2] bounded transcript reader returns ascending order, correct role mapping, and respects the limit", async () => {
  const conversationId = await ensureTestConversation();
  const base = Date.parse("2026-08-31T09:00:00.000Z");
  const ids: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const createdAt = new Date(base + i * 1000).toISOString().slice(0, 23).replace("T", " ");
    const direction = i % 2 === 0 ? "inbound" : "outbound";
    ids.push(await insertTestMessage(conversationId, direction, `mensaje ${i}`, createdAt));
  }

  const bounded = await loadRecentConversationTranscript(conversationId, 3);
  assert.equal(bounded.length, 3);
  assert.deepEqual(bounded.map((m) => m.body), ["mensaje 2", "mensaje 3", "mensaje 4"], "DESC+LIMIT then reversed must keep only the most recent N, in ascending order");

  const messages = deriveConversationMessages({ transcriptMessages: bounded, compactedPrefix: null, currentInboundMessageId: String(ids[4]) });
  assert.deepEqual(messages, [
    { role: "user", content: "mensaje 2" },
    { role: "assistant", content: "mensaje 3" }
  ]);
});

// Section F/P. A pre-D2 conversation has real conversation_message rows but
// zero agent_session_events - the bounded transcript reader must still
// return the real prior turns (never an empty bootstrap).
test("[D3-T3] a session with no events but a real transcript is flagged bootstrapUsed, and the transcript is not discarded", async () => {
  const conversationId = await ensureTestConversation();
  const sessionStore = createMariaDbAgentSessionStore();
  await sessionStore.ensureSession({ conversationId }); // session exists, but no events ever appended to it.

  const base = Date.parse("2026-08-31T09:00:00.000Z");
  await insertTestMessage(conversationId, "inbound", "hola, tienen barras?", new Date(base).toISOString().slice(0, 23).replace("T", " "));
  await insertTestMessage(conversationId, "outbound", "si, tenemos varias!", new Date(base + 1000).toISOString().slice(0, 23).replace("T", " "));

  const result = await loadPersistentSessionContext({ conversationId, store: sessionStore });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.events.length, 0);
  assert.equal(result.transcriptMessages.length, 2);
  assert.equal(result.bootstrapUsed, true);
});

test("[D3-T4] an active session with real user+assistant events and transcript loads both", async () => {
  const conversationId = await ensureTestConversation();
  const sessionStore = createMariaDbAgentSessionStore();
  const session = await sessionStore.ensureSession({ conversationId });
  await sessionStore.appendEvent({
    sessionId: session.id,
    conversationId,
    eventType: "USER_MESSAGE_RECEIVED",
    correlationId: "corr-1",
    dedupeKey: `session:${session.id}:user_message:1`,
    payload: { inboundMessageId: "1" }
  });

  const base = Date.parse("2026-08-31T09:00:00.000Z");
  await insertTestMessage(conversationId, "inbound", "hola", new Date(base).toISOString().slice(0, 23).replace("T", " "));

  const result = await loadPersistentSessionContext({ conversationId, store: sessionStore });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.session?.id, session.id);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].eventType, "USER_MESSAGE_RECEIVED");
  assert.equal(result.transcriptMessages.length, 1);
  assert.equal(result.bootstrapUsed, false);
});

test("[D3-T5] a valid compacted prefix round-trips through the real session row", async () => {
  const conversationId = await ensureTestConversation();
  const sessionStore = createMariaDbAgentSessionStore();
  const session = await sessionStore.ensureSession({ conversationId });
  await withConnection((connection) =>
    connection.execute("UPDATE agent_sessions SET compacted_prefix_json = ?, compacted_through_seq = ? WHERE id = ?", [
      JSON.stringify({ note: "resumen" }),
      3,
      session.id
    ])
  );

  const result = await loadPersistentSessionContext({ conversationId, store: sessionStore });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.compactedPrefix, { throughSeq: 3, prefixJson: { note: "resumen" } });
  assert.deepEqual(result.warnings, []);
});

test("[D3-T6] a one-sided (invalid) compacted prefix degrades only that slot, with a warning, never the whole read", async () => {
  const conversationId = await ensureTestConversation();
  const sessionStore = createMariaDbAgentSessionStore();
  const session = await sessionStore.ensureSession({ conversationId });
  // compacted_through_seq populated, compacted_prefix_json left null - a
  // structurally inconsistent pair no real writer produces today (D7 has no
  // emitter yet), used here purely as a controlled invalid fixture.
  await withConnection((connection) => connection.execute("UPDATE agent_sessions SET compacted_through_seq = ? WHERE id = ?", [3, session.id]));

  const result = await loadPersistentSessionContext({ conversationId, store: sessionStore });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.compactedPrefix, null);
  assert.ok(result.warnings.includes("agent_session_invalid_compacted_prefix_metadata"));
});

test("[D3-T7] a session read failure degrades to a typed result, never throws", async () => {
  const conversationId = await ensureTestConversation();
  const result = await loadPersistentSessionContext({ conversationId, store: throwingStore() });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.degraded, true);
  assert.ok(result.warning.includes("simulated_session_read_failure"));
});

test("[D3-U1] the read-side lock is exclusive: a concurrent holder of the same key causes a bounded timeout, not a hang", async () => {
  const conversationId = await ensureTestConversation();
  await withConnection(async (holderConnection) => {
    const [rows] = await holderConnection.execute("SELECT GET_LOCK(?, 5) AS acquired", [`agent_session:${conversationId}`]);
    assert.equal(Number((rows as { acquired: unknown }[])[0].acquired), 1, "test setup must actually hold the lock");

    try {
      const result = await loadPersistentSessionContext({ conversationId, lockTimeoutSeconds: 1 });
      assert.equal(result.ok, false);
      if (!result.ok) assert.ok(result.warning.includes("agent_session_read_lock_timeout"));
    } finally {
      await holderConnection.execute("SELECT RELEASE_LOCK(?)", [`agent_session:${conversationId}`]);
    }
  });
});

test("[D3-U2] the lock is released after success - a second immediate call for the same conversation does not wait", async () => {
  const conversationId = await ensureTestConversation();
  const first = await loadPersistentSessionContext({ conversationId, lockTimeoutSeconds: 2 });
  assert.equal(first.ok, true);
  const startedAt = Date.now();
  const second = await loadPersistentSessionContext({ conversationId, lockTimeoutSeconds: 2 });
  assert.equal(second.ok, true);
  assert.ok(Date.now() - startedAt < 1000, "the second call must not have waited for the first call's own lock");
});

test("[D3-U3] the lock is released even when the locked section throws", async () => {
  const conversationId = await ensureTestConversation();
  const failed = await loadPersistentSessionContext({ conversationId, store: throwingStore(), lockTimeoutSeconds: 2 });
  assert.equal(failed.ok, false);

  const startedAt = Date.now();
  const recovered = await loadPersistentSessionContext({ conversationId, lockTimeoutSeconds: 2 });
  assert.equal(recovered.ok, true);
  assert.ok(Date.now() - startedAt < 1000, "a thrown error in the locked section must not leave the lock held");
});
