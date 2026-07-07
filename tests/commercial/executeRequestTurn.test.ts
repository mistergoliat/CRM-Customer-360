import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, hasTable } from "@/lib/db";
import { executeRequestTurn } from "@/lib/brain/commercial/multi-request";
import {
  createConversationRequest,
  listRequestEvents,
  loadConversationRequest,
  transitionConversationRequest
} from "@/lib/brain/commercial/conversation-request";
import { findOpenEscalationForRequest } from "@/lib/brain/commercial/request-escalations";
import { listDeferredActionsForRequest } from "@/lib/brain/commercial/multi-request";
import { upsertRequestFact } from "@/lib/brain/commercial/request-facts";
import { runMultiRequestAutonomousCycle } from "@/lib/brain/commercial/multi-request";

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

async function makeActiveRequest(intentType: string, intentDomain: string) {
  const created = await createConversationRequest({
    creationKey: uniqueSuffix("creation"),
    conversationId: 900000000 + Math.floor(Math.random() * 99999999),
    intentType,
    intentDomain: intentDomain as never,
    createdFromMessageId: uniqueSuffix("cm")
  });
  assert.equal(created.ok, true, created.ok ? "" : created.warning);
  await transitionConversationRequest({ requestId: created.request!.requestId, fromStatus: "detected", toStatus: "active" });
  return (await loadConversationRequest(created.request!.requestId))!;
}

test("a non-active request is never touched", async () => {
  const request = await makeActiveRequest("complaint", "support");
  await transitionConversationRequest({ requestId: request.requestId, fromStatus: "active", toStatus: "waiting_customer" });
  const waiting = (await loadConversationRequest(request.requestId))!;

  const result = await executeRequestTurn({ request: waiting, messageText: "hola", turnPlanId: uniqueSuffix("tp") });
  assert.equal(result.attempted, false);
  assert.equal(result.outcome, "not_active");
});

test("complaint auto-escalates exactly once; a second turn sees it already escalated", async () => {
  const request = await makeActiveRequest("complaint", "support");
  const turnPlanId = uniqueSuffix("tp");

  const first = await executeRequestTurn({ request, messageText: "esto es un reclamo formal", turnPlanId });
  assert.equal(first.attempted, true);
  assert.equal(first.outcome, "escalated");

  const escalation = await findOpenEscalationForRequest(request.requestId);
  assert.notEqual(escalation, null);
  assert.equal(escalation?.category, "customer_service");
  assert.equal(escalation?.mode, "exclusive_handoff");

  // Reload: the reducer would have parked it waiting_human by now via the event;
  // simulate a second call on the stale in-memory "active" snapshot to prove
  // the executor itself is idempotent regardless (checks findOpenEscalationForRequest).
  const second = await executeRequestTurn({ request, messageText: "otra vez", turnPlanId: uniqueSuffix("tp2") });
  assert.equal(second.attempted, false);
  assert.equal(second.outcome, "already_escalated");

  const events = await listRequestEvents(request.requestId);
  assert.equal(events.filter((event) => event.eventType === "human_escalation_created").length, 1);
});

test("human_assistance auto-escalates the same way as complaint", async () => {
  const request = await makeActiveRequest("human_assistance", "human_assistance");
  const result = await executeRequestTurn({ request, messageText: "quiero hablar con una persona", turnPlanId: uniqueSuffix("tp") });
  assert.equal(result.outcome, "escalated");
  const escalation = await findOpenEscalationForRequest(request.requestId);
  assert.equal(escalation?.reason, "customer_requested_human_assistance");
});

test("order_status never falls back to raw message text as an identifier - it waits for the real fact", async () => {
  const request = await makeActiveRequest("order_status", "order");
  // No fact set: nothing usable to try.
  const result = await executeRequestTurn({ request, messageText: "donde esta mi pedido", turnPlanId: uniqueSuffix("tp") });
  assert.equal(result.attempted, false);
  assert.equal(result.outcome, "no_input_available");
});

test("order_status executes get_order_status once the order_identifier fact exists, and resolves via the reducer", async () => {
  const request = await makeActiveRequest("order_status", "order");
  await upsertRequestFact({ requestId: request.requestId, factKey: "order_identifier", value: "REF-DOES-NOT-EXIST-123" });
  const withFact = (await loadConversationRequest(request.requestId))!;

  const result = await executeRequestTurn({ request: withFact, messageText: "donde esta mi pedido", turnPlanId: uniqueSuffix("tp") });

  if (await hasTable("ps_orders")) {
    // Real source available: even "not found" is a real, resolving answer.
    assert.equal(result.outcome, "resolved");
    const events = await listRequestEvents(request.requestId);
    assert.equal(events.some((event) => event.eventType === "order_status_provided"), true);
  } else {
    assert.equal(result.outcome, "deferred");
    const deferred = await listDeferredActionsForRequest(request.requestId);
    assert.equal(deferred.some((action) => action.actionType === "get_order_status"), true);
  }
});

test("maintenance_information always defers honestly - identify_equipment has no real source yet", async () => {
  const request = await makeActiveRequest("maintenance_information", "maintenance");
  await upsertRequestFact({ requestId: request.requestId, factKey: "equipment_code", value: "trotadora XT900" });
  const withFact = (await loadConversationRequest(request.requestId))!;

  const result = await executeRequestTurn({ request: withFact, messageText: "cuanto sale la mantencion", turnPlanId: uniqueSuffix("tp") });
  assert.equal(result.outcome, "deferred");

  const deferred = await listDeferredActionsForRequest(request.requestId);
  assert.equal(deferred.some((action) => action.actionType === "identify_equipment" && action.reason === "service_catalog_not_available"), true);
});

test("general_question falls back to the raw message text for search_products", async () => {
  const request = await makeActiveRequest("general_question", "general");
  const result = await executeRequestTurn({ request, messageText: "tienen bancas planas para press?", turnPlanId: uniqueSuffix("tp") });

  if (await hasTable("ps_product")) {
    assert.equal(result.outcome, "resolved");
    const events = await listRequestEvents(request.requestId);
    assert.equal(events.some((event) => event.eventType === "information_provided"), true);
  } else {
    assert.equal(result.outcome, "deferred");
  }
});

test("product_quote and maintenance_quote have no execution strategy - they stay fact-gated on purpose", async () => {
  const quote = await makeActiveRequest("product_quote", "sales");
  const result = await executeRequestTurn({ request: quote, messageText: "cotizame una banca", turnPlanId: uniqueSuffix("tp") });
  assert.equal(result.attempted, false);
  assert.equal(result.outcome, "no_execution_strategy");
});

test("end-to-end: a complaint inbound through the full cycle ends waiting_human with an open escalation", async () => {
  const conversationId = 900000000 + Math.floor(Math.random() * 99999999);
  const cycle = await runMultiRequestAutonomousCycle({
    conversationId,
    inboundMessageId: uniqueSuffix("cm"),
    messageText: "Quiero poner un reclamo, esto es indignante",
    correlationId: uniqueSuffix("corr")
  });

  assert.equal(cycle.ran, true);
  const complaint = cycle.activeRequests.find((request) => request.intentType === "complaint");
  assert.notEqual(complaint, undefined);
  assert.equal(complaint?.status, "waiting_human");
  assert.equal(cycle.executedTurns.some((turn) => turn.requestId === complaint?.requestId && turn.outcome === "escalated"), true);

  const escalation = await findOpenEscalationForRequest(complaint!.requestId);
  assert.notEqual(escalation, null);

  // The response draft reflects the escalation, not a generic "trabajando en esto".
  assert.ok(cycle.responseDraft!.text.includes("Deriv"));
});
