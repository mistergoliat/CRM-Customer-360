import {
  FOLLOW_UP_SCHEDULING_ALLOWED_STATUSES,
  FOLLOW_UP_SCHEDULING_APPROVAL_REQUIREMENTS,
  FOLLOW_UP_SCHEDULING_RISK_LEVELS,
  FOLLOW_UP_SCHEDULING_SUPPORTED_ACTION_TYPES
} from "./constants";
import type {
  FollowUpSchedulingCandidate,
  FollowUpSchedulingCandidateValidationResult,
  FollowUpSchedulingInput,
  FollowUpSchedulingReason
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseIso(value: string | null | undefined): string | null {
  const text = trimText(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  for (const item of value) {
    const text = trimText(item);
    if (text && !output.includes(text)) {
      output.push(text);
    }
  }
  return output;
}

function hasAllowedValue(values: readonly string[], value: unknown): value is string {
  return typeof value === "string" && values.includes(value);
}

function fail(reason: FollowUpSchedulingReason): FollowUpSchedulingCandidateValidationResult {
  return {
    valid: false,
    reason,
    candidate: null,
    warnings: []
  };
}

export function validateFollowUpCandidate(input: FollowUpSchedulingInput): FollowUpSchedulingCandidateValidationResult {
  if (!isRecord(input)) {
    return fail("invalid_timestamp");
  }

  const now = parseIso(input.now);
  if (!now) return fail("invalid_timestamp");

  const action = input.action;
  if (!isRecord(action)) return fail("invalid_timestamp");

  const createdAt = parseIso(action.createdAt);
  if (!createdAt) return fail("invalid_timestamp");

  const updatedAt = action.updatedAt === null || action.updatedAt === undefined ? null : parseIso(action.updatedAt);
  if (action.updatedAt !== null && action.updatedAt !== undefined && !updatedAt) return fail("invalid_timestamp");

  const scheduledFor = action.scheduledFor === null || action.scheduledFor === undefined ? null : parseIso(action.scheduledFor);
  if (action.scheduledFor !== null && action.scheduledFor !== undefined && !scheduledFor) return fail("invalid_timestamp");

  const expiresAt = action.expiresAt === null || action.expiresAt === undefined ? null : parseIso(action.expiresAt);
  if (action.expiresAt !== null && action.expiresAt !== undefined && !expiresAt) return fail("invalid_timestamp");

  const lastInboundAt = input.activity?.lastInboundAt === null || input.activity?.lastInboundAt === undefined ? null : parseIso(input.activity.lastInboundAt);
  if (input.activity?.lastInboundAt !== null && input.activity?.lastInboundAt !== undefined && !lastInboundAt) return fail("invalid_timestamp");

  const lastOutboundAt = input.activity?.lastOutboundAt === null || input.activity?.lastOutboundAt === undefined ? null : parseIso(input.activity.lastOutboundAt);
  if (input.activity?.lastOutboundAt !== null && input.activity?.lastOutboundAt !== undefined && !lastOutboundAt) return fail("invalid_timestamp");

  const lastHumanMessageAt =
    input.activity?.lastHumanMessageAt === null || input.activity?.lastHumanMessageAt === undefined ? null : parseIso(input.activity.lastHumanMessageAt);
  if (input.activity?.lastHumanMessageAt !== null && input.activity?.lastHumanMessageAt !== undefined && !lastHumanMessageAt) return fail("invalid_timestamp");

  const lastAiMessageAt = input.activity?.lastAiMessageAt === null || input.activity?.lastAiMessageAt === undefined ? null : parseIso(input.activity.lastAiMessageAt);
  if (input.activity?.lastAiMessageAt !== null && input.activity?.lastAiMessageAt !== undefined && !lastAiMessageAt) return fail("invalid_timestamp");

  const opportunityStageChangedAt =
    input.context?.opportunityStageChangedAt === null || input.context?.opportunityStageChangedAt === undefined
      ? null
      : parseIso(input.context.opportunityStageChangedAt);
  if (input.context?.opportunityStageChangedAt !== null && input.context?.opportunityStageChangedAt !== undefined && !opportunityStageChangedAt) {
    return fail("invalid_timestamp");
  }

  const actionId = trimText(action.actionId);
  if (!actionId) return fail("missing_action_id");

  const idempotencyKey = trimText(action.idempotencyKey);
  if (!idempotencyKey) return fail("missing_idempotency_key");

  const actionType = trimText(action.actionType);
  if (!actionType || !hasAllowedValue(FOLLOW_UP_SCHEDULING_SUPPORTED_ACTION_TYPES, actionType)) {
    return fail("unsupported_action_type");
  }

  const status = trimText(action.status);
  if (!status || !hasAllowedValue(FOLLOW_UP_SCHEDULING_ALLOWED_STATUSES, status)) {
    return fail("invalid_action_status");
  }

  const attemptCount = Number.isFinite(action.attemptCount) ? Math.max(0, Math.trunc(action.attemptCount)) : 0;
  const maxAttempts = Number.isFinite(action.maxAttempts) ? Math.max(0, Math.trunc(action.maxAttempts)) : 0;

  const candidate: FollowUpSchedulingCandidate = {
    now,
    nowMs: new Date(now).getTime(),
    actionId,
    idempotencyKey,
    actionType: actionType as FollowUpSchedulingCandidate["actionType"],
    status: status as FollowUpSchedulingCandidate["status"],
    createdAt,
    createdAtMs: new Date(createdAt).getTime(),
    updatedAt,
    updatedAtMs: updatedAt ? new Date(updatedAt).getTime() : null,
    scheduledFor,
    scheduledForMs: scheduledFor ? new Date(scheduledFor).getTime() : null,
    expiresAt,
    expiresAtMs: expiresAt ? new Date(expiresAt).getTime() : null,
    attemptCount,
    maxAttempts,
    riskLevel: trimText(action.riskLevel) ?? "unknown",
    approvalRequirement: trimText(action.approvalRequirement) ?? "blocked",
    opportunityId: action.opportunityId ?? null,
    conversationCaseId: action.conversationCaseId ?? null,
    waId: action.waId === null || action.waId === undefined ? null : trimText(action.waId),
    blockReasons: normalizeTextArray(action.blockReasons),
    cancelReason: action.cancelReason === null || action.cancelReason === undefined ? null : trimText(action.cancelReason),
    activity: {
      lastInboundAt,
      lastInboundAtMs: lastInboundAt ? new Date(lastInboundAt).getTime() : null,
      lastOutboundAt,
      lastOutboundAtMs: lastOutboundAt ? new Date(lastOutboundAt).getTime() : null,
      lastHumanMessageAt,
      lastHumanMessageAtMs: lastHumanMessageAt ? new Date(lastHumanMessageAt).getTime() : null,
      lastAiMessageAt,
      lastAiMessageAtMs: lastAiMessageAt ? new Date(lastAiMessageAt).getTime() : null
    },
    context: {
      caseStatus: trimText(input.context?.caseStatus),
      lifecycleStatus: trimText(input.context?.lifecycleStatus),
      humanOwnerActive: Boolean(input.context?.humanOwnerActive),
      aiBlocked: Boolean(input.context?.aiBlocked),
      requiresHuman: Boolean(input.context?.requiresHuman),
      opportunityStatus: trimText(input.context?.opportunityStatus),
      opportunityStage: trimText(input.context?.opportunityStage),
      opportunityStageChangedAt,
      opportunityStageChangedAtMs: opportunityStageChangedAt ? new Date(opportunityStageChangedAt).getTime() : null,
      policyStatus: trimText(input.context?.policyStatus),
      conflictingActionExists: Boolean(input.context?.conflictingActionExists),
      duplicateActionExists: Boolean(input.context?.duplicateActionExists)
    },
    policy: {
      followUpEnabled: Boolean(input.policy?.followUpEnabled),
      allowedActionTypes: Array.isArray(input.policy?.allowedActionTypes)
        ? normalizeTextArray(input.policy.allowedActionTypes)
        : [],
      maxRiskLevel: trimText(input.policy?.maxRiskLevel) ?? "unknown",
      cooldownMinutesAfterInbound: Number.isFinite(input.policy?.cooldownMinutesAfterInbound)
        ? Math.max(0, Math.trunc(input.policy.cooldownMinutesAfterInbound))
        : 0,
      cooldownMinutesAfterOutbound: Number.isFinite(input.policy?.cooldownMinutesAfterOutbound)
        ? Math.max(0, Math.trunc(input.policy.cooldownMinutesAfterOutbound))
        : 0,
      businessHoursEnabled: Boolean(input.policy?.businessHoursEnabled),
      businessTimezone: trimText(input.policy?.businessTimezone) ?? "UTC",
      businessDays: Array.isArray(input.policy?.businessDays)
        ? input.policy.businessDays
            .filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)
            .filter((day, index, array) => array.indexOf(day) === index)
        : [],
      businessStartHour: Number.isFinite(input.policy?.businessStartHour) ? Math.max(0, Math.trunc(input.policy.businessStartHour)) : 0,
      businessEndHour: Number.isFinite(input.policy?.businessEndHour) ? Math.max(0, Math.trunc(input.policy.businessEndHour)) : 0,
      replanOutsideBusinessHours: Boolean(input.policy?.replanOutsideBusinessHours),
      replanAfterCooldown: Boolean(input.policy?.replanAfterCooldown),
      requireExpiry: Boolean(input.policy?.requireExpiry),
      maxFutureDays: Number.isFinite(input.policy?.maxFutureDays) ? Math.max(0, Math.trunc(input.policy.maxFutureDays)) : 0
    }
  };

  if (!FOLLOW_UP_SCHEDULING_RISK_LEVELS.includes(candidate.riskLevel as (typeof FOLLOW_UP_SCHEDULING_RISK_LEVELS)[number])) {
    candidate.riskLevel = "unknown";
  }
  if (
    !FOLLOW_UP_SCHEDULING_APPROVAL_REQUIREMENTS.includes(
      candidate.approvalRequirement as (typeof FOLLOW_UP_SCHEDULING_APPROVAL_REQUIREMENTS)[number]
    )
  ) {
    candidate.approvalRequirement = "blocked";
  }

  return {
    valid: true,
    reason: "scheduled_time_not_reached",
    candidate,
    warnings: []
  };
}
