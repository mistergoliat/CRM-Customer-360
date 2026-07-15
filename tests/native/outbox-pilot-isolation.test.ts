import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, safeQueryRows } from "@/lib/db";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";
import { createOutboxPlannedRecord } from "@/lib/brain/messaging/outbox";
import { runOutboxTick, type OutboxTickSendResult } from "@/lib/brain/messaging/autonomousOutboxTick";

// ACS-R1-05-T06.1 (P1-5 pilot isolation, layer 3 + P1-2 redaction). Same
// fixture shape as tests/native/outbox-ownership.test.ts, kept in a
// dedicated file so BRAIN_AUTONOMOUS_TEST_WA_IDS never needs to be set at
// the process level - allowedWaIds is always passed as a per-call option.
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

const failedResponseWithSensitiveMessage = (): OutboxTickSendResult =>
  ({
    ok: false,
    status: "failed",
    error_code: "meta_http_error",
    error_message:
      "Meta rejected the request for recipient 56912345678 (contact billing@example.com), Authorization: Bearer abc123.def-456_ghi",
    blocked_reasons: ["meta_http_error"],
    warnings: [],
    http_status: 400,
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
  const result = await safeQueryRows<{ status: string; error_code: string | null; error_message: string | null }>(
    "SELECT status, error_code, error_message FROM brain_message_outbox WHERE id = ? LIMIT 1",
    [id]
  );
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.rows[0];
}

test("[T06.1] an unauthorized wa_id's outbox row is never claimed - stays planned, transport is never called", async () => {
  const conversation = await createConversationWithInbound("unauth");
  const outboxId = await planOutboxRow(conversation, "unauth");

  let sendCalls = 0;
  const tick = await runOutboxTick({
    batchSize: TICK_BATCH,
    lockSeconds: 60,
    workerId: "test-pilot-unauth",
    outboxIds: [outboxId],
    allowedWaIds: ["56900000000"], // deliberately not conversation.waId
    sendFn: async () => {
      sendCalls++;
      return sentResponse("wamid.should-not-happen");
    }
  });

  assert.equal(sendCalls, 0);
  assert.equal(tick.skipped, 1);
  const row = await loadOutboxRow(outboxId);
  assert.equal(row.status, "planned");
});

test("[T06.1] a mixed batch sends the authorized row and leaves the unauthorized row planned, exactly one transport call", async () => {
  const authorized = await createConversationWithInbound("mix-auth");
  const unauthorized = await createConversationWithInbound("mix-unauth");
  const authorizedOutboxId = await planOutboxRow(authorized, "mix-auth");
  const unauthorizedOutboxId = await planOutboxRow(unauthorized, "mix-unauth");

  let sendCalls = 0;
  const providerMessageId = `wamid.${uniqueSuffix("mix")}`;
  const tick = await runOutboxTick({
    batchSize: TICK_BATCH,
    lockSeconds: 60,
    workerId: "test-pilot-mixed",
    outboxIds: [authorizedOutboxId, unauthorizedOutboxId],
    allowedWaIds: [authorized.waId],
    sendFn: async () => {
      sendCalls++;
      return sentResponse(providerMessageId);
    }
  });

  assert.equal(sendCalls, 1);
  assert.equal(tick.sent, 1);
  assert.equal(tick.skipped, 1);

  const authorizedRow = await loadOutboxRow(authorizedOutboxId);
  assert.equal(authorizedRow.status, "sent");

  const unauthorizedRow = await loadOutboxRow(unauthorizedOutboxId);
  assert.equal(unauthorizedRow.status, "planned");
});

test("[T06.1] a Meta error containing a phone number, email and Bearer token is redacted before it is persisted", async () => {
  const conversation = await createConversationWithInbound("redact");
  const outboxId = await planOutboxRow(conversation, "redact");

  const tick = await runOutboxTick({
    batchSize: TICK_BATCH,
    lockSeconds: 60,
    workerId: "test-pilot-redact",
    outboxIds: [outboxId],
    maxAttempts: 1,
    sendFn: async () => failedResponseWithSensitiveMessage()
  });
  assert.equal(tick.failed, 1);

  const row = await loadOutboxRow(outboxId);
  assert.equal(row.status, "failed");
  assert.ok(row.error_message, "error_message must be persisted");
  for (const sensitive of ["56912345678", "billing@example.com", "abc123.def-456_ghi"]) {
    assert.ok(!row.error_message!.includes(sensitive), `error_message must not contain "${sensitive}"`);
  }

  const executions = await safeQueryRows<{ error_message: string | null }>(
    "SELECT error_message FROM crm_action_executions WHERE outbox_message_id = ? ORDER BY created_at DESC LIMIT 1",
    [outboxId]
  );
  assert.ok(executions.ok);
  const executionMessage = executions.rows[0]?.error_message ?? "";
  for (const sensitive of ["56912345678", "billing@example.com", "abc123.def-456_ghi"]) {
    assert.ok(!executionMessage.includes(sensitive), `crm_action_executions.error_message must not contain "${sensitive}"`);
  }
});
