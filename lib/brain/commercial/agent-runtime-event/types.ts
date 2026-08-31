// SALES-AGENT-R3-A05. The permanent, type-level re-entry boundary between a
// real customer message and an internal scheduler wake-up
// (docs/architecture/SALES-AGENT-R3-A00-target-architecture.md Phase 2.G,
// Phase 4 scenario 10). A future SalesAgentHarness must be able to tell
// event.type === "CUSTOMER_MESSAGE" from event.type === "FOLLOWUP_WAKE"
// without inspecting text - these two variants are the only two ways any
// runtime re-enters a conversation.
//
// FollowUpWakeEvent carries only structural identifiers. It MUST NOT contain
// fabricated customer-authored text - see runAgentRuntimeEvent.ts and
// followup-wake/dispatchDraftedFollowUpMessage.ts for why: a follow-up wake
// dispatches its own durable draft directly, it never pretends to be
// something the customer said.

export const AGENT_RUNTIME_EVENT_TYPES = ["CUSTOMER_MESSAGE", "FOLLOWUP_WAKE"] as const;
export type AgentRuntimeEventType = (typeof AGENT_RUNTIME_EVENT_TYPES)[number];

/**
 * Structural, typed wrapper around today's real customer-inbound re-entry
 * (runNativeAutonomousCycle's NativeAutonomousCycleInput). Not a new
 * pipeline - see runAgentRuntimeEvent.ts, which maps this 1:1 onto the
 * existing, unchanged customer-message call. messageText is legitimate here:
 * this is the one variant that is genuinely allowed to carry customer-
 * authored text, because it IS one.
 */
export type CustomerMessageEvent = {
  type: "CUSTOMER_MESSAGE";
  conversationId: number;
  conversationPublicId: string;
  customerMasterId: number | null;
  waId: string;
  phoneNumberId: string;
  messageId: string | number | null;
  messageText: string;
  correlationId: string;
  currentTime: string;
};

/**
 * FOLLOWUP_WAKE reasons are derived from the existing claim origin
 * (runFollowupTick.ts#claimFollowUpCandidate's three branches) - never a new
 * business taxonomy invented for this task.
 */
export const FOLLOW_UP_WAKE_REASONS = ["scheduled_due", "stale_recovery", "retry"] as const;
export type FollowUpWakeReason = (typeof FOLLOW_UP_WAKE_REASONS)[number];

/**
 * A fired scheduled follow-up, re-entering as a distinct, typed system
 * event - never a customer message. actionPublicId is
 * crm_agent_actions.action_id, the existing durable identifier for the
 * scheduled row; wakeId is derived deterministically from it (see
 * agent-session/dedupe.ts#buildFollowUpWakeId) so a repeated worker
 * execution of the SAME logical attempt never produces a second logical
 * wake.
 */
export type FollowUpWakeEvent = {
  type: "FOLLOWUP_WAKE";
  wakeId: string;
  actionPublicId: string;
  attempt: number;
  conversationId: number;
  opportunityId: number | null;
  correlationId: string;
  causationId: string | null;
  scheduledFor: string | null;
  firedAt: string;
  reason: FollowUpWakeReason;
};

export type AgentRuntimeEvent = CustomerMessageEvent | FollowUpWakeEvent;
