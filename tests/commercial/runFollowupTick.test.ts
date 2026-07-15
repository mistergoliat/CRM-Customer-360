import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, safeExecute, safeQueryRows } from "@/lib/db";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";
import {
  runFollowupTick,
  selectDueFollowUps,
  shouldCancelFollowUp,
  cancelFollowUp,
  claimPlannedFollowUp,
  claimStaleExecutingFollowUp,
  terminalizeExhaustedStaleFollowUp
} from "@/lib/brain/commercial/followup/runFollowupTick";
import {
  FOLLOW_UP_STALE_EXECUTING_LOCK_SECONDS,
  FOLLOW_UP_STALE_EXECUTION_EXHAUSTED_REASON
} from "@/lib/brain/commercial/followup/followUpWorkerPolicy";
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
  const result = await safeQueryRows<{
    status: string;
    cancel_reason: string | null;
    failure_reason: string | null;
    attempt_number: number;
    max_attempts: number;
  }>(
    "SELECT status, cancel_reason, failure_reason, attempt_number, max_attempts FROM crm_agent_actions WHERE action_id = ? LIMIT 1",
    [actionId]
  );
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.rows[0] ?? null;
}

// Directly mutates state that the application code paths cannot normally
// reach in a single call (a backdated updated_at for staleness, or an
// arbitrary attempt_number/max_attempts/status combination) so tests can
// exercise the worker's recovery/retry/cancellation preconditions in
// isolation, without depending on real elapsed time.
async function setActionState(
  actionId: string,
  input: { status: string; attemptNumber?: number; maxAttempts?: number; updatedAt?: Date }
): Promise<void> {
  const updatedAt = input.updatedAt ?? new Date();
  const result = await safeExecute(
    `UPDATE crm_agent_actions
      SET status = ?,
          attempt_number = COALESCE(?, attempt_number),
          max_attempts = COALESCE(?, max_attempts),
          updated_at = ?
      WHERE action_id = ?`,
    [
      input.status,
      input.attemptNumber ?? null,
      input.maxAttempts ?? null,
      updatedAt.toISOString().slice(0, 19).replace("T", " "),
      actionId
    ]
  );
  assert.ok(result.ok, result.ok ? "" : result.error);
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

// ---------------------------------------------------------------------------
// ACS-R1-05-T03: stale-lock recovery (P0-2)
// ---------------------------------------------------------------------------

test("a recently-locked executing action is not recovered as stale", async () => {
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId });
  await setActionState(actionId, { status: "executing", attemptNumber: 1, maxAttempts: 3, updatedAt: new Date() });

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
  assert.equal(result.executed.length, 0);
  const row = await loadAction(actionId);
  assert.equal(row?.status, "executing");
});

test("a stale-locked executing action with attempts remaining is recovered and executes", async () => {
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId });
  const staleUpdatedAt = new Date(Date.now() - (FOLLOW_UP_STALE_EXECUTING_LOCK_SECONDS + 60) * 1000);
  await setActionState(actionId, { status: "executing", attemptNumber: 1, maxAttempts: 3, updatedAt: staleUpdatedAt });

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
  // ACS-R1-05-T03.1: recovering a stale executing row IS a new commercial
  // attempt (the crashed run's outcome is unknown) - attempt_number must
  // move from 1 to 2, incremented exactly once by the recovery claim itself.
  assert.equal(row?.attempt_number, 2);
});

test("successive stale recoveries increment attempt_number each time until max_attempts is reached", async () => {
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId });
  const stale = () => new Date(Date.now() - (FOLLOW_UP_STALE_EXECUTING_LOCK_SECONDS + 60) * 1000);
  await setActionState(actionId, { status: "executing", attemptNumber: 1, maxAttempts: 3, updatedAt: stale() });

  const first = await claimStaleExecutingFollowUp(actionId);
  assert.equal(first, true);
  let row = await loadAction(actionId);
  assert.equal(row?.attempt_number, 2);
  assert.equal(row?.status, "executing");

  // Simulate the just-recovered attempt stranding again (a second crash)
  // by backdating updated_at once more, without going through a full cycle.
  await setActionState(actionId, { status: "executing", updatedAt: stale() });
  const second = await claimStaleExecutingFollowUp(actionId);
  assert.equal(second, true);
  row = await loadAction(actionId);
  assert.equal(row?.attempt_number, 3);

  // A third recovery attempt: attempt_number(3) is no longer < max_attempts(3).
  await setActionState(actionId, { status: "executing", updatedAt: stale() });
  const third = await claimStaleExecutingFollowUp(actionId);
  assert.equal(third, false);
  row = await loadAction(actionId);
  assert.equal(row?.status, "executing");
  assert.equal(row?.attempt_number, 3);
});

test("a stale-locked executing action with no attempts remaining is terminalized to failed, never recovered", async () => {
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId });
  const staleUpdatedAt = new Date(Date.now() - (FOLLOW_UP_STALE_EXECUTING_LOCK_SECONDS + 60) * 1000);
  await setActionState(actionId, { status: "executing", attemptNumber: 3, maxAttempts: 3, updatedAt: staleUpdatedAt });

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
  assert.equal(result.executed.length, 0);
  assert.deepEqual(result.failed, [actionId]);
  const row = await loadAction(actionId);
  assert.equal(row?.status, "failed");
  // Terminalization never touches attempt_number - it is not a new attempt.
  assert.equal(row?.attempt_number, 3);
  assert.equal(row?.failure_reason, FOLLOW_UP_STALE_EXECUTION_EXHAUSTED_REASON);
});

test("a second tick never re-touches a terminalized exhausted stale action", async () => {
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId });
  const staleUpdatedAt = new Date(Date.now() - (FOLLOW_UP_STALE_EXECUTING_LOCK_SECONDS + 60) * 1000);
  await setActionState(actionId, { status: "executing", attemptNumber: 3, maxAttempts: 3, updatedAt: staleUpdatedAt });

  const first = await runFollowupTick({ limit: 10, actionIds: [actionId], cycleRunner: fakeCycleRunner });
  assert.deepEqual(first.failed, [actionId]);

  const due = await selectDueFollowUps(50, [actionId]);
  assert.equal(due.length, 0);

  const second = await runFollowupTick({ limit: 10, actionIds: [actionId], cycleRunner: fakeCycleRunner });
  assert.equal(second.processed, 0);
  assert.equal(second.failed.length, 0);
  const row = await loadAction(actionId);
  assert.equal(row?.status, "failed");
  assert.equal(row?.failure_reason, FOLLOW_UP_STALE_EXECUTION_EXHAUSTED_REASON);
});

test("two concurrent ticks racing to recover the same stale-locked action: only one recovers it", async () => {
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId });
  const staleUpdatedAt = new Date(Date.now() - (FOLLOW_UP_STALE_EXECUTING_LOCK_SECONDS + 60) * 1000);
  await setActionState(actionId, { status: "executing", attemptNumber: 1, maxAttempts: 3, updatedAt: staleUpdatedAt });

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
  const row = await loadAction(actionId);
  // Exactly one recovery claim won, so attempt_number moved by exactly 1.
  assert.equal(row?.attempt_number, 2);
});

test("two concurrent terminalizations of the same exhausted stale action: only one modifies it", async () => {
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId });
  const staleUpdatedAt = new Date(Date.now() - (FOLLOW_UP_STALE_EXECUTING_LOCK_SECONDS + 60) * 1000);
  await setActionState(actionId, { status: "executing", attemptNumber: 3, maxAttempts: 3, updatedAt: staleUpdatedAt });

  const [a, b] = await Promise.all([
    terminalizeExhaustedStaleFollowUp(actionId),
    terminalizeExhaustedStaleFollowUp(actionId)
  ]);

  assert.equal(a !== b, true);
  const row = await loadAction(actionId);
  assert.equal(row?.status, "failed");
  assert.equal(row?.failure_reason, FOLLOW_UP_STALE_EXECUTION_EXHAUSTED_REASON);
});

// ---------------------------------------------------------------------------
// ACS-R1-05-T03.1: uniform post-claim revalidation (all claim origins)
// ---------------------------------------------------------------------------

test("a planned claim followed by a customer reply cancels before the cycle runs", async () => {
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({
    conversationId: conversation.id,
    waId: conversation.waId,
    createdAt: new Date(Date.now() - 5000)
  });

  let calls = 0;
  const result = await runFollowupTick({
    limit: 10,
    actionIds: [actionId],
    onAfterClaim: async () => {
      // Proves the claim already happened (planned -> executing) before this
      // hook fires, i.e. before revalidation - not a pre-claim check.
      const midClaim = await loadAction(actionId);
      assert.equal(midClaim?.status, "executing");
      await processNativeWhatsAppInbound({
        providerMessageId: `wamid.${uniqueSuffix("postclaim-reply")}`,
        phoneNumberId: `phone-${uniqueSuffix("pnid")}`,
        externalSenderId: conversation.waId,
        senderPhone: conversation.waId,
        senderName: "Cliente Followup Test",
        messageType: "text",
        text: "Ya no necesito, gracias",
        occurredAt: new Date().toISOString(),
        rawPayload: {}
      });
    },
    cycleRunner: async (...args) => {
      calls += 1;
      return fakeCycleRunner(...args);
    }
  });

  assert.equal(calls, 0);
  assert.equal(result.cancelled[0]?.reason, "customer_replied_since_schedule");
  const row = await loadAction(actionId);
  assert.equal(row?.status, "cancelled");
});

test("a retry claim from failed followed by a terminal opportunity cancels before the cycle runs", async () => {
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId });
  await setActionState(actionId, { status: "failed", attemptNumber: 1, maxAttempts: 3 });

  let calls = 0;
  const result = await runFollowupTick({
    limit: 10,
    actionIds: [actionId],
    onAfterClaim: async () => {
      // Proves the retry claim already incremented attempt_number and moved
      // the row to 'executing' before this hook fires.
      const midClaim = await loadAction(actionId);
      assert.equal(midClaim?.status, "executing");
      assert.equal(midClaim?.attempt_number, 2);
      const oppInsert = await safeExecute(
        `INSERT INTO crm_opportunities (
            opportunity_key, wa_id, channel, primary_intent, status, temperature, priority,
            requirements_json, missing_requirements_json, product_interests_json, objections_json, signals_json
          ) VALUES (?, ?, 'whatsapp', 'unknown', 'lost', 'warm', 'normal', '[]', '[]', '[]', '[]', '[]')`,
        [`opp-${uniqueSuffix("postclaim-terminal")}`, conversation.waId]
      );
      assert.ok(oppInsert.ok, oppInsert.ok ? "" : oppInsert.error);
    },
    cycleRunner: async (...args) => {
      calls += 1;
      return fakeCycleRunner(...args);
    }
  });

  assert.equal(calls, 0);
  assert.equal(result.cancelled[0]?.reason, "opportunity_terminal_status:lost");
  const row = await loadAction(actionId);
  assert.equal(row?.status, "cancelled");
});

test("a stale-lock recovery claim followed by a human takeover cancels before the cycle runs", async () => {
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId });
  const staleUpdatedAt = new Date(Date.now() - (FOLLOW_UP_STALE_EXECUTING_LOCK_SECONDS + 60) * 1000);
  await setActionState(actionId, { status: "executing", attemptNumber: 1, maxAttempts: 3, updatedAt: staleUpdatedAt });

  let calls = 0;
  const result = await runFollowupTick({
    limit: 10,
    actionIds: [actionId],
    onAfterClaim: async () => {
      // Proves the stale-lock recovery already incremented attempt_number
      // before this hook fires.
      const midClaim = await loadAction(actionId);
      assert.equal(midClaim?.status, "executing");
      assert.equal(midClaim?.attempt_number, 2);
      await safeExecute("UPDATE conversation SET human_owner_active = 1 WHERE id = ?", [conversation.id]);
    },
    cycleRunner: async (...args) => {
      calls += 1;
      return fakeCycleRunner(...args);
    }
  });

  assert.equal(calls, 0);
  assert.equal(result.cancelled[0]?.reason, "human_owner_active");
  const row = await loadAction(actionId);
  assert.equal(row?.status, "cancelled");
});

// ---------------------------------------------------------------------------
// ACS-R1-05-T03: retry of failed actions with max_attempts enforcement (P0-3)
// ---------------------------------------------------------------------------

test("a failed action with attempts remaining is retried and attempt_number is incremented exactly once", async () => {
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId });
  await setActionState(actionId, { status: "failed", attemptNumber: 1, maxAttempts: 3 });

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
  assert.equal(row?.attempt_number, 2);
});

test("a failed action at max_attempts is never retried", async () => {
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId });
  await setActionState(actionId, { status: "failed", attemptNumber: 3, maxAttempts: 3 });

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
  assert.equal(result.executed.length, 0);
  const row = await loadAction(actionId);
  assert.equal(row?.status, "failed");
  assert.equal(row?.attempt_number, 3);
});

test("a cycle failure with attempts remaining leaves the action retryable", async () => {
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId });
  await setActionState(actionId, { status: "planned", attemptNumber: 1, maxAttempts: 3 });

  const result = await runFollowupTick({
    limit: 10,
    actionIds: [actionId],
    cycleRunner: async () => {
      throw new Error("boom");
    }
  });

  assert.deepEqual(result.failed, [actionId]);
  const row = await loadAction(actionId);
  assert.equal(row?.status, "failed");

  const due = await selectDueFollowUps(50, [actionId]);
  assert.equal(due.length, 1);
});

test("a cycle failure at max_attempts leaves the action terminal", async () => {
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId });
  // Default attempt_number/max_attempts from scheduleFollowUpAction is 1/1.

  const result = await runFollowupTick({
    limit: 10,
    actionIds: [actionId],
    cycleRunner: async () => {
      throw new Error("boom");
    }
  });

  assert.deepEqual(result.failed, [actionId]);
  const row = await loadAction(actionId);
  assert.equal(row?.status, "failed");

  const due = await selectDueFollowUps(50, [actionId]);
  assert.equal(due.length, 0);
});

// ---------------------------------------------------------------------------
// ACS-R1-05-T03: cancelFollowUp status precondition (P1-1)
// ---------------------------------------------------------------------------

test("cancelFollowUp cancels a planned action", async () => {
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId });

  const outcome = await cancelFollowUp(actionId, "manual_test_reason");
  assert.equal(outcome.cancelled, true);
  const row = await loadAction(actionId);
  assert.equal(row?.status, "cancelled");
  assert.equal(row?.cancel_reason, "manual_test_reason");
});

test("cancelFollowUp cancels a failed, still-retryable action", async () => {
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId });
  await setActionState(actionId, { status: "failed", attemptNumber: 1, maxAttempts: 3 });

  const outcome = await cancelFollowUp(actionId, "manual_test_reason");
  assert.equal(outcome.cancelled, true);
  const row = await loadAction(actionId);
  assert.equal(row?.status, "cancelled");
});

test("cancelFollowUp never cancels an executing action", async () => {
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId });
  await setActionState(actionId, { status: "executing", attemptNumber: 1, maxAttempts: 3 });

  const outcome = await cancelFollowUp(actionId, "manual_test_reason");
  assert.equal(outcome.cancelled, false);
  const row = await loadAction(actionId);
  assert.equal(row?.status, "executing");
});

test("a race between cancellation and claim on a planned action: only one transition wins", async () => {
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId });

  const [cancelOutcome, claimed] = await Promise.all([
    cancelFollowUp(actionId, "race_test"),
    claimPlannedFollowUp(actionId)
  ]);

  // Exactly one of the two competing transitions may have won.
  assert.equal(cancelOutcome.cancelled !== claimed, true);
  const row = await loadAction(actionId);
  if (cancelOutcome.cancelled) {
    assert.equal(row?.status, "cancelled");
  } else {
    assert.equal(row?.status, "executing");
  }
});

// ---------------------------------------------------------------------------
// ACS-R1-05-T03: candidate scoping invariants
// ---------------------------------------------------------------------------

test("a requires_review action is never selected or executed by the follow-up tick", async () => {
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId });
  await setActionState(actionId, { status: "requires_review" });

  const due = await selectDueFollowUps(50, [actionId]);
  assert.equal(due.length, 0);

  const result = await runFollowupTick({ limit: 10, actionIds: [actionId], cycleRunner: fakeCycleRunner });
  assert.equal(result.processed, 0);
  const row = await loadAction(actionId);
  assert.equal(row?.status, "requires_review");
});

test("an action of a different action_type is never touched by the follow-up tick", async () => {
  const conversation = await seedConversation();
  const actionId = `action-${uniqueSuffix("other-type")}`;
  const insert = await safeExecute(
    `INSERT INTO crm_agent_actions (
        action_id, idempotency_key, conversation_case_id, wa_id, channel,
        action_type, status, draft_message, scheduled_for, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'whatsapp', 'send_whatsapp_reply', 'planned', ?, ?, NOW(), NOW())`,
    [
      actionId,
      actionId,
      conversation.id,
      conversation.waId,
      "hola",
      new Date(Date.now() - 60_000).toISOString().slice(0, 19).replace("T", " ")
    ]
  );
  assert.ok(insert.ok, insert.ok ? "" : insert.error);

  const due = await selectDueFollowUps(50, [actionId]);
  assert.equal(due.length, 0);

  const result = await runFollowupTick({ limit: 10, actionIds: [actionId], cycleRunner: fakeCycleRunner });
  assert.equal(result.processed, 0);
  const row = await loadAction(actionId);
  assert.equal(row?.status, "planned");
});

test("a second tick does not duplicate execution of an already-executed action", async () => {
  const conversation = await seedConversation();
  const actionId = await scheduleFollowUpAction({ conversationId: conversation.id, waId: conversation.waId });

  let calls = 0;
  const cycleRunner: typeof runNativeAutonomousCycle = async (...args) => {
    calls += 1;
    return fakeCycleRunner(...args);
  };

  const first = await runFollowupTick({ limit: 10, actionIds: [actionId], cycleRunner });
  assert.deepEqual(first.executed, [actionId]);

  const second = await runFollowupTick({ limit: 10, actionIds: [actionId], cycleRunner });
  assert.equal(second.processed, 0);
  assert.equal(calls, 1);

  const row = await loadAction(actionId);
  assert.equal(row?.status, "executed");
});
