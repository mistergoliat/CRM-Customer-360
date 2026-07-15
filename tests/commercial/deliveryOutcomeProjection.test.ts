import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { getPool, queryRows, safeQueryRows } from "@/lib/db";
import { processNativeWhatsAppInbound, applyMetaDeliveryStatus } from "@/lib/brain/native-whatsapp";
import { createOutboxPlannedRecord } from "@/lib/brain/messaging/outbox";
import { runOutboxTick, type OutboxTickSendResult } from "@/lib/brain/messaging/autonomousOutboxTick";

// ACS-R1-05-T04 (P1-3): outcome idempotency, monotonic ordering and
// delivery-status projection all the way to crm_opportunities.

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

async function seedConversation(label: string) {
  const waId = `5698${String(Date.now()).slice(-8)}`;
  const phoneNumberId = `phone-${uniqueSuffix(label)}`;
  const inbound = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix(label)}`,
    phoneNumberId,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Test",
    messageType: "text",
    text: "Hola, necesito ayuda.",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });
  assert.equal(inbound.duplicate, false);
  return { waId, phoneNumberId, conversationId: inbound.conversationId as number };
}

async function seedOpportunity(input: { conversationCaseId: number; waId: string; label: string }) {
  const opportunityKey = `test-delivery-${uniqueSuffix(input.label)}`;
  await queryRows(
    `INSERT INTO crm_opportunities (
        opportunity_key, wa_id, conversation_case_id, channel, primary_intent, status, stage, temperature, priority,
        waiting_for, next_action_type, next_action_due_at,
        requirements_json, missing_requirements_json, product_interests_json, objections_json, signals_json
      ) VALUES (?, ?, ?, 'whatsapp', 'product_inquiry', 'engaged', 'recommendation', 'warm', 'normal',
        'customer_reply', 'schedule_followup', NULL, '[]', '[]', '[]', '[]', '[]')`,
    [opportunityKey, input.waId, input.conversationCaseId]
  );
  const row = await safeQueryRows<{ id: number }>("SELECT id FROM crm_opportunities WHERE opportunity_key = ? LIMIT 1", [opportunityKey]);
  assert.ok(row.ok && row.rows[0]?.id, row.ok ? "missing seeded opportunity id" : row.error);
  return row.rows[0]!.id;
}

/** applyMetaDeliveryStatus only updates an existing conversation_message row - it never creates one. */
async function seedOutboundConversationMessage(conversationId: number, providerMessageId: string) {
  await queryRows(
    `INSERT INTO conversation_message (public_id, conversation_id, provider, provider_message_id, direction, sender_type, message_type, body, status, created_at, updated_at)
     VALUES (?, ?, 'meta', ?, 'outbound', 'ai', 'text', ?, 'sent', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
    [randomUUID(), conversationId, providerMessageId, `Respuesta ${providerMessageId}`]
  );
}

/** Plans an outbox row already tied to `opportunityId` and marks it sent with `providerMessageId`, mirroring the send worker's own transition. */
async function seedSentOutboxMessage(input: {
  conversation: { waId: string; phoneNumberId: string; conversationId: number };
  opportunityId: number | null;
  providerMessageId: string;
  label: string;
}) {
  await seedOutboundConversationMessage(input.conversation.conversationId, input.providerMessageId);
  const planned = await createOutboxPlannedRecord({
    dedupeKeyInput: {
      source: "brain",
      actionType: "send_whatsapp_message",
      channel: "whatsapp",
      waId: input.conversation.waId,
      phoneNumberId: input.conversation.phoneNumberId,
      conversationCaseId: input.conversation.conversationId,
      messageText: `Respuesta ${input.label}`,
      sourceRequestId: uniqueSuffix(input.label)
    },
    status: "sent",
    source: "brain",
    waId: input.conversation.waId,
    phoneNumberId: input.conversation.phoneNumberId,
    conversationCaseId: input.conversation.conversationId,
    messageText: `Respuesta ${input.label}`,
    opportunityId: input.opportunityId
  });
  assert.ok(planned.ok, planned.ok ? "" : planned.warning);
  const outboxId = planned.row.id as number;
  await queryRows("UPDATE brain_message_outbox SET provider_message_id = ?, status = 'sent' WHERE id = ?", [input.providerMessageId, outboxId]);
  return outboxId;
}

async function countOutcomes(outboxId: number, outcomeType?: string) {
  const rows = await safeQueryRows<{ total: number }>(
    outcomeType
      ? "SELECT COUNT(*) AS total FROM crm_action_outcomes WHERE outbox_message_id = ? AND outcome_type = ?"
      : "SELECT COUNT(*) AS total FROM crm_action_outcomes WHERE outbox_message_id = ?",
    outcomeType ? [outboxId, outcomeType] : [outboxId]
  );
  assert.ok(rows.ok);
  return Number(rows.rows[0].total);
}

async function loadOpportunityProjection(opportunityId: number) {
  const rows = await safeQueryRows<{
    last_outbound_outbox_message_id: number | null;
    last_outbound_provider_message_id: string | null;
    last_outbound_delivery_status: string | null;
    last_outbound_delivery_status_at: string | null;
    status: string;
    stage: string | null;
    temperature: string;
    priority: string;
    waiting_for: string | null;
    next_action_type: string | null;
  }>(
    `SELECT last_outbound_outbox_message_id, last_outbound_provider_message_id, last_outbound_delivery_status,
            last_outbound_delivery_status_at, status, stage, temperature, priority, waiting_for, next_action_type
     FROM crm_opportunities WHERE id = ? LIMIT 1`,
    [opportunityId]
  );
  assert.ok(rows.ok && rows.rows[0]);
  return rows.rows[0]!;
}

// --- Outcome idempotency -----------------------------------------------

test("HTTP success 'sent' outcome and a later webhook 'sent' for the same message build the same idempotency key and never duplicate", async () => {
  const conversation = await seedConversation("http-then-webhook");
  const opportunityId = await seedOpportunity({ conversationCaseId: conversation.conversationId, waId: conversation.waId, label: "http-then-webhook" });

  const planned = await createOutboxPlannedRecord({
    dedupeKeyInput: {
      source: "brain",
      actionType: "send_whatsapp_message",
      channel: "whatsapp",
      waId: conversation.waId,
      phoneNumberId: conversation.phoneNumberId,
      conversationCaseId: conversation.conversationId,
      messageText: "Mensaje HTTP",
      sourceRequestId: uniqueSuffix("http")
    },
    status: "planned",
    source: "brain",
    waId: conversation.waId,
    phoneNumberId: conversation.phoneNumberId,
    conversationCaseId: conversation.conversationId,
    messageText: "Mensaje HTTP",
    opportunityId
  });
  assert.ok(planned.ok, planned.ok ? "" : planned.warning);
  const outboxId = planned.row.id as number;

  const providerMessageId = `wamid.${uniqueSuffix("http-then-webhook")}`;
  await seedOutboundConversationMessage(conversation.conversationId, providerMessageId);
  const tick = await runOutboxTick({
    batchSize: 200,
    lockSeconds: 60,
    workerId: "test-http-then-webhook",
    outboxIds: [outboxId],
    sendFn: async () => sentResponse(providerMessageId)
  });
  assert.equal(tick.sent, 1);
  assert.equal(await countOutcomes(outboxId, "sent"), 1);

  const webhookResult = await applyMetaDeliveryStatus({ providerMessageId, status: "sent", occurredAt: new Date().toISOString(), rawPayload: {} });
  assert.equal(webhookResult.ok, true);
  if (webhookResult.ok) {
    assert.equal(webhookResult.outcomeDuplicate, true);
    assert.equal(webhookResult.outcomeInserted, false);
  }
  assert.equal(await countOutcomes(outboxId, "sent"), 1);
});

test("two concurrent identical 'delivered' webhooks leave exactly one outcome row", async () => {
  const conversation = await seedConversation("concurrent-delivered");
  const opportunityId = await seedOpportunity({ conversationCaseId: conversation.conversationId, waId: conversation.waId, label: "concurrent-delivered" });
  const providerMessageId = `wamid.${uniqueSuffix("concurrent-delivered")}`;
  const outboxId = await seedSentOutboxMessage({ conversation, opportunityId, providerMessageId, label: "concurrent-delivered" });

  const [a, b] = await Promise.all([
    applyMetaDeliveryStatus({ providerMessageId, status: "delivered", occurredAt: new Date().toISOString(), rawPayload: {} }),
    applyMetaDeliveryStatus({ providerMessageId, status: "delivered", occurredAt: new Date().toISOString(), rawPayload: {} })
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  const insertedCount = [a, b].filter((r) => r.ok && r.outcomeInserted).length;
  assert.equal(insertedCount, 1);
  assert.equal(await countOutcomes(outboxId, "delivered"), 1);
});

test("a legacy outcome row without a dedupe key remains readable", async () => {
  const conversation = await seedConversation("legacy-no-key");
  const providerMessageId = `wamid.${uniqueSuffix("legacy-no-key")}`;
  const outboxId = await seedSentOutboxMessage({ conversation, opportunityId: null, providerMessageId, label: "legacy-no-key" });

  await queryRows(
    `INSERT INTO crm_action_outcomes (outcome_id, action_id, outbox_message_id, provider_message_id, outcome_type, outcome_dedupe_key, occurred_at)
     VALUES (?, ?, ?, ?, 'delivered', NULL, CURRENT_TIMESTAMP(3))`,
    [uniqueSuffix("legacy-outcome"), `outbox:${outboxId}`, outboxId, providerMessageId]
  );

  assert.equal(await countOutcomes(outboxId, "delivered"), 1);
});

// --- Monotonic ordering ---------------------------------------------------

test("sent -> delivered -> read projects read on the message and outbox timeline", async () => {
  const conversation = await seedConversation("order-forward");
  const providerMessageId = `wamid.${uniqueSuffix("order-forward")}`;
  const outboxId = await seedSentOutboxMessage({ conversation, opportunityId: null, providerMessageId, label: "order-forward" });

  await applyMetaDeliveryStatus({ providerMessageId, status: "delivered", occurredAt: new Date().toISOString(), rawPayload: {} });
  await applyMetaDeliveryStatus({ providerMessageId, status: "read", occurredAt: new Date().toISOString(), rawPayload: {} });

  const outbox = await safeQueryRows<{ provider_status: string }>("SELECT provider_status FROM brain_message_outbox WHERE id = ? LIMIT 1", [outboxId]);
  assert.ok(outbox.ok);
  assert.equal(outbox.rows[0].provider_status, "read");
});

test("read arriving before delivered records both outcomes but keeps the projection at read", async () => {
  const conversation = await seedConversation("order-read-first");
  const providerMessageId = `wamid.${uniqueSuffix("order-read-first")}`;
  const outboxId = await seedSentOutboxMessage({ conversation, opportunityId: null, providerMessageId, label: "order-read-first" });

  await applyMetaDeliveryStatus({ providerMessageId, status: "read", occurredAt: new Date().toISOString(), rawPayload: {} });
  await applyMetaDeliveryStatus({ providerMessageId, status: "delivered", occurredAt: new Date().toISOString(), rawPayload: {} });

  assert.equal(await countOutcomes(outboxId, "read"), 1);
  assert.equal(await countOutcomes(outboxId, "delivered"), 1);

  const outbox = await safeQueryRows<{ provider_status: string }>("SELECT provider_status FROM brain_message_outbox WHERE id = ? LIMIT 1", [outboxId]);
  assert.ok(outbox.ok);
  assert.equal(outbox.rows[0].provider_status, "read");
});

test("read followed by sent does not degrade the projection", async () => {
  const conversation = await seedConversation("order-read-then-sent");
  const providerMessageId = `wamid.${uniqueSuffix("order-read-then-sent")}`;
  const outboxId = await seedSentOutboxMessage({ conversation, opportunityId: null, providerMessageId, label: "order-read-then-sent" });

  await applyMetaDeliveryStatus({ providerMessageId, status: "read", occurredAt: new Date().toISOString(), rawPayload: {} });
  await applyMetaDeliveryStatus({ providerMessageId, status: "sent", occurredAt: new Date().toISOString(), rawPayload: {} });

  const outbox = await safeQueryRows<{ provider_status: string }>("SELECT provider_status FROM brain_message_outbox WHERE id = ? LIMIT 1", [outboxId]);
  assert.ok(outbox.ok);
  assert.equal(outbox.rows[0].provider_status, "read");
});

test("failed does not degrade an already delivered projection, but is still recorded as its own outcome", async () => {
  const conversation = await seedConversation("failed-no-degrade");
  const providerMessageId = `wamid.${uniqueSuffix("failed-no-degrade")}`;
  const outboxId = await seedSentOutboxMessage({ conversation, opportunityId: null, providerMessageId, label: "failed-no-degrade" });

  await applyMetaDeliveryStatus({ providerMessageId, status: "delivered", occurredAt: new Date().toISOString(), rawPayload: {} });
  await applyMetaDeliveryStatus({ providerMessageId, status: "failed", occurredAt: new Date().toISOString(), rawPayload: {} });

  const outbox = await safeQueryRows<{ provider_status: string }>("SELECT provider_status FROM brain_message_outbox WHERE id = ? LIMIT 1", [outboxId]);
  assert.ok(outbox.ok);
  assert.equal(outbox.rows[0].provider_status, "delivered");
  assert.equal(await countOutcomes(outboxId, "failed"), 1);
});

test("a duplicate webhook does not modify the projection timestamp", async () => {
  const conversation = await seedConversation("duplicate-timestamp");
  const providerMessageId = `wamid.${uniqueSuffix("duplicate-timestamp")}`;
  const outboxId = await seedSentOutboxMessage({ conversation, opportunityId: null, providerMessageId, label: "duplicate-timestamp" });

  await applyMetaDeliveryStatus({ providerMessageId, status: "delivered", occurredAt: "2026-01-01T00:00:00.000Z", rawPayload: {} });
  const first = await safeQueryRows<{ provider_status_updated_at: string }>("SELECT provider_status_updated_at FROM brain_message_outbox WHERE id = ? LIMIT 1", [outboxId]);
  assert.ok(first.ok);

  await applyMetaDeliveryStatus({ providerMessageId, status: "delivered", occurredAt: "2026-01-02T00:00:00.000Z", rawPayload: {} });
  const second = await safeQueryRows<{ provider_status_updated_at: string }>("SELECT provider_status_updated_at FROM brain_message_outbox WHERE id = ? LIMIT 1", [outboxId]);
  assert.ok(second.ok);

  assert.equal(String(second.rows[0].provider_status_updated_at), String(first.rows[0].provider_status_updated_at));
});

// --- Opportunity projection ------------------------------------------------

test("a delivery outcome is attributed to the exact opportunity carried by the outbox, never another opportunity on the same conversation", async () => {
  const conversation = await seedConversation("exact-opportunity");
  const opportunityA = await seedOpportunity({ conversationCaseId: conversation.conversationId, waId: conversation.waId, label: "exact-a" });
  const opportunityB = await seedOpportunity({ conversationCaseId: conversation.conversationId, waId: conversation.waId, label: "exact-b" });
  const providerMessageId = `wamid.${uniqueSuffix("exact-opportunity")}`;
  await seedSentOutboxMessage({ conversation, opportunityId: opportunityA, providerMessageId, label: "exact-opportunity" });

  const result = await applyMetaDeliveryStatus({ providerMessageId, status: "delivered", occurredAt: new Date().toISOString(), rawPayload: {} });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.opportunityId, opportunityA);
    assert.equal(result.opportunityProjectionApplied, true);
  }

  const projectedA = await loadOpportunityProjection(opportunityA);
  assert.equal(projectedA.last_outbound_delivery_status, "delivered");

  const projectedB = await loadOpportunityProjection(opportunityB);
  assert.equal(projectedB.last_outbound_delivery_status, null);
});

test("sent/delivered/read each advance the opportunity's delivery projection", async () => {
  const conversation = await seedConversation("opportunity-advance");
  const opportunityId = await seedOpportunity({ conversationCaseId: conversation.conversationId, waId: conversation.waId, label: "opportunity-advance" });
  const providerMessageId = `wamid.${uniqueSuffix("opportunity-advance")}`;
  await seedSentOutboxMessage({ conversation, opportunityId, providerMessageId, label: "opportunity-advance" });

  await applyMetaDeliveryStatus({ providerMessageId, status: "sent", occurredAt: new Date().toISOString(), rawPayload: {} });
  let projected = await loadOpportunityProjection(opportunityId);
  assert.equal(projected.last_outbound_delivery_status, "sent");

  await applyMetaDeliveryStatus({ providerMessageId, status: "delivered", occurredAt: new Date().toISOString(), rawPayload: {} });
  projected = await loadOpportunityProjection(opportunityId);
  assert.equal(projected.last_outbound_delivery_status, "delivered");

  await applyMetaDeliveryStatus({ providerMessageId, status: "read", occurredAt: new Date().toISOString(), rawPayload: {} });
  projected = await loadOpportunityProjection(opportunityId);
  assert.equal(projected.last_outbound_delivery_status, "read");
  assert.equal(projected.last_outbound_provider_message_id, providerMessageId);
});

test("an out-of-order event does not degrade the opportunity's projection", async () => {
  const conversation = await seedConversation("opportunity-no-degrade");
  const opportunityId = await seedOpportunity({ conversationCaseId: conversation.conversationId, waId: conversation.waId, label: "opportunity-no-degrade" });
  const providerMessageId = `wamid.${uniqueSuffix("opportunity-no-degrade")}`;
  await seedSentOutboxMessage({ conversation, opportunityId, providerMessageId, label: "opportunity-no-degrade" });

  await applyMetaDeliveryStatus({ providerMessageId, status: "read", occurredAt: new Date().toISOString(), rawPayload: {} });
  await applyMetaDeliveryStatus({ providerMessageId, status: "delivered", occurredAt: new Date().toISOString(), rawPayload: {} });

  const projected = await loadOpportunityProjection(opportunityId);
  assert.equal(projected.last_outbound_delivery_status, "read");
});

test("a webhook for an older outbound message never overwrites the projection of a newer outbound message", async () => {
  const conversation = await seedConversation("opportunity-stale-message");
  const opportunityId = await seedOpportunity({ conversationCaseId: conversation.conversationId, waId: conversation.waId, label: "opportunity-stale-message" });

  const providerMessageId1 = `wamid.${uniqueSuffix("stale-first")}`;
  await seedSentOutboxMessage({ conversation, opportunityId, providerMessageId: providerMessageId1, label: "stale-first" });

  const providerMessageId2 = `wamid.${uniqueSuffix("stale-second")}`;
  await seedSentOutboxMessage({ conversation, opportunityId, providerMessageId: providerMessageId2, label: "stale-second" });

  // Newer message (2) delivers first.
  await applyMetaDeliveryStatus({ providerMessageId: providerMessageId2, status: "delivered", occurredAt: new Date().toISOString(), rawPayload: {} });
  let projected = await loadOpportunityProjection(opportunityId);
  assert.equal(projected.last_outbound_provider_message_id, providerMessageId2);
  assert.equal(projected.last_outbound_delivery_status, "delivered");

  // A late webhook for the OLDER message (1) must not overwrite message 2's projection.
  await applyMetaDeliveryStatus({ providerMessageId: providerMessageId1, status: "read", occurredAt: new Date().toISOString(), rawPayload: {} });
  projected = await loadOpportunityProjection(opportunityId);
  assert.equal(projected.last_outbound_provider_message_id, providerMessageId2);
  assert.equal(projected.last_outbound_delivery_status, "delivered");
});

test("delivery projection never changes commercial state columns on the opportunity", async () => {
  const conversation = await seedConversation("opportunity-invariants");
  const opportunityId = await seedOpportunity({ conversationCaseId: conversation.conversationId, waId: conversation.waId, label: "opportunity-invariants" });
  const providerMessageId = `wamid.${uniqueSuffix("opportunity-invariants")}`;
  await seedSentOutboxMessage({ conversation, opportunityId, providerMessageId, label: "opportunity-invariants" });

  const before = await loadOpportunityProjection(opportunityId);
  await applyMetaDeliveryStatus({ providerMessageId, status: "delivered", occurredAt: new Date().toISOString(), rawPayload: {} });
  const after = await loadOpportunityProjection(opportunityId);

  assert.equal(after.status, before.status);
  assert.equal(after.stage, before.stage);
  assert.equal(after.temperature, before.temperature);
  assert.equal(after.priority, before.priority);
  assert.equal(after.waiting_for, before.waiting_for);
  assert.equal(after.next_action_type, before.next_action_type);
});

test("an unresolvable opportunity produces a controlled warning without a false attribution", async () => {
  const conversation = await seedConversation("opportunity-missing");
  const providerMessageId = `wamid.${uniqueSuffix("opportunity-missing")}`;
  // A bogus opportunity id that does not exist in crm_opportunities.
  await seedSentOutboxMessage({ conversation, opportunityId: 999999999, providerMessageId, label: "opportunity-missing" });

  const result = await applyMetaDeliveryStatus({ providerMessageId, status: "delivered", occurredAt: new Date().toISOString(), rawPayload: {} });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.opportunityProjectionApplied, false);
    assert.match(result.warning ?? "", /opportunity_projection/);
  }
});

// --- A/B metadata attribution -----------------------------------------------

test("an outcome copies the experiment attribution carried by its outbox row", async () => {
  const conversation = await seedConversation("experiment-copy");
  const planned = await createOutboxPlannedRecord({
    dedupeKeyInput: {
      source: "brain",
      actionType: "send_whatsapp_message",
      channel: "whatsapp",
      waId: conversation.waId,
      phoneNumberId: conversation.phoneNumberId,
      conversationCaseId: conversation.conversationId,
      messageText: "Mensaje con experimento",
      sourceRequestId: uniqueSuffix("experiment")
    },
    status: "sent",
    source: "brain",
    waId: conversation.waId,
    phoneNumberId: conversation.phoneNumberId,
    conversationCaseId: conversation.conversationId,
    messageText: "Mensaje con experimento",
    experiment: {
      experimentId: "exp-outcome-1",
      variantId: "variant-b",
      templateId: "tmpl-2",
      promptVersion: "p2",
      contentHash: "hash-2"
    }
  });
  assert.ok(planned.ok, planned.ok ? "" : planned.warning);
  const outboxId = planned.row.id as number;
  const providerMessageId = `wamid.${uniqueSuffix("experiment-copy")}`;
  await seedOutboundConversationMessage(conversation.conversationId, providerMessageId);
  await queryRows("UPDATE brain_message_outbox SET provider_message_id = ?, status = 'sent' WHERE id = ?", [providerMessageId, outboxId]);

  await applyMetaDeliveryStatus({ providerMessageId, status: "delivered", occurredAt: new Date().toISOString(), rawPayload: {} });

  const outcomes = await safeQueryRows<{ metadata_json: unknown }>(
    "SELECT metadata_json FROM crm_action_outcomes WHERE outbox_message_id = ? AND outcome_type = 'delivered' LIMIT 1",
    [outboxId]
  );
  assert.ok(outcomes.ok && outcomes.rows[0]);
  const metadata = outcomes.rows[0]!.metadata_json;
  const parsed = typeof metadata === "string" ? JSON.parse(metadata) : metadata;
  assert.deepEqual(parsed.experiment, {
    experiment_id: "exp-outcome-1",
    variant_id: "variant-b",
    template_id: "tmpl-2",
    prompt_version: "p2",
    content_hash: "hash-2"
  });
});

test("absence of experimental metadata does not break the delivery outcome", async () => {
  const conversation = await seedConversation("no-experiment-outcome");
  const providerMessageId = `wamid.${uniqueSuffix("no-experiment-outcome")}`;
  const outboxId = await seedSentOutboxMessage({ conversation, opportunityId: null, providerMessageId, label: "no-experiment-outcome" });

  const result = await applyMetaDeliveryStatus({ providerMessageId, status: "delivered", occurredAt: new Date().toISOString(), rawPayload: {} });
  assert.equal(result.ok, true);
  assert.equal(await countOutcomes(outboxId, "delivered"), 1);
});
