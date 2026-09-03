import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { getPool, queryRows, safeExecute, safeQueryRows } from "@/lib/db";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";
import { upsertPendingTurn, runTurnSettleTick, claimPendingTurn } from "@/lib/brain/commercial/turn-settlement";
import type { TurnSettlementRow } from "@/lib/brain/commercial/turn-settlement/types";
import type { AgentLoopProvider, AgentLoopProviderRequest } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";
import type { MetaTypingIndicatorRequest, MetaTypingIndicatorResponse } from "@/lib/brain/messaging/metaClient";
import type { EnsureAutonomousSalesTurnContinuityInput, EnsureAutonomousSalesTurnContinuityResult } from "@/lib/brain/commercial/continuity/ensureAutonomousSalesTurnContinuity";
import { createQuoteCapability } from "@/lib/brain/commercial/capability-gateway/createQuoteCapability";
import { setCommercialLineItemsForOpportunity } from "@/lib/domains/commercial-line-items";
import { getActiveCreatedQuoteForOpportunity } from "@/lib/domains/created-quote";
import type { QuoteServicePort, QuoteServiceQuote, QuoteServiceResult } from "@/lib/domains/quote-service";
import type { CatalogBatchItemInput, CatalogBatchItemResult, CatalogPort, CatalogProduct } from "@/lib/catalog";

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

function freshWaId(): string {
  // Digits-only (normalizeWhatsAppRecipientDigits rejects anything else) and
  // never truncated below its random suffix - slicing the FIRST 15 chars of
  // "5699" + Date.now() (13 digits) + a 0-999 suffix drops the suffix
  // entirely and collapses the timestamp to ~100ms resolution, which
  // collided for real between tests calling this back-to-back in the same
  // run. Building it to fit within 15 chars up front keeps full entropy.
  return `5699${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 1000)}`;
}

const SETTLE_ENABLED_ENV = { BRAIN_R3_INBOUND_TURN_SETTLE_DELAY_MS: "1800", BRAIN_R3_INBOUND_TURN_SETTLE_MAX_MS: "5000" };

async function countConversationMessages(providerMessageId: string): Promise<number> {
  const result = await safeQueryRows<{ total: number }>(
    "SELECT COUNT(*) AS total FROM conversation_message WHERE provider = 'meta' AND provider_message_id = ?",
    [providerMessageId]
  );
  return result.ok ? Number(result.rows[0]?.total ?? 0) : -1;
}

async function countTurnSettlementRows(waId: string): Promise<number> {
  const result = await safeQueryRows<{ total: number }>("SELECT COUNT(*) AS total FROM crm_inbound_turn_settlements WHERE wa_id = ?", [waId]);
  return result.ok ? Number(result.rows[0]?.total ?? 0) : -1;
}

/**
 * crm_test is a shared, never-reset database across the whole test run -
 * runTurnSettleTick sweeps every DUE PENDING row in the table, not just the
 * one the calling test cares about. Tests that assert against a PENDING row
 * without ever consuming it via the worker (T2, T5/T6 below) must neutralize
 * it once done, or a LATER test's own runTurnSettleTick call (often with a
 * provider/ensureContinuity scoped to ITS OWN conversation) would pick this
 * leftover row up too and run cognition against it unexpectedly.
 */
async function neutralizePendingTurn(waId: string): Promise<void> {
  await getPool().execute("UPDATE crm_inbound_turn_settlements SET status = 'COMPLETED' WHERE wa_id = ? AND status = 'PENDING'", [waId]);
}

test("[T2/G1] settling enabled: canonical inbound + pending-turn creation commit atomically in the SAME transaction", async () => {
  const waId = freshWaId();
  const providerMessageId = `wamid.${randomUUID()}`;

  await withEnv(SETTLE_ENABLED_ENV, async () => {
    const result = await processNativeWhatsAppInbound({
      providerMessageId,
      phoneNumberId: "phone-turnsettle-e2e",
      externalSenderId: waId,
      senderPhone: waId,
      senderName: "Cliente Atomic",
      messageType: "text",
      text: "hola atomic",
      occurredAt: new Date().toISOString(),
      rawPayload: {}
    });
    assert.equal(result.duplicate, false);
  });

  assert.equal(await countConversationMessages(providerMessageId), 1);
  assert.equal(await countTurnSettlementRows(waId), 1, "the settlement row must exist in the same commit as the canonical inbound persist");
  const turnRows = await safeQueryRows<TurnSettlementRow>("SELECT * FROM crm_inbound_turn_settlements WHERE wa_id = ?", [waId]);
  assert.equal(turnRows.ok && turnRows.rows[0]?.status, "PENDING");

  await neutralizePendingTurn(waId);
});

test("[T3/D] a failure between the inbound insert and the settlement upsert rolls back BOTH - no orphaned inbound", async () => {
  const waId = freshWaId();
  const providerMessageId = `wamid.${randomUUID()}`;

  await withEnv(SETTLE_ENABLED_ENV, async () => {
    await assert.rejects(
      processNativeWhatsAppInbound(
        {
          providerMessageId,
          phoneNumberId: "phone-turnsettle-e2e",
          externalSenderId: waId,
          senderPhone: waId,
          senderName: "Cliente Crash",
          messageType: "text",
          text: "hola crash",
          occurredAt: new Date().toISOString(),
          rawPayload: {}
        },
        { upsertPendingTurnFn: async () => ({ ok: false, error: "simulated_crash_window" }) }
      ),
      /simulated_crash_window/
    );
  });

  assert.equal(await countConversationMessages(providerMessageId), 0, "the canonical inbound must never be committed without durable settlement ownership (invariant I1)");
  assert.equal(await countTurnSettlementRows(waId), 0);
});

test("[T4] duplicate webhook retry after a rolled-back attempt succeeds idempotently - exactly one canonical inbound, never treated as a duplicate of a half-committed row", async () => {
  const waId = freshWaId();
  const providerMessageId = `wamid.${randomUUID()}`;
  const inboundPayload = {
    providerMessageId,
    phoneNumberId: "phone-turnsettle-e2e",
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Retry",
    messageType: "text",
    text: "hola retry",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  };

  await withEnv(SETTLE_ENABLED_ENV, async () => {
    await assert.rejects(
      processNativeWhatsAppInbound(inboundPayload, { upsertPendingTurnFn: async () => ({ ok: false, error: "simulated_crash_window" }) }),
      /simulated_crash_window/
    );

    const retried = await processNativeWhatsAppInbound(inboundPayload);
    assert.equal(retried.duplicate, false, "the rolled-back attempt left no canonical row, so Meta's real retry of the same delivery must not be treated as a duplicate");
  });

  assert.equal(await countConversationMessages(providerMessageId), 1, "exactly one canonical inbound must exist after the retry, never two, never zero");
  assert.equal(await countTurnSettlementRows(waId), 1);
});

test("[T5/T6/G4] two near-simultaneous fragments, through the real webhook path with the settlement write inside the inbound transaction, still converge to exactly one PENDING turn with the correct fragment count - no deadlock, no uniqueness regression", async () => {
  const waId = freshWaId();
  const first = `wamid.${randomUUID()}`;
  const second = `wamid.${randomUUID()}`;

  await withEnv(SETTLE_ENABLED_ENV, async () => {
    const [resultA, resultB] = await Promise.all([
      processNativeWhatsAppInbound({
        providerMessageId: first,
        phoneNumberId: "phone-turnsettle-e2e",
        externalSenderId: waId,
        senderPhone: waId,
        senderName: "Cliente Concurrente",
        messageType: "text",
        text: "hola",
        occurredAt: new Date().toISOString(),
        rawPayload: {}
      }),
      processNativeWhatsAppInbound({
        providerMessageId: second,
        phoneNumberId: "phone-turnsettle-e2e",
        externalSenderId: waId,
        senderPhone: waId,
        senderName: "Cliente Concurrente",
        messageType: "text",
        text: "como estas",
        occurredAt: new Date().toISOString(),
        rawPayload: {}
      })
    ]);
    assert.equal(resultA.duplicate, false);
    assert.equal(resultB.duplicate, false);
    assert.equal(resultA.conversationId, resultB.conversationId, "both fragments must resolve to the same conversation");
  });

  assert.equal(await countConversationMessages(first), 1);
  assert.equal(await countConversationMessages(second), 1);

  const pendingRows = await safeQueryRows<TurnSettlementRow>("SELECT * FROM crm_inbound_turn_settlements WHERE wa_id = ? AND status = 'PENDING'", [waId]);
  assert.equal(pendingRows.ok && pendingRows.rows.length, 1, "exactly one active PENDING turn per conversation, even under a real concurrent webhook race");
  assert.equal(pendingRows.rows[0]!.fragment_count, 2);

  await neutralizePendingTurn(waId);
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

/**
 * SALES-AGENT-R3-V1.8.1a (Fix 2 / Section K/T8). Real create_quote capability
 * (real assembleQuoteInput, real commercial_line_items/created_quote
 * crm_request_facts rows) driven twice through the SAME durable
 * turn-settlement crash/stale-reclaim mechanics [T7] already proves at the
 * repository level - only the external Quote Service HTTP call is faked
 * (same injection seam tests/commercial/createQuoteCapability.test.ts uses).
 * Proves G6 end to end: the capability's own durable idempotency key
 * (opportunityId + commercial_line_items.factId, both re-read fresh from
 * durable state on every attempt - never a per-attempt random id) survives a
 * real crash-before-completeTurn + stale-processing reclaim.
 */
async function seedQuoteCustomer(): Promise<number> {
  const email = `v1-8-1a-${randomUUID()}@example.com`;
  await queryRows("INSERT INTO master_customer (firstname, lastname, email, platform_origin) VALUES ('Jane', 'Doe', ?, 'hub')", [email]);
  const rows = await queryRows<{ id: number }>("SELECT id FROM master_customer WHERE email = ? LIMIT 1", [email]);
  return Number(rows[0].id);
}

async function seedQuoteOpportunity(waId: string, customerMasterId: number): Promise<number> {
  const key = `v1-8-1a-mutation-reclaim-${randomUUID()}`;
  await safeExecute(
    `INSERT INTO crm_opportunities (opportunity_key, requirements_json, missing_requirements_json, product_interests_json, objections_json, signals_json, customer_master_id, wa_id)
     VALUES (?, '{}', '[]', '[]', '[]', '[]', ?, ?)`,
    [key, String(customerMasterId), waId]
  );
  const rows = await queryRows<{ id: number }>("SELECT id FROM crm_opportunities WHERE opportunity_key = ? LIMIT 1", [key]);
  return rows[0].id;
}

function fakeQuoteProduct(): CatalogProduct {
  return {
    productId: "545",
    name: "Barra Olimpica 20kg",
    sku: "BAR-OLY-20",
    shortDescription: null,
    longDescription: null,
    active: true,
    selectedVariant: null,
    variants: [],
    price: { amount: 99990, currency: "CLP", taxIncluded: true, taxRate: 0.19, discountApplied: false },
    availability: "in_stock",
    stockQuantity: 5,
    weightKg: 20,
    provenance: { source: "catalog_service_http", retrievedAt: "2026-08-15T00:00:00.000Z", cached: false }
  };
}

function fakeQuoteCatalogPort(): CatalogPort {
  return {
    async searchProducts() { throw new Error("not used"); },
    async getProductDetails() { throw new Error("not used"); },
    async batchGetProducts(input: { items: CatalogBatchItemInput[] }) {
      return {
        ok: true,
        value: {
          items: input.items.map((item): CatalogBatchItemResult => ({ ok: true, input: item, product: fakeQuoteProduct() })),
          provenance: { source: "catalog_service_http", retrievedAt: "2026-08-15T00:00:00.000Z", cached: false }
        }
      };
    },
    async exploreCatalog() { throw new Error("not used"); },
    async resolveProductIntent() { throw new Error("not used"); }
  };
}

function fakeCreatedQuote(): QuoteServiceQuote {
  return {
    quoteId: "quote-v1-8-1a-1",
    quoteNumber: "Q-V181A-0001",
    opportunityId: "1",
    customerId: "1",
    conversationId: null,
    actor: { type: "sales_agent", id: "native_agent_tool_loop" },
    source: { system: "crm_customer_360", correlationId: null },
    status: "draft",
    currency: "CLP",
    customerSnapshot: { name: "Jane Doe", businessName: null, email: "jane@example.com", phone: null, address: null, district: null, region: null },
    items: [],
    pricing: { subtotal: "99990", taxAmount: "18998", total: "118988" },
    validUntil: "2026-08-20T00:00:00.000Z",
    version: 1,
    revision: { rootId: "quote-v1-8-1a-1", previousRevisionId: null, supersedesQuoteId: null, supersededByQuoteId: null },
    issuedDocument: { available: false, contentHash: null, renderVersion: null, generatedAt: null, pdf: { documentRef: null, sha256: null }, html: { documentRef: null, sha256: null } },
    timestamps: { createdAt: "2026-08-15T00:00:00.000Z", updatedAt: "2026-08-15T00:00:00.000Z", issuedAt: null, acceptedAt: null, paidAt: null, cancelledAt: null, expiredAt: null }
  };
}

function unusedQuoteServicePortMethod(): never {
  throw new Error("not used");
}

test("[T8/K/G6] mutation completes then the worker crashes before completeTurn() - stale reclaim resumes cognition but the mutation exists exactly once", async () => {
  const conversation = await insertConversation();
  const providerMessageId = `wamid.${randomUUID()}`;
  const messageId = await insertInboundMessage(conversation.id, "cotizame la barra de 20kg", providerMessageId);
  await settleFragments({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-e2e",
    fragments: [{ messageId, providerMessageId }]
  });

  const customerMasterId = await seedQuoteCustomer();
  const opportunityId = await seedQuoteOpportunity(conversation.waId, customerMasterId);
  const lineItems = await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "545", combinationId: null, quantity: 2 }] });
  assert.equal(lineItems.ok, true);

  let quoteServiceCallCount = 0;
  const port: QuoteServicePort = {
    async createQuote(): Promise<QuoteServiceResult<QuoteServiceQuote>> {
      quoteServiceCallCount += 1;
      return { ok: true, value: fakeCreatedQuote() };
    },
    updateDraft: unusedQuoteServicePortMethod,
    issueQuote: unusedQuoteServicePortMethod,
    sendQuoteEmail: unusedQuoteServicePortMethod,
    getQuote: unusedQuoteServicePortMethod,
    getQuoteByNumber: unusedQuoteServicePortMethod,
    getQuoteDelivery: unusedQuoteServicePortMethod,
    listQuoteDeliveries: unusedQuoteServicePortMethod
  };
  const capability = createQuoteCapability(
    () => port,
    () => ({ getCatalogPort: () => fakeQuoteCatalogPort(), now: () => new Date("2026-08-15T00:00:00.000Z") })
  );

  const harmlessCompletedResult: EnsureAutonomousSalesTurnContinuityResult = {
    cycle: { ran: true, shadow: null, loop: null, bridge: null, warnings: [] },
    disposition: {
      terminalOutcome: "no_response_required",
      commercialObjective: "none",
      responseOwner: "none",
      responsePlanned: false,
      opportunityAdvanced: false,
      nextBestActionDefined: false,
      fallbackUsed: false,
      followUpEligible: false,
      followUpReason: null,
      acknowledgementSender: null,
      waitingFor: "none",
      handoffCreated: false
    }
  };

  let attempt = 0;
  const ensureContinuityWithMutation = async (input: EnsureAutonomousSalesTurnContinuityInput): Promise<EnsureAutonomousSalesTurnContinuityResult> => {
    if (input.conversationId !== conversation.id) {
      // crm_test is a shared, never-reset database across the whole test
      // run - runTurnSettleTick sweeps every due/stale row in the table, not
      // just this test's own. A leftover row from an unrelated
      // test/conversation must be let through harmlessly here, never touch
      // this test's own attempt counter or mutation assertions.
      return harmlessCompletedResult;
    }
    attempt += 1;
    const outcome = await capability.execute({}, { correlationId: input.correlationId, opportunityId, conversationId: input.conversationId });
    assert.equal(outcome.status, "completed", `attempt ${attempt} must complete the mutation`);
    const outcomeStatus = (outcome.data as { status?: string } | null)?.status;
    assert.ok(outcomeStatus === "created" || outcomeStatus === "reused", `attempt ${attempt} must actually create or reuse the quote, got status=${outcomeStatus}`);

    if (attempt === 1) {
      // Simulates the worker process dying AFTER the mutation durably
      // completed (setCreatedQuoteForOpportunity already persisted the
      // created-quote fact) but BEFORE processClaimedTurn ever reaches
      // completeTurn() - the row is never marked terminal by this attempt.
      throw new Error("simulated_crash_after_mutation_before_complete_turn");
    }

    return {
      cycle: { ran: true, shadow: null, loop: null, bridge: null, warnings: [] },
      disposition: {
        terminalOutcome: "commercial_response_planned",
        commercialObjective: "prepare_quote",
        responseOwner: "ai",
        responsePlanned: false,
        opportunityAdvanced: true,
        nextBestActionDefined: true,
        fallbackUsed: false,
        followUpEligible: false,
        followUpReason: null,
        acknowledgementSender: null,
        waitingFor: "none",
        handoffCreated: false
      }
    };
  };

  await runTurnSettleTick({ ensureContinuity: ensureContinuityWithMutation });

  const preReclaimRow = await loadTurnRow(conversation.id);
  assert.equal(preReclaimRow.status, "PROCESSING", "the crashed attempt must leave the row PROCESSING, never terminal");
  await getPool().execute("UPDATE crm_inbound_turn_settlements SET updated_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 999 SECOND) WHERE id = ?", [preReclaimRow.id]);

  await runTurnSettleTick({ ensureContinuity: ensureContinuityWithMutation });

  assert.equal(attempt, 2, "cognition must be re-attempted exactly once after the stale-processing reclaim");
  assert.equal(quoteServiceCallCount, 1, "the external Quote Service must be called exactly once across both attempts - the reclaimed attempt reuses the durable quote (opportunityId + commercial_line_items.factId unchanged), never duplicates it");

  const persistedQuote = await getActiveCreatedQuoteForOpportunity(opportunityId);
  assert.ok(persistedQuote, "the quote created by the first (crashed) attempt must remain durable");
  assert.equal(persistedQuote!.quoteId, "quote-v1-8-1a-1");

  const turnRow = await loadTurnRow(conversation.id);
  assert.equal(turnRow.status, "COMPLETED", "the settlement must eventually reach a terminal state despite the crash");
});

/**
 * SALES-AGENT-R3-V1.8.1b-A (Objetivo A - live turn assimilation). Full
 * worker path, real DB, real BRAIN_R3_LIVE_TURN_ASSIMILATION_ENABLED flag,
 * real (unmocked) checkForNewInbound/refreshCommercialContextSummary wiring
 * through runNativeAutonomousCycle.ts - only the LLM itself is faked. Repo-
 * level reconciliation mechanics and transactional atomicity are proven
 * separately (tests/commercial/turnSettlementRepository.test.ts,
 * tests/commercial/dispatchGovernedSalesAgentMessageLiveAssimilation.test.ts) -
 * this test's job is proving the full chain is actually wired end to end.
 */
async function loadTurnRowByFirstInbound(conversationId: number, firstInboundMessageId: number): Promise<TurnSettlementRow> {
  const result = await safeQueryRows<TurnSettlementRow>(
    "SELECT * FROM crm_inbound_turn_settlements WHERE conversation_id = ? AND first_inbound_message_id = ? LIMIT 1",
    [conversationId, firstInboundMessageId]
  );
  assert.ok(result.ok && result.rows[0]);
  return result.rows[0];
}

/** Scripted provider that also runs an async hook right before each call returns, and records every request it received (mirrors tests/agent-loop/runAgentToolLoopLiveAssimilation.test.ts's own helper). */
function assimilationE2eProvider(steps: Array<{ message: string; before?: () => Promise<void> }>): { provider: AgentLoopProvider; requests: AgentLoopProviderRequest[] } {
  let callIndex = 0;
  const requests: AgentLoopProviderRequest[] = [];
  return {
    requests,
    provider: {
      name: "assimilation-e2e-provider",
      async invoke(request) {
        requests.push(request);
        const entry = steps[Math.min(callIndex, steps.length - 1)];
        await entry.before?.();
        callIndex += 1;
        return {
          rawOutput: { type: "respond", message: entry.message },
          model: "fake-model",
          inputTokens: 16,
          outputTokens: 16,
          providerRequestId: `fake-assim-${callIndex}`,
          finishReason: "stop"
        };
      }
    }
  };
}

test("[live assimilation e2e] a fragment arriving mid-cognition is folded into the SAME run: sibling settlement reconciles atomically, continuity survives, no duplicate/stale dispatch", async () => {
  const conversation = await insertConversation();
  await insertInboundMessage(conversation.id, "hola, ya hemos hablado antes", `wamid.${randomUUID()}`);
  await insertOutboundMessage(conversation.id, "hola! como puedo ayudarte");

  const providerMessageId = `wamid.${randomUUID()}`;
  const firstMessageId = await insertInboundMessage(conversation.id, "quiero cotizar una barra", providerMessageId);
  await settleFragments({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-e2e",
    fragments: [{ messageId: firstMessageId, providerMessageId }]
  });

  let assimilatedMessageId: number | null = null;
  const { provider, requests } = assimilationE2eProvider([
    {
      message: "borrador (nunca debe llegar al cliente)",
      before: async () => {
        // Simulates the webhook persisting a real new fragment WHILE this
        // turn is PROCESSING - real conversation_message row, real sibling
        // crm_inbound_turn_settlements PENDING row, exactly as
        // processNativeWhatsAppInbound would do.
        assimilatedMessageId = await insertInboundMessage(conversation.id, "pero mejor mandala a concepcion", `wamid.${randomUUID()}`);
        const upserted = await upsertPendingTurn({
          conversationId: conversation.id,
          waId: conversation.waId,
          phoneNumberId: "phone-turnsettle-e2e",
          inboundMessageId: assimilatedMessageId,
          providerMessageId: `wamid.${assimilatedMessageId}`,
          correlationId: `corr-${assimilatedMessageId}`,
          settleDelayMs: 0,
          maxSettleMs: 5000
        });
        assert.equal(upserted.ok, true);
      }
    },
    { message: "listo, la cotizacion queda para envio a Concepcion" }
  ]);

  await withEnv({ ...r3PilotEnv(conversation.waId), BRAIN_R3_LIVE_TURN_ASSIMILATION_ENABLED: "true" }, async () => {
    await runTurnSettleTick({ agentLoopProvider: provider });
  });

  assert.equal(requests.length, 2, "the stale draft must be discarded and cognition must continue in the SAME run, never a second independent execution");
  const lastUserMessage = requests[1].messages[requests[1].messages.length - 1];
  const secondPayload = JSON.parse(lastUserMessage.content) as {
    customerMessage: string;
    conversationContinuity: { isFirstConversationalTurn: boolean };
  };
  assert.match(secondPayload.customerMessage, /pero mejor mandala a concepcion/, "the second (accepted) inference must see the assimilated text");
  assert.equal(
    secondPayload.conversationContinuity.isFirstConversationalTurn,
    false,
    "an active conversation's continuity signal must survive assimilation - never reset mid-run, never a re-greeting trigger"
  );

  const outboxCount = await outboxRowCountForWaId(conversation.waId);
  assert.equal(outboxCount, 1, "exactly one response must be dispatched - the discarded draft must never reach the outbox");

  const rowA = await loadTurnRowByFirstInbound(conversation.id, firstMessageId);
  assert.equal(rowA.status, "COMPLETED");
  assert.ok(assimilatedMessageId !== null);
  const rowB = await loadTurnRowByFirstInbound(conversation.id, assimilatedMessageId!);
  assert.equal(rowB.status, "ASSIMILATED", "the sibling settlement must be reconciled atomically with the dispatch that consumed its content - never left PENDING to independently reprocess it");
  assert.equal(rowB.superseded_by_message_id, assimilatedMessageId);
});

test("[live assimilation e2e - flag off] the exact same mid-cognition fragment is IGNORED by cognition when the flag is off - byte-identical to pre-A behavior, which means the PRE-EXISTING [T9] dispatch-time freshness check (unconditional, not gated by this flag) still suppresses the now-stale response", async () => {
  const conversation = await insertConversation();
  const providerMessageId = `wamid.${randomUUID()}`;
  const firstMessageId = await insertInboundMessage(conversation.id, "quiero cotizar una barra", providerMessageId);
  await settleFragments({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-e2e",
    fragments: [{ messageId: firstMessageId, providerMessageId }]
  });

  let newerMessageId: number | null = null;
  const { provider, requests } = assimilationE2eProvider([
    {
      message: "esta respuesta debe quedar obsoleta",
      before: async () => {
        newerMessageId = await insertInboundMessage(conversation.id, "mensaje que la cognicion nunca vio", `wamid.${randomUUID()}`);
      }
    },
    { message: "nunca deberia llegar aqui - solo una llamada debe ocurrir" }
  ]);

  // BRAIN_R3_LIVE_TURN_ASSIMILATION_ENABLED intentionally omitted (defaults false).
  await withEnv(r3PilotEnv(conversation.waId), async () => {
    await runTurnSettleTick({ agentLoopProvider: provider });
  });

  assert.equal(requests.length, 1, "with the flag off, cognition must never re-check for new inbound and must never invalidate/retry a candidate - exactly the pre-A control flow");
  const rowA = await loadTurnRowByFirstInbound(conversation.id, firstMessageId);
  assert.equal(rowA.status, "SUPERSEDED", "unaffected by this flag: the pre-existing [T9] dispatch-time freshness check still catches the newer message and suppresses the now-stale response");
  assert.equal(rowA.superseded_by_message_id, newerMessageId);
  const outboxCount = await outboxRowCountForWaId(conversation.waId);
  assert.equal(outboxCount, 0, "the stale response must never reach the outbox");
});
