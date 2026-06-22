import { COMMERCIAL_ACTION_TERMINAL_STATUSES } from "../action-lifecycle/constants";
import { buildBlockingPlan } from "./buildBlockingPlan";
import { buildCancellationPlan } from "./buildCancellationPlan";
import { buildExpirationPlan } from "./buildExpirationPlan";
import { buildReplanningPlan } from "./buildReplanningPlan";
import {
  COMMERCIAL_FOLLOW_UP_MUTATION_ALLOWED_MUTABLE_STATUSES,
  COMMERCIAL_FOLLOW_UP_MUTATION_TERMINAL_STATUSES,
  asIso,
  asText,
  isRecord,
  normalizePlanReasons,
  resolvePrimaryMutationReason
} from "./constants";
import type { FollowUpMutationInput, FollowUpMutationPlan, FollowUpMutationReason } from "./types";

function isTerminalActionStatus(status: string): boolean {
  return ([...COMMERCIAL_FOLLOW_UP_MUTATION_TERMINAL_STATUSES, ...COMMERCIAL_ACTION_TERMINAL_STATUSES] as readonly string[]).includes(status);
}

function isAllowedSchedulingStatus(status: string): boolean {
  return [...COMMERCIAL_FOLLOW_UP_MUTATION_ALLOWED_MUTABLE_STATUSES].includes(status as (typeof COMMERCIAL_FOLLOW_UP_MUTATION_ALLOWED_MUTABLE_STATUSES)[number]);
}

function isCustomerReplyAfterActionCreated(input: FollowUpMutationInput): boolean {
  const inbound = asIso(input.currentContext.lastInboundAt);
  const createdAt = asIso(input.originalAction.createdAt);
  if (!inbound || !createdAt) return false;
  return new Date(inbound).getTime() > new Date(createdAt).getTime();
}

function buildInvalidPlan(input: FollowUpMutationInput, reason: FollowUpMutationReason): FollowUpMutationPlan {
  return {
    planId: `followup-mutation-plan-invalid:${reason}:${asText(input.originalAction.actionId) ?? "unknown"}`,
    planType: "no_change",
    actionId: input.originalAction.actionId,
    replacementActionId: null,
    operations: [],
    reasons: [reason],
    warnings: [reason],
    idempotency: {
      planKey: `followup-mutation:${input.originalAction.actionId}:no_change:${reason}`,
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

export function buildFollowUpMutationPlan(input: FollowUpMutationInput): FollowUpMutationPlan {
  if (!isRecord(input)) {
    throw new Error("Invalid follow-up mutation input.");
  }

  const actionId = asText(input.originalAction?.actionId);
  const idempotencyKey = asText(input.originalAction?.idempotencyKey);
  const actionType = asText(input.originalAction?.actionType);
  const status = asText(input.originalAction?.status);
  const now = asIso(input.now);

  if (!actionId || !idempotencyKey || !actionType || !status || !now) {
    return buildInvalidPlan(input, "invalid_scheduling_result");
  }

  if (isTerminalActionStatus(status) || !isAllowedSchedulingStatus(status)) {
    return buildInvalidPlan(input, "terminal_action_immutable");
  }

  const schedulingDecision = input.schedulingResult?.decision;
  const schedulingReasons = Array.isArray(input.schedulingResult?.reasons) ? input.schedulingResult.reasons : [];
  const primaryReason = resolvePrimaryMutationReason(normalizePlanReasons(schedulingReasons as FollowUpMutationReason[]));

  if (schedulingDecision === "invalid") {
    return buildInvalidPlan(input, "invalid_scheduling_result");
  }

  if (schedulingDecision === "wait" || schedulingDecision === "ready") {
    return {
      planId: `followup-mutation-plan:${actionId}:${schedulingDecision}:${now.slice(0, 19).replace(/[:.]/g, "")}`,
      planType: "no_change",
      actionId,
      replacementActionId: null,
      operations: [],
      reasons: [],
      warnings: [],
      idempotency: {
        planKey: `followup-mutation:${actionId}:no_change:${schedulingDecision}:${now}`,
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
      createdAt: now
    };
  }

  if (schedulingDecision === "cancel") {
    if (isCustomerReplyAfterActionCreated(input)) {
      return buildCancellationPlan(input);
    }
    return buildCancellationPlan({
      ...input,
      schedulingResult: {
        ...input.schedulingResult,
        reasons: [...input.schedulingResult.reasons]
      }
    });
  }

  if (schedulingDecision === "expire") {
    return buildExpirationPlan(input);
  }

  if (schedulingDecision === "block") {
    return buildBlockingPlan(input);
  }

  if (schedulingDecision === "replan") {
    if (!input.schedulingResult.nextScheduledFor) {
      return buildInvalidPlan(input, "missing_next_schedule");
    }
    return buildReplanningPlan(input);
  }

  return buildInvalidPlan(input, primaryReason === "invalid_scheduling_result" ? "invalid_scheduling_result" : primaryReason);
}
