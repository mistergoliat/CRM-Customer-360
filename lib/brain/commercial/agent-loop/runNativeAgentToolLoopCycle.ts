import { runAgentToolLoop } from "./runAgentToolLoop";
import { dispatchAgentLoopResponse, type DispatchAgentLoopResponseResult } from "./dispatchAgentLoopResponse";
import { recordAgentToolLoopCompletedCommercialEvent } from "../events/service";
import type { AgentToolLoopStepSummary } from "../events/types";
import type { ContinuityFallbackContext } from "../continuity/buildContinuityFallbackMessage";
import type { AgentLoopProvider } from "./agentLoopProviderTypes";
import type { AgentLoopResult } from "./agentStepTypes";
import type { NativeCustomerSessionExecutionContext } from "../native-cycle/customer-session";
import type { CommercialContextSnapshot } from "../context/buildNativeCommercialContext";
import type { ResolvedSalesAgentConfiguration } from "../sales-agent-configuration";

export type RunNativeAgentToolLoopCycleInput = {
  conversationId: number;
  waId: string;
  inboundMessageId: string;
  correlationId: string;
  currentTime: string;
  customerMessage: string;
  snapshot: CommercialContextSnapshot;
  provider: AgentLoopProvider | null;
  trustedCustomerSession?: NativeCustomerSessionExecutionContext | null;
  abortSignal?: AbortSignal | null;
  /**
   * ACS-R1-05.1-T02.3B. Resolved exactly once per cycle by the caller
   * (runNativeAutonomousCycle.ts) - this function never calls
   * resolveSalesAgentConfiguration() itself, and never touches the database.
   */
  resolvedSalesAgentConfiguration: ResolvedSalesAgentConfiguration;
};

export type NativeAgentToolLoopCycleResult = {
  loop: AgentLoopResult;
  dispatch: DispatchAgentLoopResponseResult;
  humanOwnerActive: boolean;
  aiBlocked: boolean;
};

function buildCommercialContextSummary(snapshot: CommercialContextSnapshot): Record<string, unknown> {
  return {
    opportunityStatus: snapshot.opportunity?.status ?? null,
    opportunityStage: snapshot.opportunity?.stage ?? null,
    needProfile: snapshot.needProfile
      ? {
          useCase: snapshot.needProfile.useCase,
          budgetMax: snapshot.needProfile.budgetMax,
          requiredFeatures: snapshot.needProfile.requiredFeatures
        }
      : null,
    recentMessages: snapshot.recentMessages.slice(-5).map((message) => ({ direction: message.direction, body: message.body }))
  };
}

/** ACS-R1-05.1-T02.1 (post-smoke fix, point 8). Bounded structural summary only - never raw arguments or observation data. */
function buildStepsSummary(loop: AgentLoopResult): AgentToolLoopStepSummary[] {
  return loop.steps.map((record) => ({
    stepIndex: record.stepIndex,
    type: record.step.type,
    phase: record.phase,
    tool: record.step.type === "use_tool" ? record.step.tool : undefined,
    governance: record.governance ?? undefined,
    observationStatus: record.observation?.status ?? undefined
  }));
}

function buildCommercialNeed(snapshot: CommercialContextSnapshot): ContinuityFallbackContext {
  return {
    productQuery: null,
    usage: snapshot.needProfile?.useCase ?? null,
    budgetMax: snapshot.needProfile?.budgetMax ?? null,
    currency: null
  };
}

function skippedResult(reason: string, humanOwnerActive: boolean, aiBlocked: boolean): NativeAgentToolLoopCycleResult {
  const loop: AgentLoopResult = {
    ran: false,
    terminalReason: "handoff",
    steps: [],
    toolExecutionCount: 0,
    finalMessage: null,
    handoffReason: reason,
    warnings: [reason]
  };
  return {
    loop,
    dispatch: { attempted: false, messageSent: null, action: null, actionPersistence: null, sandboxEvaluation: null, executionGate: null, outboxWritten: false, outboxId: null, warnings: [reason] },
    humanOwnerActive,
    aiBlocked
  };
}

const SALES_AGENT_CONFIGURATION_UNAVAILABLE_HANDOFF_REASON = "sales_agent_configuration_unavailable";

export type RunNativeAgentToolLoopCycleConfigurationFailureInput = {
  conversationId: number;
  waId: string;
  inboundMessageId: string;
  correlationId: string;
  currentTime: string;
  snapshot: CommercialContextSnapshot;
  /**
   * Internal only - the real technical cause (e.g. a DB error message).
   * Never reaches the customer and is never persisted verbatim to a
   * commercial_event - it only ever surfaces in this cycle's own
   * `warnings` (returned up through NativeAutonomousCycleResult.warnings),
   * the same place every other technical failure in
   * runNativeAutonomousCycle.ts (shadow_failed, loop_failed,
   * bridge_failed, ...) already surfaces internally.
   */
  technicalReason: string;
};

/**
 * ACS-R1-05.1-T02.3B (fix). A real Sales Agent Configuration resolution
 * failure (DB/repository error - never "nothing published", which the
 * resolver already resolves on its own to a deployment/safe default) must
 * never license inventing a default personality and keep calling the
 * model. The model is never invoked here.
 *
 * A human-owned or AI-blocked conversation still never gets an
 * AI-authored message (A4 invariant, unchanged) - skippedResult below
 * covers that, with zero dispatch, same as the normal path. Otherwise,
 * this dispatches a real, neutral handoff acknowledgement through the
 * exact same pipeline any other terminal handoff uses
 * (dispatchAgentLoopResponse -> buildContinuityFallbackMessage
 * ("handoff_acknowledgement", ...)) - never a bespoke message, and never
 * a table name, SQL error, timeout, or stack trace.
 *
 * `ran: true` (not the skipped-result shape): ensureAutonomousSalesTurnContinuity
 * branches on `agentLoop.ran` - `false` means "skipped, human/AI already
 * owns it, nothing to check", which would misreport this real, dispatched
 * acknowledgement as if nothing had been sent. `ran: true` routes it
 * through continuity's normal dispatch-outcome check instead, which never
 * attempts a second, redundant dispatch once dispatch.outboxWritten is
 * true.
 */
export async function runNativeAgentToolLoopCycleConfigurationFailure(
  input: RunNativeAgentToolLoopCycleConfigurationFailureInput
): Promise<NativeAgentToolLoopCycleResult> {
  const humanOwnerActive = input.snapshot.signals.humanOwnerActive;
  const aiBlocked = input.snapshot.signals.aiBlocked;

  if (humanOwnerActive || aiBlocked) {
    return skippedResult(input.technicalReason, humanOwnerActive, aiBlocked);
  }

  const opportunityId = typeof input.snapshot.opportunity?.id === "number" ? input.snapshot.opportunity.id : null;
  const conversationCaseId = input.snapshot.opportunity?.conversationCaseId ?? input.conversationId;

  const loop: AgentLoopResult = {
    ran: true,
    terminalReason: "handoff",
    steps: [],
    toolExecutionCount: 0,
    finalMessage: null,
    handoffReason: SALES_AGENT_CONFIGURATION_UNAVAILABLE_HANDOFF_REASON,
    warnings: [input.technicalReason]
  };

  const dispatch = await dispatchAgentLoopResponse({
    conversationId: input.conversationId,
    conversationCaseId,
    opportunityId,
    waId: input.waId,
    inboundMessageId: input.inboundMessageId,
    currentTime: input.currentTime,
    humanOwnerActive,
    aiBlocked,
    caseStatus: input.snapshot.opportunity?.status ?? input.snapshot.conversation?.status ?? null,
    loop,
    commercialNeed: buildCommercialNeed(input.snapshot)
  });

  return { loop, dispatch, humanOwnerActive, aiBlocked };
}

/**
 * ACS-R1-05.1-T02.1. Runs the native read-only agent tool loop for one
 * inbound turn and dispatches its terminal outcome. A conversation a human
 * already owns, or that is AI-blocked, never reaches the model at all - same
 * invariant the older reactive continuity path enforces (A4 in the
 * ACS-R1-05-T06.2 release spec section), sourced here directly from
 * CommercialContextSnapshot.signals instead of the old operational loop's
 * reduced state.
 */
export async function runNativeAgentToolLoopCycle(input: RunNativeAgentToolLoopCycleInput): Promise<NativeAgentToolLoopCycleResult> {
  const humanOwnerActive = input.snapshot.signals.humanOwnerActive;
  const aiBlocked = input.snapshot.signals.aiBlocked;

  if (humanOwnerActive || aiBlocked) {
    return skippedResult("agent_tool_loop_skipped_human_owner_or_ai_blocked", humanOwnerActive, aiBlocked);
  }

  const opportunityId = typeof input.snapshot.opportunity?.id === "number" ? input.snapshot.opportunity.id : null;
  const conversationCaseId = input.snapshot.opportunity?.conversationCaseId ?? input.conversationId;
  const { configuration: identityConfiguration, effectiveModelConfiguration, effectiveLoopConfiguration } = input.resolvedSalesAgentConfiguration;

  const loop = await runAgentToolLoop({
    correlationId: input.correlationId,
    conversationId: input.conversationId,
    opportunityId,
    currentTime: input.currentTime,
    customerMessage: input.customerMessage,
    commercialContextSummary: buildCommercialContextSummary(input.snapshot),
    provider: input.provider,
    trustedCustomerSession: input.trustedCustomerSession,
    abortSignal: input.abortSignal,
    identityConfiguration,
    maxDecisions: effectiveLoopConfiguration.maxAgentStepsPerTurn,
    maxToolExecutions: effectiveLoopConfiguration.maxToolCallsPerTurn,
    timeoutMs: effectiveModelConfiguration.timeoutMs
  });

  const dispatch = await dispatchAgentLoopResponse({
    conversationId: input.conversationId,
    conversationCaseId,
    opportunityId,
    waId: input.waId,
    inboundMessageId: input.inboundMessageId,
    currentTime: input.currentTime,
    humanOwnerActive,
    aiBlocked,
    caseStatus: input.snapshot.opportunity?.status ?? input.snapshot.conversation?.status ?? null,
    loop,
    commercialNeed: buildCommercialNeed(input.snapshot)
  });

  await recordAgentToolLoopCompletedCommercialEvent({
    inboundMessageId: input.inboundMessageId,
    correlationId: input.correlationId,
    conversationId: input.conversationId,
    opportunityId,
    terminalReason: loop.terminalReason,
    decisionCount: loop.steps.length,
    toolExecutionCount: loop.toolExecutionCount,
    toolsUsed: [...new Set(loop.steps.filter((record) => record.step.type === "use_tool").map((record) => (record.step as { tool: string }).tool))],
    finalMessagePresent: loop.finalMessage !== null,
    handoffReasonPresent: loop.handoffReason !== null,
    stepsSummary: buildStepsSummary(loop),
    // ACS-R1-05.1-T02.3B: which configuration produced this turn's prompt/
    // model/loop parameters, and the effective (already-clamped) values
    // actually used - never just what was requested. No prompt text, no
    // secrets - see the events/normalize.ts payload comment.
    configurationSource: input.resolvedSalesAgentConfiguration.source,
    configurationRecordId: input.resolvedSalesAgentConfiguration.recordId,
    configurationVersion: input.resolvedSalesAgentConfiguration.version,
    configurationHash: input.resolvedSalesAgentConfiguration.configurationHash,
    effectiveModel: effectiveModelConfiguration.model,
    effectiveTemperature: effectiveModelConfiguration.temperature,
    effectiveMaxOutputSize: effectiveModelConfiguration.maxOutputTokens,
    effectiveTimeoutMs: effectiveModelConfiguration.timeoutMs,
    effectiveMaxAgentStepsPerTurn: effectiveLoopConfiguration.maxAgentStepsPerTurn,
    effectiveMaxToolCallsPerTurn: effectiveLoopConfiguration.maxToolCallsPerTurn
  }).catch(() => void 0);

  return { loop, dispatch, humanOwnerActive, aiBlocked };
}
