"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processOutboxMessage = processOutboxMessage;
exports.processOutboxBatch = processOutboxBatch;
const calculateRetrySchedule_1 = require("./calculateRetrySchedule");
const buildOutboxWorkerPlan_1 = require("./buildOutboxWorkerPlan");
const constants_1 = require("./constants");
const evaluateOutboxCandidate_1 = require("./evaluateOutboxCandidate");
function buildSyntheticTransportFailure(attemptedAt, errorMessage) {
    return {
        status: "temporary_failure",
        providerMessageId: null,
        providerRequestId: null,
        errorCode: "network_error",
        errorMessageSafe: (0, constants_1.sanitizeOutboxWorkerErrorMessage)(errorMessage) ?? "Temporary transport failure.",
        retryAfterSeconds: 30,
        acceptedAt: null,
        completedAt: attemptedAt,
        metadata: {
            provider: "fake",
            sandbox: true,
            simulated: true
        }
    };
}
function buildSkippedResult(input, decision, plan = (0, buildOutboxWorkerPlan_1.buildSkippedOutboxWorkerPlan)({ now: input.now, record: input.record, config: input.config, evaluation: (0, evaluateOutboxCandidate_1.evaluateOutboxCandidate)(input) })) {
    const evaluation = (0, evaluateOutboxCandidate_1.evaluateOutboxCandidate)(input);
    return {
        status: decision,
        recordId: input.record.rowId,
        commandId: input.record.commandId,
        candidateEvaluation: evaluation,
        processingPlan: null,
        finalPlan: plan,
        transportResult: null,
        warnings: [...evaluation.warnings],
        sideEffects: {
            databaseWritten: false,
            messageTransportCalled: false,
            externalMessageSent: false,
            metaCalled: false
        },
        processedAt: input.now
    };
}
function classifyTransportOutcome(result) {
    if (result.status === "accepted" || result.status === "duplicate_accepted") {
        return "delivered";
    }
    if (result.status === "temporary_failure" || result.status === "rate_limited" || result.status === "timeout") {
        return "retry";
    }
    if (result.status === "permanent_failure") {
        return "dead_letter";
    }
    return "failed";
}
async function processClaimedOutboxRecord(input, dependencies, outbox) {
    const evaluation = (0, evaluateOutboxCandidate_1.evaluateOutboxCandidate)(input);
    if (evaluation.decision !== "process") {
        return buildSkippedResult(input, evaluation.decision === "expire" ? "expired" : evaluation.decision === "dead_letter" ? "dead_letter" : "skipped");
    }
    const processingPlan = (0, buildOutboxWorkerPlan_1.buildProcessingOutboxWorkerPlan)({ now: input.now, record: input.record, config: input.config, evaluation });
    const processingResult = await outbox.applyWorkerPlan(processingPlan);
    if (!processingResult.applied) {
        throw new Error(processingResult.conflict ? "processing_plan_conflict" : "processing_plan_duplicate");
    }
    let transportResult;
    try {
        transportResult = await dependencies.transport.send({
            commandId: input.record.commandId,
            idempotencyKey: input.record.idempotencyKey,
            channel: input.record.channel,
            commandType: input.record.commandType,
            recipient: input.record.recipient,
            messageText: input.record.messageText,
            sandbox: input.record.metadata.sandbox,
            attemptedAt: input.now
        });
    }
    catch (error) {
        transportResult = buildSyntheticTransportFailure(input.now, error instanceof Error ? error.message : "Transport failure.");
    }
    const transportOutcome = classifyTransportOutcome(transportResult);
    const retrySchedule = transportOutcome === "retry"
        ? (0, calculateRetrySchedule_1.calculateOutboxRetrySchedule)({
            now: input.now,
            attemptCount: input.record.attemptCount + 1,
            maxAttempts: input.record.maxAttempts,
            expiresAt: input.record.expiresAt,
            retryAfterSeconds: transportResult.retryAfterSeconds,
            baseRetrySeconds: input.config.baseRetrySeconds,
            maxRetrySeconds: input.config.maxRetrySeconds
        })
        : null;
    let finalPlan;
    let status;
    if (transportOutcome === "delivered") {
        finalPlan = (0, buildOutboxWorkerPlan_1.buildFinalOutboxWorkerPlan)({ now: input.now, record: { ...input.record, attemptCount: input.record.attemptCount + 1 }, config: input.config, evaluation, transportResult });
        status = "delivered";
    }
    else if (transportOutcome === "retry") {
        if (!retrySchedule || retrySchedule.exhausted || !retrySchedule.retryAt) {
            finalPlan = (0, buildOutboxWorkerPlan_1.buildOutboxWorkerPlan)({ now: input.now, record: { ...input.record, attemptCount: input.record.attemptCount + 1 }, config: input.config, evaluation, transportResult, phase: "final" });
            status = "dead_letter";
        }
        else {
            finalPlan = (0, buildOutboxWorkerPlan_1.buildOutboxWorkerPlan)({ now: input.now, record: { ...input.record, attemptCount: input.record.attemptCount + 1 }, config: input.config, evaluation, transportResult, phase: "final" });
            status = "retry_scheduled";
        }
    }
    else if (transportOutcome === "dead_letter") {
        finalPlan = (0, buildOutboxWorkerPlan_1.buildFinalOutboxWorkerPlan)({ now: input.now, record: { ...input.record, attemptCount: input.record.attemptCount + 1 }, config: input.config, evaluation, transportResult });
        status = "dead_letter";
    }
    else {
        finalPlan = (0, buildOutboxWorkerPlan_1.buildOutboxWorkerPlan)({ now: input.now, record: { ...input.record, attemptCount: input.record.attemptCount + 1 }, config: input.config, evaluation, transportResult, phase: "final" });
        status = "failed";
    }
    const finalResult = await outbox.applyWorkerPlan(finalPlan);
    if (!finalResult.applied) {
        throw new Error(finalResult.conflict ? "final_plan_conflict" : "final_plan_duplicate");
    }
    return {
        status,
        recordId: input.record.rowId,
        commandId: input.record.commandId,
        candidateEvaluation: evaluation,
        processingPlan,
        finalPlan,
        transportResult,
        warnings: [...evaluation.warnings],
        sideEffects: {
            databaseWritten: false,
            messageTransportCalled: true,
            externalMessageSent: false,
            metaCalled: false
        },
        processedAt: input.now
    };
}
async function processOutboxMessage(input, dependencies) {
    const evaluation = (0, evaluateOutboxCandidate_1.evaluateOutboxCandidate)(input);
    const normalizedNow = (0, constants_1.normalizeIsoTimestamp)(input.now);
    if (!normalizedNow) {
        return {
            status: "invalid",
            recordId: input.record.rowId,
            commandId: input.record.commandId,
            candidateEvaluation: evaluation,
            processingPlan: null,
            finalPlan: (0, buildOutboxWorkerPlan_1.buildSkippedOutboxWorkerPlan)({ now: input.now, record: input.record, config: input.config, evaluation }),
            transportResult: null,
            warnings: [...evaluation.warnings, "Invalid process timestamp."],
            sideEffects: {
                databaseWritten: false,
                messageTransportCalled: false,
                externalMessageSent: false,
                metaCalled: false
            },
            processedAt: input.now
        };
    }
    if (evaluation.decision === "skip") {
        return buildSkippedResult(input, "skipped");
    }
    if (evaluation.decision === "invalid") {
        return {
            status: "invalid",
            recordId: input.record.rowId,
            commandId: input.record.commandId,
            candidateEvaluation: evaluation,
            processingPlan: null,
            finalPlan: (0, buildOutboxWorkerPlan_1.buildSkippedOutboxWorkerPlan)({ now: input.now, record: input.record, config: input.config, evaluation }),
            transportResult: null,
            warnings: [...evaluation.warnings],
            sideEffects: {
                databaseWritten: false,
                messageTransportCalled: false,
                externalMessageSent: false,
                metaCalled: false
            },
            processedAt: input.now
        };
    }
    if (evaluation.decision === "expire") {
        return {
            status: "expired",
            recordId: input.record.rowId,
            commandId: input.record.commandId,
            candidateEvaluation: evaluation,
            processingPlan: null,
            finalPlan: (0, buildOutboxWorkerPlan_1.buildOutboxWorkerPlan)({ now: input.now, record: input.record, config: input.config, evaluation, transportResult: null, phase: "final" }),
            transportResult: null,
            warnings: [...evaluation.warnings],
            sideEffects: {
                databaseWritten: false,
                messageTransportCalled: false,
                externalMessageSent: false,
                metaCalled: false
            },
            processedAt: input.now
        };
    }
    if (evaluation.decision === "dead_letter") {
        return {
            status: "dead_letter",
            recordId: input.record.rowId,
            commandId: input.record.commandId,
            candidateEvaluation: evaluation,
            processingPlan: null,
            finalPlan: (0, buildOutboxWorkerPlan_1.buildOutboxWorkerPlan)({ now: input.now, record: input.record, config: input.config, evaluation, transportResult: null, phase: "final" }),
            transportResult: null,
            warnings: [...evaluation.warnings],
            sideEffects: {
                databaseWritten: false,
                messageTransportCalled: false,
                externalMessageSent: false,
                metaCalled: false
            },
            processedAt: input.now
        };
    }
    const processingPlan = (0, buildOutboxWorkerPlan_1.buildProcessingOutboxWorkerPlan)({ now: input.now, record: input.record, config: input.config, evaluation });
    let transportResult;
    try {
        transportResult = await dependencies.transport.send({
            commandId: input.record.commandId,
            idempotencyKey: input.record.idempotencyKey,
            channel: input.record.channel,
            commandType: input.record.commandType,
            recipient: input.record.recipient,
            messageText: input.record.messageText,
            sandbox: input.record.metadata.sandbox,
            attemptedAt: input.now
        });
    }
    catch (error) {
        transportResult = buildSyntheticTransportFailure(input.now, error instanceof Error ? error.message : "Transport failure.");
    }
    const transportOutcome = classifyTransportOutcome(transportResult);
    const retrySchedule = transportOutcome === "retry"
        ? (0, calculateRetrySchedule_1.calculateOutboxRetrySchedule)({
            now: input.now,
            attemptCount: input.record.attemptCount + 1,
            maxAttempts: input.record.maxAttempts,
            expiresAt: input.record.expiresAt,
            retryAfterSeconds: transportResult.retryAfterSeconds,
            baseRetrySeconds: input.config.baseRetrySeconds,
            maxRetrySeconds: input.config.maxRetrySeconds
        })
        : null;
    let finalPlan;
    let status;
    if (transportOutcome === "delivered") {
        finalPlan = (0, buildOutboxWorkerPlan_1.buildFinalOutboxWorkerPlan)({ now: input.now, record: { ...input.record, attemptCount: input.record.attemptCount + 1 }, config: input.config, evaluation, transportResult });
        status = "delivered";
    }
    else if (transportOutcome === "retry") {
        if (!retrySchedule || retrySchedule.exhausted || !retrySchedule.retryAt) {
            finalPlan = (0, buildOutboxWorkerPlan_1.buildOutboxWorkerPlan)({ now: input.now, record: { ...input.record, attemptCount: input.record.attemptCount + 1 }, config: input.config, evaluation, transportResult, phase: "final" });
            status = "dead_letter";
        }
        else {
            finalPlan = (0, buildOutboxWorkerPlan_1.buildOutboxWorkerPlan)({ now: input.now, record: { ...input.record, attemptCount: input.record.attemptCount + 1 }, config: input.config, evaluation, transportResult, phase: "final" });
            status = "retry_scheduled";
        }
    }
    else if (transportOutcome === "dead_letter") {
        finalPlan = (0, buildOutboxWorkerPlan_1.buildFinalOutboxWorkerPlan)({ now: input.now, record: { ...input.record, attemptCount: input.record.attemptCount + 1 }, config: input.config, evaluation, transportResult });
        status = "dead_letter";
    }
    else {
        finalPlan = (0, buildOutboxWorkerPlan_1.buildOutboxWorkerPlan)({ now: input.now, record: { ...input.record, attemptCount: input.record.attemptCount + 1 }, config: input.config, evaluation, transportResult, phase: "final" });
        status = "failed";
    }
    return {
        status,
        recordId: input.record.rowId,
        commandId: input.record.commandId,
        candidateEvaluation: evaluation,
        processingPlan,
        finalPlan,
        transportResult,
        warnings: [...evaluation.warnings],
        sideEffects: {
            databaseWritten: false,
            messageTransportCalled: true,
            externalMessageSent: false,
            metaCalled: false
        },
        processedAt: input.now
    };
}
async function processOutboxBatch(input, dependencies) {
    const processedAt = (0, constants_1.normalizeIsoTimestamp)(input.now) ?? input.now;
    const summary = {
        claimed: 0,
        processed: 0,
        delivered: 0,
        retryScheduled: 0,
        deadLettered: 0,
        expired: 0,
        skipped: 0,
        failed: 0,
        results: [],
        processedAt,
        sideEffects: {
            databaseWritten: false,
            messageTransportCalled: false,
            externalMessageSent: false,
            metaCalled: false
        }
    };
    if (!input.config.workerEnabled || !input.config.transportEnabled) {
        return summary;
    }
    const claimResult = await dependencies.unitOfWork.run(async ({ outbox }) => {
        return outbox.claimAvailable({
            now: input.now,
            workerId: input.config.workerId,
            batchSize: input.config.batchSize,
            leaseExpiresAt: new Date(new Date(input.now).getTime() + input.config.leaseSeconds * 1000).toISOString(),
            recoverExpiredLeases: input.config.recoverExpiredLeases
        });
    });
    summary.claimed = claimResult.length;
    for (const claimedRecord of claimResult) {
        try {
            const result = await dependencies.unitOfWork.run(async ({ outbox }) => {
                return processClaimedOutboxRecord({ now: input.now, record: claimedRecord, config: input.config }, { transport: dependencies.transport }, outbox);
            });
            summary.results.push(result);
            summary.processed += 1;
            summary.sideEffects.messageTransportCalled = summary.sideEffects.messageTransportCalled || result.sideEffects.messageTransportCalled;
            if (result.status === "delivered")
                summary.delivered += 1;
            else if (result.status === "retry_scheduled")
                summary.retryScheduled += 1;
            else if (result.status === "dead_letter")
                summary.deadLettered += 1;
            else if (result.status === "expired")
                summary.expired += 1;
            else if (result.status === "skipped")
                summary.skipped += 1;
            else if (result.status === "failed" || result.status === "invalid")
                summary.failed += 1;
        }
        catch (error) {
            summary.processed += 1;
            summary.failed += 1;
            if (!(error instanceof Error && error.message.startsWith("processing_plan_"))) {
                summary.sideEffects.messageTransportCalled = true;
            }
            summary.results.push({
                status: "failed",
                recordId: claimedRecord.rowId,
                commandId: claimedRecord.commandId,
                candidateEvaluation: (0, evaluateOutboxCandidate_1.evaluateOutboxCandidate)({ now: input.now, record: claimedRecord, config: input.config }),
                processingPlan: null,
                finalPlan: null,
                transportResult: null,
                warnings: [error instanceof Error ? error.message : "Outbox batch failed."],
                sideEffects: {
                    databaseWritten: false,
                    messageTransportCalled: false,
                    externalMessageSent: false,
                    metaCalled: false
                },
                processedAt
            });
        }
    }
    return summary;
}
