"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeAutonomousLoop = executeAutonomousLoop;
const buildAutonomousLoopContext_1 = require("./buildAutonomousLoopContext");
const constants_1 = require("./constants");
const evaluateAutonomousLoop_1 = require("./evaluateAutonomousLoop");
const reconcileDeliveryResult_1 = require("./reconcileDeliveryResult");
const inMemoryAutonomousRuntime_1 = require("./inMemoryAutonomousRuntime");
const outbox_worker_1 = require("../../messaging/outbox-worker");
const whatsapp_transport_1 = require("../../messaging/whatsapp-transport");
function cloneSnapshot(snapshot) {
    return (0, constants_1.cloneDeep)(snapshot);
}
function mapScenario(value) {
    switch (value) {
        case "accepted":
            return "accepted";
        case "temporary_failure":
            return "network_error";
        case "permanent_failure":
            return "policy_rejected";
        case "rate_limited":
            return "rate_limited";
        case "timeout":
            return "timeout";
        case "duplicate_accepted":
            return "duplicate_accepted";
        default:
            return "accepted";
    }
}
function buildOutboxRecord(input, action, commandId, recipient, messageText) {
    return {
        rowId: `outbox:${commandId}`,
        commandId,
        idempotencyKey: commandId,
        actionId: action.actionId,
        channel: "whatsapp",
        commandType: "whatsapp_text",
        recipient,
        messageText,
        status: "pending",
        attemptCount: 0,
        maxAttempts: 3,
        availableAt: input.now,
        expiresAt: action.expiresAt,
        claimedBy: null,
        claimedAt: null,
        leaseExpiresAt: null,
        lastAttemptAt: null,
        deliveredAt: null,
        providerMessageId: null,
        lastErrorCode: null,
        lastErrorMessageSafe: null,
        metadata: {
            source: "ai_sdr",
            sandbox: true,
            riskLevel: action.riskLevel,
            approvalRequirement: action.approvalRequirement
        },
        createdAt: input.now,
        updatedAt: input.now
    };
}
function mapWorkerStatusToLoopStatus(status) {
    if (status === "delivered")
        return "delivered";
    if (status === "retry_scheduled")
        return "retry_scheduled";
    if (status === "dead_letter")
        return "dead_letter";
    if (status === "expired")
        return "expired";
    if (status === "failed")
        return "failed";
    return "completed";
}
function mapFollowUpActionToRuntime(action) {
    return {
        actionId: action.actionId,
        status: action.status,
        createdAt: action.createdAt,
        updatedAt: action.updatedAt,
        source: action
    };
}
async function executeAutonomousLoop(input, runtime = new inMemoryAutonomousRuntime_1.InMemoryAutonomousCommercialRuntime()) {
    const snapshot = runtime.getSnapshot();
    const preview = await (0, evaluateAutonomousLoop_1.evaluateAutonomousLoop)(input, snapshot);
    if (input.mode !== "execute_fake")
        return preview;
    try {
        return await runtime.runAtomic(async (state) => {
            const stagedSnapshot = cloneSnapshot({ ...state });
            const context = (0, buildAutonomousLoopContext_1.buildAutonomousLoopContext)(input, stagedSnapshot);
            const freshPreview = await (0, evaluateAutonomousLoop_1.evaluateAutonomousLoop)(input, stagedSnapshot);
            const action = freshPreview.action;
            const outboxRecord = freshPreview.outbox.record;
            const shouldProcessImmediate = Boolean(action) &&
                Boolean(freshPreview.executionGateResult?.allowed) &&
                Boolean(freshPreview.outbox.command) &&
                (action?.actionType === "send_whatsapp_reply" || action?.actionType === "request_more_context");
            if (shouldProcessImmediate && action && freshPreview.outbox.command) {
                const command = freshPreview.outbox.command;
                const commandRecord = buildOutboxRecord(input, action, command.commandId, command.recipient, command.messageText);
                const fakeClient = new whatsapp_transport_1.FakeWhatsAppHttpClient({
                    explicitRetryAfterSeconds: 30,
                    scenarioByIdempotencyKey: {
                        [command.idempotencyKey]: mapScenario(input.scenario.transportScenario)
                    }
                });
                const transport = new whatsapp_transport_1.WhatsAppMessageTransport({ config: context.transportConfig, client: fakeClient });
                const workerResult = await (0, outbox_worker_1.processOutboxMessage)({
                    now: input.now,
                    record: commandRecord,
                    config: context.outboxConfig
                }, { transport });
                const transportResult = workerResult.transportResult;
                const reconciliation = (0, reconcileDeliveryResult_1.reconcileDeliveryResult)({
                    actionStatusBefore: action.status,
                    workerResult,
                    transportResult
                });
                const loopStatus = mapWorkerStatusToLoopStatus(workerResult.status);
                state.actions.push({
                    actionId: action.actionId,
                    status: (reconciliation.actionStatusAfter ?? action.status),
                    createdAt: action.createdAt ?? input.now,
                    updatedAt: input.now,
                    source: action
                });
                state.opportunities.push({
                    opportunityId: input.commercialContext.opportunityId,
                    opportunityKey: input.commercialContext.opportunityKey ?? input.correlationId,
                    status: input.commercialContext.opportunityStatus,
                    stage: input.commercialContext.opportunityStage,
                    updatedAt: input.now,
                    source: freshPreview.opportunity
                });
                state.decisions.push({
                    decisionId: freshPreview.decision && typeof freshPreview.decision === "object" && freshPreview.decision !== null && "actionId" in freshPreview.decision
                        ? String(freshPreview.decision.actionId ?? command.commandId)
                        : command.commandId,
                    opportunityKey: input.commercialContext.opportunityKey ?? input.correlationId,
                    status: freshPreview.decision && typeof freshPreview.decision === "object" && freshPreview.decision !== null && "type" in freshPreview.decision
                        ? String(freshPreview.decision.type ?? "unknown")
                        : "unknown",
                    actionType: action.actionType,
                    createdAt: input.now,
                    source: freshPreview.decision
                });
                state.outbox.push({
                    ...commandRecord,
                    status: workerResult.status === "delivered"
                        ? "delivered"
                        : workerResult.status === "retry_scheduled"
                            ? "retry_scheduled"
                            : workerResult.status === "dead_letter"
                                ? "dead_letter"
                                : workerResult.status === "expired"
                                    ? "dead_letter"
                                    : "failed",
                    providerMessageId: transportResult?.providerMessageId ?? null,
                    lastErrorCode: transportResult?.errorCode ?? null,
                    lastErrorMessageSafe: transportResult?.errorMessageSafe ?? null,
                    updatedAt: input.now
                });
                if (workerResult.transportResult) {
                    state.deliveryResults.push({
                        reconciliationId: `recon:${(0, constants_1.buildAutonomousLoopRunId)({
                            tenantId: input.tenantId,
                            correlationId: input.correlationId,
                            messageId: input.inbound.messageId,
                            now: input.now
                        })}`,
                        outboxRowId: commandRecord.rowId,
                        status: workerResult.status,
                        createdAt: input.now,
                        source: reconciliation
                    });
                }
                state.processedCorrelationIds.push(input.correlationId);
                if (input.inbound.providerMessageId)
                    state.processedProviderMessageIds.push(input.inbound.providerMessageId);
                state.updatedAt = input.now;
                return {
                    ...freshPreview,
                    status: loopStatus,
                    finalStage: "delivery_reconciliation",
                    outbox: {
                        command,
                        record: commandRecord,
                        workerResult,
                        transportResult
                    },
                    reconciliation,
                    auditTrail: freshPreview.auditTrail,
                    sideEffects: {
                        ...freshPreview.sideEffects,
                        inMemoryStateChanged: true,
                        fakeTransportCalled: true
                    }
                };
            }
            if (freshPreview.followUp.mutationPlan) {
                state.followUpMutationPlans.push(freshPreview.followUp.mutationPlan);
                if (freshPreview.followUp.mutationApplyResult?.applied) {
                    state.actions.splice(0, state.actions.length, ...freshPreview.followUp.mutationApplyResult.nextState.actions.map(mapFollowUpActionToRuntime));
                }
                state.processedCorrelationIds.push(input.correlationId);
                if (input.inbound.providerMessageId)
                    state.processedProviderMessageIds.push(input.inbound.providerMessageId);
                state.updatedAt = input.now;
                return {
                    ...freshPreview,
                    followUp: {
                        ...freshPreview.followUp,
                        mutationApplyResult: freshPreview.followUp.mutationApplyResult
                    },
                    sideEffects: {
                        ...freshPreview.sideEffects,
                        inMemoryStateChanged: Boolean(freshPreview.followUp.mutationApplyResult?.applied)
                    }
                };
            }
            state.processedCorrelationIds.push(input.correlationId);
            if (input.inbound.providerMessageId)
                state.processedProviderMessageIds.push(input.inbound.providerMessageId);
            state.updatedAt = input.now;
            return {
                ...freshPreview,
                sideEffects: {
                    ...freshPreview.sideEffects,
                    inMemoryStateChanged: true
                }
            };
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            ...preview,
            status: "failed",
            errors: [
                ...preview.errors,
                {
                    stage: "execution_gate",
                    code: "runtime_failure",
                    messageSafe: message.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]"),
                    retryable: false
                }
            ],
            sideEffects: {
                realDatabaseWritten: false,
                realOutboxWritten: false,
                realMessageSent: false,
                metaCalled: false,
                schedulerTriggered: false,
                inMemoryStateChanged: false,
                fakeTransportCalled: false
            }
        };
    }
}
