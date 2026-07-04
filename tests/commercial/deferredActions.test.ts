import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, safeQueryRows } from "@/lib/db";
import {
  cancelDeferredAction,
  completeDeferredAction,
  deferRequestAction,
  listDeferredActionsForRequest,
  runMultiRequestAutonomousCycle,
  AGENT_ACTIONS_TABLE
} from "@/lib/brain/commercial/multi-request";
import {
  createConversationRequest,
  listRequestEvents,
  transitionConversationRequest
} from "@/lib/brain/commercial/conversation-request";

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "main_management",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "main_management",
  DATABASE_USER: "crm_app",
  DATABASE_PASSWORD: "una_clave_local",
  DATABASE_URL: "",
  BRAIN_REQUEST_TRACKING_ENABLED: "true",
  BRAIN_TURN_PLAN_PERSISTENCE_ENABLED: "true"
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

async function makeActiveRequest(conversationId = 900000000 + Math.floor(Math.random() * 99999999)) {
  const created = await createConversationRequest({
    creationKey: uniqueSuffix("creation"),
    conversationId,
    intentType: "product_quote",
    intentDomain: "sales",
    createdFromMessageId: uniqueSuffix("cm")
  });
  assert.equal(created.ok, true, created.ok ? "" : created.warning);
  await transitionConversationRequest({ requestId: created.request!.requestId, fromStatus: "detected", toStatus: "active" });
  return created.request!;
}

test("deferring an action lands it in crm_agent_actions tagged to the request, with its event, idempotently per turn", async () => {
  const request = await makeActiveRequest();
  const turnPlanId = uniqueSuffix("turnplan");

  const first = await deferRequestAction({
    requestId: request.requestId,
    turnPlanId,
    actionType: "create_quote",
    reason: "execution_budget_exhausted",
    scheduledFor: new Date(Date.now() + 60_000).toISOString()
  });
  assert.equal(first.ok, true);
  assert.equal(first.status, "created");
  assert.equal(first.action?.status, "scheduled");
  assert.equal(first.action?.requestId, request.requestId);
  assert.equal(first.action?.reason, "execution_budget_exhausted");

  // Retry of the same turn: same idempotency key, no second row.
  const retry = await deferRequestAction({ requestId: request.requestId, turnPlanId, actionType: "create_quote", reason: "retry" });
  assert.equal(retry.status, "duplicate");
  assert.equal(retry.action?.actionId, first.action?.actionId);

  const count = await safeQueryRows<{ total: number }>(
    `SELECT COUNT(*) AS total FROM ${AGENT_ACTIONS_TABLE} WHERE request_id = ?`,
    [request.requestId]
  );
  assert.equal(Number(count.ok ? count.rows[0]?.total : -1), 1);

  const events = await listRequestEvents(request.requestId);
  assert.equal(events.filter((event) => event.eventType === "action_deferred").length, 1);
});

test("deferred actions stay isolated per request and can be completed or cancelled by CAS", async () => {
  const conversationId = 900000000 + Math.floor(Math.random() * 99999999);
  const requestA = await makeActiveRequest(conversationId);
  const requestB = await makeActiveRequest(conversationId);

  const deferredA = await deferRequestAction({ requestId: requestA.requestId, turnPlanId: uniqueSuffix("tp"), actionType: "create_quote", reason: "budget" });
  await deferRequestAction({ requestId: requestB.requestId, turnPlanId: uniqueSuffix("tp"), actionType: "find_order", reason: "source_unavailable" });

  assert.equal((await listDeferredActionsForRequest(requestA.requestId)).length, 1);
  assert.equal((await listDeferredActionsForRequest(requestB.requestId)).length, 1);
  assert.equal((await listDeferredActionsForRequest(requestA.requestId))[0].actionType, "create_quote");

  const completed = await completeDeferredAction(deferredA.action!.actionId, "cotización generada");
  assert.equal(completed.ok, true);
  assert.equal(completed.ok ? completed.action.status : "", "executed");
  assert.equal((await listDeferredActionsForRequest(requestA.requestId)).length, 0);

  const events = await listRequestEvents(requestA.requestId);
  assert.equal(events.some((event) => event.eventType === "action_executed"), true);

  // Completing again conflicts - one execution, exactly once.
  const again = await completeDeferredAction(deferredA.action!.actionId, "de nuevo");
  assert.equal(again.ok, false);
  assert.equal(again.ok ? "" : again.status, "conflict");

  const deferredB2 = await deferRequestAction({ requestId: requestB.requestId, turnPlanId: uniqueSuffix("tp2"), actionType: "get_order_status", reason: "later" });
  const cancelled = await cancelDeferredAction(deferredB2.action!.actionId, "customer_cancelled_request");
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.ok ? cancelled.action.status : "", "cancelled");
});

test("the cycle tells the customer about pending deferred work without claiming it done", async () => {
  const conversationId = 900000000 + Math.floor(Math.random() * 99999999);

  const firstTurn = await runMultiRequestAutonomousCycle({
    conversationId,
    inboundMessageId: uniqueSuffix("cm"),
    messageText: "Quiero cotizar una banca plana",
    correlationId: uniqueSuffix("corr")
  });
  const requestId = firstTurn.activeRequests[0].requestId;

  await deferRequestAction({
    requestId,
    turnPlanId: firstTurn.turnPlan!.turnPlanId,
    actionType: "create_quote",
    reason: "waiting_for_catalog"
  });

  const secondTurn = await runMultiRequestAutonomousCycle({
    conversationId,
    inboundMessageId: uniqueSuffix("cm"),
    messageText: "¿Cómo va mi cotización?",
    correlationId: uniqueSuffix("corr")
  });

  assert.notEqual(secondTurn.responseDraft, null);
  assert.ok(secondTurn.responseDraft!.text.includes("te aviso apenas tenga novedades"));
  assert.equal(/lista|enviada|hecha/.test(secondTurn.responseDraft!.text), false);
});
