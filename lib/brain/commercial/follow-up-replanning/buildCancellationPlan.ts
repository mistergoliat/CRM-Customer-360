import {
  buildFollowUpAuditEventId,
  buildFollowUpMutationPlanId,
  buildFollowUpMutationPlanKey,
  mapSchedulingReasonToMutationReason,
  normalizePlanReasons
} from "./constants";
import type {
  FollowUpAuditEventDraft,
  FollowUpMutationInput,
  FollowUpMutationPlan,
  FollowUpMutationReason
} from "./types";

function buildCancellationReason(input: FollowUpMutationInput): FollowUpMutationReason {
  const schedulingReason = input.schedulingResult.reasons[0] ?? "invalid_scheduling_result";
  return mapSchedulingReasonToMutationReason(schedulingReason, {
    stageChanged: false,
    customerRepliedAfterActionCreated: input.currentContext.lastInboundAt !== null && new Date(input.currentContext.lastInboundAt).getTime() > new Date(input.originalAction.createdAt).getTime(),
    duplicateAction: Boolean(input.currentContext.duplicateActionId),
    conflictingAction: Boolean(input.currentContext.conflictingActionId),
    originalActionStatus: input.originalAction.status
  });
}

function buildCancellationAuditEvent(input: FollowUpMutationInput, reason: FollowUpMutationReason): FollowUpAuditEventDraft {
  const createdAt = input.now;
  return {
    eventId: buildFollowUpAuditEventId({
      actionId: input.originalAction.actionId,
      eventType: "follow_up_cancelled",
      reason,
      createdAt,
      replacementActionId: null
    }),
    eventType: "follow_up_cancelled",
    actionId: input.originalAction.actionId,
    replacementActionId: null,
    reason,
    metadata: {
      oldStatus: input.originalAction.status,
      newStatus: "cancelled",
      oldScheduledFor: input.originalAction.scheduledFor,
      newScheduledFor: null,
      reason,
      opportunityStage: input.currentContext.opportunityStage,
      attemptCount: input.originalAction.attemptCount
    },
    createdAt
  };
}

export function buildCancellationPlan(input: FollowUpMutationInput): FollowUpMutationPlan {
  const reason = buildCancellationReason(input);
  const operations: FollowUpMutationPlan["operations"] = [
    {
      type: "update_existing_action",
      patch: {
        actionId: input.originalAction.actionId,
        expectedStatuses: [input.originalAction.status],
        nextStatus: "cancelled",
        scheduledFor: input.originalAction.scheduledFor,
        cancelReason: reason,
        updatedAt: input.now
      }
    }
  ];

  if (input.policy.requireAuditEvent) {
    operations.push({
      type: "append_audit_event",
      event: buildCancellationAuditEvent(input, reason)
    });
  }

  const reasons = normalizePlanReasons([reason]);
  return {
    planId: buildFollowUpMutationPlanId({
      actionId: input.originalAction.actionId,
      planType: "cancel_action",
      createdAt: input.now,
      reasons,
      operations
    }),
    planType: "cancel_action",
    actionId: input.originalAction.actionId,
    replacementActionId: null,
    operations,
    reasons,
    warnings: [],
    idempotency: {
      planKey: buildFollowUpMutationPlanKey({
        actionId: input.originalAction.actionId,
        planType: "cancel_action",
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

