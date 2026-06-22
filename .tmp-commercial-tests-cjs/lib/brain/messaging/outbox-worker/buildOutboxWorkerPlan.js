"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildOutboxWorkerPlan = buildOutboxWorkerPlan;
exports.buildFinalOutboxWorkerPlan = buildFinalOutboxWorkerPlan;
exports.buildProcessingOutboxWorkerPlan = buildProcessingOutboxWorkerPlan;
exports.buildSkippedOutboxWorkerPlan = buildSkippedOutboxWorkerPlan;
exports.isRetryableTransportResult = isRetryableTransportResult;
exports.isPermanentTransportResult = isPermanentTransportResult;
const constants_1 = require("./constants");
const calculateRetrySchedule_1 = require("./calculateRetrySchedule");
function buildAuditEvent(input, replacementTransportResult) {
    return {
        eventId: (0, constants_1.buildOutboxAuditEventId)({
            rowId: input.record.rowId,
            commandId: input.record.commandId,
            attemptCount: input.record.attemptCount,
            planType: input.planType,
            eventType: input.eventType,
            createdAt: input.now
        }),
        eventType: input.eventType,
        reason: input.reason,
        metadata: {
            ...input.metadata,
            attemptCount: input.record.attemptCount,
            maxAttempts: input.record.maxAttempts,
            workerId: input.metadata.workerId ?? null,
            providerMessageId: replacementTransportResult?.providerMessageId ?? null
        },
        createdAt: input.now
    };
}
function buildBasePlan(input) {
    const plan = {
        planId: (0, constants_1.buildOutboxWorkerPlanId)({
            rowId: input.record.rowId,
            commandId: input.record.commandId,
            attemptCount: input.record.attemptCount,
            planType: input.planType,
            createdAt: input.now
        }),
        planKey: (0, constants_1.buildOutboxWorkerPlanKey)({
            rowId: input.record.rowId,
            commandId: input.record.commandId,
            attemptCount: input.record.attemptCount,
            planType: input.planType,
            createdAt: input.now
        }),
        planType: input.planType,
        rowId: input.record.rowId,
        commandId: input.record.commandId,
        idempotencyKey: input.record.idempotencyKey,
        expectedStatuses: [...new Set(input.expectedStatuses)],
        patch: {
            nextStatus: input.nextStatus,
            updatedAt: input.now,
            ...input.patch
        },
        auditEvent: input.auditEvent,
        transportResultSummary: {
            status: input.transportResult?.status ?? null,
            providerMessageId: input.transportResult?.providerMessageId ?? null,
            errorCode: input.transportResult?.errorCode ?? null
        },
        sideEffects: {
            databaseWritten: false,
            messageTransportCalled: Boolean(input.transportResult),
            externalMessageSent: false,
            metaCalled: false
        },
        createdAt: input.now
    };
    return plan;
}
function buildProcessingPlan(input) {
    const auditEvent = buildAuditEvent({
        now: input.now,
        record: input.record,
        planType: "mark_processing",
        reason: "transport_accepted",
        eventType: "outbox_processing_started",
        metadata: {
            oldStatus: input.record.status,
            newStatus: "processing",
            workerId: input.config.workerId,
            leaseExpiresAt: input.record.leaseExpiresAt
        }
    }, input.transportResult);
    return buildBasePlan({
        now: input.now,
        record: input.record,
        planType: "mark_processing",
        reason: "transport_accepted",
        expectedStatuses: [input.record.status],
        nextStatus: "processing",
        transportResult: null,
        patch: {
            attemptCount: input.record.attemptCount + 1,
            lastAttemptAt: input.now
        },
        auditEvent
    });
}
function buildReleasedClaimPlan(input, reason) {
    const auditEvent = buildAuditEvent({
        now: input.now,
        record: input.record,
        planType: "release_claim",
        reason,
        eventType: "outbox_claim_released",
        metadata: {
            oldStatus: input.record.status,
            newStatus: "pending",
            workerId: input.config.workerId,
            leaseExpiresAt: input.record.leaseExpiresAt
        }
    });
    return buildBasePlan({
        now: input.now,
        record: input.record,
        planType: "release_claim",
        reason,
        expectedStatuses: [input.record.status],
        nextStatus: "pending",
        transportResult: null,
        patch: {
            claimedBy: null,
            claimedAt: null,
            leaseExpiresAt: null
        },
        auditEvent
    });
}
function buildDeliveredPlan(input, transportResult, reason) {
    const deliveredAt = transportResult.acceptedAt ?? transportResult.completedAt;
    const auditEvent = buildAuditEvent({
        now: input.now,
        record: input.record,
        planType: "mark_delivered",
        reason,
        eventType: "outbox_delivered",
        metadata: {
            oldStatus: input.record.status,
            newStatus: "delivered",
            workerId: input.config.workerId,
            providerMessageId: transportResult.providerMessageId,
            attemptCount: input.record.attemptCount,
            maxAttempts: input.record.maxAttempts
        }
    });
    return buildBasePlan({
        now: input.now,
        record: input.record,
        planType: "mark_delivered",
        reason,
        expectedStatuses: ["processing"],
        nextStatus: "delivered",
        transportResult,
        patch: {
            deliveredAt,
            providerMessageId: transportResult.providerMessageId,
            lastErrorCode: null,
            lastErrorMessageSafe: null
        },
        auditEvent
    });
}
function buildRetryPlan(input, transportResult, retryAt, reason) {
    const auditEvent = buildAuditEvent({
        now: input.now,
        record: input.record,
        planType: "schedule_retry",
        reason,
        eventType: "outbox_retry_scheduled",
        metadata: {
            oldStatus: input.record.status,
            newStatus: "retry_scheduled",
            workerId: input.config.workerId,
            retryAt,
            delaySeconds: transportResult.retryAfterSeconds,
            errorCode: transportResult.errorCode,
            leaseExpiresAt: input.record.leaseExpiresAt
        }
    });
    return buildBasePlan({
        now: input.now,
        record: input.record,
        planType: "schedule_retry",
        reason,
        expectedStatuses: ["processing"],
        nextStatus: "retry_scheduled",
        transportResult,
        patch: {
            attemptCount: input.record.attemptCount,
            availableAt: retryAt,
            lastErrorCode: transportResult.errorCode,
            lastErrorMessageSafe: (0, constants_1.sanitizeOutboxWorkerErrorMessage)(transportResult.errorMessageSafe),
            providerMessageId: transportResult.providerMessageId
        },
        auditEvent
    });
}
function buildDeadLetterPlan(input, transportResult, reason) {
    const auditEvent = buildAuditEvent({
        now: input.now,
        record: input.record,
        planType: "move_to_dead_letter",
        reason,
        eventType: "outbox_dead_lettered",
        metadata: {
            oldStatus: input.record.status,
            newStatus: "dead_letter",
            workerId: input.config.workerId,
            errorCode: transportResult?.errorCode ?? null,
            attemptCount: input.record.attemptCount,
            maxAttempts: input.record.maxAttempts
        }
    });
    return buildBasePlan({
        now: input.now,
        record: input.record,
        planType: "move_to_dead_letter",
        reason,
        expectedStatuses: ["processing", "pending", "retry_scheduled", "claimed"],
        nextStatus: "dead_letter",
        transportResult,
        patch: {
            lastErrorCode: transportResult?.errorCode ?? "unknown",
            lastErrorMessageSafe: (0, constants_1.sanitizeOutboxWorkerErrorMessage)(transportResult?.errorMessageSafe ?? "Moved to dead letter."),
            providerMessageId: transportResult?.providerMessageId ?? input.record.providerMessageId ?? null
        },
        auditEvent
    });
}
function buildExpiredPlan(input) {
    const auditEvent = buildAuditEvent({
        now: input.now,
        record: input.record,
        planType: "expire_message",
        reason: "expired",
        eventType: "outbox_expired",
        metadata: {
            oldStatus: input.record.status,
            newStatus: "dead_letter",
            workerId: input.config.workerId,
            attemptCount: input.record.attemptCount,
            maxAttempts: input.record.maxAttempts
        }
    });
    return buildBasePlan({
        now: input.now,
        record: input.record,
        planType: "expire_message",
        reason: "expired",
        expectedStatuses: ["pending", "retry_scheduled", "claimed", "processing"],
        nextStatus: "dead_letter",
        transportResult: null,
        patch: {
            lastErrorCode: "expired",
            lastErrorMessageSafe: "expired"
        },
        auditEvent
    });
}
function buildFailedPlan(input, reason) {
    const auditEvent = buildAuditEvent({
        now: input.now,
        record: input.record,
        planType: "mark_failed",
        reason,
        eventType: "outbox_failed",
        metadata: {
            oldStatus: input.record.status,
            newStatus: "failed",
            workerId: input.config.workerId,
            attemptCount: input.record.attemptCount,
            maxAttempts: input.record.maxAttempts
        }
    });
    return buildBasePlan({
        now: input.now,
        record: input.record,
        planType: "mark_failed",
        reason,
        expectedStatuses: ["processing", "claimed"],
        nextStatus: "failed",
        transportResult: null,
        patch: {
            lastErrorCode: "unknown",
            lastErrorMessageSafe: "failed"
        },
        auditEvent
    });
}
function buildNoChangePlan(input, reason) {
    return buildBasePlan({
        now: input.now,
        record: input.record,
        planType: "no_change",
        reason,
        expectedStatuses: [input.record.status],
        nextStatus: input.record.status,
        transportResult: null,
        patch: {},
        auditEvent: null
    });
}
function buildOutboxWorkerPlan(input) {
    if (input.phase === "processing") {
        return buildProcessingPlan(input);
    }
    if (input.phase === "skip") {
        if (input.evaluation.decision === "skip" && (input.record.status === "claimed" || input.record.status === "processing")) {
            return buildReleasedClaimPlan(input, input.evaluation.reasons[0] ?? "status_not_reclaimable");
        }
        return buildNoChangePlan(input, input.evaluation.reasons[0] ?? "idempotent_plan_reused");
    }
    const transportResult = input.transportResult;
    if (!transportResult) {
        if (input.evaluation.decision === "expire")
            return buildExpiredPlan(input);
        if (input.evaluation.decision === "dead_letter")
            return buildDeadLetterPlan(input, null, input.evaluation.reasons[0] ?? "retry_exhausted");
        return buildNoChangePlan(input, input.evaluation.reasons[0] ?? "idempotent_plan_reused");
    }
    if (transportResult.status === "accepted") {
        return buildDeliveredPlan(input, transportResult, "transport_accepted");
    }
    if (transportResult.status === "duplicate_accepted") {
        return buildDeliveredPlan(input, transportResult, "transport_duplicate_accepted");
    }
    if (transportResult.status === "temporary_failure" || transportResult.status === "rate_limited" || transportResult.status === "timeout") {
        const retryReason = transportResult.status === "temporary_failure"
            ? "transport_temporary_failure"
            : transportResult.status === "rate_limited"
                ? "transport_rate_limited"
                : "transport_timeout";
        const retrySchedule = (0, calculateRetrySchedule_1.calculateOutboxRetrySchedule)({
            now: input.now,
            attemptCount: input.record.attemptCount,
            maxAttempts: input.record.maxAttempts,
            expiresAt: input.record.expiresAt,
            retryAfterSeconds: transportResult.retryAfterSeconds,
            baseRetrySeconds: input.config.baseRetrySeconds,
            maxRetrySeconds: input.config.maxRetrySeconds
        });
        if (retrySchedule.exhausted || !retrySchedule.retryAt) {
            return buildDeadLetterPlan(input, transportResult, "retry_exhausted");
        }
        return buildRetryPlan(input, transportResult, retrySchedule.retryAt, retryReason);
    }
    if (transportResult.status === "permanent_failure") {
        return buildDeadLetterPlan(input, transportResult, "transport_permanent_failure");
    }
    return buildFailedPlan(input, "repository_failure");
}
function buildFinalOutboxWorkerPlan(input) {
    return buildOutboxWorkerPlan({ ...input, phase: "final" });
}
function buildProcessingOutboxWorkerPlan(input) {
    return buildOutboxWorkerPlan({ ...input, transportResult: null, phase: "processing" });
}
function buildSkippedOutboxWorkerPlan(input) {
    return buildOutboxWorkerPlan({ ...input, transportResult: null, phase: "skip" });
}
function isRetryableTransportResult(result) {
    return result.status === "temporary_failure" || result.status === "rate_limited" || result.status === "timeout" || (0, constants_1.isRetryableTransportErrorCode)(result.errorCode);
}
function isPermanentTransportResult(result) {
    return result.status === "permanent_failure" || (0, constants_1.isPermanentTransportErrorCode)(result.errorCode);
}
