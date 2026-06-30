import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, safeQueryRows } from "@/lib/db";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";
import { maybeRunCommercialAgentForInboundTurn } from "@/lib/brain/commercial/agent-runtime/wireToNativeInbound";

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "main_management",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "main_management",
  DATABASE_USER: "crm_app",
  DATABASE_PASSWORD: "una_clave_local",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true",
  BRAIN_META_SEND_ENABLED: "false",
  BRAIN_OUTBOX_WORKER_ENABLED: "false"
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

test("the trigger is a no-op when BRAIN_COMMERCIAL_AGENT_ENABLED is unset", async () => {
  delete process.env.BRAIN_COMMERCIAL_AGENT_ENABLED;
  const result = await maybeRunCommercialAgentForInboundTurn({
    conversationId: 1,
    conversationPublicId: "conv-fake",
    customerMasterId: null,
    waId: null,
    phoneNumberId: null,
    messageText: "hola",
    messageId: null,
    correlationId: "corr-1",
    currentTime: new Date().toISOString()
  });
  assert.deepEqual(result, { ran: false, reason: "disabled" });
});

test("the trigger fails closed with a clear reason when no model provider is configured", async () => {
  Object.assign(process.env, { BRAIN_COMMERCIAL_AGENT_ENABLED: "true" });
  const originalUrl = process.env.BRAIN_MODEL_API_URL;
  const originalKey = process.env.BRAIN_MODEL_API_KEY;
  delete process.env.BRAIN_MODEL_API_URL;
  delete process.env.BRAIN_MODEL_API_KEY;

  try {
    const result = await maybeRunCommercialAgentForInboundTurn({
      conversationId: 1,
      conversationPublicId: "conv-fake",
      customerMasterId: null,
      waId: null,
      phoneNumberId: null,
      messageText: "hola",
      messageId: null,
      correlationId: "corr-2",
      currentTime: new Date().toISOString()
    });
    assert.deepEqual(result, { ran: false, reason: "model_not_configured" });
  } finally {
    Object.assign(process.env, { BRAIN_COMMERCIAL_AGENT_ENABLED: "false" });
    if (originalUrl !== undefined) process.env.BRAIN_MODEL_API_URL = originalUrl;
    if (originalKey !== undefined) process.env.BRAIN_MODEL_API_KEY = originalKey;
  }
});

test("processNativeWhatsAppInbound stays safe with the agent flag on but no model configured: inbound still persists, no throw", async () => {
  Object.assign(process.env, { BRAIN_COMMERCIAL_AGENT_ENABLED: "true" });
  delete process.env.BRAIN_MODEL_API_URL;
  delete process.env.BRAIN_MODEL_API_KEY;

  try {
    const waId = `5692${String(Date.now()).slice(-7)}`;
    const providerMessageId = `wamid.${uniqueSuffix("agent-wired")}`;
    const inbound = await processNativeWhatsAppInbound({
      providerMessageId,
      phoneNumberId: "phone-agent-wired",
      externalSenderId: waId,
      senderPhone: waId,
      senderName: "Cliente Wired",
      messageType: "text",
      text: "Hola, prueba con el flag activo",
      occurredAt: new Date().toISOString(),
      rawPayload: {}
    });

    assert.equal(inbound.duplicate, false);
    assert.ok(inbound.messageId);

    const messageCount = await safeQueryRows<{ total: number }>(
      "SELECT COUNT(*) AS total FROM conversation_message WHERE provider_message_id = ?",
      [providerMessageId]
    );
    assert.ok(messageCount.ok);
    assert.equal(messageCount.rows[0]?.total, 1);

    const outboxCount = await safeQueryRows<{ total: number }>("SELECT COUNT(*) AS total FROM brain_message_outbox WHERE wa_id = ?", [waId]);
    assert.ok(outboxCount.ok);
    assert.equal(outboxCount.rows[0]?.total, 0, "no outbox row should be planned when the agent could not run");
  } finally {
    Object.assign(process.env, { BRAIN_COMMERCIAL_AGENT_ENABLED: "false" });
  }
});
