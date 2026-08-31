// SALES-AGENT-R3-A01. AgentSessionStore's own domain types.
//
// Boundary (see docs/architecture/SALES-AGENT-R3-A00-target-architecture.md
// Phase 2.B and docs/releases/SALES-AGENT-R3-A01-agent-session-store.md):
// this module is conversational memory only. It never becomes a second
// source of truth for identity, customer profile, selected products,
// shipping, quote, order or follow-up schedule - those stay owned by their
// existing domain stores (crm_request_facts, crm_quotes, crm_agent_actions,
// master_customer, ...). A session may record that something was discussed
// or that an action occurred; it never records the current authoritative
// value.

export const AGENT_SESSION_CONTRACT_NAME = "AgentSession" as const;
export const AGENT_SESSION_SCHEMA_VERSION = "1.0" as const;

export type AgentSessionStatus = "active" | "closed";

export type AgentSession = {
  contractName: typeof AGENT_SESSION_CONTRACT_NAME;
  schemaVersion: typeof AGENT_SESSION_SCHEMA_VERSION;
  id: string;
  conversationId: number;
  status: AgentSessionStatus;
  createdAt: string;
  updatedAt: string;
};

// Candidate taxonomy from the R3-A01 task brief, pruned to avoid an
// excessively granular event model (Phase 4 instruction). Every type below
// is a real, reusable vocabulary entry; not every one is emitted yet by the
// A01 shadow integration (see the release doc's "Event taxonomy" section for
// exactly which ones are live today vs. reserved for a future Harness/
// CommercialActionRequest boundary).
export const AGENT_SESSION_EVENT_TYPES = [
  "USER_MESSAGE_RECEIVED",
  "ASSISTANT_MESSAGE_SENT",
  "READ_TOOL_REQUESTED",
  "READ_TOOL_COMPLETED",
  "READ_TOOL_FAILED",
  "COMMERCIAL_ACTION_REQUESTED",
  "COMMERCIAL_ACTION_ACCEPTED",
  "COMMERCIAL_ACTION_REJECTED",
  "COMMERCIAL_ACTION_COMPLETED",
  "COMMERCIAL_ACTION_FAILED",
  "GOAL_UPDATED",
  "FOLLOWUP_SCHEDULED",
  "FOLLOWUP_CANCELLED",
  "FOLLOWUP_WAKE",
  "SESSION_SUMMARY_UPDATED"
] as const;
export type AgentSessionEventType = (typeof AGENT_SESSION_EVENT_TYPES)[number];

export type AgentSessionEvent = {
  contractName: typeof AGENT_SESSION_CONTRACT_NAME;
  schemaVersion: typeof AGENT_SESSION_SCHEMA_VERSION;
  eventId: string;
  sessionId: string;
  conversationId: number;
  eventType: AgentSessionEventType;
  correlationId: string;
  causationId: string | null;
  dedupeKey: string;
  /** Already sanitized via sanitizeAgentSessionPayload - see sanitizer.ts. */
  payload: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
};

export type AgentSessionEventPersistStatus = "created" | "duplicate";

export type AppendEventResult =
  | { ok: true; status: "created"; event: AgentSessionEvent }
  | { ok: true; status: "duplicate"; event: AgentSessionEvent }
  | { ok: false; status: "error"; event: null; warning: string };

// Bounded, reconstructible projection over the event log - conversational
// state only, never current business truth (Phase 7 of the task brief).
// currentGoals/pendingCommercialAction stay empty until a real
// CommercialActionRequest/Harness goal-tracking boundary exists (R3-A03+);
// A01's shadow recorder only ever populates recentToolActivity and the last
// commercial outcome, honestly, from what it can observe today.
export type AgentSessionToolActivityKind = "read" | "action";

export type AgentSessionToolActivity = {
  tool: string;
  kind: AgentSessionToolActivityKind;
  outcome: "requested" | "completed" | "failed" | "rejected";
  occurredAt: string;
};

export type AgentSessionLastCommercialOutcome = {
  tool: string;
  outcome: "completed" | "failed";
  occurredAt: string;
} | null;

export type AgentSessionSummary = {
  contractName: typeof AGENT_SESSION_CONTRACT_NAME;
  schemaVersion: typeof AGENT_SESSION_SCHEMA_VERSION;
  sessionId: string;
  conversationId: number;
  /** Reserved for a future Harness's own goal-tracking (GOAL_UPDATED) - always empty in A01. */
  currentGoals: string[];
  recentToolActivity: AgentSessionToolActivity[];
  pendingCommercialAction: { tool: string; requestedAt: string } | null;
  lastCommercialOutcome: AgentSessionLastCommercialOutcome;
  lastUserMessageAt: string | null;
  lastAssistantMessageAt: string | null;
  eventCount: number;
  lastEventAt: string | null;
  /** Present only when this summary was persisted (loadSummary); absent from a freshly rebuilt, not-yet-persisted projection. */
  version: number | null;
  lastUpdatedAt: string;
};

export type EnsureSessionInput = {
  conversationId: number;
};

export type AppendEventInput = {
  sessionId: string;
  conversationId: number;
  eventType: AgentSessionEventType;
  correlationId: string;
  causationId?: string | null;
  dedupeKey: string;
  payload: Record<string, unknown>;
  occurredAt?: string | null;
};

export type LoadRecentEventsInput = {
  sessionId: string;
  /** Default and hard cap - see BOUNDED_CONTEXT constants in store.ts. */
  maxEvents?: number;
  maxAgeMs?: number;
};
