import assert from "node:assert/strict";
import test, { after } from "node:test";
import { resetPoolForTests, withConnection } from "@/lib/db";
import { createMariaDbAgentSessionStore } from "@/lib/brain/commercial/agent-session/mariaDbAgentSessionStore";
import {
  resolvePersistentSessionCognitionContext,
  stripRecentMessagesForPersistentSessionContext
} from "@/lib/brain/commercial/agent-session/resolvePersistentSessionCognitionContext";
import type { AgentSessionStore } from "@/lib/brain/commercial/agent-session/store";
import type { AgentSessionEvent } from "@/lib/brain/commercial/agent-session/types";

// SALES-AGENT-R3-V1.8-D5. Real MariaDB, real crm_test database - same
// convention as tests/commercial/loadPersistentSessionContext.test.ts (D3)
// and tests/commercial/runPersistentSessionShadow.test.ts (D4), which this
// resolver directly builds on. Covers task brief Section Q cases 1-4
// (read failure / lock timeout / invalid compacted metadata / derive
// failure -> legacy) plus the "no partial persistent prompt" contract
// (Section H): `active` is always a clean boolean.

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
    const externalContactId = `d5-cognition-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
      throw new Error("should not be called by the resolver");
    },
    appendEvent: () => {
      throw new Error("should not be called by the resolver");
    },
    loadSession: () => {
      throw new Error("should not be called by the resolver");
    },
    loadSessionForConversation: async () => {
      throw new Error("simulated_session_read_failure");
    },
    loadRecentEvents: async () => [],
    loadSummary: async () => null,
    rebuildSummary: () => {
      throw new Error("should not be called by the resolver");
    },
    persistCompactedPrefix: () => {
      throw new Error("should not be called by the resolver");
    }
  };
}

/** Q4: forces deriveMessages() itself to throw (a malformed event bypassing TS, the same way a real corrupted row could) - proves the resolver's outer try/catch wraps derive, not just the read. */
function malformedEventsStore(): AgentSessionStore {
  const fakeSession = (conversationId: number) => ({
    contractName: "AgentSession" as const,
    schemaVersion: "1.0" as const,
    id: "agsess_malformed",
    conversationId,
    status: "active" as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    compactedPrefixJson: null,
    compactedThroughSeq: null,
    compactedPrefixUpdatedAt: null
  });
  return {
    ensureSession: async (input) => fakeSession(input.conversationId),
    appendEvent: () => {
      throw new Error("should not be called by the resolver");
    },
    loadSession: () => {
      throw new Error("should not be called by the resolver");
    },
    loadSessionForConversation: async (conversationId) => fakeSession(conversationId),
    loadRecentEvents: async () => [null] as unknown as AgentSessionEvent[],
    loadSummary: async () => null,
    rebuildSummary: () => {
      throw new Error("should not be called by the resolver");
    },
    persistCompactedPrefix: () => {
      throw new Error("should not be called by the resolver");
    }
  };
}

// --- Not eligible / structurally impossible cases ---

test("[D5-R1] not enabled: always inactive, no warning at all", async () => {
  const conversationId = await ensureTestConversation();
  const result = await resolvePersistentSessionCognitionContext({
    enabled: false,
    conversationId,
    inboundMessageId: "123"
  });
  assert.deepEqual(result, { active: false, historicalMessages: null, fallbackWarning: null });
});

test("[D5-R2] enabled but no real inboundMessageId: inactive with a structured fallback warning", async () => {
  const conversationId = await ensureTestConversation();
  const result = await resolvePersistentSessionCognitionContext({
    enabled: true,
    conversationId,
    inboundMessageId: null
  });
  assert.equal(result.active, false);
  assert.equal(result.historicalMessages, null);
  assert.equal(result.fallbackWarning, "persistent_session_cognition_fallback:no_inbound_message_id");
});

// --- Q1/Q2: read failure / lock timeout -> legacy ---

test("[D5-Q1] a session read failure degrades to inactive with a fallback warning, never throws", async () => {
  const conversationId = await ensureTestConversation();
  const result = await resolvePersistentSessionCognitionContext({
    enabled: true,
    conversationId,
    inboundMessageId: "42",
    store: throwingStore()
  });
  assert.equal(result.active, false);
  assert.equal(result.historicalMessages, null);
  assert.ok(result.fallbackWarning?.startsWith("persistent_session_cognition_fallback:"));
  assert.ok(result.fallbackWarning?.includes("simulated_session_read_failure"));
});

// --- Q4: derive failure -> legacy ---

test("[D5-Q4] a derive-time exception (malformed event data) degrades to inactive, never throws out of the resolver", async () => {
  const conversationId = await ensureTestConversation();
  const result = await resolvePersistentSessionCognitionContext({
    enabled: true,
    conversationId,
    inboundMessageId: "42",
    store: malformedEventsStore()
  });
  assert.equal(result.active, false);
  assert.equal(result.historicalMessages, null);
  assert.ok(result.fallbackWarning?.startsWith("persistent_session_cognition_fallback:"));
});

// --- Real success path ---

test("[D5-R3] a real transcript resolves active:true with the real derived historical messages", async () => {
  const conversationId = await ensureTestConversation();
  const base = Date.parse("2026-08-31T09:00:00.000Z");
  const iso = (offsetMs: number) => new Date(base + offsetMs).toISOString().slice(0, 23).replace("T", " ");
  await insertTestMessage(conversationId, "inbound", "necesito una barra olimpica de 20kg", iso(0));
  await insertTestMessage(conversationId, "outbound", "tenemos la barra olimpica 20kg", iso(1000));
  const currentTurnId = await insertTestMessage(conversationId, "inbound", "me puedes dar varias opciones", iso(2000));

  const result = await resolvePersistentSessionCognitionContext({
    enabled: true,
    conversationId,
    inboundMessageId: String(currentTurnId)
  });
  assert.equal(result.active, true);
  assert.equal(result.fallbackWarning, null);
  if (!result.active) return;
  assert.deepEqual(result.historicalMessages, [
    { role: "user", content: "necesito una barra olimpica de 20kg" },
    { role: "assistant", content: "tenemos la barra olimpica 20kg" }
  ]);
});

// --- Q3: invalid compacted metadata -> valid persistent history without the compacted prefix (D3 contract) ---

test("[D5-Q3] a one-sided invalid compacted prefix still resolves active:true, just without the compacted-prefix message", async () => {
  const conversationId = await ensureTestConversation();
  const sessionStore = createMariaDbAgentSessionStore();
  const session = await sessionStore.ensureSession({ conversationId });
  await withConnection((connection) => connection.execute("UPDATE agent_sessions SET compacted_through_seq = ? WHERE id = ?", [3, session.id]));

  const base = Date.parse("2026-08-31T09:00:00.000Z");
  await insertTestMessage(conversationId, "inbound", "hola", new Date(base).toISOString().slice(0, 23).replace("T", " "));
  const currentTurnId = await insertTestMessage(conversationId, "inbound", "otra pregunta", new Date(base + 1000).toISOString().slice(0, 23).replace("T", " "));

  const result = await resolvePersistentSessionCognitionContext({
    enabled: true,
    conversationId,
    inboundMessageId: String(currentTurnId),
    store: sessionStore
  });
  assert.equal(result.active, true, "an invalid compacted-prefix pair degrades only that slot (D3's own contract), never the whole read");
  if (!result.active) return;
  assert.deepEqual(result.historicalMessages, [{ role: "user", content: "hola" }]);
});

// --- stripRecentMessagesForPersistentSessionContext (pure, Section D) ---

test("stripRecentMessagesForPersistentSessionContext removes only recentMessages, never mutates the input", () => {
  const original = {
    opportunityStatus: "open",
    needProfile: { useCase: "home gym" },
    recentMessages: [{ direction: "inbound", body: "hola" }]
  };
  const stripped = stripRecentMessagesForPersistentSessionContext(original);
  assert.deepEqual(stripped, { opportunityStatus: "open", needProfile: { useCase: "home gym" } });
  assert.ok(!("recentMessages" in stripped));
  assert.deepEqual(original.recentMessages, [{ direction: "inbound", body: "hola" }], "the source object is never mutated");
});

test("stripRecentMessagesForPersistentSessionContext is a no-op (structurally) when recentMessages is already absent", () => {
  const original = { opportunityStatus: "open" };
  assert.deepEqual(stripRecentMessagesForPersistentSessionContext(original), original);
});
