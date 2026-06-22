import {
  buildFollowUpAuditEventId,
  buildFollowUpMutationPlanId,
  buildFollowUpMutationPlanKey,
  buildReplacementActionId,
  buildReplacementIdempotencyKey,
  mapSchedulingReasonToMutationReason,
  normalizePlanReasons,
} from "./constants";
import type {
  FollowUpAuditEventDraft,
  FollowUpMutationInput,
  FollowUpMutationPlan,
  FollowUpMutationReason,
  FollowUpReplacementActionDraft
} from "./types";

function parseIso(value: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function resolveGeneration(input: FollowUpMutationInput): number {
  return Math.max(1, input.originalAction.attemptCount + (input.policy.incrementGenerationOnReplacement ? 1 : 0));
}

function stageChanged(input: FollowUpMutationInput): boolean {
  const changedAt = parseIso(input.currentContext.opportunityStageChangedAt);
  const createdAt = parseIso(input.originalAction.createdAt);
  return changedAt !== null && createdAt !== null && changedAt > createdAt;
}

function canUpdateInPlace(input: FollowUpMutationInput): boolean {
  if (!input.policy.allowInPlaceScheduleUpdate) return false;
  if (input.policy.preserveOriginalAction) return false;
  if (!["planned", "scheduled"].includes(input.originalAction.status)) return false;
  if (["cancelled", "expired", "executed", "rejected", "blocked", "failed", "draft", "requires_review"].includes(input.originalAction.status)) return false;
  return Boolean(input.schedulingResult.nextScheduledFor);
}

function buildStageReason(input: FollowUpMutationInput): FollowUpMutationReason {
  if (stageChanged(input)) {
    return "stale_action_context";
  }
  const schedulingReason = String(input.schedulingResult.reasons[0] ?? "invalid_scheduling_result");
  return mapSchedulingReasonToMutationReason(schedulingReason, {
    stageChanged: false,
    customerRepliedAfterActionCreated: false,
    duplicateAction: Boolean(input.currentContext.duplicateActionId),
    conflictingAction: Boolean(input.currentContext.conflictingActionId),
    originalActionStatus: input.originalAction.status
  });
}

function buildReplanAuditEvents(
  input: FollowUpMutationInput,
  reason: FollowUpMutationReason,
  replacementActionId: string | null
): FollowUpAuditEventDraft[] {
  const createdAt = input.now;
  const events: FollowUpAuditEventDraft[] = [
    {
      eventId: buildFollowUpAuditEventId({
        actionId: input.originalAction.actionId,
        eventType: replacementActionId ? "follow_up_superseded" : "follow_up_replanned",
        reason,
        createdAt,
        replacementActionId
      }),
      eventType: replacementActionId ? "follow_up_superseded" : "follow_up_replanned",
      actionId: input.originalAction.actionId,
      replacementActionId,
      reason,
      metadata: {
        oldStatus: input.originalAction.status,
        newStatus: replacementActionId ? "cancelled" : "scheduled",
        oldScheduledFor: input.originalAction.scheduledFor,
        newScheduledFor: input.schedulingResult.nextScheduledFor,
        reason,
        opportunityStage: input.currentContext.opportunityStage,
        attemptCount: input.originalAction.attemptCount,
        generation: resolveGeneration(input)
      },
      createdAt
    }
  ];

  if (replacementActionId) {
    events.push({
      eventId: buildFollowUpAuditEventId({
        actionId: input.originalAction.actionId,
        eventType: "follow_up_replacement_created",
        reason,
        createdAt,
        replacementActionId
      }),
      eventType: "follow_up_replacement_created",
      actionId: input.originalAction.actionId,
      replacementActionId,
      reason,
      metadata: {
        oldStatus: input.originalAction.status,
        newStatus: "scheduled",
        oldScheduledFor: input.originalAction.scheduledFor,
        newScheduledFor: input.schedulingResult.nextScheduledFor,
        reason,
        opportunityStage: input.currentContext.opportunityStage,
        attemptCount: input.originalAction.attemptCount,
        generation: resolveGeneration(input)
      },
      createdAt
    });
  }

  return events;
}

function buildReplacementDraft(input: FollowUpMutationInput, reason: FollowUpMutationReason): FollowUpReplacementActionDraft {
  const nextScheduledFor = input.schedulingResult.nextScheduledFor;
  if (!nextScheduledFor) {
    throw new Error("missing_next_schedule");
  }
  const generation = resolveGeneration(input);
  const replacementActionId = buildReplacementActionId({
    originalActionId: input.originalAction.actionId,
    generation,
    nextScheduledFor,
    reason
  });

  return {
    actionId: replacementActionId,
    idempotencyKey: buildReplacementIdempotencyKey({
      originalActionId: input.originalAction.actionId,
      generation,
      nextScheduledFor,
      reason
    }),
    actionType: input.originalAction.actionType,
    status: "scheduled",
    opportunityId: input.originalAction.opportunityId,
    conversationCaseId: input.originalAction.conversationCaseId,
    waId: input.originalAction.waId,
    scheduledFor: nextScheduledFor,
    expiresAt: input.originalAction.expiresAt,
    attemptCount: input.policy.resetAttemptsOnStageChange && stageChanged(input) ? 0 : input.originalAction.attemptCount,
    maxAttempts: input.originalAction.maxAttempts,
    riskLevel: input.originalAction.riskLevel,
    approvalRequirement: input.originalAction.approvalRequirement,
    draftMessage: input.originalAction.draftMessage,
    finalMessage: input.originalAction.finalMessage,
    parentActionId: input.originalAction.actionId,
    generation,
    lifecycleVersion: input.originalAction.lifecycleVersion,
    policyVersion: input.originalAction.policyVersion,
    runtimeVersion: input.originalAction.runtimeVersion,
    createdAt: input.now,
    updatedAt: input.now
  };
}

function buildInPlacePlan(input: FollowUpMutationInput, reason: FollowUpMutationReason): FollowUpMutationPlan {
  const operations: FollowUpMutationPlan["operations"] = [
    {
      type: "update_existing_action",
      patch: {
        actionId: input.originalAction.actionId,
        expectedStatuses: [input.originalAction.status],
        nextStatus: "scheduled",
        scheduledFor: input.schedulingResult.nextScheduledFor,
        expiresAt: input.originalAction.expiresAt,
        updatedAt: input.now
      }
    }
  ];

  if (input.policy.requireAuditEvent) {
    operations.push({
      type: "append_audit_event",
      event: buildReplanAuditEvents(input, reason, null)[0]
    });
  }

  const reasons = normalizePlanReasons([reason]);
  return {
    planId: buildFollowUpMutationPlanId({
      actionId: input.originalAction.actionId,
      planType: "replan_action",
      createdAt: input.now,
      reasons,
      operations
    }),
    planType: "replan_action",
    actionId: input.originalAction.actionId,
    replacementActionId: null,
    operations,
    reasons,
    warnings: [],
    idempotency: {
      planKey: buildFollowUpMutationPlanKey({
        actionId: input.originalAction.actionId,
        planType: "replan_action",
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

function buildReplacementPlan(input: FollowUpMutationInput, reason: FollowUpMutationReason, planType: "supersede_action" | "cancel_and_create_replacement"): FollowUpMutationPlan {
  if (!input.policy.allowReplacementOnReplan) {
    const fallbackReasons = normalizePlanReasons([reason, "replacement_required"]);
    return {
      planId: buildFollowUpMutationPlanId({
        actionId: input.originalAction.actionId,
        planType: "no_change",
        createdAt: input.now,
        reasons: fallbackReasons,
        operations: []
      }),
      planType: "no_change",
      actionId: input.originalAction.actionId,
      replacementActionId: null,
      operations: [],
      reasons: fallbackReasons,
      warnings: ["replacement_disabled_by_policy"],
      idempotency: {
        planKey: buildFollowUpMutationPlanKey({
          actionId: input.originalAction.actionId,
          planType: "no_change",
          createdAt: input.now,
          reasons: fallbackReasons,
          operations: []
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

  const replacement = buildReplacementDraft(input, reason);
  const replacementActionId = replacement.actionId;
  const operations: FollowUpMutationPlan["operations"] = [
    {
      type: "update_existing_action",
      patch: {
        actionId: input.originalAction.actionId,
        expectedStatuses: [input.originalAction.status],
        nextStatus: "cancelled",
        scheduledFor: input.originalAction.scheduledFor,
        cancelReason: "superseded",
        supersededByActionId: replacementActionId,
        updatedAt: input.now
      }
    },
    {
      type: "create_replacement_action",
      action: replacement
    }
  ];

  if (input.policy.requireAuditEvent) {
    operations.push(...buildReplanAuditEvents(input, reason, replacementActionId).map((event) => ({ type: "append_audit_event" as const, event })));
  }

  const reasons = normalizePlanReasons([reason, planType === "supersede_action" ? "stale_action_context" : "schedule_changed"]);
  return {
    planId: buildFollowUpMutationPlanId({
      actionId: input.originalAction.actionId,
      planType,
      createdAt: input.now,
      reasons,
      operations
    }),
    planType,
    actionId: input.originalAction.actionId,
    replacementActionId,
    operations,
    reasons,
    warnings: [],
    idempotency: {
      planKey: buildFollowUpMutationPlanKey({
        actionId: input.originalAction.actionId,
        planType,
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

export function buildReplanningPlan(input: FollowUpMutationInput): FollowUpMutationPlan {
  if (!input.schedulingResult.nextScheduledFor) {
    return {
      planId: buildFollowUpMutationPlanId({
        actionId: input.originalAction.actionId,
        planType: "no_change",
        createdAt: input.now,
        reasons: ["missing_next_schedule"],
        operations: []
      }),
      planType: "no_change",
      actionId: input.originalAction.actionId,
      replacementActionId: null,
      operations: [],
      reasons: ["missing_next_schedule"],
      warnings: ["missing_next_schedule"],
      idempotency: {
        planKey: buildFollowUpMutationPlanKey({
          actionId: input.originalAction.actionId,
          planType: "no_change",
          createdAt: input.now,
          reasons: ["missing_next_schedule"],
          operations: []
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

  const nextScheduledForMs = parseIso(input.schedulingResult.nextScheduledFor);
  const expiresAtMs = parseIso(input.originalAction.expiresAt);
  if (nextScheduledForMs !== null && expiresAtMs !== null && nextScheduledForMs > expiresAtMs) {
    return {
      ...buildExpirationFallback(input),
      reasons: ["replacement_would_exceed_expiry"],
      warnings: ["replacement_would_exceed_expiry"]
    };
  }

  const reason = buildStageReason(input);
  if (stageChanged(input)) {
    return buildReplacementPlan(input, reason, input.policy.preserveOriginalAction ? "cancel_and_create_replacement" : "supersede_action");
  }

  if (canUpdateInPlace(input)) {
    return buildInPlacePlan(input, reason);
  }

  if (input.policy.allowReplacementOnReplan) {
    return buildReplacementPlan(input, reason, "cancel_and_create_replacement");
  }

  return {
    planId: buildFollowUpMutationPlanId({
      actionId: input.originalAction.actionId,
      planType: "no_change",
      createdAt: input.now,
      reasons: [reason, "replacement_required"],
      operations: []
    }),
    planType: "no_change",
    actionId: input.originalAction.actionId,
    replacementActionId: null,
    operations: [],
    reasons: [reason, "replacement_required"],
    warnings: ["replacement_required"],
    idempotency: {
      planKey: buildFollowUpMutationPlanKey({
        actionId: input.originalAction.actionId,
        planType: "no_change",
        createdAt: input.now,
        reasons: [reason, "replacement_required"],
        operations: []
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

function buildExpirationFallback(input: FollowUpMutationInput): FollowUpMutationPlan {
  const reason: FollowUpMutationReason = "replacement_would_exceed_expiry";
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
      event: {
        eventId: buildFollowUpAuditEventId({
          actionId: input.originalAction.actionId,
          eventType: "follow_up_expired",
          reason,
          createdAt: input.now,
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
          newScheduledFor: input.schedulingResult.nextScheduledFor,
          reason,
          attemptCount: input.originalAction.attemptCount
        },
        createdAt: input.now
      }
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
