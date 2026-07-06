import { buildAgentActionFromNextAction, persistAgentAction } from "../action-queue";
import type { CrmAgentActionBuildContext, PersistAgentActionResult } from "../action-queue";
import { buildSandboxAutonomyConfig, evaluateAgentActionForSandbox } from "../autonomy-sandbox";
import type { SandboxAutonomyAgentActionContext } from "../autonomy-sandbox";
import { executeActionThroughGate } from "../execution-gate";
import { SqlExecutionUnitOfWork } from "../execution-gate/sqlExecutionUnitOfWork";
import type { CommercialOperationalLoopResult } from "../operational-loop";
import type { CommercialExecutionBridgeFeatureFlags, CommercialExecutionBridgeResult } from "./types";

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

function buildActionContext(input: RunCommercialExecutionBridgeInput, loop: CommercialOperationalLoopResult): CrmAgentActionBuildContext {
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
    maxAttempts: 1,
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

export async function runCommercialExecutionBridge(input: RunCommercialExecutionBridgeInput): Promise<CommercialExecutionBridgeResult> {
  const enabled = input.featureFlags.actionQueueEnabled || input.featureFlags.executionGateEnabled || input.featureFlags.outboxBridgeEnabled;
  if (!enabled) return emptyResult("disabled", false, ["commercial_execution_bridge_disabled"]);

  const loop = input.operationalLoopResult;
  if (!loop || loop.status !== "completed" || !loop.selectedNextAction) {
    return emptyResult("skipped", true, ["commercial_execution_bridge_no_next_action"]);
  }

  const now = toIso(input.currentTime);
  const action = buildAgentActionFromNextAction({
    nextAction: loop.selectedNextAction,
    context: buildActionContext(input, loop)
  });

  const actionPersistence = await persistAgentAction({
    action,
    currentTime: now,
    featureFlags: {
      queueEnabled: input.featureFlags.actionQueueEnabled,
      persistenceEnabled: input.featureFlags.actionPersistenceEnabled
    }
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
