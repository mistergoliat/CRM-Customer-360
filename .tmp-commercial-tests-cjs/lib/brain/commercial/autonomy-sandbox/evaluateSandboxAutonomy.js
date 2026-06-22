"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateSandboxAutonomy = evaluateSandboxAutonomy;
exports.evaluateAgentActionForSandbox = evaluateAgentActionForSandbox;
const buildSandboxExecutionPreview_1 = require("./buildSandboxExecutionPreview");
const validateAutonomousReplyCandidate_1 = require("./validateAutonomousReplyCandidate");
function readString(value) {
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
function toEvaluationInput(action, context, config) {
    return {
        now: context.now,
        config: {
            sandboxEnabled: config.sandboxEnabled,
            autonomousReplyEnabled: config.autonomousReplyEnabled,
            whitelistedWaIds: [...config.whitelistedWaIds],
            allowedActionTypes: [...config.allowedActionTypes],
            maxRiskLevel: config.maxRiskLevel
        },
        action: {
            actionId: action.actionId,
            idempotencyKey: readString(action.idempotencyKey),
            actionType: action.actionType,
            status: action.status,
            channel: action.channel,
            waId: readString(action.waId),
            riskLevel: action.riskLevel,
            approvalRequirement: action.approvalRequirement,
            draftMessage: readString(action.draftMessage),
            finalMessage: readString(action.finalMessage),
            scheduledFor: readString(action.scheduledFor),
            expiresAt: readString(action.expiresAt),
            blockReasons: Array.isArray(action.blockReasons) ? [...action.blockReasons] : [],
            cancelReason: readString(action.cancelReason)
        },
        context: {
            caseId: context.caseId,
            caseStatus: context.caseStatus,
            lifecycleStatus: context.lifecycleStatus,
            humanOwnerActive: context.humanOwnerActive,
            aiBlocked: context.aiBlocked,
            requiresHuman: context.requiresHuman,
            policyStatus: context.policyStatus,
            conflictingActionExists: context.conflictingActionExists
        }
    };
}
function evaluateSandboxAutonomy(input) {
    const validation = (0, validateAutonomousReplyCandidate_1.validateAutonomousReplyCandidate)(input);
    return {
        status: validation.status,
        eligible: validation.eligible,
        actionId: validation.actionId,
        recipientMasked: validation.recipientMasked,
        blockReasons: [...validation.blockReasons],
        warnings: [...validation.warnings],
        actionType: validation.actionType,
        riskLevel: validation.riskLevel,
        approvalRequirement: validation.approvalRequirement,
        executionPreview: (0, buildSandboxExecutionPreview_1.buildSandboxExecutionPreview)(input, validation),
        evaluatedAt: validation.evaluatedAt
    };
}
function evaluateAgentActionForSandbox(action, context, config) {
    return evaluateSandboxAutonomy(toEvaluationInput(action, context, config));
}
