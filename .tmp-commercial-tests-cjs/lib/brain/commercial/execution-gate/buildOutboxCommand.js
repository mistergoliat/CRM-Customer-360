"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildOutboxCommand = buildOutboxCommand;
const constants_1 = require("./constants");
const autonomy_sandbox_1 = require("../autonomy-sandbox");
function asText(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function buildOutboxCommand(input) {
    const recipient = (0, autonomy_sandbox_1.normalizeWaIdDigits)(input.action.waId);
    const messageText = asText(input.action.finalMessage) ?? asText(input.action.draftMessage);
    const idempotencyKey = asText(input.action.idempotencyKey);
    if (!recipient) {
        throw new Error("missing recipient for outbox command");
    }
    if (!messageText) {
        throw new Error("missing message for outbox command");
    }
    if (!idempotencyKey) {
        throw new Error("missing idempotency key for outbox command");
    }
    const commandId = `outbox:action:${input.action.actionId}:${idempotencyKey}`;
    return {
        commandId,
        idempotencyKey: commandId,
        actionId: input.action.actionId,
        opportunityId: input.action.opportunityId,
        decisionId: input.action.decisionId,
        conversationCaseId: input.action.conversationCaseId,
        channel: constants_1.EXECUTION_GATE_SUPPORTED_CHANNEL,
        commandType: constants_1.EXECUTION_GATE_SUPPORTED_COMMAND_TYPE,
        recipient,
        messageText,
        metadata: {
            source: "ai_sdr",
            sandbox: true,
            riskLevel: input.action.riskLevel,
            approvalRequirement: input.action.approvalRequirement,
            lifecycleVersion: input.action.lifecycleVersion ?? null,
            policyVersion: input.action.policyVersion ?? null,
            runtimeVersion: input.action.runtimeVersion ?? null
        },
        createdAt: input.evaluatedAt
    };
}
