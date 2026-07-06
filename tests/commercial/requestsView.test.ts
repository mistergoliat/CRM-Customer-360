import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool } from "@/lib/db";
import {
  deferRequestAction,
  loadConversationRequestsView,
  loadRequestDetailView,
  runMultiRequestAutonomousCycle,
  scheduleRequestFollowup
} from "@/lib/brain/commercial/multi-request";
import { createQuoteDraft } from "@/lib/brain/commercial/quotes";
import { escalateRequest } from "@/lib/brain/commercial/request-escalations";
import { upsertRequestFact } from "@/lib/brain/commercial/request-facts";

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

test("the HUB view composes state, facts, quote, escalation, deferred work and trail per request", async () => {
  const conversationId = 900000000 + Math.floor(Math.random() * 99999999);

  const turn = await runMultiRequestAutonomousCycle({
    conversationId,
    inboundMessageId: uniqueSuffix("cm"),
    messageText: "Quiero cotizar una banca y además presentar un reclamo formal",
    correlationId: uniqueSuffix("corr")
  });
  assert.equal(turn.ran, true);
  const quoteRequest = turn.activeRequests.find((request) => request.intentType === "product_quote")!;
  const complaintRequest = turn.activeRequests.find((request) => request.intentType === "complaint")!;

  await upsertRequestFact({ requestId: quoteRequest.requestId, factKey: "products", value: ["banca plana"] });
  await createQuoteDraft({
    requestId: quoteRequest.requestId,
    items: [{ productId: "p1", name: "Banca plana", quantity: 1, unitPrice: 89990, lineTotal: 89990 }],
    totals: { subtotal: 89990, shipping: null, total: 89990, currency: "CLP" }
  });
  await deferRequestAction({
    requestId: quoteRequest.requestId,
    turnPlanId: turn.turnPlan!.turnPlanId,
    actionType: "send_quote",
    reason: "waiting_confirmation"
  });
  await scheduleRequestFollowup({
    requestId: quoteRequest.requestId,
    purpose: "quote_follow_up",
    scheduledFor: new Date(Date.now() + 3_600_000).toISOString()
  });
  await escalateRequest({
    requestId: complaintRequest.requestId,
    category: "customer_service",
    mode: "exclusive_handoff",
    reason: "reclamo del cliente",
    createdBy: "planner"
  });

  const view = await loadConversationRequestsView({ conversationId });
  assert.notEqual(view, null);
  assert.equal(view!.requests.length, 2);

  const quoteView = view!.requests.find((entry) => entry.request.requestId === quoteRequest.requestId)!;
  assert.equal(quoteView.activeFacts.some((fact) => fact.factKey === "products"), true);
  assert.equal(quoteView.currentQuote?.totals.total, 89990);
  assert.equal(quoteView.deferredActions.some((action) => action.actionType === "send_quote"), true);
  assert.equal(quoteView.pendingFollowups.length, 1);
  assert.equal(quoteView.openEscalation, null);
  assert.equal(quoteView.recentEvents.some((event) => event.eventType === "request_created"), true);

  const complaintView = view!.requests.find((entry) => entry.request.requestId === complaintRequest.requestId)!;
  assert.equal(complaintView.request.status, "waiting_human");
  assert.equal(complaintView.openEscalation?.category, "customer_service");
  assert.equal(complaintView.currentQuote, null);

  assert.equal(view!.totals.waitingHuman, 1);

  const detail = await loadRequestDetailView(quoteRequest.requestId);
  assert.equal(detail?.request.requestId, quoteRequest.requestId);
  assert.equal((await loadRequestDetailView("convreq-no-existe")), null);
});

test("an unknown conversation public id yields null, not an empty view", async () => {
  const view = await loadConversationRequestsView({ conversationPublicId: uniqueSuffix("conv-pub-ghost") });
  assert.equal(view, null);
});
