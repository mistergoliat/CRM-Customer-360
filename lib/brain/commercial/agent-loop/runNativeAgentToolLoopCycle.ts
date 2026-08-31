import { runAgentToolLoop } from "./runAgentToolLoop";
import type { RunAgentToolLoopInput } from "./runAgentToolLoop";
import { runCommercialMultiIntentLoop } from "../multi-intent/runCommercialMultiIntentLoop";
import { shouldRouteToMultiIntentPlanner } from "../config/commercialCycleConfig";
import { dispatchAgentLoopResponse, type DispatchAgentLoopResponseResult } from "./dispatchAgentLoopResponse";
import { recordAgentToolLoopCompletedCommercialEvent } from "../events/service";
import { recordAgentToolLoopSessionShadowEvents } from "../agent-session/shadowRecorder";
import type { AgentToolLoopLlmCallSummary, AgentToolLoopLlmMetricsPayload, AgentToolLoopStepSummary } from "../events/types";
import type { ContinuityFallbackContext } from "../continuity/buildContinuityFallbackMessage";
import type { AgentLoopProvider } from "./agentLoopProviderTypes";
import type { AgentLoopResult, PendingCatalogActionStep } from "./agentStepTypes";
import type { NativeCustomerSessionExecutionContext } from "../native-cycle/customer-session";
import type { CommercialContextSnapshot } from "../context/buildNativeCommercialContext";
import type { ResolvedSalesAgentConfiguration } from "../sales-agent-configuration";
import type { RecentCatalogContext } from "./recentCatalogContext";
import { loadCommercialCustomerContext } from "../commercial-customer-context";
import type { RuntimeIdentityContext } from "../native-cycle/customer-session";
import {
  buildCatalogHistoryComparisons,
  buildCustomerHistoryCommercialGuidance,
  buildCustomerHistoryCommercialSignalsSummary,
  buildCustomerPurchaseHistorySummary,
  buildCustomerRfmSummary,
  deriveCustomerHistoryCommercialSignals,
  deriveCustomerHistoryNeeds,
  filterRelevantCustomerHistorySignals,
  readCustomerHistoryCommercialPolicyConfig,
  type CustomerCommercialHistoryContext,
  type CustomerHistoryCommercialPolicyConfig,
  type CustomerHistoryCommercialSignal
} from "../customer-profile-context";

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
  recentCatalogContext?: RecentCatalogContext | null;
  /** ACS-R1-05.1-T02.7. A catalog action this conversation's immediately preceding turn left open. */
  pendingCatalogAction?: PendingCatalogActionStep | null;
  abortSignal?: AbortSignal | null;
  /**
   * ACS-R1-05.1-T02.3B. Resolved exactly once per cycle by the caller
   * (runNativeAutonomousCycle.ts) - this function never calls
   * resolveSalesAgentConfiguration() itself, and never touches the database.
   */
  resolvedSalesAgentConfiguration: ResolvedSalesAgentConfiguration;
  /** Test-only injection point for T12C/A10; production callers use the shared Customer Profile capability wrapper via loadCommercialCustomerContext. */
  loadCustomerProfileContext?: ((input: {
    runtimeIdentity: RuntimeIdentityContext | null;
    customerMessage: string;
    snapshot: CommercialContextSnapshot;
    recentCatalogContext?: RecentCatalogContext | null;
    pendingCatalogAction?: PendingCatalogActionStep | null;
    requestId?: string;
  }) => Promise<CustomerCommercialHistoryContext | null>) | null;
  /** Test-only injection point for T12D; production callers rely on readCustomerHistoryCommercialPolicyConfig() reading the real environment. */
  customerHistoryCommercialPolicyConfig?: CustomerHistoryCommercialPolicyConfig | null;
};

export type NativeAgentToolLoopCycleResult = {
  loop: AgentLoopResult;
  dispatch: DispatchAgentLoopResponseResult;
  humanOwnerActive: boolean;
  aiBlocked: boolean;
};

function buildCommercialContextSummary(
  snapshot: CommercialContextSnapshot,
  currentTurn: { inboundMessageId: string; customerMessage: string },
  customerProfileContext: CustomerCommercialHistoryContext | null,
  /** CP-R1-T12D. Already relevance-filtered and capped - null whenever the policy is disabled (default) or no signal cleared relevance this turn, so the key is simply absent, same discipline as customerPurchaseHistory above. */
  customerHistoryCommercialSignalsSummary: Record<string, unknown> | null
): Record<string, unknown> {
  const recentMessages = snapshot.recentMessages.filter((message, index, messages) => {
    if (message.id === currentTurn.inboundMessageId) return false;
    const isLastMessage = index === messages.length - 1;
    if (isLastMessage && message.direction === "inbound" && message.body === currentTurn.customerMessage) return false;
    return true;
  });

  const summary: Record<string, unknown> = {
    opportunityStatus: snapshot.opportunity?.status ?? null,
    opportunityStage: snapshot.opportunity?.stage ?? null,
    needProfile: snapshot.needProfile
      ? {
          useCase: snapshot.needProfile.useCase,
          budgetMax: snapshot.needProfile.budgetMax,
          requiredFeatures: snapshot.needProfile.requiredFeatures
        }
      : null,
    // CRM-R1-T13D. Durable, rehydrated state - never derived from recentMessages.
    shippingDestination: snapshot.shippingDestination
      ? { communeId: snapshot.shippingDestination.communeId, canonicalName: snapshot.shippingDestination.canonicalName }
      : null,
    // CRM-R1-T13E.2. Same discipline as shippingDestination above.
    commercialLineItems: snapshot.commercialLineItems ? { items: snapshot.commercialLineItems.items } : null,
    recentMessages: recentMessages.slice(-5).map((message) => ({ direction: message.direction, body: message.body }))
  };

  if (customerProfileContext) {
    summary.customerPurchaseHistory = buildCustomerPurchaseHistorySummary(customerProfileContext);
    const customerRfm = buildCustomerRfmSummary(customerProfileContext.customerRfm);
    if (customerRfm) {
      summary.customerRfm = customerRfm;
    }
  }

  if (customerHistoryCommercialSignalsSummary) {
    summary.customerHistoryCommercialSignals = customerHistoryCommercialSignalsSummary;
  }

  return summary;
}

/**
 * ACS-R1-05.1-T02.1 (post-smoke fix, point 8). Bounded structural summary
 * only - never raw arguments or observation data. Exported (CP-R1-T10B8C
 * minor fix) so a DB-free test can verify the real
 * `agent_tool_loop_completed` step-summary/normalization path accepts a
 * `recommend_catalog_products` "skipped" observation without a real
 * MariaDB - never a second, reimplemented copy of this mapping.
 */
export function buildStepsSummary(loop: AgentLoopResult): AgentToolLoopStepSummary[] {
  return loop.steps.map((record) => ({
    stepIndex: record.stepIndex,
    type: record.step.type,
    phase: record.phase,
    tool: record.step.type === "use_tool" ? record.step.tool : undefined,
    governance: record.governance ?? undefined,
    observationStatus: record.observation?.status ?? undefined
  }));
}

/**
 * LLM-R1-T02. Bounded structural summary of every real LLM provider
 * invocation this turn - never raw prompt/rawOutput. `inputSize`/`outputSize`
 * (never `...Tokens...`) mirror the rename AgentToolLoopLlmCallSummary's own
 * comment documents (events/types.ts) - the shared commercial_event
 * sanitizer rejects any payload key matching /token/i.
 */
export function buildLlmCallsSummary(loop: AgentLoopResult): AgentToolLoopLlmCallSummary[] {
  return loop.llmCalls.map((call) => ({
    phase: call.phase,
    attempt: call.attempt,
    decisionIndex: call.decisionIndex,
    elapsedMs: call.elapsedMs,
    model: call.model,
    providerRequestId: call.providerRequestId,
    finishReason: call.finishReason,
    inputSize: call.inputTokens,
    outputSize: call.outputTokens,
    outcome: call.outcome
  }));
}

/**
 * LLM-R1-T02. Turn-level rollup - `null` for accumulated sizes means no call
 * this turn reported a usable value, never an invented `0`; `usageComplete`
 * is `false` whenever at least one call is missing a known inputSize or
 * outputSize, even when the (partial) sum is non-null. `null` overall when
 * the loop never reached the provider at all this turn (e.g. no provider
 * configured) - never a degenerate zeroed-out metrics object for a turn that
 * made no LLM calls.
 */
export function buildLlmMetrics(loop: AgentLoopResult): AgentToolLoopLlmMetricsPayload | null {
  if (loop.llmCalls.length === 0) return null;

  let totalElapsedMs = 0;
  let knownInputSum = 0;
  let knownOutputSum = 0;
  let hasKnownInput = false;
  let hasKnownOutput = false;
  let usageComplete = true;

  for (const call of loop.llmCalls) {
    totalElapsedMs += call.elapsedMs;
    if (call.inputTokens === null) {
      usageComplete = false;
    } else {
      knownInputSum += call.inputTokens;
      hasKnownInput = true;
    }
    if (call.outputTokens === null) {
      usageComplete = false;
    } else {
      knownOutputSum += call.outputTokens;
      hasKnownOutput = true;
    }
  }

  return {
    callCount: loop.llmCalls.length,
    totalElapsedMs,
    inputSize: hasKnownInput ? knownInputSum : null,
    outputSize: hasKnownOutput ? knownOutputSum : null,
    usageComplete,
    calls: buildLlmCallsSummary(loop)
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

// SALES-AGENT-R2-ID-R2-A10. The only identity input Customer Profile
// consumption reads from the trusted session - RuntimeIdentityContext
// (ID-R2-A05), never `identity.customerId`/`masterCustomerIdentity`
// (both master_customer.id space). loadCommercialCustomerContext gates on
// this itself (reusing A06's evaluateCommercialIdentityRequirement); this
// accessor exists only so a null trustedCustomerSession degrades to "no
// identity" the same way every other field on this session already does.
function trustedRuntimeIdentity(session: NativeCustomerSessionExecutionContext | null | undefined): RuntimeIdentityContext | null {
  return session?.runtimeIdentity ?? null;
}

function buildCustomerProfileComparisonCandidates(input: {
  recentCatalogContext?: RecentCatalogContext | null;
  pendingCatalogAction?: PendingCatalogActionStep | null;
}) {
  const candidates = new Map<string, { productId: number; productAttributeId: number | null; name: string | null }>();

  for (const interaction of input.recentCatalogContext?.interactions ?? []) {
    for (const product of interaction.products) {
      const productId = Number.parseInt(product.productId, 10);
      if (!Number.isSafeInteger(productId) || productId <= 0) continue;
      const productAttributeId =
        typeof product.combinationId === "string" && product.combinationId.trim().length > 0
          ? Number.parseInt(product.combinationId, 10)
          : null;
      const key = `${productId}:${productAttributeId ?? "none"}`;
      if (!candidates.has(key)) {
        candidates.set(key, {
          productId,
          productAttributeId: typeof productAttributeId === "number" && Number.isSafeInteger(productAttributeId) && productAttributeId >= 0 ? productAttributeId : null,
          name: product.name
        });
      }
    }
  }

  for (const productIdRaw of input.pendingCatalogAction?.candidateProductIds ?? []) {
    const productId = Number.parseInt(productIdRaw, 10);
    if (!Number.isSafeInteger(productId) || productId <= 0) continue;
    const key = `${productId}:none`;
    if (!candidates.has(key)) {
      candidates.set(key, { productId, productAttributeId: null, name: null });
    }
  }

  return [...candidates.values()];
}

async function defaultLoadCustomerProfileContext(input: {
  runtimeIdentity: RuntimeIdentityContext | null;
  customerMessage: string;
  snapshot: CommercialContextSnapshot;
  recentCatalogContext?: RecentCatalogContext | null;
  pendingCatalogAction?: PendingCatalogActionStep | null;
  requestId?: string;
}): Promise<CustomerCommercialHistoryContext | null> {
  const historyNeeds = deriveCustomerHistoryNeeds({
    snapshot: input.snapshot,
    customerMessage: input.customerMessage,
    recentCatalogContext: input.recentCatalogContext ?? null,
    pendingCatalogAction: input.pendingCatalogAction ?? null
  });

  const result = await loadCommercialCustomerContext({
    runtimeIdentity: input.runtimeIdentity,
    historyNeeds,
    requestId: input.requestId
  });

  console.info({
    event: "commercial_customer_context_gate_evaluated",
    status: result.status,
    prestashopCustomerIdPresent: result.status !== "IDENTITY_INSUFFICIENT" && result.prestashopCustomerId !== null,
    requestId: input.requestId
  });

  if (result.status !== "AVAILABLE") {
    // IDENTITY_INSUFFICIENT / PROFILE_NOT_FOUND / SYSTEM_UNAVAILABLE all mean
    // "no commercial enrichment this turn" - never a fallback id, never a
    // retry with a different identity space, never a customer-facing error.
    return null;
  }

  const context = result.commercialHistory;

  const comparisonCandidates = buildCustomerProfileComparisonCandidates({
    recentCatalogContext: input.recentCatalogContext ?? null,
    pendingCatalogAction: input.pendingCatalogAction ?? null
  });

  const recommendationHistoryMatches = buildCatalogHistoryComparisons({
    purchasedProducts: context.status === "AVAILABLE" || context.status === "PARTIAL" ? context.purchasedProducts : null,
    candidates: comparisonCandidates
  });

  return {
    ...context,
    recommendationHistoryMatches
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
    warnings: [reason],
    finalPendingCatalogAction: null,
    llmCalls: []
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
    warnings: [input.technicalReason],
    finalPendingCatalogAction: null,
    llmCalls: []
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
  const loadCustomerProfileContext = input.loadCustomerProfileContext ?? defaultLoadCustomerProfileContext;
  const customerProfileStartedAt = Date.now();
  let customerProfileContext: CustomerCommercialHistoryContext | null = null;

  try {
    customerProfileContext = await loadCustomerProfileContext({
      runtimeIdentity: trustedRuntimeIdentity(input.trustedCustomerSession),
      customerMessage: input.customerMessage,
      snapshot: input.snapshot,
      recentCatalogContext: input.recentCatalogContext ?? null,
      pendingCatalogAction: input.pendingCatalogAction ?? null,
      requestId: input.correlationId
    });
  } catch {
    customerProfileContext = {
      status: "UNAVAILABLE",
      customerId: null,
      summary: null,
      recentOrders: [],
      purchasedProducts: [],
      purchaseBehavior: null,
      customerRfm: null,
      provenance: null,
      recommendationHistoryMatches: [],
      constraints: {
        rfmAvailable: false,
        monetarySegmentAvailable: false,
        mayAlterCatalogRanking: false,
        mayAutoExcludePurchasedProducts: false
      },
      observations: [{ capability: "context", status: "UNAVAILABLE", reasonCode: "CUSTOMER_PROFILE_UNAVAILABLE" }]
    };
  }

  if (customerProfileContext) {
    const loadedCapabilities = customerProfileContext.observations
      .filter((observation) => observation.capability !== "context" && observation.status === "AVAILABLE")
      .map((observation) => observation.capability);
    const failedCapabilities = customerProfileContext.observations
      .filter((observation) => observation.capability !== "context" && observation.status !== "AVAILABLE")
      .map((observation) => observation.capability);
    console.info({
      event: "customer_profile_context_loaded",
      customerProfileContextStatus: customerProfileContext.status,
      customerId: customerProfileContext.customerId,
      requestedCapabilities: [...new Set(customerProfileContext.observations.filter((observation) => observation.capability !== "context").map((observation) => observation.capability))],
      loadedCapabilities,
      failedCapabilities,
      reasonCodes: customerProfileContext.observations.map((observation) => observation.reasonCode),
      durationMs: Date.now() - customerProfileStartedAt,
      contractVersion: customerProfileContext.provenance?.contractVersion ?? null,
      rfmLookupStatus: customerProfileContext.customerRfm?.status ?? null,
      rfmContractVersion: customerProfileContext.customerRfm?.status === "AVAILABLE" ? customerProfileContext.customerRfm.contractVersion : null,
      rfmSegmentVersion:
        customerProfileContext.customerRfm?.status === "AVAILABLE" ? customerProfileContext.customerRfm.segment.version : null,
      historyItemCount: customerProfileContext.purchasedProducts.length,
      recommendationMatchCount: customerProfileContext.recommendationHistoryMatches.length,
      requestId: input.correlationId
    });
  }

  /**
   * CP-R1-T12D. Independent flag from T12C's `contextEnabled` above - when
   * this stays at its default `false`, `customerHistoryCommercialSignalsSummary`
   * is never computed and `buildCommercialContextSummary` receives `null`,
   * so the prompt payload is byte-for-byte what T12C already produced.
   */
  const commercialPolicyConfig = input.customerHistoryCommercialPolicyConfig ?? readCustomerHistoryCommercialPolicyConfig();
  let customerHistoryCommercialSignalsSummary: Record<string, unknown> | null = null;

  if (commercialPolicyConfig.enabled && customerProfileContext) {
    const commercialSignalsStartedAt = Date.now();
    const derivedSignals: CustomerHistoryCommercialSignal[] = deriveCustomerHistoryCommercialSignals({
      context: customerProfileContext,
      referenceTime: input.currentTime,
      recentPurchaseWindowDays: commercialPolicyConfig.recentPurchaseWindowDays
    });
    const exposedSignals = filterRelevantCustomerHistorySignals(derivedSignals, commercialPolicyConfig.maxSignals);
    const guidance = buildCustomerHistoryCommercialGuidance(exposedSignals);
    if (exposedSignals.length > 0) {
      customerHistoryCommercialSignalsSummary = buildCustomerHistoryCommercialSignalsSummary({ signals: exposedSignals, guidance });
    }

    // Never product names, spend figures, personal data, or customerId/productId as labels - only enum-like signal types, counts, and reason codes.
    console.info({
      event: "customer_history_commercial_policy_evaluated",
      customerHistoryPolicyEnabled: true,
      historyStatus: customerProfileContext.status,
      derivedSignalTypes: [...new Set(derivedSignals.map((signal) => signal.type))],
      exposedSignalTypes: exposedSignals.map((signal) => signal.type),
      suppressedSignalCount: derivedSignals.length - exposedSignals.length,
      sameProductMatchCount: exposedSignals.filter((signal) => signal.type === "PRODUCT_PREVIOUSLY_PURCHASED").length,
      sameVariantMatchCount: exposedSignals.filter((signal) => signal.type === "VARIANT_PREVIOUSLY_PURCHASED").length,
      possibleReorderCount: exposedSignals.filter((signal) => signal.type === "POSSIBLE_REORDER").length,
      possibleComplementCount: exposedSignals.filter((signal) => signal.type === "POSSIBLE_COMPLEMENT").length,
      historyMentionRecommended: customerHistoryCommercialSignalsSummary !== null,
      reasonCodes: guidance.reasonCodes,
      durationMs: Date.now() - commercialSignalsStartedAt,
      requestId: input.correlationId
    });
  }

  const agentToolLoopInput: RunAgentToolLoopInput = {
    correlationId: input.correlationId,
    conversationId: input.conversationId,
    opportunityId,
    currentTime: input.currentTime,
    customerMessage: input.customerMessage,
    commercialContextSummary: buildCommercialContextSummary(input.snapshot, {
      inboundMessageId: input.inboundMessageId,
      customerMessage: input.customerMessage
    }, customerProfileContext, customerHistoryCommercialSignalsSummary),
    recentCatalogContext: input.recentCatalogContext ?? null,
    pendingCatalogAction: input.pendingCatalogAction ?? null,
    provider: input.provider,
    trustedCustomerSession: input.trustedCustomerSession,
    abortSignal: input.abortSignal,
    identityConfiguration,
    maxDecisions: effectiveLoopConfiguration.maxAgentStepsPerTurn,
    maxToolExecutions: effectiveLoopConfiguration.maxToolCallsPerTurn,
    timeoutMs: effectiveModelConfiguration.timeoutMs
  };
  // LLM-R1-T09A/T09B. Default false, and even when the flag is on, only this
  // exact waId being one of BRAIN_AUTONOMOUS_TEST_WA_IDS routes here - every
  // other waId (and any ambiguous/empty allowlist configuration) stays on the
  // legacy path, byte/semantically identical to before T09A. Both loops share
  // the exact same input/output contract - only which one runs changes.
  const loop = shouldRouteToMultiIntentPlanner(input.waId)
    ? await runCommercialMultiIntentLoop(agentToolLoopInput)
    : await runAgentToolLoop(agentToolLoopInput);

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

  const persistedPendingCatalogAction = dispatch.outboxWritten === true ? loop.finalPendingCatalogAction : undefined;
  if (loop.finalPendingCatalogAction && !dispatch.outboxWritten) {
    loop.warnings.push(
      `pending_catalog_action_dropped_no_outbox:${loop.finalPendingCatalogAction.actionType}:candidateCountBefore=${loop.finalPendingCatalogAction.candidateProductIds.length}:candidateCountAfter=0:correlationId=${input.correlationId}`
    );
  }

  const stepsSummary = buildStepsSummary(loop);

  try {
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
      stepsSummary,
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
      effectiveMaxOutputSize: effectiveModelConfiguration.maxOutputTokens ?? null,
      effectiveTimeoutMs: effectiveModelConfiguration.timeoutMs,
      effectiveMaxAgentStepsPerTurn: effectiveLoopConfiguration.maxAgentStepsPerTurn,
      effectiveMaxToolCallsPerTurn: effectiveLoopConfiguration.maxToolCallsPerTurn,
      // LLM provider error observability. Structurally identical to
      // AgentToolLoopProviderFailurePayload (events/types.ts) by construction -
      // never imported directly, same no-cross-module-import rationale the
      // events/ leaf module already documents for every other payload shape.
      providerFailure: loop.providerFailure ?? undefined,
      pendingCatalogAction: persistedPendingCatalogAction ?? undefined,
      // LLM-R1-T02. Per-call and turn-level LLM observability - never a raw
      // prompt/rawOutput, only counts/ids/enums (see buildLlmMetrics).
      llmMetrics: buildLlmMetrics(loop) ?? undefined
    });
  } catch (error) {
    // ACS-R1-05.1-T02.3B (correction). Never blocks the turn - the customer
    // already has their dispatched response - but a failure to record this
    // audit event must stay observable, not vanish into a swallowed catch.
    // loop.warnings is the same internal-only channel every other
    // technical, non-customer-facing signal in this cycle already surfaces
    // through (see runNativeAgentToolLoopCycleConfigurationFailure above).
    const message = error instanceof Error ? error.message : "unknown";
    loop.warnings.push(`agent_tool_loop_completed_event_write_failed:${message}`);
  }

  // SALES-AGENT-R3-A01. Shadow/additive only - runs strictly after the real
  // turn (model decisions, capability execution, dispatch) already
  // completed. Never influences loop/dispatch above; a failure here is
  // degradable (never fatal to the turn), surfaced the same way every other
  // technical, non-customer-facing signal in this cycle already is - see
  // docs/releases/SALES-AGENT-R3-A01-agent-session-store.md "Shadow
  // integration".
  try {
    const shadowResult = await recordAgentToolLoopSessionShadowEvents({
      conversationId: input.conversationId,
      inboundMessageId: input.inboundMessageId,
      correlationId: input.correlationId,
      terminalReason: loop.terminalReason,
      finalMessagePresent: loop.finalMessage !== null,
      handoffReasonPresent: loop.handoffReason !== null,
      stepsSummary
    });
    if (!shadowResult.ok) {
      loop.warnings.push(`agent_session_shadow_event_write_failed:${shadowResult.warning}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    loop.warnings.push(`agent_session_shadow_event_write_failed:${message}`);
  }

  return { loop, dispatch, humanOwnerActive, aiBlocked };
}
