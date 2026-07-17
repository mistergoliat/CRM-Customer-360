import { createHash } from "node:crypto";
import { persistAgentAction } from "../action-queue";
import type { CrmAgentAction, PersistAgentActionResult } from "../action-queue";
import { buildSandboxAutonomyConfig, evaluateAgentActionForSandbox } from "../autonomy-sandbox";
import type { SandboxAutonomyAgentActionContext, SandboxAutonomyEvaluationResult } from "../autonomy-sandbox";
import { executeActionThroughGate, SqlExecutionUnitOfWork } from "../execution-gate";
import type { ExecutionGateResult } from "../execution-gate";
import { buildCommercialBridgeFeatureFlags } from "../config/commercialCycleConfig";
import type { ContinuityFallbackClass } from "./salesTurnDisposition";

function parseEnvCsv(name: string, fallback: string[] = []): string[] {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

/**
 * ACS-R1-05-T06.2 (release spec section A6). A stable key derived only from
 * identifiers already known before this turn's outcome, so the same logical
 * fallback (same conversation, same inbound message, same reason class)
 * always resolves to the same idempotency key regardless of wall-clock time
 * or how many times this function runs (replay, duplicate webhook, or
 * concurrent execution) - persistAgentAction's own idempotency_key upsert
 * (see persistAgentAction.ts: terminal rows are left unchanged, non-terminal
 * rows are updated in place, never duplicated) does the rest.
 */
export function buildContinuityFallbackIdempotencyKey(conversationId: number, inboundMessageId: string, fallbackClass: ContinuityFallbackClass): string {
  return `continuity-fallback:${conversationId}:${inboundMessageId}:${fallbackClass}`;
}

export type DispatchFallbackActionInput = {
  conversationId: number;
  conversationCaseId: number | string | null;
  opportunityId: number | string | null;
  decisionId: string | null;
  waId: string;
  inboundMessageId: string;
  currentTime: string;
  fallbackClass: ContinuityFallbackClass;
  message: string;
  humanOwnerActive: boolean;
  aiBlocked: boolean;
  caseStatus: string | null;
};

export type DispatchFallbackActionResult = {
  attempted: boolean;
  action: CrmAgentAction | null;
  actionPersistence: PersistAgentActionResult | null;
  sandboxEvaluation: SandboxAutonomyEvaluationResult | null;
  executionGate: ExecutionGateResult | null;
  outboxWritten: boolean;
  outboxId: number | null;
  warnings: string[];
};

function emptyResult(warnings: string[]): DispatchFallbackActionResult {
  return { attempted: false, action: null, actionPersistence: null, sandboxEvaluation: null, executionGate: null, outboxWritten: false, outboxId: null, warnings };
}

function buildFallbackAgentAction(input: DispatchFallbackActionInput, idempotencyKey: string): CrmAgentAction {
  const actionId = `crm-agent-action-${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 24)}`;
  return {
    id: null,
    actionId,
    idempotencyKey,
    opportunityId: input.opportunityId,
    decisionId: input.decisionId,
    decisionRowId: null,
    conversationCaseId: input.conversationCaseId,
    messageId: input.inboundMessageId,
    waId: input.waId,
    channel: "whatsapp",
    actionType: "send_whatsapp_reply",
    status: "proposed",
    riskLevel: "low",
    approvalRequirement: "none",
    draftPayload: null,
    finalPayload: null,
    executionPayload: null,
    draftMessage: input.message,
    finalMessage: null,
    scheduledFor: null,
    expiresAt: null,
    attemptNumber: 1,
    maxAttempts: 1,
    blockReasons: [],
    cancelReason: null,
    failureReason: null,
    policyStatus: "allowed",
    policyNotes: [`continuity_fallback:${input.fallbackClass}`],
    source: "ai_sdr",
    createdBy: "ai",
    approvedBy: null,
    approvedAt: null,
    executedAt: null,
    cancelledAt: null,
    outboxMessageId: null,
    lifecycleVersion: "brain.commercial.action-lifecycle.v1",
    policyVersion: null,
    runtimeVersion: null,
    createdAt: input.currentTime,
    updatedAt: null
  };
}

/**
 * Builds, persists (idempotently) and dispatches a fallback
 * `send_whatsapp_reply` action through the SAME real pipeline every other
 * autonomous reply goes through: persistAgentAction -> sandbox ->
 * executeActionThroughGate (canonical outbox writer). Never writes directly
 * to brain_message_outbox.
 */
export async function dispatchFallbackAction(input: DispatchFallbackActionInput): Promise<DispatchFallbackActionResult> {
  const bridgeFlags = buildCommercialBridgeFeatureFlags();
  if (!bridgeFlags.actionQueueEnabled) {
    return emptyResult(["continuity_fallback_action_queue_disabled"]);
  }

  const idempotencyKey = buildContinuityFallbackIdempotencyKey(input.conversationId, input.inboundMessageId, input.fallbackClass);
  const action = buildFallbackAgentAction(input, idempotencyKey);

  const actionPersistence = await persistAgentAction({
    action,
    currentTime: input.currentTime,
    featureFlags: { queueEnabled: bridgeFlags.actionQueueEnabled, persistenceEnabled: bridgeFlags.actionPersistenceEnabled }
  });

  const persistenceIsUsable =
    actionPersistence.status === "inserted" || actionPersistence.status === "updated_existing" || actionPersistence.status === "duplicate_ignored";
  if (!persistenceIsUsable) {
    return { ...emptyResult(actionPersistence.warnings), action: actionPersistence.action, actionPersistence };
  }

  if (actionPersistence.status === "duplicate_ignored") {
    // A prior attempt (replay, duplicate webhook, or concurrent execution)
    // already drove this exact fallback to a terminal state - reflect it,
    // never re-dispatch a second outbox for the same idempotency key.
    return {
      attempted: true,
      action: actionPersistence.action,
      actionPersistence,
      sandboxEvaluation: null,
      executionGate: null,
      outboxWritten: actionPersistence.action.outboxMessageId !== null,
      outboxId: actionPersistence.action.outboxMessageId,
      warnings: ["continuity_fallback_already_terminal"]
    };
  }

  if (!bridgeFlags.executionGateEnabled || !bridgeFlags.outboxBridgeEnabled) {
    return {
      attempted: true,
      action: actionPersistence.action,
      actionPersistence,
      sandboxEvaluation: null,
      executionGate: null,
      outboxWritten: false,
      outboxId: null,
      warnings: [...actionPersistence.warnings, "continuity_fallback_gate_disabled"]
    };
  }

  const persistedAction = actionPersistence.action;
  const sandboxWaIds = parseEnvCsv("BRAIN_AUTONOMOUS_TEST_WA_IDS");
  const sandboxContext: SandboxAutonomyAgentActionContext = {
    now: input.currentTime,
    caseId: input.conversationCaseId === null ? null : String(input.conversationCaseId),
    caseStatus: input.caseStatus,
    lifecycleStatus: input.caseStatus,
    humanOwnerActive: input.humanOwnerActive,
    aiBlocked: input.aiBlocked,
    requiresHuman: false,
    policyStatus: "allowed",
    conflictingActionExists: false
  };

  const sandboxEvaluation = evaluateAgentActionForSandbox(
    persistedAction,
    sandboxContext,
    buildSandboxAutonomyConfig({
      sandboxEnabled: bridgeFlags.sandboxEnabled,
      autonomousReplyEnabled: bridgeFlags.autonomousReplyEnabled,
      whitelistedWaIds: sandboxWaIds.length > 0 ? sandboxWaIds : persistedAction.waId ? [persistedAction.waId] : [],
      allowedActionTypes: parseEnvCsv("BRAIN_AUTONOMOUS_ALLOWED_ACTION_TYPES", ["send_whatsapp_reply", "request_more_context"]),
      maxRiskLevel: process.env.BRAIN_AUTONOMOUS_MAX_RISK_LEVEL?.trim() || "low"
    })
  );

  const executionGate = await executeActionThroughGate(
    {
      now: input.currentTime,
      action: persistedAction,
      config: {
        executionGateEnabled: bridgeFlags.executionGateEnabled,
        outboxBridgeEnabled: bridgeFlags.outboxBridgeEnabled,
        sandboxModeRequired: bridgeFlags.sandboxModeRequired
      },
      context: sandboxContext,
      sandboxEvaluation
    },
    { unitOfWork: new SqlExecutionUnitOfWork() }
  );

  return {
    attempted: true,
    action: persistedAction,
    actionPersistence,
    sandboxEvaluation,
    executionGate,
    outboxWritten: executionGate.repositoryResult.outboxInserted || executionGate.status === "duplicate",
    outboxId: executionGate.repositoryResult.outboxRowId,
    warnings: [...actionPersistence.warnings, ...sandboxEvaluation.warnings, ...executionGate.warnings]
  };
}
