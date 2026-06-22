"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeActionThroughGate = executeActionThroughGate;
const buildOutboxCommand_1 = require("./buildOutboxCommand");
const evaluateExecutionGate_1 = require("./evaluateExecutionGate");
const constants_1 = require("./constants");
function zeroRepositoryResult() {
    return {
        actionUpdated: false,
        outboxInserted: false,
        duplicateDetected: false,
        actionRowId: null,
        outboxRowId: null
    };
}
function buildResult(evaluatedAt, actionId, evaluation, outboxCommand, repositoryResult, status = evaluation.status, blockReasons = evaluation.blockReasons, warnings = evaluation.warnings) {
    return {
        status,
        allowed: status === "allowed",
        actionId,
        outboxCommand,
        blockReasons: [...blockReasons],
        warnings: [...warnings],
        repositoryResult,
        sideEffects: {
            messageSent: false,
            metaCalled: false,
            workerTriggered: false
        },
        evaluatedAt
    };
}
function asText(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function isReadyToPlan(status) {
    return status === "approved" || status === "planned" || status === "proposed";
}
function mapRepositoryFailure(evaluatedAt, actionId, evaluation, error) {
    const message = error instanceof Error ? error.message : String(error);
    const transactionFailure = /commit|rollback|transaction/i.test(message);
    return buildResult(evaluatedAt, actionId, evaluation, null, zeroRepositoryResult(), "failed", [transactionFailure ? "transaction_failure" : "repository_failure"], [...evaluation.warnings, message]);
}
async function executeActionThroughGate(input, dependencies) {
    const evaluation = (0, evaluateExecutionGate_1.evaluateExecutionGate)(input);
    const evaluatedAt = input.now;
    const actionId = asText(input.action.actionId) ?? input.action.actionId;
    if (evaluation.status !== "allowed") {
        const status = evaluation.status;
        const outboxCommand = status === "duplicate" ? (0, buildOutboxCommand_1.buildOutboxCommand)({ action: input.action, evaluatedAt }) : null;
        return buildResult(evaluatedAt, actionId, evaluation, outboxCommand, zeroRepositoryResult(), status, evaluation.blockReasons, evaluation.warnings);
    }
    try {
        return await dependencies.unitOfWork.run(async ({ agentActions, outbox }) => {
            const [byActionId, byIdempotencyKey] = await Promise.all([
                agentActions.findByActionId(input.action.actionId),
                agentActions.findByIdempotencyKey(input.action.idempotencyKey)
            ]);
            const persistedAction = byActionId ?? byIdempotencyKey;
            if (!persistedAction) {
                return buildResult(evaluatedAt, actionId, evaluation, null, zeroRepositoryResult(), "invalid", ["action_not_found"], evaluation.warnings);
            }
            if (byIdempotencyKey && byActionId && byIdempotencyKey.actionId !== byActionId.actionId) {
                return buildResult(evaluatedAt, actionId, evaluation, null, {
                    actionUpdated: false,
                    outboxInserted: false,
                    duplicateDetected: true,
                    actionRowId: byActionId.id ?? null,
                    outboxRowId: null
                }, "duplicate", ["duplicate_execution"], evaluation.warnings);
            }
            if (byIdempotencyKey && !byActionId && byIdempotencyKey.actionId !== input.action.actionId) {
                return buildResult(evaluatedAt, actionId, evaluation, null, {
                    actionUpdated: false,
                    outboxInserted: false,
                    duplicateDetected: true,
                    actionRowId: byIdempotencyKey.id ?? null,
                    outboxRowId: null
                }, "duplicate", ["duplicate_execution"], evaluation.warnings);
            }
            if (!isReadyToPlan(persistedAction.status)) {
                return buildResult(evaluatedAt, actionId, evaluation, null, zeroRepositoryResult(), "blocked", ["invalid_lifecycle_transition"], evaluation.warnings);
            }
            const outboxCommand = (0, buildOutboxCommand_1.buildOutboxCommand)({
                action: persistedAction,
                evaluatedAt
            });
            const existingOutbox = await outbox.findByIdempotencyKey(outboxCommand.idempotencyKey);
            const duplicateDetected = Boolean(existingOutbox) || persistedAction.outboxMessageId !== null;
            const repositoryResult = {
                actionUpdated: false,
                outboxInserted: false,
                duplicateDetected,
                actionRowId: persistedAction.id ?? null,
                outboxRowId: existingOutbox?.id ?? persistedAction.outboxMessageId ?? null
            };
            if (persistedAction.outboxMessageId !== null) {
                return buildResult(evaluatedAt, actionId, evaluation, outboxCommand, repositoryResult, "duplicate", ["duplicate_execution"], evaluation.warnings);
            }
            if (existingOutbox) {
                const update = await agentActions.markPlanned({
                    actionId: persistedAction.actionId,
                    expectedCurrentStatuses: [...constants_1.EXECUTION_GATE_ALLOWED_ACTION_STATUSES],
                    outboxMessageId: existingOutbox.id,
                    updatedAt: evaluatedAt
                });
                if (update.conflict) {
                    return buildResult(evaluatedAt, actionId, evaluation, outboxCommand, repositoryResult, "blocked", ["conflicting_action"], evaluation.warnings);
                }
                repositoryResult.actionUpdated = update.updated;
                repositoryResult.actionRowId = update.rowId ?? repositoryResult.actionRowId;
                repositoryResult.outboxRowId = existingOutbox.id;
                return buildResult(evaluatedAt, actionId, evaluation, outboxCommand, repositoryResult, "duplicate", ["duplicate_execution"], evaluation.warnings);
            }
            const insert = await outbox.insertCommand(outboxCommand);
            repositoryResult.outboxInserted = insert.inserted;
            repositoryResult.duplicateDetected = insert.duplicate;
            repositoryResult.outboxRowId = insert.rowId ?? repositoryResult.outboxRowId;
            const update = await agentActions.markPlanned({
                actionId: persistedAction.actionId,
                expectedCurrentStatuses: [...constants_1.EXECUTION_GATE_ALLOWED_ACTION_STATUSES],
                outboxMessageId: insert.rowId,
                updatedAt: evaluatedAt
            });
            if (update.conflict) {
                return buildResult(evaluatedAt, actionId, evaluation, outboxCommand, repositoryResult, "blocked", ["conflicting_action"], evaluation.warnings);
            }
            repositoryResult.actionUpdated = update.updated;
            repositoryResult.actionRowId = update.rowId ?? repositoryResult.actionRowId;
            const status = insert.duplicate ? "duplicate" : "allowed";
            const blockReasons = insert.duplicate ? ["duplicate_execution"] : [];
            return buildResult(evaluatedAt, actionId, evaluation, outboxCommand, repositoryResult, status, blockReasons, evaluation.warnings);
        });
    }
    catch (error) {
        return mapRepositoryFailure(evaluatedAt, actionId, evaluation, error);
    }
}
