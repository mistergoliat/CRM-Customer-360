"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMMERCIAL_AGENT_ACTION_QUEUE_MAX_BLOCK_REASONS = exports.COMMERCIAL_AGENT_ACTION_QUEUE_MAX_NOTES = exports.COMMERCIAL_AGENT_ACTION_QUEUE_MAX_TEXT_LENGTH = exports.COMMERCIAL_AGENT_ACTION_QUEUE_VIEW_MODEL_MAX_ITEMS = exports.COMMERCIAL_AGENT_ACTION_QUEUE_DEFAULT_LIMIT = exports.COMMERCIAL_AGENT_ACTION_QUEUE_MAX_LIMIT = exports.COMMERCIAL_AGENT_ACTION_QUEUE_EXECUTION_BLOCKED_STATUSES = exports.COMMERCIAL_AGENT_ACTION_QUEUE_TERMINAL_STATUSES = exports.COMMERCIAL_AGENT_ACTION_QUEUE_LOAD_STATUS = exports.COMMERCIAL_AGENT_ACTION_QUEUE_PERSIST_STATUS = exports.COMMERCIAL_AGENT_ACTION_QUEUE_VALIDATION_CODES = exports.COMMERCIAL_AGENT_ACTION_CHANNELS = exports.COMMERCIAL_AGENT_ACTION_RISK_LEVELS = exports.COMMERCIAL_AGENT_ACTION_APPROVAL_REQUIREMENTS = exports.COMMERCIAL_AGENT_ACTION_STATUSES = exports.COMMERCIAL_AGENT_ACTION_TYPES = exports.COMMERCIAL_AGENT_ACTION_QUEUE_DEFAULT_FEATURE_FLAGS = exports.BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED = exports.BRAIN_AGENT_ACTION_QUEUE_ENABLED = exports.CRM_AGENT_ACTIONS_TABLE = exports.COMMERCIAL_AGENT_ACTION_QUEUE_VERSION = void 0;
exports.COMMERCIAL_AGENT_ACTION_QUEUE_VERSION = "brain.commercial.action-queue.v1";
exports.CRM_AGENT_ACTIONS_TABLE = "crm_agent_actions";
exports.BRAIN_AGENT_ACTION_QUEUE_ENABLED = "BRAIN_AGENT_ACTION_QUEUE_ENABLED";
exports.BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED = "BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED";
exports.COMMERCIAL_AGENT_ACTION_QUEUE_DEFAULT_FEATURE_FLAGS = {
    queueEnabled: false,
    persistenceEnabled: false
};
exports.COMMERCIAL_AGENT_ACTION_TYPES = [
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
exports.COMMERCIAL_AGENT_ACTION_STATUSES = [
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
exports.COMMERCIAL_AGENT_ACTION_APPROVAL_REQUIREMENTS = [
    "none",
    "operator_review",
    "manager_review",
    "blocked",
    "explicit_operator_approval"
];
exports.COMMERCIAL_AGENT_ACTION_RISK_LEVELS = ["low", "medium", "high", "critical", "unknown", "blocked"];
exports.COMMERCIAL_AGENT_ACTION_CHANNELS = ["whatsapp", "email", "web", "phone", "pos", "hub", "campaign", "legacy", "internal", "unknown"];
exports.COMMERCIAL_AGENT_ACTION_QUEUE_VALIDATION_CODES = [
    "valid",
    "invalid_root",
    "missing_required_field",
    "invalid_enum_value",
    "invalid_iso_timestamp",
    "invalid_number",
    "invalid_boolean",
    "invalid_channel",
    "invalid_state",
    "execution_not_enabled_in_p1k_012a",
    "outbox_not_allowed",
    "unknown_issue"
];
exports.COMMERCIAL_AGENT_ACTION_QUEUE_PERSIST_STATUS = [
    "skipped_by_flag",
    "dry_run",
    "inserted",
    "updated_existing",
    "duplicate_ignored",
    "failed"
];
exports.COMMERCIAL_AGENT_ACTION_QUEUE_LOAD_STATUS = ["loaded", "unavailable", "error"];
exports.COMMERCIAL_AGENT_ACTION_QUEUE_TERMINAL_STATUSES = ["blocked", "rejected", "cancelled", "expired", "executed", "failed"];
exports.COMMERCIAL_AGENT_ACTION_QUEUE_EXECUTION_BLOCKED_STATUSES = ["executing", "executed"];
exports.COMMERCIAL_AGENT_ACTION_QUEUE_MAX_LIMIT = 100;
exports.COMMERCIAL_AGENT_ACTION_QUEUE_DEFAULT_LIMIT = 50;
exports.COMMERCIAL_AGENT_ACTION_QUEUE_VIEW_MODEL_MAX_ITEMS = 12;
exports.COMMERCIAL_AGENT_ACTION_QUEUE_MAX_TEXT_LENGTH = 2000;
exports.COMMERCIAL_AGENT_ACTION_QUEUE_MAX_NOTES = 12;
exports.COMMERCIAL_AGENT_ACTION_QUEUE_MAX_BLOCK_REASONS = 8;
