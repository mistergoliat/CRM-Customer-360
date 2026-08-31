import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryAgentSessionStore } from "@/lib/brain/commercial/agent-session/inMemoryAgentSessionStore";
import { recordAgentToolLoopSessionShadowEvents } from "@/lib/brain/commercial/agent-session/shadowRecorder";
import type { AgentToolLoopStepSummary } from "@/lib/brain/commercial/events/types";

// SALES-AGENT-R3-A01. Proves the shadow recorder's derivation logic - the
// glue between an already-completed Agent Tool Loop turn (AgentToolLoopStepSummary[],
// the exact shape runNativeAgentToolLoopCycle.ts already computes) and
// AgentSessionStore events. Uses the in-memory store so this is pure/fast,
// no DB - the store contract itself is tested separately in
// agentSessionStore.test.ts.

test("derives REQUESTED/COMPLETED events for a read-only tool call", async () => {
  const store = createInMemoryAgentSessionStore();
  const stepsSummary: AgentToolLoopStepSummary[] = [
    { stepIndex: 0, type: "use_tool", phase: "gathering", tool: "search_products", governance: "authorized", observationStatus: "completed" },
    { stepIndex: 1, type: "respond", phase: "finalization" }
  ];

  const result = await recordAgentToolLoopSessionShadowEvents({
    conversationId: 1,
    inboundMessageId: "msg_1",
    correlationId: "corr_1",
    terminalReason: "responded",
    finalMessagePresent: true,
    handoffReasonPresent: false,
    stepsSummary,
    store
  });
  assert.ok(result.ok);

  const session = await store.loadSessionForConversation(1);
  const events = await store.loadRecentEvents({ sessionId: session!.id });
  assert.deepEqual(events.map((event) => event.eventType), [
    "USER_MESSAGE_RECEIVED",
    "READ_TOOL_REQUESTED",
    "READ_TOOL_COMPLETED",
    "ASSISTANT_MESSAGE_SENT"
  ]);
});

test("classifies a mutating tool as a commercial action, not a read tool", async () => {
  const store = createInMemoryAgentSessionStore();
  const stepsSummary: AgentToolLoopStepSummary[] = [
    { stepIndex: 0, type: "use_tool", phase: "gathering", tool: "select_products", governance: "authorized", observationStatus: "completed" }
  ];

  await recordAgentToolLoopSessionShadowEvents({
    conversationId: 1, inboundMessageId: "msg_1", correlationId: "corr_1", terminalReason: "responded",
    finalMessagePresent: true, handoffReasonPresent: false, stepsSummary, store
  });

  const session = await store.loadSessionForConversation(1);
  const events = await store.loadRecentEvents({ sessionId: session!.id });
  const eventTypes = events.map((event) => event.eventType);
  assert.ok(eventTypes.includes("COMMERCIAL_ACTION_REQUESTED"));
  assert.ok(eventTypes.includes("COMMERCIAL_ACTION_COMPLETED"));
  assert.ok(!eventTypes.includes("READ_TOOL_REQUESTED"));
});

test("a failed capability call produces the FAILED terminal event, not COMPLETED", async () => {
  const store = createInMemoryAgentSessionStore();
  const stepsSummary: AgentToolLoopStepSummary[] = [
    { stepIndex: 0, type: "use_tool", phase: "gathering", tool: "create_quote", governance: "authorized", observationStatus: "failed" }
  ];

  await recordAgentToolLoopSessionShadowEvents({
    conversationId: 1, inboundMessageId: "msg_1", correlationId: "corr_1", terminalReason: "responded",
    finalMessagePresent: true, handoffReasonPresent: false, stepsSummary, store
  });

  const session = await store.loadSessionForConversation(1);
  const events = await store.loadRecentEvents({ sessionId: session!.id });
  assert.ok(events.some((event) => event.eventType === "COMMERCIAL_ACTION_FAILED"));
});

test("a governance-blocked tool call produces a rejected/failed terminal event, never COMPLETED", async () => {
  const store = createInMemoryAgentSessionStore();
  const stepsSummary: AgentToolLoopStepSummary[] = [
    { stepIndex: 0, type: "use_tool", phase: "gathering", tool: "select_shipping_option", governance: "blocked_duplicate" }
  ];

  await recordAgentToolLoopSessionShadowEvents({
    conversationId: 1, inboundMessageId: "msg_1", correlationId: "corr_1", terminalReason: "responded",
    finalMessagePresent: true, handoffReasonPresent: false, stepsSummary, store
  });

  const session = await store.loadSessionForConversation(1);
  const events = await store.loadRecentEvents({ sessionId: session!.id });
  assert.ok(events.some((event) => event.eventType === "COMMERCIAL_ACTION_REJECTED"));
  assert.ok(!events.some((event) => event.eventType === "COMMERCIAL_ACTION_COMPLETED"));
});

test("a skipped observation only emits the REQUESTED event, nothing terminal", async () => {
  const store = createInMemoryAgentSessionStore();
  const stepsSummary: AgentToolLoopStepSummary[] = [
    { stepIndex: 0, type: "use_tool", phase: "gathering", tool: "recommend_catalog_products", governance: "authorized", observationStatus: "skipped" }
  ];

  await recordAgentToolLoopSessionShadowEvents({
    conversationId: 1, inboundMessageId: "msg_1", correlationId: "corr_1", terminalReason: "responded",
    finalMessagePresent: true, handoffReasonPresent: false, stepsSummary, store
  });

  const session = await store.loadSessionForConversation(1);
  const events = await store.loadRecentEvents({ sessionId: session!.id });
  const toolEvents = events.filter((event) => event.eventType !== "USER_MESSAGE_RECEIVED" && event.eventType !== "ASSISTANT_MESSAGE_SENT");
  assert.equal(toolEvents.length, 1);
  assert.equal(toolEvents[0].eventType, "READ_TOOL_REQUESTED");
});

test("handoff turns still record a turn-conclusion event, distinguishable by payload outcome", async () => {
  const store = createInMemoryAgentSessionStore();
  await recordAgentToolLoopSessionShadowEvents({
    conversationId: 1, inboundMessageId: "msg_1", correlationId: "corr_1", terminalReason: "handoff",
    finalMessagePresent: false, handoffReasonPresent: true, stepsSummary: [], store
  });

  const session = await store.loadSessionForConversation(1);
  const events = await store.loadRecentEvents({ sessionId: session!.id });
  const assistantEvent = events.find((event) => event.eventType === "ASSISTANT_MESSAGE_SENT");
  assert.equal(assistantEvent?.payload.outcome, "handoff");
});

test("re-recording the exact same turn (retry) never duplicates events - idempotent shadow recording", async () => {
  const store = createInMemoryAgentSessionStore();
  const stepsSummary: AgentToolLoopStepSummary[] = [
    { stepIndex: 0, type: "use_tool", phase: "gathering", tool: "search_products", governance: "authorized", observationStatus: "completed" }
  ];
  const input = {
    conversationId: 1, inboundMessageId: "msg_1", correlationId: "corr_1", terminalReason: "responded" as const,
    finalMessagePresent: true, handoffReasonPresent: false, stepsSummary, store
  };

  await recordAgentToolLoopSessionShadowEvents(input);
  await recordAgentToolLoopSessionShadowEvents(input); // simulates a retried cycle for the same inbound.

  const session = await store.loadSessionForConversation(1);
  const events = await store.loadRecentEvents({ sessionId: session!.id });
  assert.equal(events.length, 4); // USER_MESSAGE_RECEIVED, READ_TOOL_REQUESTED, READ_TOOL_COMPLETED, ASSISTANT_MESSAGE_SENT - not 8.
});

test("never persists message text - only bounded, PII-free identifiers", async () => {
  const store = createInMemoryAgentSessionStore();
  await recordAgentToolLoopSessionShadowEvents({
    conversationId: 1, inboundMessageId: "msg_1", correlationId: "corr_1", terminalReason: "responded",
    finalMessagePresent: true, handoffReasonPresent: false, stepsSummary: [], store
  });
  const session = await store.loadSessionForConversation(1);
  const events = await store.loadRecentEvents({ sessionId: session!.id });
  for (const event of events) {
    assert.equal(JSON.stringify(event.payload).length < 200, true);
    assert.ok(!("text" in event.payload));
    assert.ok(!("body" in event.payload));
    assert.ok(!("customerMessage" in event.payload));
  }
});
