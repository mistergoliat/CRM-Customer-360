import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, safeQueryRows } from "@/lib/db";
import {
  appendRequestEvent,
  createConversationRequest,
  linkMessageToRequest,
  listActiveConversationRequests,
  listRequestEvents,
  listRequestMessageLinks,
  loadConversationRequest,
  transitionConversationRequest,
  REQUEST_LIFECYCLE_ALLOWED_TRANSITIONS,
  CONVERSATION_REQUEST_TABLE
} from "@/lib/brain/commercial/conversation-request";
import type { CreateConversationRequestInput } from "@/lib/brain/commercial/conversation-request";

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

// Synthetic conversation id per run: crm_conversation_requests holds no FK to
// conversation, so isolated runs never collide nor need teardown.
function uniqueConversationId() {
  return 900000000 + Math.floor(Math.random() * 99999999);
}

function makeCreateInput(overrides: Partial<CreateConversationRequestInput> = {}): CreateConversationRequestInput {
  return {
    creationKey: uniqueSuffix("creation"),
    conversationId: uniqueConversationId(),
    intentType: "product_quote",
    intentDomain: "sales",
    createdFromMessageId: uniqueSuffix("msg"),
    ...overrides
  };
}

async function countRows(sql: string, params: Array<string | number>) {
  const result = await safeQueryRows<{ total: number }>(sql, params);
  assert.ok(result.ok, result.ok ? "" : result.error);
  return Number(result.rows[0]?.total ?? 0);
}

test("createConversationRequest persists once and is idempotent by creation_key", async () => {
  const input = makeCreateInput();

  const first = await createConversationRequest(input);
  assert.equal(first.ok, true);
  assert.equal(first.status, "created");
  assert.equal(first.request?.contractName, "ConversationRequest");
  assert.equal(first.request?.status, "detected");
  assert.equal(first.request?.intentType, "product_quote");
  assert.equal(first.request?.opportunityId, null);
  assert.equal(first.request?.resolution, null);

  const second = await createConversationRequest(input);
  assert.equal(second.ok, true);
  assert.equal(second.status, "duplicate");
  assert.equal(second.request?.requestId, first.request?.requestId);

  const total = await countRows(
    `SELECT COUNT(*) AS total FROM ${CONVERSATION_REQUEST_TABLE} WHERE creation_key = ?`,
    [input.creationKey]
  );
  assert.equal(total, 1);
});

test("a conversation holds three active requests, two of the same intent type, without overwriting", async () => {
  const conversationId = uniqueConversationId();

  const quoteA = await createConversationRequest(makeCreateInput({ conversationId, intentType: "product_quote" }));
  const quoteB = await createConversationRequest(makeCreateInput({ conversationId, intentType: "product_quote" }));
  const orderStatus = await createConversationRequest(
    makeCreateInput({ conversationId, intentType: "order_status", intentDomain: "order" })
  );

  assert.equal(quoteA.status, "created");
  assert.equal(quoteB.status, "created");
  assert.equal(orderStatus.status, "created");

  const active = await listActiveConversationRequests(conversationId);
  assert.equal(active.length, 3);
  const ids = new Set(active.map((request) => request.requestId));
  assert.equal(ids.size, 3);
  assert.equal(active.filter((request) => request.intentType === "product_quote").length, 2);
  assert.equal(active.filter((request) => request.intentType === "order_status").length, 1);
});

test("lifecycle transitions apply by compare-and-swap and reject invalid or stale moves", async () => {
  const created = await createConversationRequest(makeCreateInput());
  assert.equal(created.ok, true);
  const requestId = created.request!.requestId;

  // detected -> resolved is not in the allowed table: rejected before touching SQL.
  const invalid = await transitionConversationRequest({ requestId, fromStatus: "detected", toStatus: "resolved" });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.status, "invalid_transition");

  const activated = await transitionConversationRequest({ requestId, fromStatus: "detected", toStatus: "active" });
  assert.equal(activated.ok, true);
  assert.equal(activated.request?.status, "active");

  // Stale CAS: the row is no longer 'detected', so this must be a conflict, never success.
  const stale = await transitionConversationRequest({ requestId, fromStatus: "detected", toStatus: "active" });
  assert.equal(stale.ok, false);
  assert.equal(stale.status, "conflict");
  assert.equal(stale.request?.status, "active");

  const resolved = await transitionConversationRequest({
    requestId,
    fromStatus: "active",
    toStatus: "resolved",
    resolution: { type: "quote_sent", entityType: "quote", entityId: "quote-123" }
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.request?.status, "resolved");
  assert.notEqual(resolved.request?.resolvedAt, null);
  assert.equal(resolved.request?.resolution?.type, "quote_sent");
  assert.equal(resolved.request?.resolution?.entityId, "quote-123");

  // Reopen clears the row-level resolution; history lives in crm_request_events.
  const reopened = await transitionConversationRequest({ requestId, fromStatus: "resolved", toStatus: "active" });
  assert.equal(reopened.ok, true);
  assert.equal(reopened.request?.status, "active");
  assert.equal(reopened.request?.resolvedAt, null);
  assert.equal(reopened.request?.resolution, null);

  const cancelled = await transitionConversationRequest({ requestId, fromStatus: "active", toStatus: "cancelled" });
  assert.equal(cancelled.ok, true);

  // cancelled is fully terminal.
  assert.deepEqual(REQUEST_LIFECYCLE_ALLOWED_TRANSITIONS.cancelled, []);
  const afterCancel = await transitionConversationRequest({ requestId, fromStatus: "cancelled", toStatus: "active" });
  assert.equal(afterCancel.ok, false);
  assert.equal(afterCancel.status, "invalid_transition");

  const finalRow = await loadConversationRequest(requestId);
  assert.equal(finalRow?.status, "cancelled");
});

test("resolved requests leave the active list; reopening brings them back", async () => {
  const conversationId = uniqueConversationId();
  const created = await createConversationRequest(makeCreateInput({ conversationId }));
  const requestId = created.request!.requestId;

  await transitionConversationRequest({ requestId, fromStatus: "detected", toStatus: "active" });
  await transitionConversationRequest({ requestId, fromStatus: "active", toStatus: "resolved" });
  assert.equal((await listActiveConversationRequests(conversationId)).length, 0);

  await transitionConversationRequest({ requestId, fromStatus: "resolved", toStatus: "active" });
  assert.equal((await listActiveConversationRequests(conversationId)).length, 1);
});

test("appendRequestEvent is append-only and idempotent by dedupe_key", async () => {
  const created = await createConversationRequest(makeCreateInput());
  const requestId = created.request!.requestId;
  const dedupeKey = `request:${requestId}:turn:${uniqueSuffix("turn")}:request_created`;
  const occurredAt = new Date().toISOString();

  const first = await appendRequestEvent({
    dedupeKey,
    requestId,
    eventType: "request_created",
    sourceType: "planner",
    sourceId: "turn-plan-001",
    payload: { intentType: "product_quote" },
    occurredAt
  });
  assert.equal(first.ok, true);
  assert.equal(first.status, "created");
  assert.equal(first.event?.requestEventId.startsWith("revt-"), true);

  const second = await appendRequestEvent({
    dedupeKey,
    requestId,
    eventType: "request_created",
    sourceType: "planner",
    sourceId: "turn-plan-001",
    payload: { intentType: "product_quote" },
    occurredAt: new Date(Date.now() + 5000).toISOString()
  });
  assert.equal(second.ok, true);
  assert.equal(second.status, "duplicate");
  // Deterministic identity: the retry resolves to the exact same event row.
  assert.equal(second.event?.requestEventId, first.event?.requestEventId);
  assert.equal(second.event?.occurredAt, first.event?.occurredAt);

  const events = await listRequestEvents(requestId);
  assert.equal(events.length, 1);
});

test("linkMessageToRequest dedupes by triple and supports many-to-many relations", async () => {
  const created = await createConversationRequest(makeCreateInput());
  const requestId = created.request!.requestId;
  const messageId = uniqueSuffix("cm");

  const first = await linkMessageToRequest({ requestId, messageId, relationType: "continued", linkedBy: "deterministic" });
  assert.equal(first.ok, true);
  assert.equal(first.status, "created");

  const duplicate = await linkMessageToRequest({ requestId, messageId, relationType: "continued", linkedBy: "planner", confidence: 0.9 });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.status, "duplicate");
  // The original row wins; the duplicate call does not mutate it.
  assert.equal(duplicate.link?.linkedBy, "deterministic");

  const secondRelation = await linkMessageToRequest({ requestId, messageId, relationType: "confirmed", linkedBy: "planner", confidence: 0.75 });
  assert.equal(secondRelation.ok, true);
  assert.equal(secondRelation.status, "created");
  assert.equal(secondRelation.link?.confidence, 0.75);

  const links = await listRequestMessageLinks(requestId);
  assert.equal(links.length, 2);
});
