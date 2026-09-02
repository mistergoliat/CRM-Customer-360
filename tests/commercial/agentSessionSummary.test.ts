import assert from "node:assert/strict";
import test from "node:test";
import { projectAgentSessionSummary } from "@/lib/brain/commercial/agent-session/summary";
import type { AgentSessionEvent } from "@/lib/brain/commercial/agent-session/types";

// SALES-AGENT-R3-A01. Pure tests, no DB - proves the summary projection is
// deterministic (event log -> summary) and handles malformed/non-applicable
// events safely (task scenarios 11, 12, 23).

let nextTestSeq = 1;

function event(partial: Partial<AgentSessionEvent> & Pick<AgentSessionEvent, "eventType" | "occurredAt">): AgentSessionEvent {
  return {
    contractName: "AgentSession",
    schemaVersion: "1.0",
    eventId: `agev_${Math.random().toString(16).slice(2)}`,
    sessionId: "agsess_test",
    conversationId: 1,
    correlationId: "corr_test",
    causationId: null,
    dedupeKey: `dedupe_${Math.random()}`,
    payload: {},
    createdAt: partial.occurredAt,
    seq: nextTestSeq++,
    ...partial
  };
}

test("summary generation reflects tool activity and last commercial outcome", () => {
  const events: AgentSessionEvent[] = [
    event({ eventType: "USER_MESSAGE_RECEIVED", occurredAt: "2026-08-30T10:00:00.000Z" }),
    event({ eventType: "READ_TOOL_REQUESTED", occurredAt: "2026-08-30T10:00:01.000Z", payload: { tool: "search_products" } }),
    event({ eventType: "READ_TOOL_COMPLETED", occurredAt: "2026-08-30T10:00:02.000Z", payload: { tool: "search_products" } }),
    event({ eventType: "COMMERCIAL_ACTION_REQUESTED", occurredAt: "2026-08-30T10:00:03.000Z", payload: { tool: "select_products" } }),
    event({ eventType: "COMMERCIAL_ACTION_COMPLETED", occurredAt: "2026-08-30T10:00:04.000Z", payload: { tool: "select_products" } }),
    event({ eventType: "ASSISTANT_MESSAGE_SENT", occurredAt: "2026-08-30T10:00:05.000Z" })
  ];

  const summary = projectAgentSessionSummary("agsess_test", 1, events);

  assert.equal(summary.eventCount, 6);
  assert.equal(summary.lastUserMessageAt, "2026-08-30T10:00:00.000Z");
  assert.equal(summary.lastAssistantMessageAt, "2026-08-30T10:00:05.000Z");
  assert.equal(summary.pendingCommercialAction, null); // resolved by the COMPLETED event.
  assert.deepEqual(summary.lastCommercialOutcome, { tool: "select_products", outcome: "completed", occurredAt: "2026-08-30T10:00:04.000Z" });
  assert.equal(summary.recentToolActivity.length, 4);
  assert.equal(summary.currentGoals.length, 0); // reserved for a future Harness, never populated by A01.
});

test("a requested-but-not-yet-resolved commercial action stays pending", () => {
  const events: AgentSessionEvent[] = [
    event({ eventType: "COMMERCIAL_ACTION_REQUESTED", occurredAt: "2026-08-30T10:00:00.000Z", payload: { tool: "create_quote" } })
  ];
  const summary = projectAgentSessionSummary("agsess_test", 1, events);
  assert.deepEqual(summary.pendingCommercialAction, { tool: "create_quote", requestedAt: "2026-08-30T10:00:00.000Z" });
  assert.equal(summary.lastCommercialOutcome, null);
});

test("projection is deterministic - same event log always produces the same summary", () => {
  const events: AgentSessionEvent[] = [
    event({ eventType: "USER_MESSAGE_RECEIVED", occurredAt: "2026-08-30T10:00:00.000Z" }),
    event({ eventType: "READ_TOOL_REQUESTED", occurredAt: "2026-08-30T10:00:01.000Z", payload: { tool: "explore_catalog" } }),
    event({ eventType: "READ_TOOL_FAILED", occurredAt: "2026-08-30T10:00:02.000Z", payload: { tool: "explore_catalog" } })
  ];

  const first = projectAgentSessionSummary("agsess_test", 1, events);
  const second = projectAgentSessionSummary("agsess_test", 1, events);

  const { lastUpdatedAt: _a, ...firstStable } = first;
  const { lastUpdatedAt: _b, ...secondStable } = second;
  assert.deepEqual(firstStable, secondStable);
});

test("an unrecognized/non-applicable event type is skipped, never thrown", () => {
  const events: AgentSessionEvent[] = [
    event({ eventType: "USER_MESSAGE_RECEIVED", occurredAt: "2026-08-30T10:00:00.000Z" }),
    // SESSION_SUMMARY_UPDATED is a real taxonomy entry the projector must
    // never feed back into itself (would be a self-referential loop).
    event({ eventType: "SESSION_SUMMARY_UPDATED", occurredAt: "2026-08-30T10:00:01.000Z", payload: { version: 3 } }),
    // GOAL_UPDATED/FOLLOWUP_* exist in the taxonomy but are not projected
    // into any summary field yet (A01 scope) - must not throw.
    event({ eventType: "GOAL_UPDATED", occurredAt: "2026-08-30T10:00:02.000Z", payload: { goal: "buy a barbell" } }),
    event({ eventType: "FOLLOWUP_SCHEDULED", occurredAt: "2026-08-30T10:00:03.000Z" })
  ];

  assert.doesNotThrow(() => projectAgentSessionSummary("agsess_test", 1, events));
  const summary = projectAgentSessionSummary("agsess_test", 1, events);
  assert.equal(summary.eventCount, 4);
  assert.equal(summary.recentToolActivity.length, 0);
});

test("recentToolActivity is bounded, never grows unbounded", () => {
  const events: AgentSessionEvent[] = Array.from({ length: 25 }, (_, index) =>
    event({
      eventType: "READ_TOOL_COMPLETED",
      occurredAt: `2026-08-30T10:${String(index).padStart(2, "0")}:00.000Z`,
      payload: { tool: "search_products" }
    })
  );
  const summary = projectAgentSessionSummary("agsess_test", 1, events);
  assert.equal(summary.recentToolActivity.length, 10); // SUMMARY_MAX_RECENT_TOOL_ACTIVITY.
  assert.equal(summary.eventCount, 25); // eventCount reflects the full log, only the activity list is bounded.
});
