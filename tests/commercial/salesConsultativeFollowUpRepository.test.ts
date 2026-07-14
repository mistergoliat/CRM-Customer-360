import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, queryRows, safeExecute, safeQueryRows } from "@/lib/db";
import { planCommercialFollowUp } from "@/lib/brain/commercial/follow-up-planner";
import { buildFollowUpPlanningInput } from "@/lib/brain/commercial/sales-consultative/followUpPlanAdapter";
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

async function seedOpportunity(): Promise<{ id: number; waId: string; opportunityKey: string }> {
  const waId = `569${String(Date.now()).slice(-9)}${Math.floor(Math.random() * 9)}`;
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
  id: number;
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

async function insertTerminalFollowUpRow(input: { opportunityId: number; waId: string; attemptNumber: number; maxAttempts: number }) {
  const actionId = `test-followup-terminal-${uniqueSuffix(String(input.attemptNumber))}`;
  const insert = await safeExecute(
    `INSERT INTO crm_agent_actions (
        action_id, idempotency_key, opportunity_id, wa_id, channel, action_type, status,
        attempt_number, max_attempts, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'whatsapp', 'schedule_followup', 'executed', ?, ?, NOW(), NOW())`,
    [actionId, actionId, input.opportunityId, input.waId, input.attemptNumber, input.maxAttempts]
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

test("retry exacto del mismo plan reutiliza la misma accion", async () => {
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
  const second = await repo.createFollowUpAction({
    opportunity,
    actionType: "schedule_follow_up",
    dueAt,
    messageText: "Seguimos en contacto.",
    currentTime,
    metadata: null
  });

  assert.equal(second.ok, true);
  assert.equal(second.actionId, first.actionId);

  const rows = await loadFollowUpRows(seed.id);
  assert.equal(rows.length, 1);
});

test("segundo inbound mientras existe una accion activa no crea duplicado", async () => {
  const seed = await seedOpportunity();
  const opportunity = buildOpportunity({ ...seed, lastActivityAt: PAST_ACTIVITY });
  const repo = createSalesConsultativeOperationsRepository();
  const currentTime = new Date().toISOString();

  const first = await repo.createFollowUpAction({
    opportunity,
    actionType: "schedule_follow_up",
    dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    messageText: "Primer mensaje de seguimiento.",
    currentTime,
    metadata: null
  });

  // A different later inbound (different message/dueAt/currentTime) while the
  // first action is still active must not create a second row.
  const later = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const second = await repo.createFollowUpAction({
    opportunity,
    actionType: "schedule_follow_up",
    dueAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    messageText: "Segundo mensaje, distinto contenido.",
    currentTime: later,
    metadata: null
  });

  assert.equal(second.ok, true);
  assert.equal(second.actionId, first.actionId);
  assert.equal(second.warning, "existing_action_reused");

  const rows = await loadFollowUpRows(seed.id);
  assert.equal(rows.length, 1);
});

test("una accion terminal permite crear un segundo intento con attempt_number = 2 y un idempotency key distinto", async () => {
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

test("alcanzar max_attempts no crea una nueva accion ejecutable", async () => {
  const seed = await seedOpportunity();
  const opportunity = buildOpportunity({ ...seed, lastActivityAt: PAST_ACTIVITY });
  const repo = createSalesConsultativeOperationsRepository();

  // Three prior terminal attempts already used the full policy.maxAttempts (3).
  await insertTerminalFollowUpRow({ opportunityId: seed.id, waId: seed.waId, attemptNumber: 1, maxAttempts: 3 });
  await insertTerminalFollowUpRow({ opportunityId: seed.id, waId: seed.waId, attemptNumber: 2, maxAttempts: 3 });
  await insertTerminalFollowUpRow({ opportunityId: seed.id, waId: seed.waId, attemptNumber: 3, maxAttempts: 3 });

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

test("las columnas persistidas coinciden con los valores reales del plan", async () => {
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

  // crm_agent_actions.scheduled_for is a second-precision DATETIME; compare
  // truncated to seconds like the rest of the codebase's toMysqlDateTime().
  assert.equal(
    new Date(row!.scheduled_for as string).toISOString().slice(0, 19),
    expectedPlan.scheduledFor!.slice(0, 19)
  );
  assert.equal(row!.max_attempts, expectedPlan.maxAttempts);
  assert.equal(row!.policy_status, expectedPlan.status);
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

test("otros tipos de accion conservan exactamente su persistencia previa (1/1/allowed, key legacy)", async () => {
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
