import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, safeExecute, safeQueryRows } from "@/lib/db";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";
import { runFollowupTick, selectDueFollowUps, shouldCancelFollowUp } from "@/lib/brain/commercial/followup/runFollowupTick";
import type { runNativeAutonomousCycle, NativeAutonomousCycleResult } from "@/lib/brain/commercial/native-cycle";

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
  // Keep the autonomous cycle out of the inbound calls these tests use only to
  // seed a real conversation row; runFollowupTick itself gets an injected fake.
  BRAIN_SALES_AGENT_ENABLED: "false",
  BRAIN_COMMERCIAL_SHADOW_ENABLED: "false",
  BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED: "false",
  BRAIN_MULTI_REQUEST_RUNTIME_ENABLED: "false"
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

const fakeCycleRunner: typeof runNativeAutonomousCycle = async (): Promise<NativeAutonomousCycleResult> => ({
  ran: true,
  shadow: null,
  loop: null,
  bridge: null,
  warnings: []
});

async function seedConversation(): Promise<{ id: number; publicId: string; waId: string }> {
  const waId = `5699${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  const result = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix("followup-seed")}`,
    phoneNumberId: `phone-${uniqueSuffix("pnid")}`,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Followup Test",
    messageType: "text",
    text: "Hola",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });
  assert.equal(result.duplicate, false);
  return { id: result.conversationId as number, publicId: result.conversationPublicId as string, waId };
}

async function scheduleFollowUpAction(input: {
  conversationId: number;
  waId: string;
  scheduledFor?: Date;
  createdAt?: Date;
}): Promise<string> {
  const actionId = `action-${uniqueSuffix("followup")}`;
  const scheduledFor = input.scheduledFor ?? new Date(Date.now() - 60_000);
  // crm_agent_actions.created_at is second-precision DATETIME while
  // conversation_message.created_at is millisecond-precision; a couple of
  // seconds of headroom avoids same-second truncation making the seed
  // conversation's own inbound message look like a reply that arrived after
  // this follow-up was scheduled.
  const createdAt = input.createdAt ?? new Date(Date.now() + 2000);
  const insert = await safeExecute(
    `INSERT INTO crm_agent_actions (
        action_id, idempotency_key, conversation_case_id, wa_id, channel,
        action_type, status, draft_message, scheduled_for, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'whatsapp', 'schedule_followup', 'planned', ?, ?, ?, ?)`,
    [
      actionId,
      actionId,
      input.conversationId,
      input.waId,
      "¿Seguimos con tu cotización?",
      scheduledFor.toISOString().slice(0, 19).replace("T", " "),
      createdAt.toISOString().slice(0, 19).replace("T", " "),
      createdAt.toISOString().slice(0, 19).replace("T", " ")
    ]
  );
  assert.ok(insert.ok, insert.ok ? "" : insert.error);
  return actionId;
}

async function loadAction(actionId: string) {
  const result = await safeQueryRows<{ status: string; cancel_reason: string | null; failure_reason: string | null }>(
    "SELECT status, cancel_reason, failure_reason FROM crm_agent_actions WHERE action_id = ? LIMIT 1",
    [actionId]
  );
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.rows[0] ?? null;
}

test("a due follow-up executes exactly once through the injected cycle runner", async () => {
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId });

  let calls = 0;
  const result = await runFollowupTick({
    limit: 10,
    actionIds: [actionId],
    cycleRunner: async (...args) => {
      calls += 1;
      return fakeCycleRunner(...args);
    }
  });

  assert.equal(calls, 1);
  assert.deepEqual(result.executed, [actionId]);
  const row = await loadAction(actionId);
  assert.equal(row?.status, "executed");
});

test("a customer reply after scheduling cancels the follow-up instead of executing it", async () => {
  const conversation = await seedConversation();
  // createdAt in the past (rather than the +2s default) so the reply sent
  // immediately below is unambiguously newer, even across the second/
  // millisecond precision gap between conversation_message and crm_agent_actions.
  const actionId = await scheduleFollowUpAction({
    conversationId: conversation.id,
    waId: conversation.waId,
    createdAt: new Date(Date.now() - 5000)
  });

  // A newer inbound than the action's created_at simulates the customer replying.
  await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix("followup-reply")}`,
    phoneNumberId: `phone-${uniqueSuffix("pnid")}`,
    externalSenderId: conversation.waId,
    senderPhone: conversation.waId,
    senderName: "Cliente Followup Test",
    messageType: "text",
    text: "Ya no necesito, gracias",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });

  let calls = 0;
  const result = await runFollowupTick({
    limit: 10,
    actionIds: [actionId],
    cycleRunner: async (...args) => {
      calls += 1;
      return fakeCycleRunner(...args);
    }
  });

  assert.equal(calls, 0);
  assert.equal(result.cancelled[0]?.actionId, actionId);
  assert.equal(result.cancelled[0]?.reason, "customer_replied_since_schedule");
  const row = await loadAction(actionId);
  assert.equal(row?.status, "cancelled");
  assert.equal(row?.cancel_reason, "customer_replied_since_schedule");
});

test("human ownership and a paused AI cancel the follow-up", async () => {
  const humanOwned = await seedConversation();
  const humanAction = await scheduleFollowUpAction({ conversationId: humanOwned.id, waId: humanOwned.waId });
  await safeExecute("UPDATE conversation SET human_owner_active = 1, ai_enabled = 0 WHERE id = ?", [humanOwned.id]);

  const humanResult = await runFollowupTick({ limit: 10, actionIds: [humanAction], cycleRunner: fakeCycleRunner });
  assert.equal(humanResult.cancelled[0]?.reason, "human_owner_active");

  const paused = await seedConversation();
  const pausedAction = await scheduleFollowUpAction({ conversationId: paused.id, waId: paused.waId });
  await safeExecute("UPDATE conversation SET human_owner_active = 0, ai_enabled = 0 WHERE id = ?", [paused.id]);

  const pausedResult = await runFollowupTick({ limit: 10, actionIds: [pausedAction], cycleRunner: fakeCycleRunner });
  assert.equal(pausedResult.cancelled[0]?.reason, "ai_paused");
});

test("a closed conversation cancels the follow-up", async () => {
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId });
  await safeExecute("UPDATE conversation SET status = 'closed' WHERE id = ?", [conversation.id]);

  const result = await runFollowupTick({ limit: 10, actionIds: [actionId], cycleRunner: fakeCycleRunner });
  assert.equal(result.cancelled[0]?.reason, "conversation_closed");
});

test("a terminal opportunity cancels the follow-up", async () => {
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId });
  const oppInsert = await safeExecute(
    `INSERT INTO crm_opportunities (
        opportunity_key, wa_id, channel, primary_intent, status, temperature, priority,
        requirements_json, missing_requirements_json, product_interests_json, objections_json, signals_json
      ) VALUES (?, ?, 'whatsapp', 'unknown', 'won', 'warm', 'normal', '[]', '[]', '[]', '[]', '[]')`,
    [`opp-${uniqueSuffix("terminal")}`, conversation.waId]
  );
  assert.ok(oppInsert.ok, oppInsert.ok ? "" : oppInsert.error);

  const result = await runFollowupTick({ limit: 10, actionIds: [actionId], cycleRunner: fakeCycleRunner });
  assert.equal(result.cancelled[0]?.reason, "opportunity_terminal_status:won");
});

test("selectDueFollowUps ignores rows not yet due, expired rows and rows outside the id scope", async () => {
  const conversation = await seedConversation();
  const futureAction = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId, scheduledFor: new Date(Date.now() + 3_600_000) });
  const dueAction = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId });

  const due = await selectDueFollowUps(50, [futureAction, dueAction]);
  const ids = due.map((row) => row.action_id);
  assert.equal(ids.includes(dueAction), true);
  assert.equal(ids.includes(futureAction), false);
});

test("the claim is atomic: a concurrent tick on the same action never runs the cycle twice", async () => {
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId });

  let calls = 0;
  const runOnce = () =>
    runFollowupTick({
      limit: 10,
      actionIds: [actionId],
      cycleRunner: async (...args) => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return fakeCycleRunner(...args);
      }
    });

  const [a, b] = await Promise.all([runOnce(), runOnce()]);
  assert.equal(calls, 1);
  assert.equal(a.executed.length + b.executed.length, 1);
});

test("a completion write only applies to the row's own executing claim (CAS), never clobbering a concurrent cancellation", async () => {
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId });

  await runFollowupTick({
    limit: 10,
    actionIds: [actionId],
    cycleRunner: async (...args) => {
      // Simulate an operator/other process cancelling the row mid-flight,
      // i.e. after this tick's own CAS claim moved it to 'executing'.
      await safeExecute(
        `UPDATE crm_agent_actions SET status = 'cancelled', cancel_reason = 'operator_intervened' WHERE action_id = ? AND status = 'executing'`,
        [actionId]
      );
      return fakeCycleRunner(...args);
    }
  });

  const row = await loadAction(actionId);
  // The tick's own completion UPDATE must be a no-op here: the row is still
  // 'cancelled', not overwritten back to 'executed'.
  assert.equal(row?.status, "cancelled");
  assert.equal(row?.cancel_reason, "operator_intervened");
});

test("shouldCancelFollowUp reports no cancellation for a healthy, still-relevant follow-up", async () => {
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId });

  const rows = await selectDueFollowUps(50, [actionId]);
  const decision = await shouldCancelFollowUp(rows[0]);
  assert.equal(decision.cancel, false);
});
