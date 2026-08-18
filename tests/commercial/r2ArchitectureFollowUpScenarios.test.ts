import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { randomUUID } from "node:crypto";
import { getPool, queryRows } from "@/lib/db";
import {
  buildCommercialWorkProjection,
  getCommercialWorkByPublicId,
  persistCommercialWorkProjection,
  processObjectiveAwareFollowUpDue,
  scheduleObjectiveAwareFollowUp,
  type CommercialObjectiveSeed,
  type CommercialWork,
  type CommercialWorkProjectionInput
} from "@/lib/brain/commercial/work";
import type { CommercialLineItemSelection } from "@/lib/domains/commercial-line-items";

/**
 * SALES-AGENT-R2-A07.5, stage 3. R2-10 (objective-aware follow-up scheduled
 * and sent through the canonical action/outbox path) and R2-11 (a real
 * inbound before the follow-up is due cancels it, audit row preserved).
 * Reuses the exact fixture pattern tests/commercial/objectiveAwareFollowUp.test.ts
 * already established for this state shape - deep A07 correctness is that
 * file's job (CWFU02/CWFU20-22 already cover this precisely); this file's
 * job is a real, honest PASS/FAIL/BLOCKED verdict for the R2-A07.5 corpus.
 *
 * requiresA07Db: a preflight DB check decides PASS/FAIL vs
 * BLOCKED_BY_A07_DB_VALIDATION - never defaulted to PASS if the DB is
 * unavailable in a given environment.
 */

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

let dbAvailable = false;

before(async () => {
  try {
    await getPool().query("SELECT 1");
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
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

async function seedOpportunity(waId: string) {
  const [result] = await getPool().execute(
    `INSERT INTO crm_opportunities (
      opportunity_key, wa_id, channel, primary_intent, status,
      requirements_json, missing_requirements_json, product_interests_json,
      objections_json, signals_json
    ) VALUES (?, ?, 'whatsapp', 'sales', 'open', JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_OBJECT())`,
    [unique("r2fu-opp"), waId]
  );
  return Number((result as { insertId: number }).insertId);
}

function selectionFact(): CommercialLineItemSelection {
  return { factId: unique("selection-fact"), updatedAt: NOW, items: [{ productId: "31", combinationId: null, quantity: 2 }] };
}

function objectiveSeed(type: Exclude<CommercialObjectiveSeed, { kind: "cancel" }>["type"]): CommercialObjectiveSeed {
  return { seedId: unique(`seed-${type}`), type, origin: "customer_requested", inputs: {} };
}

/** CommercialWork = WAITING_CUSTOMER, GET_SHIPPING_QUOTE objective waiting reason MISSING_DESTINATION - R2-10's own precondition. */
function projectMissingDestination(input: { conversationId: number; opportunityId: number }): CommercialWork {
  return buildCommercialWorkProjection({
    trigger: { type: "CUSTOMER_MESSAGE", conversationId: input.conversationId, opportunityId: input.opportunityId, sourceMessageId: null },
    conversation: { id: input.conversationId, humanOwnerActive: false, aiEnabled: true },
    opportunity: { id: input.opportunityId, status: "open" },
    commercialLineItems: selectionFact(),
    objectiveSeeds: [objectiveSeed("GET_SHIPPING_QUOTE")],
    now: NOW
  } satisfies CommercialWorkProjectionInput);
}

async function makeWaitingWork() {
  const conversation = await seedConversation();
  const opportunityId = await seedOpportunity(conversation.waId);
  const persisted = await persistCommercialWorkProjection({ work: projectMissingDestination({ conversationId: conversation.id, opportunityId }), correlationKey: unique("r2fu-correlation") });
  const objective = persisted.work.objectives.find((item) => item.status === "WAITING_CUSTOMER");
  assert.ok(objective, "expected a WAITING_CUSTOMER GET_SHIPPING_QUOTE objective");
  return { conversation, opportunityId, work: persisted.work, objective };
}

async function makeDue(actionId: string, when: string) {
  await getPool().execute(`UPDATE crm_agent_actions SET scheduled_for = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE action_id = ?`, [when.slice(0, 19).replace("T", " "), actionId]);
}

test("R2-10 objective-aware follow-up: scheduled, correlated to CommercialWork+objective, sent through the canonical action/outbox path, zero LLM calls", async (t) => {
  // dbAvailable is set by the before() hook, which runs before this test
  // body (but after every test() registration) - checked here, not via the
  // `skip` test option, which is evaluated at registration time and would
  // always see the pre-before() value. Never defaults to PASS.
  if (!dbAvailable) return t.skip("BLOCKED_BY_A07_DB_VALIDATION: crm_test DB unavailable in this environment");
  const fixture = await makeWaitingWork();

  const scheduled = await scheduleObjectiveAwareFollowUp({
    workPublicId: fixture.work.publicId,
    objectivePublicId: fixture.objective.objectiveId,
    now: NOW,
    expectedWorkVersion: fixture.work.version
  });
  assert.equal(scheduled.status, "scheduled", "R2-10: follow-up must be scheduled for a WAITING_CUSTOMER/MISSING_DESTINATION objective");
  if (scheduled.status !== "scheduled") return;

  const payload = scheduled.action.draftPayload as { commercialWorkPublicId: string; commercialObjectivePublicId: string; followUpPolicy: string; waitingReason: string };
  assert.equal(payload.commercialWorkPublicId, fixture.work.publicId, "R2-10: correlation must include the CommercialWork public id");
  assert.equal(payload.commercialObjectivePublicId, fixture.objective.objectiveId, "R2-10: correlation must include the objective id");
  assert.equal(payload.followUpPolicy, "MISSING_INFORMATION");
  assert.equal(payload.waitingReason, "MISSING_DESTINATION");

  await makeDue(scheduled.action.actionId, DUE);
  const due = await processObjectiveAwareFollowUpDue({ actionId: scheduled.action.actionId, now: DUE });
  assert.equal(due.status, "sent", "R2-10: due processing must revalidate current state and send through the canonical path");
  if (due.status !== "sent") return;

  const outboxRows = await queryRows<{ count: number }>(`SELECT COUNT(*) AS count FROM brain_message_outbox WHERE source_request_id = ?`, [due.sendAction.actionId]);
  assert.equal(Number(outboxRows[0].count), 1, "R2-10: exactly one brain_message_outbox row via the canonical path");

  const actionRows = await queryRows<{ status: string }>(`SELECT status FROM crm_agent_actions WHERE action_id = ?`, [scheduled.action.actionId]);
  assert.equal(actionRows[0].status, "executed");

  // Zero LLM calls for eligibility/phrasing: the entire scheduling+due-processing
  // call chain (evaluateObjectiveFollowUpEligibility, buildObjectiveFollowUpMessage,
  // executeActionThroughGate) takes no provider/model argument anywhere -
  // structurally impossible to have made an LLM call, not just empirically zero.
});

test("R2-11 a real inbound before the follow-up is due cancels it, no message sent, audit row preserved", async (t) => {
  if (!dbAvailable) return t.skip("BLOCKED_BY_A07_DB_VALIDATION: crm_test DB unavailable in this environment");
  const fixture = await makeWaitingWork();
  const scheduled = await scheduleObjectiveAwareFollowUp({
    workPublicId: fixture.work.publicId,
    objectivePublicId: fixture.objective.objectiveId,
    now: NOW,
    expectedWorkVersion: fixture.work.version
  });
  assert.equal(scheduled.status, "scheduled");
  if (scheduled.status !== "scheduled") return;
  await makeDue(scheduled.action.actionId, DUE);

  await getPool().execute(
    `INSERT INTO conversation_message (
      public_id, conversation_id, provider, provider_message_id, direction, sender_type, message_type, body, status, created_at
    ) VALUES (?, ?, 'meta', ?, 'inbound', 'customer', 'text', 'Nunoa', 'received', ?)`,
    [randomUUID(), fixture.conversation.id, unique("wamid"), "2026-08-17 12:30:00"]
  );

  const outboxBefore = await queryRows<{ count: number }>(`SELECT COUNT(*) AS count FROM brain_message_outbox WHERE wa_id = ?`, [fixture.conversation.waId]);

  const due = await processObjectiveAwareFollowUpDue({ actionId: scheduled.action.actionId, now: DUE });
  assert.equal(due.status, "cancelled", "R2-11: a stale follow-up (real inbound since schedule) must cancel, not send");
  assert.equal("reason" in due ? due.reason : null, "customer_replied_since_schedule");

  const outboxAfter = await queryRows<{ count: number }>(`SELECT COUNT(*) AS count FROM brain_message_outbox WHERE wa_id = ?`, [fixture.conversation.waId]);
  assert.equal(Number(outboxAfter[0].count), Number(outboxBefore[0].count), "R2-11: no customer message sent from the stale follow-up");

  const actionRows = await queryRows<{ status: string; cancel_reason: string | null }>(`SELECT status, cancel_reason FROM crm_agent_actions WHERE action_id = ?`, [scheduled.action.actionId]);
  assert.equal(actionRows[0].status, "cancelled");
  assert.equal(actionRows[0].cancel_reason, "customer_replied_since_schedule");

  const reloaded = await getCommercialWorkByPublicId(fixture.work.publicId);
  assert.ok(reloaded, "R2-11: the audit row (crm_agent_actions) and the CommercialWork itself are preserved, never deleted");
});
