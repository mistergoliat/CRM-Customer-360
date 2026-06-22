"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildExpirationPlan = buildExpirationPlan;
const constants_1 = require("./constants");
function buildExpirationReason(input) {
    const schedulingReason = String(input.schedulingResult.reasons[0] ?? "invalid_scheduling_result");
    if (schedulingReason === "max_attempts_reached")
        return "max_attempts_reached";
    if (schedulingReason === "action_expired")
        return "action_expired";
    if (schedulingReason === "replacement_would_exceed_expiry")
        return "replacement_would_exceed_expiry";
    return (0, constants_1.mapSchedulingReasonToMutationReason)(schedulingReason, {
        stageChanged: false,
        customerRepliedAfterActionCreated: false,
        duplicateAction: Boolean(input.currentContext.duplicateActionId),
        conflictingAction: Boolean(input.currentContext.conflictingActionId),
        originalActionStatus: input.originalAction.status
    });
}
function buildExpirationAuditEvent(input, reason) {
    const createdAt = input.now;
    return {
        eventId: (0, constants_1.buildFollowUpAuditEventId)({
            actionId: input.originalAction.actionId,
            eventType: "follow_up_expired",
            reason,
            createdAt,
            replacementActionId: null
        }),
        eventType: "follow_up_expired",
        actionId: input.originalAction.actionId,
        replacementActionId: null,
        reason,
        metadata: {
            oldStatus: input.originalAction.status,
            newStatus: "expired",
            oldScheduledFor: input.originalAction.scheduledFor,
            newScheduledFor: null,
            reason,
            attemptCount: input.originalAction.attemptCount
        },
        createdAt
    };
}
function buildExpirationPlan(input) {
    const reason = buildExpirationReason(input);
    const operations = [
        {
            type: "update_existing_action",
            patch: {
                actionId: input.originalAction.actionId,
                expectedStatuses: [input.originalAction.status],
                nextStatus: "expired",
                scheduledFor: input.originalAction.scheduledFor,
                expiresAt: input.originalAction.expiresAt,
                updatedAt: input.now
            }
        }
    ];
    if (input.policy.requireAuditEvent) {
        operations.push({
            type: "append_audit_event",
            event: buildExpirationAuditEvent(input, reason)
        });
    }
    const reasons = (0, constants_1.normalizePlanReasons)([reason]);
    return {
        planId: (0, constants_1.buildFollowUpMutationPlanId)({
            actionId: input.originalAction.actionId,
            planType: "expire_action",
            createdAt: input.now,
            reasons,
            operations
        }),
        planType: "expire_action",
        actionId: input.originalAction.actionId,
        replacementActionId: null,
        operations,
        reasons,
        warnings: [],
        idempotency: {
            planKey: (0, constants_1.buildFollowUpMutationPlanKey)({
                actionId: input.originalAction.actionId,
                planType: "expire_action",
                createdAt: input.now,
                reasons,
                operations
            }),
            deterministic: true
        },
        sideEffects: {
            databaseWritten: false,
            actionMutated: false,
            actionInserted: false,
            outboxWritten: false,
            messageSent: false,
            workerTriggered: false
        },
        createdAt: input.now
    };
}
