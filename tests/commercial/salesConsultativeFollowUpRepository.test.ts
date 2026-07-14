import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { after } from "node:test";
import { getPool, queryRows, safeExecute, safeQueryRows } from "@/lib/db";
import { COMMERCIAL_FOLLOW_UP_DEFAULT_MAX_ATTEMPTS, planCommercialFollowUp } from "@/lib/brain/commercial/follow-up-planner";
import { buildFollowUpPlanningInput, mapFollowUpPlanStatusToPolicyStatus } from "@/lib/brain/commercial/sales-consultative/followUpPlanAdapter";
import { createSalesConsultativeOperationsRepository } from "@/lib/brain/commercial/sales-consultative/repository";
import type { SalesConsultativeOpportunity } from "@/lib/brain/commercial/sales-consultative/types";

// Real MariaDB, real crm_test database (ACS-R1-05-T01 section 14): mirrors the
// existing tests/commercial/runFollowupTick.test.ts local-credential pattern
// (crm_app has SELECT/INSERT/UPDATE/DELETE on crm_test per
// infra/mariadb/init/001-create-databases-and-users.sql), pointed at crm_test
// instead of the dev database so these tests never touch main_management.
Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "crm_test",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true"
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

function randomWaId() {
  return `569${String(Date.now()).slice(-9)}${Math.floor(Math.random() * 9)}`;
}

async function seedOpportunity(overrides: { waId?: string } = {}): Promise<{ id: number; waId: string; opportunityKey: string }> {
  const waId = overrides.waId ?? randomWaId();
  const opportunityKey = `test-followup-${uniqueSuffix("opp")}`;
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

function buildOpportunity(input: {
  id: number | null;
  waId: string;
  opportunityKey: string;
  lastActivityAt: string;
  overrides?: Partial<SalesConsultativeOpportunity>;
}): SalesConsultativeOpportunity {
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
    closedAt: null,
    ...(input.overrides ?? {})
  };
}

async function loadFollowUpRows(opportunityId: number) {
  const result = await safeQueryRows<Record<string, unknown>>(
    "SELECT * FROM crm_agent_actions WHERE opportunity_id = ? AND action_type = 'schedule_followup' ORDER BY id ASC",
    [opportunityId]
  );
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.rows;
}

async function loadFollowUpRowsByConversation(conversationCaseId: number) {
  const result = await safeQueryRows<Record<string, unknown>>(
    "SELECT * FROM crm_agent_actions WHERE opportunity_id IS NULL AND conversation_case_id = ? AND action_type = 'schedule_followup' ORDER BY id ASC",
    [conversationCaseId]
  );
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.rows;
}

async function insertFollowUpRow(input: {
  opportunityId: number | null;
  waId: string;
  conversationCaseId?: number | null;
  status: string;
  attemptNumber: number;
  maxAttempts?: number;
}) {
  const actionId = `test-followup-${input.status}-${uniqueSuffix(String(input.attemptNumber))}`;
  const insert = await safeExecute(
    `INSERT INTO crm_agent_actions (
        action_id, idempotency_key, opportunity_id, conversation_case_id, wa_id, channel, action_type, status,
        attempt_number, max_attempts, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'whatsapp', 'schedule_followup', ?, ?, ?, NOW(), NOW())`,
    [actionId, actionId, input.opportunityId, input.conversationCaseId ?? null, input.waId, input.status, input.attemptNumber, input.maxAttempts ?? 3]
  );
  assert.ok(insert.ok, insert.ok ? "" : insert.error);
  return actionId;
}

const PAST_ACTIVITY = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

test("primer follow-up crea una fila con attempt_number = 1", async () => {
  const seed = await seedOpportunity();
  const opportunity = buildOpportunity({ ...seed, lastActivityAt: PAST_ACTIVITY });
  const repo = createSalesConsultativeOperationsRepository();
  const currentTime = new Date().toISOString();
  const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const result = await repo.createFollowUpAction({
    opportunity,
    actionType: "schedule_follow_up",
    dueAt,
    messageText: "Seguimos en contacto.",
    currentTime,
    metadata: null
  });

  assert.equal(result.ok, true);
  assert.ok(result.actionId);

  const rows = await loadFollowUpRows(seed.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.attempt_number, 1);
  assert.equal(rows[0]!.status, "planned");
});

test("[T01.1-1] el historial de la oportunidad A no afecta el de la oportunidad B con el mismo wa_id", async () => {
  const sharedWaId = randomWaId();
  const seedA = await seedOpportunity({ waId: sharedWaId });
  const seedB = await seedOpportunity({ waId: sharedWaId });
  assert.notEqual(seedA.id, seedB.id);

  // A already consumed one attempt (executed, terminal).
  await insertFollowUpRow({ opportunityId: seedA.id, waId: sharedWaId, status: "executed", attemptNumber: 1 });

  const repo = createSalesConsultativeOperationsRepository();
  const opportunityB = buildOpportunity({ ...seedB, lastActivityAt: PAST_ACTIVITY });
  const resultB = await repo.createFollowUpAction({
    opportunity: opportunityB,
    actionType: "schedule_follow_up",
    dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    messageText: "Seguimiento para B.",
    currentTime: new Date().toISOString(),
    metadata: null
  });

  assert.equal(resultB.ok, true);
  assert.ok(resultB.actionId);

  const rowsA = await loadFollowUpRows(seedA.id);
  const rowsB = await loadFollowUpRows(seedB.id);
  assert.equal(rowsA.length, 1, "A's history must be untouched");
  assert.equal(rowsA[0]!.attempt_number, 1);
  assert.equal(rowsB.length, 1);
  // B must start at attempt_number 1, not 2 - A's consumed attempt must not
  // leak into B's calculation despite sharing wa_id.
  assert.equal(rowsB[0]!.attempt_number, 1);
});

test("[T01.1-1b] sin opportunity_id, el scope prioriza conversation_case_id exacto sobre wa_id compartido", async () => {
  const sharedWaId = randomWaId();
  const conversationCaseIdA = Math.floor(Date.now() / 7);
  const conversationCaseIdB = conversationCaseIdA + 1;

  await insertFollowUpRow({
    opportunityId: null,
    waId: sharedWaId,
    conversationCaseId: conversationCaseIdA,
    status: "executed",
    attemptNumber: 1
  });

  const repo = createSalesConsultativeOperationsRepository();
  const opportunityB = buildOpportunity({
    id: null,
    waId: sharedWaId,
    opportunityKey: "",
    lastActivityAt: PAST_ACTIVITY
  });
  const resultB = await repo.createFollowUpAction({
    opportunity: opportunityB,
    actionType: "schedule_follow_up",
    dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    messageText: "Seguimiento para conversacion B.",
    currentTime: new Date().toISOString(),
    metadata: { conversationId: conversationCaseIdB }
  });

  assert.equal(resultB.ok, true);
  assert.ok(resultB.actionId);

  const rowsA = await loadFollowUpRowsByConversation(conversationCaseIdA);
  const rowsB = await loadFollowUpRowsByConversation(conversationCaseIdB);
  assert.equal(rowsA.length, 1, "conversation A's history must be untouched");
  assert.equal(rowsB.length, 1);
  assert.equal(rowsB[0]!.attempt_number, 1);
});

test("[T01.1-2] retry exacto del mismo plan reutiliza la misma fila (existing_action_reused)", async () => {
  const seed = await seedOpportunity();
  const opportunity = buildOpportunity({ ...seed, lastActivityAt: PAST_ACTIVITY });
  const repo = createSalesConsultativeOperationsRepository();
  const currentTime = new Date().toISOString();
  const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const first = await repo.createFollowUpAction({
    opportunity,
    actionType: "schedule_follow_up",
    dueAt,
    messageText: "Seguimos en contacto.",
    currentTime,
    metadata: null
  });
  // A later call (different wall-clock moment, different message text) for
  // the exact same logical plan (same opportunity, same intent inferred,
  // same attemptNumber, same relative delay/urgency - 24h out from whenever
  // "now" is) must be recognized as a retry, not a new plan. A different
  // absolute dueAt alone does not make it a different plan as long as the
  // relative delay (policy.defaultDelayHours) that sales-consultative's
  // cadence hint translates to is unchanged.
  const secondCurrentTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const second = await repo.createFollowUpAction({
    opportunity,
    actionType: "schedule_follow_up",
    dueAt: new Date(new Date(secondCurrentTime).getTime() + 24 * 60 * 60 * 1000).toISOString(),
    messageText: "Seguimos en contacto, mensaje reenviado.",
    currentTime: secondCurrentTime,
    metadata: null
  });

  assert.equal(second.ok, true);
  assert.equal(second.actionId, first.actionId);
  assert.equal(second.warning, "existing_action_reused");

  const rows = await loadFollowUpRows(seed.id);
  assert.equal(rows.length, 1);
});

test("[T01.1-3/4] un plan distinto mientras hay una accion activa retorna active_followup_exists y no sobrescribe la fila", async () => {
  const seed = await seedOpportunity();
  const repo = createSalesConsultativeOperationsRepository();

  const firstOpportunity = buildOpportunity({
    ...seed,
    lastActivityAt: PAST_ACTIVITY,
    overrides: { primaryIntent: "product_inquiry", currentSummary: "Cliente pregunta por el producto." }
  });
  const first = await repo.createFollowUpAction({
    opportunity: firstOpportunity,
    actionType: "schedule_follow_up",
    dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    messageText: "Seguimiento de interes en producto.",
    currentTime: new Date().toISOString(),
    metadata: null
  });
  assert.equal(first.ok, true);
  const [firstRow] = await loadFollowUpRows(seed.id);
  assert.equal(firstRow!.status, "planned");

  // Same opportunity, but the commercial context now infers a different
  // intent (quote) - a genuinely different logical plan while the first one
  // is still active (planned).
  const conflictingOpportunity = buildOpportunity({
    ...seed,
    lastActivityAt: PAST_ACTIVITY,
    overrides: {
      primaryIntent: "quote_request",
      currentSummary: "Cliente pidio cotizacion formal del producto.",
      signals: ["quote_sent_no_reply"]
    }
  });
  const conflicting = await repo.createFollowUpAction({
    opportunity: conflictingOpportunity,
    actionType: "schedule_follow_up",
    dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    messageText: "Seguimiento de cotizacion.",
    currentTime: new Date(Date.now() + 60 * 1000).toISOString(),
    metadata: null
  });

  assert.equal(conflicting.ok, true);
  assert.equal(conflicting.actionId, firstRow!.id);
  assert.equal(conflicting.warning, "active_followup_exists");

  // The active row is never overwritten by the conflicting plan.
  const rows = await loadFollowUpRows(seed.id);
  assert.equal(rows.length, 1);
  const reloaded = rows[0]!;
  assert.equal(reloaded.status, "planned");
  assert.equal(reloaded.attempt_number, firstRow!.attempt_number);
  assert.equal(reloaded.idempotency_key, firstRow!.idempotency_key);
  const draftPayload = JSON.parse(reloaded.draft_payload_json as string);
  assert.equal(draftPayload.intent, JSON.parse(firstRow!.draft_payload_json as string).intent);
});

const NON_CONSUMING_STATUSES = ["rejected", "blocked", "cancelled", "expired"] as const;
for (const status of NON_CONSUMING_STATUSES) {
  test(`[T01.1-5..8] ${status} no consume intento comercial`, async () => {
    const seed = await seedOpportunity();
    await insertFollowUpRow({ opportunityId: seed.id, waId: seed.waId, status, attemptNumber: 1 });

    const repo = createSalesConsultativeOperationsRepository();
    const opportunity = buildOpportunity({ ...seed, lastActivityAt: PAST_ACTIVITY });
    const result = await repo.createFollowUpAction({
      opportunity,
      actionType: "schedule_follow_up",
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      messageText: `Seguimiento tras estado ${status}.`,
      currentTime: new Date().toISOString(),
      metadata: null
    });

    assert.equal(result.ok, true);
    assert.ok(result.actionId);

    const rows = await loadFollowUpRows(seed.id);
    assert.equal(rows.length, 2);
    const newRow = rows.find((row) => row.id === result.actionId);
    assert.ok(newRow);
    assert.equal(newRow!.attempt_number, 1, `${status} must not advance attempt_number`);
  });
}

const CONSUMING_STATUSES = ["executed", "failed"] as const;
for (const status of CONSUMING_STATUSES) {
  test(`[T01.1-9/10] ${status} consume intento comercial (siguiente intento persiste attempt_number = 2)`, async () => {
    const seed = await seedOpportunity();
    await insertFollowUpRow({ opportunityId: seed.id, waId: seed.waId, status, attemptNumber: 1 });

    const repo = createSalesConsultativeOperationsRepository();
    const opportunity = buildOpportunity({ ...seed, lastActivityAt: PAST_ACTIVITY });
    const result = await repo.createFollowUpAction({
      opportunity,
      actionType: "schedule_follow_up",
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      messageText: `Segundo intento tras ${status}.`,
      currentTime: new Date().toISOString(),
      metadata: null
    });

    assert.equal(result.ok, true);
    assert.ok(result.actionId);

    const rows = await loadFollowUpRows(seed.id);
    assert.equal(rows.length, 2);
    const newRow = rows.find((row) => row.id === result.actionId);
    assert.ok(newRow);
    assert.equal(newRow!.attempt_number, 2, `${status} must advance attempt_number`);

    const oldRow = rows.find((row) => row.status === status);
    assert.ok(oldRow, "terminal history row must remain unchanged");
    assert.equal(oldRow!.attempt_number, 1);
  });
}

test("[T01.1-11] una accion terminal (executed) permite crear un segundo intento con attempt_number = 2 y un idempotency key distinto", async () => {
  const seed = await seedOpportunity();
  const opportunity = buildOpportunity({ ...seed, lastActivityAt: PAST_ACTIVITY });
  const repo = createSalesConsultativeOperationsRepository();
  const currentTime = new Date().toISOString();

  const first = await repo.createFollowUpAction({
    opportunity,
    actionType: "schedule_follow_up",
    dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    messageText: "Seguimos en contacto.",
    currentTime,
    metadata: null
  });
  assert.equal(first.ok, true);

  const [firstRow] = await loadFollowUpRows(seed.id);
  assert.equal(firstRow!.status, "planned");

  // Simulate the worker having executed the first attempt (out of scope for
  // T01: runFollowupTick.ts is not touched, only its resulting terminal state).
  const terminalUpdate = await safeExecute(
    `UPDATE crm_agent_actions SET status = 'executed', executed_at = NOW(), updated_at = NOW() WHERE id = ?`,
    [firstRow!.id]
  );
  assert.ok(terminalUpdate.ok, terminalUpdate.ok ? "" : terminalUpdate.error);

  const second = await repo.createFollowUpAction({
    opportunity,
    actionType: "schedule_follow_up",
    dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    messageText: "Retomando el seguimiento.",
    currentTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    metadata: null
  });

  assert.equal(second.ok, true);
  assert.ok(second.actionId);
  assert.notEqual(second.actionId, first.actionId);

  const rows = await loadFollowUpRows(seed.id);
  assert.equal(rows.length, 2);
  const secondRow = rows.find((row) => row.id === second.actionId);
  assert.ok(secondRow);
  assert.equal(secondRow!.attempt_number, 2);
  assert.notEqual(secondRow!.idempotency_key, firstRow!.idempotency_key);

  // Terminal history is never mutated by the new attempt.
  const reloadedFirstRow = rows.find((row) => row.id === firstRow!.id);
  assert.equal(reloadedFirstRow!.status, "executed");
  assert.equal(reloadedFirstRow!.attempt_number, 1);
});

test("[T01.1-12] max_attempts se obtiene de la fuente canonica COMMERCIAL_FOLLOW_UP_DEFAULT_MAX_ATTEMPTS", async () => {
  const seed = await seedOpportunity();
  const opportunity = buildOpportunity({ ...seed, lastActivityAt: PAST_ACTIVITY });
  const repo = createSalesConsultativeOperationsRepository();

  const result = await repo.createFollowUpAction({
    opportunity,
    actionType: "schedule_follow_up",
    dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    messageText: "Seguimos en contacto.",
    currentTime: new Date().toISOString(),
    metadata: null
  });
  assert.equal(result.ok, true);

  const [row] = await loadFollowUpRows(seed.id);
  assert.equal(row!.max_attempts, COMMERCIAL_FOLLOW_UP_DEFAULT_MAX_ATTEMPTS);
});

test("[T01.1-13] recommended persiste policy_status=allowed y action.status=planned", async () => {
  const seed = await seedOpportunity();
  const opportunity = buildOpportunity({ ...seed, lastActivityAt: PAST_ACTIVITY });
  const repo = createSalesConsultativeOperationsRepository();

  const result = await repo.createFollowUpAction({
    opportunity,
    actionType: "schedule_follow_up",
    dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    messageText: "Seguimiento de bajo riesgo.",
    currentTime: new Date().toISOString(),
    metadata: null
  });
  assert.equal(result.ok, true);

  const [row] = await loadFollowUpRows(seed.id);
  assert.equal(row!.status, "planned");
  assert.equal(row!.policy_status, "allowed");
  const draftPayload = JSON.parse(row!.draft_payload_json as string);
  assert.equal(draftPayload.status, "recommended");
});

test("[T01.1-14] requires_operator_review persiste policy_status=requires_review y action.status=requires_review", async () => {
  const seed = await seedOpportunity();
  const opportunity = buildOpportunity({
    ...seed,
    lastActivityAt: PAST_ACTIVITY,
    overrides: {
      primaryIntent: "checkout",
      currentSummary: "Cliente pregunto por el pago y checkout del pedido.",
      signals: ["checkout_pending"]
    }
  });
  const repo = createSalesConsultativeOperationsRepository();

  const result = await repo.createFollowUpAction({
    opportunity,
    actionType: "schedule_follow_up",
    dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    messageText: "Seguimiento de pago.",
    currentTime: new Date().toISOString(),
    metadata: null
  });
  assert.equal(result.ok, true);

  const [row] = await loadFollowUpRows(seed.id);
  assert.equal(row!.status, "requires_review");
  assert.equal(row!.policy_status, "requires_review");
  const draftPayload = JSON.parse(row!.draft_payload_json as string);
  assert.equal(draftPayload.status, "requires_operator_review");
});

test("[T01.1-15] otros tipos de accion conservan exactamente su persistencia previa (1/1/allowed, key legacy)", async () => {
  const seed = await seedOpportunity();
  const opportunity = buildOpportunity({ ...seed, lastActivityAt: PAST_ACTIVITY });
  const repo = createSalesConsultativeOperationsRepository();
  const currentTime = new Date().toISOString();

  const result = await repo.createFollowUpAction({
    opportunity,
    actionType: "handoff_to_human",
    dueAt: null,
    messageText: "Te derivo con un asesor humano.",
    currentTime,
    metadata: null
  });

  assert.equal(result.ok, true);
  assert.ok(result.actionId);

  const rows = await safeQueryRows<Record<string, unknown>>(
    "SELECT * FROM crm_agent_actions WHERE opportunity_id = ? AND action_type = 'take_over_case' ORDER BY id DESC LIMIT 1",
    [seed.id]
  );
  assert.ok(rows.ok, rows.ok ? "" : rows.error);
  const row = rows.rows[0];
  assert.ok(row);

  assert.equal(row!.attempt_number, 1);
  assert.equal(row!.max_attempts, 1);
  assert.equal(row!.policy_status, "allowed");
  assert.equal(row!.status, "requires_review");
  assert.equal(row!.risk_level, "high");
  assert.equal(row!.approval_requirement, "operator_review");
  assert.equal(row!.idempotency_key, `sales-action:${seed.opportunityKey}:take_over_case`);
  assert.equal(row!.draft_message, "Te derivo con un asesor humano.");
});

test("[T01.1-16] el INSERT de crm_agent_actions conserva 39 columnas y 39 placeholders (regresion del bug ER_WRONG_VALUE_COUNT_ON_ROW)", () => {
  const source = readFileSync(path.resolve(__dirname, "../../lib/brain/commercial/sales-consultative/repository.ts"), "utf8");
  const match = source.match(/INSERT INTO crm_agent_actions \(([\s\S]*?)\)\s*VALUES \(([^)]*)\)/);
  assert.ok(match, "INSERT INTO crm_agent_actions statement not found");

  const columns = match![1]
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
  const placeholders = match![2].split(",").map((value) => value.trim()).filter(Boolean);

  assert.equal(columns.length, 39);
  assert.equal(placeholders.length, 39);
  assert.equal(columns.length, placeholders.length);
  assert.ok(placeholders.every((value) => value === "?"));
});

test("[T01.1-17] scheduled_for persiste correctamente como DATETIME (no ISO crudo) y demas columnas coinciden con el plan", async () => {
  const seed = await seedOpportunity();
  const opportunity = buildOpportunity({ ...seed, lastActivityAt: PAST_ACTIVITY });
  const repo = createSalesConsultativeOperationsRepository();
  const currentTime = new Date().toISOString();
  const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const messageText = "Seguimos en contacto.";

  const expectedPlan = planCommercialFollowUp(
    buildFollowUpPlanningInput({
      opportunity,
      draftMessage: messageText,
      dueAt,
      currentTime,
      priorAttemptNumber: 0
    })
  );

  const result = await repo.createFollowUpAction({
    opportunity,
    actionType: "schedule_follow_up",
    dueAt,
    messageText,
    currentTime,
    metadata: null
  });
  assert.equal(result.ok, true);

  const [row] = await loadFollowUpRows(seed.id);
  assert.ok(row);

  // mysql2 returns DATETIME columns as real Date objects (never throws), and
  // the stored value round-trips to the same wall-clock moment as the plan's
  // scheduledFor (crm_agent_actions.scheduled_for is second-precision, so
  // compare truncated like the rest of the codebase's toMysqlDateTime()).
  assert.ok(row!.scheduled_for instanceof Date);
  assert.equal(
    (row!.scheduled_for as Date).toISOString().slice(0, 19),
    expectedPlan.scheduledFor!.slice(0, 19)
  );
  assert.equal(row!.max_attempts, expectedPlan.maxAttempts);
  assert.equal(row!.policy_status, mapFollowUpPlanStatusToPolicyStatus(expectedPlan.status));
  assert.deepEqual(JSON.parse(row!.policy_notes_json as string), expectedPlan.policyNotes);
  assert.equal(row!.risk_level, expectedPlan.riskLevel);
  assert.equal(row!.approval_requirement, expectedPlan.approvalRequirement);
  assert.equal(row!.idempotency_key, expectedPlan.idempotencyKey);
  assert.equal(row!.draft_message, expectedPlan.draftMessage);

  const draftPayload = JSON.parse(row!.draft_payload_json as string);
  assert.equal(draftPayload.planId, expectedPlan.planId);
  assert.equal(draftPayload.intent, expectedPlan.intent);
  assert.equal(draftPayload.status, expectedPlan.status);
  assert.equal(draftPayload.attemptNumber, expectedPlan.attemptNumber);
  assert.equal(draftPayload.maxAttempts, expectedPlan.maxAttempts);
  assert.equal(draftPayload.scheduledFor, expectedPlan.scheduledFor);
  assert.equal(draftPayload.rationale, expectedPlan.rationale);
});

test("alcanzar max_attempts no crea una nueva accion ejecutable", async () => {
  const seed = await seedOpportunity();
  const opportunity = buildOpportunity({ ...seed, lastActivityAt: PAST_ACTIVITY });
  const repo = createSalesConsultativeOperationsRepository();

  // Three prior consuming (executed) attempts already used the full
  // COMMERCIAL_FOLLOW_UP_DEFAULT_MAX_ATTEMPTS (3).
  await insertFollowUpRow({ opportunityId: seed.id, waId: seed.waId, status: "executed", attemptNumber: 1 });
  await insertFollowUpRow({ opportunityId: seed.id, waId: seed.waId, status: "executed", attemptNumber: 2 });
  await insertFollowUpRow({ opportunityId: seed.id, waId: seed.waId, status: "executed", attemptNumber: 3 });

  const fourth = await repo.createFollowUpAction({
    opportunity,
    actionType: "schedule_follow_up",
    dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    messageText: "Cuarto intento.",
    currentTime: new Date().toISOString(),
    metadata: null
  });

  assert.equal(fourth.ok, true);
  assert.equal(fourth.actionId, null);
  assert.equal(fourth.warning, "follow_up_plan_not_persisted:blocked");

  const rows = await loadFollowUpRows(seed.id);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.status === "executed"));
});
