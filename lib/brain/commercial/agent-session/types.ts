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
  /**
   * SALES-AGENT-R3-V1.8-D1 (migration 034). Compaction cache columns -
   * additive, nullable, never interpreted or written by anything in this
   * task. Deliberately separate from summary_json/summary_version above:
   * those are AgentSessionSummary's own tool-activity/goal projection
   * (a distinct, already-scoped concept, see docs/releases/SALES-AGENT-R3-V1.8-C-
   * NATIVE-PERSISTENT-AGENT-SESSION-MEMORY-DESIGN.md section 14/15) - this
   * is the future compacted historical-message prefix, never merged with
   * the former. All three are null on every row until a future compaction
   * slice (D7) writes them.
   */
  compactedPrefixJson: Record<string, unknown> | null;
  compactedThroughSeq: number | null;
  compactedPrefixUpdatedAt: string | null;
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
  "SESSION_SUMMARY_UPDATED",
  /**
   * SALES-AGENT-R3-V1.8-D1. Reserved for a future compaction slice (D7) -
   * no caller emits this yet. V1.8-D0/V1.8-C deliberately do NOT add
   * TURN_STARTED/TURN_COMPLETED/SESSION_RESUMED here: USER_MESSAGE_RECEIVED
   * and ASSISTANT_MESSAGE_SENT already serve as turn-start/turn-complete
   * markers once their append point moves (a D2 concern, not this one), and
   * "resumed" is an observability metric only, never a durable event, since
   * every turn resumes by construction in this design (no in-process object
   * ever needs distinguishing a fresh session from a resumed one).
   */
  "SESSION_COMPACTED"
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
  /**
   * SALES-AGENT-R3-V1.8-D3. The real, monotonic `agent_session_events.seq`
   * (migration 033, BIGINT UNSIGNED AUTO_INCREMENT, UNIQUE KEY) - previously
   * used only inside ORDER BY clauses, never surfaced on this contract.
   * deriveMessages.ts needs it to exclude event ranges already covered by
   * AgentSession.compactedThroughSeq (migration 034) from the tool-activity
   * projection once a future D7 compaction actually populates that column.
   */
  seq: number;
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

// SALES-AGENT-R3-V1.8-D1. Structured payload contracts for two event types
// (AppendEventInput.payload stays Record<string, unknown> at the store
// interface - this task does not attempt a discriminated-union refactor of
// that contract). Nothing constructs or consumes these yet; they exist so
// D2+ has an approved shape to build against instead of a fresh guess.

/**
 * The mandatory minimum for a future compaction event (D7) - never a
 * concrete summary text field here (that lives in agent_sessions.compacted_prefix_json,
 * migration 034, a separate durable slot, not the event payload). D7
 * populates fromSeq/toSeq with conversation_message.id boundaries (the real
 * compaction unit - see compactedSessionPrefixContent.ts's own domain note),
 * superseding this comment's original agent_session_events.seq assumption -
 * that assumption predates D3, which confirmed conversation_message as the
 * sole canonical transcript. rawMessageCount/rawEstimatedSize/
 * compactionDurationMs (D7) are the observability metrics the task brief's
 * own Section V names - non-sensitive counts/sizes only, never message
 * bodies or summary text.
 */
export type AgentSessionCompactedPayload = {
  fromSeq: number;
  toSeq: number;
  /** Never `summaryTokenEstimate` - the real sanitizer rejects any key containing "token" (V1.8-D0 section 7/8, verified by execution, not just reading the regex). */
  summaryEstimatedSize: number;
  rawMessageCount: number;
  rawEstimatedSize: number;
  compactionDurationMs: number;
};

/**
 * Structural validation only - matches this module's own dedupe-key
 * discipline (agent-session/dedupe.ts's pure builder functions), never a
 * schema-validation library or framework. Callers still go through
 * sanitizeAgentSessionPayload for the forbidden-key/PII check; this only
 * catches a structurally nonsensical range (e.g. toSeq before fromSeq)
 * before it would ever reach that layer.
 */
export function isValidAgentSessionCompactedPayload(payload: AgentSessionCompactedPayload): boolean {
  return (
    Number.isInteger(payload.fromSeq) &&
    payload.fromSeq >= 0 &&
    Number.isInteger(payload.toSeq) &&
    payload.toSeq >= payload.fromSeq &&
    Number.isInteger(payload.summaryEstimatedSize) &&
    payload.summaryEstimatedSize >= 0 &&
    Number.isInteger(payload.rawMessageCount) &&
    payload.rawMessageCount >= 0 &&
    Number.isInteger(payload.rawEstimatedSize) &&
    payload.rawEstimatedSize >= 0 &&
    Number.isInteger(payload.compactionDurationMs) &&
    payload.compactionDurationMs >= 0
  );
}

/**
 * Extends today's real shadowRecorder.ts payload shape ({inboundMessageId,
 * outcome, terminalReason}) with outboundMessagePublicId. Optional for now
 * (per this task's own compatibility instruction) - the shadowRecorder.ts
 * call site is not changed in this task, so no writer populates this field
 * yet; a future slice makes it mandatory once every writer supplies it.
 * `terminalReason` stays `string` rather than importing
 * AgentToolLoopTerminalReason from ../events/types - this module has
 * deliberately imported nothing from that module so far (see this file's
 * own header comment), and the store layer never branches on the literal
 * union, only persists it.
 */
export type AgentSessionAssistantMessagePayload = {
  inboundMessageId: string;
  outcome: "message" | "handoff" | "none";
  terminalReason: string;
  /**
   * string when a customer-visible response was actually persisted to
   * conversation_message (the sole canonical transcript store - this field
   * is a reference to that row's public_id, never a duplicate of its text);
   * null for a terminal outcome with no such message (e.g. a silent
   * technical failure). Optional until every writer is migrated (D2).
   */
  outboundMessagePublicId?: string | null;
};
