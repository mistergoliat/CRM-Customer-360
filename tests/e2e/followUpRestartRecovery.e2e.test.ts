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
  BRAIN_COMMERCIAL_POLICY_ENABLED: "true"
});

import { getPool, queryRows, safeExecute, safeQueryRows, resetPoolForTests } from "@/lib/db";
import {
  runFollowupTick,
  shouldCancelFollowUp,
  type FollowUpCandidate
} from "@/lib/brain/commercial/followup/runFollowupTick";
import { FOLLOW_UP_STALE_EXECUTING_LOCK_SECONDS, FOLLOW_UP_STALE_EXECUTION_EXHAUSTED_REASON } from "@/lib/brain/commercial/followup/followUpWorkerPolicy";
import { createSalesConsultativeOperationsRepository } from "@/lib/brain/commercial/sales-consultative/repository";
import type { SalesConsultativeOpportunity } from "@/lib/brain/commercial/sales-consultative/types";
import type { runNativeAutonomousCycle, NativeAutonomousCycleResult } from "@/lib/brain/commercial/native-cycle";

/**
 * ACS-R1-05-T07. E2E follow-up runtime coverage (T07-E10..E14): the durable
 * canonical route (sales-consultative -> planCommercialFollowUp ->
 * crm_agent_actions -> runFollowupTick) against real MariaDB (crm_test),
 * including stale-lock recovery, exhaustion, cancellation on a customer
 * reply, and human-ownership blocking - a real process restart is simulated
 * by destroying the DB pool and reading only from MariaDB in phase 2.
 */

const FIXED_NOW_ISO = "2026-01-15T18:00:00.000Z";
const FIXED_NOW_MS = Date.parse(FIXED_NOW_ISO);

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

function randomWaId() {
  return `5693${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
}

async function seedConversation(waId: string, overrides: { humanOwnerActive?: boolean } = {}) {
  const publicId = uniqueSuffix("conv");
  const insert = await safeExecute(
    `INSERT INTO conversation (
        public_id, channel, provider, channel_account_id, external_contact_id, customer_id,
        status, ai_enabled, human_owner_active, created_at, updated_at, last_message_at
      ) VALUES (?, 'whatsapp', 'meta', ?, ?, NULL, 'open', 1, ?, NOW(3), NOW(3), NOW(3))`,
    [publicId, `phone-${uniqueSuffix("pnid")}`, waId, overrides.humanOwnerActive ? 1 : 0]
  );
  assert.ok(insert.ok, insert.ok ? "" : insert.error);
  const row = await safeQueryRows<{ id: number }>("SELECT id FROM conversation WHERE public_id = ? LIMIT 1", [publicId]);
  assert.ok(row.ok && row.rows[0]?.id, row.ok ? "missing seeded conversation id" : row.error);
  return { id: row.rows[0]!.id, publicId };
}

async function seedOpportunity(waId: string): Promise<{ id: number; waId: string; opportunityKey: string }> {
  const opportunityKey = `test-followup-e2e-${uniqueSuffix("opp")}`;
  await queryRows(
    `INSERT INTO crm_opportunities (
        opportunity_key, wa_id, channel, primary_intent, status, stage,
        requirements_json, missing_requirements_json, product_interests_json, objections_json, signals_json
      ) VALUES (?, ?, 'whatsapp', 'product_inquiry', 'engaged', 'recommendation', '[]', '[]', '[]', '[]', '[]')`,
    [opportunityKey, waId]
  );
  const row = await safeQueryRows<{ id: number }>("SELECT id FROM crm_opportunities WHERE opportunity_key = ? LIMIT 1", [opportunityKey]);
  assert.ok(row.ok && row.rows[0]?.id, row.ok ? "missing seeded opportunity id" : row.error);
  return { id: row.rows[0]!.id, waId, opportunityKey };
}

function buildOpportunity(input: { id: number | null; waId: string; opportunityKey: string; lastActivityAt: string }): SalesConsultativeOpportunity {
  return {
    id: input.id,
    opportunityKey: input.opportunityKey,
    status: "engaged",
    stage: "recommendation",
    primaryIntent: "product_inquiry",
    currentSummary: "Cliente pregunto por el producto, sin cerrar aun.",
    nextActionType: "schedule_follow_up",
    nextActionDueAt: null,
    waitingFor: null,
    humanOwnerActive: false,
    aiBlocked: false,
    customerCandidateId: null,
    customerMasterId: null,
    leadId: null,
    conversationCaseId: null,
    waId: input.waId,
    requirements: [],
    missingRequirements: [],
    productInterests: [],
    objections: [],
    signals: [],
    version: 1,
    lastActivityAt: input.lastActivityAt,
    closedAt: null
  };
}

async function loadFollowUpRowsForOpportunity(opportunityId: number) {
  const result = await safeQueryRows<Record<string, unknown>>(
    "SELECT * FROM crm_agent_actions WHERE opportunity_id = ? AND action_type = 'schedule_followup' ORDER BY id ASC",
    [opportunityId]
  );
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.rows;
}

async function setActionState(actionId: string, input: { status: string; attemptNumber?: number; maxAttempts?: number; updatedAt?: Date; conversationCaseId?: number | null; waId?: string | null }): Promise<void> {
  const updatedAt = input.updatedAt ?? new Date();
  const result = await safeExecute(
    `UPDATE crm_agent_actions
      SET status = ?,
          attempt_number = COALESCE(?, attempt_number),
          max_attempts = COALESCE(?, max_attempts),
          conversation_case_id = COALESCE(?, conversation_case_id),
          wa_id = COALESCE(?, wa_id),
          updated_at = ?
      WHERE action_id = ?`,
    [
      input.status,
      input.attemptNumber ?? null,
      input.maxAttempts ?? null,
      input.conversationCaseId ?? null,
      input.waId ?? null,
      updatedAt.toISOString().slice(0, 19).replace("T", " "),
      actionId
    ]
  );
  assert.ok(result.ok, result.ok ? "" : result.error);
}

/** createFollowUpAction's returned `actionId` is the numeric crm_agent_actions.id, never the action_id string column - resolve the real action_id from the row it just created. */
async function resolveActionIdByRowId(rowId: number | string): Promise<string> {
  const result = await safeQueryRows<{ action_id: string }>("SELECT action_id FROM crm_agent_actions WHERE id = ? LIMIT 1", [rowId]);
  assert.ok(result.ok && result.rows[0]?.action_id, result.ok ? "missing action_id for seeded row" : result.error);
  return result.rows[0]!.action_id;
}

async function loadAction(actionId: string) {
  const result = await safeQueryRows<Record<string, unknown>>(
    "SELECT * FROM crm_agent_actions WHERE action_id = ? LIMIT 1",
    [actionId]
  );
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.rows[0] ?? null;
}

function createCountingCycleRunner(): { runner: typeof runNativeAutonomousCycle; calls: string[] } {
  const calls: string[] = [];
  const runner: typeof runNativeAutonomousCycle = async (input): Promise<NativeAutonomousCycleResult> => {
    calls.push(input.correlationId);
    return { ran: true, shadow: null, loop: null, bridge: null, warnings: [] };
  };
  return { runner, calls };
}

const STALE_UPDATED_AT = new Date(FIXED_NOW_MS - (FOLLOW_UP_STALE_EXECUTING_LOCK_SECONDS + 120) * 1000);

test("T07-E10: follow-up normal - canonical route, exact claim, correct attempt_number, cycle runner invoked, coherent final state, no parallel planner", async () => {
  const waId = randomWaId();
  const seed = await seedOpportunity(waId);
  const opportunity = buildOpportunity({ ...seed, lastActivityAt: new Date(FIXED_NOW_MS - 2 * 24 * 60 * 60 * 1000).toISOString() });
  const conversation = await seedConversation(waId);
  const repo = createSalesConsultativeOperationsRepository();

  const dueAt = new Date(FIXED_NOW_MS - 60 * 1000).toISOString(); // already due
  const created = await repo.createFollowUpAction({
    opportunity,
    actionType: "schedule_follow_up",
    dueAt,
    messageText: "Seguimos en contacto para tu jaula de potencia.",
    currentTime: FIXED_NOW_ISO,
    metadata: null
  });
  assert.equal(created.ok, true);
  assert.ok(created.actionId);
  const actionId = await resolveActionIdByRowId(created.actionId!);

  const rowsBefore = await loadFollowUpRowsForOpportunity(seed.id);
  assert.equal(rowsBefore.length, 1, "the canonical planner must create exactly one follow-up row");
  assert.equal(rowsBefore[0]!.status, "planned");
  assert.equal(rowsBefore[0]!.attempt_number, 1);

  // The canonical planner does not stamp conversation_case_id/wa_id from the
  // conversation table by itself in every path - align it here the same way
  // a real reactive turn would (both columns already exist on the row from
  // the opportunity's wa_id; conversation_case_id is what shouldCancelFollowUp
  // and the tick's own conversation lookup key off).
  await setActionState(actionId, { status: "planned", conversationCaseId: conversation.id, waId });

  const { runner, calls } = createCountingCycleRunner();
  const tickResult = await runFollowupTick({ limit: 10, actionIds: [actionId], cycleRunner: runner });

  assert.deepEqual(tickResult.executed, [actionId], `tickResult=${JSON.stringify(tickResult)}`);
  assert.equal(calls.length, 1, "runNativeAutonomousCycle (the injected cycle runner) must be invoked exactly once");

  const finalRow = await loadAction(actionId);
  assert.equal(finalRow?.status, "executed");
  assert.equal(finalRow?.attempt_number, 1, "a normal first-attempt execution never increments attempt_number");

  const rowsAfter = await loadFollowUpRowsForOpportunity(seed.id);
  assert.equal(rowsAfter.length, 1, "no parallel planner ever creates a second follow-up row for this opportunity");
});

test("T07-E11: restart with follow-up executing stale - CAS recovers exactly once, attempt_number incremented exactly once, single winner under real concurrency", async () => {
  const waId = randomWaId();
  const conversation = await seedConversation(waId);
  const seed = await seedOpportunity(waId);
  const opportunity = buildOpportunity({ ...seed, lastActivityAt: new Date(FIXED_NOW_MS - 2 * 24 * 60 * 60 * 1000).toISOString() });
  const repo = createSalesConsultativeOperationsRepository();

  const created = await repo.createFollowUpAction({
    opportunity,
    actionType: "schedule_follow_up",
    dueAt: new Date(FIXED_NOW_MS - 60 * 1000).toISOString(),
    messageText: "Seguimos en contacto.",
    currentTime: FIXED_NOW_ISO,
    metadata: null
  });
  assert.equal(created.ok, true);
  const actionId = await resolveActionIdByRowId(created.actionId!);

  // Simulate a worker that claimed this row and then crashed mid-flight:
  // status='executing', updated_at stale, attempts remaining.
  await setActionState(actionId, { status: "executing", attemptNumber: 1, maxAttempts: 3, updatedAt: STALE_UPDATED_AT, conversationCaseId: conversation.id, waId });

  // "Restart": destroy the pool.
  await destroyRuntimeForRestart();

  // Phase 2: a fresh worker instance reads only from MariaDB and recovers it.
  const { runner, calls } = createCountingCycleRunner();
  const tickResult = await runFollowupTick({ limit: 10, actionIds: [actionId], cycleRunner: runner });

  assert.deepEqual(tickResult.executed, [actionId]);
  assert.equal(calls.length, 1, "exactly one instance must run the cycle for the recovered row");

  const recovered = await loadAction(actionId);
  assert.equal(recovered?.status, "executed");
  assert.equal(recovered?.attempt_number, 2, "recovering a stale execution increments attempt_number exactly once, never twice");

  // Now prove this holds under genuine concurrency too: seed a second stale
  // row and race two workers against it with Promise.all.
  const seed2 = await seedOpportunity(randomWaId());
  const conversation2 = await seedConversation(seed2.waId);
  const opportunity2 = buildOpportunity({ ...seed2, lastActivityAt: new Date(FIXED_NOW_MS - 2 * 24 * 60 * 60 * 1000).toISOString() });
  const created2 = await repo.createFollowUpAction({
    opportunity: opportunity2,
    actionType: "schedule_follow_up",
    dueAt: new Date(FIXED_NOW_MS - 60 * 1000).toISOString(),
    messageText: "Seguimos en contacto.",
    currentTime: FIXED_NOW_ISO,
    metadata: null
  });
  assert.equal(created2.ok, true);
  const actionId2 = await resolveActionIdByRowId(created2.actionId!);
  await setActionState(actionId2, { status: "executing", attemptNumber: 1, maxAttempts: 3, updatedAt: STALE_UPDATED_AT, conversationCaseId: conversation2.id, waId: seed2.waId });

  const counterA = createCountingCycleRunner();
  const counterB = createCountingCycleRunner();
  const [tickA, tickB] = await Promise.all([
    runFollowupTick({ limit: 10, actionIds: [actionId2], cycleRunner: counterA.runner }),
    runFollowupTick({ limit: 10, actionIds: [actionId2], cycleRunner: counterB.runner })
  ]);

  const totalExecuted = tickA.executed.length + tickB.executed.length;
  const totalCalls = counterA.calls.length + counterB.calls.length;
  assert.equal(totalExecuted, 1, "exactly one of the two concurrent workers must claim and execute the stale row");
  assert.equal(totalCalls, 1, "exactly one cycle invocation across both concurrent workers");

  const recovered2 = await loadAction(actionId2);
  assert.equal(recovered2?.status, "executed");
  assert.equal(recovered2?.attempt_number, 2, "concurrent recovery still increments attempt_number exactly once");
});

test("T07-E12: follow-up exhausted - terminalized to failed, never re-entered, second tick is a no-op", async () => {
  const waId = randomWaId();
  const conversation = await seedConversation(waId);
  const seed = await seedOpportunity(waId);
  const opportunity = buildOpportunity({ ...seed, lastActivityAt: new Date(FIXED_NOW_MS - 2 * 24 * 60 * 60 * 1000).toISOString() });
  const repo = createSalesConsultativeOperationsRepository();

  const created = await repo.createFollowUpAction({
    opportunity,
    actionType: "schedule_follow_up",
    dueAt: new Date(FIXED_NOW_MS - 60 * 1000).toISOString(),
    messageText: "Seguimos en contacto.",
    currentTime: FIXED_NOW_ISO,
    metadata: null
  });
  assert.equal(created.ok, true);
  const actionId = await resolveActionIdByRowId(created.actionId!);

  // Stale, executing, and already at max_attempts - a worker crashed on its
  // final legitimate attempt.
  await setActionState(actionId, { status: "executing", attemptNumber: 3, maxAttempts: 3, updatedAt: STALE_UPDATED_AT, conversationCaseId: conversation.id, waId });

  const { runner, calls } = createCountingCycleRunner();
  const tickResult = await runFollowupTick({ limit: 10, actionIds: [actionId], cycleRunner: runner });

  assert.deepEqual(tickResult.failed, [actionId]);
  assert.equal(tickResult.executed.length, 0);
  assert.equal(calls.length, 0, "an exhausted stale execution must never re-enter the cycle runner");

  const terminalized = await loadAction(actionId);
  assert.equal(terminalized?.status, "failed");
  assert.equal(terminalized?.failure_reason, FOLLOW_UP_STALE_EXECUTION_EXHAUSTED_REASON);
  assert.equal(terminalized?.attempt_number, 3, "terminalizing an exhausted row never increments attempt_number");

  const rowsAfter = await loadFollowUpRowsForOpportunity(seed.id);
  assert.equal(rowsAfter.length, 1, "no new action is ever created for an exhausted follow-up");

  // A second tick against the same (now terminal) row must be a true no-op.
  const secondCounter = createCountingCycleRunner();
  const secondTick = await runFollowupTick({ limit: 10, actionIds: [actionId], cycleRunner: secondCounter.runner });
  assert.equal(secondTick.executed.length, 0);
  assert.equal(secondTick.failed.length, 0);
  assert.equal(secondCounter.calls.length, 0);

  const afterSecondTick = await loadAction(actionId);
  assert.equal(afterSecondTick?.status, "failed");
  assert.equal(afterSecondTick?.attempt_number, 3, "the second tick must never modify the already-terminal row");
});

test("T07-E13: customer replies between claim and revalidation - follow-up aborted, cycle runner never invoked, no proactive outbox", async () => {
  const waId = randomWaId();
  const conversation = await seedConversation(waId);
  const seed = await seedOpportunity(waId);
  const opportunity = buildOpportunity({ ...seed, lastActivityAt: new Date(FIXED_NOW_MS - 2 * 24 * 60 * 60 * 1000).toISOString() });
  const repo = createSalesConsultativeOperationsRepository();

  const created = await repo.createFollowUpAction({
    opportunity,
    actionType: "schedule_follow_up",
    dueAt: new Date(FIXED_NOW_MS - 60 * 1000).toISOString(),
    messageText: "Seguimos en contacto.",
    currentTime: FIXED_NOW_ISO,
    metadata: null
  });
  assert.equal(created.ok, true);
  const actionId = await resolveActionIdByRowId(created.actionId!);
  await setActionState(actionId, { status: "planned", conversationCaseId: conversation.id, waId });

  const { runner, calls } = createCountingCycleRunner();
  const tickResult = await runFollowupTick({
    limit: 10,
    actionIds: [actionId],
    cycleRunner: runner,
    // Deterministic race: the customer's reply lands exactly between this
    // tick's claim and its revalidation, via the existing test-only hook
    // (no sleeps, no real elapsed time).
    onAfterClaim: async (candidate: FollowUpCandidate) => {
      // shouldCancelFollowUp requires the reply's created_at to be strictly
      // after the action's own created_at - an explicit +2s offset (rather
      // than NOW(3) at both points) avoids a same-instant race that would
      // make this look like the reply arrived before the follow-up was
      // scheduled, purely a test-timing artifact, never a real ordering.
      const insertResult = await safeExecute(
        `INSERT INTO conversation_message (
            conversation_id, public_id, provider, direction, sender_type, message_type, body, status, created_at, updated_at
          ) SELECT ?, ?, 'meta', 'inbound', 'customer', 'text', 'Ya no necesito, gracias.', 'received',
              DATE_ADD(created_at, INTERVAL 2 SECOND), DATE_ADD(created_at, INTERVAL 2 SECOND)
            FROM crm_agent_actions WHERE action_id = ?`,
        [candidate.conversation_case_id, uniqueSuffix("msg"), candidate.action_id]
      );
      if (!insertResult.ok || insertResult.affectedRows === 0) {
        throw new Error(`onAfterClaim insert failed: ${JSON.stringify(insertResult)} action_id=${candidate.action_id} conv=${candidate.conversation_case_id}`);
      }
    }
  });

  assert.equal(tickResult.executed.length, 0);
  assert.equal(tickResult.cancelled.length, 1);
  assert.equal(tickResult.cancelled[0]?.actionId, actionId);
  assert.equal(tickResult.cancelled[0]?.reason, "customer_replied_since_schedule");
  assert.equal(calls.length, 0, "the cycle runner must never be invoked once a customer reply is detected");

  const finalRow = await loadAction(actionId);
  assert.equal(finalRow?.status, "cancelled");
  assert.equal(finalRow?.cancel_reason, "customer_replied_since_schedule");
  assert.equal(finalRow?.outbox_message_id, null, "no proactive outbox message is ever created for a cancelled follow-up");
});

test("T07-E14: human ownership active - follow-up never executes, cancelled without any autonomous action", async () => {
  const waId = randomWaId();
  const conversation = await seedConversation(waId, { humanOwnerActive: true });
  const seed = await seedOpportunity(waId);
  const opportunity = buildOpportunity({ ...seed, lastActivityAt: new Date(FIXED_NOW_MS - 2 * 24 * 60 * 60 * 1000).toISOString() });
  const repo = createSalesConsultativeOperationsRepository();

  const created = await repo.createFollowUpAction({
    opportunity,
    actionType: "schedule_follow_up",
    dueAt: new Date(FIXED_NOW_MS - 60 * 1000).toISOString(),
    messageText: "Seguimos en contacto.",
    currentTime: FIXED_NOW_ISO,
    metadata: null
  });
  assert.equal(created.ok, true);
  const actionId = await resolveActionIdByRowId(created.actionId!);
  await setActionState(actionId, { status: "planned", conversationCaseId: conversation.id, waId });

  // The revalidation primitive itself must recognize real human ownership,
  // independent of the full tick.
  const candidateRow = await loadAction(actionId);
  const revalidation = await shouldCancelFollowUp({
    id: Number(candidateRow!.id),
    action_id: actionId,
    wa_id: waId,
    conversation_case_id: conversation.id,
    opportunity_id: null,
    scheduled_for: null,
    draft_message: null,
    status: "executing",
    attempt_number: 1,
    max_attempts: 1,
    followup_configuration_source: null
  });
  assert.equal(revalidation.cancel, true);
  assert.equal(revalidation.reason, "human_owner_active");

  const { runner, calls } = createCountingCycleRunner();
  const tickResult = await runFollowupTick({ limit: 10, actionIds: [actionId], cycleRunner: runner });

  assert.equal(tickResult.executed.length, 0, "a human-owned conversation's follow-up must never execute");
  assert.equal(tickResult.cancelled.length, 1);
  assert.equal(tickResult.cancelled[0]?.reason, "human_owner_active");
  assert.equal(calls.length, 0, "the AI must never send an autonomous follow-up over a conversation a human already owns");

  const finalRow = await loadAction(actionId);
  assert.equal(finalRow?.status, "cancelled");
  assert.equal(finalRow?.cancel_reason, "human_owner_active");
  assert.equal(finalRow?.outbox_message_id, null);
});
