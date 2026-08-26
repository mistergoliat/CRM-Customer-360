import { createHash } from "node:crypto";
import { persistAgentAction } from "../action-queue";
import type { CrmAgentAction, PersistAgentActionResult } from "../action-queue";
import { buildSandboxAutonomyConfig, evaluateAgentActionForSandbox } from "../autonomy-sandbox";
import type { SandboxAutonomyAgentActionContext, SandboxAutonomyEvaluationResult } from "../autonomy-sandbox";
import { executeActionThroughGate, SqlExecutionUnitOfWork } from "../execution-gate";
import type { ExecutionGateResult } from "../execution-gate";
import { buildCommercialBridgeFeatureFlags } from "../config/commercialCycleConfig";
import { buildContinuityFallbackMessage } from "../continuity/buildContinuityFallbackMessage";
import { takeHumanControlForAiHandoff } from "@/lib/domains/conversations/control";
import type { PersistedCommercialWork } from "./persistenceTypes";
import { buildCommercialWorkFinalizerMessage, type CommercialWorkDisposition } from "./buildCommercialWorkFinalizerMessage";
import type { OnboardingCollectionSnapshot } from "./identityCollectionRequest";

function parseEnvCsv(name: string, fallback: string[] = []): string[] {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export type DispatchCommercialWorkResponseInput = {
  conversationId: number;
  conversationCaseId: number | string | null;
  opportunityId: number | string | null;
  waId: string;
  inboundMessageId: string;
  currentTime: string;
  humanOwnerActive: boolean;
  aiBlocked: boolean;
  caseStatus: string | null;
  /** null means the turn never reached a persisted CommercialWork (e.g. planner failure before planning) - dispatches a neutral fallback only. */
  work: PersistedCommercialWork | null;
  /** Set only for a controlled fallback/handoff that never reached (or does not trust) `work`'s own finalizer message - see runCommercialWorkInboundCycle.ts's provider-failure and internal-exception paths. */
  forcedFallback?: "model_unavailable" | "handoff_acknowledgement" | null;
  /**
   * SALES-AGENT-R2-ID-R2-A08. This turn's freshest onboarding snapshot
   * (privacy-safe projection only - see identityCollectionRequest.ts),
   * passed straight through to buildCommercialWorkFinalizerMessage. Optional:
   * omitted by every existing caller/test keeps current behavior unchanged.
   */
  identityOnboarding?: OnboardingCollectionSnapshot | null;
};

export type DispatchCommercialWorkResponseResult = {
  attempted: boolean;
  disposition: CommercialWorkDisposition | "fallback";
  messageSent: string | null;
  action: CrmAgentAction | null;
  actionPersistence: PersistAgentActionResult | null;
  sandboxEvaluation: SandboxAutonomyEvaluationResult | null;
  executionGate: ExecutionGateResult | null;
  outboxWritten: boolean;
  outboxId: number | null;
  warnings: string[];
};

function emptyResult(disposition: CommercialWorkDisposition | "fallback", warnings: string[]): DispatchCommercialWorkResponseResult {
  return {
    attempted: false,
    disposition,
    messageSent: null,
    action: null,
    actionPersistence: null,
    sandboxEvaluation: null,
    executionGate: null,
    outboxWritten: false,
    outboxId: null,
    warnings
  };
}

function buildIdempotencyKey(conversationId: number, inboundMessageId: string, work: PersistedCommercialWork | null): string {
  const workPart = work ? `${work.publicId}:${work.version}` : "no-work";
  return `commercial-work:${conversationId}:${inboundMessageId}:${workPart}`;
}

function buildAction(input: DispatchCommercialWorkResponseInput, idempotencyKey: string, message: string, dispositionForPolicyNote: string): CrmAgentAction {
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
    policyNotes: [`commercial_work:${dispositionForPolicyNote}`],
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
 * SALES-AGENT-R2-A08.5. Sibling of agent-loop/dispatchAgentLoopResponse.ts,
 * same real pipeline (persistAgentAction -> sandbox -> executeActionThroughGate,
 * the canonical outbox writer) and same idempotency/control-transfer
 * discipline - a new orchestrating function only because CommercialWork's
 * terminal shape (FINAL/PARTIAL/BLOCKED, or a forced fallback for a turn
 * that never reached a persisted work) is not an AgentLoopResult, so it
 * cannot reuse that function's message-selection switch. Never invents a
 * message itself: FINAL/PARTIAL/BLOCKED text comes from
 * buildCommercialWorkFinalizerMessage (grounded in the persisted aggregate),
 * and a forced fallback reuses the exact same deterministic
 * buildContinuityFallbackMessage vocabulary the legacy loop already uses.
 */
export async function dispatchCommercialWorkResponse(input: DispatchCommercialWorkResponseInput): Promise<DispatchCommercialWorkResponseResult> {
  const bridgeFlags = buildCommercialBridgeFeatureFlags();
  if (!bridgeFlags.actionQueueEnabled) {
    return emptyResult("fallback", ["commercial_work_action_queue_disabled"]);
  }

  const neutralContext = { productQuery: null, usage: null, budgetMax: null, currency: null };
  let disposition: CommercialWorkDisposition | "fallback";
  let message: string;
  let isHandoff = false;

  if (input.forcedFallback) {
    disposition = "fallback";
    message = buildContinuityFallbackMessage(input.forcedFallback, neutralContext);
    isHandoff = input.forcedFallback === "handoff_acknowledgement";
  } else if (!input.work) {
    disposition = "fallback";
    message = buildContinuityFallbackMessage("model_unavailable", neutralContext);
  } else {
    const finalized = buildCommercialWorkFinalizerMessage(input.work, input.identityOnboarding ?? null);
    disposition = finalized.disposition;
    message = finalized.message;
    isHandoff = input.work.status === "HANDOFF";
  }

  if (isHandoff && bridgeFlags.actionPersistenceEnabled) {
    await takeHumanControlForAiHandoff({
      conversationId: input.conversationId,
      currentTime: input.currentTime,
      reason: "commercial_work_handoff"
    });
  }

  const idempotencyKey = buildIdempotencyKey(input.conversationId, input.inboundMessageId, input.work);
  const action = buildAction(input, idempotencyKey, message, disposition);

  const actionPersistence = await persistAgentAction({
    action,
    currentTime: input.currentTime,
    featureFlags: { queueEnabled: bridgeFlags.actionQueueEnabled, persistenceEnabled: bridgeFlags.actionPersistenceEnabled }
  });

  const persistenceIsUsable =
    actionPersistence.status === "inserted" || actionPersistence.status === "updated_existing" || actionPersistence.status === "duplicate_ignored";
  if (!persistenceIsUsable) {
    return { ...emptyResult(disposition, actionPersistence.warnings), messageSent: message, action: actionPersistence.action, actionPersistence };
  }

  if (actionPersistence.status === "duplicate_ignored") {
    return {
      attempted: true,
      disposition,
      messageSent: message,
      action: actionPersistence.action,
      actionPersistence,
      sandboxEvaluation: null,
      executionGate: null,
      outboxWritten: actionPersistence.action.outboxMessageId !== null,
      outboxId: actionPersistence.action.outboxMessageId,
      warnings: ["commercial_work_already_terminal"]
    };
  }

  if (!bridgeFlags.executionGateEnabled || !bridgeFlags.outboxBridgeEnabled) {
    return {
      attempted: true,
      disposition,
      messageSent: message,
      action: actionPersistence.action,
      actionPersistence,
      sandboxEvaluation: null,
      executionGate: null,
      outboxWritten: false,
      outboxId: null,
      warnings: [...actionPersistence.warnings, "commercial_work_gate_disabled"]
    };
  }

  const persistedAction = actionPersistence.action;
  const sandboxWaIds = parseEnvCsv("BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS");
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
    disposition,
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
