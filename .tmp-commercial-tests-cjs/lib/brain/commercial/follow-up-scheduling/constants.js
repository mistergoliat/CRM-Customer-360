"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FOLLOW_UP_SCHEDULING_BUSINESS_DAY_RANGE = exports.FOLLOW_UP_SCHEDULING_APPROVAL_REQUIREMENTS = exports.FOLLOW_UP_SCHEDULING_RISK_SEVERITY = exports.FOLLOW_UP_SCHEDULING_RISK_LEVELS = exports.FOLLOW_UP_SCHEDULING_OPPORTUNITY_PAUSED_STATUSES = exports.FOLLOW_UP_SCHEDULING_OPPORTUNITY_CLOSED_STATUSES = exports.FOLLOW_UP_SCHEDULING_CASE_CLOSED_STATUSES = exports.FOLLOW_UP_SCHEDULING_REASONS = exports.FOLLOW_UP_SCHEDULING_DECISIONS = exports.FOLLOW_UP_SCHEDULING_ALLOWED_STATUSES = exports.FOLLOW_UP_SCHEDULING_SUPPORTED_ACTION_TYPES = exports.FOLLOW_UP_SCHEDULING_VERSION = void 0;
exports.FOLLOW_UP_SCHEDULING_VERSION = "brain.commercial.follow-up-scheduling.v1";
exports.FOLLOW_UP_SCHEDULING_SUPPORTED_ACTION_TYPES = [
    "schedule_followup",
    "send_followup_message",
    "request_more_context"
];
exports.FOLLOW_UP_SCHEDULING_ALLOWED_STATUSES = [
    "proposed",
    "approved",
    "planned",
    "scheduled"
];
exports.FOLLOW_UP_SCHEDULING_DECISIONS = [
    "ready",
    "wait",
    "cancel",
    "expire",
    "replan",
    "block",
    "invalid"
];
exports.FOLLOW_UP_SCHEDULING_REASONS = [
    "scheduled_time_reached",
    "scheduled_time_not_reached",
    "customer_replied",
    "customer_replied_after_action_created",
    "human_owner_active",
    "ai_blocked",
    "case_closed",
    "case_requires_human",
    "opportunity_closed_won",
    "opportunity_closed_lost",
    "opportunity_paused",
    "opportunity_stage_changed",
    "follow_up_not_allowed",
    "policy_blocked",
    "risk_too_high",
    "approval_required",
    "action_expired",
    "max_attempts_reached",
    "cooldown_active",
    "conflicting_action",
    "duplicate_action",
    "missing_schedule",
    "missing_expiry",
    "missing_action_id",
    "missing_idempotency_key",
    "unsupported_action_type",
    "invalid_action_status",
    "invalid_timestamp",
    "outside_business_hours",
    "replanned_for_business_hours",
    "replanned_after_cooldown",
    "replanned_after_recent_outbound",
    "stale_action_context"
];
exports.FOLLOW_UP_SCHEDULING_CASE_CLOSED_STATUSES = [
    "closed",
    "resolved",
    "cancelled",
    "canceled",
    "archived"
];
exports.FOLLOW_UP_SCHEDULING_OPPORTUNITY_CLOSED_STATUSES = ["won", "lost"];
exports.FOLLOW_UP_SCHEDULING_OPPORTUNITY_PAUSED_STATUSES = ["paused"];
exports.FOLLOW_UP_SCHEDULING_RISK_LEVELS = ["low", "medium", "high", "critical", "unknown"];
exports.FOLLOW_UP_SCHEDULING_RISK_SEVERITY = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
    unknown: 5
};
exports.FOLLOW_UP_SCHEDULING_APPROVAL_REQUIREMENTS = [
    "none",
    "operator_review",
    "manager_review",
    "blocked"
];
exports.FOLLOW_UP_SCHEDULING_BUSINESS_DAY_RANGE = [0, 1, 2, 3, 4, 5, 6];
