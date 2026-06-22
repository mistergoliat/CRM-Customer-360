import {
  buildFollowUpAuditEventId,
  buildFollowUpMutationPlanId,
  buildFollowUpMutationPlanKey,
  mapSchedulingReasonToMutationReason,
  normalizePlanReasons
} from "./constants";
import type { FollowUpAuditEventDraft, FollowUpMutationInput, FollowUpMutationPlan, FollowUpMutationReason } from "./types";

function buildExpirationReason(input: FollowUpMutationInput): FollowUpMutationReason {
  const schedulingReason = String(input.schedulingResult.reasons[0] ?? "invalid_scheduling_result");
  if (schedulingReason === "max_attempts_reached") return "max_attempts_reached";
  if (schedulingReason === "action_expired") return "action_expired";
  if (schedulingReason === "replacement_would_exceed_expiry") return "replacement_would_exceed_expiry";
  return mapSchedulingReasonToMutationReason(schedulingReason, {
    stageChanged: false,
    customerRepliedAfterActionCreated: false,
    duplicateAction: Boolean(input.currentContext.duplicateActionId),
    conflictingAction: Boolean(input.currentContext.conflictingActionId),
    originalActionStatus: input.originalAction.status
  });
}

function buildExpirationAuditEvent(input: FollowUpMutationInput, reason: FollowUpMutationReason): FollowUpAuditEventDraft {
  const createdAt = input.now;
  return {
    eventId: buildFollowUpAuditEventId({
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

export function buildExpirationPlan(input: FollowUpMutationInput): FollowUpMutationPlan {
  const reason = buildExpirationReason(input);
  const operations: FollowUpMutationPlan["operations"] = [
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

  const reasons = normalizePlanReasons([reason]);
  return {
    planId: buildFollowUpMutationPlanId({
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
      planKey: buildFollowUpMutationPlanKey({
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
