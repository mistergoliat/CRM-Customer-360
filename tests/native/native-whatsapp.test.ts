import assert from "node:assert/strict";
import test, { after } from "node:test";
import path from "node:path";
import { readFileSync } from "node:fs";
import { getPool, queryRows, safeQueryRows } from "@/lib/db";
import {
  loadCommercialEventByDedupeKey,
  buildInboundCommercialEventDedupeKey
} from "@/lib/brain/commercial/events";
import { processNativeWhatsAppInbound, applyMetaDeliveryStatus } from "@/lib/brain/native-whatsapp";
import { createOutboxPlannedRecord } from "@/lib/brain/messaging/outbox";

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
  BRAIN_OUTBOX_WORKER_ENABLED: "false",
  BRAIN_PERSIST_CANONICAL_OUTBOUND: "true"
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

async function countRows(sql: string, params: Array<string | number>) {
  const result = await safeQueryRows<{ total: number }>(sql, params);
  assert.ok(result.ok, result.ok ? "" : result.error);
  return Number(result.rows[0]?.total ?? 0);
}

test("native inbound persists conversation, message and CommercialEvent once", async () => {
  const providerMessageId = `wamid.${uniqueSuffix("commercial-event")}`;
  const waId = `5699${String(Date.now()).slice(-8)}`;
  const phoneNumberId = `phone-${uniqueSuffix("pnid")}`;

  const first = await processNativeWhatsAppInbound({
    providerMessageId,
    phoneNumberId,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Prueba",
    messageType: "text",
    text: "Busco una jaula para entrenar en casa.",
    occurredAt: new Date().toISOString(),
    rawPayload: { providerMessageId }
  });

  assert.equal(first.duplicate, false);
  assert.ok(first.conversationId);
  assert.ok(first.messageId);
  assert.ok(first.commercialEvent?.id);
  assert.equal(first.commercialEvent?.contractName, "CommercialEvent");
  assert.equal(first.commercialEvent?.schemaVersion, "1.0");
  assert.equal(first.commercialEvent?.eventType, "customer_message_received");

  const duplicate = await processNativeWhatsAppInbound({
    providerMessageId,
    phoneNumberId,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Prueba",
    messageType: "text",
    text: "Busco una jaula para entrenar en casa.",
    occurredAt: new Date().toISOString(),
    rawPayload: { providerMessageId }
  });

  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.commercialEventStatus, "duplicate");

  const messageCount = await countRows(
    "SELECT COUNT(*) AS total FROM conversation_message WHERE provider = ? AND provider_message_id = ?",
    ["meta", providerMessageId]
  );
  const eventCount = await countRows(
    "SELECT COUNT(*) AS total FROM commercial_event WHERE dedupe_key = ?",
    [buildInboundCommercialEventDedupeKey(providerMessageId)]
  );
  const opportunityCount = await countRows(
    "SELECT COUNT(*) AS total FROM crm_opportunities WHERE conversation_case_id = ?",
    [String(first.conversationId)]
  );
  const outboxCount = await countRows(
    "SELECT COUNT(*) AS total FROM brain_message_outbox WHERE wa_id = ?",
    [waId]
  );
  const aiExecutionCount = await countRows(
    "SELECT COUNT(*) AS total FROM ai_agent_execution WHERE conversation_id = ?",
    [String(first.conversationId)]
  );

  assert.equal(messageCount, 1);
  assert.equal(eventCount, 1);
  assert.equal(opportunityCount, 0);
  assert.equal(outboxCount, 0);
  assert.equal(aiExecutionCount, 0);

  const loadedEvent = await loadCommercialEventByDedupeKey(buildInboundCommercialEventDedupeKey(providerMessageId));
  assert.ok(loadedEvent);
  assert.equal(loadedEvent?.correlationId, first.correlationId);
  assert.equal(loadedEvent?.conversationId, String(first.conversationId));
});

test("delivery status updates the native timeline and records a CommercialEvent", async () => {
  const providerMessageId = `wamid.${uniqueSuffix("delivery")}`;
  const waId = `5698${String(Date.now()).slice(-8)}`;
  const phoneNumberId = `phone-${uniqueSuffix("pnid")}`;

  const inbound = await processNativeWhatsAppInbound({
    providerMessageId,
    phoneNumberId,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Prueba",
    messageType: "text",
    text: "Lo voy a pensar.",
    occurredAt: new Date().toISOString(),
    rawPayload: { providerMessageId }
  });

  assert.ok(inbound.messageId);

  const outbox = await createOutboxPlannedRecord({
    dedupeKeyInput: {
      source: "brain",
      actionType: "send_whatsapp_message",
      channel: "whatsapp",
      waId,
      phoneNumberId,
      conversationCaseId: String(inbound.conversationId),
      sourceRequestId: providerMessageId
    },
    status: "sent",
    source: "brain",
    waId,
    phoneNumberId,
    conversationCaseId: String(inbound.conversationId),
    messageText: "Hola",
    providerMessageId
  });
  assert.equal(outbox.ok, true);
  assert.ok(outbox.row.id);
  await queryRows("UPDATE brain_message_outbox SET provider_message_id = ?, status = 'sent' WHERE id = ?", [providerMessageId, outbox.row.id as number]);

  const deliveryResult = await applyMetaDeliveryStatus({
    providerMessageId,
    status: "delivered",
    occurredAt: new Date().toISOString(),
    rawPayload: { id: providerMessageId, status: "delivered" }
  });

  assert.equal(deliveryResult.ok, true);

  const deliveryMessageCount = await countRows(
    "SELECT COUNT(*) AS total FROM conversation_message WHERE provider = ? AND provider_message_id = ? AND status = ?",
    ["meta", providerMessageId, "delivered"]
  );
  const deliveryEventCount = await countRows(
    "SELECT COUNT(*) AS total FROM commercial_event WHERE dedupe_key = ?",
    [`meta:whatsapp:status:${providerMessageId}:delivered`]
  );
  const outboxCount = await countRows(
    "SELECT COUNT(*) AS total FROM brain_message_outbox WHERE provider_message_id = ?",
    [providerMessageId]
  );
  const outboxStatus = await safeQueryRows<{ provider_status: string | null }>(
    "SELECT provider_status FROM brain_message_outbox WHERE provider_message_id = ? LIMIT 1",
    [providerMessageId]
  );

  assert.equal(deliveryMessageCount, 1);
  assert.equal(deliveryEventCount, 1);
  assert.equal(outboxCount, 1);
  assert.ok(outboxStatus.ok);
  assert.equal(outboxStatus.rows[0]?.provider_status, "delivered");
});

test("duplicate delivery status does not duplicate CommercialEvent", async () => {
  const providerMessageId = `wamid.${uniqueSuffix("delivery-dup")}`;
  const waId = `5698${String(Date.now()).slice(-8)}`;
  const phoneNumberId = `phone-${uniqueSuffix("pnid")}`;

  const inbound = await processNativeWhatsAppInbound({
    providerMessageId,
    phoneNumberId,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Prueba",
    messageType: "text",
    text: "Lo voy a pensar.",
    occurredAt: new Date().toISOString(),
    rawPayload: { providerMessageId }
  });

  assert.ok(inbound.messageId);

  const first = await applyMetaDeliveryStatus({
    providerMessageId,
    status: "delivered",
    occurredAt: new Date().toISOString(),
    rawPayload: { id: providerMessageId, status: "delivered" }
  });
  const second = await applyMetaDeliveryStatus({
    providerMessageId,
    status: "delivered",
    occurredAt: new Date().toISOString(),
    rawPayload: { id: providerMessageId, status: "delivered" }
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);

  const eventCount = await countRows(
    "SELECT COUNT(*) AS total FROM commercial_event WHERE dedupe_key = ?",
    [`meta:whatsapp:status:${providerMessageId}:delivered`]
  );
  const projectedStatus = await safeQueryRows<{ status: string | null }>(
    "SELECT status FROM conversation_message WHERE provider = ? AND provider_message_id = ? LIMIT 1",
    ["meta", providerMessageId]
  );

  assert.ok(projectedStatus.ok);
  assert.equal(eventCount, 1);
  assert.equal(projectedStatus.rows[0]?.status, "delivered");
});

test("delivery statuses progress forward and stale statuses do not regress projections", async () => {
  const providerMessageId = `wamid.${uniqueSuffix("delivery-order")}`;
  const waId = `5698${String(Date.now()).slice(-8)}`;
  const phoneNumberId = `phone-${uniqueSuffix("pnid")}`;

  const inbound = await processNativeWhatsAppInbound({
    providerMessageId,
    phoneNumberId,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Prueba",
    messageType: "text",
    text: "Lo voy a pensar.",
    occurredAt: new Date().toISOString(),
    rawPayload: { providerMessageId }
  });

  assert.ok(inbound.messageId);

  const outbox = await createOutboxPlannedRecord({
    dedupeKeyInput: {
      source: "brain",
      actionType: "send_whatsapp_message",
      channel: "whatsapp",
      waId,
      phoneNumberId,
      conversationCaseId: String(inbound.conversationId),
      sourceRequestId: providerMessageId
    },
    status: "sent",
    source: "brain",
    waId,
    phoneNumberId,
    conversationCaseId: String(inbound.conversationId),
    messageText: "Hola",
    providerMessageId
  });
  assert.equal(outbox.ok, true);
  assert.ok(outbox.row.id);
  await queryRows("UPDATE brain_message_outbox SET provider_message_id = ?, status = 'sent' WHERE id = ?", [providerMessageId, outbox.row.id as number]);

  await applyMetaDeliveryStatus({
    providerMessageId,
    status: "delivered",
    occurredAt: new Date().toISOString(),
    rawPayload: { id: providerMessageId, status: "delivered" }
  });
  await applyMetaDeliveryStatus({
    providerMessageId,
    status: "read",
    occurredAt: new Date().toISOString(),
    rawPayload: { id: providerMessageId, status: "read" }
  });
  await applyMetaDeliveryStatus({
    providerMessageId,
    status: "sent",
    occurredAt: new Date().toISOString(),
    rawPayload: { id: providerMessageId, status: "sent" }
  });

  const projectedStatus = await safeQueryRows<{ status: string | null }>(
    "SELECT status FROM conversation_message WHERE provider = ? AND provider_message_id = ? LIMIT 1",
    ["meta", providerMessageId]
  );
  const outboxStatus = await safeQueryRows<{ provider_status: string | null }>(
    "SELECT provider_status FROM brain_message_outbox WHERE provider_message_id = ? LIMIT 1",
    [providerMessageId]
  );
  const eventCount = await countRows(
    "SELECT COUNT(*) AS total FROM commercial_event WHERE source = ? AND source_event_id = ? AND event_type LIKE ?",
    ["meta_whatsapp", providerMessageId, "outbound_message_%"]
  );

  assert.ok(projectedStatus.ok);
  assert.ok(outboxStatus.ok);
  assert.equal(projectedStatus.rows[0]?.status, "read");
  assert.equal(outboxStatus.rows[0]?.provider_status, "read");
  assert.equal(eventCount, 3);
});

test("native inbound rollback prevents message and event persistence when the transaction fails", async () => {
  const providerMessageId = `wamid.${uniqueSuffix("rollback")}`;
  const waId = `5697${String(Date.now()).slice(-8)}`;
  const phoneNumberId = `phone-${uniqueSuffix("pnid")}`;

  await assert.rejects(
    processNativeWhatsAppInbound({
      providerMessageId,
      phoneNumberId,
      externalSenderId: waId,
      senderPhone: waId,
      senderName: "Cliente Prueba",
      messageType: "text",
      text: "Prueba de rollback.",
      occurredAt: new Date().toISOString(),
      rawPayload: { providerMessageId }
    }, {
      commercialEventRecorder: async () => ({ ok: false as const, status: "error", event: null, warning: "forced_failure" })
    }),
    /forced_failure/
  );

  const messageCount = await countRows(
    "SELECT COUNT(*) AS total FROM conversation_message WHERE provider = ? AND provider_message_id = ?",
    ["meta", providerMessageId]
  );
  const eventCount = await countRows(
    "SELECT COUNT(*) AS total FROM commercial_event WHERE dedupe_key = ?",
    [buildInboundCommercialEventDedupeKey(providerMessageId)]
  );
  const conversationCount = await countRows(
    "SELECT COUNT(*) AS total FROM conversation WHERE channel = ? AND channel_account_id = ? AND external_contact_id = ?",
    ["whatsapp", phoneNumberId, waId]
  );

  assert.equal(messageCount, 0);
  assert.equal(eventCount, 0);
  assert.equal(conversationCount, 0);
});

test("native runtime files do not import legacy-n8n", () => {
  const files = [
    path.resolve("lib/brain/native-whatsapp/service.ts"),
    path.resolve("app/api/integrations/whatsapp/webhook/route.ts"),
    path.resolve("lib/domains/conversations/repository.ts")
  ];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.equal(source.includes("legacy-n8n"), false, file);
  }
});

test("native inbound path does not invoke consultative engine or outbox writers", () => {
  const routeSource = readFileSync(path.resolve("app/api/integrations/whatsapp/webhook/route.ts"), "utf8");
  assert.doesNotMatch(routeSource, /runSalesConsultativeService\s*\(/);
  assert.doesNotMatch(routeSource, /processSalesInbound\s*\(/);
  assert.doesNotMatch(routeSource, /persistCanonicalOutboundMessage\s*\(/);
  assert.doesNotMatch(routeSource, /sendMetaWhatsAppTextMessage\s*\(/);

  const serviceSource = readFileSync(path.resolve("lib/brain/native-whatsapp/service.ts"), "utf8");
  const start = serviceSource.indexOf("export async function processNativeWhatsAppInbound");
  const end = serviceSource.indexOf("export async function applyMetaDeliveryStatus");
  const inboundBody = serviceSource.slice(start, end);
  assert.doesNotMatch(inboundBody, /runSalesConsultativeService\s*\(/);
  assert.doesNotMatch(inboundBody, /processSalesInbound\s*\(/);
  assert.doesNotMatch(inboundBody, /persistCanonicalOutboundMessage\s*\(/);
  assert.doesNotMatch(inboundBody, /queueCustomerMessage\s*\(/);
  assert.doesNotMatch(inboundBody, /sendMetaWhatsAppTextMessage\s*\(/);
  assert.doesNotMatch(inboundBody, /brain_message_outbox/);
  assert.doesNotMatch(inboundBody, /crm_opportunities/);
  assert.doesNotMatch(inboundBody, /crm_agent_decisions/);
  assert.doesNotMatch(inboundBody, /crm_agent_actions/);
});
