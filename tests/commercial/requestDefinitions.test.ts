import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool } from "@/lib/db";
import {
  evaluateRequestReduction,
  applyRequestReduction,
  resolveRequestDefinition,
  REQUEST_DEFINITIONS
} from "@/lib/brain/commercial/request-definitions";
import {
  appendRequestEvent,
  createConversationRequest,
  loadConversationRequest,
  transitionConversationRequest
} from "@/lib/brain/commercial/conversation-request";
import type { ConversationRequest, RequestEvent } from "@/lib/brain/commercial/conversation-request";
import { upsertRequestFact } from "@/lib/brain/commercial/request-facts";
import type { RequestFact } from "@/lib/brain/commercial/request-facts";

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

function makeRequestFixture(overrides: Partial<ConversationRequest> = {}): ConversationRequest {
  return {
    contractName: "ConversationRequest",
    schemaVersion: "1.0.0",
    requestId: "req-1",
    creationKey: "key-1",
    conversationId: 1,
    opportunityId: null,
    intentType: "product_quote",
    intentDomain: "sales",
    status: "active",
    priority: "normal",
    parentRequestId: null,
    createdFromMessageId: "cm-1",
    resolution: null,
    createdAt: "2026-07-03T12:00:00.000Z",
    updatedAt: "2026-07-03T12:00:00.000Z",
    resolvedAt: null,
    ...overrides
  };
}

function makeEvent(eventType: RequestEvent["eventType"], overrides: Partial<RequestEvent> = {}): RequestEvent {
  return {
    requestEventId: uniqueSuffix("revt"),
    dedupeKey: uniqueSuffix("dedupe"),
    requestId: "req-1",
    eventType,
    sourceType: "system",
    sourceId: null,
    payload: null,
    occurredAt: "2026-07-03T12:00:00.000Z",
    createdAt: "2026-07-03T12:00:00.000Z",
    ...overrides
  };
}

function makeFact(factKey: string): RequestFact {
  return {
    factId: uniqueSuffix("fact"),
    requestId: "req-1",
    factKey,
    value: "x",
    status: "confirmed",
    sourceMessageId: null,
    sourceToolExecutionId: null,
    confidence: null,
    createdAt: "2026-07-03T12:00:00.000Z",
    updatedAt: "2026-07-03T12:00:00.000Z",
    supersededAt: null
  };
}

test("all nine initial request types have definitions; unknown intents fall back to general_question", () => {
  const expected = [
    "product_information",
    "product_quote",
    "maintenance_information",
    "maintenance_quote",
    "order_status",
    "warranty",
    "complaint",
    "human_assistance",
    "general_question"
  ];
  assert.deepEqual(REQUEST_DEFINITIONS.map((definition) => definition.intentType).sort(), [...expected].sort());
  assert.equal(resolveRequestDefinition("something_new").intentType, "general_question");
});

test("a qualifying event resolves the request; without it nothing does - the LLM has no say", () => {
  const withEvent = evaluateRequestReduction({
    request: makeRequestFixture(),
    events: [makeEvent("quote_sent")],
    activeFacts: [makeFact("products")]
  });
  assert.equal(withEvent.desiredStatus, "resolved");
  assert.equal(withEvent.resolutionType, "quote_sent");

  const withoutEvent = evaluateRequestReduction({
    request: makeRequestFixture(),
    events: [makeEvent("message_linked"), makeEvent("action_proposed")],
    activeFacts: [makeFact("products")]
  });
  assert.equal(withoutEvent.desiredStatus, null);
});

test("escalation beats resolution when both events exist", () => {
  const decision = evaluateRequestReduction({
    request: makeRequestFixture(),
    events: [makeEvent("quote_sent"), makeEvent("human_escalation_created")],
    activeFacts: [makeFact("products")]
  });
  assert.equal(decision.desiredStatus, "waiting_human");
});

test("missing required facts park an active request as waiting_customer, naming exactly what is missing", () => {
  const decision = evaluateRequestReduction({
    request: makeRequestFixture(),
    events: [],
    activeFacts: []
  });
  assert.equal(decision.desiredStatus, "waiting_customer");
  assert.deepEqual(decision.reasons, ["missing_required_fact:products"]);

  const complete = evaluateRequestReduction({
    request: makeRequestFixture(),
    events: [],
    activeFacts: [makeFact("products")]
  });
  assert.equal(complete.desiredStatus, null);
});

test("a complaint never auto-resolves: information_provided does nothing, only escalation moves it", () => {
  const request = makeRequestFixture({ intentType: "complaint", intentDomain: "support" });

  const info = evaluateRequestReduction({ request, events: [makeEvent("information_provided")], activeFacts: [] });
  assert.equal(info.desiredStatus, null);

  const escalated = evaluateRequestReduction({ request, events: [makeEvent("human_escalation_created")], activeFacts: [] });
  assert.equal(escalated.desiredStatus, "waiting_human");
});

test("terminal and already-waiting states are respected", () => {
  const resolved = evaluateRequestReduction({
    request: makeRequestFixture({ status: "resolved" }),
    events: [makeEvent("human_escalation_created")],
    activeFacts: []
  });
  assert.equal(resolved.desiredStatus, null);

  const alreadyHuman = evaluateRequestReduction({
    request: makeRequestFixture({ status: "waiting_human" }),
    events: [makeEvent("human_escalation_created")],
    activeFacts: []
  });
  assert.equal(alreadyHuman.desiredStatus, null);
});

test("applyRequestReduction resolves against the real DB from an observed event, idempotently", async () => {
  const created = await createConversationRequest({
    creationKey: uniqueSuffix("creation"),
    conversationId: 900000000 + Math.floor(Math.random() * 99999999),
    intentType: "order_status",
    intentDomain: "order",
    createdFromMessageId: uniqueSuffix("cm")
  });
  const requestId = created.request!.requestId;
  await transitionConversationRequest({ requestId, fromStatus: "detected", toStatus: "active" });
  await upsertRequestFact({ requestId, factKey: "order_identifier", value: "ORD-1001" });

  // No qualifying event yet: reduction does nothing.
  const before = await applyRequestReduction((await loadConversationRequest(requestId))!);
  assert.equal(before.applied, false);
  assert.equal((await loadConversationRequest(requestId))?.status, "active");

  await appendRequestEvent({
    dedupeKey: `request:${requestId}:tool:find-order-1:order_status_provided`,
    requestId,
    eventType: "order_status_provided",
    sourceType: "tool_execution",
    sourceId: "exec-1",
    payload: { status: "en reparto" },
    occurredAt: new Date().toISOString()
  });

  const after = await applyRequestReduction((await loadConversationRequest(requestId))!);
  assert.equal(after.applied, true);
  const resolved = await loadConversationRequest(requestId);
  assert.equal(resolved?.status, "resolved");
  assert.equal(resolved?.resolution?.type, "order_status_provided");

  // Re-running the reduction over a resolved request is a no-op, never an error.
  const again = await applyRequestReduction(resolved!);
  assert.equal(again.applied, false);
  assert.equal(again.warning, null);
});
