"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BRAIN_COMMERCIAL_STATE_PERSISTENCE_ENABLED = exports.BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED = exports.COMMERCIAL_OPERATIONAL_LOOP_DEFAULT_PERSISTENCE_ENABLED = exports.COMMERCIAL_OPERATIONAL_LOOP_DEFAULT_ENABLED = exports.COMMERCIAL_OPERATIONAL_LOOP_DEFAULT_MODE = exports.COMMERCIAL_OPERATIONAL_LOOP_DEFAULT_TIMEOUT_MS = exports.COMMERCIAL_OPERATIONAL_LOOP_WARNING_VALUES = exports.COMMERCIAL_OPERATIONAL_LOOP_STAGE_STATUSES = exports.COMMERCIAL_OPERATIONAL_LOOP_STAGE_NAMES = exports.COMMERCIAL_OPERATIONAL_LOOP_SKIP_REASONS = exports.COMMERCIAL_OPERATIONAL_LOOP_NEXT_ACTION_TYPES = exports.COMMERCIAL_OPERATIONAL_LOOP_MODES = exports.COMMERCIAL_OPERATIONAL_LOOP_STATUSES = exports.COMMERCIAL_OPERATIONAL_LOOP_VERSION = void 0;
exports.COMMERCIAL_OPERATIONAL_LOOP_VERSION = "brain.commercial.operational-loop.v1";
exports.COMMERCIAL_OPERATIONAL_LOOP_STATUSES = [
    "completed",
    "skipped",
    "blocked",
    "failed_safe",
    "persistence_failed"
];
exports.COMMERCIAL_OPERATIONAL_LOOP_MODES = ["shadow", "fixture", "dry_run"];
exports.COMMERCIAL_OPERATIONAL_LOOP_NEXT_ACTION_TYPES = [
    "respond",
    "ask_clarifying_question",
    "qualify",
    "recommend_products",
    "prepare_quote",
    "wait_for_customer",
    "propose_followup",
    "escalate_to_operator",
    "pause",
    "close_as_lost_candidate",
    "no_action"
];
exports.COMMERCIAL_OPERATIONAL_LOOP_SKIP_REASONS = [
    "skipped_by_flag",
    "not_eligible",
    "no_commercial_signal",
    "no_shadow_result",
    "missing_commercial_context",
    "unsupported_context_shape",
    "duplicate_invocation",
    "terminal_state"
];
exports.COMMERCIAL_OPERATIONAL_LOOP_STAGE_NAMES = [
    "eligibility",
    "load_state",
    "identity_resolution",
    "state_reduction",
    "next_action_selection",
    "transition_validation",
    "persistence",
    "decision_record",
    "loop_complete"
];
exports.COMMERCIAL_OPERATIONAL_LOOP_STAGE_STATUSES = [
    "completed",
    "skipped",
    "blocked",
    "failed_safe",
    "persistence_failed",
    "timeout",
    "cancelled"
];
exports.COMMERCIAL_OPERATIONAL_LOOP_WARNING_VALUES = [
    "commercial_loop_disabled",
    "commercial_loop_skipped",
    "commercial_loop_cancelled",
    "commercial_shadow_unavailable",
    "commercial_context_missing",
    "commercial_state_missing",
    "commercial_state_ambiguous",
    "commercial_state_terminal",
    "commercial_state_policy_blocked",
    "commercial_state_human_owner_active",
    "commercial_state_ai_blocked",
    "commercial_state_conflict",
    "commercial_state_persistence_disabled",
    "commercial_state_persistence_failed",
    "commercial_state_retry_reused",
    "commercial_state_sanitized",
    "commercial_state_no_action",
    "commercial_state_transition_blocked",
    "commercial_state_timeout",
    "commercial_state_cancelled",
    "commercial_state_failed_safe",
    "commercial_state_duplicate_decision",
    "commercial_state_persistence_skipped",
    "commercial_state_persistence_completed"
];
exports.COMMERCIAL_OPERATIONAL_LOOP_DEFAULT_TIMEOUT_MS = 4000;
exports.COMMERCIAL_OPERATIONAL_LOOP_DEFAULT_MODE = "dry_run";
exports.COMMERCIAL_OPERATIONAL_LOOP_DEFAULT_ENABLED = false;
exports.COMMERCIAL_OPERATIONAL_LOOP_DEFAULT_PERSISTENCE_ENABLED = false;
exports.BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED = "BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED";
exports.BRAIN_COMMERCIAL_STATE_PERSISTENCE_ENABLED = "BRAIN_COMMERCIAL_STATE_PERSISTENCE_ENABLED";
