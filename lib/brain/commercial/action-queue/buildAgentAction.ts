import { createHash } from "node:crypto";
import {
  COMMERCIAL_AGENT_ACTION_QUEUE_VERSION,
} from "./constants";
import type {
  BuildAgentActionFromFollowUpPlanInput,
  BuildAgentActionFromNextActionInput,
  CrmAgentAction,
  CrmAgentActionBuildContext
} from "./types";
import { sanitizeAgentActionJsonValue } from "./serializeAgentAction";
import type { CommercialFollowUpPlan } from "../follow-up-planner";
import type { CommercialNextAction } from "../operational-loop";

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function asIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(typeof value === "bigint" ? Number(value) : (value as string | number));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asId(value: unknown): number | string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isSafeInteger(numeric) && String(numeric) === trimmed) return numeric;
    return trimmed;
  }
  return null;
}

function asChannel(value: unknown): CrmAgentAction["channel"] {
  const text = asText(value);
  if (
    text === "whatsapp" ||
    text === "email" ||
    text === "web" ||
    text === "phone" ||
    text === "pos" ||
    text === "hub" ||
    text === "campaign" ||
    text === "legacy" ||
    text === "internal" ||
    text === "unknown"
  ) {
    return text;
  }
  return "unknown";
}

function buildCreatedAt(context: CrmAgentActionBuildContext) {
  return asIso(context.currentTime) ?? new Date(0).toISOString();
}

function buildBaseAction(input: {
  actionType: CrmAgentAction["actionType"];
  status: CrmAgentAction["status"];
  channel: CrmAgentAction["channel"];
  riskLevel: CrmAgentAction["riskLevel"];
  approvalRequirement: CrmAgentAction["approvalRequirement"];
  opportunityId: number | string | null;
  decisionId: string | null;
  decisionRowId: number | null;
  conversationCaseId: number | string | null;
  messageId: string | null;
  waId: string | null;
  draftPayload: unknown;
  finalPayload: unknown | null;
  executionPayload: unknown | null;
  draftMessage: string | null;
  finalMessage: string | null;
  scheduledFor: string | null;
  expiresAt: string | null;
  attemptNumber: number;
  maxAttempts: number;
  followUpSequenceKey?: string | null;
  followUpConfigurationSource?: CrmAgentAction["followUpConfigurationSource"];
  followUpConfigurationId?: number | null;
  followUpConfigurationVersion?: number | null;
  followUpConfigurationHash?: string | null;
  blockReasons: string[];
  cancelReason: string | null;
  failureReason: string | null;
  policyStatus: string;
  policyNotes: string[];
  source: CrmAgentAction["source"];
  createdBy: CrmAgentAction["createdBy"];
  approvedBy: string | null;
  approvedAt: string | null;
  lifecycleVersion: string | null;
  policyVersion: string | null;
  runtimeVersion: string | null;
  createdAt: string;
  updatedAt: string | null;
  extra?: Record<string, unknown> | null;
}): CrmAgentAction {
  const seed = {
    actionType: input.actionType,
    status: input.status,
    channel: input.channel,
    riskLevel: input.riskLevel,
    approvalRequirement: input.approvalRequirement,
    opportunityId: input.opportunityId,
    decisionId: input.decisionId,
    decisionRowId: input.decisionRowId,
    conversationCaseId: input.conversationCaseId,
    messageId: input.messageId,
    waId: input.waId,
    draftPayload: input.draftPayload,
    finalPayload: input.finalPayload,
    executionPayload: input.executionPayload,
    draftMessage: input.draftMessage,
    finalMessage: input.finalMessage,
    scheduledFor: input.scheduledFor,
    expiresAt: input.expiresAt,
    attemptNumber: input.attemptNumber,
    maxAttempts: input.maxAttempts,
    blockReasons: input.blockReasons,
    cancelReason: input.cancelReason,
    failureReason: input.failureReason,
    policyStatus: input.policyStatus,
    policyNotes: input.policyNotes,
    source: input.source,
    createdBy: input.createdBy,
    approvedBy: input.approvedBy,
    approvedAt: input.approvedAt,
    lifecycleVersion: input.lifecycleVersion,
    policyVersion: input.policyVersion,
    runtimeVersion: input.runtimeVersion,
    createdAt: input.createdAt,
    extra: input.extra ?? null,
    queueVersion: COMMERCIAL_AGENT_ACTION_QUEUE_VERSION
  };
  const digest = createHash("sha256").update(JSON.stringify(sanitizeAgentActionJsonValue(seed).value ?? null)).digest("hex");
  const actionId = `crm-agent-action-${digest.slice(0, 24)}`;
  const idempotencyKey = `crm-agent-action:${digest}`;

  return {
    id: null,
    actionId,
    idempotencyKey,
    opportunityId: input.opportunityId,
    decisionId: input.decisionId,
    decisionRowId: input.decisionRowId,
    conversationCaseId: input.conversationCaseId,
    messageId: input.messageId,
    waId: input.waId,
    channel: input.channel,
    actionType: input.actionType,
    status: input.status,
    riskLevel: input.riskLevel,
    approvalRequirement: input.approvalRequirement,
    draftPayload: input.draftPayload,
    finalPayload: input.finalPayload,
    executionPayload: input.executionPayload,
    draftMessage: input.draftMessage,
    finalMessage: input.finalMessage,
    scheduledFor: input.scheduledFor,
    expiresAt: input.expiresAt,
    attemptNumber: input.attemptNumber,
    maxAttempts: input.maxAttempts,
    followUpSequenceKey: input.followUpSequenceKey ?? null,
    followUpConfigurationSource: input.followUpConfigurationSource ?? null,
    followUpConfigurationId: input.followUpConfigurationId ?? null,
    followUpConfigurationVersion: input.followUpConfigurationVersion ?? null,
    followUpConfigurationHash: input.followUpConfigurationHash ?? null,
    blockReasons: [...input.blockReasons],
    cancelReason: input.cancelReason,
    failureReason: input.failureReason,
    policyStatus: input.policyStatus,
    policyNotes: [...input.policyNotes],
    source: input.source,
    createdBy: input.createdBy,
    approvedBy: input.approvedBy,
    approvedAt: input.approvedAt,
    executedAt: null,
    cancelledAt: null,
    outboxMessageId: null,
    lifecycleVersion: input.lifecycleVersion,
    policyVersion: input.policyVersion,
    runtimeVersion: input.runtimeVersion,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
}

function normalizeContext(context: CrmAgentActionBuildContext) {
  return {
    opportunityId: asId(context.opportunityId),
    decisionId: asText(context.decisionId),
    decisionRowId: typeof context.decisionRowId === "number" && Number.isFinite(context.decisionRowId) ? context.decisionRowId : null,
    conversationCaseId: asId(context.conversationCaseId),
    messageId: asText(context.messageId),
    waId: asText(context.waId),
    channel: asChannel(context.channel ?? "unknown"),
    scheduledFor: asIso(context.scheduledFor),
    expiresAt: asIso(context.expiresAt),
    source: context.source ?? "ai_sdr",
    createdBy: context.createdBy ?? "ai",
    policyStatus: asText(context.policyStatus) ?? "unknown",
    policyVersion: asText(context.policyVersion),
    runtimeVersion: asText(context.runtimeVersion),
    lifecycleVersion: asText(context.lifecycleVersion) ?? COMMERCIAL_AGENT_ACTION_QUEUE_VERSION,
    approvedBy: asText(context.approvedBy),
    approvedAt: asIso(context.approvedAt),
    attemptNumber: Number.isInteger(context.attemptNumber ?? 1) && (context.attemptNumber ?? 1) > 0 ? Math.floor(context.attemptNumber ?? 1) : 1,
    maxAttempts: Number.isInteger(context.maxAttempts ?? 1) && (context.maxAttempts ?? 1) > 0 ? Math.floor(context.maxAttempts ?? 1) : 1,
    followUpSequenceKey: asText(context.followUpSequenceKey),
    followUpConfigurationSource: context.followUpConfigurationSource ?? null,
    followUpConfigurationId:
      typeof context.followUpConfigurationId === "number" && Number.isFinite(context.followUpConfigurationId) ? context.followUpConfigurationId : null,
    followUpConfigurationVersion:
      typeof context.followUpConfigurationVersion === "number" && Number.isFinite(context.followUpConfigurationVersion)
        ? context.followUpConfigurationVersion
        : null,
    followUpConfigurationHash: asText(context.followUpConfigurationHash),
    createdAt: buildCreatedAt(context),
    updatedAt: null
  };
}

function mapFollowUpStatus(planStatus: CommercialFollowUpPlan["status"]): CrmAgentAction["status"] {
  switch (planStatus) {
    case "recommended":
      return "proposed";
    case "requires_operator_review":
      return "requires_review";
    case "blocked":
      return "blocked";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
    case "invalid":
      return "blocked";
    case "not_needed":
    default:
      return "blocked";
  }
}

function mapNextActionType(nextActionType: CommercialNextAction["type"]): CrmAgentAction["actionType"] {
  switch (nextActionType) {
    case "respond":
      return "send_whatsapp_reply";
    case "ask_clarifying_question":
      return "request_more_context";
    case "qualify":
      return "create_internal_task";
    case "recommend_products":
      return "create_internal_task";
    case "prepare_quote":
      return "prepare_quote_draft";
    case "wait_for_customer":
      return "pause_ai";
    case "propose_followup":
      return "schedule_followup";
    case "escalate_to_operator":
      return "take_over_case";
    case "pause":
      return "pause_ai";
    case "close_as_lost_candidate":
      return "mark_lost_candidate";
    case "no_action":
    default:
      return "no_action";
  }
}

function deriveActionStatusFromGovernance(input: {
  baseStatus: CrmAgentAction["status"];
  approvalRequirement: string;
  blockReasons: string[];
  actionType: CrmAgentAction["actionType"];
}): CrmAgentAction["status"] {
  if (input.actionType === "no_action") return "blocked";
  if (input.blockReasons.length > 0 || input.approvalRequirement === "blocked") return "blocked";
  if (input.approvalRequirement === "manager_review" || input.approvalRequirement === "operator_review" || input.approvalRequirement === "explicit_operator_approval") return "requires_review";
  return input.baseStatus;
}

export function buildAgentActionFromFollowUpPlan(input: BuildAgentActionFromFollowUpPlanInput): CrmAgentAction {
  const normalizedContext = normalizeContext(input.context);
  const plan = input.plan;
  const actionType = plan.status === "not_needed" ? "no_action" : "schedule_followup";
  const baseStatus = mapFollowUpStatus(plan.status);
  const blockReasons = [...plan.blockReasons];
  const approvalRequirement = plan.approvalRequirement;
  if (plan.status === "not_needed") {
    blockReasons.push("no_commercial_opportunity");
  }
  if (plan.channel === "whatsapp" && !normalizedContext.waId) {
    blockReasons.push("missing_customer_identity");
  }
  const status = deriveActionStatusFromGovernance({
    baseStatus,
    approvalRequirement,
    blockReasons,
    actionType
  });
  const policyStatus =
    status === "blocked"
      ? "blocked"
      : status === "requires_review"
        ? "requires_review"
        : status === "cancelled"
          ? "cancelled"
          : status === "expired"
            ? "expired"
            : "allowed";

  return buildBaseAction({
    actionType,
    status,
    channel: plan.channel,
    riskLevel: plan.riskLevel,
    approvalRequirement,
    opportunityId: asId(plan.opportunityId),
    decisionId: asText(plan.decisionId),
    decisionRowId: normalizedContext.decisionRowId,
    conversationCaseId: asId(plan.caseId),
    messageId: asText(plan.messageId),
    waId: plan.channel === "whatsapp" ? normalizedContext.waId : null,
    draftPayload: plan,
    finalPayload: null,
    executionPayload: null,
    draftMessage: plan.draftMessage,
    finalMessage: null,
    scheduledFor: plan.scheduledFor,
    expiresAt: null,
    attemptNumber: plan.attemptNumber,
    maxAttempts: plan.maxAttempts,
    blockReasons: uniqueTextArray(blockReasons),
    cancelReason: plan.cancelReason,
    failureReason: status === "blocked" ? plan.rationale : null,
    policyStatus,
    policyNotes: [...plan.policyNotes],
    source: normalizedContext.source,
    createdBy: normalizedContext.createdBy,
    approvedBy: normalizedContext.approvedBy,
    approvedAt: normalizedContext.approvedAt,
    lifecycleVersion: normalizedContext.lifecycleVersion,
    policyVersion: normalizedContext.policyVersion,
    runtimeVersion: normalizedContext.runtimeVersion,
    createdAt: normalizedContext.createdAt,
    updatedAt: null,
    extra: {
      planner: "follow_up"
    }
  });
}

export function buildAgentActionFromNextAction(input: BuildAgentActionFromNextActionInput): CrmAgentAction {
  const normalizedContext = normalizeContext(input.context);
  const nextAction = input.nextAction;
  const actionType = mapNextActionType(nextAction.type);
  const blockReasons = [...nextAction.blockedReasons];
  if (actionType === "no_action") {
    blockReasons.push("no_action");
  }
  if (nextAction.recommendedChannel === "whatsapp" && !normalizedContext.waId) {
    blockReasons.push("missing_customer_identity");
  }
  const baseStatus =
    nextAction.approvalRequirement === "blocked" || blockReasons.length > 0
      ? "blocked"
      : nextAction.approvalRequirement === "explicit_operator_approval" || nextAction.approvalRequirement === "operator_review"
        ? "requires_review"
        : actionType === "schedule_followup"
          ? "planned"
        : "proposed";
  const status = deriveActionStatusFromGovernance({
    baseStatus,
    approvalRequirement: nextAction.approvalRequirement,
    blockReasons,
    actionType
  });
  /**
   * ACS-R1-05-T06.2: `normalizedContext.policyStatus` is threaded straight
   * from `commercialPolicyResult.status` via
   * `loop.decisionRecord.policyStatus` (runCommercialOperationalLoop.ts) -
   * the same single authority already written to
   * `crm_agent_decisions.policy_status`. Recomputing a second, narrower
   * value here from `status` alone (previously done unconditionally) could
   * never express `allowed_with_restrictions`/`failed_safe` and let the
   * decision/action rows diverge whenever the real policy status was one of
   * those two. Only fall back to the local derivation when no real
   * governing status was propagated at all.
   */
  const policyStatus =
    normalizedContext.policyStatus !== "unknown"
      ? normalizedContext.policyStatus
      : status === "blocked"
        ? "blocked"
        : status === "requires_review"
          ? "requires_review"
          : status === "cancelled"
            ? "cancelled"
            : status === "expired"
              ? "expired"
              : "allowed";
  const draftPayload = sanitizeAgentActionJsonValue({
    nextAction,
    recommendedChannel: nextAction.recommendedChannel,
    recommendedRecipient: normalizedContext.waId
  }).value;

  return buildBaseAction({
    actionType,
    status,
    channel: nextAction.recommendedChannel,
    riskLevel: nextAction.riskLevel,
    approvalRequirement: nextAction.approvalRequirement,
    opportunityId: normalizedContext.opportunityId,
    decisionId: normalizedContext.decisionId,
    decisionRowId: normalizedContext.decisionRowId,
    conversationCaseId: normalizedContext.conversationCaseId,
    messageId: normalizedContext.messageId,
    waId: nextAction.recommendedChannel === "whatsapp" ? normalizedContext.waId : null,
    draftPayload,
    finalPayload: null,
    executionPayload: null,
    draftMessage: nextAction.draftMessage,
    finalMessage: null,
    scheduledFor: normalizedContext.scheduledFor,
    expiresAt: normalizedContext.expiresAt,
    attemptNumber: normalizedContext.attemptNumber,
    maxAttempts: normalizedContext.maxAttempts,
    followUpSequenceKey: normalizedContext.followUpSequenceKey,
    followUpConfigurationSource: normalizedContext.followUpConfigurationSource,
    followUpConfigurationId: normalizedContext.followUpConfigurationId,
    followUpConfigurationVersion: normalizedContext.followUpConfigurationVersion,
    followUpConfigurationHash: normalizedContext.followUpConfigurationHash,
    blockReasons: uniqueTextArray(blockReasons),
    cancelReason: null,
    failureReason: status === "blocked" ? nextAction.reason : null,
    policyStatus,
    policyNotes: [nextAction.reason],
    source: normalizedContext.source,
    createdBy: normalizedContext.createdBy,
    approvedBy: normalizedContext.approvedBy,
    approvedAt: normalizedContext.approvedAt,
    lifecycleVersion: normalizedContext.lifecycleVersion,
    policyVersion: normalizedContext.policyVersion,
    runtimeVersion: normalizedContext.runtimeVersion,
    createdAt: normalizedContext.createdAt,
    updatedAt: null,
    extra: {
      nextActionType: nextAction.type
    }
  });
}

function uniqueTextArray(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
