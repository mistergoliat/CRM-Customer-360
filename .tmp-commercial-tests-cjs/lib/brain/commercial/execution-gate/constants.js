"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXECUTION_GATE_ALLOWED_LIFECYCLE_TRANSITIONS = exports.EXECUTION_GATE_ALLOWED_APPROVAL_REQUIREMENT = exports.EXECUTION_GATE_ALLOWED_RISK_LEVEL = exports.EXECUTION_GATE_SUPPORTED_COMMAND_TYPE = exports.EXECUTION_GATE_SUPPORTED_CHANNEL = exports.EXECUTION_GATE_ALLOWED_ACTION_STATUSES = exports.EXECUTION_GATE_SUPPORTED_ACTION_TYPES = exports.EXECUTION_GATE_BLOCK_REASONS = exports.EXECUTION_GATE_STATUSES = exports.COMMERCIAL_EXECUTION_GATE_VERSION = void 0;
exports.COMMERCIAL_EXECUTION_GATE_VERSION = "brain.commercial.execution-gate.v1";
exports.EXECUTION_GATE_STATUSES = [
    "allowed",
    "blocked",
    "disabled",
    "duplicate",
    "expired",
    "invalid",
    "failed"
];
exports.EXECUTION_GATE_BLOCK_REASONS = [
    "execution_gate_disabled",
    "sandbox_not_eligible",
    "action_not_found",
    "action_not_ready",
    "unsupported_action_type",
    "invalid_lifecycle_transition",
    "risk_not_allowed",
    "approval_not_satisfied",
    "human_owner_active",
    "ai_blocked",
    "case_closed",
    "missing_idempotency_key",
    "missing_recipient",
    "missing_message",
    "unsafe_message",
    "action_expired",
    "duplicate_execution",
    "conflicting_action",
    "policy_blocked",
    "outbox_command_invalid",
    "repository_failure",
    "transaction_failure"
];
exports.EXECUTION_GATE_SUPPORTED_ACTION_TYPES = [
    "send_whatsapp_reply",
    "request_more_context"
];
exports.EXECUTION_GATE_ALLOWED_ACTION_STATUSES = ["approved", "planned", "proposed"];
exports.EXECUTION_GATE_SUPPORTED_CHANNEL = "whatsapp";
exports.EXECUTION_GATE_SUPPORTED_COMMAND_TYPE = "whatsapp_text";
exports.EXECUTION_GATE_ALLOWED_RISK_LEVEL = "low";
exports.EXECUTION_GATE_ALLOWED_APPROVAL_REQUIREMENT = "none";
exports.EXECUTION_GATE_ALLOWED_LIFECYCLE_TRANSITIONS = [
    "proposed->planned",
    "approved->planned"
];
