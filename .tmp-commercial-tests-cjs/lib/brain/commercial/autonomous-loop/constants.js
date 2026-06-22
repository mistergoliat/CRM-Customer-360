"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUTONOMOUS_LOOP_AUDIT_EVENT_TYPES = exports.AUTONOMOUS_LOOP_STAGES = exports.AUTONOMOUS_LOOP_STATUSES = exports.AUTONOMOUS_LOOP_MODES = exports.AUTONOMOUS_COMMERCIAL_LOOP_VERSION = void 0;
exports.buildAutonomousLoopRunId = buildAutonomousLoopRunId;
exports.buildAutonomousAuditEventId = buildAutonomousAuditEventId;
exports.buildOutboxRecordId = buildOutboxRecordId;
exports.buildDeliveryReconciliationId = buildDeliveryReconciliationId;
exports.sanitizeAutonomousLoopText = sanitizeAutonomousLoopText;
exports.maskAutonomousLoopWaId = maskAutonomousLoopWaId;
exports.cloneDeep = cloneDeep;
exports.isAutonomousLoopStage = isAutonomousLoopStage;
exports.isAutonomousLoopStatus = isAutonomousLoopStatus;
exports.isAutonomousLoopMode = isAutonomousLoopMode;
const node_crypto_1 = require("node:crypto");
exports.AUTONOMOUS_COMMERCIAL_LOOP_VERSION = "brain.commercial.autonomous-loop.v1";
exports.AUTONOMOUS_LOOP_MODES = ["observe", "simulate", "execute_fake"];
exports.AUTONOMOUS_LOOP_STATUSES = [
    "completed",
    "blocked",
    "waiting",
    "cancelled",
    "expired",
    "requires_human",
    "delivered",
    "retry_scheduled",
    "dead_letter",
    "invalid",
    "failed"
];
exports.AUTONOMOUS_LOOP_STAGES = [
    "context",
    "operational_loop",
    "decision",
    "action",
    "sandbox",
    "execution_gate",
    "outbox",
    "worker",
    "transport",
    "delivery_reconciliation",
    "follow_up_scheduling",
    "follow_up_replanning",
    "audit",
    "complete"
];
exports.AUTONOMOUS_LOOP_AUDIT_EVENT_TYPES = [
    "loop_started",
    "loop_completed",
    "duplicate_inbound_detected",
    "operational_loop_completed",
    "decision_selected",
    "action_built",
    "sandbox_evaluated",
    "execution_gate_evaluated",
    "outbox_created",
    "outbox_processed",
    "delivery_reconciled",
    "follow_up_evaluated",
    "follow_up_mutated",
    "runtime_state_applied",
    "loop_failed"
];
function buildStableDigest(payload) {
    return (0, node_crypto_1.createHash)("sha256").update(JSON.stringify(payload)).digest("hex");
}
function buildAutonomousLoopRunId(input) {
    return `autonomous-loop:${buildStableDigest(input).slice(0, 24)}`;
}
function buildAutonomousAuditEventId(input) {
    return `autonomous-audit:${buildStableDigest(input).slice(0, 24)}`;
}
function buildOutboxRecordId(input) {
    return `autonomous-outbox:${buildStableDigest(input).slice(0, 24)}`;
}
function buildDeliveryReconciliationId(input) {
    return `autonomous-delivery:${buildStableDigest(input).slice(0, 24)}`;
}
function sanitizeAutonomousLoopText(value, limit = 200) {
    if (value === null || value === undefined)
        return null;
    const text = typeof value === "string" ? value : String(value);
    const normalized = text
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
        .replace(/\b(?:\+?\d[\d\s-]{6,}\d)\b/g, "[redacted]")
        .replace(/(authorization|api[-_]?key|token|secret|password|cookie)\s*[:=]?\s*[^\s,;]+/gi, "$1=[redacted]")
        .replace(/[\r\n]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return normalized.length > 0 ? normalized.slice(0, limit) : null;
}
function maskAutonomousLoopWaId(value) {
    if (value === null || value === undefined)
        return null;
    const digits = String(value).replace(/\D+/g, "");
    if (!digits)
        return null;
    if (digits.length <= 4)
        return `${digits.slice(0, 1)}${"*".repeat(Math.max(0, digits.length - 2))}${digits.slice(-1)}`;
    return `${digits.slice(0, 3)}${"*".repeat(Math.max(0, digits.length - 6))}${digits.slice(-3)}`;
}
function cloneDeep(value) {
    return structuredClone(value);
}
function isAutonomousLoopStage(value) {
    return exports.AUTONOMOUS_LOOP_STAGES.includes(value);
}
function isAutonomousLoopStatus(value) {
    return exports.AUTONOMOUS_LOOP_STATUSES.includes(value);
}
function isAutonomousLoopMode(value) {
    return exports.AUTONOMOUS_LOOP_MODES.includes(value);
}
