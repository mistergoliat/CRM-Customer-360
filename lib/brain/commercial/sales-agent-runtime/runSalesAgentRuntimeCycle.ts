import { runSalesAgentRuntime } from "./salesAgentRuntime";
import type { SalesAgentRuntimeResult } from "./salesAgentRuntime";
import type { AgentRuntimeEvent } from "../agent-runtime-event/types";
import { dispatchSalesAgentTerminalOutcome } from "./dispatchSalesAgentTerminalOutcome";
import type { DispatchSalesAgentTerminalOutcomeResult } from "./dispatchSalesAgentTerminalOutcome";
import { recordAgentToolLoopCompletedCommercialEvent } from "../events/service";
import type { AgentLoopProvider } from "../agent-loop/agentLoopProviderTypes";
import type { AgentLoopResult, AgentLoopTerminalReason, PendingCatalogActionStep } from "../agent-loop/agentStepTypes";
import type { RecentCatalogContext } from "../agent-loop/recentCatalogContext";
import type { ContinuityFallbackContext } from "../continuity/buildContinuityFallbackMessage";
import type { NativeCustomerSessionExecutionContext } from "../native-cycle/customer-session";
import type { CommercialContextSnapshot } from "../context/buildNativeCommercialContext";
import type { ResolvedSalesAgentConfiguration } from "../sales-agent-configuration";

// SALES-AGENT-R3-V1.4/V1.5/V1.6. The channel-adapter/dispatch seam around
// SalesAgentRuntime (V1.3) - deliberately NOT part of the runtime module
// itself (see salesAgentRuntime.ts's own "SalesAgentRuntime reasons, the
// channel adapter routes" boundary). This file is the adapter: it builds a
// CustomerMessageEvent from already-normalized WhatsApp inbound data, calls
// the runtime, and dispatches the terminal outcome. Since V1.6, EVERY
// terminal reason (responded/handoff/timeout/invalid_output/
// max_steps_exceeded/provider_unavailable) dispatches through the single
// R3-native dispatchSalesAgentTerminalOutcome.ts boundary - this file no
// longer imports or calls the old R1 response dispatcher (the R1 action-
// lifecycle stack: action persistence -> autonomy-sandbox -> execution-gate). See
// docs/releases/SALES-AGENT-R3-V1.5-native-response-dispatch.md and
// docs/releases/SALES-AGENT-R3-V1.6-native-terminal-dispatch.md.
// recordAgentToolLoopCompletedCommercialEvent (cross-turn RecentCatalogContext
// continuity, Phase 9 of the V1.4 task) runs for every terminal reason,
// unchanged. Never a second outbox writer, never a second
// agent_tool_loop_completed-shaped event type for this table.
//
// Deliberately NOT a reuse of runNativeAgentToolLoopCycle.ts itself: that
// function bundles ATL-specific machinery (customer-profile-context
// loading, the multi-intent planner routing decision) this task's Scope
// Guard does not need and must not drag into the R3 boundary - see
// docs/releases/SALES-AGENT-R3-V1.3-first-sales-agent-runtime.md's own
// Phase 1 audit table for why that function was judged "not reusable as a
// whole."

export type RunSalesAgentRuntimeCycleInput = {
  conversationId: number;
  conversationPublicId: string;
  customerMasterId: number | null;
  waId: string;
  phoneNumberId: string;
  messageId: string | number | null;
  inboundMessageId: string;
  correlationId: string;
  currentTime: string;
  customerMessage: string;
  snapshot: CommercialContextSnapshot;
  provider: AgentLoopProvider | null;
  trustedCustomerSession?: NativeCustomerSessionExecutionContext | null;
  recentCatalogContext?: RecentCatalogContext | null;
  pendingCatalogAction?: PendingCatalogActionStep | null;
  abortSignal?: AbortSignal | null;
  resolvedSalesAgentConfiguration: ResolvedSalesAgentConfiguration;
};

/**
 * SALES-AGENT-R3-V1.6. Locally defined, not imported from the old R1 response
 * dispatcher module - "do not expose R1 types as the primary contract" (V1.6
 * task). Structurally identical to that module's own result type so this
 * function's public return type and
 * every downstream reader (ensureAutonomousSalesTurnContinuity.ts's
 * `cycle.salesAgentRuntime` branch, which reads `dispatch.action?.opportunityId`/
 * `dispatch.executionGate?.status`) need zero changes -
 * action/actionPersistence/sandboxEvaluation/executionGate are honestly,
 * permanently `null`: no crm_agent_actions row exists for ANY SalesAgentRuntime
 * terminal outcome anymore (see dispatchSalesAgentTerminalOutcome.ts).
 */
export type SalesAgentRuntimeDispatchResult = {
  attempted: boolean;
  messageSent: string | null;
  /** Always null - kept as a minimal structural shape (never the real R1 CrmAgentAction type) only so ensureAutonomousSalesTurnContinuity.ts's existing `dispatch.action?.opportunityId`/`?.actionId` reads keep type-checking. */
  action: { opportunityId: number | string | null; actionId: string } | null;
  actionPersistence: null;
  sandboxEvaluation: null;
  /** Always null - same rationale as `action` above, for `dispatch.executionGate?.status`. */
  executionGate: { status: string } | null;
  outboxWritten: boolean;
  outboxId: number | null;
  warnings: string[];
};

export type SalesAgentRuntimeCycleResult = {
  runtime: SalesAgentRuntimeResult;
  dispatch: SalesAgentRuntimeDispatchResult;
  humanOwnerActive: boolean;
  aiBlocked: boolean;
};

/**
 * Mirrors the non-customer-profile-context portion of
 * runNativeAgentToolLoopCycle.ts#buildCommercialContextSummary - a small,
 * local duplicate (not a cross-import) of the same "no cross-module import"
 * discipline salesAgentRuntime.ts already established for buildStepsSummary.
 * customerProfileContext enrichment is deliberately not reproduced here: it
 * requires the full customer-profile-context pipeline (loadCommercialCustomerContext,
 * derived history signals), machinery this pilot's smallest-diff routing
 * seam does not need to build. Everything below is already loaded, for
 * free, on `snapshot`.
 */
function buildMinimalCommercialContextSummary(
  snapshot: CommercialContextSnapshot,
  inboundMessageId: string,
  customerMessage: string
): Record<string, unknown> {
  const recentMessages = snapshot.recentMessages.filter((message, index, messages) => {
    if (message.id === inboundMessageId) return false;
    const isLastMessage = index === messages.length - 1;
    if (isLastMessage && message.direction === "inbound" && message.body === customerMessage) return false;
    return true;
  });

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
    shippingDestination: snapshot.shippingDestination
      ? { communeId: snapshot.shippingDestination.communeId, canonicalName: snapshot.shippingDestination.canonicalName }
      : null,
    commercialLineItems: snapshot.commercialLineItems ? { items: snapshot.commercialLineItems.items } : null,
    recentMessages: recentMessages.slice(-5).map((message) => ({ direction: message.direction, body: message.body }))
  };
}

/**
 * SALES-AGENT-R3-V1.6. Maps dispatchSalesAgentTerminalOutcome's own typed
 * result (responded/fallback/hard_handoff, never an R1 type) onto this
 * file's locally defined SalesAgentRuntimeDispatchResult - see that type's
 * own comment for why action/actionPersistence/sandboxEvaluation/
 * executionGate stay permanently null.
 */
function adaptTerminalOutcomeDispatch(result: DispatchSalesAgentTerminalOutcomeResult): SalesAgentRuntimeDispatchResult {
  return {
    attempted: result.attempted,
    messageSent: result.messageSent,
    action: null,
    actionPersistence: null,
    sandboxEvaluation: null,
    executionGate: null,
    outboxWritten: result.outboxWritten,
    outboxId: result.outboxId,
    warnings: result.warnings
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

const FAILURE_REASON_TO_TERMINAL_REASON: Record<string, AgentLoopTerminalReason> = {
  timeout: "timeout",
  invalid_output: "invalid_output",
  max_steps_exceeded: "max_steps_exceeded"
};

/**
 * Inverse of salesAgentRuntime.ts's own TERMINAL_REASON_TO_STATUS table
 * (V1.3 Phase 14) - any "failed" reason this runtime never explicitly
 * enumerates (e.g. a classified provider-failure normalizedReason like
 * "network_error") falls back to "provider_unavailable", the one terminal
 * reason that table's own reverse direction already documents as the
 * catch-all for a classified provider failure.
 */
function mapToAgentLoopTerminalReason(result: SalesAgentRuntimeResult): AgentLoopTerminalReason {
  if (result.status === "responded") return "responded";
  if (result.status === "handoff") return "handoff";
  return FAILURE_REASON_TO_TERMINAL_REASON[result.reason ?? ""] ?? "provider_unavailable";
}

function skippedCycleResult(runtime: SalesAgentRuntimeResult, humanOwnerActive: boolean, aiBlocked: boolean): SalesAgentRuntimeCycleResult {
  return {
    runtime,
    dispatch: {
      attempted: false,
      messageSent: null,
      action: null,
      actionPersistence: null,
      sandboxEvaluation: null,
      executionGate: null,
      outboxWritten: false,
      outboxId: null,
      warnings: [runtime.reason ?? "sales_agent_runtime_blocked"]
    },
    humanOwnerActive,
    aiBlocked
  };
}

/**
 * SALES-AGENT-R3-V1.4. Runs SalesAgentRuntime for one inbound turn and
 * dispatches its terminal outcome through the canonical outbound pipeline.
 * A human-owned or AI-blocked conversation never reaches the model - the
 * same A4 invariant runNativeAgentToolLoopCycle.ts's own skippedResult
 * enforces - here surfaced by SalesAgentRuntime's own `governance` gate
 * (V1.3 Phase 14) rather than re-checked twice.
 */
export async function runSalesAgentRuntimeCycle(input: RunSalesAgentRuntimeCycleInput): Promise<SalesAgentRuntimeCycleResult> {
  const humanOwnerActive = input.snapshot.signals.humanOwnerActive;
  const aiBlocked = input.snapshot.signals.aiBlocked;
  const opportunityId = typeof input.snapshot.opportunity?.id === "number" ? input.snapshot.opportunity.id : null;
  const conversationCaseId = input.snapshot.opportunity?.conversationCaseId ?? input.conversationId;
  const { configuration: identityConfiguration, effectiveModelConfiguration, effectiveLoopConfiguration } = input.resolvedSalesAgentConfiguration;

  const event: AgentRuntimeEvent = {
    type: "CUSTOMER_MESSAGE",
    conversationId: input.conversationId,
    conversationPublicId: input.conversationPublicId,
    customerMasterId: input.customerMasterId,
    waId: input.waId,
    phoneNumberId: input.phoneNumberId,
    messageId: input.messageId,
    messageText: input.customerMessage,
    correlationId: input.correlationId,
    currentTime: input.currentTime
  };

  const runtime = await runSalesAgentRuntime({
    event,
    opportunityId,
    provider: input.provider,
    trustedCustomerSession: input.trustedCustomerSession,
    commercialContextSummary: buildMinimalCommercialContextSummary(input.snapshot, input.inboundMessageId, input.customerMessage),
    recentCatalogContext: input.recentCatalogContext ?? null,
    pendingCatalogAction: input.pendingCatalogAction ?? null,
    identityConfiguration,
    maxDecisions: effectiveLoopConfiguration.maxAgentStepsPerTurn,
    maxToolExecutions: effectiveLoopConfiguration.maxToolCallsPerTurn,
    timeoutMs: effectiveModelConfiguration.timeoutMs,
    abortSignal: input.abortSignal,
    governance: { humanOwnerActive, aiBlocked }
  });

  if (runtime.status === "blocked") {
    return skippedCycleResult(runtime, humanOwnerActive, aiBlocked);
  }

  // Adapter, not a second AgentLoopResult producer: only the three fields
  // dispatchSalesAgentTerminalOutcome actually reads (terminalReason/
  // finalMessage/handoffReason) matter for dispatch. steps/llmCalls stay
  // empty (never
  // fabricated per-step/per-call detail SalesAgentRuntimeResult does not
  // expose by design - V1.3 Phase 15); toolExecutionCount/warnings/
  // finalPendingCatalogAction reuse the runtime's own real values.
  const loop: AgentLoopResult = {
    ran: true,
    terminalReason: mapToAgentLoopTerminalReason(runtime),
    steps: [],
    toolExecutionCount: runtime.toolCalls,
    finalMessage: runtime.responseText,
    handoffReason: runtime.status === "handoff" ? runtime.reason : null,
    warnings: runtime.warnings,
    finalPendingCatalogAction: runtime.finalPendingCatalogAction,
    llmCalls: []
  };

  // SALES-AGENT-R3-V1.6. Every terminal reason routes through the single
  // R3-native terminal dispatcher - no more old R1 response dispatcher call
  // site, no crm_agent_actions/autonomy-sandbox/execution-gate reachable from
  // SalesAgentRuntime at all.
  const dispatch = adaptTerminalOutcomeDispatch(
    await dispatchSalesAgentTerminalOutcome({
      conversationId: input.conversationId,
      conversationCaseId,
      opportunityId: runtime.resolvedOpportunityId,
      waId: input.waId,
      inboundMessageId: input.inboundMessageId,
      correlationId: input.correlationId,
      currentTime: input.currentTime,
      humanOwnerActive,
      aiBlocked,
      loop,
      commercialNeed: buildCommercialNeed(input.snapshot)
    })
  );

  const persistedPendingCatalogAction = dispatch.outboxWritten ? runtime.finalPendingCatalogAction : null;
  if (runtime.finalPendingCatalogAction && !dispatch.outboxWritten) {
    loop.warnings.push(
      `pending_catalog_action_dropped_no_outbox:${runtime.finalPendingCatalogAction.actionType}:candidateCountBefore=${runtime.finalPendingCatalogAction.candidateProductIds.length}:candidateCountAfter=0:correlationId=${input.correlationId}`
    );
  }

  // Phase 9 (V1.4): closes V1.3's documented RecentCatalogContext gap by
  // reusing the existing pure event-recording primitive (Phase 9 option A)
  // with real, resolved configuration data - never fabricated. Correlates
  // this turn's crm_capability_executions rows to this inboundMessageId via
  // the SAME correlationId used for every tool call this turn (the loop's
  // own correlationId, event.correlationId === input.correlationId), the
  // fallback correlation path loadRecentCatalogContext's own SQL already
  // supports. A write failure here never blocks the turn - the customer
  // already has their dispatched response.
  try {
    await recordAgentToolLoopCompletedCommercialEvent({
      inboundMessageId: input.inboundMessageId,
      correlationId: input.correlationId,
      conversationId: input.conversationId,
      opportunityId: runtime.resolvedOpportunityId,
      terminalReason: loop.terminalReason,
      decisionCount: runtime.modelSteps,
      toolExecutionCount: runtime.toolCalls,
      // Individual tool names are not exposed by SalesAgentRuntimeResult by
      // design (V1.3 Phase 15: counts only) - honestly empty, never guessed.
      // Full per-tool detail remains available via crm_capability_executions/
      // AgentSession, same as every other consumer of this boundary.
      toolsUsed: [],
      finalMessagePresent: runtime.responseText !== null,
      handoffReasonPresent: runtime.status === "handoff",
      stepsSummary: [],
      configurationSource: input.resolvedSalesAgentConfiguration.source,
      configurationRecordId: input.resolvedSalesAgentConfiguration.recordId,
      configurationVersion: input.resolvedSalesAgentConfiguration.version,
      configurationHash: input.resolvedSalesAgentConfiguration.configurationHash,
      effectiveModel: effectiveModelConfiguration.model,
      effectiveTemperature: effectiveModelConfiguration.temperature,
      effectiveMaxOutputSize: effectiveModelConfiguration.maxOutputTokens ?? null,
      effectiveTimeoutMs: effectiveModelConfiguration.timeoutMs,
      effectiveMaxAgentStepsPerTurn: effectiveLoopConfiguration.maxAgentStepsPerTurn,
      effectiveMaxToolCallsPerTurn: effectiveLoopConfiguration.maxToolCallsPerTurn,
      pendingCatalogAction: persistedPendingCatalogAction ?? undefined
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    loop.warnings.push(`agent_tool_loop_completed_event_write_failed:${message}`);
  }

  return { runtime, dispatch, humanOwnerActive, aiBlocked };
}
