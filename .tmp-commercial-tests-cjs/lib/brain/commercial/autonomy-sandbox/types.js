"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMMERCIAL_SANDBOX_AUTONOMY_DEFAULT_MESSAGE_LIMIT = exports.COMMERCIAL_SANDBOX_AUTONOMY_ALLOWED_CHANNEL = exports.COMMERCIAL_SANDBOX_AUTONOMY_ALLOWED_RISK_LEVEL = exports.COMMERCIAL_SANDBOX_AUTONOMY_ALLOWED_ACTION_TYPES = exports.SANDBOX_AUTONOMY_BLOCK_REASONS = exports.SANDBOX_AUTONOMY_ELIGIBILITY_STATUSES = void 0;
exports.maskWaId = maskWaId;
exports.normalizeWaIdDigits = normalizeWaIdDigits;
exports.buildSandboxAutonomyConfig = buildSandboxAutonomyConfig;
exports.isSandboxAutonomyAction = isSandboxAutonomyAction;
exports.SANDBOX_AUTONOMY_ELIGIBILITY_STATUSES = ["eligible", "blocked", "disabled", "invalid", "expired", "requires_review"];
exports.SANDBOX_AUTONOMY_BLOCK_REASONS = [
    "sandbox_disabled",
    "autonomous_reply_disabled",
    "recipient_not_whitelisted",
    "missing_recipient",
    "unsupported_channel",
    "unsupported_action_type",
    "risk_too_high",
    "approval_required",
    "human_owner_active",
    "ai_blocked",
    "case_closed",
    "action_expired",
    "missing_idempotency_key",
    "unsafe_payload",
    "unsafe_message",
    "duplicate_or_conflicting_action",
    "action_not_ready",
    "policy_blocked"
];
exports.COMMERCIAL_SANDBOX_AUTONOMY_ALLOWED_ACTION_TYPES = [
    "send_whatsapp_reply",
    "request_more_context"
];
exports.COMMERCIAL_SANDBOX_AUTONOMY_ALLOWED_RISK_LEVEL = "low";
exports.COMMERCIAL_SANDBOX_AUTONOMY_ALLOWED_CHANNEL = "whatsapp";
exports.COMMERCIAL_SANDBOX_AUTONOMY_DEFAULT_MESSAGE_LIMIT = 800;
function normalizeDigits(value) {
    return value.replace(/\D+/g, "");
}
function maskWaId(value) {
    if (value === null || value === undefined)
        return null;
    const digits = normalizeDigits(value.trim());
    if (!digits)
        return null;
    if (digits.length <= 6) {
        if (digits.length <= 2)
            return "*".repeat(digits.length);
        return `${digits.slice(0, 1)}${"*".repeat(Math.max(0, digits.length - 2))}${digits.slice(-1)}`;
    }
    return `${digits.slice(0, 3)}${"*".repeat(Math.max(0, digits.length - 6))}${digits.slice(-3)}`;
}
function normalizeWaIdDigits(value) {
    if (value === null || value === undefined)
        return null;
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    const digits = normalizeDigits(trimmed);
    return digits.length > 0 ? digits : null;
}
function buildSandboxAutonomyConfig(overrides = {}) {
    return {
        sandboxEnabled: false,
        autonomousReplyEnabled: false,
        whitelistedWaIds: [],
        allowedActionTypes: [...exports.COMMERCIAL_SANDBOX_AUTONOMY_ALLOWED_ACTION_TYPES],
        maxRiskLevel: exports.COMMERCIAL_SANDBOX_AUTONOMY_ALLOWED_RISK_LEVEL,
        ...overrides
    };
}
function isSandboxAutonomyAction(action) {
    return exports.COMMERCIAL_SANDBOX_AUTONOMY_ALLOWED_ACTION_TYPES.includes(action.actionType);
}
