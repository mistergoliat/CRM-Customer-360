import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { safeQueryRows, queryRows, getPool } from "@/lib/db";
import { applyMetaDeliveryStatus, processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";
import { persistCanonicalOutboundMessage } from "@/lib/brain/messaging/outboundMessages";

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

const stubProductRepository = {
  async searchProducts() {
    return [
      {
        id: "p1",
        reference: "JAULA-01",
        name: "Jaula Compacta",
        category: "Fitness",
        description: "Jaula para entrenamiento en casa",
        price: 490000,
        currency: "CLP",
        stockQuantity: 5,
        dimensions: { width: 120, height: 210, length: 120, unit: "cm" },
        features: ["compacta", "resistente"],
        compatibility: ["hogar"],
        relatedProductIds: ["p2"],
        manufacturer: "FitHome",
        imageUrl: null,
        source: "test_catalog"
      }
    ];
  },
  async getProductDetails() {
    return null;
  },
  async getProductPrice() {
    return 490000;
  },
  async getProductStock() {
    return 5;
  },
  async getProductDimensions() {
    return { width: 120, height: 210, length: 120, unit: "cm" };
  },
  async getProductCompatibility() {
    return ["hogar"];
  },
  async getRelatedProducts() {
    return [
      {
        id: "p2",
        reference: "JAULA-02",
        name: "Jaula Compacta Pro",
        category: "Fitness",
        description: "Alternativa más robusta",
        price: 540000,
        currency: "CLP",
        stockQuantity: 2,
        dimensions: { width: 125, height: 215, length: 125, unit: "cm" },
        features: ["compacta", "robusta"],
        compatibility: ["hogar"],
        relatedProductIds: ["p1"],
        manufacturer: "FitHome",
        imageUrl: null,
        source: "test_catalog"
      }
    ];
  }
};

async function countRows(sql: string, params: Array<string | number>) {
  const result = await safeQueryRows<{ total: number }>(sql, params);
  assert.ok(result.ok, result.ok ? "" : result.error);
  return Number(result.rows[0]?.total ?? 0);
}

test("native inbound creates a single conversation, decision and outbox, and duplicate webhook does not duplicate rows", async () => {
  const providerMessageId = `wamid.${uniqueSuffix("inbound")}`;
  const waId = `5699${String(Date.now()).slice(-8)}`;
  const phoneNumberId = `phone-${uniqueSuffix("pnid")}`;

  const first = await processNativeWhatsAppInbound({
    providerMessageId,
    phoneNumberId,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Prueba",
    messageType: "text",
    text: "Lo voy a pensar.",
    occurredAt: new Date().toISOString(),
    rawPayload: { providerMessageId }
  }, { productRepository: stubProductRepository });

  assert.equal(first.duplicate, false);
  assert.ok(first.conversationId);
  assert.ok(first.messageId);
  assert.ok(first.customerId);

  const duplicate = await processNativeWhatsAppInbound({
    providerMessageId,
    phoneNumberId,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Prueba",
    messageType: "text",
    text: "Lo voy a pensar.",
    occurredAt: new Date().toISOString(),
    rawPayload: { providerMessageId }
  }, { productRepository: stubProductRepository });

  assert.equal(duplicate.duplicate, true);

  const messageCount = await countRows(
    "SELECT COUNT(*) AS total FROM conversation_message WHERE provider = ? AND provider_message_id = ?",
    ["meta", providerMessageId]
  );
  const decisionCount = await countRows(
    "SELECT COUNT(*) AS total FROM crm_agent_decisions WHERE correlation_id = ?",
    [first.correlationId]
  );
  const conversationCount = await countRows(
    "SELECT COUNT(*) AS total FROM conversation WHERE id = ?",
    [first.conversationId]
  );
  const outboxCount = await countRows(
    "SELECT COUNT(*) AS total FROM brain_message_outbox WHERE wa_id = ?",
    [waId]
  );

  assert.equal(messageCount, 1);
  assert.equal(decisionCount, 1);
  assert.equal(conversationCount, 1);
  assert.equal(outboxCount, 1);
});

test("canonical outbound persists to native timeline and delivery status projects back to outbox", async () => {
  const providerMessageId = `wamid.${uniqueSuffix("outbound")}`;
  const waId = `5698${String(Date.now()).slice(-8)}`;
  const phoneNumberId = `phone-${uniqueSuffix("pnid")}`;

  const inbound = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix("seed")}`,
    phoneNumberId,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Prueba",
    messageType: "text",
    text: "Busco una jaula para entrenar en casa.",
    occurredAt: new Date().toISOString(),
    rawPayload: { seed: true }
  }, { productRepository: stubProductRepository });

  assert.ok(inbound.conversationId);

  const outboxRowResult = await safeQueryRows<{ id: number; dedupe_key: string; message_text: string | null }>(
    "SELECT id, dedupe_key, message_text FROM brain_message_outbox WHERE wa_id = ? ORDER BY id DESC LIMIT 1",
    [waId]
  );
  assert.ok(outboxRowResult.ok, outboxRowResult.ok ? "" : outboxRowResult.error);
  const outboxRow = outboxRowResult.rows[0];
  assert.ok(outboxRow);
  assert.ok(outboxRow.message_text);

  await queryRows(
    "UPDATE brain_message_outbox SET status = 'sent', provider_message_id = ?, provider_status = 'sent', provider_status_updated_at = NOW() WHERE id = ?",
    [providerMessageId, outboxRow.id]
  );

  const persistResult = await persistCanonicalOutboundMessage({
    enabled: true,
    outboxId: outboxRow.id,
    dedupeKey: outboxRow.dedupe_key,
    sourceRequestId: outboxRow.dedupe_key,
    outboxStatus: "sent",
    conversationCaseId: inbound.conversationId,
    waId,
    phoneNumberId,
    messageText: outboxRow.message_text,
    providerMessageId,
    sentAt: new Date().toISOString()
  });

  assert.ok(["persisted", "existing"].includes(persistResult.status));

  const outboundCount = await countRows(
    "SELECT COUNT(*) AS total FROM conversation_message WHERE provider = ? AND provider_message_id = ? AND direction = ?",
    ["meta", providerMessageId, "outbound"]
  );
  assert.equal(outboundCount, 1);

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
  const outboxDeliveredCount = await countRows(
    "SELECT COUNT(*) AS total FROM brain_message_outbox WHERE id = ? AND provider_status = ?",
    [outboxRow.id, "delivered"]
  );

  assert.equal(deliveryMessageCount, 1);
  assert.equal(outboxDeliveredCount, 1);
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
