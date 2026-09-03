import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { getPool, safeQueryRows } from "@/lib/db";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";
import { upsertPendingTurn, runTurnSettleTick, claimPendingTurn } from "@/lib/brain/commercial/turn-settlement";
import type { TurnSettlementRow } from "@/lib/brain/commercial/turn-settlement/types";
import type { AgentLoopProvider, AgentLoopProviderRequest } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";
import type { MetaTypingIndicatorRequest, MetaTypingIndicatorResponse } from "@/lib/brain/messaging/metaClient";

/**
 * SALES-AGENT-R3-V1.8.1. Real MariaDB (crm_test), fake LLM provider (no real
 * DeepSeek cost/flakiness in this suite - real-provider validation lives
 * separately, see the release doc's Section X/real-provider benchmark).
 *
 * Coverage: T1 (delay=0 exact current behavior), T3 (rapid fragments -> one
 * cognitive execution, joined content), T8 (history excludes the settled
 * turn's own fragments, aggregate appears exactly once), T9 (newer inbound
 * mid-cognition suppresses stale dispatch), T12/T13/T14 (typing indicator
 * enabled/disabled/failure-isolated), T15 (access gate still enforced).
 */

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "crm_test",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true",
  BRAIN_META_SEND_ENABLED: "false",
  BRAIN_OUTBOX_WORKER_ENABLED: "false",
  BRAIN_R3_INBOUND_TURN_SETTLE_DELAY_MS: "0"
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

async function withEnv<T>(overrides: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const previous = { ...process.env };
  Object.assign(process.env, overrides);
  try {
    return await fn();
  } finally {
    process.env = previous;
  }
}

const LEGACY_RUNTIME_OFF = {
  BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED: "false",
  BRAIN_MULTI_REQUEST_RUNTIME_ENABLED: "false",
  BRAIN_AGENT_TOOL_LOOP_ENABLED: "false",
  BRAIN_MULTI_INTENT_PLANNER_ENABLED: "false",
  BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED: "false"
};

function r3PilotEnv(waId: string) {
  return {
    ...LEGACY_RUNTIME_OFF,
    BRAIN_SALES_AGENT_RUNTIME_ENABLED: "true",
    BRAIN_SALES_AGENT_RUNTIME_WA_IDS: waId,
    BRAIN_AUTONOMOUS_TEST_WA_IDS: waId,
    BRAIN_WHATSAPP_TEST_MODE_ENABLED: "false",
    BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true"
  };
}

async function insertConversation(): Promise<{ id: number; publicId: string; waId: string }> {
  const publicId = `conv-turnsettle-e2e-${randomUUID().slice(0, 8)}`;
  const waId = `5699${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 15);
  const [result] = await getPool().execute(
    `INSERT INTO conversation (public_id, channel, provider, channel_account_id, external_contact_id, status, owner_type, ai_enabled, human_owner_active)
     VALUES (?, 'whatsapp', 'meta', ?, ?, 'open', 'ai_sdr', 1, 0)`,
    [publicId, `phone-${randomUUID().slice(0, 8)}`, waId]
  );
  return { id: Number((result as { insertId: number }).insertId), publicId, waId };
}

async function insertInboundMessage(conversationId: number, body: string, providerMessageId: string): Promise<number> {
  const [result] = await getPool().execute(
    `INSERT INTO conversation_message (public_id, conversation_id, provider, provider_message_id, direction, sender_type, message_type, body, status)
     VALUES (?, ?, 'meta', ?, 'inbound', 'customer', 'text', ?, 'received')`,
    [randomUUID(), conversationId, providerMessageId, body]
  );
  return Number((result as { insertId: number }).insertId);
}

async function insertOutboundMessage(conversationId: number, body: string): Promise<void> {
  await getPool().execute(
    `INSERT INTO conversation_message (public_id, conversation_id, provider, direction, sender_type, message_type, body, status)
     VALUES (?, ?, 'meta', 'outbound', 'agent', 'text', ?, 'sent')`,
    [randomUUID(), conversationId, body]
  );
}

/** Simulates the webhook's own upsertPendingTurn call, once per fragment, exactly as service.ts does when delay > 0. */
async function settleFragments(input: {
  conversationId: number;
  waId: string;
  phoneNumberId: string;
  fragments: Array<{ messageId: number; providerMessageId: string }>;
  settleDelayMs?: number;
  maxSettleMs?: number;
}): Promise<void> {
  for (const fragment of input.fragments) {
    const upserted = await upsertPendingTurn({
      conversationId: input.conversationId,
      waId: input.waId,
      phoneNumberId: input.phoneNumberId,
      inboundMessageId: fragment.messageId,
      providerMessageId: fragment.providerMessageId,
      correlationId: `corr-${fragment.messageId}`,
      settleDelayMs: input.settleDelayMs ?? 0,
      maxSettleMs: input.maxSettleMs ?? 5000
    });
    assert.equal(upserted.ok, true);
  }
}

async function loadTurnRow(conversationId: number): Promise<TurnSettlementRow> {
  const result = await safeQueryRows<TurnSettlementRow>(
    "SELECT * FROM crm_inbound_turn_settlements WHERE conversation_id = ? ORDER BY id DESC LIMIT 1",
    [conversationId]
  );
  assert.ok(result.ok && result.rows[0]);
  return result.rows[0];
}

async function loadCognitionAppliedPayload(inboundMessageId: string): Promise<{ active: boolean; historyMessageCount: number } | null> {
  const result = await safeQueryRows<{ payload_json: string }>(
    "SELECT payload_json FROM commercial_event WHERE event_type = 'persistent_session_cognition_applied' AND source_event_id = ? ORDER BY id DESC LIMIT 1",
    [inboundMessageId]
  );
  if (!result.ok || result.rows.length === 0) return null;
  return JSON.parse(result.rows[0].payload_json);
}

async function outboxRowCountForWaId(waId: string): Promise<number> {
  const result = await safeQueryRows<{ count: number }>("SELECT COUNT(*) AS count FROM brain_message_outbox WHERE wa_id = ?", [waId]);
  return result.ok ? Number(result.rows[0]?.count ?? 0) : -1;
}

/** Captures every request the fake model receives, then always responds with `message`. */
function capturingRespondProvider(message: string): { provider: AgentLoopProvider; requests: AgentLoopProviderRequest[] } {
  const requests: AgentLoopProviderRequest[] = [];
  return {
    requests,
    provider: {
      name: "capturing-fake-provider",
      async invoke(request) {
        requests.push(request);
        return {
          rawOutput: { type: "respond", message },
          model: "fake-model",
          inputTokens: 16,
          outputTokens: 16,
          providerRequestId: `fake-${requests.length}`,
          finishReason: "stop"
        };
      }
    }
  };
}

const NEVER_CALLED_PROVIDER: AgentLoopProvider = {
  name: "must-not-be-called",
  async invoke() {
    throw new Error("must not be invoked");
  }
};

const NEVER_CALLED_TYPING = async (): Promise<MetaTypingIndicatorResponse> => {
  throw new Error("typing must not be called when disabled");
};

test("[T1/G1/G17] delay=0 (default) never creates a pending-turn row - cognition runs the exact pre-V1.8.1 synchronous path", async () => {
  const conversation = await insertConversation();
  await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${randomUUID()}`,
    phoneNumberId: "phone-turnsettle-e2e",
    externalSenderId: conversation.waId,
    senderPhone: conversation.waId,
    senderName: "Cliente Turn Settle",
    messageType: "text",
    text: "hola",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });

  const rows = await safeQueryRows<TurnSettlementRow>("SELECT * FROM crm_inbound_turn_settlements WHERE wa_id = ?", [conversation.waId]);
  assert.equal(rows.ok && rows.rows.length, 0, "delay=0 must never allocate a pending-turn row (Section D rollback path)");
});

test("[T3/G2/G3] three rapid fragments settle into one cognitive execution with joined content, in order, canonical messages untouched", async () => {
  const conversation = await insertConversation();
  const fragments = [
    { text: "hola", providerMessageId: `wamid.${randomUUID()}` },
    { text: "como", providerMessageId: `wamid.${randomUUID()}` },
    { text: "estas", providerMessageId: `wamid.${randomUUID()}` }
  ];
  const messageIds: number[] = [];
  for (const fragment of fragments) {
    messageIds.push(await insertInboundMessage(conversation.id, fragment.text, fragment.providerMessageId));
  }
  await settleFragments({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-e2e",
    fragments: fragments.map((fragment, index) => ({ messageId: messageIds[index], providerMessageId: fragment.providerMessageId }))
  });

  // runTurnSettleTick sweeps every due row in crm_test, not just this
  // conversation's - assertions below are scoped to this conversation's own
  // provider instance and turn row, never to the tick's global counters.
  const captured = capturingRespondProvider("Hola! Bien, gracias.");
  await withEnv(r3PilotEnv(conversation.waId), async () => {
    await runTurnSettleTick({ agentLoopProvider: captured.provider });
  });

  assert.equal(captured.requests.length, 1, "the model must be invoked exactly once for the whole aggregated turn, not once per fragment");
  const finalUserMessage = captured.requests[0].messages[captured.requests[0].messages.length - 1];
  const parsedPayload = JSON.parse(finalUserMessage.content) as { customerMessage: string };
  assert.equal(parsedPayload.customerMessage, "hola\ncomo\nestas", "fragments must be joined in arrival order, one boundary per fragment");

  // Canonical transcript (Section B) must be untouched - the three original
  // rows still exist, individually, exactly as persisted.
  const canonical = await safeQueryRows<{ body: string }>(
    "SELECT body FROM conversation_message WHERE conversation_id = ? AND direction = 'inbound' ORDER BY id ASC",
    [conversation.id]
  );
  assert.deepEqual(canonical.ok ? canonical.rows.map((row) => row.body) : [], ["hola", "como", "estas"]);

  const turnRow = await loadTurnRow(conversation.id);
  assert.equal(turnRow.status, "COMPLETED");
  assert.equal(turnRow.fragment_count, 3);
});

test("[T8/G4/J] history excludes every fragment of the settled turn - a later turn sees them exactly once, as real history, never duplicated", async () => {
  const conversation = await insertConversation();
  await insertInboundMessage(conversation.id, "mensaje historico previo", `wamid.${randomUUID()}`);
  await insertOutboundMessage(conversation.id, "respuesta historica previa");

  const fragmentTexts = ["quiero una barra", "olimpica de 20kg"];
  const fragmentIds: number[] = [];
  const fragmentProviderIds: string[] = [];
  for (const text of fragmentTexts) {
    const providerMessageId = `wamid.${randomUUID()}`;
    fragmentIds.push(await insertInboundMessage(conversation.id, text, providerMessageId));
    fragmentProviderIds.push(providerMessageId);
  }
  await settleFragments({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-e2e",
    fragments: fragmentIds.map((id, index) => ({ messageId: id, providerMessageId: fragmentProviderIds[index] }))
  });

  const captured = capturingRespondProvider("Claro, tenemos esa barra disponible.");
  await withEnv(r3PilotEnv(conversation.waId), async () => {
    await runTurnSettleTick({ agentLoopProvider: captured.provider });
  });

  const latestFragmentId = fragmentIds[fragmentIds.length - 1];
  const payload = await loadCognitionAppliedPayload(String(latestFragmentId));
  assert.ok(payload, "a persistent_session_cognition_applied event must be recorded for the settled turn");
  assert.equal(payload!.active, true);
  assert.equal(payload!.historyMessageCount, 2, "only the two REAL prior turns count as history - the settled turn's own two fragments must be fully excluded, never counted as history");
});

test("[T9/G8/K] a newer inbound message arriving during cognition suppresses the stale dispatch and marks the turn SUPERSEDED", async () => {
  const conversation = await insertConversation();
  const providerMessageId = `wamid.${randomUUID()}`;
  const messageId = await insertInboundMessage(conversation.id, "quiero la barra de 20kg", providerMessageId);
  await settleFragments({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-e2e",
    fragments: [{ messageId, providerMessageId }]
  });

  let newerMessageId: number | null = null;
  const midCognitionProvider: AgentLoopProvider = {
    name: "mid-cognition-race-provider",
    async invoke() {
      // Simulates "espera, mejor la de 15kg" arriving from Meta WHILE this
      // model call is in flight (Section K's own example).
      newerMessageId = await insertInboundMessage(conversation.id, "mejor la de 15kg", `wamid.${randomUUID()}`);
      return {
        rawOutput: { type: "respond", message: "Perfecto, la barra de 20kg cuesta $50.000" },
        model: "fake-model",
        inputTokens: 16,
        outputTokens: 16,
        providerRequestId: "fake-race-1",
        finishReason: "stop"
      };
    }
  };

  await withEnv(r3PilotEnv(conversation.waId), async () => {
    await runTurnSettleTick({ agentLoopProvider: midCognitionProvider });
  });

  const turnRow = await loadTurnRow(conversation.id);
  assert.equal(turnRow.status, "SUPERSEDED", "this conversation's turn row must land on SUPERSEDED, never COMPLETED, once a newer inbound raced in mid-cognition");
  assert.equal(turnRow.superseded_by_message_id, newerMessageId);

  const outboxCount = await outboxRowCountForWaId(conversation.waId);
  assert.equal(outboxCount, 0, "the stale response must never reach brain_message_outbox - no duplicate/incorrect send");
});

test("[T15/Q] a wa_id NOT authorized for R3 never reaches the model, even through the settle-worker path - the turn still completes cleanly (not stuck)", async () => {
  const conversation = await insertConversation();
  const providerMessageId = `wamid.${randomUUID()}`;
  const messageId = await insertInboundMessage(conversation.id, "hola", providerMessageId);
  await settleFragments({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-e2e",
    fragments: [{ messageId, providerMessageId }]
  });

  await withEnv(
    {
      ...r3PilotEnv("56900000000" /* different waId than conversation.waId */)
    },
    async () => {
      await runTurnSettleTick({ agentLoopProvider: NEVER_CALLED_PROVIDER });
    }
  );

  const turnRow = await loadTurnRow(conversation.id);
  assert.equal(turnRow.status, "COMPLETED");
});

test("[T12/M/P] typing enabled: the typing/read call fires after settle, before the model responds, targeting the latest fragment's provider message id", async () => {
  const conversation = await insertConversation();
  const providerMessageId = `wamid.${randomUUID()}`;
  const messageId = await insertInboundMessage(conversation.id, "hola", providerMessageId);
  await settleFragments({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-e2e",
    fragments: [{ messageId, providerMessageId }]
  });

  const callOrder: string[] = [];
  const typingCalls: MetaTypingIndicatorRequest[] = [];
  const postTyping = async (input: MetaTypingIndicatorRequest): Promise<MetaTypingIndicatorResponse> => {
    callOrder.push("typing");
    typingCalls.push(input);
    return { ok: true, status: "sent", error_code: null, error_message: null, http_status: 200 };
  };
  const provider: AgentLoopProvider = {
    name: "order-tracking-provider",
    async invoke() {
      callOrder.push("model");
      return {
        rawOutput: { type: "respond", message: "Hola!" },
        model: "fake-model",
        inputTokens: 8,
        outputTokens: 8,
        providerRequestId: "fake-order-1",
        finishReason: "stop"
      };
    }
  };

  await withEnv({ ...r3PilotEnv(conversation.waId), BRAIN_WHATSAPP_TYPING_INDICATOR_ENABLED: "true" }, async () => {
    await runTurnSettleTick({ agentLoopProvider: provider, postTyping });
  });

  assert.deepEqual(callOrder, ["typing", "model"], "typing must be requested after settle, before the model call completes");
  assert.equal(typingCalls.length, 1);
  assert.equal(typingCalls[0].phoneNumberId, "phone-turnsettle-e2e");
  assert.equal(typingCalls[0].messageId, providerMessageId, "typing must target the latest fragment's Meta wamid, never conversation_message.id");
});

test("[T13] typing disabled (default): no typing/read call is made at all", async () => {
  const conversation = await insertConversation();
  const providerMessageId = `wamid.${randomUUID()}`;
  const messageId = await insertInboundMessage(conversation.id, "hola", providerMessageId);
  await settleFragments({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-e2e",
    fragments: [{ messageId, providerMessageId }]
  });

  const captured = capturingRespondProvider("Hola!");
  await withEnv({ ...r3PilotEnv(conversation.waId), BRAIN_WHATSAPP_TYPING_INDICATOR_ENABLED: "false" }, async () => {
    await runTurnSettleTick({ agentLoopProvider: captured.provider, postTyping: NEVER_CALLED_TYPING });
  });

  const turnRow = await loadTurnRow(conversation.id);
  assert.equal(turnRow.status, "COMPLETED", "the turn must still complete normally with typing off");
});

test("[T14/N] typing indicator failure never blocks the turn - cognition and dispatch still succeed", async () => {
  const conversation = await insertConversation();
  const providerMessageId = `wamid.${randomUUID()}`;
  const messageId = await insertInboundMessage(conversation.id, "hola", providerMessageId);
  await settleFragments({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-e2e",
    fragments: [{ messageId, providerMessageId }]
  });

  const failingTyping = async (): Promise<MetaTypingIndicatorResponse> => ({
    ok: false,
    status: "failed",
    error_code: "meta_network_error",
    error_message: "simulated network failure",
    http_status: null
  });
  const captured = capturingRespondProvider("Hola, en que te ayudo?");

  await withEnv({ ...r3PilotEnv(conversation.waId), BRAIN_WHATSAPP_TYPING_INDICATOR_ENABLED: "true" }, async () => {
    await runTurnSettleTick({ agentLoopProvider: captured.provider, postTyping: failingTyping });
  });

  assert.equal(captured.requests.length, 1, "the model must still have been called despite the typing failure");
  const outboxCount = await outboxRowCountForWaId(conversation.waId);
  assert.equal(outboxCount, 1, "the response must still have been dispatched despite the typing failure");
});

test("[T7/S] a worker that crashes right after claiming (before cognition ever runs) is recovered by a later tick - exactly one real execution, no lost message, no duplicate dispatch", async () => {
  const conversation = await insertConversation();
  const providerMessageId = `wamid.${randomUUID()}`;
  const messageId = await insertInboundMessage(conversation.id, "hola, sigues ahi?", providerMessageId);
  await settleFragments({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-e2e",
    fragments: [{ messageId, providerMessageId }]
  });

  // Simulates the crashed worker: claims the row (PENDING -> PROCESSING) and
  // then does nothing else - no assembleTurnFragments, no cognition, no
  // terminal write, exactly as a process kill between claim and dispatch
  // would leave it.
  const preCrashRow = await loadTurnRow(conversation.id);
  assert.ok(await claimPendingTurn(preCrashRow.id));
  await getPool().execute("UPDATE crm_inbound_turn_settlements SET updated_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 999 SECOND) WHERE id = ?", [preCrashRow.id]);

  const captured = capturingRespondProvider("Si, aqui estoy!");
  await withEnv(r3PilotEnv(conversation.waId), async () => {
    // Tick from a fresh worker instance - must reclaim the abandoned row via
    // selectStaleProcessingTurns, never treat it as a brand new turn.
    await runTurnSettleTick({ agentLoopProvider: captured.provider });
  });

  assert.equal(captured.requests.length, 1, "the recovered turn must run cognition exactly once - no lost customer message, no duplicate execution");
  const turnRow = await loadTurnRow(conversation.id);
  assert.equal(turnRow.status, "COMPLETED");
  const outboxCount = await outboxRowCountForWaId(conversation.waId);
  assert.equal(outboxCount, 1, "exactly one response must be dispatched for the recovered turn - never zero, never two");
});
