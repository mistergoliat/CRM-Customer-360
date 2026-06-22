"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateFollowUpPlan = validateFollowUpPlan;
const constants_1 = require("./constants");
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asText(value) {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === "number" || typeof value === "bigint")
        return String(value);
    return null;
}
function asIso(value) {
    const text = asText(value);
    if (!text)
        return null;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function isOneOf(values, value) {
    return typeof value === "string" && values.includes(value);
}
function normalizeStatus(value) {
    return isOneOf(constants_1.COMMERCIAL_FOLLOW_UP_PLAN_STATUSES, value) ? value : null;
}
function normalizeIntent(value) {
    return isOneOf(constants_1.COMMERCIAL_FOLLOW_UP_INTENTS, value) ? value : null;
}
function normalizeChannel(value) {
    return isOneOf(constants_1.COMMERCIAL_FOLLOW_UP_CHANNELS, value) ? value : null;
}
function normalizeRiskLevel(value) {
    return isOneOf(constants_1.COMMERCIAL_FOLLOW_UP_RISK_LEVELS, value) ? value : null;
}
function normalizeApprovalRequirement(value) {
    return isOneOf(constants_1.COMMERCIAL_FOLLOW_UP_APPROVAL_REQUIREMENTS, value) ? value : null;
}
function normalizeBlockReason(value) {
    return isOneOf(constants_1.COMMERCIAL_FOLLOW_UP_BLOCK_REASONS, value) ? value : null;
}
function normalizeCancelReason(value) {
    return isOneOf(constants_1.COMMERCIAL_FOLLOW_UP_CANCEL_REASONS, value) ? value : null;
}
function uniqueTextArray(value, normalizeItem, maxItems) {
    if (!Array.isArray(value))
        return [];
    const output = [];
    for (const item of value) {
        const text = normalizeItem(item);
        if (text && !output.includes(text)) {
            output.push(text);
        }
        if (output.length >= maxItems)
            break;
    }
    return output;
}
function trimText(value, maxLength) {
    const text = asText(value);
    if (!text)
        return null;
    return text.length > maxLength ? text.slice(0, maxLength) : text;
}
function buildResult(code, valid, reason, value, warnings = []) {
    return {
        valid,
        code,
        reason,
        value,
        warnings: [...new Set(warnings)]
    };
}
function validateFollowUpPlan(value) {
    if (!isRecord(value)) {
        return buildResult("invalid_root", false, "Plan must be an object.", null);
    }
    const planId = asText(value.planId);
    const opportunityId = value.opportunityId === null || value.opportunityId === undefined ? null : asText(value.opportunityId);
    const decisionId = value.decisionId === null || value.decisionId === undefined ? null : asText(value.decisionId);
    const caseId = value.caseId === null || value.caseId === undefined ? null : asText(value.caseId);
    const messageId = value.messageId === null || value.messageId === undefined ? null : asText(value.messageId);
    const status = normalizeStatus(value.status);
    const intent = normalizeIntent(value.intent);
    const channel = normalizeChannel(value.channel);
    const recipient = value.recipient === null || value.recipient === undefined ? null : asText(value.recipient);
    const scheduledFor = value.scheduledFor === null || value.scheduledFor === undefined ? null : asIso(value.scheduledFor);
    const timezone = trimText(value.timezone, 128);
    const draftMessage = value.draftMessage === null || value.draftMessage === undefined ? null : trimText(value.draftMessage, constants_1.COMMERCIAL_FOLLOW_UP_MAX_DRAFT_MESSAGE_LENGTH);
    const riskLevel = normalizeRiskLevel(value.riskLevel);
    const approvalRequirement = normalizeApprovalRequirement(value.approvalRequirement);
    const blockReasons = uniqueTextArray(value.blockReasons, normalizeBlockReason, constants_1.COMMERCIAL_FOLLOW_UP_MAX_BLOCK_REASONS);
    const cancelReason = value.cancelReason === null || value.cancelReason === undefined ? null : normalizeCancelReason(value.cancelReason);
    const rationale = trimText(value.rationale, constants_1.COMMERCIAL_FOLLOW_UP_MAX_RATIONALE_LENGTH);
    const policyNotes = uniqueTextArray(value.policyNotes, asText, constants_1.COMMERCIAL_FOLLOW_UP_MAX_POLICY_NOTES);
    const attemptNumber = typeof value.attemptNumber === "number" && Number.isInteger(value.attemptNumber) && value.attemptNumber >= 0 ? value.attemptNumber : null;
    const maxAttempts = typeof value.maxAttempts === "number" && Number.isInteger(value.maxAttempts) && value.maxAttempts > 0 ? value.maxAttempts : null;
    const idempotencyKey = asText(value.idempotencyKey);
    const createdAt = asIso(value.createdAt);
    if (!planId)
        return buildResult("missing_required_field", false, "planId is required.", null);
    if (!status)
        return buildResult("invalid_enum_value", false, "status is not supported.", null);
    if (!intent)
        return buildResult("invalid_enum_value", false, "intent is not supported.", null);
    if (!channel)
        return buildResult("invalid_enum_value", false, "channel is not supported.", null);
    if (!timezone)
        return buildResult("missing_required_field", false, "timezone is required.", null);
    if (!riskLevel)
        return buildResult("invalid_enum_value", false, "riskLevel is not supported.", null);
    if (!approvalRequirement)
        return buildResult("invalid_enum_value", false, "approvalRequirement is not supported.", null);
    if (!rationale)
        return buildResult("missing_required_field", false, "rationale is required.", null);
    if (attemptNumber === null)
        return buildResult("invalid_number", false, "attemptNumber must be a non-negative integer.", null);
    if (maxAttempts === null)
        return buildResult("invalid_number", false, "maxAttempts must be a positive integer.", null);
    if (!idempotencyKey)
        return buildResult("missing_required_field", false, "idempotencyKey is required.", null);
    if (!createdAt)
        return buildResult("invalid_iso_timestamp", false, "createdAt must be an ISO timestamp.", null);
    if (value.executable !== false)
        return buildResult("invalid_boolean", false, "executable must remain false.", null);
    if (value.persisted !== false)
        return buildResult("invalid_boolean", false, "persisted must remain false.", null);
    if (channel === "whatsapp" && recipient === null && !["blocked", "cancelled", "expired", "invalid"].includes(status)) {
        return buildResult("invalid_invariant", false, "whatsapp plans require a recipient.", null);
    }
    if (draftMessage !== null && draftMessage.length > constants_1.COMMERCIAL_FOLLOW_UP_MAX_DRAFT_MESSAGE_LENGTH) {
        return buildResult("draft_message_too_long", false, "draftMessage is too long.", null);
    }
    if (value.policyNotes?.length && policyNotes.length > constants_1.COMMERCIAL_FOLLOW_UP_MAX_POLICY_NOTES) {
        return buildResult("too_many_policy_notes", false, "policyNotes exceed the allowed limit.", null);
    }
    if (value.blockReasons?.length && blockReasons.length > constants_1.COMMERCIAL_FOLLOW_UP_MAX_BLOCK_REASONS) {
        return buildResult("too_many_block_reasons", false, "blockReasons exceed the allowed limit.", null);
    }
    if (status === "not_needed" && intent !== "no_followup") {
        return buildResult("invalid_invariant", false, "not_needed plans must use no_followup.", null);
    }
    if (status === "cancelled" && cancelReason === null) {
        return buildResult("invalid_invariant", false, "cancelled plans require a cancelReason.", null);
    }
    if ((status === "recommended" || status === "requires_operator_review") && scheduledFor === null) {
        return buildResult("invalid_invariant", false, "planned follow-up statuses require scheduledFor.", null);
    }
    if (status === "blocked" && blockReasons.length === 0) {
        return buildResult("invalid_invariant", false, "blocked plans require at least one blockReason.", null);
    }
    if (status === "blocked" && approvalRequirement !== "blocked") {
        return buildResult("invalid_invariant", false, "blocked plans require approvalRequirement=blocked.", null);
    }
    if (status === "requires_operator_review" && approvalRequirement === "none") {
        return buildResult("invalid_invariant", false, "review plans require a review approvalRequirement.", null);
    }
    if (status === "invalid" && rationale.length === 0) {
        return buildResult("invalid_invariant", false, "invalid plans require a rationale.", null);
    }
    if (attemptNumber > maxAttempts && status !== "blocked" && status !== "expired" && status !== "invalid") {
        return buildResult("invalid_invariant", false, "attemptNumber cannot exceed maxAttempts for active follow-up plans.", null);
    }
    return buildResult("valid", true, "Commercial follow-up plan is structurally valid.", {
        planId,
        opportunityId,
        decisionId,
        caseId,
        messageId,
        status,
        intent,
        channel,
        recipient,
        scheduledFor,
        timezone,
        draftMessage,
        riskLevel,
        approvalRequirement,
        blockReasons,
        cancelReason,
        rationale,
        policyNotes,
        attemptNumber,
        maxAttempts,
        idempotencyKey,
        executable: false,
        persisted: false,
        createdAt
    });
}
