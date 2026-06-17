import type {
  FollowUpApprovalRequirement,
  FollowUpAttemptOutcome,
  FollowUpChannel,
  FollowUpConfidence,
  FollowUpDecisionType,
  FollowUpEligibilityStatus,
  FollowUpPlanStatus,
  FollowUpPolicyLimits,
  FollowUpReason,
  FollowUpSuppressionReason,
  FollowUpUrgency,
} from "./followUpTypes";

export const FOLLOW_UP_ELIGIBILITY_STATUSES = [
  "eligible",
  "not_yet_eligible",
  "suppressed",
  "blocked",
  "completed",
  "insufficient_context",
] as const satisfies readonly FollowUpEligibilityStatus[];

export const FOLLOW_UP_DECISION_TYPES = [
  "no_action",
  "wait",
  "propose_whatsapp_followup",
  "propose_internal_task",
  "propose_email_followup",
  "propose_operator_review",
  "propose_call",
  "pause_contact",
  "mark_stalled_candidate",
  "mark_lost_candidate",
  "close_followup_plan",
] as const satisfies readonly FollowUpDecisionType[];

export const FOLLOW_UP_REASONS = [
  "customer_replied",
  "awaiting_customer_reply",
  "customer_silent",
  "left_on_seen",
  "quote_sent_no_reply",
  "quote_pending_internal",
  "clarification_needed",
  "objection_unresolved",
  "high_intent_inactive",
  "delivery_deadline_near",
  "requested_callback",
  "requested_later_contact",
  "operator_requested",
  "stale_opportunity",
  "explicit_rejection",
  "purchase_confirmed",
  "duplicate_contact_risk",
  "contact_limit_reached",
  "manual_block",
  "insufficient_identity",
  "insufficient_context",
  "unknown",
] as const satisfies readonly FollowUpReason[];

export const FOLLOW_UP_CHANNELS = [
  "whatsapp",
  "internal_task",
  "email",
  "phone_call",
  "none",
] as const satisfies readonly FollowUpChannel[];

export const FOLLOW_UP_URGENCIES = [
  "low",
  "normal",
  "high",
  "immediate",
] as const satisfies readonly FollowUpUrgency[];

export const FOLLOW_UP_CONFIDENCE_LEVELS = [
  "high",
  "medium",
  "low",
] as const satisfies readonly FollowUpConfidence[];

export const FOLLOW_UP_APPROVAL_REQUIREMENTS = [
  "none",
  "operator_review",
  "explicit_operator_approval",
  "blocked",
] as const satisfies readonly FollowUpApprovalRequirement[];

export const FOLLOW_UP_PLAN_STATUSES = [
  "proposed",
  "pending_approval",
  "approved",
  "scheduled",
  "due",
  "executed",
  "skipped",
  "suppressed",
  "expired",
  "cancelled",
  "completed",
] as const satisfies readonly FollowUpPlanStatus[];

export const FOLLOW_UP_SUPPRESSION_REASONS = [
  "customer_opted_out",
  "explicit_rejection",
  "manual_block",
  "contact_limit_reached",
  "duplicate_active_plan",
  "recent_customer_reply",
  "recent_human_contact",
  "opportunity_terminal",
  "purchase_confirmed",
  "invalid_contact",
  "identity_conflict",
  "channel_unavailable",
  "quiet_hours",
  "insufficient_context",
  "legal_or_policy_block",
  "unknown",
] as const satisfies readonly FollowUpSuppressionReason[];

export const FOLLOW_UP_ATTEMPT_OUTCOMES = [
  "sent",
  "delivered",
  "read",
  "replied",
  "no_reply",
  "failed",
  "rejected",
  "skipped",
  "cancelled",
  "unknown",
] as const satisfies readonly FollowUpAttemptOutcome[];

export const DEFAULT_FOLLOW_UP_POLICY_LIMITS = {
  maxAttemptsPerOpportunity: 5,
  maxAttemptsPerChannel: 3,
  minimumIntervalBetweenAttemptsMinutes: 720,
  maxAttemptsInRollingWindow: 4,
  rollingWindowMinutes: 10080,
  stopAfterExplicitRejection: true,
  stopAfterPurchaseConfirmed: true,
  requireHumanAfterAttemptCount: 2,
  preventDuplicateActivePlans: true,
} as const satisfies FollowUpPolicyLimits;

export const TERMINAL_FOLLOW_UP_PLAN_STATUSES = [
  "executed",
  "skipped",
  "suppressed",
  "expired",
  "cancelled",
  "completed",
] as const satisfies readonly FollowUpPlanStatus[];
