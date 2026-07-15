import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { after } from "node:test";
import { getPool, safeQueryRows } from "@/lib/db";
import { writeCanonicalOutboxMessage, buildCanonicalOutboxDedupeKey, BRAIN_MESSAGE_OUTBOX_TABLE } from "@/lib/brain/messaging/canonicalOutboxWriter";
import { createOutboxPlannedRecord } from "@/lib/brain/messaging/outbox";
import { SqlExecutionUnitOfWork } from "@/lib/brain/commercial/execution-gate/sqlExecutionUnitOfWork";
import type { CanonicalOutboxCommand } from "@/lib/brain/commercial/execution-gate/types";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";

// ACS-R1-05-T04 (P1-4): both brain_message_outbox writers (the legacy
// outbox.ts adapter and the execution-gate SqlExecutionUnitOfWork adapter)
// must delegate to a single canonical writer with a single INSERT, a single
// column normalization and a single phone_number_id resolution.

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
    text: "Hola",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });
  assert.equal(inbound.duplicate, false);
  return { waId, phoneNumberId, conversationId: inbound.conversationId as number };
}

async function loadOutboxByDedupeKey(dedupeKey: string) {
  const rows = await safeQueryRows<{
    id: number;
    dedupe_key: string;
    phone_number_id: string | null;
    source_agent_name: string | null;
    meta_payload_json: unknown;
  }>(`SELECT id, dedupe_key, phone_number_id, source_agent_name, meta_payload_json FROM \`${BRAIN_MESSAGE_OUTBOX_TABLE}\` WHERE dedupe_key = ? LIMIT 1`, [dedupeKey]);
  assert.ok(rows.ok, rows.ok ? "" : rows.error);
  return rows.rows[0] ?? null;
}

function buildCommand(input: {
  idempotencyKey: string;
  recipient: string;
  conversationCaseId: number | string | null;
  opportunityId: number | string | null;
  messageText?: string;
}): CanonicalOutboxCommand {
  return {
    commandId: input.idempotencyKey,
    idempotencyKey: input.idempotencyKey,
    actionId: `action-${input.idempotencyKey}`,
    opportunityId: input.opportunityId,
    decisionId: null,
    conversationCaseId: input.conversationCaseId,
    channel: "whatsapp",
    commandType: "whatsapp_text",
    recipient: input.recipient,
    messageText: input.messageText ?? "Mensaje de prueba del execution gate.",
    metadata: {
      source: "ai_sdr",
      sandbox: true,
      riskLevel: "low",
      approvalRequirement: "none",
      lifecycleVersion: "v1",
      policyVersion: "v1",
      runtimeVersion: "v1"
    },
    createdAt: new Date().toISOString()
  };
}

test("neither outbox adapter keeps its own INSERT SQL - both delegate to the canonical writer", () => {
  const outboxSource = readFileSync(path.resolve("lib/brain/messaging/outbox.ts"), "utf8");
  const gateSource = readFileSync(path.resolve("lib/brain/commercial/execution-gate/sqlExecutionUnitOfWork.ts"), "utf8");

  assert.doesNotMatch(outboxSource, /INSERT\s+(IGNORE\s+)?INTO/i);
  assert.doesNotMatch(gateSource, /INSERT\s+(IGNORE\s+)?INTO/i);
  assert.match(outboxSource, /writeCanonicalOutboxMessage/);
  assert.match(gateSource, /writeCanonicalOutboxMessage/);
});

test("standalone canonical write: same dedupe key inserts once, then reuses the row", async () => {
  const dedupeKey = `brain-outbox-test-${uniqueSuffix("standalone")}`;
  const input = {
    dedupeKey,
    status: "planned" as const,
    source: "brain",
    sourceRequestId: null,
    sourceAgentName: "test",
    sourceAgentVersion: "v1",
    waId: "56900000000",
    phoneNumberId: "phone-explicit",
    conversationCaseId: null,
    messageText: "Hola",
    metaPayloadJson: null,
    providerMessageId: null,
    errorCode: null,
    errorMessage: null,
    opportunityId: null
  };

  const first = await writeCanonicalOutboxMessage(input);
  assert.equal(first.inserted, true);
  assert.equal(first.duplicate, false);

  const second = await writeCanonicalOutboxMessage(input);
  assert.equal(second.inserted, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.rowId, first.rowId);
});

test("two concurrent standalone writes with the same dedupe key leave exactly one row", async () => {
  const dedupeKey = `brain-outbox-test-${uniqueSuffix("concurrent")}`;
  const input = {
    dedupeKey,
    status: "planned" as const,
    source: "brain",
    sourceRequestId: null,
    sourceAgentName: "test",
    sourceAgentVersion: "v1",
    waId: "56900000001",
    phoneNumberId: "phone-explicit",
    conversationCaseId: null,
    messageText: "Hola concurrente",
    metaPayloadJson: null,
    providerMessageId: null,
    errorCode: null,
    errorMessage: null,
    opportunityId: null
  };

  const [a, b] = await Promise.all([writeCanonicalOutboxMessage(input), writeCanonicalOutboxMessage(input)]);
  assert.equal(a.rowId, b.rowId);
  assert.equal([a.inserted, b.inserted].filter(Boolean).length, 1);

  const rows = await safeQueryRows<{ total: number }>(`SELECT COUNT(*) AS total FROM \`${BRAIN_MESSAGE_OUTBOX_TABLE}\` WHERE dedupe_key = ?`, [dedupeKey]);
  assert.ok(rows.ok);
  assert.equal(Number(rows.rows[0].total), 1);
});

test("legacy adapter (createOutboxPlannedRecord) resolves phone_number_id from the conversation when not explicit", async () => {
  const conversation = await seedConversation("legacy-phone");

  const result = await createOutboxPlannedRecord({
    dedupeKeyInput: {
      source: "brain",
      actionType: "send_whatsapp_message",
      channel: "whatsapp",
      waId: conversation.waId,
      conversationCaseId: conversation.conversationId,
      sourceRequestId: uniqueSuffix("legacy-phone")
    },
    status: "planned",
    source: "brain",
    waId: conversation.waId,
    phoneNumberId: null,
    conversationCaseId: conversation.conversationId,
    messageText: "Mensaje sin phoneNumberId explicito"
  });

  assert.ok(result.ok, result.ok ? "" : result.warning);
  assert.equal(result.row.phone_number_id, conversation.phoneNumberId);
});

test("execution-gate adapter (SqlExecutionUnitOfWork) persists through the same writer with consistent columns", async () => {
  const conversation = await seedConversation("gate-adapter");
  const command = buildCommand({
    idempotencyKey: `outbox:action:test:${uniqueSuffix("gate")}`,
    recipient: conversation.waId,
    conversationCaseId: conversation.conversationId,
    opportunityId: 4242
  });

  const uow = new SqlExecutionUnitOfWork();
  const insertResult = await uow.run(({ outbox }) => outbox.insertCommand(command));
  assert.equal(insertResult.inserted, true);
  assert.equal(insertResult.duplicate, false);

  const row = await loadOutboxByDedupeKey(command.idempotencyKey);
  assert.ok(row);
  assert.equal(row!.phone_number_id, conversation.phoneNumberId);
  const metaPayload = row!.meta_payload_json as Record<string, unknown> | string;
  const parsed = typeof metaPayload === "string" ? JSON.parse(metaPayload) : metaPayload;
  assert.equal(parsed.opportunity_id, 4242);
});

test("execution-gate adapter reuses the existing rowId on retry instead of inserting twice", async () => {
  const conversation = await seedConversation("gate-retry");
  const command = buildCommand({
    idempotencyKey: `outbox:action:test:${uniqueSuffix("gate-retry")}`,
    recipient: conversation.waId,
    conversationCaseId: conversation.conversationId,
    opportunityId: null
  });

  const uow = new SqlExecutionUnitOfWork();
  const first = await uow.run(({ outbox }) => outbox.insertCommand(command));
  const second = await uow.run(({ outbox }) => outbox.insertCommand(command));

  assert.equal(first.inserted, true);
  assert.equal(second.inserted, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.rowId, first.rowId);
});

test("rollback of the execution unit of work reverts the outbox insert", async () => {
  const conversation = await seedConversation("gate-rollback");
  const command = buildCommand({
    idempotencyKey: `outbox:action:test:${uniqueSuffix("gate-rollback")}`,
    recipient: conversation.waId,
    conversationCaseId: conversation.conversationId,
    opportunityId: null
  });

  const uow = new SqlExecutionUnitOfWork();
  await assert.rejects(
    uow.run(async ({ outbox }) => {
      await outbox.insertCommand(command);
      throw new Error("forced_rollback");
    })
  );

  const row = await loadOutboxByDedupeKey(command.idempotencyKey);
  assert.equal(row, null);
});

test("env fallback resolves phone_number_id when there is no explicit value and no conversation", async () => {
  const previous = process.env.META_WHATSAPP_DEFAULT_PHONE_NUMBER_ID;
  process.env.META_WHATSAPP_DEFAULT_PHONE_NUMBER_ID = "phone-env-fallback";
  try {
    const dedupeKey = `brain-outbox-test-${uniqueSuffix("env-fallback")}`;
    const result = await writeCanonicalOutboxMessage({
      dedupeKey,
      status: "planned",
      source: "brain",
      sourceRequestId: null,
      sourceAgentName: "test",
      sourceAgentVersion: "v1",
      waId: "56900000002",
      phoneNumberId: null,
      conversationCaseId: null,
      messageText: "Hola env fallback",
      metaPayloadJson: null,
      providerMessageId: null,
      errorCode: null,
      errorMessage: null,
      opportunityId: null
    });
    assert.equal(result.row.phone_number_id, "phone-env-fallback");
  } finally {
    if (previous === undefined) delete process.env.META_WHATSAPP_DEFAULT_PHONE_NUMBER_ID;
    else process.env.META_WHATSAPP_DEFAULT_PHONE_NUMBER_ID = previous;
  }
});

test("A/B metadata round-trip: experiment attribution survives the canonical write", async () => {
  const dedupeKey = `brain-outbox-test-${uniqueSuffix("experiment")}`;
  const result = await writeCanonicalOutboxMessage({
    dedupeKey,
    status: "planned",
    source: "brain",
    sourceRequestId: null,
    sourceAgentName: "test",
    sourceAgentVersion: "v1",
    waId: "56900000003",
    phoneNumberId: "phone-explicit",
    conversationCaseId: null,
    messageText: "Hola con experimento",
    metaPayloadJson: null,
    providerMessageId: null,
    errorCode: null,
    errorMessage: null,
    opportunityId: null,
    experiment: {
      experimentId: "exp-1",
      variantId: "variant-a",
      templateId: "tmpl-1",
      promptVersion: "p1",
      contentHash: "hash-1"
    }
  });

  assert.ok(result.row.meta_payload_json);
  assert.deepEqual(result.row.meta_payload_json!.experiment, {
    experiment_id: "exp-1",
    variant_id: "variant-a",
    template_id: "tmpl-1",
    prompt_version: "p1",
    content_hash: "hash-1"
  });
});

test("absence of experimental metadata does not break the send or dedupe key", async () => {
  const dedupeKey = `brain-outbox-test-${uniqueSuffix("no-experiment")}`;
  const result = await writeCanonicalOutboxMessage({
    dedupeKey,
    status: "planned",
    source: "brain",
    sourceRequestId: null,
    sourceAgentName: "test",
    sourceAgentVersion: "v1",
    waId: "56900000004",
    phoneNumberId: "phone-explicit",
    conversationCaseId: null,
    messageText: "Hola sin experimento",
    metaPayloadJson: null,
    providerMessageId: null,
    errorCode: null,
    errorMessage: null,
    opportunityId: null
  });
  assert.equal(result.inserted, true);
  assert.equal(result.row.meta_payload_json, null);
});

// --- Canonical dedupe parity across adapters (ACS-R1-05-T04.1, P1-4) -------

test("both adapters compute the same dedupe_key for the same logical command and collapse to one row", async () => {
  const actionId = `shared-action-${uniqueSuffix("parity")}`;
  // actionType is a fixed enum (BrainExecutionActionType) in the legacy
  // adapter's real input shape - it stands in for `idempotencyKey` in the
  // canonical identity, exactly as production callers already use it.
  const idempotencyKeyComponent = "send_whatsapp_message" as const;
  const recipient = "56900000010";
  const content = "Mismo contenido logico entre adapters";

  const expectedKey = buildCanonicalOutboxDedupeKey({
    channel: "whatsapp",
    actionId,
    idempotencyKey: idempotencyKeyComponent,
    recipient,
    content
  });

  // Legacy adapter: sourceRequestId stands in for actionId, actionType for idempotencyKey.
  const legacyResult = await createOutboxPlannedRecord({
    dedupeKeyInput: {
      source: "brain",
      actionType: idempotencyKeyComponent,
      channel: "whatsapp",
      waId: recipient,
      sourceRequestId: actionId
    },
    status: "planned",
    source: "brain",
    sourceRequestId: actionId,
    waId: recipient,
    phoneNumberId: "phone-parity",
    messageText: content
  });
  assert.ok(legacyResult.ok, legacyResult.ok ? "" : legacyResult.warning);
  assert.equal(legacyResult.row.dedupe_key, expectedKey);

  // Execution-gate adapter: identical actionId/idempotencyKey/recipient/content/channel.
  const command = buildCommand({
    idempotencyKey: expectedKey,
    recipient,
    conversationCaseId: null,
    opportunityId: null,
    messageText: content
  });
  const uow = new SqlExecutionUnitOfWork();
  const gateResult = await uow.run(({ outbox }) => outbox.insertCommand(command));

  assert.equal(gateResult.duplicate, true);
  assert.equal(gateResult.inserted, false);
  assert.equal(gateResult.rowId, legacyResult.row.id);

  const rows = await safeQueryRows<{ total: number }>(`SELECT COUNT(*) AS total FROM \`${BRAIN_MESSAGE_OUTBOX_TABLE}\` WHERE dedupe_key = ?`, [expectedKey]);
  assert.ok(rows.ok);
  assert.equal(Number(rows.rows[0].total), 1);
});

test("concurrent adapters (legacy + execution-gate) with the same logical command leave exactly one row", async () => {
  const actionId = `shared-action-${uniqueSuffix("concurrent-parity")}`;
  const idempotencyKeyComponent = "send_whatsapp_message" as const;
  const recipient = "56900000011";
  const content = "Contenido identico enviado por ambos adapters a la vez";

  const expectedKey = buildCanonicalOutboxDedupeKey({
    channel: "whatsapp",
    actionId,
    idempotencyKey: idempotencyKeyComponent,
    recipient,
    content
  });

  const command = buildCommand({
    idempotencyKey: expectedKey,
    recipient,
    conversationCaseId: null,
    opportunityId: null,
    messageText: content
  });
  const uow = new SqlExecutionUnitOfWork();

  const [legacyResult, gateResult] = await Promise.all([
    createOutboxPlannedRecord({
      dedupeKeyInput: {
        source: "brain",
        actionType: idempotencyKeyComponent,
        channel: "whatsapp",
        waId: recipient,
        sourceRequestId: actionId
      },
      status: "planned",
      source: "brain",
      sourceRequestId: actionId,
      waId: recipient,
      phoneNumberId: "phone-concurrent-parity",
      messageText: content
    }),
    uow.run(({ outbox }) => outbox.insertCommand(command))
  ]);

  assert.ok(legacyResult.ok, legacyResult.ok ? "" : legacyResult.warning);
  assert.equal(legacyResult.row.dedupe_key, expectedKey);
  assert.equal(legacyResult.row.id, gateResult.rowId);

  const insertedCount = [legacyResult.persisted, gateResult.inserted].filter(Boolean).length;
  assert.equal(insertedCount, 1);

  const rows = await safeQueryRows<{ total: number }>(`SELECT COUNT(*) AS total FROM \`${BRAIN_MESSAGE_OUTBOX_TABLE}\` WHERE dedupe_key = ?`, [expectedKey]);
  assert.ok(rows.ok);
  assert.equal(Number(rows.rows[0].total), 1);
});
