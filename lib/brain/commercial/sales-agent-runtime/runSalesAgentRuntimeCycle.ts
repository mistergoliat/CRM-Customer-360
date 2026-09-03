import { runSalesAgentRuntime } from "./salesAgentRuntime";
import type { SalesAgentRuntimeResult } from "./salesAgentRuntime";
import type { AgentRuntimeEvent } from "../agent-runtime-event/types";
import { dispatchSalesAgentTerminalOutcome } from "./dispatchSalesAgentTerminalOutcome";
import type { DispatchSalesAgentTerminalOutcomeResult } from "./dispatchSalesAgentTerminalOutcome";
import { recordAgentToolLoopCompletedCommercialEvent } from "../events/service";
import { appendAgentSessionEventWithRetry } from "../agent-session/appendWithRetry";
import { buildAssistantMessageDedupeKey } from "../agent-session/dedupe";
import { getDefaultAgentSessionStore } from "../agent-session/defaultStore";
import type { AgentSessionAssistantMessagePayload } from "../agent-session/types";
import type { AgentSessionStore } from "../agent-session/store";
import { runSessionCompactionIfEligible } from "../agent-session/runSessionCompaction";
import {
  SESSION_COMPACTION_DEFAULT_MAX_RAW_MESSAGES,
  SESSION_COMPACTION_DEFAULT_TARGET_RECENT_MESSAGES
} from "../agent-session/sessionCompactionPolicy";
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
  /** Test/DI seam - defaults to the real, MariaDB-backed AgentSessionStore. Threaded to runSalesAgentRuntime unchanged, and used directly by this file's own post-dispatch ASSISTANT_MESSAGE_SENT write (V1.8-D2). */
  sessionStore?: AgentSessionStore;
  /** SALES-AGENT-R3-V1.8-D4. Threaded to runSalesAgentRuntime unchanged - see that type's own comment. Read by the caller (runNativeAutonomousCycle.ts) via buildPersistentSessionShadowFeatureFlags, never inside this file. */
  persistentSessionShadowEnabled?: boolean;
  /** SALES-AGENT-R3-V1.8-D5/D6. Threaded to runSalesAgentRuntime unchanged - see that type's own comment. Default-true since D6, read by the caller (runNativeAutonomousCycle.ts) via shouldEnablePersistentSessionCognition, never inside this file. */
  persistentSessionCognitionEnabled?: boolean;
  /**
   * SALES-AGENT-R3-V1.8-D7. Fail-closed (default false), read by the caller
   * (runNativeAutonomousCycle.ts) via buildSessionCompactionFeatureFlags -
   * unlike the D5/D6 flags above, this one IS consumed inside this file (the
   * post-dispatch compaction check below), never inside runSalesAgentRuntime
   * itself (compaction is a context-management optimization, not a
   * per-decision concern of the loop).
   */
  sessionCompactionEnabled?: boolean;
  sessionCompactionMaxRawMessages?: number;
  sessionCompactionTargetRecentMessages?: number;
  /**
   * SALES-AGENT-R3-V1.8.1. Set only by the inbound turn-settlement worker,
   * when this turn aggregates more than one raw WhatsApp fragment
   * (conversation_message rows) into `customerMessage`. Every id here MUST
   * also be excluded from persistent-session history alongside `messageId`
   * itself, or the same fragment text would appear twice: once folded into
   * `customerMessage`, once again as a standalone historical "user" turn.
   * Never includes `messageId`/`inboundMessageId` itself (those are already
   * excluded by the existing single-id path).
   */
  additionalInboundMessageIds?: readonly string[] | null;
  /**
   * SALES-AGENT-R3-V1.8.1. Set only by the turn-settlement worker - see
   * dispatchGovernedSalesAgentMessage.ts's own comment. Threaded into the
   * terminal dispatcher, never read anywhere else in this file.
   */
  checkInboundFreshnessBeforeDispatch?: boolean;
  /** SALES-AGENT-R3-V1.8.1b-A (Objetivo A). Resolved by the caller from BRAIN_R3_LIVE_TURN_ASSIMILATION_ENABLED - threaded to runSalesAgentRuntime unchanged. */
  liveTurnAssimilationEnabled?: boolean;
  /** SALES-AGENT-R3-V1.8.1b-A. Threaded to runSalesAgentRuntime unchanged - see RunAgentToolLoopInput's own comment. */
  refreshCommercialContextSummary?: () => Promise<Record<string, unknown>>;
  /**
   * SALES-AGENT-R3-V1.8.1b-A. Set only by the turn-settlement worker
   * (row.id) - the settlement row THIS turn's own cognitive run owns, so its
   * own PROCESSING->COMPLETED transition and any sibling settlement
   * reconciliation can commit atomically with the dispatch transaction that
   * consumed them (dispatchGovernedSalesAgentMessage.ts). null for every
   * caller that isn't the turn-settlement worker (e.g. delay=0 direct
   * dispatch has no settlement row at all).
   */
  selfSettlementId?: number | null;
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
export function buildMinimalCommercialContextSummary(
  snapshot: CommercialContextSnapshot,
  inboundMessageId: string,
  customerMessage: string,
  additionalInboundMessageIds: readonly string[]
): Record<string, unknown> {
  const recentMessages = snapshot.recentMessages.filter((message, index, messages) => {
    if (message.id === inboundMessageId) return false;
    // SALES-AGENT-R3-V1.8.1: same duplication guard as deriveMessages.ts's
    // additionalExcludedMessageIds, applied to this legacy fallback context
    // too - persistent-session cognition is the default path, but a degraded
    // read still falls back to this field (Section J).
    if (additionalInboundMessageIds.includes(message.id)) return false;
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

/**
 * SALES-AGENT-R3-V1.8-D2. Moved here from the pre-D2 shadow recorder
 * (salesAgentRuntime.ts, pre-dispatch) - this is the boundary that actually
 * owns the terminal dispatch outcome, per V1.8-D2 Section I ("one event, one
 * clear writer"). `outcome`/`terminalReason` are computed from the loop's
 * own result (unchanged semantic from the pre-D2 shadow write - a pure
 * relocation, not a behavior change).
 *
 * outboundMessagePublicId is always null today - a real finding from tracing
 * every R3-native dispatch path (dispatchSalesAgentResponse/
 * dispatchSalesAgentFallback/dispatchSalesAgentHardHandoff, all the way
 * through dispatchGovernedSalesAgentMessage.ts): none of them create or have
 * access to a conversation_message row synchronously. The canonical outbound
 * row is only ever created later, asynchronously, by the outbox-send worker
 * (lib/brain/messaging/outboundMessages.ts#persistCanonicalOutboundMessage,
 * called from outboxWorker.ts/autonomousOutboxTick.ts once Meta confirms
 * delivery) - never within this call stack. Closing that gap is out of D2's
 * scope (Section A forbids changing outbox/delivery semantics); see the D2
 * release doc's "known deferred items."
 */
async function recordAssistantMessageSentEvent(input: {
  conversationId: number;
  inboundMessageId: string;
  correlationId: string;
  loop: AgentLoopResult;
  store?: AgentSessionStore;
}): Promise<{ ok: true } | { ok: false; warning: string }> {
  const store = input.store ?? getDefaultAgentSessionStore();
  const outcome: AgentSessionAssistantMessagePayload["outcome"] =
    input.loop.finalMessage !== null ? "message" : input.loop.handoffReason !== null ? "handoff" : "none";
  const payload: AgentSessionAssistantMessagePayload = {
    inboundMessageId: input.inboundMessageId,
    outcome,
    terminalReason: input.loop.terminalReason,
    outboundMessagePublicId: null
  };

  try {
    const session = await store.ensureSession({ conversationId: input.conversationId });
    const result = await appendAgentSessionEventWithRetry(store, {
      sessionId: session.id,
      conversationId: input.conversationId,
      eventType: "ASSISTANT_MESSAGE_SENT",
      correlationId: input.correlationId,
      dedupeKey: buildAssistantMessageDedupeKey(session.id, input.inboundMessageId),
      payload
    });
    if (result.status === "degraded" || result.status === "invalid") return { ok: false, warning: result.warning };
    return { ok: true };
  } catch (error) {
    return { ok: false, warning: error instanceof Error ? error.message : String(error) };
  }
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
    commercialContextSummary: buildMinimalCommercialContextSummary(
      input.snapshot,
      input.inboundMessageId,
      input.customerMessage,
      input.additionalInboundMessageIds ?? []
    ),
    recentCatalogContext: input.recentCatalogContext ?? null,
    pendingCatalogAction: input.pendingCatalogAction ?? null,
    identityConfiguration,
    maxDecisions: effectiveLoopConfiguration.maxAgentStepsPerTurn,
    maxToolExecutions: effectiveLoopConfiguration.maxToolCallsPerTurn,
    timeoutMs: effectiveModelConfiguration.timeoutMs,
    abortSignal: input.abortSignal,
    governance: { humanOwnerActive, aiBlocked },
    sessionStore: input.sessionStore,
    persistentSessionShadowEnabled: input.persistentSessionShadowEnabled,
    persistentSessionCognitionEnabled: input.persistentSessionCognitionEnabled,
    additionalInboundMessageIds: input.additionalInboundMessageIds,
    liveTurnAssimilationEnabled: input.liveTurnAssimilationEnabled,
    refreshCommercialContextSummary: input.refreshCommercialContextSummary
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

  // SALES-AGENT-R3-V1.8.1b-A (Objetivo A). Present only when live
  // assimilation was actually eligible AND the loop resolved a real anchor
  // this turn - absent (undefined) for every flag-off turn, keeping that
  // path byte-identical (no new transactional work inside
  // dispatchGovernedSalesAgentMessage.ts gets exercised at all when this is
  // undefined, not merely a harmless no-op value).
  const liveAssimilation =
    input.liveTurnAssimilationEnabled && runtime.finalAssimilatedInboundMessageId !== null
      ? { finalAssimilatedInboundMessageId: runtime.finalAssimilatedInboundMessageId, selfSettlementId: input.selfSettlementId ?? null }
      : null;

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
      commercialNeed: buildCommercialNeed(input.snapshot),
      checkInboundFreshness: input.checkInboundFreshnessBeforeDispatch,
      liveAssimilation
    })
  );

  // SALES-AGENT-R3-V1.8-D2. Written here, after terminal dispatch - see
  // recordAssistantMessageSentEvent's own comment for why this boundary
  // (not salesAgentRuntime.ts, and not dispatchSalesAgentTerminalOutcome.ts
  // itself) owns this write, and why outboundMessagePublicId is always null
  // today. Never blocks the turn - the customer's response was already
  // dispatched (or correctly not) above.
  const assistantMessageResult = await recordAssistantMessageSentEvent({
    conversationId: input.conversationId,
    inboundMessageId: input.inboundMessageId,
    correlationId: input.correlationId,
    loop,
    store: input.sessionStore
  });
  if (!assistantMessageResult.ok) {
    loop.warnings.push(`agent_session_assistant_message_event_write_failed:${assistantMessageResult.warning}`);
  }

  // SALES-AGENT-R3-V1.8-D7. Lazily checked after every turn, never blocking
  // the response above (already dispatched or correctly not) - a compaction
  // failure only ever produces a warning here (exit gate G8). Own flag,
  // independent of every other post-dispatch write in this function.
  if (input.sessionCompactionEnabled) {
    try {
      const compactionResult = await runSessionCompactionIfEligible({
        conversationId: input.conversationId,
        correlationId: input.correlationId,
        maxRawMessages: input.sessionCompactionMaxRawMessages ?? SESSION_COMPACTION_DEFAULT_MAX_RAW_MESSAGES,
        targetRecentMessages: input.sessionCompactionTargetRecentMessages ?? SESSION_COMPACTION_DEFAULT_TARGET_RECENT_MESSAGES,
        sessionStore: input.sessionStore
      });
      if (compactionResult.ran && !compactionResult.persisted) {
        loop.warnings.push(`session_compaction_failed:${compactionResult.warning}`);
      }
    } catch (error) {
      loop.warnings.push(`session_compaction_failed:${error instanceof Error ? error.message : "unknown"}`);
    }
  }

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
      pendingCatalogAction: persistedPendingCatalogAction ?? undefined,
      liveTurnAssimilation: liveAssimilation
        ? {
            finalAssimilatedInboundMessageId: liveAssimilation.finalAssimilatedInboundMessageId,
            assimilatedInboundCount: runtime.assimilatedInboundMessageIds.length,
            assimilationCycleCount: runtime.assimilationCycleCount,
            invalidatedCandidateCount: runtime.invalidatedCandidateCount
          }
        : undefined
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    loop.warnings.push(`agent_tool_loop_completed_event_write_failed:${message}`);
  }

  return { runtime, dispatch, humanOwnerActive, aiBlocked };
}
