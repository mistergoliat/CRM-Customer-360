import { runAgentToolLoop } from "./runAgentToolLoop";
import { dispatchAgentLoopResponse, type DispatchAgentLoopResponseResult } from "./dispatchAgentLoopResponse";
import { recordAgentToolLoopCompletedCommercialEvent } from "../events/service";
import type { ContinuityFallbackContext } from "../continuity/buildContinuityFallbackMessage";
import type { AgentLoopProvider } from "./agentLoopProviderTypes";
import type { AgentLoopResult } from "./agentStepTypes";
import type { NativeCustomerSessionExecutionContext } from "../native-cycle/customer-session";
import type { CommercialContextSnapshot } from "../context/buildNativeCommercialContext";

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

  const loop = await runAgentToolLoop({
    correlationId: input.correlationId,
    conversationId: input.conversationId,
    opportunityId,
    currentTime: input.currentTime,
    customerMessage: input.customerMessage,
    commercialContextSummary: buildCommercialContextSummary(input.snapshot),
    provider: input.provider,
    trustedCustomerSession: input.trustedCustomerSession,
    abortSignal: input.abortSignal
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
    handoffReasonPresent: loop.handoffReason !== null
  }).catch(() => void 0);

  return { loop, dispatch, humanOwnerActive, aiBlocked };
}
