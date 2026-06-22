"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMMERCIAL_ACTION_LIFECYCLE_ALLOWED_TRANSITIONS = exports.COMMERCIAL_ACTION_LIFECYCLE_VALIDATION_CODES = exports.COMMERCIAL_ACTION_TERMINAL_STATUSES = exports.COMMERCIAL_ACTION_EXECUTION_STATUSES = exports.COMMERCIAL_ACTION_CHANNELS = exports.COMMERCIAL_ACTION_RISK_LEVELS = exports.COMMERCIAL_ACTION_APPROVAL_REQUIREMENTS = exports.OPERATOR_REVIEW_DECISIONS = exports.COMMERCIAL_ACTION_STATUSES = exports.COMMERCIAL_ACTION_TYPES = exports.COMMERCIAL_ACTION_LIFECYCLE_VERSION = void 0;
exports.COMMERCIAL_ACTION_LIFECYCLE_VERSION = "brain.commercial.action-lifecycle.v1";
exports.COMMERCIAL_ACTION_TYPES = [
    "send_whatsapp_reply",
    "schedule_followup",
    "create_internal_task",
    "prepare_quote_draft",
    "take_over_case",
    "pause_ai",
    "request_more_context",
    "mark_lost_candidate",
    "no_action"
];
exports.COMMERCIAL_ACTION_STATUSES = [
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
];
exports.OPERATOR_REVIEW_DECISIONS = [
    "approve",
    "reject",
    "edit",
    "request_more_context",
    "take_over",
    "mark_not_useful"
];
exports.COMMERCIAL_ACTION_APPROVAL_REQUIREMENTS = [
    "none",
    "operator_review",
    "manager_review",
    "blocked"
];
exports.COMMERCIAL_ACTION_RISK_LEVELS = ["low", "medium", "high", "critical", "unknown"];
exports.COMMERCIAL_ACTION_CHANNELS = ["whatsapp", "email", "internal", "unknown"];
exports.COMMERCIAL_ACTION_EXECUTION_STATUSES = ["planned", "scheduled", "executing", "executed", "failed", "cancelled"];
exports.COMMERCIAL_ACTION_TERMINAL_STATUSES = ["rejected", "blocked", "cancelled", "expired", "executed", "failed"];
exports.COMMERCIAL_ACTION_LIFECYCLE_VALIDATION_CODES = [
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
];
exports.COMMERCIAL_ACTION_LIFECYCLE_ALLOWED_TRANSITIONS = [
    "draft->proposed",
    "proposed->requires_review",
    "requires_review->approved",
    "requires_review->rejected",
    "requires_review->edited",
    "edited->approved",
    "proposed->planned",
    "approved->planned",
    "planned->scheduled",
    "scheduled->scheduled",
    "proposed->blocked",
    "approved->blocked",
    "planned->blocked",
    "scheduled->blocked",
    "proposed->cancelled",
    "approved->cancelled",
    "planned->cancelled",
    "scheduled->cancelled",
    "proposed->expired",
    "approved->expired",
    "planned->expired",
    "scheduled->expired"
];
