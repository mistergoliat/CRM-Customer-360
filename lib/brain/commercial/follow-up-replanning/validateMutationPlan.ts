import {
  COMMERCIAL_FOLLOW_UP_MUTATION_OPERATION_TYPES,
  COMMERCIAL_FOLLOW_UP_MUTATION_PLAN_TYPES,
  COMMERCIAL_FOLLOW_UP_MUTATION_REASONS,
  asIso,
  isRecord,
  normalizePlanReasons
} from "./constants";
import type {
  FollowUpActionPatch,
  FollowUpMutationPlan,
  FollowUpMutationPlanType,
  FollowUpMutationReason,
  FollowUpMutationValidationResult,
  FollowUpReplacementActionDraft
} from "./types";

function buildResult(valid: boolean, reason: string, plan: FollowUpMutationPlan | null, warnings: string[] = []): FollowUpMutationValidationResult {
  return {
    valid,
    reason,
    warnings: [...new Set(warnings)],
    plan
  };
}

function isPlanType(value: unknown): value is FollowUpMutationPlanType {
  return typeof value === "string" && (COMMERCIAL_FOLLOW_UP_MUTATION_PLAN_TYPES as readonly string[]).includes(value);
}

function isActionPatch(value: unknown): value is FollowUpActionPatch {
  return isRecord(value) && typeof value.actionId === "string" && Array.isArray(value.expectedStatuses) && typeof value.nextStatus === "string" && typeof value.updatedAt === "string";
}

function isReplacementDraft(value: unknown): value is FollowUpReplacementActionDraft {
  return isRecord(value) && typeof value.actionId === "string" && typeof value.idempotencyKey === "string" && typeof value.parentActionId === "string" && typeof value.scheduledFor === "string";
}

export function validateFollowUpMutationPlan(value: unknown): FollowUpMutationValidationResult {
  if (!isRecord(value)) {
    return buildResult(false, "invalid_root", null);
  }

  const plan = value as FollowUpMutationPlan;
  if (!isPlanType(plan.planType)) return buildResult(false, "invalid_root", null);
  if (typeof plan.planId !== "string" || plan.planId.trim().length === 0) return buildResult(false, "invalid_root", null);
  if (typeof plan.actionId !== "string" || plan.actionId.trim().length === 0) return buildResult(false, "invalid_root", null);
  if (!plan.idempotency || typeof plan.idempotency.planKey !== "string" || plan.idempotency.planKey.trim().length === 0 || plan.idempotency.deterministic !== true) {
    return buildResult(false, "invalid_root", null);
  }
  if (!Array.isArray(plan.operations)) return buildResult(false, "invalid_root", null);
  if (!Array.isArray(plan.reasons)) return buildResult(false, "invalid_root", null);
  if (!Array.isArray(plan.warnings)) return buildResult(false, "invalid_root", null);
  if (!asIso(plan.createdAt)) return buildResult(false, "invalid_root", null);
  if (plan.sideEffects.databaseWritten !== false || plan.sideEffects.actionMutated !== false || plan.sideEffects.actionInserted !== false || plan.sideEffects.outboxWritten !== false || plan.sideEffects.messageSent !== false || plan.sideEffects.workerTriggered !== false) {
    return buildResult(false, "invalid_root", null);
  }

  const reasons = normalizePlanReasons(plan.reasons as FollowUpMutationReason[]);
  if (reasons.some((reason) => !(COMMERCIAL_FOLLOW_UP_MUTATION_REASONS as readonly string[]).includes(reason))) {
    return buildResult(false, "invalid_root", null);
  }

  if (plan.planType === "no_change") {
    if (plan.operations.length !== 0) return buildResult(false, "invalid_root", null);
    if (plan.replacementActionId !== null) return buildResult(false, "invalid_root", null);
    return buildResult(true, "valid", plan, plan.warnings);
  }

  let replacementActionId: string | null = null;
  let sawUpdate = false;
  let sawReplacement = false;
  let sawAudit = false;

  for (const operation of plan.operations) {
    if (!isRecord(operation) || typeof operation.type !== "string" || !(COMMERCIAL_FOLLOW_UP_MUTATION_OPERATION_TYPES as readonly string[]).includes(operation.type)) {
      return buildResult(false, "invalid_root", null);
    }
    if (operation.type === "update_existing_action") {
      if (sawUpdate) return buildResult(false, "invalid_root", null);
      sawUpdate = true;
      if (!isActionPatch(operation.patch)) return buildResult(false, "invalid_root", null);
      if (operation.patch.actionId !== plan.actionId) return buildResult(false, "invalid_root", null);
      if (operation.patch.expectedStatuses.length === 0) return buildResult(false, "invalid_root", null);
      if (!asIso(operation.patch.updatedAt)) return buildResult(false, "invalid_root", null);
    } else if (operation.type === "create_replacement_action") {
      if (sawReplacement) return buildResult(false, "invalid_root", null);
      sawReplacement = true;
      if (!isReplacementDraft(operation.action)) return buildResult(false, "invalid_root", null);
      if (operation.action.parentActionId !== plan.actionId) return buildResult(false, "invalid_root", null);
      if (!asIso(operation.action.createdAt) || !asIso(operation.action.updatedAt)) return buildResult(false, "invalid_root", null);
      if (operation.action.actionId === plan.actionId) return buildResult(false, "invalid_root", null);
      replacementActionId = operation.action.actionId;
    } else if (operation.type === "append_audit_event") {
      sawAudit = true;
      if (!isRecord(operation.event) || typeof operation.event.eventId !== "string" || typeof operation.event.actionId !== "string" || typeof operation.event.createdAt !== "string") {
        return buildResult(false, "invalid_root", null);
      }
      if (operation.event.actionId !== plan.actionId) return buildResult(false, "invalid_root", null);
      if (replacementActionId !== null && operation.event.replacementActionId !== null && operation.event.replacementActionId !== replacementActionId) {
        return buildResult(false, "invalid_root", null);
      }
      if (!asIso(operation.event.createdAt)) return buildResult(false, "invalid_root", null);
    }
  }

  if (!sawUpdate) return buildResult(false, "invalid_root", null);
  if ((plan.planType === "supersede_action" || plan.planType === "cancel_and_create_replacement") && !sawReplacement) {
    return buildResult(false, "invalid_root", null);
  }
  if ((plan.planType === "supersede_action" || plan.planType === "cancel_and_create_replacement") && plan.replacementActionId === null) {
    return buildResult(false, "invalid_root", null);
  }
  if ((plan.planType === "replan_action" || plan.planType === "cancel_action" || plan.planType === "expire_action" || plan.planType === "block_action") && plan.replacementActionId !== null) {
    return buildResult(false, "invalid_root", null);
  }
  if ((plan.planType === "replan_action" || plan.planType === "supersede_action" || plan.planType === "cancel_and_create_replacement") && !sawAudit && plan.warnings.length === 0) {
    return buildResult(false, "invalid_root", null);
  }

  return buildResult(true, "valid", plan, plan.warnings);
}
