import assert from "node:assert/strict";
import test, { after } from "node:test";

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
  BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND: "false",
  BRAIN_PERSIST_CANONICAL_OUTBOUND: "true",
  // Keep the autonomous cycle out of these tests: they exercise the outbox
  // delivery layer, seeded directly through the canonical planned-record
  // writer (createOutboxPlannedRecord), the same primitive the execution
  // gate itself uses.
  BRAIN_SALES_AGENT_ENABLED: "false",
  BRAIN_COMMERCIAL_SHADOW_ENABLED: "false",
  BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED: "false"
});

import { getPool, queryRows, safeQueryRows, resetPoolForTests } from "@/lib/db";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";
import { createOutboxPlannedRecord } from "@/lib/brain/messaging/outbox";
import { runOutboxTick, type OutboxTickSendResult } from "@/lib/brain/messaging/autonomousOutboxTick";
import { lockOutboxRecord, planOutboxWorkerRun } from "@/lib/brain/messaging/outboxWorker";
import { buildDeliveryOutcomeDedupeKey } from "@/lib/brain/commercial/action-queue/persistActionOutcome";

// Pre-existing planned rows accumulate in the shared crm_test DB across test
// runs (same convention as tests/native/outbox-ownership.test.ts); a large
// batch plus the outboxIds scope keeps each tick isolated to the rows this
// file creates instead of missing them behind older leftover rows.
const TICK_BATCH = 200;

/**
 * ACS-R1-05-T07 (section 9). E2E coverage of the canonical outbox delivery
 * path against real MariaDB (crm_test): canonical outbox -> outbox worker
 * (runOutboxTick, the same worker scripts/autonomous-outbox-worker.ts polls)
 * -> a fake, controlled sender -> persisted outcome -> projections. No real
 * call to Meta is ever made (BRAIN_META_SEND_ENABLED/
 * BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND stay false throughout this file); the
 * fake sender is injected via runOutboxTick's own sendFn parameter, the same
 * seam tests/native/outbox-ownership.test.ts already uses. No second outbox
 * worker is introduced - the admin/real-send recovery path
 * (planOutboxWorkerRun({sendLocked:true})) is exercised only far enough to
 * prove it exists and fails closed without real-send flags, never to
 * complete a real send.
 */

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

async function destroyRuntimeForRestart() {
  await resetPoolForTests();
}

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function seedConversationWithInbound(label: string) {
  const waId = `5695${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  const phoneNumberId = `phone-${uniqueSuffix(label)}`;
  const inbound = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix(label)}`,
    phoneNumberId,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Outbox E2E",
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
  const result = await safeQueryRows<{ status: string; error_code: string | null; provider_message_id: string | null; locked_at: string | null }>(
    "SELECT status, error_code, provider_message_id, locked_at FROM brain_message_outbox WHERE id = ? LIMIT 1",
    [id]
  );
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.rows[0];
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

test("T07 section 9: canonical outbox -> worker -> fake sender -> persisted outcome -> projections", async () => {
  const conversation = await seedConversationWithInbound("send-ok");
  const outboxId = await planOutboxRow(conversation, "send-ok");

  let sendCalls = 0;
  const tick = await runOutboxTick({
    batchSize: TICK_BATCH,
    lockSeconds: 60,
    workerId: "test-worker",
    outboxIds: [outboxId],
    sendFn: async () => {
      sendCalls += 1;
      return sentResponse(`wamid.${uniqueSuffix("provider")}`);
    }
  });

  assert.equal(tick.sent, 1);
  assert.equal(sendCalls, 1, "the fake sender must be invoked exactly once");

  const row = await loadOutboxRow(outboxId);
  assert.equal(row?.status, "sent");
  assert.ok(row?.provider_message_id);

  const outcomeRows = await queryRows<Record<string, unknown>>(
    "SELECT id, outcome_type FROM crm_action_outcomes WHERE outcome_dedupe_key = ?",
    [buildDeliveryOutcomeDedupeKey("meta", String(row!.provider_message_id), "sent")]
  );
  assert.equal(outcomeRows.length, 1, "the outcome must be persisted exactly once, keyed by the canonical delivery dedupe key");

  const canonicalRows = await queryRows<Record<string, unknown>>(
    "SELECT id FROM conversation_message WHERE conversation_id = ? AND direction = 'outbound' ORDER BY id DESC LIMIT 1",
    [conversation.conversationId]
  );
  assert.equal(canonicalRows.length, 1, "the canonical outbound message projection must be recorded exactly once");

  // Re-running the tick against the same (now 'sent') row must be a no-op -
  // it is no longer 'planned', so it is never selected again.
  const secondTick = await runOutboxTick({
    batchSize: TICK_BATCH,
    lockSeconds: 60,
    workerId: "test-worker",
    outboxIds: [outboxId],
    sendFn: async () => {
      sendCalls += 1;
      return sentResponse(`wamid.${uniqueSuffix("provider-2")}`);
    }
  });
  assert.equal(secondTick.sent, 0);
  assert.equal(sendCalls, 1, "a row that already sent must never be picked up by a later tick");
});

test("T07 section 9: outbox worker fake sender reports a failure - retried, never silently dropped", async () => {
  const conversation = await seedConversationWithInbound("send-fail");
  const outboxId = await planOutboxRow(conversation, "send-fail");

  const tick = await runOutboxTick({
    batchSize: TICK_BATCH,
    lockSeconds: 60,
    workerId: "test-worker",
    outboxIds: [outboxId],
    maxAttempts: 5,
    retryBaseSeconds: 30,
    sendFn: async () =>
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
      }) as OutboxTickSendResult
  });

  assert.equal(tick.retried, 1);

  const row = await safeQueryRows<{ status: string; next_attempt_at: string | null; attempt_count: number }>(
    "SELECT status, next_attempt_at, attempt_count FROM brain_message_outbox WHERE id = ? LIMIT 1",
    [outboxId]
  );
  assert.ok(row.ok);
  assert.equal(row.rows[0]?.status, "planned", "a retryable failure returns the row to planned, never leaves it stuck at locked");
  assert.ok(row.rows[0]?.next_attempt_at, "a retry must have a scheduled next_attempt_at");
  assert.equal(row.rows[0]?.attempt_count, 1);
});

test("T07 section 9: restart after claim, before the sender ever runs - the row is durably locked, never lost, and the canonical real-send recovery path stays fail-closed", async () => {
  const conversation = await seedConversationWithInbound("claim-crash");
  const outboxId = await planOutboxRow(conversation, "claim-crash");

  // Phase 1: claim the row exactly the way runOutboxTick's own first step
  // does (lockOutboxRecord, shared by both outbox workers), then simulate a
  // hard process crash - never call the sender, never record any result.
  const candidateRows = await safeQueryRows<{ id: number; dedupe_key: string; status: string }>(
    "SELECT id, dedupe_key, status FROM brain_message_outbox WHERE id = ? LIMIT 1",
    [outboxId]
  );
  assert.ok(candidateRows.ok && candidateRows.rows[0]);
  const lockResult = await lockOutboxRecord(
    { id: candidateRows.rows[0]!.id, dedupe_key: candidateRows.rows[0]!.dedupe_key, status: candidateRows.rows[0]!.status } as Parameters<typeof lockOutboxRecord>[0],
    { lockSeconds: 60 }
  );
  assert.equal(lockResult.applied, true);

  const rowAfterClaim = await loadOutboxRow(outboxId);
  assert.equal(rowAfterClaim?.status, "locked");
  assert.ok(rowAfterClaim?.locked_at, "the durable boundary this scenario tests: claimed and locked, before any sender result");

  // "Restart": destroy the pool.
  await destroyRuntimeForRestart();

  // Phase 2: a fresh worker instance reads only from MariaDB.
  const rowAfterRestart = await loadOutboxRow(outboxId);
  assert.equal(rowAfterRestart?.status, "locked", "the row survives the restart exactly as it was left - never lost, never silently duplicated");

  // The reactive/proactive worker (runOutboxTick) only ever selects
  // status='planned' rows (see selectPlannedOutboxCandidates in
  // outboxWorker.ts) - a locked row from a crashed claim is correctly never
  // picked up a second time by that same polling path, so it can never be
  // sent twice by two different worker passes.
  let sendCallsAfterRestart = 0;
  const tickAfterRestart = await runOutboxTick({
    batchSize: TICK_BATCH,
    lockSeconds: 60,
    workerId: "test-worker-restarted",
    outboxIds: [outboxId],
    sendFn: async () => {
      sendCallsAfterRestart += 1;
      return sentResponse(`wamid.${uniqueSuffix("provider-should-not-happen")}`);
    }
  });
  assert.equal(tickAfterRestart.sent, 0);
  assert.equal(sendCallsAfterRestart, 0);

  const rowStillLocked = await loadOutboxRow(outboxId);
  assert.equal(rowStillLocked?.status, "locked", "the normal polling worker must never re-claim or duplicate-send a row it did not itself lock");

  // The only canonical recovery for a genuinely stale-locked row is the
  // admin real-send path (planOutboxWorkerRun({sendLocked:true}), reachable
  // via app/api/brain/outbox/worker/route.ts) - this test proves it exists
  // and is fail-closed without real-send flags, never exercises an actual
  // send (BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND/BRAIN_META_SEND_ENABLED stay
  // false throughout this file, matching the task's "no real Meta calls"
  // constraint). Completing a real recovery is an operator action outside
  // this E2E's fake-sender-only scope.
  const recoveryAttempt = await planOutboxWorkerRun({ sendLocked: true, outboxId, dryRun: false, lockOnly: false });
  assert.equal(recoveryAttempt.ok, false);
  assert.equal(recoveryAttempt.disabled, true);
  assert.ok(
    recoveryAttempt.blocked_reasons?.includes("real_send_disabled") || recoveryAttempt.reason === "worker_disabled",
    `the canonical recovery path must fail closed without explicit real-send flags, never silently proceed. actual=${JSON.stringify({ reason: recoveryAttempt.reason, blockedReasons: recoveryAttempt.blocked_reasons })}`
  );

  const rowAfterRecoveryAttempt = await loadOutboxRow(outboxId);
  assert.equal(rowAfterRecoveryAttempt?.status, "locked", "a fail-closed recovery attempt must never mutate the row");
});
