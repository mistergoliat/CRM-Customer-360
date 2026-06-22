"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateAutonomousReplyCandidate = validateAutonomousReplyCandidate;
const types_1 = require("./types");
const parseWhitelist_1 = require("./parseWhitelist");
const CLOSED_CASE_STATUSES = new Set(["closed", "resolved", "done", "cancelled", "expired", "archived", "finalized"]);
const BLOCKED_STATUSES = new Set(["blocked", "cancelled", "failed", "executed", "rejected", "draft", "executing"]);
const REVIEW_STATUSES = new Set(["requires_review"]);
const ALLOWED_STATUSES = new Set(["proposed", "approved", "edited", "requires_review", "planned", "scheduled"]);
function asIso(value) {
    if (value === null || value === undefined)
        return null;
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function asText(value) {
    if (value === null || value === undefined)
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function normalizeText(value) {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}
function isJsonLike(text) {
    const trimmed = text.trim();
    if (!trimmed)
        return false;
    if (!((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))))
        return false;
    try {
        const parsed = JSON.parse(trimmed);
        return typeof parsed === "object" && parsed !== null;
    }
    catch {
        return false;
    }
}
function hasUnresolvedPlaceholder(text) {
    return /(\{\{[^{}]+\}\}|\[\[[^\[\]]+\]\]|\$\{[^{}]+\}|<%[^%]+%>)/.test(text);
}
function hasCredentialMarker(text) {
    return /(\bBearer\b|\bsk-[A-Za-z0-9_-]+\b|\b(api[-_]?key|token|secret|password|cookie|authorization)\b)/i.test(text);
}
function hasPromiseOrSensitiveCommercialClaim(text) {
    const normalized = normalizeText(text);
    const sensitiveTerms = ["precio", "stock", "descuento", "entrega", "despacho", "garantia", "reclamo", "queja", "reembolso", "devolucion"];
    const promiseTerms = ["promet", "garantiz", "asegur", "confirm", "aseguro", "aseguramos", "te damos", "te garantizo"];
    return sensitiveTerms.some((term) => normalized.includes(term)) || promiseTerms.some((term) => normalized.includes(term));
}
function buildMessageSafety(input) {
    const candidate = asText(input.action.finalMessage) ?? asText(input.action.draftMessage);
    const fallback = candidate ?? null;
    const reasons = [];
    if (!fallback) {
        reasons.push("unsafe_message");
        return { reasons, messagePreview: null };
    }
    if (fallback.length > types_1.COMMERCIAL_SANDBOX_AUTONOMY_DEFAULT_MESSAGE_LIMIT) {
        reasons.push("unsafe_message");
        return { reasons, messagePreview: null };
    }
    if (hasUnresolvedPlaceholder(fallback)) {
        reasons.push("unsafe_payload");
        return { reasons, messagePreview: null };
    }
    if (hasCredentialMarker(fallback)) {
        reasons.push("unsafe_payload");
        return { reasons, messagePreview: null };
    }
    if (isJsonLike(fallback)) {
        reasons.push("unsafe_payload");
        return { reasons, messagePreview: null };
    }
    if (hasPromiseOrSensitiveCommercialClaim(fallback)) {
        reasons.push("unsafe_message");
        return { reasons, messagePreview: null };
    }
    return { reasons, messagePreview: fallback.trim() };
}
function uniqueReasons(reasons) {
    return [...new Set(reasons)];
}
function buildStatus(disabledReasons, invalidReasons, expiredReasons, blockedReasons, reviewReasons) {
    if (disabledReasons.length > 0)
        return "disabled";
    if (invalidReasons.length > 0)
        return "invalid";
    if (expiredReasons.length > 0)
        return "expired";
    if (blockedReasons.length > 0)
        return "blocked";
    if (reviewReasons.length > 0)
        return "requires_review";
    return "eligible";
}
function validateAutonomousReplyCandidate(input) {
    const evaluatedAt = asIso(input.now);
    const whitelistedWaIds = (0, parseWhitelist_1.parseAutonomousTestWaIds)(input.config.whitelistedWaIds.join(","));
    const disabledReasons = [];
    const invalidReasons = [];
    const expiredReasons = [];
    const blockedReasons = [];
    const reviewReasons = [];
    const warnings = [];
    if (!input.config.sandboxEnabled)
        disabledReasons.push("sandbox_disabled");
    if (!input.config.autonomousReplyEnabled)
        disabledReasons.push("autonomous_reply_disabled");
    const recipientDigits = (0, types_1.normalizeWaIdDigits)(input.action.waId);
    const recipientMasked = (0, types_1.maskWaId)(recipientDigits);
    if (!recipientDigits) {
        invalidReasons.push("missing_recipient");
    }
    else if (!whitelistedWaIds.includes(recipientDigits)) {
        blockedReasons.push("recipient_not_whitelisted");
    }
    if (input.action.channel.trim().toLowerCase() !== types_1.COMMERCIAL_SANDBOX_AUTONOMY_ALLOWED_CHANNEL) {
        blockedReasons.push("unsupported_channel");
    }
    const actionType = asText(input.action.actionType) ?? "";
    const allowedActionTypes = new Set(input.config.allowedActionTypes
        .map((value) => value.trim())
        .filter((value) => Boolean(value) && types_1.COMMERCIAL_SANDBOX_AUTONOMY_ALLOWED_ACTION_TYPES.includes(value)));
    if (!allowedActionTypes.has(actionType)) {
        blockedReasons.push("unsupported_action_type");
    }
    const normalizedStatus = asText(input.action.status)?.toLowerCase() ?? "";
    if (!normalizedStatus || (!ALLOWED_STATUSES.has(normalizedStatus) && !BLOCKED_STATUSES.has(normalizedStatus) && !REVIEW_STATUSES.has(normalizedStatus))) {
        blockedReasons.push("action_not_ready");
    }
    else if (BLOCKED_STATUSES.has(normalizedStatus) || normalizedStatus === "scheduled") {
        blockedReasons.push("action_not_ready");
    }
    else if (normalizedStatus === "requires_review") {
        reviewReasons.push("approval_required");
    }
    const scheduledFor = asIso(input.action.scheduledFor);
    if (scheduledFor && evaluatedAt && new Date(scheduledFor).getTime() > new Date(evaluatedAt).getTime()) {
        blockedReasons.push("action_not_ready");
    }
    const expiresAt = asIso(input.action.expiresAt);
    if (normalizedStatus === "expired" || (expiresAt && evaluatedAt && new Date(expiresAt).getTime() <= new Date(evaluatedAt).getTime())) {
        expiredReasons.push("action_expired");
    }
    if (input.config.maxRiskLevel.trim().toLowerCase() !== types_1.COMMERCIAL_SANDBOX_AUTONOMY_ALLOWED_RISK_LEVEL) {
        invalidReasons.push("policy_blocked");
    }
    else if (input.action.riskLevel.trim().toLowerCase() !== types_1.COMMERCIAL_SANDBOX_AUTONOMY_ALLOWED_RISK_LEVEL) {
        blockedReasons.push("risk_too_high");
    }
    const approvalRequirement = asText(input.action.approvalRequirement)?.toLowerCase() ?? "blocked";
    if (approvalRequirement === "blocked") {
        blockedReasons.push("approval_required");
    }
    else if (approvalRequirement !== "none") {
        reviewReasons.push("approval_required");
    }
    if (input.context.humanOwnerActive || input.context.requiresHuman) {
        blockedReasons.push("human_owner_active");
    }
    if (input.context.aiBlocked) {
        blockedReasons.push("ai_blocked");
    }
    if (input.context.caseStatus && CLOSED_CASE_STATUSES.has(normalizeText(input.context.caseStatus))) {
        blockedReasons.push("case_closed");
    }
    else if (input.context.lifecycleStatus && CLOSED_CASE_STATUSES.has(normalizeText(input.context.lifecycleStatus))) {
        blockedReasons.push("case_closed");
    }
    const policyStatus = asText(input.context.policyStatus)?.toLowerCase();
    if (policyStatus === "blocked" || policyStatus === "failed_safe" || policyStatus === "failed") {
        blockedReasons.push("policy_blocked");
    }
    else if (policyStatus === "requires_review") {
        reviewReasons.push("approval_required");
    }
    else if (policyStatus && policyStatus !== "allowed" && policyStatus !== "allowed_with_restrictions") {
        blockedReasons.push("policy_blocked");
    }
    const idempotencyKey = asText(input.action.idempotencyKey);
    if (!idempotencyKey) {
        blockedReasons.push("missing_idempotency_key");
    }
    const messageSafety = buildMessageSafety(input);
    if (messageSafety.reasons.length > 0) {
        blockedReasons.push(...messageSafety.reasons);
    }
    const sourceBlockReasons = new Set(input.action.blockReasons.map((reason) => reason.trim().toLowerCase()));
    if (sourceBlockReasons.has("duplicate") || sourceBlockReasons.has("conflict") || sourceBlockReasons.has("duplicate_or_conflicting_action")) {
        blockedReasons.push("duplicate_or_conflicting_action");
    }
    if (input.context.conflictingActionExists) {
        blockedReasons.push("duplicate_or_conflicting_action");
    }
    const status = buildStatus(disabledReasons, invalidReasons, expiredReasons, blockedReasons, reviewReasons);
    if (status === "eligible") {
        warnings.push("sandbox_autonomy_preview_only");
    }
    return {
        status,
        eligible: status === "eligible",
        actionId: input.action.actionId,
        recipientMasked,
        blockReasons: uniqueReasons([...disabledReasons, ...invalidReasons, ...expiredReasons, ...blockedReasons, ...reviewReasons]),
        warnings: [...new Set(warnings)],
        actionType,
        riskLevel: input.action.riskLevel,
        approvalRequirement,
        messagePreview: messageSafety.messagePreview,
        evaluatedAt: evaluatedAt ?? input.now
    };
}
