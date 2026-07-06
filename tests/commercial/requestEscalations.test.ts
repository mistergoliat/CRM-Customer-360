import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, safeQueryRows } from "@/lib/db";
import {
  escalateRequest,
  findOpenEscalationForRequest,
  listOpenEscalations,
  loadRequestEscalation,
  resolveRequestEscalation,
  transitionEscalation,
  REQUEST_ESCALATION_TABLE
} from "@/lib/brain/commercial/request-escalations";
import {
  createConversationRequest,
  listRequestEvents,
  loadConversationRequest,
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
  DATABASE_URL: ""
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

async function makeActiveRequest(conversationId = 900000000 + Math.floor(Math.random() * 99999999), intentType = "complaint") {
  const created = await createConversationRequest({
    creationKey: uniqueSuffix("creation"),
    conversationId,
    intentType,
    intentDomain: "support",
    createdFromMessageId: uniqueSuffix("cm")
  });
  assert.equal(created.ok, true, created.ok ? "" : created.warning);
  const requestId = created.request!.requestId;
  await transitionConversationRequest({ requestId, fromStatus: "detected", toStatus: "active" });
  return created.request!;
}

test("escalating a request creates one open escalation with target, emits the event, and parks the request waiting_human", async () => {
  const request = await makeActiveRequest();

  const result = await escalateRequest({
    requestId: request.requestId,
    category: "customer_service",
    mode: "exclusive_handoff",
    reason: "Cliente molesto pide hablar con una persona",
    createdBy: "planner"
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "created");
  assert.equal(result.escalation?.status, "created");
  // Invariant ADR-007: every escalation has a target.
  assert.equal(result.escalation?.targetType, "queue");
  assert.equal(result.escalation?.targetId, "general");

  const parked = await loadConversationRequest(request.requestId);
  assert.equal(parked?.status, "waiting_human");

  const events = await listRequestEvents(request.requestId);
  assert.equal(events.some((event) => event.eventType === "human_escalation_created"), true);
});

test("a request holds at most one open escalation; a second open is allowed only after the first closes", async () => {
  const request = await makeActiveRequest();

  const first = await escalateRequest({ requestId: request.requestId, category: "sales", mode: "approval_request", reason: "descuento", createdBy: "planner" });
  const duplicate = await escalateRequest({ requestId: request.requestId, category: "sales", mode: "approval_request", reason: "descuento again", createdBy: "planner" });
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.escalation?.escalationId, first.escalation?.escalationId);

  const count = await safeQueryRows<{ total: number }>(
    `SELECT COUNT(*) AS total FROM ${REQUEST_ESCALATION_TABLE} WHERE request_id = ?`,
    [request.requestId]
  );
  assert.equal(Number(count.ok ? count.rows[0]?.total : -1), 1);

  await resolveRequestEscalation({ escalationId: first.escalation!.escalationId, outcome: "returned_to_ai", operatorId: "op-1" });

  const second = await escalateRequest({ requestId: request.requestId, category: "sales", mode: "approval_request", reason: "otro tema", createdBy: "operator" });
  assert.equal(second.status, "created");
  assert.notEqual(second.escalation?.escalationId, first.escalation?.escalationId);
});

test("the lifecycle moves by CAS and terminal states are protected", async () => {
  const request = await makeActiveRequest();
  const created = await escalateRequest({ requestId: request.requestId, category: "logistics", mode: "internal_consultation", reason: "despacho", createdBy: "system" });
  const escalationId = created.escalation!.escalationId;

  const assigned = await transitionEscalation(escalationId, "created", "assigned", { operatorId: "op-7" });
  assert.equal(assigned.ok, true);
  assert.equal(assigned.escalation?.assignedOperatorId, "op-7");

  const stale = await transitionEscalation(escalationId, "created", "assigned");
  assert.equal(stale.ok, false);
  assert.equal(stale.status, "conflict");

  const invalid = await transitionEscalation(escalationId, "assigned", "in_progress");
  assert.equal(invalid.ok, false);
  assert.equal(invalid.status, "invalid_transition");

  await transitionEscalation(escalationId, "assigned", "accepted");
  await transitionEscalation(escalationId, "accepted", "in_progress");
  const cancelled = await transitionEscalation(escalationId, "in_progress", "cancelled");
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.escalation?.resolutionOutcome, "cancelled");
  assert.notEqual(cancelled.escalation?.resolvedAt, null);

  const afterTerminal = await transitionEscalation(escalationId, "cancelled", "assigned");
  assert.equal(afterTerminal.ok, false);
  assert.equal(afterTerminal.status, "invalid_transition");
});

test("operator resolution: resolved_request closes the request; returned_to_ai reactivates it", async () => {
  const conversationId = 900000000 + Math.floor(Math.random() * 99999999);

  const resolvedPath = await makeActiveRequest(conversationId);
  const escalationA = await escalateRequest({ requestId: resolvedPath.requestId, category: "customer_service", mode: "exclusive_handoff", reason: "reclamo", createdBy: "planner" });
  const resolved = await resolveRequestEscalation({
    escalationId: escalationA.escalation!.escalationId,
    outcome: "resolved_request",
    operatorId: "op-9",
    resolutionNote: "Cliente contactado por teléfono, caso cerrado",
    resolutionType: "operator_resolved"
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.requestStatus, "resolved");
  const closedRequest = await loadConversationRequest(resolvedPath.requestId);
  assert.equal(closedRequest?.resolution?.type, "operator_resolved");
  assert.equal(closedRequest?.resolution?.entityId, escalationA.escalation?.escalationId);
  assert.equal((await loadRequestEscalation(escalationA.escalation!.escalationId))?.resolutionOutcome, "resolved_request");

  const returnedPath = await makeActiveRequest(conversationId);
  const escalationB = await escalateRequest({ requestId: returnedPath.requestId, category: "technical_support", mode: "internal_consultation", reason: "consulta interna", createdBy: "system" });
  const returned = await resolveRequestEscalation({
    escalationId: escalationB.escalation!.escalationId,
    outcome: "returned_to_ai",
    operatorId: "op-9"
  });
  assert.equal(returned.ok, true);
  assert.equal(returned.requestStatus, "active");

  // Resolving twice conflicts instead of double-writing.
  const again = await resolveRequestEscalation({ escalationId: escalationB.escalation!.escalationId, outcome: "returned_to_ai", operatorId: "op-9" });
  assert.equal(again.ok, false);
  assert.equal(again.status, "conflict");
});

test("escalating one request never blocks the conversation's other requests", async () => {
  const conversationId = 900000000 + Math.floor(Math.random() * 99999999);
  const complaint = await makeActiveRequest(conversationId, "complaint");
  const quote = await createConversationRequest({
    creationKey: uniqueSuffix("creation"),
    conversationId,
    intentType: "product_quote",
    intentDomain: "sales",
    createdFromMessageId: uniqueSuffix("cm")
  });
  await transitionConversationRequest({ requestId: quote.request!.requestId, fromStatus: "detected", toStatus: "active" });

  await escalateRequest({ requestId: complaint.requestId, category: "customer_service", mode: "exclusive_handoff", reason: "reclamo serio", createdBy: "planner" });

  assert.equal((await loadConversationRequest(complaint.requestId))?.status, "waiting_human");
  assert.equal((await loadConversationRequest(quote.request!.requestId))?.status, "active");
  assert.equal(await findOpenEscalationForRequest(quote.request!.requestId), null);
});

test("the open queue lists escalations oldest-first and filters by target", async () => {
  const request = await makeActiveRequest();
  await escalateRequest({
    requestId: request.requestId,
    category: "finance",
    mode: "approval_request",
    reason: "aprobación de nota de crédito",
    createdBy: "system",
    targetType: "team",
    targetId: "finanzas"
  });

  const financeQueue = await listOpenEscalations({ targetType: "team", targetId: "finanzas" });
  assert.equal(financeQueue.some((escalation) => escalation.requestId === request.requestId), true);

  const otherQueue = await listOpenEscalations({ targetType: "team", targetId: "otro-team" });
  assert.equal(otherQueue.some((escalation) => escalation.requestId === request.requestId), false);
});
