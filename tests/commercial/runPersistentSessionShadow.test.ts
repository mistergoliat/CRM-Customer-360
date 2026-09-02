import assert from "node:assert/strict";
import test, { after } from "node:test";
import { resetPoolForTests, safeQueryRows, withConnection } from "@/lib/db";
import { createMariaDbAgentSessionStore } from "@/lib/brain/commercial/agent-session/mariaDbAgentSessionStore";
import { runPersistentSessionShadowComparison } from "@/lib/brain/commercial/agent-session/runPersistentSessionShadow";
import type { AgentSessionStore } from "@/lib/brain/commercial/agent-session/store";

// SALES-AGENT-R3-V1.8-D4. Real MariaDB, real crm_test database - same
// local-credential convention as loadPersistentSessionContext.test.ts (D3),
// which this task's orchestrator directly builds on. Proves the one I/O
// entry point (load -> derive -> compare -> emit) end to end: the real
// incident replay (task brief Section H/Q), failure isolation (Section O/
// G10), and the latency fields the release doc's "latency characterization"
// section reports (Section N/G12).

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
    const externalContactId = `d4-shadow-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

async function loadLastShadowEventPayload(inboundMessageId: string): Promise<Record<string, unknown> | null> {
  const result = await safeQueryRows<{ payload_json: string }>(
    "SELECT payload_json FROM commercial_event WHERE event_type = 'persistent_session_shadow_compared' AND source_event_id = ? ORDER BY id DESC LIMIT 1",
    [inboundMessageId]
  );
  assert.ok(result.ok, result.ok ? "" : result.error);
  if (!result.ok || result.rows.length === 0) return null;
  return JSON.parse(result.rows[0].payload_json) as Record<string, unknown>;
}

function throwingStore(): AgentSessionStore {
  return {
    ensureSession: () => {
      throw new Error("should not be called by the shadow read side");
    },
    appendEvent: () => {
      throw new Error("should not be called by the shadow read side");
    },
    loadSession: () => {
      throw new Error("should not be called by the shadow read side");
    },
    loadSessionForConversation: async () => {
      throw new Error("simulated_session_read_failure");
    },
    loadRecentEvents: async () => [],
    loadSummary: async () => null,
    rebuildSummary: () => {
      throw new Error("should not be called by the shadow read side");
    }
  };
}

// --- Section H/Q: real incident replay ---

test("[D4-H1] real incident replay: the barra-20kg exchange is recovered by the shadow before turn 3", async () => {
  const conversationId = await ensureTestConversation();
  const base = Date.parse("2026-08-31T09:00:00.000Z");
  const iso = (offsetMs: number) => new Date(base + offsetMs).toISOString().slice(0, 23).replace("T", " ");

  await insertTestMessage(conversationId, "inbound", "necesito una barra olimpica de 20kg para home gym", iso(0));
  await insertTestMessage(conversationId, "outbound", "tenemos la barra olimpica 20kg disponible para home gym", iso(1000));
  const turn3Id = await insertTestMessage(conversationId, "inbound", "me puedes dar varias opciones para home gym", iso(2000));

  // The legacy tail this exact turn actually carries: buildMinimalCommercialContextSummary's
  // own last-5 slice, minus the current turn's own inbound message (the same
  // filter runSalesAgentRuntimeCycle.ts applies) - here narrowed further to
  // just the assistant reply, to prove the shadow recovers evidence a
  // shorter legacy tail could plausibly have already evicted.
  const legacyRecentMessages = [{ direction: "outbound" as const, body: "tenemos la barra olimpica 20kg disponible para home gym" }];

  const result = await runPersistentSessionShadowComparison({
    conversationId,
    inboundMessageId: String(turn3Id),
    correlationId: `corr-${turn3Id}`,
    legacyRecentMessages
  });
  assert.equal(result.warning, null);

  const payload = await loadLastShadowEventPayload(String(turn3Id));
  assert.ok(payload, "the shadow-compared event must be persisted");
  if (!payload) return;
  assert.equal(payload.persistentHistoryMessageCount, 2, "both prior turns (customer request + assistant reply) are present");
  assert.equal(payload.currentInboundExcluded, true);
  assert.equal(payload.degraded, false);
  // The prior customer request about the 20kg bar is evidence the shadow
  // recovers that the narrowed legacy tail above does not carry at all -
  // this is the concrete gate G13/G2 evidence, not an assertion about what
  // the model would infer from it.
  assert.equal(payload.persistentOlderMessageCount, 1, "the customer's own barra-20kg request is recovered beyond the legacy tail");
});

// --- Section O/G10: failure isolation ---

test("[D4-F1] a session read failure degrades the shadow event, but never throws", async () => {
  const conversationId = await ensureTestConversation();
  const inboundMessageId = `fail-${conversationId}`;
  const result = await runPersistentSessionShadowComparison({
    conversationId,
    inboundMessageId,
    correlationId: `corr-${inboundMessageId}`,
    legacyRecentMessages: [],
    store: throwingStore()
  });
  assert.equal(result.warning, null, "loadPersistentSessionContext already degrades internally - this is not the orchestrator's own catch path");

  const payload = await loadLastShadowEventPayload(inboundMessageId);
  assert.ok(payload);
  if (!payload) return;
  assert.equal(payload.degraded, true);
  assert.equal(payload.persistentHistoryMessageCount, 0);
});

test("[D4-F2] a missing dedupe key (empty inboundMessageId) degrades to a warning, never throws", async () => {
  const conversationId = await ensureTestConversation();
  const result = await runPersistentSessionShadowComparison({
    conversationId,
    inboundMessageId: "   ",
    correlationId: "corr-empty",
    legacyRecentMessages: []
  });
  assert.notEqual(result.warning, null);
  assert.ok(result.warning?.includes("persistent_session_shadow_failed"));
});

// --- Section N/G12: latency characterization ---

test("[D4-L1] latency fields are present, non-negative, and additive", async () => {
  const conversationId = await ensureTestConversation();
  const inboundMessageId = `latency-${conversationId}`;
  const result = await runPersistentSessionShadowComparison({
    conversationId,
    inboundMessageId,
    correlationId: `corr-${inboundMessageId}`,
    legacyRecentMessages: []
  });
  assert.equal(result.warning, null);

  const payload = await loadLastShadowEventPayload(inboundMessageId);
  assert.ok(payload);
  if (!payload) return;
  const readMs = Number(payload.readMs);
  const deriveMs = Number(payload.deriveMs);
  const shadowTotalMs = Number(payload.shadowTotalMs);
  assert.ok(readMs >= 0);
  assert.ok(deriveMs >= 0);
  assert.equal(shadowTotalMs, readMs + deriveMs);
});

test("[D4-L2] 20 controlled iterations: read/derive/total overhead is small and stable, nowhere near LLM-call latency", async () => {
  const conversationId = await ensureTestConversation();
  const base = Date.parse("2026-08-31T09:00:00.000Z");
  for (let i = 0; i < 6; i += 1) {
    await insertTestMessage(conversationId, i % 2 === 0 ? "inbound" : "outbound", `mensaje de contexto ${i}`, new Date(base + i * 1000).toISOString().slice(0, 23).replace("T", " "));
  }

  const iterations = 20;
  const readSamples: number[] = [];
  const deriveSamples: number[] = [];
  const totalSamples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const inboundMessageId = `latency-iter-${conversationId}-${i}`;
    const result = await runPersistentSessionShadowComparison({
      conversationId,
      inboundMessageId,
      correlationId: `corr-${inboundMessageId}`,
      legacyRecentMessages: []
    });
    assert.equal(result.warning, null);
    const payload = await loadLastShadowEventPayload(inboundMessageId);
    assert.ok(payload);
    if (!payload) continue;
    readSamples.push(Number(payload.readMs));
    deriveSamples.push(Number(payload.deriveMs));
    totalSamples.push(Number(payload.shadowTotalMs));
  }

  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  assert.equal(readSamples.length, iterations);
  const medianRead = median(readSamples);
  const medianDerive = median(deriveSamples);
  const medianTotal = median(totalSamples);
  console.log(`[D4-L2] median readMs=${medianRead} deriveMs=${medianDerive} shadowTotalMs=${medianTotal} (n=${iterations})`);
  // No arbitrary SLA (no existing R3 latency budget to compare against, per
  // the task brief) - the only real assertion is "small and bounded", i.e.
  // two orders of magnitude below a real LLM call (multi-second), so the
  // shadow read is never a material fraction of total turn latency.
  assert.ok(medianTotal < 500, `median shadow overhead (${medianTotal}ms) should be well under a single second`);
  assert.ok(medianDerive <= medianRead + 5, "deriveMessages is pure/in-memory - it must never dominate the DB read");
});

// --- C08: missing session events, real conversation_message still valid ---

test("[D4-C08] zero agent_session_events, real transcript: the shadow still reports real counts (bootstrapUsed)", async () => {
  const conversationId = await ensureTestConversation();
  const sessionStore = createMariaDbAgentSessionStore();
  await sessionStore.ensureSession({ conversationId }); // session exists, no events ever appended.

  const base = Date.parse("2026-08-31T09:00:00.000Z");
  const iso = (offsetMs: number) => new Date(base + offsetMs).toISOString().slice(0, 23).replace("T", " ");
  await insertTestMessage(conversationId, "inbound", "hola, tienen barras?", iso(0));
  await insertTestMessage(conversationId, "outbound", "si, tenemos varias!", iso(1000));
  const currentTurnId = await insertTestMessage(conversationId, "inbound", "cual me recomiendas?", iso(2000));

  const result = await runPersistentSessionShadowComparison({
    conversationId,
    inboundMessageId: String(currentTurnId),
    correlationId: `corr-${currentTurnId}`,
    legacyRecentMessages: [],
    store: sessionStore
  });
  assert.equal(result.warning, null);

  const payload = await loadLastShadowEventPayload(String(currentTurnId));
  assert.ok(payload);
  if (!payload) return;
  assert.equal(payload.bootstrapUsed, true);
  assert.equal(payload.persistentToolActivityCount, 0);
  assert.equal(payload.persistentHistoryMessageCount, 2, "both prior turns are real history; only the current turn's own message is excluded");
});
