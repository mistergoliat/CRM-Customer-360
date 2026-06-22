"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateAgentAction = validateAgentAction;
const constants_1 = require("./constants");
const serializeAgentAction_1 = require("./serializeAgentAction");
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asText(value) {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === "number" && Number.isFinite(value))
        return String(value);
    if (typeof value === "bigint")
        return value.toString();
    return null;
}
function asIso(value) {
    const text = asText(value);
    if (!text)
        return null;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function asNumber(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
function isOneOf(values, value) {
    return typeof value === "string" && values.includes(value);
}
function asStringArray(value) {
    if (!Array.isArray(value))
        return [];
    const output = [];
    for (const item of value) {
        const text = asText(item);
        if (text && !output.includes(text))
            output.push(text);
    }
    return output;
}
function buildResult(code, valid, reason, action, warnings = []) {
    return {
        valid,
        code,
        reason,
        action,
        warnings: [...new Set(warnings)]
    };
}
function normalizeAction(input) {
    const draftPayload = (0, serializeAgentAction_1.sanitizeAgentActionJsonValue)(input.draftPayload).value ?? null;
    const finalPayload = (0, serializeAgentAction_1.sanitizeAgentActionJsonValue)(input.finalPayload).value ?? null;
    const executionPayload = (0, serializeAgentAction_1.sanitizeAgentActionJsonValue)(input.executionPayload).value ?? null;
    const approvedAt = input.approvedAt ? asIso(input.approvedAt) : null;
    const executedAt = input.executedAt ? asIso(input.executedAt) : null;
    const cancelledAt = input.cancelledAt ? asIso(input.cancelledAt) : null;
    const createdAt = asIso(input.createdAt);
    const updatedAt = input.updatedAt === null || input.updatedAt === undefined ? null : asIso(input.updatedAt);
    return {
        ...input,
        id: typeof input.id === "number" && Number.isFinite(input.id) ? input.id : null,
        opportunityId: input.opportunityId === null ? null : input.opportunityId,
        decisionRowId: typeof input.decisionRowId === "number" && Number.isFinite(input.decisionRowId) ? input.decisionRowId : null,
        conversationCaseId: input.conversationCaseId === null ? null : input.conversationCaseId,
        waId: input.waId === null ? null : asText(input.waId),
        channel: isOneOf(constants_1.COMMERCIAL_AGENT_ACTION_CHANNELS, input.channel) ? input.channel : "unknown",
        actionType: isOneOf(constants_1.COMMERCIAL_AGENT_ACTION_TYPES, input.actionType) ? input.actionType : "no_action",
        status: isOneOf(constants_1.COMMERCIAL_AGENT_ACTION_STATUSES, input.status) ? input.status : "blocked",
        riskLevel: isOneOf(constants_1.COMMERCIAL_AGENT_ACTION_RISK_LEVELS, input.riskLevel) ? input.riskLevel : "unknown",
        approvalRequirement: isOneOf(constants_1.COMMERCIAL_AGENT_ACTION_APPROVAL_REQUIREMENTS, input.approvalRequirement) ? input.approvalRequirement : "blocked",
        draftPayload,
        finalPayload,
        executionPayload,
        draftMessage: input.draftMessage === null ? null : asText(input.draftMessage),
        finalMessage: input.finalMessage === null ? null : asText(input.finalMessage),
        scheduledFor: input.scheduledFor === null ? null : asIso(input.scheduledFor),
        expiresAt: input.expiresAt === null ? null : asIso(input.expiresAt),
        attemptNumber: Math.max(1, Math.floor(asNumber(input.attemptNumber) ?? 1)),
        maxAttempts: Math.max(1, Math.floor(asNumber(input.maxAttempts) ?? 1)),
        blockReasons: asStringArray(input.blockReasons),
        cancelReason: input.cancelReason === null ? null : asText(input.cancelReason),
        failureReason: input.failureReason === null ? null : asText(input.failureReason),
        policyStatus: asText(input.policyStatus) ?? "unknown",
        policyNotes: asStringArray(input.policyNotes),
        source: input.source === "operator" || input.source === "system" ? input.source : "ai_sdr",
        createdBy: input.createdBy === "operator" || input.createdBy === "system" ? input.createdBy : "ai",
        approvedBy: input.approvedBy === null ? null : asText(input.approvedBy),
        approvedAt,
        executedAt,
        cancelledAt,
        outboxMessageId: typeof input.outboxMessageId === "number" && Number.isFinite(input.outboxMessageId) ? input.outboxMessageId : null,
        lifecycleVersion: input.lifecycleVersion === null ? null : asText(input.lifecycleVersion),
        policyVersion: input.policyVersion === null ? null : asText(input.policyVersion),
        runtimeVersion: input.runtimeVersion === null ? null : asText(input.runtimeVersion),
        createdAt,
        updatedAt
    };
}
function validateAgentAction(value) {
    if (!isRecord(value)) {
        return buildResult("invalid_root", false, "Action must be an object.", null);
    }
    const rawActionType = asText(value.actionType);
    const rawStatus = asText(value.status);
    const rawRiskLevel = asText(value.riskLevel);
    const rawApprovalRequirement = asText(value.approvalRequirement);
    const rawChannel = asText(value.channel);
    const warnings = [];
    if (!value.actionId || !asText(value.actionId))
        return buildResult("missing_required_field", false, "actionId is required.", null);
    if (!value.idempotencyKey || !asText(value.idempotencyKey))
        return buildResult("missing_required_field", false, "idempotencyKey is required.", null);
    if (!isOneOf(constants_1.COMMERCIAL_AGENT_ACTION_TYPES, rawActionType))
        return buildResult("invalid_enum_value", false, "actionType is not supported.", null);
    if (!isOneOf(constants_1.COMMERCIAL_AGENT_ACTION_STATUSES, rawStatus))
        return buildResult("invalid_enum_value", false, "status is not supported.", null);
    if (!isOneOf(constants_1.COMMERCIAL_AGENT_ACTION_RISK_LEVELS, rawRiskLevel))
        return buildResult("invalid_enum_value", false, "riskLevel is not supported.", null);
    if (!isOneOf(constants_1.COMMERCIAL_AGENT_ACTION_APPROVAL_REQUIREMENTS, rawApprovalRequirement))
        return buildResult("invalid_enum_value", false, "approvalRequirement is not supported.", null);
    if (!isOneOf(constants_1.COMMERCIAL_AGENT_ACTION_CHANNELS, rawChannel))
        return buildResult("invalid_channel", false, "channel is not supported.", null);
    const action = normalizeAction(value);
    if (!action.createdAt)
        return buildResult("invalid_iso_timestamp", false, "createdAt must be an ISO timestamp.", null);
    if (action.updatedAt !== null && action.updatedAt !== undefined && !action.updatedAt)
        return buildResult("invalid_iso_timestamp", false, "updatedAt must be null or an ISO timestamp.", null);
    if (action.actionType === "send_whatsapp_reply" && action.channel === "whatsapp" && !action.waId && !["blocked", "cancelled", "expired", "failed", "rejected"].includes(action.status)) {
        return buildResult("invalid_channel", false, "WhatsApp actions require waId unless they are blocked.", null);
    }
    if (action.status === "scheduled" && !action.scheduledFor)
        return buildResult("invalid_state", false, "scheduled actions require scheduledFor.", null);
    if (action.status === "approved" && !action.approvedAt)
        return buildResult("invalid_state", false, "approved actions require approvedAt.", null);
    if (action.executedAt && action.status !== "executed")
        return buildResult("execution_not_enabled_in_p1k_012a", false, "executedAt is not allowed before execution is enabled.", null);
    if (action.cancelledAt && action.status !== "cancelled")
        return buildResult("invalid_state", false, "cancelledAt is only allowed for cancelled actions.", null);
    if (action.outboxMessageId !== null)
        return buildResult("outbox_not_allowed", false, "outboxMessageId is not allowed in P1K-012A.", null);
    if (constants_1.COMMERCIAL_AGENT_ACTION_QUEUE_EXECUTION_BLOCKED_STATUSES.includes(action.status)) {
        return buildResult("execution_not_enabled_in_p1k_012a", false, "Execution is not enabled in P1K-012A.", null);
    }
    if (action.approvalRequirement === "blocked" && action.status !== "blocked") {
        return buildResult("invalid_state", false, "Blocked approvals require blocked status.", null);
    }
    if (action.approvedAt && action.updatedAt && new Date(action.approvedAt).getTime() > new Date(action.updatedAt).getTime()) {
        warnings.push("approved_at_after_updated_at");
    }
    return buildResult("valid", true, "Action is structurally valid.", action, warnings);
}
