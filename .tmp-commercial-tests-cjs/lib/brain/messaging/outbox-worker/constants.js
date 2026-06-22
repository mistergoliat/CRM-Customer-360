"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OUTBOX_WORKER_RETRYABLE_FAILURE_CODES = exports.OUTBOX_WORKER_PERMANENT_FAILURE_CODES = exports.OUTBOX_WORKER_RECOVERABLE_LEASE_STATUSES = exports.OUTBOX_WORKER_RECLAIMABLE_STATUSES = exports.OUTBOX_WORKER_TERMINAL_STATUSES = exports.OUTBOX_WORKER_PLAN_REASONS = exports.OUTBOX_WORKER_AUDIT_EVENT_TYPES = exports.OUTBOX_WORKER_PLAN_TYPES = exports.OUTBOX_WORKER_VERSION = void 0;
exports.buildStableDigest = buildStableDigest;
exports.buildOutboxWorkerPlanId = buildOutboxWorkerPlanId;
exports.buildOutboxWorkerPlanKey = buildOutboxWorkerPlanKey;
exports.buildOutboxAuditEventId = buildOutboxAuditEventId;
exports.buildFakeProviderMessageId = buildFakeProviderMessageId;
exports.sanitizeOutboxWorkerErrorMessage = sanitizeOutboxWorkerErrorMessage;
exports.maskRecipientForAudit = maskRecipientForAudit;
exports.normalizeCommandText = normalizeCommandText;
exports.normalizeIsoTimestamp = normalizeIsoTimestamp;
exports.addSecondsToIso = addSecondsToIso;
exports.minIso = minIso;
exports.maxIso = maxIso;
exports.isTerminalOutboxStatus = isTerminalOutboxStatus;
exports.isRecoverableLeaseStatus = isRecoverableLeaseStatus;
exports.isReclaimableOutboxStatus = isReclaimableOutboxStatus;
exports.isRetryableTransportErrorCode = isRetryableTransportErrorCode;
exports.isPermanentTransportErrorCode = isPermanentTransportErrorCode;
exports.clone = clone;
const node_crypto_1 = require("node:crypto");
const autonomy_sandbox_1 = require("../../commercial/autonomy-sandbox");
exports.OUTBOX_WORKER_VERSION = "brain.messaging.outbox-worker.v1";
exports.OUTBOX_WORKER_PLAN_TYPES = [
    "no_change",
    "mark_processing",
    "mark_delivered",
    "schedule_retry",
    "mark_failed",
    "move_to_dead_letter",
    "expire_message",
    "release_claim"
];
exports.OUTBOX_WORKER_AUDIT_EVENT_TYPES = [
    "outbox_processing_started",
    "outbox_delivered",
    "outbox_retry_scheduled",
    "outbox_failed",
    "outbox_dead_lettered",
    "outbox_expired",
    "outbox_claim_released"
];
exports.OUTBOX_WORKER_PLAN_REASONS = [
    "worker_disabled",
    "transport_disabled",
    "sandbox_required",
    "missing_command_id",
    "missing_idempotency_key",
    "missing_action_id",
    "unsupported_channel",
    "unsupported_command_type",
    "status_not_reclaimable",
    "terminal_status",
    "not_yet_available",
    "message_expired",
    "attempts_exhausted",
    "missing_recipient",
    "missing_message",
    "wrong_worker_claim",
    "lease_not_recoverable",
    "active_lease",
    "processing_plan_failure",
    "final_plan_failure",
    "transport_accepted",
    "transport_duplicate_accepted",
    "transport_temporary_failure",
    "transport_rate_limited",
    "transport_timeout",
    "transport_permanent_failure",
    "retry_exhausted",
    "duplicate_plan_key",
    "duplicate_idempotency_key",
    "repository_failure",
    "expired",
    "idempotent_plan_reused"
];
exports.OUTBOX_WORKER_TERMINAL_STATUSES = ["delivered", "dead_letter", "cancelled"];
exports.OUTBOX_WORKER_RECLAIMABLE_STATUSES = ["pending", "retry_scheduled"];
exports.OUTBOX_WORKER_RECOVERABLE_LEASE_STATUSES = ["claimed", "processing"];
exports.OUTBOX_WORKER_PERMANENT_FAILURE_CODES = [
    "invalid_recipient",
    "invalid_payload",
    "authentication_error",
    "permission_error",
    "policy_rejected",
    "provider_duplicate"
];
exports.OUTBOX_WORKER_RETRYABLE_FAILURE_CODES = [
    "network_error",
    "timeout",
    "rate_limited",
    "provider_unavailable",
    "unknown",
    "none"
];
function buildStableDigest(payload) {
    return (0, node_crypto_1.createHash)("sha256").update(JSON.stringify(payload)).digest("hex");
}
function buildOutboxWorkerPlanId(input) {
    const digest = buildStableDigest(input);
    return `outbox-worker-plan:${digest.slice(0, 24)}`;
}
function buildOutboxWorkerPlanKey(input) {
    const digest = buildStableDigest(input);
    return `outbox-worker:${input.commandId}:${input.planType}:${digest.slice(0, 24)}`;
}
function buildOutboxAuditEventId(input) {
    const digest = buildStableDigest(input);
    return `outbox-audit:${input.commandId}:${input.eventType}:${digest.slice(0, 24)}`;
}
function buildFakeProviderMessageId(input) {
    return `fake-provider:${input.commandId}`;
}
function sanitizeOutboxWorkerErrorMessage(value, limit = 180) {
    if (typeof value !== "string")
        return null;
    const compact = value
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\bBearer\s+[A-Za-z0-9._-]+\b/gi, "Bearer [redacted]")
        .replace(/\b(token|secret|password|authorization)\b[:=]\s*[^\s]+/gi, "$1=[redacted]")
        .replace(/\b\d{6,}\b/g, "[redacted]")
        .trim();
    if (!compact)
        return null;
    return compact.length > limit ? `${compact.slice(0, limit - 3)}...` : compact;
}
function maskRecipientForAudit(value) {
    return (0, autonomy_sandbox_1.maskWaId)((0, autonomy_sandbox_1.normalizeWaIdDigits)(value));
}
function normalizeCommandText(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function normalizeIsoTimestamp(value) {
    if (typeof value !== "string")
        return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function addSecondsToIso(value, seconds) {
    const parsed = new Date(value);
    return new Date(parsed.getTime() + seconds * 1000).toISOString();
}
function minIso(a, b) {
    if (!a)
        return b;
    if (!b)
        return a;
    return a <= b ? a : b;
}
function maxIso(a, b) {
    if (!a)
        return b;
    if (!b)
        return a;
    return a >= b ? a : b;
}
function isTerminalOutboxStatus(status) {
    return exports.OUTBOX_WORKER_TERMINAL_STATUSES.includes(status);
}
function isRecoverableLeaseStatus(status) {
    return exports.OUTBOX_WORKER_RECOVERABLE_LEASE_STATUSES.includes(status);
}
function isReclaimableOutboxStatus(status) {
    return exports.OUTBOX_WORKER_RECLAIMABLE_STATUSES.includes(status);
}
function isRetryableTransportErrorCode(code) {
    return exports.OUTBOX_WORKER_RETRYABLE_FAILURE_CODES.includes(code);
}
function isPermanentTransportErrorCode(code) {
    return exports.OUTBOX_WORKER_PERMANENT_FAILURE_CODES.includes(code);
}
function clone(value) {
    return structuredClone(value);
}
