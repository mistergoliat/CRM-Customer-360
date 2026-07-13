export const CONVERSATION_REQUEST_VERSION = "brain.commercial.conversation-request.v1" as const;

export const CONVERSATION_REQUEST_STATUSES = [
  "detected",
  "active",
  "waiting_customer",
  "waiting_system",
  "waiting_human",
  "partially_resolved",
  "resolved",
  "cancelled",
  "unresolvable"
] as const;
export type ConversationRequestStatus = (typeof CONVERSATION_REQUEST_STATUSES)[number];

export const CONVERSATION_REQUEST_DOMAINS = [
  "sales",
  "catalog",
  "maintenance",
  "support",
  "post_sale",
  "warranty",
  "order",
  "billing",
  "general",
  "human_assistance"
] as const;
export type ConversationRequestDomain = (typeof CONVERSATION_REQUEST_DOMAINS)[number];

export const CONVERSATION_REQUEST_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type ConversationRequestPriority = (typeof CONVERSATION_REQUEST_PRIORITIES)[number];

/**
 * Every status transition is validated against this table and applied with a
 * compare-and-swap UPDATE (same pattern as markFollowUpExecuting and the
 * outbox `WHERE status='locked'` guard). `resolved` and `unresolvable` can
 * reopen to `active`; `cancelled` is the only fully terminal state.
 */
export const REQUEST_LIFECYCLE_ALLOWED_TRANSITIONS: Record<ConversationRequestStatus, readonly ConversationRequestStatus[]> = {
  detected: ["active", "cancelled", "unresolvable"],
  active: ["waiting_customer", "waiting_system", "waiting_human", "partially_resolved", "resolved", "cancelled", "unresolvable"],
  waiting_customer: ["active", "waiting_human", "resolved", "cancelled", "unresolvable"],
  waiting_system: ["active", "waiting_human", "resolved", "cancelled", "unresolvable"],
  waiting_human: ["active", "resolved", "cancelled", "unresolvable"],
  partially_resolved: ["active", "waiting_customer", "waiting_system", "waiting_human", "resolved", "cancelled"],
  resolved: ["active"],
  cancelled: [],
  unresolvable: ["active"]
} as const;

/** Statuses the planner loads and may continue working on within a turn. */
export const CONVERSATION_REQUEST_ACTIVE_STATUSES = [
  "detected",
  "active",
  "waiting_customer",
  "waiting_system",
  "waiting_human",
  "partially_resolved"
] as const satisfies readonly ConversationRequestStatus[];

export const REQUEST_EVENT_TYPES = [
  "request_detected",
  "request_created",
  "message_linked",
  "facts_updated",
  "action_proposed",
  "action_executed",
  "action_failed",
  "action_deferred",
  "artifact_created",
  "waiting_customer",
  "waiting_system",
  "waiting_human",
  "request_resolved",
  "request_reopened",
  "request_cancelled",
  "turn_plan_failed",
  "information_provided",
  "address_selected",
  "address_confirmed",
  "quote_created",
  "quote_sent",
  "quote_accepted",
  "quote_rejected",
  "order_status_provided",
  "booking_request_created",
  "human_escalation_created"
] as const;
export type RequestEventType = (typeof REQUEST_EVENT_TYPES)[number];

export const REQUEST_EVENT_SOURCE_TYPES = [
  "customer_message",
  "planner",
  "tool_execution",
  "operator",
  "system",
  "migration"
] as const;
export type RequestEventSourceType = (typeof REQUEST_EVENT_SOURCE_TYPES)[number];

export const REQUEST_MESSAGE_RELATION_TYPES = [
  "created",
  "continued",
  "modified",
  "answered",
  "confirmed",
  "cancelled",
  "reopened",
  "mentioned"
] as const;
export type RequestMessageRelationType = (typeof REQUEST_MESSAGE_RELATION_TYPES)[number];

export const REQUEST_MESSAGE_LINKED_BY = ["deterministic", "planner", "operator", "migration"] as const;
export type RequestMessageLinkedBy = (typeof REQUEST_MESSAGE_LINKED_BY)[number];

export function isRequestTrackingEnabled(): boolean {
  return process.env.BRAIN_REQUEST_TRACKING_ENABLED?.trim().toLowerCase() === "true";
}
