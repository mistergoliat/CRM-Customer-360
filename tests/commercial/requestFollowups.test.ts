import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool } from "@/lib/db";
import {
  listPendingFollowupsForRequest,
  runRequestFollowupTick,
  scheduleFollowupFromDefinition,
  scheduleRequestFollowup
} from "@/lib/brain/commercial/multi-request";
import {
  createConversationRequest,
  linkMessageToRequest,
  listRequestEvents,
  transitionConversationRequest,
  loadConversationRequest
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

const PAST = new Date(Date.now() - 60_000).toISOString();
const FUTURE = new Date(Date.now() + 3_600_000).toISOString();

async function makeActiveRequest(intentType = "product_quote") {
  const created = await createConversationRequest({
    creationKey: uniqueSuffix("creation"),
    conversationId: 900000000 + Math.floor(Math.random() * 99999999),
    intentType,
    intentDomain: "sales",
    createdFromMessageId: uniqueSuffix("cm")
  });
  assert.equal(created.ok, true, created.ok ? "" : created.warning);
  await transitionConversationRequest({ requestId: created.request!.requestId, fromStatus: "detected", toStatus: "active" });
  return created.request!;
}

test("a request holds one pending follow-up; scheduling again reuses it", async () => {
  const request = await makeActiveRequest();

  const first = await scheduleRequestFollowup({ requestId: request.requestId, purpose: "quote_follow_up", scheduledFor: FUTURE });
  assert.equal(first.ok, true);
  assert.equal(first.status, "created");

  const second = await scheduleRequestFollowup({ requestId: request.requestId, purpose: "otro", scheduledFor: FUTURE });
  assert.equal(second.status, "duplicate");
  assert.equal(second.followup?.actionId, first.followup?.actionId);
  assert.equal((await listPendingFollowupsForRequest(request.requestId)).length, 1);
});

test("scheduleFollowupFromDefinition follows the declared policy and skips types without one", async () => {
  const quote = await makeActiveRequest("product_quote");
  const scheduled = await scheduleFollowupFromDefinition((await loadConversationRequest(quote.requestId))!, { now: new Date("2026-07-04T12:00:00.000Z") });
  assert.notEqual(scheduled, null);
  assert.equal(scheduled!.ok, true);
  assert.equal(scheduled!.followup?.purpose, "quote_follow_up");
  // 24h policy: lands on 2026-07-05 12:00 UTC.
  assert.equal(scheduled!.followup?.scheduledFor?.startsWith("2026-07-05"), true);

  const complaint = await makeActiveRequest("complaint");
  const none = await scheduleFollowupFromDefinition((await loadConversationRequest(complaint.requestId))!);
  assert.equal(none, null);
});

test("the tick executes due follow-ups exactly once and leaves the trail event", async () => {
  const request = await makeActiveRequest();
  await scheduleRequestFollowup({ requestId: request.requestId, purpose: "quote_follow_up", scheduledFor: PAST });

  const tick = await runRequestFollowupTick();
  const mine = tick.executed.find((followup) => followup.requestId === request.requestId);
  assert.notEqual(mine, undefined);

  const events = await listRequestEvents(request.requestId);
  assert.equal(events.filter((event) => event.eventType === "action_executed").length, 1);

  // Second tick: nothing pending for this request anymore.
  const again = await runRequestFollowupTick();
  assert.equal(again.executed.some((followup) => followup.requestId === request.requestId), false);
  assert.equal((await listPendingFollowupsForRequest(request.requestId)).length, 0);
});

test("a resolved request cancels its follow-up at the tick instead of contacting the customer", async () => {
  const request = await makeActiveRequest();
  await scheduleRequestFollowup({ requestId: request.requestId, purpose: "quote_follow_up", scheduledFor: PAST });
  await transitionConversationRequest({ requestId: request.requestId, fromStatus: "active", toStatus: "resolved", resolution: { type: "quote_sent", entityType: null, entityId: null } });

  const tick = await runRequestFollowupTick();
  const cancelled = tick.cancelled.find((entry) => entry.followup.requestId === request.requestId);
  assert.equal(cancelled?.reason, "request_resolved");
  assert.equal(tick.executed.some((followup) => followup.requestId === request.requestId), false);
});

test("a customer reply to the request after scheduling cancels the follow-up", async () => {
  const request = await makeActiveRequest();
  await scheduleRequestFollowup({ requestId: request.requestId, purpose: "quote_follow_up", scheduledFor: PAST });

  await linkMessageToRequest({ requestId: request.requestId, messageId: uniqueSuffix("cm"), relationType: "continued", linkedBy: "planner" });

  const tick = await runRequestFollowupTick();
  const cancelled = tick.cancelled.find((entry) => entry.followup.requestId === request.requestId);
  assert.equal(cancelled?.reason, "customer_replied");
});

test("waiting_human cancels; future follow-ups stay untouched", async () => {
  const humanOwned = await makeActiveRequest();
  await scheduleRequestFollowup({ requestId: humanOwned.requestId, purpose: "quote_follow_up", scheduledFor: PAST });
  await transitionConversationRequest({ requestId: humanOwned.requestId, fromStatus: "active", toStatus: "waiting_human" });

  const future = await makeActiveRequest();
  await scheduleRequestFollowup({ requestId: future.requestId, purpose: "quote_follow_up", scheduledFor: FUTURE });

  const tick = await runRequestFollowupTick();
  assert.equal(tick.cancelled.find((entry) => entry.followup.requestId === humanOwned.requestId)?.reason, "human_owns_request");
  assert.equal(tick.executed.some((followup) => followup.requestId === future.requestId), false);
  assert.equal((await listPendingFollowupsForRequest(future.requestId)).length, 1);
});
