"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBlockingPlan = buildBlockingPlan;
const constants_1 = require("./constants");
function buildBlockReason(input) {
    const schedulingReason = input.schedulingResult.reasons[0] ?? "invalid_scheduling_result";
    return (0, constants_1.mapSchedulingReasonToMutationReason)(schedulingReason, {
        stageChanged: false,
        customerRepliedAfterActionCreated: false,
        duplicateAction: Boolean(input.currentContext.duplicateActionId),
        conflictingAction: Boolean(input.currentContext.conflictingActionId),
        originalActionStatus: input.originalAction.status
    });
}
function buildBlockingAuditEvent(input, reason) {
    const createdAt = input.now;
    return {
        eventId: (0, constants_1.buildFollowUpAuditEventId)({
            actionId: input.originalAction.actionId,
            eventType: "follow_up_blocked",
            reason,
            createdAt,
            replacementActionId: null
        }),
        eventType: "follow_up_blocked",
        actionId: input.originalAction.actionId,
        replacementActionId: null,
        reason,
        metadata: {
            oldStatus: input.originalAction.status,
            newStatus: "blocked",
            oldScheduledFor: input.originalAction.scheduledFor,
            newScheduledFor: null,
            reason,
            opportunityStage: input.currentContext.opportunityStage,
            attemptCount: input.originalAction.attemptCount
        },
        createdAt
    };
}
function buildBlockingPlan(input) {
    const reason = buildBlockReason(input);
    const blockReasons = reason === "conflicting_action" ? ["conflicting_action"] : [reason];
    const operations = [
        {
            type: "update_existing_action",
            patch: {
                actionId: input.originalAction.actionId,
                expectedStatuses: [input.originalAction.status],
                nextStatus: "blocked",
                scheduledFor: input.originalAction.scheduledFor,
                blockReasons,
                updatedAt: input.now
            }
        }
    ];
    if (input.policy.requireAuditEvent) {
        operations.push({
            type: "append_audit_event",
            event: buildBlockingAuditEvent(input, reason)
        });
    }
    const reasons = (0, constants_1.normalizePlanReasons)([reason]);
    return {
        planId: (0, constants_1.buildFollowUpMutationPlanId)({
            actionId: input.originalAction.actionId,
            planType: "block_action",
            createdAt: input.now,
            reasons,
            operations
        }),
        planType: "block_action",
        actionId: input.originalAction.actionId,
        replacementActionId: null,
        operations,
        reasons,
        warnings: [],
        idempotency: {
            planKey: (0, constants_1.buildFollowUpMutationPlanKey)({
                actionId: input.originalAction.actionId,
                planType: "block_action",
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
