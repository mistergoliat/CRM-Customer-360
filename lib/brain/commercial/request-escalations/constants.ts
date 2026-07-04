export const ESCALATION_STATUSES = ["created", "assigned", "accepted", "in_progress", "resolved", "cancelled", "expired"] as const;
export type EscalationStatus = (typeof ESCALATION_STATUSES)[number];

export const ESCALATION_OPEN_STATUSES = ["created", "assigned", "accepted", "in_progress"] as const satisfies readonly EscalationStatus[];

export const ESCALATION_CATEGORIES = [
  "sales",
  "customer_service",
  "post_sale",
  "logistics",
  "finance",
  "technical_support",
  "policy_approval",
  "technical_failure",
  "other"
] as const;
export type EscalationCategory = (typeof ESCALATION_CATEGORIES)[number];

export const ESCALATION_MODES = ["exclusive_handoff", "approval_request", "internal_consultation", "technical_recovery"] as const;
export type EscalationMode = (typeof ESCALATION_MODES)[number];

export const ESCALATION_TARGET_TYPES = ["team", "queue", "role", "user", "external_system"] as const;
export type EscalationTargetType = (typeof ESCALATION_TARGET_TYPES)[number];

export const ESCALATION_CREATED_BY = ["planner", "system", "operator"] as const;
export type EscalationCreatedBy = (typeof ESCALATION_CREATED_BY)[number];

export const ESCALATION_RESOLUTION_OUTCOMES = ["resolved_request", "returned_to_ai", "cancelled", "expired"] as const;
export type EscalationResolutionOutcome = (typeof ESCALATION_RESOLUTION_OUTCOMES)[number];

/** CAS-enforced lifecycle (ADR-007): resolved/cancelled are terminal; expired can be re-routed. */
export const ESCALATION_ALLOWED_TRANSITIONS: Record<EscalationStatus, readonly EscalationStatus[]> = {
  created: ["assigned", "cancelled", "expired"],
  assigned: ["accepted", "cancelled", "expired"],
  accepted: ["in_progress", "resolved", "cancelled"],
  in_progress: ["resolved", "cancelled"],
  resolved: [],
  cancelled: [],
  expired: ["assigned", "cancelled"]
} as const;

/** No routing directory exists yet: everything lands in one visible queue. */
export const DEFAULT_ESCALATION_TARGET = { targetType: "queue" as EscalationTargetType, targetId: "general" };
