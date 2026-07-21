import { createHash } from "node:crypto";
import { persistAgentAction } from "../action-queue";
import type { CrmAgentAction, PersistAgentActionResult } from "../action-queue";
import { buildSandboxAutonomyConfig, evaluateAgentActionForSandbox } from "../autonomy-sandbox";
import type { SandboxAutonomyAgentActionContext, SandboxAutonomyEvaluationResult } from "../autonomy-sandbox";
import { executeActionThroughGate, SqlExecutionUnitOfWork } from "../execution-gate";
import type { ExecutionGateResult } from "../execution-gate";
import { buildCommercialBridgeFeatureFlags } from "../config/commercialCycleConfig";
import { buildContinuityFallbackMessage, type ContinuityFallbackContext } from "../continuity/buildContinuityFallbackMessage";
import type { ContinuityFallbackClass } from "../continuity/salesTurnDisposition";
import type { AgentLoopResult } from "./agentStepTypes";

function parseEnvCsv(name: string, fallback: string[] = []): string[] {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

/**
 * Non-"responded", non-"handoff" terminal reasons map onto the same
 * customer-facing fallback vocabulary the reactive continuity path already
 * uses (ACS-R1-05-T06.2) - never a second, parallel fallback-message system.
 */
function mapTerminalReasonToFallbackClass(terminalReason: AgentLoopResult["terminalReason"]): ContinuityFallbackClass | null {
  switch (terminalReason) {
    case "responded":
    case "handoff":
      return null;
    case "invalid_output":
      return "invalid_model_result";
    case "provider_unavailable":
    case "timeout":
      return "model_unavailable";
    case "max_steps_exceeded":
      return "max_steps_exceeded";
  }
}

export type DispatchAgentLoopResponseInput = {
  conversationId: number;
  conversationCaseId: number | string | null;
  opportunityId: number | string | null;
  waId: string;
  inboundMessageId: string;
  currentTime: string;
  humanOwnerActive: boolean;
  aiBlocked: boolean;
  caseStatus: string | null;
  loop: AgentLoopResult;
  commercialNeed: ContinuityFallbackContext;
};

export type DispatchAgentLoopResponseResult = {
  attempted: boolean;
  messageSent: string | null;
  action: CrmAgentAction | null;
  actionPersistence: PersistAgentActionResult | null;
  sandboxEvaluation: SandboxAutonomyEvaluationResult | null;
  executionGate: ExecutionGateResult | null;
  outboxWritten: boolean;
  outboxId: number | null;
  warnings: string[];
};

function emptyResult(warnings: string[]): DispatchAgentLoopResponseResult {
  return { attempted: false, messageSent: null, action: null, actionPersistence: null, sandboxEvaluation: null, executionGate: null, outboxWritten: false, outboxId: null, warnings };
}

function buildAgentLoopIdempotencyKey(conversationId: number, inboundMessageId: string, terminalReason: string): string {
  return `agent-tool-loop:${conversationId}:${inboundMessageId}:${terminalReason}`;
}

function buildAgentLoopAction(input: DispatchAgentLoopResponseInput, idempotencyKey: string, message: string): CrmAgentAction {
  const actionId = `crm-agent-action-${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 24)}`;
  return {
    id: null,
    actionId,
    idempotencyKey,
    opportunityId: input.opportunityId,
    decisionId: null,
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
    draftMessage: message,
    finalMessage: null,
    scheduledFor: null,
    expiresAt: null,
    attemptNumber: 1,
    maxAttempts: 1,
    blockReasons: [],
    cancelReason: null,
    failureReason: null,
    policyStatus: "allowed",
    policyNotes: [`agent_tool_loop:${input.loop.terminalReason}`],
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
 * ACS-R1-05.1-T02.1. Dispatches the agent tool loop's terminal outcome
 * (respond/handoff/fallback) through the exact same real pipeline every
 * other autonomous reply uses: persistAgentAction -> sandbox ->
 * executeActionThroughGate (canonical outbox writer). A dedicated function,
 * not a reuse of continuity/dispatchFallbackAction.ts: that function's
 * idempotency key and policyNotes are specifically about the reactive
 * continuity path's fallback classes, a poor semantic fit for "this is the
 * agent's genuine primary response" - kept separate to avoid touching that
 * file's tested behavior.
 */
export async function dispatchAgentLoopResponse(input: DispatchAgentLoopResponseInput): Promise<DispatchAgentLoopResponseResult> {
  const bridgeFlags = buildCommercialBridgeFeatureFlags();
  if (!bridgeFlags.actionQueueEnabled) {
    return emptyResult(["agent_tool_loop_action_queue_disabled"]);
  }

  const message =
    input.loop.terminalReason === "responded"
      ? input.loop.finalMessage
      : input.loop.terminalReason === "handoff"
        ? buildContinuityFallbackMessage("handoff_acknowledgement", input.commercialNeed)
        : buildContinuityFallbackMessage(mapTerminalReasonToFallbackClass(input.loop.terminalReason) ?? "invalid_model_result", input.commercialNeed);

  if (!message) {
    return emptyResult(["agent_tool_loop_no_message_to_dispatch"]);
  }

  const idempotencyKey = buildAgentLoopIdempotencyKey(input.conversationId, input.inboundMessageId, input.loop.terminalReason);
  const action = buildAgentLoopAction(input, idempotencyKey, message);

  const actionPersistence = await persistAgentAction({
    action,
    currentTime: input.currentTime,
    featureFlags: { queueEnabled: bridgeFlags.actionQueueEnabled, persistenceEnabled: bridgeFlags.actionPersistenceEnabled }
  });

  const persistenceIsUsable =
    actionPersistence.status === "inserted" || actionPersistence.status === "updated_existing" || actionPersistence.status === "duplicate_ignored";
  if (!persistenceIsUsable) {
    return { ...emptyResult(actionPersistence.warnings), messageSent: message, action: actionPersistence.action, actionPersistence };
  }

  if (actionPersistence.status === "duplicate_ignored") {
    return {
      attempted: true,
      messageSent: message,
      action: actionPersistence.action,
      actionPersistence,
      sandboxEvaluation: null,
      executionGate: null,
      outboxWritten: actionPersistence.action.outboxMessageId !== null,
      outboxId: actionPersistence.action.outboxMessageId,
      warnings: ["agent_tool_loop_already_terminal"]
    };
  }

  if (!bridgeFlags.executionGateEnabled || !bridgeFlags.outboxBridgeEnabled) {
    return {
      attempted: true,
      messageSent: message,
      action: actionPersistence.action,
      actionPersistence,
      sandboxEvaluation: null,
      executionGate: null,
      outboxWritten: false,
      outboxId: null,
      warnings: [...actionPersistence.warnings, "agent_tool_loop_gate_disabled"]
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
    messageSent: message,
    action: persistedAction,
    actionPersistence,
    sandboxEvaluation,
    executionGate,
    outboxWritten: executionGate.repositoryResult.outboxInserted || executionGate.status === "duplicate",
    outboxId: executionGate.repositoryResult.outboxRowId,
    warnings: [...actionPersistence.warnings, ...sandboxEvaluation.warnings, ...executionGate.warnings]
  };
}
