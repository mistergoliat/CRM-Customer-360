import { createHttpAgentLoopProvider } from "../agent-loop/providers/httpAgentLoopProvider";
import type { AgentLoopProvider } from "../agent-loop/agentLoopProviderTypes";
import { loadRecentCatalogContext } from "../agent-loop/recentCatalogContext";
import type { RecentCatalogContextLoadResult } from "../agent-loop/recentCatalogContext";
import type { CommercialContextSnapshot } from "../context/buildNativeCommercialContext";
import type { ResolvedSalesAgentConfiguration } from "../sales-agent-configuration";
import { recordCommercialWorkInboundCycleCompletedEvent } from "../events/service";
import { getActiveSelectedShippingOptionForOpportunity } from "@/lib/domains/selected-shipping-option";
import { getActiveCreatedQuoteForOpportunity } from "@/lib/domains/created-quote";
import { assignCommercialTriggerSequence } from "./sequencing";
import { reconcileCommercialTrigger } from "./reconciliation";
import { executeCommercialWork } from "./commercialWorkExecutor";
import { buildCommercialWorkParallelExecutionFeatureFlags } from "../config/commercialCycleConfig";
import { settleCommercialWorkProjection } from "./settleCommercialWorkProjection";
import { loadRecentCommercialCapabilityExecutions } from "./capabilityExecutionReader";
import { planCommercialObjectiveSeeds } from "./semanticIntentAdapter";
import { dispatchCommercialWorkResponse, type DispatchCommercialWorkResponseResult } from "./dispatchCommercialWorkResponse";
import { scheduleObjectiveAwareFollowUp } from "./followup";
import type { PersistedCommercialWork } from "./persistenceTypes";
import { COMMERCIAL_OBJECTIVE_TYPE_TO_OPERATION } from "./commercialIdentityGate";
import type { CommercialObjective } from "./types";
import type { NativeCustomerSessionExecutionContext } from "../native-cycle/customer-session/types";
import { resolveRuntimeIdentityContext, type RuntimeIdentityContext } from "../native-cycle/customer-session/runtimeIdentityContext";
import { runCustomerOnboardingPostPlanStage } from "../native-cycle/customer-session/runCustomerOnboardingPostPlanStage";
import type { OnboardingCollectionSnapshot } from "./identityCollectionRequest";
import type { CustomerOnboardingState } from "@/lib/domains/customer-onboarding";

/**
 * SALES-AGENT-R2-ID-R2-A08, PARTE 2/20. The only reduction of
 * CustomerOnboardingState this cycle ever hands to the finalizer - status/
 * purpose/pendingFields only, never `collected` (raw email/name/order
 * values). Same privacy discipline as resolveNativeCustomerSession.ts's own
 * CustomerSessionOnboardingDecisionView projection, kept as a separate,
 * smaller type here since this one feeds internal message-building, not the
 * planner/LLM context.
 */
function toIdentityOnboardingSnapshot(onboarding: CustomerOnboardingState | null): OnboardingCollectionSnapshot | null {
  if (!onboarding) return null;
  return { status: onboarding.status, purpose: onboarding.purpose, pendingFields: [...onboarding.pendingFields] };
}

export type RunCommercialWorkInboundCycleInput = {
  conversationId: number;
  waId: string;
  inboundMessageId: string;
  correlationId: string;
  currentTime: string;
  customerMessage: string;
  snapshot: CommercialContextSnapshot;
  /** Test-only injection point; production callers never set this (defaults to the real HTTP DeepSeek provider). */
  provider?: AgentLoopProvider | null;
  resolvedSalesAgentConfiguration: ResolvedSalesAgentConfiguration;
  abortSignal?: AbortSignal | null;
  /**
   * SALES-AGENT-R2-ID-R2-A07. The same server-side trusted session
   * runNativeAutonomousCycle.ts already built once this turn
   * (resolveNativeCustomerSession, Step 3) - never re-resolved here. Only
   * used to activate/advance the EXISTING onboarding subsystem (via
   * runCustomerOnboardingPostPlanStage, unchanged) when this turn's
   * projection finds a step blocked on identity. Optional: an existing
   * caller/test that omits it keeps its exact current behavior (identity
   * gating still applies via snapshot.customerSession.runtimeIdentity, but
   * onboarding is never activated without a trusted session to act through).
   */
  customerSessionExecution?: NativeCustomerSessionExecutionContext | null;
};

export type CommercialWorkInboundCycleResult = {
  ran: boolean;
  reason: string;
  work: PersistedCommercialWork | null;
  dispatch: DispatchCommercialWorkResponseResult | null;
  humanOwnerActive: boolean;
  aiBlocked: boolean;
  warnings: string[];
};

function skipped(reason: string, humanOwnerActive: boolean, aiBlocked: boolean): CommercialWorkInboundCycleResult {
  return { ran: false, reason, work: null, dispatch: null, humanOwnerActive, aiBlocked, warnings: [reason] };
}

function parseSourceMessageId(inboundMessageId: string): number | null {
  return /^\d+$/.test(inboundMessageId) ? Number(inboundMessageId) : null;
}

/**
 * SALES-AGENT-R2-ID-R2-A07 (PARTE 8/11/15). Finds at most one objective this
 * turn's projection left blocked on identity in a way CommercialWork should
 * actively advance (ONBOARDING_REQUIRED: activate/advance the existing
 * onboarding subsystem; READY_TO_LINK: attempt the existing link authority,
 * a safe no-op without this-turn consent). AMBIGUITY_RESOLUTION_REQUIRED/
 * IDENTITY_CONFLICT/ENTITY_VERIFICATION_REQUIRED/SYSTEM_WAIT are deliberately
 * excluded - none of them is something runCustomerOnboardingPostPlanStage's
 * field-capture/create/link paths can advance (PARTE 17: never auto-resolve
 * a conflict; PARTE 18: ambiguity needs a differentiated answer, not a bare
 * field capture; entity verification has no consumer yet). Bounded to the
 * FIRST match only - at most one onboarding-stage call per turn.
 */
export function findIdentityOnboardingTrigger(objectives: readonly CommercialObjective[]): { objective: CommercialObjective; operation: string } | null {
  for (const objective of objectives) {
    const identityBlocker = objective.blockers.find((item) => item.code === "IDENTITY_REQUIREMENT");
    const decision = identityBlocker?.identityDecision;
    if (!decision || (decision.status !== "ONBOARDING_REQUIRED" && decision.status !== "READY_TO_LINK")) continue;
    const operation = COMMERCIAL_OBJECTIVE_TYPE_TO_OPERATION[objective.type];
    if (!operation) continue;
    return { objective, operation };
  }
  return null;
}

async function safeRecordCompletedEvent(input: {
  inboundMessageId: string;
  correlationId: string;
  conversationId: number;
  opportunityId: number;
  reason: string;
  commercialSequence: number | null;
  work: PersistedCommercialWork | null;
  disposition: DispatchCommercialWorkResponseResult["disposition"] | null;
  llmCallCount: number;
  executedStepCount: number | null;
  outboxWritten: boolean;
  warnings: string[];
}): Promise<void> {
  try {
    await recordCommercialWorkInboundCycleCompletedEvent({
      inboundMessageId: input.inboundMessageId,
      correlationId: input.correlationId,
      conversationId: input.conversationId,
      opportunityId: input.opportunityId,
      reason: input.reason,
      commercialSequence: input.commercialSequence,
      workPublicId: input.work?.publicId ?? null,
      workVersion: input.work?.version ?? null,
      workStatus: input.work?.status ?? null,
      disposition: input.disposition,
      objectiveCount: input.work?.metrics.objectiveCount ?? null,
      readyStepCount: input.work?.metrics.readyStepCount ?? null,
      llmCallCount: input.llmCallCount,
      executedStepCount: input.executedStepCount,
      outboxWritten: input.outboxWritten
    });
  } catch (error) {
    input.warnings.push(`commercial_work_completed_event_write_failed:${error instanceof Error ? error.message : "unknown"}`);
  }
}

/**
 * SALES-AGENT-R2-A08.5. Production entry point for the allowlisted
 * CommercialWork (R2) inbound path: one real semantic-planning LLM call ->
 * durable CommercialWork (create/reconcile) -> real Capability Gateway
 * execution -> grounded FINAL/PARTIAL/BLOCKED customer reply. Only reached
 * from runNativeAutonomousCycle.ts when shouldRouteToCommercialWork(waId) is
 * true (commercialCycleConfig.ts) - never invoked for non-allowlisted
 * traffic, and never falls through to the legacy/Agent Tool Loop pipelines
 * for the same turn (that branch selection happens one level up, before this
 * function is called, and every failure path here resolves to a controlled
 * dispatch of its own rather than propagating out of the if/else chain).
 *
 * Reuses, unchanged: the real semantic planner (planCommercialObjectiveSeeds),
 * the real sequencing/reconciliation primitives (A08), the real multi-step
 * executor and its Capability Gateway default (A05), and the real DeepSeek
 * provider config resolution (resolveSalesAgentConfiguration, same as the
 * Agent Tool Loop). Builds no second executor, no second planner.
 */
export async function runCommercialWorkInboundCycle(input: RunCommercialWorkInboundCycleInput): Promise<CommercialWorkInboundCycleResult> {
  const humanOwnerActive = input.snapshot.signals.humanOwnerActive;
  const aiBlocked = input.snapshot.signals.aiBlocked;

  // Part 21: checked before anything else - zero LLM call, zero mutation,
  // same placement/discipline as runNativeAgentToolLoopCycle's own gate.
  if (humanOwnerActive || aiBlocked) {
    return skipped("commercial_work_skipped_human_owner_or_ai_blocked", humanOwnerActive, aiBlocked);
  }

  const opportunityId = typeof input.snapshot.opportunity?.id === "number" ? input.snapshot.opportunity.id : null;
  const conversationCaseId = input.snapshot.opportunity?.conversationCaseId ?? input.conversationId;
  const caseStatus = input.snapshot.opportunity?.status ?? input.snapshot.conversation?.status ?? null;
  const warnings: string[] = [];

  // Pre-existing gap shared by the whole Agent Tool Loop family (documented
  // in LLM-R1-T09B): nothing on this path creates a crm_opportunities row.
  // R2 inherits the same limitation rather than solving it here.
  if (opportunityId === null) {
    const dispatch = await dispatchCommercialWorkResponse({
      conversationId: input.conversationId,
      conversationCaseId,
      opportunityId: null,
      waId: input.waId,
      inboundMessageId: input.inboundMessageId,
      currentTime: input.currentTime,
      humanOwnerActive,
      aiBlocked,
      caseStatus,
      work: null,
      forcedFallback: "handoff_acknowledgement"
    });
    return {
      ran: true,
      reason: "commercial_work_no_opportunity",
      work: null,
      dispatch,
      humanOwnerActive,
      aiBlocked,
      warnings: [...warnings, "commercial_work_no_opportunity", ...dispatch.warnings]
    };
  }

  try {
    const provider =
      input.provider ??
      createHttpAgentLoopProvider({
        model: input.resolvedSalesAgentConfiguration.effectiveModelConfiguration.model,
        temperature: input.resolvedSalesAgentConfiguration.effectiveModelConfiguration.temperature,
        maxOutputTokens: input.resolvedSalesAgentConfiguration.effectiveModelConfiguration.maxOutputTokens,
        maxModelRetries: input.resolvedSalesAgentConfiguration.effectiveModelConfiguration.maxModelRetries
      });

    const sequenceResult = await assignCommercialTriggerSequence({
      conversationId: input.conversationId,
      triggerType: "CUSTOMER_MESSAGE",
      triggerDedupeKey: `commercial-work:${input.conversationId}:${input.inboundMessageId}`,
      sourceMessageId: parseSourceMessageId(input.inboundMessageId)
    });
    const commercialSequence = sequenceResult.status !== "failed" ? sequenceResult.record.commercialSequence : null;
    if (sequenceResult.status === "failed") warnings.push(`commercial_work_sequence_failed:${sequenceResult.error}`);

    const [selectedShippingOption, createdQuote, recentCapabilityExecutions] = await Promise.all([
      getActiveSelectedShippingOptionForOpportunity(opportunityId),
      getActiveCreatedQuoteForOpportunity(opportunityId),
      loadRecentCommercialCapabilityExecutions({ opportunityId })
    ]);

    // Same evidence source the legacy/multi-intent loops already use for
    // SELECT_PRODUCTS resolution (requirementResolver.ts requires PRODUCT
    // evidence via RecentCatalogContext or durable state) - without this, no
    // R2 selection could ever resolve from a short product name.
    let recentCatalogContextResult: RecentCatalogContextLoadResult;
    try {
      recentCatalogContextResult = await loadRecentCatalogContext({ conversationId: input.conversationId, currentTime: input.currentTime });
    } catch (error) {
      recentCatalogContextResult = { context: { interactions: [] }, warnings: [`commercial_work_recent_catalog_context_unexpected_failure:${error instanceof Error ? error.message : "unknown"}`] };
    }
    warnings.push(...recentCatalogContextResult.warnings);

    const commercialContextSummary: Record<string, unknown> = {
      ...(input.snapshot.commercialLineItems ? { commercialLineItems: { items: input.snapshot.commercialLineItems.items } } : {}),
      ...(input.snapshot.shippingDestination
        ? { shippingDestination: { communeId: input.snapshot.shippingDestination.communeId, canonicalName: input.snapshot.shippingDestination.canonicalName } }
        : {}),
      // SALES-AGENT-R2-A08.6, Part 5. Same bounded direction/body shape
      // runNativeAgentToolLoopCycle.ts's own buildCommercialContextSummary
      // already exposes - the only signal readLastAgentMessage may use to
      // interpret a bare confirmation ("si") as create_quote.
      recentMessages: input.snapshot.recentMessages.slice(-5).map((message) => ({ direction: message.direction, body: message.body }))
    };

    const timeoutMs = input.resolvedSalesAgentConfiguration.effectiveModelConfiguration.timeoutMs ?? 20_000;
    const planned = await planCommercialObjectiveSeeds({
      opportunityId,
      correlationId: input.correlationId,
      customerMessage: input.customerMessage,
      commercialContextSummary,
      recentCatalogContext: recentCatalogContextResult.context,
      provider,
      deadline: Date.now() + timeoutMs,
      currentTime: input.currentTime,
      abortSignal: input.abortSignal ?? null
    });
    warnings.push(...planned.warnings);
    const llmCallCount = planned.llmCalls.length;

    if (planned.kind !== "planned") {
      // Part 25 (provider failure before planning): zero CommercialWork
      // mutation, controlled fallback dispatch only.
      const dispatch = await dispatchCommercialWorkResponse({
        conversationId: input.conversationId,
        conversationCaseId,
        opportunityId,
        waId: input.waId,
        inboundMessageId: input.inboundMessageId,
        currentTime: input.currentTime,
        humanOwnerActive,
        aiBlocked,
        caseStatus,
        work: null,
        forcedFallback: "model_unavailable"
      });
      const reason = `commercial_work_planner_${planned.kind}`;
      await safeRecordCompletedEvent({
        inboundMessageId: input.inboundMessageId,
        correlationId: input.correlationId,
        conversationId: input.conversationId,
        opportunityId,
        reason,
        commercialSequence,
        work: null,
        disposition: dispatch.disposition,
        llmCallCount,
        executedStepCount: null,
        outboxWritten: dispatch.outboxWritten,
        warnings
      });
      return { ran: true, reason, work: null, dispatch, humanOwnerActive, aiBlocked, warnings: [...warnings, ...dispatch.warnings] };
    }

    // SALES-AGENT-R2-ID-R2-A07. This turn's identity fact (A05) - already
    // passively carried on snapshot.customerSession since A05, never read by
    // this pipeline before A07. May be reassigned below (PARTE 15) if the
    // onboarding post-plan stage advances identity within this same turn.
    let runtimeIdentity: RuntimeIdentityContext | undefined = input.snapshot.customerSession?.runtimeIdentity;

    const reconciled = await reconcileCommercialTrigger({
      trigger: {
        type: "CUSTOMER_MESSAGE",
        conversationId: input.conversationId,
        opportunityId,
        sourceMessageId: parseSourceMessageId(input.inboundMessageId),
        commercialSequence
      },
      conversation: { id: input.conversationId, humanOwnerActive, aiEnabled: !aiBlocked, status: input.snapshot.conversation?.status ?? null },
      opportunity: { id: opportunityId, status: input.snapshot.opportunity?.status ?? null },
      commercialLineItems: input.snapshot.commercialLineItems,
      shippingDestination: input.snapshot.shippingDestination,
      selectedShippingOption,
      createdQuote,
      recentCapabilityExecutions,
      now: input.currentTime,
      semanticObjectives: planned.seeds,
      runtimeIdentity
    });

    // Part 22: a genuinely out-of-order trigger is reconciled with zero
    // mutation on top of a newer state - no dispatch, nothing to overwrite.
    if (reconciled.status === "stale_ignored") {
      await safeRecordCompletedEvent({
        inboundMessageId: input.inboundMessageId,
        correlationId: input.correlationId,
        conversationId: input.conversationId,
        opportunityId,
        reason: "commercial_work_stale_turn_ignored",
        commercialSequence,
        work: reconciled.work,
        disposition: null,
        llmCallCount,
        executedStepCount: null,
        outboxWritten: false,
        warnings
      });
      return { ran: true, reason: "commercial_work_stale_turn_ignored", work: reconciled.work, dispatch: null, humanOwnerActive, aiBlocked, warnings };
    }

    const parallelExecutionFlags = buildCommercialWorkParallelExecutionFeatureFlags();
    let work = reconciled.work;
    const executed = await executeCommercialWork({
      workPublicId: work.publicId,
      expectedVersion: work.version,
      context: { correlationId: input.correlationId, conversationId: input.conversationId, opportunityId },
      scheduleRetries: true,
      now: input.currentTime,
      parallelExecutionEnabled: parallelExecutionFlags.parallelExecutionEnabled,
      maxParallelSteps: parallelExecutionFlags.maxParallelSteps
    });
    if (executed.work) work = executed.work;

    work = await settleCommercialWorkProjection({
      work,
      conversationId: input.conversationId,
      opportunityId,
      correlationId: input.correlationId,
      now: new Date(input.currentTime),
      parallelExecutionEnabled: parallelExecutionFlags.parallelExecutionEnabled,
      maxParallelSteps: parallelExecutionFlags.maxParallelSteps,
      runtimeIdentity
    });

    // SALES-AGENT-R2-ID-R2-A07 (PARTE 8-15). CommercialWork's own "post-plan"
    // stage, placed exactly where the legacy runtime places it: after this
    // turn's plan/execution/settle already reached its final state for the
    // ORIGINAL runtimeIdentity - a block that only becomes visible partway
    // through settle's own cascade (e.g. a same-turn "select this AND quote
    // it" message, where the selection resolves in round 1 and CREATE_QUOTE
    // only becomes READY - and therefore identity-gated - in round 2) is
    // caught here exactly like a block that was already visible before settle
    // ever ran. Reuses the existing onboarding subsystem unchanged - never a
    // second onboarding state machine, never a reimplementation of
    // create_customer/link_external_identity authority. Bounded to at most
    // one onboarding-stage call and one extra settle pass per turn
    // (findIdentityOnboardingTrigger returns the first match only, and this
    // block never re-runs itself).
    const onboardingTrigger = findIdentityOnboardingTrigger(work.objectives);
    // SALES-AGENT-R2-ID-R2-A08, PARTE 2/3/21. This turn's freshest onboarding
    // state for the finalizer's wording (never for gating - the identity
    // gate above already ran against runtimeIdentity, unmodified). Defaults
    // to the pre-plan session's own onboarding snapshot (customer-session.
    // ts's resolveNativeCustomerSession, unchanged) so a turn where the
    // trigger did not fire this turn (e.g. still WAITING_CUSTOMER on a
    // different, non-identity gap) still asks about real pending fields
    // instead of falling back to the purpose default; overwritten below only
    // when the post-plan stage actually ran and returned a newer state.
    let identityOnboarding = toIdentityOnboardingSnapshot(input.customerSessionExecution?.onboarding ?? null);
    if (onboardingTrigger && input.customerSessionExecution) {
      const postPlan = await runCustomerOnboardingPostPlanStage({
        plannedOperation: { operation: onboardingTrigger.operation },
        messageText: input.customerMessage,
        correlationId: input.correlationId,
        customerSessionExecution: input.customerSessionExecution,
        opportunityId: String(opportunityId)
      });
      warnings.push(...postPlan.warnings);
      identityOnboarding = toIdentityOnboardingSnapshot(postPlan.onboarding);

      // PARTE 15 (same-turn unblock, bounded to one extra settle pass): only
      // when the stage actually attempted an identity-upgrading capability -
      // a mere activation or field capture never changes RuntimeIdentityContext
      // by itself, so re-checking would be a wasted read and an unnecessary
      // extra settle pass.
      if (postPlan.attemptedOperation === "create_customer" || postPlan.attemptedOperation === "link_external_identity") {
        try {
          const refreshedIdentity = await resolveRuntimeIdentityContext({
            conversationId: input.customerSessionExecution.conversationId,
            externalId: input.customerSessionExecution.trustedInbound.externalId,
            detail: undefined
          });
          runtimeIdentity = refreshedIdentity;
          work = await settleCommercialWorkProjection({
            work,
            conversationId: input.conversationId,
            opportunityId,
            correlationId: input.correlationId,
            now: new Date(input.currentTime),
            maxRounds: 1,
            parallelExecutionEnabled: parallelExecutionFlags.parallelExecutionEnabled,
            maxParallelSteps: parallelExecutionFlags.maxParallelSteps,
            runtimeIdentity: refreshedIdentity
          });
        } catch (error) {
          warnings.push(`commercial_work_identity_recheck_failed:${error instanceof Error ? error.message : "unknown"}`);
        }
      }
    }

    const dispatch = await dispatchCommercialWorkResponse({
      conversationId: input.conversationId,
      conversationCaseId,
      opportunityId,
      waId: input.waId,
      inboundMessageId: input.inboundMessageId,
      currentTime: input.currentTime,
      humanOwnerActive,
      aiBlocked,
      caseStatus,
      work,
      identityOnboarding
    });
    warnings.push(...dispatch.warnings);

    // Part 19: only when this turn actually left an objective waiting on the
    // customer - the existing (unmodified) A07 follow-up scheduler, reached
    // exclusively through this already-allowlisted path.
    if (work.status === "WAITING_CUSTOMER") {
      const waitingObjective = work.objectives.find((objective) => objective.status === "WAITING_CUSTOMER");
      if (waitingObjective) {
        const followUp = await scheduleObjectiveAwareFollowUp({
          workPublicId: work.publicId,
          objectivePublicId: waitingObjective.objectiveId,
          expectedWorkVersion: work.version,
          now: input.currentTime
        });
        if (followUp.status === "failed") warnings.push(`commercial_work_followup_schedule_failed:${followUp.reason}`);
      }
    }

    const reason = `commercial_work_${dispatch.disposition.toLowerCase()}`;
    await safeRecordCompletedEvent({
      inboundMessageId: input.inboundMessageId,
      correlationId: input.correlationId,
      conversationId: input.conversationId,
      opportunityId,
      reason,
      commercialSequence,
      work,
      disposition: dispatch.disposition,
      llmCallCount,
      executedStepCount: executed.executedStepCount,
      outboxWritten: dispatch.outboxWritten,
      warnings
    });

    return { ran: true, reason, work, dispatch, humanOwnerActive, aiBlocked, warnings };
  } catch (error) {
    // Part 12: an internal R2 failure never falls through to the legacy
    // pipeline (that would risk a second, independent mutating path for the
    // same inbound) - it resolves to its own controlled fallback here.
    const message = error instanceof Error ? error.message : "unknown";
    warnings.push(`commercial_work_inbound_cycle_unexpected_failure:${message}`);
    // Same discipline as native-whatsapp/service.ts's native_autonomous_cycle_failed:
    // this must stay observable, never a silently swallowed technical failure.
    console.error("commercial_work_inbound_cycle_unexpected_failure", error instanceof Error ? error.stack ?? error.message : String(error));
    let dispatch: DispatchCommercialWorkResponseResult | null = null;
    try {
      dispatch = await dispatchCommercialWorkResponse({
        conversationId: input.conversationId,
        conversationCaseId,
        opportunityId,
        waId: input.waId,
        inboundMessageId: input.inboundMessageId,
        currentTime: input.currentTime,
        humanOwnerActive,
        aiBlocked,
        caseStatus,
        work: null,
        forcedFallback: "handoff_acknowledgement"
      });
    } catch (dispatchError) {
      warnings.push(`commercial_work_fallback_dispatch_failed:${dispatchError instanceof Error ? dispatchError.message : "unknown"}`);
    }
    return {
      ran: true,
      reason: "commercial_work_internal_failure",
      work: null,
      dispatch,
      humanOwnerActive,
      aiBlocked,
      warnings: [...warnings, ...(dispatch?.warnings ?? [])]
    };
  }
}
