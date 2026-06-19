import { buildAgentActionFromFollowUpPlan, buildAgentActionFromNextAction } from "./buildAgentAction";
import { loadAgentActions } from "./loadAgentActions";
import { COMMERCIAL_AGENT_ACTION_QUEUE_MAX_TEXT_LENGTH, COMMERCIAL_AGENT_ACTION_QUEUE_VIEW_MODEL_MAX_ITEMS } from "./constants";
import {
  buildSandboxAutonomyConfig,
  evaluateAgentActionForSandbox,
  type SandboxAutonomyConfig,
  type SandboxAutonomyEligibilityStatus
} from "../autonomy-sandbox";
import type {
  ActionQueueBuildInput,
  ActionQueueItemSource,
  ActionQueueItemViewModel,
  ActionQueueViewModel,
  ActionQueueViewModelOrigin,
  ActionQueueViewModelStatus,
  CrmAgentAction,
  CrmAgentActionBuildContext,
  LoadAgentActionsResult
} from "./types";
import { planCommercialFollowUp, type CommercialFollowUpPlanningInput } from "../follow-up-planner";
import { COMMERCIAL_OPERATIONAL_LOOP_NEXT_ACTION_TYPES } from "../operational-loop/constants";
import type { CommercialNextAction } from "../operational-loop/types";
import { COMMERCIAL_POLICY_APPROVAL_REQUIREMENTS, COMMERCIAL_POLICY_RISK_LEVELS } from "../policy/policyConstants";
import { SALES_AGENT_CONFIDENCE_LEVELS } from "../salesAgentConstants";

type RecordLike = Record<string, unknown>;

function isRecord(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown, maxLength = COMMERCIAL_AGENT_ACTION_QUEUE_MAX_TEXT_LENGTH): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const sanitized = trimmed
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
      .replace(/\b(sk-[A-Za-z0-9_-]+)\b/gi, "[redacted]")
      .replace(/\b(authorization|api[-_]?key|token|secret|password|cookie)\s*[:=]?\s*[^\s,;]+/gi, "[redacted]");
    return sanitized.length > maxLength ? `${sanitized.slice(0, maxLength)}...` : sanitized;
  }
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return String(value);
  return null;
}

function asIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const parsed = new Date(typeof value === "bigint" ? Number(value) : (value as string | number));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "bigint") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asId(value: unknown): string | number | null {
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

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()))];
}

function parseJsonCandidate(value: unknown): RecordLike | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readCandidate(row: RecordLike, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function normalizeConfidence(value: unknown): CommercialNextAction["confidence"] {
  const text = asText(value);
  if (text && (SALES_AGENT_CONFIDENCE_LEVELS as readonly string[]).includes(text)) return text as CommercialNextAction["confidence"];
  return "low";
}

function normalizeRiskLevel(value: unknown): CommercialNextAction["riskLevel"] {
  const text = asText(value);
  if (text && (COMMERCIAL_POLICY_RISK_LEVELS as readonly string[]).includes(text)) return text as CommercialNextAction["riskLevel"];
  return "blocked";
}

function normalizeApprovalRequirement(value: unknown): CommercialNextAction["approvalRequirement"] {
  const text = asText(value);
  if (text && (COMMERCIAL_POLICY_APPROVAL_REQUIREMENTS as readonly string[]).includes(text)) {
    return text as CommercialNextAction["approvalRequirement"];
  }
  return "blocked";
}

function normalizeNextActionType(value: unknown): CommercialNextAction["type"] {
  const text = asText(value);
  if (text && (COMMERCIAL_OPERATIONAL_LOOP_NEXT_ACTION_TYPES as readonly string[]).includes(text)) {
    return text as CommercialNextAction["type"];
  }
  return "no_action";
}

function normalizeActionChannel(value: unknown, fallback: CrmAgentAction["channel"]): CrmAgentAction["channel"] {
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
  return fallback;
}

function normalizeRecommendedChannel(value: unknown, fallback: CommercialNextAction["recommendedChannel"]): CommercialNextAction["recommendedChannel"] {
  const text = asText(value);
  if (text === "whatsapp" || text === "email" || text === "web" || text === "phone" || text === "pos" || text === "hub" || text === "campaign" || text === "legacy" || text === "unknown") {
    return text;
  }
  return fallback;
}

function normalizeFollowUpChannel(value: unknown): CommercialFollowUpPlanningInput["conversation"]["channel"] {
  const text = asText(value);
  if (text === "whatsapp" || text === "email" || text === "internal" || text === "unknown") return text;
  return "unknown";
}

function buildCurrentTime(input: ActionQueueBuildInput) {
  return asIso(input.currentTime) ?? asIso(readCandidate(input.caseRow, ["updated_at", "last_message_at", "created_at"])) ?? new Date(0).toISOString();
}

function extractOperationalResult(input: ActionQueueBuildInput): RecordLike | null {
  const candidates = [
    input.commercialOperationalResult,
    input.caseRow.commercial_operational_result,
    input.caseRow.commercialOperationalResult,
    input.caseRow.commercial_operational_loop,
    input.caseRow.commercialOperationalLoop,
    input.caseRow.commercial_operational_loop_result,
    input.caseRow.operational_result,
    input.caseRow.operationalResult
  ];
  for (const candidate of candidates) {
    const parsed = parseJsonCandidate(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function buildActionContext(input: ActionQueueBuildInput, overrides: Partial<CrmAgentActionBuildContext> = {}): CrmAgentActionBuildContext {
  const operationalResult = extractOperationalResult(input);
  const resultingState = parseJsonCandidate(operationalResult?.resultingState) ?? parseJsonCandidate(operationalResult?.commercialState) ?? parseJsonCandidate(operationalResult?.state);

  return {
    currentTime: buildCurrentTime(input),
    timezone: input.timezone?.trim() || "UTC",
    opportunityId:
      asId(readCandidate(resultingState ?? {}, ["opportunityId", "opportunity_id"]) ?? readCandidate(input.caseRow, ["opportunity_id", "opportunityId"])) ?? null,
    decisionId: asText(readCandidate(operationalResult ?? {}, ["decisionId", "decision_id"]) ?? readCandidate(input.caseRow, ["last_agent_decision_id", "lastAgentDecisionId"])),
    decisionRowId: asNumber(readCandidate(input.caseRow, ["last_agent_decision_row_id", "decision_row_id", "decisionRowId"])) ?? null,
    conversationCaseId:
      asId(readCandidate(input.caseRow, ["conversation_case_id", "case_id", "id"]) ?? readCandidate(resultingState ?? {}, ["conversationCaseId", "caseId"])) ?? null,
    messageId: asText(readCandidate(operationalResult ?? {}, ["messageId", "message_id"]) ?? readCandidate(input.caseRow, ["last_customer_message_id", "message_id", "messageId"])),
    waId: asText(readCandidate(input.caseRow, ["wa_id", "waId"])),
    channel: normalizeActionChannel(readCandidate(input.caseRow, ["channel", "platform"]) ?? "unknown", "unknown"),
    scheduledFor: null,
    expiresAt: null,
    source: "ai_sdr",
    createdBy: "ai",
    policyStatus: asText(readCandidate(operationalResult ?? {}, ["policyStatus", "policy_status"])) ?? "unknown",
    policyVersion: null,
    runtimeVersion: null,
    lifecycleVersion: null,
    approvedBy: null,
    approvedAt: null,
    attemptNumber: 1,
    maxAttempts: 1,
    metadata: null,
    ...overrides
  };
}

type SandboxActionEnvelope = {
  action: CrmAgentAction;
  source: ActionQueueItemSource;
  persisted: boolean;
  sandboxAutonomy: ReturnType<typeof evaluateAgentActionForSandbox>;
};

function normalizeSandboxConfig(config?: SandboxAutonomyConfig | null): SandboxAutonomyConfig {
  return buildSandboxAutonomyConfig({
    sandboxEnabled: config?.sandboxEnabled ?? false,
    autonomousReplyEnabled: config?.autonomousReplyEnabled ?? false,
    whitelistedWaIds: Array.isArray(config?.whitelistedWaIds) ? [...config.whitelistedWaIds] : [],
    allowedActionTypes: Array.isArray(config?.allowedActionTypes) && config.allowedActionTypes.length > 0
      ? [...config.allowedActionTypes]
      : [...buildSandboxAutonomyConfig().allowedActionTypes],
    maxRiskLevel: typeof config?.maxRiskLevel === "string" && config.maxRiskLevel.trim() ? config.maxRiskLevel.trim() : "low"
  });
}

function buildSandboxReadinessSummary(config: SandboxAutonomyConfig): { status: SandboxAutonomyEligibilityStatus; note: string } {
  if (!config.sandboxEnabled) {
    return { status: "disabled", note: "Sandbox autonomy disabled." };
  }
  if (!config.autonomousReplyEnabled) {
    return { status: "disabled", note: "Autonomous reply disabled." };
  }
  if (config.maxRiskLevel.trim().toLowerCase() !== "low") {
    return { status: "invalid", note: "Sandbox autonomy config is fail-closed until max risk is low." };
  }
  return { status: "eligible", note: "Sandbox autonomy preview only. Execution disabled in the current milestone." };
}

function buildItem(
  action: CrmAgentAction,
  source: ActionQueueItemSource,
  persisted: boolean,
  sandboxAutonomy: ReturnType<typeof evaluateAgentActionForSandbox>
): ActionQueueItemViewModel {
  return {
    actionId: action.actionId,
    actionType: action.actionType,
    status: action.status,
    riskLevel: action.riskLevel,
    approvalRequirement: action.approvalRequirement,
    draftMessage: action.draftMessage,
    scheduledFor: action.scheduledFor,
    blockReasons: uniqueStrings(action.blockReasons),
    cancelReason: action.cancelReason,
    rationale: action.failureReason ?? action.policyNotes[0] ?? null,
    idempotencyKey: action.idempotencyKey,
    persisted,
    executable: false,
    source,
    sandboxAutonomy
  };
}

function buildPermissionErrorFlag(error: string | null) {
  if (!error) return false;
  const text = error.toLowerCase();
  return (
    text.includes("access denied") ||
    text.includes("permission denied") ||
    text.includes("not allowed") ||
    text.includes("select command denied") ||
    text.includes("insert command denied") ||
    text.includes("update command denied") ||
    text.includes("delete command denied")
  );
}

function sanitizeError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/\b(sk-[A-Za-z0-9_-]+)\b/gi, "[redacted]")
    .replace(/\b(authorization|api[-_]?key|token|secret|password|cookie)\s*[:=]?\s*[^\s,;]+/gi, "[redacted]")
    .trim();
}

function actionSource(action: CrmAgentAction, persistedIds: Set<string>) {
  if (persistedIds.has(action.actionId)) return "crm_agent_actions" as const;
  if (action.idempotencyKey.includes("followup")) return "follow_up_planner" as const;
  return "next_action_json" as const;
}

function dedupeActions<T extends { action: CrmAgentAction; source: ActionQueueItemSource; persisted: boolean }>(items: T[]) {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const item of items) {
    const key = item.action.idempotencyKey || item.action.actionId;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function buildNextActionPreview(input: ActionQueueBuildInput): { action: CrmAgentAction; source: ActionQueueItemSource } | null {
  const operationalResult = extractOperationalResult(input);
  if (!operationalResult) return null;
  const decisionRecord = parseJsonCandidate(operationalResult.decisionRecord) ?? parseJsonCandidate(operationalResult.decision_record);
  const candidate =
    parseJsonCandidate(operationalResult.selectedNextAction) ??
    parseJsonCandidate(operationalResult.nextAction) ??
    parseJsonCandidate(decisionRecord?.nextAction) ??
    parseJsonCandidate(decisionRecord?.next_action);
  if (!candidate) return null;
  const candidateRecord = candidate as RecordLike;

  const type = normalizeNextActionType(candidateRecord.type ?? candidateRecord.nextActionType ?? candidateRecord.actionType);
  const reason = asText(candidateRecord.reason ?? candidateRecord.rationale ?? candidateRecord.message, 2000) ?? "Preview desde next_action_json.";
  const responseProposal = isRecord(candidateRecord.responseProposal) ? candidateRecord.responseProposal : null;
  const draftMessage = asText(candidateRecord.draftMessage ?? candidateRecord.draftText ?? candidateRecord.responseDraft ?? responseProposal?.draftText, 1200);
  const blockedReasons = uniqueStrings([
    ...(Array.isArray(candidateRecord.blockedReasons) ? candidateRecord.blockedReasons : []),
    ...(Array.isArray(candidateRecord.blocked_reason_codes) ? candidateRecord.blocked_reason_codes : [])
  ]);

  if (type === "no_action" && blockedReasons.length === 0 && !draftMessage) return null;

  return {
    source: "next_action_json",
    action: buildAgentActionFromNextAction({
      nextAction: {
        type,
        reason,
        confidence: normalizeConfidence(candidateRecord.confidence ?? candidateRecord.score ?? null),
        riskLevel: normalizeRiskLevel(candidateRecord.riskLevel ?? candidateRecord.risk_level ?? null),
        approvalRequirement: normalizeApprovalRequirement(candidateRecord.approvalRequirement ?? candidateRecord.approval_requirement ?? null),
        recommendedChannel: normalizeRecommendedChannel(
          candidateRecord.recommendedChannel ?? candidateRecord.recommended_channel ?? readCandidate(input.caseRow, ["channel", "platform"]) ?? null,
          "unknown"
        ),
        draftMessage,
        requiredInformation: uniqueStrings([
          ...(Array.isArray(candidateRecord.requiredInformation) ? candidateRecord.requiredInformation : []),
          ...(Array.isArray(candidateRecord.required_information) ? candidateRecord.required_information : [])
        ]),
        blockedReasons,
        executable: false
      },
      context: buildActionContext(input, {
        policyStatus: asText(candidateRecord.policyStatus ?? candidateRecord.policy_status, 64) ?? "unknown",
        policyVersion: asText(candidateRecord.policyVersion ?? candidateRecord.policy_version, 64),
        runtimeVersion: asText(candidateRecord.runtimeVersion ?? candidateRecord.runtime_version, 64),
        lifecycleVersion: asText(candidateRecord.lifecycleVersion ?? candidateRecord.lifecycle_version, 64)
      })
    })
  };
}

function buildFollowUpSnapshot(input: ActionQueueBuildInput): CommercialFollowUpPlanningInput | null {
  const operationalResult = extractOperationalResult(input);
  const resultingState = parseJsonCandidate(operationalResult?.resultingState) ?? parseJsonCandidate(operationalResult?.commercialState) ?? parseJsonCandidate(operationalResult?.state);
  const sourceQueue = input.sourceQueue ?? null;

  const opportunity =
    resultingState ||
    sourceQueue
      ? {
          id: asText(readCandidate(resultingState ?? {}, ["opportunityId", "opportunity_id"])) ?? asText(readCandidate(sourceQueue ?? {}, ["id_opportunity", "opportunity_id"])),
          status: asText(readCandidate(resultingState ?? {}, ["status"])) ?? asText(readCandidate(sourceQueue ?? {}, ["status", "estado_caso"])),
          stage: asText(readCandidate(resultingState ?? {}, ["stage"])),
          temperature: asText(readCandidate(resultingState ?? {}, ["temperature"])),
          priority: asText(readCandidate(resultingState ?? {}, ["priority"])) ?? asText(readCandidate(sourceQueue ?? {}, ["priority"])),
          primaryIntent:
            asText(readCandidate(resultingState ?? {}, ["primaryIntent", "primary_intent"])) ??
            asText(readCandidate(sourceQueue ?? {}, ["last_intent"])) ??
            null,
          currentSummary:
            asText(readCandidate(resultingState ?? {}, ["currentSummary", "summary"])) ??
            asText(readCandidate(sourceQueue ?? {}, ["product_names", "last_inbound_text"])) ??
            null,
          missingRequirements: readCandidate(resultingState ?? {}, ["missingRequirements", "missing_requirements_json"]) ?? [],
          productInterests: readCandidate(resultingState ?? {}, ["productInterests", "product_interests_json"]) ?? [],
          objections: readCandidate(resultingState ?? {}, ["objections", "objections_json"]) ?? [],
          signals: readCandidate(resultingState ?? {}, ["signals", "signals_json"]) ?? [],
          lastActivityAt:
            asIso(readCandidate(resultingState ?? {}, ["lastActivityAt", "last_activity_at"])) ??
            asIso(readCandidate(sourceQueue ?? {}, ["updated_at", "last_inbound_at", "created_at"])) ??
            null,
          lastCustomerMessageId: asText(readCandidate(resultingState ?? {}, ["lastCustomerMessageId", "last_customer_message_id"])) ?? null,
          lastAgentDecisionId: asText(readCandidate(resultingState ?? {}, ["lastAgentDecisionId", "last_agent_decision_id"])) ?? null,
          nextActionType: asText(readCandidate(resultingState ?? {}, ["nextActionType", "next_action_type"])) ?? null,
          humanOwnerActive: Boolean(readCandidate(resultingState ?? {}, ["humanOwnerActive", "human_owner_active"]) ?? readCandidate(sourceQueue ?? {}, ["requiere_contacto_humano"])),
          aiBlocked: Boolean(readCandidate(resultingState ?? {}, ["aiBlocked", "ai_blocked"])),
          closedAt:
            asIso(readCandidate(resultingState ?? {}, ["closedAt", "closed_at"])) ??
            asIso(readCandidate(sourceQueue ?? {}, ["contact_reply_sent_at", "rechazo_reply_sent_at"])) ??
            null
        }
      : null;

  const caseContext = {
    caseId: asText(readCandidate(input.caseRow, ["conversation_case_id", "case_id", "id"])) ?? null,
    status: asText(readCandidate(input.caseRow, ["status"])) ?? null,
    lifecycleStatus: asText(readCandidate(input.caseRow, ["lifecycle_status", "estado_caso"])) ?? null,
    department: asText(readCandidate(input.caseRow, ["department"])) ?? null,
    priority: asText(readCandidate(input.caseRow, ["priority"])) ?? null,
    requiresHuman: Boolean(readCandidate(input.caseRow, ["requires_human", "requires_human_review", "requiere_contacto_humano"])),
    lastMessageAt: asIso(readCandidate(input.caseRow, ["last_message_at", "updated_at", "last_inbound_at"])) ?? null,
    closedAt: asIso(readCandidate(input.caseRow, ["closed_at", "finished_at"])) ?? null
  };

  const conversationChannel = normalizeFollowUpChannel(
    readCandidate(input.caseRow, ["channel", "platform"]) ?? readCandidate(sourceQueue ?? {}, ["canal_derivacion", "channel"]) ?? "unknown",
  );
  const conversation = {
    waId: asText(readCandidate(input.caseRow, ["wa_id", "waId"])),
    channel: conversationChannel,
    lastCustomerMessageAt:
      asIso(readCandidate(input.caseRow, ["last_customer_message_at", "last_inbound_at"])) ??
      asIso(readCandidate(sourceQueue ?? {}, ["last_inbound_at"])) ??
      null,
    lastAgentMessageAt:
      asIso(readCandidate(input.caseRow, ["last_agent_message_at", "sent_at"])) ??
      asIso(readCandidate(sourceQueue ?? {}, ["sent_at"])) ??
      null,
    lastInboundText: asText(readCandidate(input.caseRow, ["last_inbound_text"]) ?? readCandidate(sourceQueue ?? {}, ["last_inbound_text"])),
    lastOutboundText: asText(readCandidate(input.caseRow, ["last_outbound_text"]))
  };

  const lastDecision = operationalResult
    ? {
        decisionId: asText(readCandidate(operationalResult, ["decisionId", "decision_id"])) ?? null,
        nextActionJson: readCandidate(operationalResult, ["selectedNextAction", "nextAction", "decisionRecord"]) ?? null,
        policyStatus: asText(readCandidate(operationalResult, ["policyStatus", "policy_status"])) ?? null,
        riskLevel: asText(readCandidate(operationalResult, ["riskLevel", "risk_level"])) ?? null,
        approvalRequirement: asText(readCandidate(operationalResult, ["approvalRequirement", "approval_requirement"])) ?? null,
        decisionStatus: asText(readCandidate(operationalResult, ["decisionStatus", "decision_status"])) ?? null,
        createdAt: asIso(readCandidate(operationalResult, ["observedAt", "createdAt", "created_at"])) ?? null
      }
    : null;

  if (!opportunity && !caseContext.caseId && conversation.channel === "unknown") return null;

  return {
    now: buildCurrentTime(input),
    timezone: input.timezone?.trim() || "UTC",
    opportunity,
    caseContext,
    conversation,
    lastDecision,
    policy: {
      maxAttempts: 3,
      cooldownHours: 24,
      defaultDelayHours: 2,
      requireOperatorReview: true,
      allowLowRiskAutoApprovalPreview: false
    }
  };
}

function buildFollowUpPreview(input: ActionQueueBuildInput): { action: CrmAgentAction; source: ActionQueueItemSource } | null {
  const plannerInput = buildFollowUpSnapshot(input);
  if (!plannerInput) return null;
  const plan = planCommercialFollowUp(plannerInput);
  if (plan.status === "not_needed" || (plan.intent === "no_followup" && plan.blockReasons.length === 0)) return null;

  return {
    source: "follow_up_planner",
    action: buildAgentActionFromFollowUpPlan({
      plan,
      context: buildActionContext(input, {
        scheduledFor: plan.scheduledFor,
        policyStatus: asText(plan.status) ?? "unknown",
        policyVersion: "brain.commercial.policy.v1",
        runtimeVersion: "brain.commercial.follow-up-planner.v1",
        lifecycleVersion: "brain.commercial.action-queue.v1"
      })
    })
  };
}

function buildPersistedActionItems(result: LoadAgentActionsResult, sandboxConfig: SandboxAutonomyConfig, input: ActionQueueBuildInput): SandboxActionEnvelope[] {
  const persistedIds = new Set(result.actions.map((action) => action.actionId));
  return result.actions.map((action) => ({
    action,
    source: actionSource(action, persistedIds),
    persisted: true,
    sandboxAutonomy: evaluateAgentActionForSandbox(
      action,
      {
        now: buildCurrentTime(input),
        caseId: asText(readCandidate(input.caseRow, ["conversation_case_id", "case_id", "id"])) ?? null,
        caseStatus: asText(readCandidate(input.caseRow, ["status"])) ?? null,
        lifecycleStatus: asText(readCandidate(input.caseRow, ["lifecycle_status", "estado_caso"])) ?? null,
        humanOwnerActive: Boolean(readCandidate(input.caseRow, ["requires_human", "requires_human_review", "requiere_contacto_humano"])),
        aiBlocked: Boolean(readCandidate(input.caseRow, ["ai_blocked", "aiBlocked"])),
        requiresHuman: Boolean(readCandidate(input.caseRow, ["requires_human", "requires_human_review", "requiere_contacto_humano"])),
        policyStatus: asText(action.policyStatus) ?? null,
        conflictingActionExists: action.blockReasons.some((reason) => /duplicate|conflict/i.test(reason))
      },
      sandboxConfig
    )
  }));
}

function buildPreviewItems(input: ActionQueueBuildInput, sandboxConfig: SandboxAutonomyConfig): SandboxActionEnvelope[] {
  const items: SandboxActionEnvelope[] = [];
  const nextAction = buildNextActionPreview(input);
  if (nextAction) {
    items.push({
      ...nextAction,
      persisted: false,
      sandboxAutonomy: evaluateAgentActionForSandbox(
        nextAction.action,
        {
          now: buildCurrentTime(input),
          caseId: asText(readCandidate(input.caseRow, ["conversation_case_id", "case_id", "id"])) ?? null,
          caseStatus: asText(readCandidate(input.caseRow, ["status"])) ?? null,
          lifecycleStatus: asText(readCandidate(input.caseRow, ["lifecycle_status", "estado_caso"])) ?? null,
          humanOwnerActive: Boolean(readCandidate(input.caseRow, ["requires_human", "requires_human_review", "requiere_contacto_humano"])),
          aiBlocked: Boolean(readCandidate(input.caseRow, ["ai_blocked", "aiBlocked"])),
          requiresHuman: Boolean(readCandidate(input.caseRow, ["requires_human", "requires_human_review", "requiere_contacto_humano"])),
          policyStatus: asText(nextAction.action.policyStatus) ?? null,
          conflictingActionExists: nextAction.action.blockReasons.some((reason) => /duplicate|conflict/i.test(reason))
        },
        sandboxConfig
      )
    });
  }
  const followUp = buildFollowUpPreview(input);
  if (followUp) {
    items.push({
      ...followUp,
      persisted: false,
      sandboxAutonomy: evaluateAgentActionForSandbox(
        followUp.action,
        {
          now: buildCurrentTime(input),
          caseId: asText(readCandidate(input.caseRow, ["conversation_case_id", "case_id", "id"])) ?? null,
          caseStatus: asText(readCandidate(input.caseRow, ["status"])) ?? null,
          lifecycleStatus: asText(readCandidate(input.caseRow, ["lifecycle_status", "estado_caso"])) ?? null,
          humanOwnerActive: Boolean(readCandidate(input.caseRow, ["requires_human", "requires_human_review", "requiere_contacto_humano"])),
          aiBlocked: Boolean(readCandidate(input.caseRow, ["ai_blocked", "aiBlocked"])),
          requiresHuman: Boolean(readCandidate(input.caseRow, ["requires_human", "requires_human_review", "requiere_contacto_humano"])),
          policyStatus: asText(followUp.action.policyStatus) ?? null,
          conflictingActionExists: followUp.action.blockReasons.some((reason) => /duplicate|conflict/i.test(reason))
        },
        sandboxConfig
      )
    });
  }
  return items;
}

function buildViewModel(
  status: ActionQueueViewModelStatus,
  origin: ActionQueueViewModelOrigin,
  actions: ActionQueueItemViewModel[],
  diagnostics: ActionQueueViewModel["diagnostics"],
  sandboxAutonomy: ActionQueueViewModel["sandboxAutonomy"],
  disabledReason: string | null,
  error: string | null,
  observedAt: string | null
): ActionQueueViewModel {
  return {
    status,
    origin,
    actions,
    diagnostics,
    sandboxAutonomy,
    disabledReason,
    error,
    observedAt
  };
}

function sourceLabel(items: Array<{ source: ActionQueueItemSource }>) {
  return sanitizeDiagnosticsSource(items.map((item) => item.source));
}

function sanitizeDiagnosticsSource(values: string[]) {
  return uniqueStrings(values.map((value) => value || null)).join("+") || "none";
}

export async function buildActionQueueViewModel(input: ActionQueueBuildInput): Promise<ActionQueueViewModel> {
  const observedAt = buildCurrentTime(input);
  const limit = Math.max(1, Math.min(COMMERCIAL_AGENT_ACTION_QUEUE_VIEW_MODEL_MAX_ITEMS, input.limit ?? COMMERCIAL_AGENT_ACTION_QUEUE_VIEW_MODEL_MAX_ITEMS));
  const sandboxConfig = normalizeSandboxConfig(input.sandboxAutonomyConfig ?? null);
  const sandboxAutonomy = buildSandboxReadinessSummary(sandboxConfig);

  try {
    const loadResult = await loadAgentActions(
      {
        opportunityId: asId(readCandidate(input.caseRow, ["opportunity_id", "opportunityId"])),
        conversationCaseId: asId(readCandidate(input.caseRow, ["conversation_case_id", "case_id", "id"])),
        waId: asText(readCandidate(input.caseRow, ["wa_id", "waId"])),
        status: null,
        actionType: null,
        limit,
        queueEnabled: true
      },
      input.adapter ?? null
    );

    if (loadResult.status === "error") {
      const permissionError = buildPermissionErrorFlag(loadResult.error);
      return buildViewModel(
        "error",
        "none",
        [],
        {
          tableAvailable: null,
          permissionError,
          usedPreviewFallback: false,
          source: "crm_agent_actions"
        },
        sandboxAutonomy,
        "No se pudo leer crm_agent_actions de forma segura.",
        loadResult.error ? sanitizeError(loadResult.error) : null,
        observedAt
      );
    }

    const persistedItems = loadResult.status === "loaded" ? buildPersistedActionItems(loadResult, sandboxConfig, input).slice(0, limit) : [];
    const previewItems = buildPreviewItems(input, sandboxConfig).slice(0, limit);
    const combined = dedupeActions([...persistedItems, ...previewItems]).slice(0, limit);
    const hasPersisted = persistedItems.length > 0;
    const hasPreview = combined.some((item) => !item.persisted);
    const origin: ActionQueueViewModelOrigin = hasPersisted && hasPreview ? "mixed" : hasPersisted ? "persisted" : hasPreview ? "preview" : "none";
    const mappedItems = combined.map((item) => buildItem(item.action, item.source, item.persisted, item.sandboxAutonomy));
    const source = sourceLabel(combined);

    if (mappedItems.length > 0) {
      return buildViewModel(
        hasPersisted ? "available" : "preview_only",
        origin,
        mappedItems,
        {
          tableAvailable: loadResult.status === "loaded" ? true : loadResult.status === "unavailable" ? false : null,
          permissionError: false,
          usedPreviewFallback: !hasPersisted && hasPreview,
          source
        },
        sandboxAutonomy,
        hasPersisted ? "Disponible cuando Action Persistence y Execution Gate esten habilitados." : "Vista previa read-only hasta que exista persistencia duradera.",
        null,
        observedAt
      );
    }

    if (loadResult.status === "unavailable") {
      return buildViewModel(
        "unavailable",
        "none",
        [],
        {
          tableAvailable: false,
          permissionError: false,
          usedPreviewFallback: false,
          source: "crm_agent_actions"
        },
        sandboxAutonomy,
        "Disponible cuando Action Persistence y Execution Gate esten habilitados.",
        null,
        observedAt
      );
    }

    return buildViewModel(
      "empty",
      "none",
      [],
      {
        tableAvailable: true,
        permissionError: false,
        usedPreviewFallback: false,
        source: "crm_agent_actions"
      },
      sandboxAutonomy,
      "No hay acciones ni previews comerciales disponibles.",
      null,
      observedAt
    );
  } catch (error) {
    return buildViewModel(
      "error",
      "none",
      [],
      {
        tableAvailable: null,
        permissionError: buildPermissionErrorFlag(error instanceof Error ? error.message : String(error)),
        usedPreviewFallback: false,
        source: "crm_agent_actions"
      },
      sandboxAutonomy,
      "La lectura de la cola de acciones fallo de forma segura.",
      sanitizeError(error),
      observedAt
    );
  }
}
