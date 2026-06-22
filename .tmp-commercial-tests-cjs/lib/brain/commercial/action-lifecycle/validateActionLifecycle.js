"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateCommercialProposedAction = validateCommercialProposedAction;
exports.validateCommercialOperatorReviewDraft = validateCommercialOperatorReviewDraft;
exports.validateCommercialExecutableCommandPreview = validateCommercialExecutableCommandPreview;
exports.validateCommercialActionDecision = validateCommercialActionDecision;
exports.validateActionLifecycleTransition = validateActionLifecycleTransition;
const adapters_1 = require("../context/adapters");
const constants_1 = require("./constants");
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
function asIsoString(value) {
    const text = asText(value);
    if (!text)
        return null;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function asStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return [...new Set(value.map((item) => asText(item)).filter((item) => Boolean(item)))];
}
function isOneOf(values, value) {
    return typeof value === "string" && values.includes(value);
}
function normalizeChannel(value) {
    if (isOneOf(constants_1.COMMERCIAL_ACTION_CHANNELS, value))
        return value;
    return null;
}
function normalizeActionType(value) {
    if (isOneOf(constants_1.COMMERCIAL_ACTION_TYPES, value))
        return value;
    return null;
}
function normalizeStatus(value) {
    if (isOneOf(constants_1.COMMERCIAL_ACTION_STATUSES, value))
        return value;
    return null;
}
function normalizeRiskLevel(value) {
    if (isOneOf(constants_1.COMMERCIAL_ACTION_RISK_LEVELS, value))
        return value;
    return null;
}
function normalizeApprovalRequirement(value) {
    if (isOneOf(constants_1.COMMERCIAL_ACTION_APPROVAL_REQUIREMENTS, value))
        return value;
    return null;
}
function normalizeReviewDecision(value) {
    if (isOneOf(constants_1.OPERATOR_REVIEW_DECISIONS, value))
        return value;
    return null;
}
function buildValidationResult(code, allowed, reason, input) {
    return {
        allowed,
        code,
        reason,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        actionType: input.actionType,
        reviewDecision: input.reviewDecision,
        blockedReasons: [...new Set(input.blockedReasons)],
        warnings: [...new Set(input.warnings)],
        executionNotEnabled: input.executionNotEnabled,
        checkedAt: input.checkedAt,
        metadata: input.metadata
    };
}
function normalizeMetadata(metadata) {
    const sanitized = (0, adapters_1.sanitizeCommercialObject)(metadata ?? {});
    return sanitized.value ?? {};
}
function normalizeCurrentTime(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}
function isTerminalStatus(status) {
    return constants_1.COMMERCIAL_ACTION_TERMINAL_STATUSES.includes(status);
}
function isExecutionStatus(status) {
    return constants_1.COMMERCIAL_ACTION_EXECUTION_STATUSES.includes(status);
}
function normalizeTransitionKey(fromStatus, toStatus) {
    return `${fromStatus}->${toStatus}`;
}
function validateCommercialProposedAction(value) {
    if (!isRecord(value)) {
        return { valid: false, code: "invalid_root", reason: "Root value must be an object.", value: null, warnings: [] };
    }
    const actionId = asText(value.actionId);
    const type = normalizeActionType(value.type);
    const status = normalizeStatus(value.status);
    const channel = normalizeChannel(value.channel);
    const riskLevel = normalizeRiskLevel(value.riskLevel);
    const approvalRequirement = normalizeApprovalRequirement(value.approvalRequirement);
    const decisionId = value.decisionId === null || value.decisionId === undefined ? null : asText(value.decisionId);
    const opportunityId = value.opportunityId === null || value.opportunityId === undefined ? null : asText(value.opportunityId);
    const caseId = value.caseId === null || value.caseId === undefined ? null : asText(value.caseId);
    const messageId = value.messageId === null || value.messageId === undefined ? null : asText(value.messageId);
    const reason = asText(value.reason);
    const idempotencyKey = asText(value.idempotencyKey);
    const createdAt = asIsoString(value.createdAt);
    const updatedAt = value.updatedAt === null || value.updatedAt === undefined ? null : asIsoString(value.updatedAt);
    const blockedReasons = asStringArray(value.blockedReasons);
    const draftPayload = value.draftPayload;
    const finalPayload = value.finalPayload ?? null;
    if (!actionId)
        return { valid: false, code: "invalid_identifier", reason: "actionId is required.", value: null, warnings: [] };
    if (!type)
        return { valid: false, code: "invalid_action_type", reason: "type is not supported.", value: null, warnings: [] };
    if (!status)
        return { valid: false, code: "invalid_status", reason: "status is not supported.", value: null, warnings: [] };
    if (!channel)
        return { valid: false, code: "invalid_channel", reason: "channel is not supported.", value: null, warnings: [] };
    if (!riskLevel)
        return { valid: false, code: "invalid_root", reason: "riskLevel is not supported.", value: null, warnings: [] };
    if (!approvalRequirement)
        return { valid: false, code: "invalid_root", reason: "approvalRequirement is not supported.", value: null, warnings: [] };
    if (!idempotencyKey)
        return { valid: false, code: "missing_idempotency_key", reason: "idempotencyKey is required.", value: null, warnings: [] };
    if (!reason)
        return { valid: false, code: "invalid_root", reason: "reason is required.", value: null, warnings: [] };
    if (!createdAt)
        return { valid: false, code: "invalid_root", reason: "createdAt must be an ISO timestamp.", value: null, warnings: [] };
    if (updatedAt === undefined)
        return { valid: false, code: "invalid_root", reason: "updatedAt must be null or an ISO timestamp.", value: null, warnings: [] };
    if (value.executable !== false)
        return { valid: false, code: "invalid_root", reason: "executable must remain false.", value: null, warnings: [] };
    return {
        valid: true,
        code: "valid",
        reason: "Commercial proposed action is structurally valid.",
        value: {
            actionId,
            decisionId,
            opportunityId,
            caseId,
            messageId,
            type,
            status,
            channel,
            riskLevel,
            approvalRequirement,
            draftPayload,
            finalPayload,
            reason,
            blockedReasons,
            idempotencyKey,
            executable: false,
            createdAt,
            updatedAt
        },
        warnings: []
    };
}
function validateCommercialOperatorReviewDraft(value) {
    if (!isRecord(value)) {
        return { valid: false, code: "invalid_root", reason: "Root value must be an object.", value: null, warnings: [] };
    }
    const reviewId = asText(value.reviewId);
    const actionId = asText(value.actionId);
    const decision = normalizeReviewDecision(value.decision);
    const createdAt = asIsoString(value.createdAt);
    const editedPayload = value.editedPayload ?? null;
    const comment = value.comment === null || value.comment === undefined ? null : asText(value.comment);
    const reviewerId = value.reviewerId === null || value.reviewerId === undefined ? null : asText(value.reviewerId);
    if (!reviewId)
        return { valid: false, code: "invalid_identifier", reason: "reviewId is required.", value: null, warnings: [] };
    if (!actionId)
        return { valid: false, code: "invalid_identifier", reason: "actionId is required.", value: null, warnings: [] };
    if (!decision)
        return { valid: false, code: "invalid_review_decision", reason: "decision is not supported.", value: null, warnings: [] };
    if (!createdAt)
        return { valid: false, code: "invalid_root", reason: "createdAt must be an ISO timestamp.", value: null, warnings: [] };
    if (value.persisted !== false)
        return { valid: false, code: "invalid_root", reason: "persisted must remain false.", value: null, warnings: [] };
    return {
        valid: true,
        code: "valid",
        reason: "Commercial operator review draft is structurally valid.",
        value: {
            reviewId,
            actionId,
            decision,
            editedPayload,
            comment,
            reviewerId,
            createdAt,
            persisted: false
        },
        warnings: []
    };
}
function validateCommercialExecutableCommandPreview(value) {
    if (!isRecord(value)) {
        return { valid: false, code: "invalid_root", reason: "Root value must be an object.", value: null, warnings: [] };
    }
    const commandId = asText(value.commandId);
    const actionId = asText(value.actionId);
    const commandType = asText(value.commandType);
    const payloadPreview = value.payloadPreview;
    const target = isRecord(value.target) ? value.target : null;
    const targetChannel = target ? asText(target.channel) : null;
    const recipient = target ? (target.recipient === null || target.recipient === undefined ? null : asText(target.recipient)) : null;
    const blockedReasons = asStringArray(value.blockedReasons);
    if (!commandId)
        return { valid: false, code: "invalid_identifier", reason: "commandId is required.", value: null, warnings: [] };
    if (!actionId)
        return { valid: false, code: "invalid_identifier", reason: "actionId is required.", value: null, warnings: [] };
    if (!commandType)
        return { valid: false, code: "invalid_root", reason: "commandType is required.", value: null, warnings: [] };
    if (!targetChannel)
        return { valid: false, code: "invalid_channel", reason: "target.channel is required.", value: null, warnings: [] };
    if (value.canExecute !== false)
        return { valid: false, code: "invalid_root", reason: "canExecute must remain false.", value: null, warnings: [] };
    return {
        valid: true,
        code: "valid",
        reason: "Commercial executable command preview is structurally valid.",
        value: {
            commandId,
            actionId,
            commandType,
            payloadPreview,
            target: {
                channel: targetChannel,
                recipient
            },
            canExecute: false,
            blockedReasons
        },
        warnings: []
    };
}
function validateCommercialActionDecision(value) {
    if (!isRecord(value)) {
        return { valid: false, code: "invalid_root", reason: "Root value must be an object.", value: null, warnings: [] };
    }
    const decisionId = asText(value.decisionId);
    const opportunityId = value.opportunityId === null || value.opportunityId === undefined ? null : asText(value.opportunityId);
    const caseId = value.caseId === null || value.caseId === undefined ? null : asText(value.caseId);
    const messageId = value.messageId === null || value.messageId === undefined ? null : asText(value.messageId);
    const rationale = asText(value.rationale);
    const createdAt = asIsoString(value.createdAt);
    const nextActionResult = validateCommercialProposedAction(value.nextAction);
    if (!decisionId)
        return { valid: false, code: "invalid_identifier", reason: "decisionId is required.", value: null, warnings: [] };
    if (!rationale)
        return { valid: false, code: "invalid_root", reason: "rationale is required.", value: null, warnings: [] };
    if (!createdAt)
        return { valid: false, code: "invalid_root", reason: "createdAt must be an ISO timestamp.", value: null, warnings: [] };
    if (!nextActionResult.valid || !nextActionResult.value) {
        return { valid: false, code: nextActionResult.code, reason: nextActionResult.reason, value: null, warnings: nextActionResult.warnings };
    }
    return {
        valid: true,
        code: "valid",
        reason: "Commercial action decision is structurally valid.",
        value: {
            decisionId,
            opportunityId,
            caseId,
            messageId,
            nextAction: {
                ...nextActionResult.value,
                executable: false
            },
            rationale,
            createdAt
        },
        warnings: []
    };
}
function validateActionLifecycleTransition(input) {
    const checkedAt = normalizeCurrentTime(input.currentTime);
    const metadata = normalizeMetadata(input.metadata);
    const statusFrom = normalizeStatus(input.fromStatus);
    const statusTo = normalizeStatus(input.toStatus);
    const actionType = normalizeActionType(input.actionType);
    const reviewDecision = normalizeReviewDecision(input.reviewDecision);
    if (!statusFrom || !statusTo) {
        return buildValidationResult("invalid_status", false, "fromStatus or toStatus is not supported.", {
            fromStatus: statusFrom,
            toStatus: statusTo,
            actionType,
            reviewDecision,
            blockedReasons: ["invalid_status"],
            warnings: [],
            executionNotEnabled: true,
            checkedAt,
            metadata
        });
    }
    if (actionType === null && input.actionType !== undefined && input.actionType !== null) {
        return buildValidationResult("invalid_action_type", false, "actionType is not supported.", {
            fromStatus: statusFrom,
            toStatus: statusTo,
            actionType,
            reviewDecision,
            blockedReasons: ["invalid_action_type"],
            warnings: [],
            executionNotEnabled: true,
            checkedAt,
            metadata
        });
    }
    if (input.reviewDecision !== undefined && input.reviewDecision !== null && reviewDecision === null) {
        return buildValidationResult("invalid_review_decision", false, "reviewDecision is not supported.", {
            fromStatus: statusFrom,
            toStatus: statusTo,
            actionType,
            reviewDecision,
            blockedReasons: ["invalid_review_decision"],
            warnings: [],
            executionNotEnabled: true,
            checkedAt,
            metadata
        });
    }
    if (isTerminalStatus(statusFrom) && statusFrom !== statusTo) {
        return buildValidationResult("terminal_status_protected", false, "Terminal statuses are protected and cannot transition.", {
            fromStatus: statusFrom,
            toStatus: statusTo,
            actionType,
            reviewDecision,
            blockedReasons: ["terminal_status_protected"],
            warnings: [],
            executionNotEnabled: true,
            checkedAt,
            metadata
        });
    }
    const transitionKey = normalizeTransitionKey(statusFrom, statusTo);
    if (constants_1.COMMERCIAL_ACTION_LIFECYCLE_ALLOWED_TRANSITIONS.includes(transitionKey)) {
        return buildValidationResult("valid", true, "Transition is allowed.", {
            fromStatus: statusFrom,
            toStatus: statusTo,
            actionType,
            reviewDecision,
            blockedReasons: [],
            warnings: [],
            executionNotEnabled: false,
            checkedAt,
            metadata
        });
    }
    if (isExecutionStatus(statusTo)) {
        return buildValidationResult("execution_not_enabled_in_p1k_011a", false, "execution_not_enabled_in_p1k_011a", {
            fromStatus: statusFrom,
            toStatus: statusTo,
            actionType,
            reviewDecision,
            blockedReasons: ["execution_not_enabled_in_p1k_011a"],
            warnings: [],
            executionNotEnabled: true,
            checkedAt,
            metadata
        });
    }
    return buildValidationResult("invalid_transition", false, "Transition is not allowed.", {
        fromStatus: statusFrom,
        toStatus: statusTo,
        actionType,
        reviewDecision,
        blockedReasons: ["invalid_transition"],
        warnings: [],
        executionNotEnabled: false,
        checkedAt,
        metadata
    });
}
