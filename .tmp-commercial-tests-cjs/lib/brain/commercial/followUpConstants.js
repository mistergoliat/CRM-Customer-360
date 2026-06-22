"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TERMINAL_FOLLOW_UP_PLAN_STATUSES = exports.DEFAULT_FOLLOW_UP_POLICY_LIMITS = exports.FOLLOW_UP_ATTEMPT_OUTCOMES = exports.FOLLOW_UP_SUPPRESSION_REASONS = exports.FOLLOW_UP_PLAN_STATUSES = exports.FOLLOW_UP_APPROVAL_REQUIREMENTS = exports.FOLLOW_UP_CONFIDENCE_LEVELS = exports.FOLLOW_UP_URGENCIES = exports.FOLLOW_UP_CHANNELS = exports.FOLLOW_UP_REASONS = exports.FOLLOW_UP_DECISION_TYPES = exports.FOLLOW_UP_ELIGIBILITY_STATUSES = void 0;
exports.FOLLOW_UP_ELIGIBILITY_STATUSES = [
    "eligible",
    "not_yet_eligible",
    "suppressed",
    "blocked",
    "completed",
    "insufficient_context",
];
exports.FOLLOW_UP_DECISION_TYPES = [
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
];
exports.FOLLOW_UP_REASONS = [
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
];
exports.FOLLOW_UP_CHANNELS = [
    "whatsapp",
    "internal_task",
    "email",
    "phone_call",
    "none",
];
exports.FOLLOW_UP_URGENCIES = [
    "low",
    "normal",
    "high",
    "immediate",
];
exports.FOLLOW_UP_CONFIDENCE_LEVELS = [
    "high",
    "medium",
    "low",
];
exports.FOLLOW_UP_APPROVAL_REQUIREMENTS = [
    "none",
    "operator_review",
    "explicit_operator_approval",
    "blocked",
];
exports.FOLLOW_UP_PLAN_STATUSES = [
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
];
exports.FOLLOW_UP_SUPPRESSION_REASONS = [
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
];
exports.FOLLOW_UP_ATTEMPT_OUTCOMES = [
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
];
exports.DEFAULT_FOLLOW_UP_POLICY_LIMITS = {
    maxAttemptsPerOpportunity: 5,
    maxAttemptsPerChannel: 3,
    minimumIntervalBetweenAttemptsMinutes: 720,
    maxAttemptsInRollingWindow: 4,
    rollingWindowMinutes: 10080,
    stopAfterExplicitRejection: true,
    stopAfterPurchaseConfirmed: true,
    requireHumanAfterAttemptCount: 2,
    preventDuplicateActivePlans: true,
};
exports.TERMINAL_FOLLOW_UP_PLAN_STATUSES = [
    "executed",
    "skipped",
    "suppressed",
    "expired",
    "cancelled",
    "completed",
];
