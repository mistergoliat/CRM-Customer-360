// SALES-AGENT-R3-A01. Pure, deterministic projection: event log -> bounded
// AgentSessionSummary. No I/O. The persisted summary (agent_sessions.summary_json)
// is a materialized optimization of exactly this function's output - never a
// second source of truth, always reconstructible by re-running it over the
// event log (Phase 8 of the task brief).

import {
  AGENT_SESSION_CONTRACT_NAME,
  AGENT_SESSION_SCHEMA_VERSION,
  type AgentSessionEvent,
  type AgentSessionLastCommercialOutcome,
  type AgentSessionSummary,
  type AgentSessionToolActivity
} from "./types";

/** Bounded per Phase 9 of the task brief - the summary itself stays small regardless of how many events feed it. */
export const SUMMARY_MAX_RECENT_TOOL_ACTIVITY = 10;

const READ_TOOL_EVENT_TYPES = new Set(["READ_TOOL_REQUESTED", "READ_TOOL_COMPLETED", "READ_TOOL_FAILED"]);
const COMMERCIAL_ACTION_EVENT_TYPES = new Set([
  "COMMERCIAL_ACTION_REQUESTED",
  "COMMERCIAL_ACTION_ACCEPTED",
  "COMMERCIAL_ACTION_REJECTED",
  "COMMERCIAL_ACTION_COMPLETED",
  "COMMERCIAL_ACTION_FAILED"
]);

function toolActivityOutcome(eventType: string): AgentSessionToolActivity["outcome"] | null {
  if (eventType.endsWith("_REQUESTED")) return "requested";
  if (eventType.endsWith("_COMPLETED") || eventType.endsWith("_ACCEPTED")) return "completed";
  if (eventType.endsWith("_FAILED")) return "failed";
  if (eventType.endsWith("_REJECTED")) return "rejected";
  return null;
}

function readToolName(event: AgentSessionEvent): string {
  const tool = event.payload.tool;
  return typeof tool === "string" && tool.trim() ? tool.trim() : "unknown";
}

/**
 * Events are consumed in ascending occurredAt/eventId order (the caller's
 * responsibility - loadRecentEvents already returns them that way) so
 * "recent"/"last" reflect real chronology, not insertion order alone.
 * SESSION_SUMMARY_UPDATED and any unrecognized event type are safely
 * skipped - never thrown, never corrupt the running projection (Phase 8:
 * "malformed/non-applicable event -> safe handling").
 */
export function projectAgentSessionSummary(
  sessionId: string,
  conversationId: number,
  events: readonly AgentSessionEvent[]
): AgentSessionSummary {
  const recentToolActivity: AgentSessionToolActivity[] = [];
  let pendingCommercialAction: { tool: string; requestedAt: string } | null = null;
  let lastCommercialOutcome: AgentSessionLastCommercialOutcome = null;
  let lastUserMessageAt: string | null = null;
  let lastAssistantMessageAt: string | null = null;
  let lastEventAt: string | null = null;

  for (const event of events) {
    lastEventAt = event.occurredAt;

    if (event.eventType === "USER_MESSAGE_RECEIVED") {
      lastUserMessageAt = event.occurredAt;
      continue;
    }
    if (event.eventType === "ASSISTANT_MESSAGE_SENT") {
      lastAssistantMessageAt = event.occurredAt;
      continue;
    }

    const isReadTool = READ_TOOL_EVENT_TYPES.has(event.eventType);
    const isCommercialAction = COMMERCIAL_ACTION_EVENT_TYPES.has(event.eventType);
    if (!isReadTool && !isCommercialAction) continue; // GOAL_UPDATED, FOLLOWUP_*, SESSION_SUMMARY_UPDATED, unknown types: no-op by design.

    const outcome = toolActivityOutcome(event.eventType);
    if (!outcome) continue;

    const tool = readToolName(event);
    recentToolActivity.push({ tool, kind: isReadTool ? "read" : "action", outcome, occurredAt: event.occurredAt });
    if (recentToolActivity.length > SUMMARY_MAX_RECENT_TOOL_ACTIVITY) recentToolActivity.shift();

    if (isCommercialAction) {
      if (outcome === "requested") {
        pendingCommercialAction = { tool, requestedAt: event.occurredAt };
      } else if (outcome === "completed" || outcome === "failed") {
        pendingCommercialAction = null;
        lastCommercialOutcome = { tool, outcome, occurredAt: event.occurredAt };
      } else if (outcome === "rejected") {
        pendingCommercialAction = null;
      }
    }
  }

  return {
    contractName: AGENT_SESSION_CONTRACT_NAME,
    schemaVersion: AGENT_SESSION_SCHEMA_VERSION,
    sessionId,
    conversationId,
    currentGoals: [],
    recentToolActivity,
    pendingCommercialAction,
    lastCommercialOutcome,
    lastUserMessageAt,
    lastAssistantMessageAt,
    eventCount: events.length,
    lastEventAt,
    version: null,
    lastUpdatedAt: new Date().toISOString()
  };
}
