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
import { settleCommercialWorkProjection } from "./settleCommercialWorkProjection";
import { planCommercialObjectiveSeeds } from "./semanticIntentAdapter";
import { dispatchCommercialWorkResponse, type DispatchCommercialWorkResponseResult } from "./dispatchCommercialWorkResponse";
import { scheduleObjectiveAwareFollowUp } from "./followup";
import type { PersistedCommercialWork } from "./persistenceTypes";

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

    const [selectedShippingOption, createdQuote] = await Promise.all([
      getActiveSelectedShippingOptionForOpportunity(opportunityId),
      getActiveCreatedQuoteForOpportunity(opportunityId)
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
        : {})
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
      now: input.currentTime,
      semanticObjectives: planned.seeds
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

    let work = reconciled.work;
    const executed = await executeCommercialWork({
      workPublicId: work.publicId,
      expectedVersion: work.version,
      context: { correlationId: input.correlationId, conversationId: input.conversationId, opportunityId },
      scheduleRetries: true,
      now: input.currentTime
    });
    if (executed.work) work = executed.work;

    work = await settleCommercialWorkProjection({
      work,
      conversationId: input.conversationId,
      opportunityId,
      correlationId: input.correlationId,
      now: new Date(input.currentTime)
    });

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
      work
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
