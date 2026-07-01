import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, safeQueryRows } from "@/lib/db";
import { processNativeWhatsAppInbound, applyMetaDeliveryStatus } from "@/lib/brain/native-whatsapp";
import { createOutboxPlannedRecord } from "@/lib/brain/messaging/outbox";
import { runOutboxTick, isRetryableSendFailure, computeRetryDelaySeconds, type OutboxTickSendResult } from "@/lib/brain/messaging/autonomousOutboxTick";
import { applyConversationControl } from "@/lib/domains/conversations/control";

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "main_management",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true",
  BRAIN_META_SEND_ENABLED: "false",
  BRAIN_OUTBOX_WORKER_ENABLED: "false",
  BRAIN_PERSIST_CANONICAL_OUTBOUND: "true",
  // Keep the autonomous cycle out of these tests: they exercise the outbox layer.
  BRAIN_SALES_AGENT_ENABLED: "false",
  BRAIN_COMMERCIAL_SHADOW_ENABLED: "false",
  BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED: "false"
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

// Pre-existing planned rows live in the shared dev DB; a large batch plus the
// outboxIds scope keeps the tick isolated to the rows each test creates.
const TICK_BATCH = 200;

const sentResponse = (providerMessageId: string): OutboxTickSendResult =>
  ({
    ok: true,
    status: "sent",
    error_code: null,
    error_message: null,
    blocked_reasons: [],
    warnings: [],
    http_status: 200,
    provider_message_id: providerMessageId,
    meta_payload_preview: null,
    response_body: null
  }) as OutboxTickSendResult;

const networkErrorResponse = (): OutboxTickSendResult =>
  ({
    ok: false,
    status: "failed",
    error_code: "meta_network_error",
    error_message: "socket hang up",
    blocked_reasons: ["meta_network_error"],
    warnings: [],
    http_status: null,
    provider_message_id: null,
    meta_payload_preview: null,
    response_body: null
  }) as OutboxTickSendResult;

async function createConversationWithInbound(label: string) {
  const waId = `5698${String(Date.now()).slice(-8)}`;
  const phoneNumberId = `phone-${uniqueSuffix(label)}`;
  const inbound = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix(label)}`,
    phoneNumberId,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Test",
    messageType: "text",
    text: "Hola, necesito ayuda con un producto.",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });
  assert.equal(inbound.duplicate, false);
  assert.ok(inbound.conversationId);
  return { waId, phoneNumberId, conversationId: inbound.conversationId as number, conversationPublicId: inbound.conversationPublicId as string };
}

async function planOutboxRow(conversation: { waId: string; phoneNumberId: string; conversationId: number }, label: string) {
  const planned = await createOutboxPlannedRecord({
    dedupeKeyInput: {
      source: "brain",
      actionType: "send_whatsapp_message",
      channel: "whatsapp",
      waId: conversation.waId,
      phoneNumberId: conversation.phoneNumberId,
      conversationCaseId: conversation.conversationId,
      messageText: `Respuesta autónoma ${label}`,
      sourceRequestId: uniqueSuffix(label)
    },
    status: "planned",
    source: "brain",
    waId: conversation.waId,
    phoneNumberId: conversation.phoneNumberId,
    conversationCaseId: conversation.conversationId,
    messageText: `Respuesta autónoma ${label}`
  });
  assert.ok(planned.ok, planned.ok ? "" : planned.warning);
  assert.ok(planned.row.id);
  return planned.row.id as number;
}

async function loadOutboxRow(id: number) {
  const result = await safeQueryRows<{ status: string; error_code: string | null; attempt_count: number; next_attempt_at: string | null; provider_message_id: string | null }>(
    "SELECT status, error_code, attempt_count, next_attempt_at, provider_message_id FROM brain_message_outbox WHERE id = ? LIMIT 1",
    [id]
  );
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.rows[0];
}

test("escenario D: operator takeover cancels planned auto-response atomically; worker sends nothing", async () => {
  const conversation = await createConversationWithInbound("race");
  const outboxId = await planOutboxRow(conversation, "race");

  // Operator takes control BEFORE the worker claims the row.
  const control = await applyConversationControl({ conversationPublicId: conversation.conversationPublicId, action: "take", operatorName: "Test Operator" });
  assert.ok(control.ok, control.ok ? "" : control.message);
  assert.equal(control.controlMode, "human");
  assert.equal(control.cancelledOutbox, 1);

  const cancelled = await loadOutboxRow(outboxId);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.error_code, "superseded_by_operator");

  // The worker tick must not find (nor send) the row.
  let sendCalls = 0;
  const tick = await runOutboxTick({
    batchSize: TICK_BATCH,
    lockSeconds: 60,
    workerId: "test-race",
    outboxIds: [outboxId],
    sendFn: async () => {
      sendCalls++;
      return sentResponse("wamid.should-not-happen");
    }
  });
  assert.equal(sendCalls, 0);
  assert.equal(tick.sent, 0);
});

test("worker re-validates ownership immediately before send and cancels AI rows under human control", async () => {
  const conversation = await createConversationWithInbound("revalidate");
  const outboxId = await planOutboxRow(conversation, "revalidate");

  // Simulate a takeover that raced past the planning gate WITHOUT cancelling
  // the outbox row (flips flags directly): the tick's pre-send re-validation
  // must still refuse to send.
  await safeQueryRows("UPDATE conversation SET human_owner_active = 1, ai_enabled = 0 WHERE id = ?", [conversation.conversationId]);

  let sendCalls = 0;
  const tick = await runOutboxTick({
    batchSize: TICK_BATCH,
    lockSeconds: 60,
    workerId: "test-revalidate",
    outboxIds: [outboxId],
    sendFn: async () => {
      sendCalls++;
      return sentResponse("wamid.should-not-happen");
    }
  });

  assert.equal(sendCalls, 0);
  assert.equal(tick.cancelled, 1);
  const row = await loadOutboxRow(outboxId);
  assert.equal(row.status, "cancelled");
  assert.equal(row.error_code, "ownership_revoked");

  // A cancelled execution attempt is recorded for traceability.
  const executions = await safeQueryRows<{ status: string; error_code: string | null }>(
    "SELECT status, error_code FROM crm_action_executions WHERE outbox_message_id = ?",
    [outboxId]
  );
  assert.ok(executions.ok);
  assert.equal(executions.rows.length, 1);
  assert.equal(executions.rows[0].status, "cancelled");
  assert.equal(executions.rows[0].error_code, "ownership_revoked");
});

test("escenario G: transient provider failure retries with backoff, then succeeds", async () => {
  const conversation = await createConversationWithInbound("retry");
  const outboxId = await planOutboxRow(conversation, "retry");

  // First tick: network error → back to planned with attempt_count=1 and a future next_attempt_at.
  let calls = 0;
  const failTick = await runOutboxTick({
    batchSize: TICK_BATCH,
    lockSeconds: 60,
    workerId: "test-retry",
    outboxIds: [outboxId],
    retryBaseSeconds: 30,
    retryMaxSeconds: 900,
    sendFn: async () => {
      calls++;
      return networkErrorResponse();
    }
  });
  assert.equal(failTick.retried, 1);
  assert.equal(calls, 1);

  let row = await loadOutboxRow(outboxId);
  assert.equal(row.status, "planned");
  assert.equal(Number(row.attempt_count), 1);
  assert.ok(row.next_attempt_at, "next_attempt_at must be scheduled");

  // While next_attempt_at is in the future the row is NOT selectable.
  const skippedTick = await runOutboxTick({
    batchSize: TICK_BATCH,
    lockSeconds: 60,
    workerId: "test-retry",
    outboxIds: [outboxId],
    sendFn: async () => {
      calls++;
      return sentResponse("wamid.too-early");
    }
  });
  assert.equal(skippedTick.processed, 0);
  assert.equal(calls, 1);

  // Force the backoff window to elapse, then the retry succeeds.
  await safeQueryRows("UPDATE brain_message_outbox SET next_attempt_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE id = ?", [outboxId]);
  const providerMessageId = `wamid.${uniqueSuffix("retry-ok")}`;
  const okTick = await runOutboxTick({
    batchSize: TICK_BATCH,
    lockSeconds: 60,
    workerId: "test-retry",
    outboxIds: [outboxId],
    sendFn: async () => {
      calls++;
      return sentResponse(providerMessageId);
    }
  });
  assert.equal(okTick.sent, 1);
  assert.equal(calls, 2);

  row = await loadOutboxRow(outboxId);
  assert.equal(row.status, "sent");
  assert.equal(Number(row.attempt_count), 2);
  assert.equal(row.provider_message_id, providerMessageId);

  // Canonical outbound message exists for the HUB timeline.
  const canonical = await safeQueryRows<{ total: number }>(
    "SELECT COUNT(*) AS total FROM conversation_message WHERE provider_message_id = ?",
    [providerMessageId]
  );
  assert.ok(canonical.ok);
  assert.equal(Number(canonical.rows[0].total), 1);

  // One execution per attempt, one terminal 'sent' outcome — attempts never duplicate outcomes.
  const executions = await safeQueryRows<{ total: number }>(
    "SELECT COUNT(*) AS total FROM crm_action_executions WHERE outbox_message_id = ?",
    [outboxId]
  );
  const outcomes = await safeQueryRows<{ outcome_type: string }>(
    "SELECT outcome_type FROM crm_action_outcomes WHERE outbox_message_id = ?",
    [outboxId]
  );
  assert.ok(executions.ok && outcomes.ok);
  assert.equal(Number(executions.rows[0].total), 2);
  assert.deepEqual(outcomes.rows.map((r) => r.outcome_type), ["sent"]);
});

test("escenario G: attempts exhausted becomes terminal failure with failed outcome", async () => {
  const conversation = await createConversationWithInbound("exhaust");
  const outboxId = await planOutboxRow(conversation, "exhaust");

  const tick = await runOutboxTick({
    batchSize: TICK_BATCH,
    lockSeconds: 60,
    workerId: "test-exhaust",
    outboxIds: [outboxId],
    maxAttempts: 1,
    sendFn: async () => networkErrorResponse()
  });
  assert.equal(tick.failed, 1);

  const row = await loadOutboxRow(outboxId);
  assert.equal(row.status, "failed");
  assert.equal(row.error_code, "meta_network_error");

  const outcomes = await safeQueryRows<{ outcome_type: string }>(
    "SELECT outcome_type FROM crm_action_outcomes WHERE outbox_message_id = ?",
    [outboxId]
  );
  assert.ok(outcomes.ok);
  assert.deepEqual(outcomes.rows.map((r) => r.outcome_type), ["failed"]);
});

test("escenario H: AI free text outside the 24h window is cancelled by the worker", async () => {
  const conversation = await createConversationWithInbound("window");
  const outboxId = await planOutboxRow(conversation, "window");

  // Age the customer's last inbound past the 24h window.
  await safeQueryRows("UPDATE conversation SET last_inbound_at = DATE_SUB(NOW(3), INTERVAL 25 HOUR) WHERE id = ?", [conversation.conversationId]);

  let sendCalls = 0;
  const tick = await runOutboxTick({
    batchSize: TICK_BATCH,
    lockSeconds: 60,
    workerId: "test-window",
    outboxIds: [outboxId],
    sendFn: async () => {
      sendCalls++;
      return sentResponse("wamid.should-not-happen");
    }
  });

  assert.equal(sendCalls, 0);
  assert.equal(tick.cancelled, 1);
  const row = await loadOutboxRow(outboxId);
  assert.equal(row.status, "cancelled");
  assert.equal(row.error_code, "window_closed");
});

test("escenario F: duplicate delivery webhook records exactly one outcome and keeps monotonic status", async () => {
  const conversation = await createConversationWithInbound("delivery");
  const outboxId = await planOutboxRow(conversation, "delivery");

  const providerMessageId = `wamid.${uniqueSuffix("delivery")}`;
  const sentTick = await runOutboxTick({
    batchSize: TICK_BATCH,
    lockSeconds: 60,
    workerId: "test-delivery",
    outboxIds: [outboxId],
    sendFn: async () => sentResponse(providerMessageId)
  });
  assert.equal(sentTick.sent, 1);

  const first = await applyMetaDeliveryStatus({ providerMessageId, status: "delivered", occurredAt: new Date().toISOString(), rawPayload: {} });
  assert.equal(first.ok, true);
  const duplicate = await applyMetaDeliveryStatus({ providerMessageId, status: "delivered", occurredAt: new Date().toISOString(), rawPayload: {} });
  assert.equal(duplicate.ok, true);
  // Out-of-order: 'sent' after 'delivered' must not regress.
  const regress = await applyMetaDeliveryStatus({ providerMessageId, status: "sent", occurredAt: new Date().toISOString(), rawPayload: {} });
  assert.equal(regress.ok, true);

  const outbox = await safeQueryRows<{ provider_status: string }>(
    "SELECT provider_status FROM brain_message_outbox WHERE id = ? LIMIT 1",
    [outboxId]
  );
  assert.ok(outbox.ok);
  assert.equal(outbox.rows[0].provider_status, "delivered");

  const deliveredOutcomes = await safeQueryRows<{ total: number }>(
    "SELECT COUNT(*) AS total FROM crm_action_outcomes WHERE outbox_message_id = ? AND outcome_type = 'delivered'",
    [outboxId]
  );
  assert.ok(deliveredOutcomes.ok);
  assert.equal(Number(deliveredOutcomes.rows[0].total), 1);
});

test("retry classification and backoff computation", () => {
  assert.equal(isRetryableSendFailure("meta_network_error", null), true);
  assert.equal(isRetryableSendFailure("meta_http_error", 500), true);
  assert.equal(isRetryableSendFailure("meta_http_error", 429), true);
  assert.equal(isRetryableSendFailure("meta_http_error", 400), false);
  assert.equal(isRetryableSendFailure("blocked_by_policy", null), false);
  assert.equal(isRetryableSendFailure("missing_credentials", null), false);
  assert.equal(computeRetryDelaySeconds(0, 30, 900), 30);
  assert.equal(computeRetryDelaySeconds(3, 30, 900), 240);
  assert.equal(computeRetryDelaySeconds(10, 30, 900), 900);
});
