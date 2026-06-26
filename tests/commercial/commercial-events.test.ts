import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, safeQueryRows, withTransaction } from "@/lib/db";
import {
  buildCommercialStatusEventDedupeKey,
  buildFollowUpDueCommercialEventDedupeKey,
  buildInboundCommercialEventDedupeKey,
  buildInternalCommandCommercialEventDedupeKey,
  loadCommercialEventByDedupeKey,
  normalizeCommercialEventPayload,
  normalizeFollowUpDueCommercialEvent,
  normalizeInternalCommandCommercialEvent,
  normalizeMetaWhatsAppInboundCommercialEvent,
  normalizeMetaWhatsAppStatusCommercialEvent,
  recordCommercialEvent
} from "@/lib/brain/commercial/events";

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
  DATABASE_URL: ""
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

test("CommercialEvent contract and sanitizer are strict", () => {
  const inbound = normalizeMetaWhatsAppInboundCommercialEvent({
    providerMessageId: `wamid.${uniqueSuffix("contract")}`,
    phoneNumberId: "phone-1",
    externalSenderId: "56990000001",
    senderPhone: "56990000001",
    senderName: "Cliente Prueba",
    messageType: "text",
    text: "Hola",
    occurredAt: new Date().toISOString(),
    metadata: { source: "meta", nested: { ok: true } }
  });

  assert.equal(inbound.contractName, "CommercialEvent");
  assert.equal(inbound.schemaVersion, "1.0");
  assert.equal(inbound.eventType, "customer_message_received");
  assert.equal(inbound.source, "meta_whatsapp");
  assert.equal(inbound.channel, "whatsapp");
  assert.equal(inbound.provider, "meta");
  assert.equal(inbound.sourceEventId?.startsWith("wamid."), true);
  assert.equal(inbound.payload.text, "Hola");
  assert.equal(inbound.metadata.eventKind, "native_whatsapp_inbound");

  assert.throws(
    () =>
      normalizeCommercialEventPayload({
        ok: true,
        authorization: "secret"
      }),
    /commercial_event_forbidden_key/
  );

  assert.throws(
    () =>
      normalizeCommercialEventPayload({
        nested: {
          apiKey: "secret"
        }
      }),
    /commercial_event_forbidden_key/
  );
});

test("CommercialEvent dedupe keys and correlation/causation are stable", () => {
  const providerMessageId = `wamid.${uniqueSuffix("dedupe")}`;
  const validParentEventId = `cevt_${"a".repeat(32)}`;
  const inbound = normalizeMetaWhatsAppInboundCommercialEvent({
    providerMessageId,
    phoneNumberId: "phone-1",
    externalSenderId: "56990000002",
    senderPhone: "56990000002",
    senderName: "Cliente Prueba",
    messageType: "text",
    text: "Necesito ayuda",
    occurredAt: "2026-01-01T00:00:00.000Z",
    messageId: 123,
    correlationId: "corr-1"
  });
  const status = normalizeMetaWhatsAppStatusCommercialEvent({
    providerMessageId,
    status: "delivered",
    occurredAt: "2026-01-01T00:00:05.000Z",
    messageId: 123,
    correlationId: "corr-2"
  });
  const followUp = normalizeFollowUpDueCommercialEvent({
    actionId: "action-1",
    scheduledAt: "2026-01-02T10:00:00.000Z",
    correlationId: "corr-3"
  });
  const internal = normalizeInternalCommandCommercialEvent({
    commandId: "cmd-1",
    result: "completed",
    correlationId: "corr-4",
    causationId: validParentEventId
  });

  assert.equal(inbound.dedupeKey, buildInboundCommercialEventDedupeKey(providerMessageId));
  assert.equal(status.dedupeKey, buildCommercialStatusEventDedupeKey(providerMessageId, "delivered"));
  assert.equal(followUp.dedupeKey, buildFollowUpDueCommercialEventDedupeKey("action-1", "2026-01-02T10:00:00.000Z"));
  assert.equal(internal.dedupeKey, buildInternalCommandCommercialEventDedupeKey("cmd-1", "completed"));
  assert.equal(inbound.correlationId, "corr-1");
  assert.equal(inbound.causationId, null);
  assert.equal(internal.causationId, validParentEventId);

  for (const invalidCausationId of ["msg-1", "action-1", "decision-1", "tool-1", "outbox-1"]) {
    assert.throws(
      () =>
        normalizeInternalCommandCommercialEvent({
          commandId: "cmd-invalid",
          result: "completed",
          causationId: invalidCausationId
        }),
      /commercial_event_invalid_causation_id/
    );
  }

  assert.throws(
    () =>
      normalizeFollowUpDueCommercialEvent({
        actionId: "action-2",
        scheduledAt: "2026-01-02T10:00:00.000Z",
        causationId: "msg-1"
      }),
    /commercial_event_invalid_causation_id/
  );
});

test("CommercialEvent persists once and duplicate dedupe returns existing row", async () => {
  const providerMessageId = `wamid.${uniqueSuffix("persist")}`;
  const event = normalizeMetaWhatsAppInboundCommercialEvent({
    providerMessageId,
    phoneNumberId: "phone-2",
    externalSenderId: "56990000003",
    senderPhone: "56990000003",
    senderName: "Cliente Prueba",
    messageType: "text",
    text: "Busco una jaula",
    occurredAt: new Date().toISOString(),
    customerId: "customer-1",
    conversationId: "conversation-1",
    opportunityId: "opportunity-1",
    metadata: { source: "test" }
  });

  const first = await recordCommercialEvent(event);
  assert.equal(first.ok, true);
  assert.equal(first.status, "created");
  assert.ok(first.event);

  const beforeRow = await safeQueryRows<{ created_at: string; payload_json: string; metadata_json: string }>(
    "SELECT created_at, payload_json, metadata_json FROM commercial_event WHERE dedupe_key = ? LIMIT 1",
    [event.dedupeKey]
  );
  assert.ok(beforeRow.ok);
  const before = beforeRow.rows[0];
  assert.ok(before);

  const second = await recordCommercialEvent(event);
  assert.equal(second.ok, true);
  assert.equal(second.status, "duplicate");
  assert.equal(second.event?.dedupeKey, event.dedupeKey);

  const afterRow = await safeQueryRows<{ created_at: string; payload_json: string; metadata_json: string }>(
    "SELECT created_at, payload_json, metadata_json FROM commercial_event WHERE dedupe_key = ? LIMIT 1",
    [event.dedupeKey]
  );
  assert.ok(afterRow.ok);
  const after = afterRow.rows[0];
  assert.ok(after);
  assert.equal(String(after.created_at), String(before.created_at));
  assert.equal(after.payload_json, before.payload_json);
  assert.equal(after.metadata_json, before.metadata_json);

  const byCorrelation = await loadCommercialEventByDedupeKey(event.dedupeKey);
  assert.ok(byCorrelation);
  assert.equal(byCorrelation?.id, event.id);

  const count = await countRows("SELECT COUNT(*) AS total FROM commercial_event WHERE dedupe_key = ?", [event.dedupeKey]);
  assert.equal(count, 1);
});

test("PR-02B: occurredAt/receivedAt are real ISO timestamps on both first insertion and duplicate, never empty strings", async () => {
  const providerMessageId = `wamid.${uniqueSuffix("timestamps")}`;
  const event = normalizeMetaWhatsAppInboundCommercialEvent({
    providerMessageId,
    phoneNumberId: "phone-timestamps",
    externalSenderId: "56990000099",
    senderPhone: "56990000099",
    senderName: "Cliente Timestamps",
    messageType: "text",
    text: "Verificando timestamps",
    occurredAt: new Date().toISOString()
  });

  function assertIsoTimestamp(value: string) {
    assert.notEqual(value, "");
    assert.ok(!Number.isNaN(new Date(value).getTime()), `expected a valid ISO timestamp, got ${JSON.stringify(value)}`);
  }

  const first = await recordCommercialEvent(event);
  assert.equal(first.ok, true);
  assert.ok(first.event);
  assertIsoTimestamp(first.event!.occurredAt);
  assertIsoTimestamp(first.event!.receivedAt);

  const second = await recordCommercialEvent(event);
  assert.equal(second.ok, true);
  assert.equal(second.status, "duplicate");
  assert.ok(second.event);
  assertIsoTimestamp(second.event!.occurredAt);
  assertIsoTimestamp(second.event!.receivedAt);

  // Compare against a fresh read of the same persisted row (not the original
  // in-memory `event`): MariaDB DATETIME columns are naive (no timezone), and
  // mysql2's default Date parsing for naive datetimes is a separate, known,
  // pre-existing issue (not introduced or fixed by PR-02B) tracked as a risk
  // in docs/product/autonomous-commerce-implementation-backlog.md (PR-02B).
  const reloaded = await loadCommercialEventByDedupeKey(event.dedupeKey);
  assert.ok(reloaded);
  assertIsoTimestamp(reloaded!.occurredAt);
  assertIsoTimestamp(reloaded!.receivedAt);
  assert.equal(second.event!.occurredAt, reloaded!.occurredAt);
  assert.equal(second.event!.receivedAt, reloaded!.receivedAt);
});

test("CommercialEvent can be inserted and rolled back in a single transaction", async () => {
  const providerMessageId = `wamid.${uniqueSuffix("rollback")}`;
  const event = normalizeMetaWhatsAppInboundCommercialEvent({
    providerMessageId,
    phoneNumberId: "phone-3",
    externalSenderId: "56990000004",
    senderPhone: "56990000004",
    senderName: "Cliente Prueba",
    messageType: "text",
    text: "Rollback",
    occurredAt: new Date().toISOString(),
    customerId: "customer-2",
    conversationId: "conversation-2",
    opportunityId: "opportunity-2"
  });

  await assert.rejects(
    withTransaction(async (connection) => {
      const result = await recordCommercialEvent(event, connection);
      assert.equal(result.ok, true);
      throw new Error("force_rollback");
    }),
    /force_rollback/
  );

  const count = await countRows("SELECT COUNT(*) AS total FROM commercial_event WHERE dedupe_key = ?", [event.dedupeKey]);
  assert.equal(count, 0);
});

test("CommercialEvent lookup supports correlation and conversation filters", async () => {
  const providerMessageId = `wamid.${uniqueSuffix("lookup")}`;
  const event = normalizeMetaWhatsAppInboundCommercialEvent({
    providerMessageId,
    phoneNumberId: "phone-4",
    externalSenderId: "56990000005",
    senderPhone: "56990000005",
    senderName: "Cliente Prueba",
    messageType: "text",
    text: "Consulta",
    occurredAt: new Date().toISOString(),
    customerId: "customer-3",
    conversationId: "conversation-lookup",
    opportunityId: "opportunity-lookup"
  });

  await recordCommercialEvent(event);
  const correlationCount = await countRows("SELECT COUNT(*) AS total FROM commercial_event WHERE correlation_id = ?", [event.correlationId]);
  const conversationCount = await countRows("SELECT COUNT(*) AS total FROM commercial_event WHERE conversation_id = ?", [String(event.conversationId)]);

  assert.equal(correlationCount >= 1, true);
  assert.equal(conversationCount >= 1, true);
});
