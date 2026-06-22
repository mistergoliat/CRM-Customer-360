"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCENARIO_ALLOWED_PATHS = exports.SCENARIO_ALLOWED_RECIPIENTS = exports.SCENARIO_ALLOWED_CATEGORIES = exports.SCENARIO_EXECUTION_MODES = exports.SCENARIO_SIMULATOR_VERSION = void 0;
exports.buildScenarioRunId = buildScenarioRunId;
exports.buildScenarioStepRunId = buildScenarioStepRunId;
exports.buildScenarioReportId = buildScenarioReportId;
exports.buildScenarioExpectationResultId = buildScenarioExpectationResultId;
exports.normalizeScenarioDigits = normalizeScenarioDigits;
exports.isScenarioRecipientAllowed = isScenarioRecipientAllowed;
exports.sanitizeScenarioText = sanitizeScenarioText;
exports.containsForbiddenScenarioText = containsForbiddenScenarioText;
exports.maskScenarioWaId = maskScenarioWaId;
exports.overrideScenarioMode = overrideScenarioMode;
const node_crypto_1 = require("node:crypto");
const autonomous_loop_1 = require("../autonomous-loop");
exports.SCENARIO_SIMULATOR_VERSION = "brain.commercial.scenario-simulator.v1";
exports.SCENARIO_EXECUTION_MODES = ["observe", "simulate", "execute_fake"];
exports.SCENARIO_ALLOWED_CATEGORIES = [
    "sales",
    "follow_up",
    "risk",
    "human_handoff",
    "transport",
    "idempotency",
    "lifecycle",
    "failure"
];
exports.SCENARIO_ALLOWED_RECIPIENTS = [
    "56911111111",
    "56922222222",
    "56933333333",
    "56944444444",
    "56955555555",
    "56966666666",
    "56977777777",
    "56988888888",
    "56999999999"
];
exports.SCENARIO_ALLOWED_PATHS = [
    "loop.status",
    "loop.finalStage",
    "action.status",
    "outbox.status",
    "delivery.status",
    "followUp.schedulingResult.decision",
    "followUp.mutationPlan.planType",
    "runtime.actions.count",
    "runtime.outbox.count",
    "runtime.audit.count",
    "sideEffects.realMessageSent",
    "sideEffects.metaCalled",
    "sideEffects.realDatabaseWritten",
    "sideEffects.realOutboxWritten",
    "sideEffects.schedulerTriggered",
    "report.result.status"
];
function buildDigest(payload) {
    return (0, node_crypto_1.createHash)("sha256").update(JSON.stringify(payload)).digest("hex");
}
function buildScenarioRunId(input) {
    return `scenario-run:${buildDigest(input).slice(0, 24)}`;
}
function buildScenarioStepRunId(input) {
    return `scenario-step:${buildDigest(input).slice(0, 24)}`;
}
function buildScenarioReportId(input) {
    return `scenario-report:${buildDigest(input).slice(0, 24)}`;
}
function buildScenarioExpectationResultId(input) {
    return `scenario-expectation:${buildDigest(input).slice(0, 24)}`;
}
function normalizeScenarioDigits(value) {
    if (value === null || value === undefined)
        return null;
    const digits = String(value).replace(/\D+/g, "");
    return digits.length > 0 ? digits : null;
}
function isScenarioRecipientAllowed(value) {
    const digits = normalizeScenarioDigits(value);
    if (!digits)
        return false;
    return exports.SCENARIO_ALLOWED_RECIPIENTS.includes(digits);
}
function sanitizeScenarioText(value, limit = 180) {
    if (value === null || value === undefined)
        return null;
    const text = typeof value === "string" ? value : String(value);
    const normalized = text
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
        .replace(/\b(?:\+?\d[\d\s-]{6,}\d)\b/g, "[redacted]")
        .replace(/(authorization|api[-_]?key|token|secret|password|cookie)\s*[:=]?\s*[^\s,;]+/gi, "$1=[redacted]")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return normalized.length > 0 ? normalized.slice(0, limit) : null;
}
function containsForbiddenScenarioText(value) {
    const text = sanitizeScenarioText(value, 500);
    if (!text)
        return false;
    return /Bearer\s+\[redacted\]|localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|token|secret|password|graph\.facebook|https?:\/\//i.test(text);
}
function maskScenarioWaId(value) {
    return (0, autonomous_loop_1.maskAutonomousLoopWaId)(value);
}
function overrideScenarioMode(value, mode) {
    return { ...value, mode };
}
