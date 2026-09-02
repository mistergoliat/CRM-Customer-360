import assert from "node:assert/strict";
import test, { after } from "node:test";
import { resetPoolForTests, withConnection } from "@/lib/db";
import { createMariaDbAgentSessionStore } from "@/lib/brain/commercial/agent-session/mariaDbAgentSessionStore";
import { runSessionCompactionIfEligible } from "@/lib/brain/commercial/agent-session/runSessionCompaction";
import { loadPersistentSessionContext } from "@/lib/brain/commercial/agent-session/loadPersistentSessionContext";
import { deriveConversationMessages } from "@/lib/brain/commercial/agent-session/deriveMessages";
import { createFakeAgentLoopProvider } from "@/lib/brain/commercial/agent-loop/providers/fakeAgentLoopProvider";
import type { AgentLoopProvider, AgentLoopProviderRequest } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";

// SALES-AGENT-R3-V1.8-D7. Real MariaDB, real crm_test database - same
// convention as loadPersistentSessionContext.test.ts. Proves the full
// orchestration (trigger -> split -> generate -> persist -> event) against
// real reads/writes, and the no-overlap/no-gap invariant (Section M) by
// round-tripping through the real read side (loadPersistentSessionContext +
// deriveConversationMessages), never asserted in isolation from it.
//
// conversation_message.id is a GLOBAL auto-increment (shared across every
// conversation in crm_test, including other tests' rows) - every assertion
// below compares against the REAL ids insertTestMessages() returns, never a
// hardcoded absolute number.

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
    const externalContactId = `d7-compaction-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const [result] = await connection.execute(
      `INSERT INTO conversation (public_id, channel, provider, channel_account_id, external_contact_id, status, owner_type)
       VALUES (?, 'whatsapp', 'meta', 'test_account', ?, 'open', 'ai_sdr')`,
      [publicId, externalContactId]
    );
    return (result as { insertId: number }).insertId;
  });
}

let nextOffsetSeconds = 0;

type InsertedTestMessage = { id: number; body: string };

/** Returns the real, DB-assigned ids AND bodies in insertion order (ascending, matching the real auto-increment - never assumed contiguous from 1). */
async function insertTestMessages(conversationId: number, count: number): Promise<InsertedTestMessage[]> {
  const inserted: InsertedTestMessage[] = [];
  await withConnection(async (connection) => {
    for (let i = 0; i < count; i += 1) {
      nextOffsetSeconds += 1;
      const publicId = crypto.randomUUID();
      const direction = inserted.length % 2 === 0 ? "inbound" : "outbound";
      const body = `turn-${nextOffsetSeconds}`;
      const createdAt = new Date(Date.UTC(2026, 7, 31, 10, 0, 0) + nextOffsetSeconds * 1000).toISOString().slice(0, 23).replace("T", " ");
      const [result] = await connection.execute(
        `INSERT INTO conversation_message (public_id, conversation_id, provider, direction, sender_type, message_type, body, status, created_at)
         VALUES (?, ?, 'meta', ?, 'customer', 'text', ?, 'received', ?)`,
        [publicId, conversationId, direction, body, createdAt]
      );
      inserted.push({ id: (result as { insertId: number }).insertId, body });
    }
  });
  return inserted;
}

function scriptedProvider(summaries: string[]): { provider: AgentLoopProvider; requests: AgentLoopProviderRequest[] } {
  const requests: AgentLoopProviderRequest[] = [];
  const inner = createFakeAgentLoopProvider({ script: summaries.map((summaryText) => ({ summaryText })) });
  return {
    requests,
    provider: {
      name: inner.name,
      version: inner.version,
      async invoke(request, options) {
        requests.push(request);
        return inner.invoke(request, options);
      }
    }
  };
}

test("[D7-O1] below threshold: does not run, no prefix written", async () => {
  const conversationId = await ensureTestConversation();
  const store = createMariaDbAgentSessionStore();
  await store.ensureSession({ conversationId });
  await insertTestMessages(conversationId, 10);
  const { provider } = scriptedProvider(["should not be called"]);

  const result = await runSessionCompactionIfEligible({
    conversationId,
    correlationId: "corr-1",
    maxRawMessages: 40,
    targetRecentMessages: 20,
    sessionStore: store,
    provider
  });
  assert.deepEqual(result, { ran: false, reason: "below_threshold" });

  const session = await store.loadSessionForConversation(conversationId);
  assert.equal(session?.compactedThroughSeq, null);
});

test("[D7-O2] no session yet: does not run", async () => {
  const conversationId = await ensureTestConversation();
  await insertTestMessages(conversationId, 50);
  const store = createMariaDbAgentSessionStore();
  const { provider } = scriptedProvider(["x"]);

  const result = await runSessionCompactionIfEligible({
    conversationId,
    correlationId: "corr-2",
    maxRawMessages: 40,
    targetRecentMessages: 20,
    sessionStore: store,
    provider
  });
  assert.deepEqual(result, { ran: false, reason: "no_session" });
});

test("[D7-O3] first compaction: persists a real prefix, no-overlap/no-gap proven through the real read side", async () => {
  const conversationId = await ensureTestConversation();
  const store = createMariaDbAgentSessionStore();
  await store.ensureSession({ conversationId });
  const rows = await insertTestMessages(conversationId, 45); // 45 messages, ascending real ids

  const { provider } = scriptedProvider(["resumen de los turnos 1 a 25"]);
  const result = await runSessionCompactionIfEligible({
    conversationId,
    correlationId: "corr-3",
    maxRawMessages: 40,
    targetRecentMessages: 20,
    sessionStore: store,
    provider
  });
  assert.deepEqual(result, { ran: true, persisted: true });

  const expectedCutoffId = rows[24].id; // 45 - 20 target recent = compact the first 25
  const session = await store.loadSessionForConversation(conversationId);
  assert.equal(session?.compactedThroughSeq, expectedCutoffId);
  assert.deepEqual(session?.compactedPrefixJson, { schemaVersion: 1, summaryText: "resumen de los turnos 1 a 25" });

  // Round-trip through the real read side: the compacted-covered rows must
  // never appear again, and every row after the cutoff must appear exactly
  // once (Section M - no overlap, no gap).
  const context = await loadPersistentSessionContext({ conversationId, store });
  assert.ok(context.ok);
  const derivedMessages = deriveConversationMessages({
    transcriptMessages: context.ok ? context.transcriptMessages : [],
    compactedPrefix: context.ok ? context.compactedPrefix : null,
    currentInboundMessageId: null
  });
  assert.equal(derivedMessages[0].role, "system");
  assert.ok(derivedMessages[0].content.includes("resumen de los turnos 1 a 25"));
  const rawMessages = derivedMessages.slice(1);
  assert.equal(rawMessages.length, 20); // exactly the last 20 raw messages
  assert.deepEqual(
    rawMessages.map((m) => m.content),
    rows.slice(25).map((r) => r.body)
  );
});

test("[D7-O4] incremental compaction: second round covers the new range and merges the previous summary, never re-reading the already-compacted range", async () => {
  const conversationId = await ensureTestConversation();
  const store = createMariaDbAgentSessionStore();
  await store.ensureSession({ conversationId });
  const firstBatch = await insertTestMessages(conversationId, 45);

  const { provider: firstProvider } = scriptedProvider(["A: resumen 1-25"]);
  await runSessionCompactionIfEligible({
    conversationId,
    correlationId: "corr-4a",
    maxRawMessages: 40,
    targetRecentMessages: 20,
    sessionStore: store,
    provider: firstProvider
  });
  const firstCutoffId = firstBatch[24].id;

  const secondBatch = await insertTestMessages(conversationId, 20); // uncompacted = 45 - 25 + 20 = 40, still not > 40

  const secondScript = scriptedProvider(["A + 26-45: resumen extendido"]);
  const belowThreshold = await runSessionCompactionIfEligible({
    conversationId,
    correlationId: "corr-4b",
    maxRawMessages: 40,
    targetRecentMessages: 20,
    sessionStore: store,
    provider: secondScript.provider
  });
  assert.deepEqual(belowThreshold, { ran: false, reason: "below_threshold" });

  const thirdBatch = await insertTestMessages(conversationId, 1); // now 41 uncompacted, eligible
  const secondResult = await runSessionCompactionIfEligible({
    conversationId,
    correlationId: "corr-4c",
    maxRawMessages: 40,
    targetRecentMessages: 20,
    sessionStore: store,
    provider: secondScript.provider
  });
  assert.deepEqual(secondResult, { ran: true, persisted: true });

  // Round 1 left firstBatch's own last 20 messages (indices 25..44) as an
  // uncompacted "recent tail" - task brief Section P's own worked example
  // ("new compaction input: previous compacted prefix + raw 31..50",
  // i.e. the OLD recent tail is part of the NEXT round's input, not
  // discarded). Uncompacted going into round 2 = firstBatch[25..44] (20) +
  // secondBatch (20) + thirdBatch (1) = 41; compacting the first 21 of those
  // (41 - 20 target recent) lands the new cutoff on secondBatch's first row.
  const expectedNewCutoffId = secondBatch[0].id;
  const session = await store.loadSessionForConversation(conversationId);
  assert.equal(session?.compactedThroughSeq, expectedNewCutoffId);
  assert.deepEqual(session?.compactedPrefixJson, { schemaVersion: 1, summaryText: "A + 26-45: resumen extendido" });
  assert.ok(expectedNewCutoffId > firstCutoffId);

  // The previous summary text was handed to the model (incremental, never
  // re-summarizing the already-compacted range from scratch).
  assert.equal(secondScript.requests.length, 1);
  const systemMessages = secondScript.requests[0].messages.filter((m) => m.role === "system");
  assert.ok(systemMessages.some((m) => m.content.includes("A: resumen 1-25")));
  // Only the new range's bodies were sent as real turns, never the first batch's.
  const userAssistantMessages = secondScript.requests[0].messages.filter((m) => m.role === "user" || m.role === "assistant");
  assert.ok(!userAssistantMessages.some((m) => m.content === firstBatch[0].body));
});

test("[D7-O5] generation failure leaves the existing prefix untouched, never a partial write", async () => {
  const conversationId = await ensureTestConversation();
  const store = createMariaDbAgentSessionStore();
  await store.ensureSession({ conversationId });
  await insertTestMessages(conversationId, 45);

  const failingProvider: AgentLoopProvider = {
    name: "failing",
    async invoke() {
      throw new Error("simulated_model_timeout");
    }
  };

  const result = await runSessionCompactionIfEligible({
    conversationId,
    correlationId: "corr-5",
    maxRawMessages: 40,
    targetRecentMessages: 20,
    sessionStore: store,
    provider: failingProvider
  });
  assert.equal(result.ran, true);
  assert.equal(result.ran && !result.persisted && result.warning.includes("generation_failed"), true);

  const session = await store.loadSessionForConversation(conversationId);
  assert.equal(session?.compactedThroughSeq, null);
});

test("[D7-O6] a malformed existing compacted prefix degrades to treating the whole window as uncompacted, never crashes", async () => {
  const conversationId = await ensureTestConversation();
  const store = createMariaDbAgentSessionStore();
  const session = await store.ensureSession({ conversationId });
  const rows = await insertTestMessages(conversationId, 45);
  // Directly corrupt the stored content (bypassing the store's own writer) -
  // simulates a malformed row from an earlier/incompatible schema.
  await withConnection((connection) =>
    connection.execute("UPDATE agent_sessions SET compacted_prefix_json = ?, compacted_through_seq = ? WHERE id = ?", [
      JSON.stringify({ note: "pre-D7 shape" }),
      rows[9].id,
      session.id
    ])
  );

  const { provider } = scriptedProvider(["resumen real"]);
  const result = await runSessionCompactionIfEligible({
    conversationId,
    correlationId: "corr-6",
    maxRawMessages: 40,
    targetRecentMessages: 20,
    sessionStore: store,
    provider
  });
  assert.deepEqual(result, { ran: true, persisted: true });

  const reloaded = await store.loadSessionForConversation(conversationId);
  // Cutoff computed over the FULL 45-message window (malformed prior prefix
  // ignored entirely), same split as a from-scratch first compaction.
  assert.equal(reloaded?.compactedThroughSeq, rows[24].id);
});

test("[D7-O7] a concurrent compaction that lands mid-flight (during this run's own model call) is never overwritten - discarded safely, not an error path", async () => {
  const conversationId = await ensureTestConversation();
  const store = createMariaDbAgentSessionStore();
  await store.ensureSession({ conversationId });
  const rows = await insertTestMessages(conversationId, 65); // uncompacted=65, comfortably above the 40 threshold

  const session = await store.loadSessionForConversation(conversationId);
  const concurrentCutoffId = rows[50].id; // ahead of this run's own computed cutoff (rows[44].id, see below)

  // Section K's real race: "release DB lock, run compaction model, persist."
  // This provider simulates another worker's compaction landing WHILE this
  // run's own model call is in flight - the only realistic point a genuine
  // race can occur, since this module never holds a lock across the model
  // call (Section K/appendWithRetry precedent).
  const provider: AgentLoopProvider = {
    name: "racing-provider",
    async invoke() {
      await store.persistCompactedPrefix({
        sessionId: session!.id,
        throughSeq: concurrentCutoffId,
        prefixJson: { schemaVersion: 1, summaryText: "already ahead" }
      });
      return { rawOutput: { summaryText: "stale attempt" }, model: "fake", inputTokens: 1, outputTokens: 1, providerRequestId: "racing-1", finishReason: "stop" };
    }
  };

  const result = await runSessionCompactionIfEligible({
    conversationId,
    correlationId: "corr-7",
    maxRawMessages: 40,
    targetRecentMessages: 20,
    sessionStore: store,
    provider
  });
  assert.equal(result.ran, true);
  assert.equal(result.ran && !result.persisted, true);
  assert.equal(result.ran && !result.persisted && result.warning, "superseded_by_newer_compaction");

  const reloaded = await store.loadSessionForConversation(conversationId);
  assert.equal(reloaded?.compactedThroughSeq, concurrentCutoffId);
  assert.deepEqual(reloaded?.compactedPrefixJson, { schemaVersion: 1, summaryText: "already ahead" });
});
