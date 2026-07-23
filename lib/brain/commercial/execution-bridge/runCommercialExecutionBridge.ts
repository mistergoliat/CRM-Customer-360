import { buildAgentActionFromNextAction, persistAgentAction } from "../action-queue";
import type { CrmAgentActionBuildContext, PersistAgentActionResult } from "../action-queue";
import { buildSandboxAutonomyConfig, evaluateAgentActionForSandbox } from "../autonomy-sandbox";
import type { SandboxAutonomyAgentActionContext } from "../autonomy-sandbox";
import { executeActionThroughGate } from "../execution-gate";
import { SqlExecutionUnitOfWork } from "../execution-gate/sqlExecutionUnitOfWork";
import type { CommercialNextAction, CommercialOperationalLoopResult } from "../operational-loop";
import type { CommercialExecutionBridgeFeatureFlags, CommercialExecutionBridgeResult } from "./types";
import { resolveSalesAgentConfiguration } from "../sales-agent-configuration";
import type { ResolvedSalesAgentConfigurationSource } from "../sales-agent-configuration";
import { buildFollowUpSequenceKey, loadFollowUpAttemptHistory } from "../followup/loadFollowUpAttemptHistory";
import { computeNextFollowUpSchedule } from "../followup/computeFollowUpSchedule";

type RunCommercialExecutionBridgeInput = {
  operationalLoopResult: CommercialOperationalLoopResult | null;
  currentTime: string | Date;
  timezone: string;
  featureFlags: CommercialExecutionBridgeFeatureFlags;
  sandboxWaIds: string[];
  allowedActionTypes: string[];
  maxRiskLevel: string;
};

function toIso(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function emptyResult(
  status: CommercialExecutionBridgeResult["status"],
  enabled: boolean,
  warnings: string[] = [],
  error: string | null = null
): CommercialExecutionBridgeResult {
  return {
    status,
    enabled,
    action: null,
    actionPersistence: null,
    sandboxEvaluation: null,
    executionGate: null,
    warnings,
    error,
    sideEffects: {
      actionWritten: false,
      outboxWritten: false,
      messageSent: false,
      metaCalled: false,
      workerTriggered: false
    }
  };
}

/**
 * ACS-R1-05.1-T02.3D. What buildActionContext used to hardcode
 * (`maxAttempts: 1`, no scheduledFor, no attempt continuity) - the native
 * runtime never had real follow-up scheduling before this task; every
 * `propose_followup` row was persisted with `scheduled_for = NULL`, which
 * `runFollowupTick.selectDueFollowUps`'s `scheduled_for <= UTC_TIMESTAMP()`
 * can never match. This resolves the CURRENT published Sales Agent
 * Configuration's followUpConfiguration, the sequence's real attempt
 * history (opportunity_id first, conversation_case_id fallback - never
 * wa_id), and computes attempt N's real scheduled_for - or explains why it
 * can't (disabled, max attempts reached, opportunity too old, window
 * unreachable, configuration unavailable) via additionalBlockReasons, which
 * the caller folds into the built action's blockedReasons so the existing
 * status-derivation logic in buildAgentActionFromNextAction naturally
 * produces `blocked`, never a schedule_followup row with a fabricated date.
 */
type FollowUpSchedulingContext = {
  scheduledFor: string | null;
  attemptNumber: number;
  maxAttempts: number;
  followUpSequenceKey: string | null;
  followUpConfigurationSource: ResolvedSalesAgentConfigurationSource | null;
  followUpConfigurationId: number | null;
  followUpConfigurationVersion: number | null;
  followUpConfigurationHash: string | null;
  additionalBlockReasons: string[];
};

/**
 * Narrowed to exactly what this function reads (never the full
 * CommercialOperationalLoopResult) - keeps this testable in isolation with a
 * small literal object instead of hand-constructing the entire operational
 * loop result type, and keeps the coupling honest about what actually
 * matters for scheduling.
 */
export type FollowUpSchedulingLoopContext = {
  resultingState: {
    opportunityId: number | string | null;
    conversationCaseId: number | string | null;
    createdAt?: string | null;
  } | null;
};

export async function resolveFollowUpSchedulingContext(loop: FollowUpSchedulingLoopContext, now: string): Promise<FollowUpSchedulingContext> {
  const opportunityId = loop.resultingState?.opportunityId ?? null;
  const conversationCaseId = loop.resultingState?.conversationCaseId ?? null;
  const followUpSequenceKey = buildFollowUpSequenceKey(opportunityId, conversationCaseId);

  const base = {
    scheduledFor: null as string | null,
    attemptNumber: 1,
    maxAttempts: 1,
    followUpSequenceKey,
    followUpConfigurationSource: null as ResolvedSalesAgentConfigurationSource | null,
    followUpConfigurationId: null as number | null,
    followUpConfigurationVersion: null as number | null,
    followUpConfigurationHash: null as string | null
  };

  let resolved;
  try {
    resolved = await resolveSalesAgentConfiguration();
  } catch {
    // A real DB/resolver failure - never fabricate a schedule from a
    // hardcoded default here. Mirrors the worker's own decision 13 handling
    // (configuration_unavailable): no model was invoked as a result of this
    // (the LLM already ran earlier in the loop), but the platform refuses to
    // authorize/schedule anything on top of an unreadable configuration.
    return { ...base, additionalBlockReasons: ["configuration_unavailable"] };
  }

  const configSnapshot = {
    followUpConfigurationSource: resolved.source,
    followUpConfigurationId: resolved.recordId,
    followUpConfigurationVersion: resolved.version,
    followUpConfigurationHash: resolved.configurationHash
  };
  const followUpConfig = resolved.effectiveFollowUpConfiguration;

  if (!followUpConfig.enabled) {
    return { ...base, ...configSnapshot, maxAttempts: followUpConfig.maxAttempts, additionalBlockReasons: ["follow_up_disabled"] };
  }

  const history = await loadFollowUpAttemptHistory({ opportunityId, conversationCaseId });
  if (!history.ok) {
    return { ...base, ...configSnapshot, maxAttempts: followUpConfig.maxAttempts, additionalBlockReasons: ["configuration_unavailable"] };
  }

  const nextAttemptNumber = history.maxConsumedAttemptNumber + 1;
  if (nextAttemptNumber > followUpConfig.maxAttempts) {
    return {
      ...base,
      ...configSnapshot,
      attemptNumber: nextAttemptNumber,
      maxAttempts: followUpConfig.maxAttempts,
      additionalBlockReasons: ["max_attempts_reached"]
    };
  }

  const opportunityCreatedAt = loop.resultingState?.createdAt ?? null;
  if (opportunityCreatedAt) {
    const createdMs = new Date(opportunityCreatedAt).getTime();
    const nowMs = new Date(now).getTime();
    if (!Number.isNaN(createdMs) && !Number.isNaN(nowMs)) {
      const ageDays = (nowMs - createdMs) / 86_400_000;
      if (ageDays > followUpConfig.maxOpportunityAgeDays) {
        return {
          ...base,
          ...configSnapshot,
          attemptNumber: nextAttemptNumber,
          maxAttempts: followUpConfig.maxAttempts,
          additionalBlockReasons: ["opportunity_too_old"]
        };
      }
    }
  }

  const scheduleResult = computeNextFollowUpSchedule({
    attemptNumber: nextAttemptNumber,
    initialDecisionAt: now,
    previousAttemptScheduledFor: history.lastConsumedRow?.scheduledFor ?? null,
    attemptDelaysMinutes: followUpConfig.attemptDelaysMinutes,
    allowedWindow: followUpConfig.allowedWindow
  });

  if (!scheduleResult.ok) {
    return {
      ...base,
      ...configSnapshot,
      attemptNumber: nextAttemptNumber,
      maxAttempts: followUpConfig.maxAttempts,
      additionalBlockReasons: [scheduleResult.reason]
    };
  }

  return {
    scheduledFor: scheduleResult.scheduledFor,
    attemptNumber: nextAttemptNumber,
    maxAttempts: followUpConfig.maxAttempts,
    followUpSequenceKey,
    ...configSnapshot,
    additionalBlockReasons: []
  };
}

function buildActionContext(
  input: RunCommercialExecutionBridgeInput,
  loop: CommercialOperationalLoopResult,
  followUpScheduling: FollowUpSchedulingContext | null
): CrmAgentActionBuildContext {
  return {
    currentTime: input.currentTime,
    timezone: input.timezone,
    opportunityId: loop.resultingState?.opportunityId ?? loop.identityResolution?.opportunityId ?? null,
    decisionId: loop.decisionRecord?.decisionId ?? null,
    decisionRowId: null,
    conversationCaseId: loop.resultingState?.conversationCaseId ?? null,
    messageId: loop.processInboundRunId ?? null,
    waId: loop.resultingState?.waId ?? null,
    channel: loop.selectedNextAction?.recommendedChannel ?? "unknown",
    policyStatus: loop.decisionRecord?.policyStatus ?? "unknown",
    policyVersion: loop.versions.policyVersion,
    runtimeVersion: loop.versions.salesAgentRuntimeVersion,
    lifecycleVersion: "brain.commercial.action-lifecycle.v1",
    scheduledFor: followUpScheduling?.scheduledFor ?? undefined,
    attemptNumber: followUpScheduling?.attemptNumber ?? undefined,
    maxAttempts: followUpScheduling?.maxAttempts ?? 1,
    followUpSequenceKey: followUpScheduling?.followUpSequenceKey ?? null,
    followUpConfigurationSource: followUpScheduling?.followUpConfigurationSource ?? null,
    followUpConfigurationId: followUpScheduling?.followUpConfigurationId ?? null,
    followUpConfigurationVersion: followUpScheduling?.followUpConfigurationVersion ?? null,
    followUpConfigurationHash: followUpScheduling?.followUpConfigurationHash ?? null,
    metadata: {
      source: "commercial_execution_bridge",
      loopVersion: loop.versions.loopVersion
    }
  };
}

function buildSandboxContext(loop: CommercialOperationalLoopResult, now: string): SandboxAutonomyAgentActionContext {
  const caseId = loop.resultingState?.conversationCaseId ?? null;
  return {
    now,
    caseId: caseId === null ? null : String(caseId),
    caseStatus: loop.resultingState?.status ?? null,
    lifecycleStatus: loop.resultingState?.status ?? null,
    humanOwnerActive: Boolean(loop.resultingState?.humanOwnerActive),
    aiBlocked: Boolean(loop.resultingState?.aiBlocked),
    requiresHuman: loop.selectedNextAction?.type === "escalate_to_operator",
    policyStatus: loop.decisionRecord?.policyStatus ?? null,
    conflictingActionExists: false
  };
}

function normalizeSandboxWaIds(inputWaIds: string[], actionWaId: string | null) {
  if (inputWaIds.length > 0) return inputWaIds;
  return actionWaId ? [actionWaId] : [];
}

function persistenceIsUsable(persistence: PersistAgentActionResult) {
  return persistence.status === "inserted" || persistence.status === "updated_existing" || persistence.status === "duplicate_ignored";
}

function isOutboxBackedAction(actionType: string) {
  return actionType === "send_whatsapp_reply" || actionType === "request_more_context";
}

/** Folds follow-up-specific block reasons into the selected next action before it reaches buildAgentActionFromNextAction, so the existing status-derivation (deriveActionStatusFromGovernance) naturally produces `blocked` - no separate status logic duplicated here. */
function applyFollowUpBlockReasons(nextAction: CommercialNextAction, additionalBlockReasons: string[]): CommercialNextAction {
  if (additionalBlockReasons.length === 0) return nextAction;
  return {
    ...nextAction,
    blockedReasons: [...new Set([...nextAction.blockedReasons, ...additionalBlockReasons])]
  };
}

export async function runCommercialExecutionBridge(input: RunCommercialExecutionBridgeInput): Promise<CommercialExecutionBridgeResult> {
  const enabled = input.featureFlags.actionQueueEnabled || input.featureFlags.executionGateEnabled || input.featureFlags.outboxBridgeEnabled;
  if (!enabled) return emptyResult("disabled", false, ["commercial_execution_bridge_disabled"]);

  const loop = input.operationalLoopResult;
  if (!loop || loop.status !== "completed" || !loop.selectedNextAction) {
    return emptyResult("skipped", true, ["commercial_execution_bridge_no_next_action"]);
  }

  const now = toIso(input.currentTime);

  const followUpScheduling = loop.selectedNextAction.type === "propose_followup" ? await resolveFollowUpSchedulingContext(loop, now) : null;
  const effectiveNextAction = followUpScheduling
    ? applyFollowUpBlockReasons(loop.selectedNextAction, followUpScheduling.additionalBlockReasons)
    : loop.selectedNextAction;

  const action = buildAgentActionFromNextAction({
    nextAction: effectiveNextAction,
    context: buildActionContext(input, loop, followUpScheduling)
  });

  const actionPersistence = await persistAgentAction({
    action,
    currentTime: now,
    featureFlags: {
      queueEnabled: input.featureFlags.actionQueueEnabled,
      persistenceEnabled: input.featureFlags.actionPersistenceEnabled
    },
    // ACS-R1-05-T07: this is the one primary reply the bridge builds for the
    // loop's selectedNextAction - two concurrent cycle runs for the same
    // inbound message must never both send it (see persistAgentAction.ts).
    enforceSingleReplyPerMessage: true
  });

  const actionWritten = actionPersistence.status === "inserted" || actionPersistence.status === "updated_existing";
  const persistedAction = actionPersistence.action;
  if (persistenceIsUsable(actionPersistence) && !isOutboxBackedAction(persistedAction.actionType)) {
    return {
      ...emptyResult("internal_action_planned", true, [...actionPersistence.warnings, "commercial_execution_bridge_internal_action_planned"], null),
      action: persistedAction,
      actionPersistence,
      sideEffects: {
        actionWritten,
        outboxWritten: false,
        messageSent: false,
        metaCalled: false,
        workerTriggered: false
      }
    };
  }

  if (!persistenceIsUsable(actionPersistence) || !input.featureFlags.executionGateEnabled || !input.featureFlags.outboxBridgeEnabled) {
    return {
      ...emptyResult(actionPersistence.status === "failed" ? "failed" : actionWritten ? "action_persisted" : "blocked", true, actionPersistence.warnings, actionPersistence.error),
      action: persistedAction,
      actionPersistence,
      sideEffects: {
        actionWritten,
        outboxWritten: false,
        messageSent: false,
        metaCalled: false,
        workerTriggered: false
      }
    };
  }

  const sandboxContext = buildSandboxContext(loop, now);
  const sandboxEvaluation = evaluateAgentActionForSandbox(
    persistedAction,
    sandboxContext,
    buildSandboxAutonomyConfig({
      sandboxEnabled: input.featureFlags.sandboxEnabled,
      autonomousReplyEnabled: input.featureFlags.autonomousReplyEnabled,
      whitelistedWaIds: normalizeSandboxWaIds(input.sandboxWaIds, persistedAction.waId),
      allowedActionTypes: input.allowedActionTypes,
      maxRiskLevel: input.maxRiskLevel
    })
  );

  const executionGate = await executeActionThroughGate(
    {
      now,
      action: persistedAction,
      config: {
        executionGateEnabled: input.featureFlags.executionGateEnabled,
        outboxBridgeEnabled: input.featureFlags.outboxBridgeEnabled,
        sandboxModeRequired: input.featureFlags.sandboxModeRequired
      },
      context: sandboxContext,
      sandboxEvaluation
    },
    { unitOfWork: new SqlExecutionUnitOfWork() }
  );

  const outboxWritten = executionGate.repositoryResult.outboxInserted;
  return {
    status: executionGate.allowed || executionGate.status === "duplicate" ? "outbox_planned" : "blocked",
    enabled: true,
    action: persistedAction,
    actionPersistence,
    sandboxEvaluation,
    executionGate,
    warnings: [...actionPersistence.warnings, ...sandboxEvaluation.warnings, ...executionGate.warnings],
    error: executionGate.status === "failed" ? executionGate.blockReasons.join(",") : null,
    sideEffects: {
      actionWritten,
      outboxWritten,
      messageSent: false,
      metaCalled: false,
      workerTriggered: false
    }
  };
}
