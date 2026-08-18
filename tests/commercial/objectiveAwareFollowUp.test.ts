import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { randomUUID } from "node:crypto";
import { getPool, queryRows } from "@/lib/db";
import {
  buildCommercialWorkProjection,
  cancelObjectiveAwareFollowUps,
  deriveCommercialWorkMetrics,
  evaluateObjectiveFollowUpEligibility,
  getCommercialWorkByPublicId,
  persistCommercialWorkProjection,
  processObjectiveAwareFollowUpDue,
  scheduleObjectiveAwareFollowUp,
  updateCommercialWorkAggregate,
  type CommercialObjective,
  type CommercialObjectiveSeed,
  type CommercialWork,
  type CommercialWorkProjectionInput,
  type ObjectiveFollowUpPolicy
} from "@/lib/brain/commercial/work";
import type { CommercialLineItemSelection } from "@/lib/domains/commercial-line-items";

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
  META_WHATSAPP_DEFAULT_PHONE_NUMBER_ID: "test-phone"
});

const NOW = "2026-08-17T12:00:00.000Z";
const DUE = "2026-08-17T13:01:00.000Z";

before(async () => {
  await getPool().query("SELECT 1");
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore teardown failures
  }
});

function unique(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function seedConversation() {
  const waId = `569${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const [result] = await getPool().execute(
    `INSERT INTO conversation (
      public_id, channel, provider, channel_account_id, external_contact_id,
      status, owner_type, ai_enabled, human_owner_active
    ) VALUES (?, 'whatsapp', 'meta', ?, ?, 'open', 'ai_sdr', 1, 0)`,
    [randomUUID(), unique("phone"), waId]
  );
  return { id: Number((result as { insertId: number }).insertId), waId };
}

async function seedOpportunity(waId: string, status = "open") {
  const [result] = await getPool().execute(
    `INSERT INTO crm_opportunities (
      opportunity_key, wa_id, channel, primary_intent, status,
      requirements_json, missing_requirements_json, product_interests_json,
      objections_json, signals_json
    ) VALUES (?, ?, 'whatsapp', 'sales', ?, JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_OBJECT())`,
    [unique("cwfu-opp"), waId, status]
  );
  return Number((result as { insertId: number }).insertId);
}

function selectionFact(): CommercialLineItemSelection {
  return {
    factId: unique("selection-fact"),
    updatedAt: NOW,
    items: [{ productId: "31", combinationId: null, quantity: 2 }]
  };
}

function objectiveSeed(type: Exclude<CommercialObjectiveSeed, { kind: "cancel" }>["type"], inputs: Exclude<CommercialObjectiveSeed, { kind: "cancel" }>["inputs"] = {}): CommercialObjectiveSeed {
  return { seedId: unique(`seed-${type}`), type, origin: "customer_requested", inputs };
}

function project(input: {
  conversationId: number;
  opportunityId: number;
  status?: "waiting_missing_destination" | "waiting_system" | "quote_pending";
}): CommercialWork {
  if (input.status === "quote_pending") {
    const objective: CommercialObjective = {
      objectiveId: unique("objective-WAIT_FOR_QUOTE_APPROVAL"),
      type: "WAIT_FOR_QUOTE_APPROVAL",
      status: "WAITING_CUSTOMER",
      origin: "system_generated",
      inputs: {},
      resolvedInputs: { createdQuoteFactId: unique("quote-fact") },
      missingRequirements: [],
      supersedesObjectiveIds: [],
      evidence: [{ kind: "request_fact", factType: "created_quote", id: unique("quote-fact") }],
      blockers: [{ code: "WAITING_CUSTOMER", source: "objective" }]
    };
    const work: CommercialWork = {
      id: unique("cw-projection"),
      projectionVersion: 1,
      opportunityId: input.opportunityId,
      conversationId: input.conversationId,
      sourceMessageId: null,
      sourceSequence: null,
      lastReconciledSequence: null,
      previousWorkPublicId: null,
      supersedesWorkPublicId: null,
      trigger: { type: "SYSTEM_EVENT", eventType: "quote_sent", correlationId: unique("quote") },
      status: "WAITING_CUSTOMER",
      objectives: [objective],
      steps: [],
      blockers: objective.blockers,
      derivedAt: NOW,
      metrics: { objectiveCount: 1, readyStepCount: 0, waitingCustomerObjectiveCount: 1, waitingSystemStepCount: 0, blockerCount: 1 }
    };
    return work;
  }

  const work = buildCommercialWorkProjection({
    trigger: { type: "CUSTOMER_MESSAGE", conversationId: input.conversationId, opportunityId: input.opportunityId, sourceMessageId: null },
    conversation: { id: input.conversationId, humanOwnerActive: false, aiEnabled: true },
    opportunity: { id: input.opportunityId, status: "open" },
    commercialLineItems: selectionFact(),
    objectiveSeeds: [objectiveSeed("GET_SHIPPING_QUOTE")],
    now: NOW
  } satisfies CommercialWorkProjectionInput);

  if (input.status === "waiting_system") {
    const objective = work.objectives.find((item) => item.type === "GET_SHIPPING_QUOTE");
    assert.ok(objective);
    objective.status = "WAITING_SYSTEM";
    objective.blockers = [{ code: "WAITING_SYSTEM", source: "objective", objectiveId: objective.objectiveId }];
    return { ...work, status: "WAITING_SYSTEM", objectives: work.objectives, blockers: objective.blockers, metrics: deriveCommercialWorkMetrics({ ...work, blockers: objective.blockers }) };
  }

  return work;
}

async function persistWork(work: CommercialWork) {
  return persistCommercialWorkProjection({ work, correlationKey: unique("cwfu-correlation") });
}

function waitingObjective(work: CommercialWork) {
  const objective = work.objectives.find((item) => item.status === "WAITING_CUSTOMER" || item.type === "WAIT_FOR_QUOTE_APPROVAL") ?? work.objectives[0];
  assert.ok(objective);
  return objective;
}

async function makeWaitingWork(kind: "missing_destination" | "quote_pending" | "waiting_system" = "missing_destination") {
  const conversation = await seedConversation();
  const opportunityId = await seedOpportunity(conversation.waId);
  const work = await persistWork(project({
    conversationId: conversation.id,
    opportunityId,
    status: kind === "quote_pending" ? "quote_pending" : kind === "waiting_system" ? "waiting_system" : "waiting_missing_destination"
  }));
  return { conversation, opportunityId, work: work.work, objective: waitingObjective(work.work) };
}

async function makeDue(actionId: string, when = NOW) {
  await getPool().execute(
    `UPDATE crm_agent_actions SET scheduled_for = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE action_id = ?`,
    [when.slice(0, 19).replace("T", " "), actionId]
  );
}

async function rowStatus(actionId: string) {
  const rows = await queryRows<{ status: string; cancel_reason: string | null }>(
    `SELECT status, cancel_reason FROM crm_agent_actions WHERE action_id = ? LIMIT 1`,
    [actionId]
  );
  return rows[0];
}

async function schedule(kind: "missing_destination" | "quote_pending" = "missing_destination") {
  const fixture = await makeWaitingWork(kind);
  const scheduled = await scheduleObjectiveAwareFollowUp({
    workPublicId: fixture.work.publicId,
    objectivePublicId: fixture.objective.objectiveId,
    now: NOW,
    expectedWorkVersion: fixture.work.version
  });
  assert.equal(scheduled.status, "scheduled");
  return { ...fixture, action: scheduled.action };
}

test("CWFU01 CWFU04 CWFU05 CWFU17 missing information schedules, technical waits do not, and delay sequence is policy-owned", async () => {
  const fixture = await makeWaitingWork();
  const result = await scheduleObjectiveAwareFollowUp({
    workPublicId: fixture.work.publicId,
    objectivePublicId: fixture.objective.objectiveId,
    now: NOW,
    expectedWorkVersion: fixture.work.version
  });
  assert.equal(result.status, "scheduled");
  assert.equal(result.action.draftPayload && (result.action.draftPayload as { followUpPolicy: ObjectiveFollowUpPolicy }).followUpPolicy, "MISSING_INFORMATION");
  assert.equal(result.action.attemptNumber, 1);
  assert.equal(result.action.maxAttempts, 2);
  assert.equal(result.action.scheduledFor, "2026-08-17T13:00:00.000Z");

  const waitingSystem = await makeWaitingWork("waiting_system");
  const notEligible = await scheduleObjectiveAwareFollowUp({
    workPublicId: waitingSystem.work.publicId,
    objectivePublicId: waitingSystem.objective.objectiveId,
    now: NOW,
    expectedWorkVersion: waitingSystem.work.version
  });
  assert.equal(notEligible.status, "not_eligible");
  assert.equal(notEligible.eligibility.reason, "work_not_waiting_customer");

  const retryScheduledLike = evaluateObjectiveFollowUpEligibility({
    work: { ...waitingSystem.work, status: "WAITING_SYSTEM" },
    objective: waitingSystem.objective,
    conversation: { id: waitingSystem.conversation.id, aiEnabled: true, humanOwnerActive: false },
    opportunity: { id: waitingSystem.opportunityId, status: "open" },
    currentTime: NOW,
    commercialWorkPublicId: waitingSystem.work.publicId
  });
  assert.equal(retryScheduledLike.status, "NOT_ELIGIBLE");
});

test("CWFU02 CWFU18 CWFU19 CWFU23 CWFU24 due processing reloads CommercialWork and writes through canonical action/outbox path once", async () => {
  const fixture = await schedule();
  await makeDue(fixture.action.actionId);
  const first = await processObjectiveAwareFollowUpDue({ actionId: fixture.action.actionId, now: DUE });
  const second = await processObjectiveAwareFollowUpDue({ actionId: fixture.action.actionId, now: DUE });

  assert.equal(first.status, "sent");
  assert.equal(second.status, "skipped");
  assert.equal(second.reason, "already_claimed");
  if (first.status !== "sent") return;
  assert.equal(first.executionGate.repositoryResult.outboxInserted || first.executionGate.status === "duplicate", true);
  const outboxRows = await queryRows<{ count: number }>(
    `SELECT COUNT(*) AS count FROM brain_message_outbox WHERE source_request_id = ?`,
    [first.sendAction.actionId]
  );
  assert.equal(Number(outboxRows[0].count), 1);
  assert.equal((await rowStatus(fixture.action.actionId)).status, "executed");
});

test("CWFU03 CWFU08 CWFU09 CWFU10 completed/cancelled/superseded work or objective cancels stale follow-up", async () => {
  const cases = [
    { workStatus: "COMPLETED" as const, objectiveStatus: "COMPLETED" as const, reason: "work_completed" },
    { workStatus: "CANCELLED" as const, objectiveStatus: "WAITING_CUSTOMER" as const, reason: "work_cancelled" },
    { workStatus: "SUPERSEDED" as const, objectiveStatus: "SUPERSEDED" as const, reason: "work_superseded" }
  ];
  for (const testCase of cases) {
    const fixture = await schedule();
    await makeDue(fixture.action.actionId);
    const current = await getCommercialWorkByPublicId(fixture.work.publicId);
    assert.ok(current);
    const objectives = current.objectives.map((item) => item.objectiveId === fixture.objective.objectiveId ? { ...item, status: testCase.objectiveStatus } : item);
    await updateCommercialWorkAggregate({
      publicId: current.publicId,
      expectedVersion: current.version,
      nextWork: { ...current, status: testCase.workStatus, objectives, metrics: deriveCommercialWorkMetrics({ ...current, objectives }) }
    });
    const result = await processObjectiveAwareFollowUpDue({ actionId: fixture.action.actionId, now: DUE });
    assert.equal(result.status, "cancelled");
    assert.equal(result.reason, testCase.reason);
  }
});

test("CWFU11 CWFU12 CWFU13 CWFU14 handoff, AI-disabled, opt-out and terminal opportunity stop follow-up", async () => {
  const handoff = await schedule();
  await makeDue(handoff.action.actionId);
  await getPool().execute(`UPDATE conversation SET human_owner_active = 1 WHERE id = ?`, [handoff.conversation.id]);
  assert.deepEqual(await processObjectiveAwareFollowUpDue({ actionId: handoff.action.actionId, now: DUE }).then((item) => [item.status, "reason" in item ? item.reason : ""]), ["cancelled", "conversation_handoff"]);

  const paused = await schedule();
  await makeDue(paused.action.actionId);
  await getPool().execute(`UPDATE conversation SET ai_enabled = 0 WHERE id = ?`, [paused.conversation.id]);
  assert.deepEqual(await processObjectiveAwareFollowUpDue({ actionId: paused.action.actionId, now: DUE }).then((item) => [item.status, "reason" in item ? item.reason : ""]), ["cancelled", "conversation_ai_disabled"]);

  const optOut = await schedule();
  await makeDue(optOut.action.actionId);
  await getPool().execute(`INSERT IGNORE INTO crm_customer_opt_outs (wa_id, channel, reason) VALUES (?, 'whatsapp', 'test')`, [optOut.conversation.waId]);
  assert.deepEqual(await processObjectiveAwareFollowUpDue({ actionId: optOut.action.actionId, now: DUE }).then((item) => [item.status, "reason" in item ? item.reason : ""]), ["cancelled", "customer_opted_out"]);

  const terminal = await schedule();
  await makeDue(terminal.action.actionId);
  await getPool().execute(`UPDATE crm_opportunities SET status = 'lost' WHERE id = ?`, [terminal.opportunityId]);
  assert.deepEqual(await processObjectiveAwareFollowUpDue({ actionId: terminal.action.actionId, now: DUE }).then((item) => [item.status, "reason" in item ? item.reason : ""]), ["cancelled", "opportunity_terminal"]);
});

test("CWFU15 CWFU16 duplicate scheduling is prevented and exhausted objective attempts stop", async () => {
  const fixture = await makeWaitingWork();
  const first = await scheduleObjectiveAwareFollowUp({ workPublicId: fixture.work.publicId, objectivePublicId: fixture.objective.objectiveId, now: NOW });
  const second = await scheduleObjectiveAwareFollowUp({ workPublicId: fixture.work.publicId, objectivePublicId: fixture.objective.objectiveId, now: NOW });
  assert.equal(first.status, "scheduled");
  assert.equal(second.status, "already_scheduled");

  if (first.status !== "scheduled") return;
  await getPool().execute(
    `UPDATE crm_agent_actions SET status = 'executed', attempt_number = 2 WHERE action_id = ?`,
    [first.action.actionId]
  );
  const exhausted = await scheduleObjectiveAwareFollowUp({ workPublicId: fixture.work.publicId, objectivePublicId: fixture.objective.objectiveId, now: DUE });
  assert.equal(exhausted.status, "stopped");
  assert.equal(exhausted.eligibility.reason, "max_attempts_reached");
});

test("CWFU06 CWFU07 quote pending schedules and superseded quote objective cancels", async () => {
  const fixture = await schedule("quote_pending");
  assert.equal((fixture.action.draftPayload as { followUpPolicy: string }).followUpPolicy, "QUOTE_PENDING");
  await makeDue(fixture.action.actionId);
  const current = await getCommercialWorkByPublicId(fixture.work.publicId);
  assert.ok(current);
  const objectives = current.objectives.map((item) =>
    item.objectiveId === fixture.objective.objectiveId ? { ...item, status: "SUPERSEDED" as const, blockers: [{ code: "SUPERSEDED" as const, source: "objective" as const, objectiveId: item.objectiveId }] } : item
  );
  await updateCommercialWorkAggregate({
    publicId: current.publicId,
    expectedVersion: current.version,
    nextWork: { ...current, status: "SUPERSEDED", objectives, metrics: deriveCommercialWorkMetrics({ ...current, objectives }) }
  });
  const result = await processObjectiveAwareFollowUpDue({ actionId: fixture.action.actionId, now: DUE });
  assert.equal(result.status, "cancelled");
  assert.equal(result.reason, "work_superseded");
});

test("CWFU20 CWFU21 CWFU22 customer reply invalidates stale objective-aware plan and legacy follow-up is untouched", async () => {
  const fixture = await schedule();
  await makeDue(fixture.action.actionId);
  await getPool().execute(
    `INSERT INTO conversation_message (
      public_id, conversation_id, provider, provider_message_id, direction, sender_type, message_type, body, status, created_at
    ) VALUES (?, ?, 'meta', ?, 'inbound', 'customer', 'text', 'La comuna es Nunoa', 'received', ?)`,
    [randomUUID(), fixture.conversation.id, unique("wamid"), "2026-08-17 12:30:00"]
  );
  const stale = await processObjectiveAwareFollowUpDue({ actionId: fixture.action.actionId, now: DUE });
  assert.equal(stale.status, "cancelled");
  assert.equal(stale.reason, "customer_replied_since_schedule");

  const [legacyInsert] = await getPool().execute(
    `INSERT INTO crm_agent_actions (
      action_id, idempotency_key, conversation_case_id, wa_id, channel, action_type, status,
      risk_level, approval_requirement, draft_payload_json, draft_message, scheduled_for,
      attempt_number, max_attempts, policy_status, source, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'whatsapp', 'schedule_followup', 'planned',
      'low', 'none', JSON_OBJECT('kind', 'legacy_followup'), 'legacy', ?, 1, 1, 'allowed', 'system', 'system', ?, ?)`,
    [unique("legacy-action"), unique("legacy-key"), fixture.conversation.id, fixture.conversation.waId, "2026-08-17 12:00:00", "2026-08-17 11:00:00", "2026-08-17 11:00:00"]
  );
  assert.ok((legacyInsert as { insertId: number }).insertId > 0);
  const legacyRows = await queryRows<{ action_id: string }>(`SELECT action_id FROM crm_agent_actions WHERE id = ?`, [(legacyInsert as { insertId: number }).insertId]);
  const legacy = await processObjectiveAwareFollowUpDue({ actionId: legacyRows[0].action_id, now: DUE });
  assert.equal(legacy.status, "legacy_unaffected");
});

test("CWFU47 linked future follow-ups can be cancelled without deleting audit rows", async () => {
  const fixture = await schedule();
  const cancelled = await cancelObjectiveAwareFollowUps({
    workPublicId: fixture.work.publicId,
    objectivePublicId: fixture.objective.objectiveId,
    policy: "MISSING_INFORMATION",
    reason: "objective_invalidated"
  });
  assert.equal(cancelled.cancelled, 1);
  const status = await rowStatus(fixture.action.actionId);
  assert.equal(status.status, "cancelled");
  assert.equal(status.cancel_reason, "objective_invalidated");
});
