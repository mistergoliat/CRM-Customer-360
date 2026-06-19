import type {
  CommercialActionApprovalRequirement,
  CommercialActionChannel,
  CommercialActionStatus,
  CommercialActionType,
  CommercialActionRiskLevel,
  OperatorReviewDecision
} from "./types";

export const COMMERCIAL_ACTION_LIFECYCLE_VERSION = "brain.commercial.action-lifecycle.v1" as const;

export const COMMERCIAL_ACTION_TYPES = [
  "send_whatsapp_reply",
  "schedule_followup",
  "create_internal_task",
  "prepare_quote_draft",
  "take_over_case",
  "pause_ai",
  "request_more_context",
  "mark_lost_candidate",
  "no_action"
] as const satisfies readonly CommercialActionType[];

export const COMMERCIAL_ACTION_STATUSES = [
  "draft",
  "proposed",
  "requires_review",
  "approved",
  "rejected",
  "edited",
  "blocked",
  "planned",
  "scheduled",
  "executing",
  "executed",
  "failed",
  "cancelled",
  "expired"
] as const satisfies readonly CommercialActionStatus[];

export const OPERATOR_REVIEW_DECISIONS = [
  "approve",
  "reject",
  "edit",
  "request_more_context",
  "take_over",
  "mark_not_useful"
] as const satisfies readonly OperatorReviewDecision[];

export const COMMERCIAL_ACTION_APPROVAL_REQUIREMENTS = [
  "none",
  "operator_review",
  "manager_review",
  "blocked"
] as const satisfies readonly CommercialActionApprovalRequirement[];

export const COMMERCIAL_ACTION_RISK_LEVELS = ["low", "medium", "high", "critical", "unknown"] as const satisfies readonly CommercialActionRiskLevel[];

export const COMMERCIAL_ACTION_CHANNELS = ["whatsapp", "email", "internal", "unknown"] as const satisfies readonly CommercialActionChannel[];

export const COMMERCIAL_ACTION_EXECUTION_STATUSES = ["planned", "scheduled", "executing", "executed", "failed", "cancelled"] as const;

export const COMMERCIAL_ACTION_TERMINAL_STATUSES = ["rejected", "blocked", "cancelled", "expired", "executed", "failed"] as const;

export const COMMERCIAL_ACTION_LIFECYCLE_VALIDATION_CODES = [
  "valid",
  "invalid_root",
  "invalid_status",
  "invalid_action_type",
  "invalid_review_decision",
  "invalid_identifier",
  "invalid_channel",
  "missing_idempotency_key",
  "invalid_transition",
  "terminal_status_protected",
  "execution_not_enabled_in_p1k_011a",
  "unknown_issue"
] as const;

export const COMMERCIAL_ACTION_LIFECYCLE_ALLOWED_TRANSITIONS = [
  "draft->proposed",
  "proposed->requires_review",
  "requires_review->approved",
  "requires_review->rejected",
  "requires_review->edited",
  "edited->approved",
  "approved->planned",
  "planned->scheduled",
  "planned->cancelled",
  "scheduled->cancelled",
  "scheduled->expired"
] as const;
