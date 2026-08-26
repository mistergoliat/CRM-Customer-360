import type { ResolvedIntent } from "@/lib/brain/commercial/multi-intent/types";
import type { AgentLoopInferenceRecord } from "@/lib/brain/commercial/agent-loop/agentStepTypes";
import type { AgentLoopProvider } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";
import {
  buildFailureInferenceRecord,
  buildSuccessInferenceRecord,
  buildTimeoutInferenceRecord,
  captureProviderFailure,
  invokeProviderWithDeadline
} from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";
import type { RecentCatalogContext } from "@/lib/brain/commercial/agent-loop/recentCatalogContext";
import { buildIntentPlannerPromptPackage } from "@/lib/brain/commercial/multi-intent/buildIntentPlannerPromptPackage";
import { parseCommercialIntentPlan } from "@/lib/brain/commercial/multi-intent/parseCommercialIntentPlan";
import { loadPendingCommercialIntents, mergeCommercialIntents, savePendingCommercialIntents } from "@/lib/brain/commercial/multi-intent/pendingIntentState";
import {
  readDurableCommercialLineItems,
  readDurableShippingDestination,
  readLastAgentMessage,
  resolveCommercialIntentPlan,
  sumDurableSelectionQuantity
} from "@/lib/brain/commercial/multi-intent/requirementResolver";
import type { CommercialObjectiveSeed } from "./types";

export function commercialObjectiveSeedsFromResolvedIntent(resolved: ResolvedIntent): CommercialObjectiveSeed[] {
  const seeds: CommercialObjectiveSeed[] = [];
  const requirement = (type: string) => resolved.requirements.find((item) => item.type === type);

  if (resolved.intent.type === "select_products") {
    const product = requirement("PRODUCT");
    const quantity = requirement("QUANTITY");
    const quantityValue = quantity?.status === "resolved" && typeof quantity.value === "number" ? quantity.value : undefined;

    if (product?.status === "resolved" && quantityValue !== undefined) {
      const value = product.value as { productId: string; combinationId?: string };
      seeds.push({
        type: "SELECT_PRODUCTS",
        origin: "customer_requested",
        inputs: { items: [{ productId: value.productId, combinationId: value.combinationId ?? null, quantity: quantityValue }] }
      });
      return seeds;
    }

    // SALES-AGENT-R2-A08.6, Part 6. "ambiguous" (2+ catalog matches) and
    // "missing" (0 matches, or a reference that never resolved at all) are
    // both genuinely unresolved product evidence - only "resolved" (handled
    // above, returns real items[]) may reach SELECT_PRODUCTS' READY status
    // (buildCommercialWorkProjection.ts's applyObjectiveState only skips
    // WAITING_CUSTOMER when productEvidenceAvailable is not explicitly
    // false). Before this fix, "missing" left productEvidenceAvailable
    // unset, letting a bare unresolved productReference string reach READY
    // and fail at the capability with invalid_arguments instead of asking
    // the customer to clarify first.
    seeds.push({
      type: "SELECT_PRODUCTS",
      origin: "customer_requested",
      inputs: {
        ...(resolved.intent.productReference ? { productReference: resolved.intent.productReference } : {}),
        ...(quantityValue !== undefined ? { quantity: quantityValue } : {}),
        ...(product?.status === "ambiguous" || product?.status === "missing" ? { productEvidenceAvailable: false } : {}),
        // SALES-AGENT-R2-A11.1, Part 2. requirementResolver.ts's PRODUCT
        // "ambiguous" status already carries real candidates from
        // RecentCatalogContext (a prior search this same conversation) -
        // buildCommercialWorkProjection.ts's applyObjectiveState uses these
        // directly (skipping a redundant fresh search_products call) when
        // present, exactly like the R2-07 architecture scenario documents.
        ...(product?.status === "ambiguous" ? { productCandidates: product.candidates } : {})
      }
    });
    return seeds;
  }

  if (resolved.intent.type === "get_shipping_quote") {
    const destination = requirement("DESTINATION");
    if (destination?.status === "resolved" && destination.source === "explicit" && typeof destination.value === "string") {
      seeds.push({ type: "SET_DESTINATION", origin: "customer_requested", inputs: { destinationText: destination.value } });
    }
    seeds.push({
      type: "GET_SHIPPING_QUOTE",
      origin: "customer_requested",
      inputs: destination?.status === "resolved" && typeof destination.value === "string" ? { destinationText: destination.value } : {}
    });
    return seeds;
  }

  // SALES-AGENT-R2-A11.4. Unlike select_products, no ambiguous/missing
  // branching happens here at all - a single seed always carries the raw
  // optionReference forward unconditionally. Every real resolution (single
  // match, ambiguous, not-found, or a stale-evidence recalculation) happens
  // downstream in buildCommercialWorkProjection.ts's applyObjectiveState,
  // the only place that ever sees real calculate_shipping option data - see
  // that file's SELECT_SHIPPING_OPTION case and A11.4's release doc.
  if (resolved.intent.type === "select_shipping_option") {
    seeds.push({ type: "SELECT_SHIPPING_OPTION", origin: "customer_requested", inputs: { optionReference: resolved.intent.optionReference } });
    return seeds;
  }

  // SALES-AGENT-R2-A08.6, Part 9. create_quote reuses the existing
  // CREATE_QUOTE objective/step/executor/capability unchanged - no new
  // fields, since createQuoteCapability.ts takes none either.
  if (resolved.intent.type === "create_quote") {
    seeds.push({ type: "CREATE_QUOTE", origin: "customer_requested" });
    return seeds;
  }

  // SALES-AGENT-R2-ID-R2-A11. productHint carried forward verbatim (never
  // invented when absent) - buildCommercialWorkProjection.ts's
  // applyRepeatPurchaseObjectiveState uses it only to filter 2+ historical
  // purchase-history matches, never sent to Catalog/Customer Profile itself.
  if (resolved.intent.type === "repeat_purchase") {
    seeds.push({
      type: "REPEAT_PURCHASE",
      origin: "customer_requested",
      inputs: resolved.intent.productHint ? { productHint: resolved.intent.productHint } : {}
    });
    return seeds;
  }

  // SALES-AGENT-R2-ID-R2-A12. queryHint carried forward verbatim (never
  // invented when absent) - buildCommercialWorkProjection.ts's
  // applyCustomerAwareRecommendationObjectiveState always prefers it over
  // any loaded historical signal as the search query.
  if (resolved.intent.type === "customer_aware_recommendation") {
    seeds.push({
      type: "CUSTOMER_AWARE_RECOMMENDATION",
      origin: "customer_requested",
      inputs: resolved.intent.queryHint ? { queryHint: resolved.intent.queryHint } : {}
    });
    return seeds;
  }

  // SALES-AGENT-R2-A08.6, Part 3/9. targetType omitted means "all" to
  // reconciliation.ts's cancelTargetFamily/deriveCommercialObjectives.ts's
  // cancel handling - matches this intent's own "all" scope exactly.
  //
  // SALES-AGENT-R2-A08.7, Part 7. additionalScopes (never present alongside
  // "all", see parseCommercialIntentPlan.ts) becomes one extra cancel seed
  // per named scope - deriveCommercialObjectives.ts already loops seeds one
  // at a time, so N cancel seeds in the same turn narrow N families
  // independently with no engine change needed.
  if (resolved.intent.type === "cancel") {
    seeds.push({ kind: "cancel", ...(resolved.intent.scope !== "all" ? { targetType: resolved.intent.scope } : {}) });
    for (const scope of resolved.intent.additionalScopes ?? []) {
      seeds.push({ kind: "cancel", targetType: scope });
    }
    return seeds;
  }

  return seeds;
}

export function commercialObjectiveSeedsFromResolvedIntents(resolvedIntents: readonly ResolvedIntent[]): CommercialObjectiveSeed[] {
  return resolvedIntents.filter((resolved) => resolved.intent.type !== "unsupported").flatMap(commercialObjectiveSeedsFromResolvedIntent);
}

/**
 * SALES-AGENT-R2-A08.5. Promoted unchanged from work/benchmark/semanticIntentAdapter.ts
 * (A07.5) - the one real semantic-interpretation LLM boundary for R2: a
 * single planner call (LLM-R1-T09A's multi-intent planner prompt, deterministic
 * requirement resolver) per invocation, then the pure mapper above. Provider-
 * agnostic (AgentLoopProvider) - the production inbound entry point
 * (runCommercialWorkInboundCycle.ts) hands it the real DeepSeek provider;
 * the benchmark harness (runR2Scenario.ts) hands it an offline/live-benchmark
 * one. Same code, never two implementations.
 *
 * Turn-to-turn objective identity continuity (carrying a prior persisted
 * objectiveId forward as a seed's seedId) is NOT this adapter's concern -
 * this only resolves what ONE turn's message means. Callers merge this
 * output with any prior persisted CommercialWork via reconcileCommercialTrigger.
 */

export type SemanticIntentAdapterInput = {
  opportunityId: number;
  correlationId: string;
  customerMessage: string;
  commercialContextSummary: Record<string, unknown>;
  recentCatalogContext: RecentCatalogContext | null;
  provider: AgentLoopProvider;
  deadline: number;
  currentTime: string;
  abortSignal?: AbortSignal | null;
};

/**
 * Deliberately a narrow literal, not the benchmark's wider scoring taxonomy
 * (work/benchmark/types.ts's R2FailureClassification) - this adapter only
 * ever fails for one reason (semantic planning), and production code has no
 * reason to depend on a benchmark-only type module. The literal is still
 * assignable wherever a caller's own field is typed as the wider union.
 */
export type SemanticIntentAdapterFailureClassification = "SEMANTIC_PLANNING";

export type SemanticIntentAdapterResult =
  | { kind: "planned"; seeds: CommercialObjectiveSeed[]; resolvedIntents: ResolvedIntent[]; llmCalls: AgentLoopInferenceRecord[]; warnings: string[] }
  | {
      kind: "timeout" | "provider_unavailable" | "invalid_output";
      failureClassification: SemanticIntentAdapterFailureClassification;
      llmCalls: AgentLoopInferenceRecord[];
      warnings: string[];
    };

export async function planCommercialObjectiveSeeds(input: SemanticIntentAdapterInput): Promise<SemanticIntentAdapterResult> {
  const warnings: string[] = [];
  const llmCalls: AgentLoopInferenceRecord[] = [];

  const pendingRecords = await loadPendingCommercialIntents(input.opportunityId);
  const durableSelectionItems = readDurableCommercialLineItems(input.commercialContextSummary);
  const durableDestination = readDurableShippingDestination(input.commercialContextSummary);

  const promptPackage = buildIntentPlannerPromptPackage({
    customerMessage: input.customerMessage,
    recentCatalogContext: input.recentCatalogContext,
    hasDurableSelection: durableSelectionItems.length > 0,
    durableSelectionItemCount: durableSelectionItems.length,
    durableSelectionQuantity: sumDurableSelectionQuantity(durableSelectionItems),
    durableShippingDestinationName: durableDestination?.canonicalName ?? null,
    pendingIntents: pendingRecords,
    lastAgentMessage: readLastAgentMessage(input.commercialContextSummary)
  });

  const invoked = await invokeProviderWithDeadline(input.provider, promptPackage.messages, input.correlationId, input.deadline, input.abortSignal);

  if (invoked.kind === "timeout") {
    llmCalls.push(buildTimeoutInferenceRecord({ phase: "gathering", attempt: 0, decisionIndex: null, elapsedMs: invoked.elapsedMs }));
    warnings.push("r2_semantic_adapter_timeout");
    return { kind: "timeout", failureClassification: "SEMANTIC_PLANNING", llmCalls, warnings };
  }
  if (invoked.kind === "error") {
    const providerFailure = captureProviderFailure(input.provider, input.correlationId, invoked.error, invoked.elapsedMs);
    llmCalls.push(buildFailureInferenceRecord({ phase: "gathering", attempt: 0, decisionIndex: null, elapsedMs: invoked.elapsedMs, providerFailure }));
    warnings.push(`r2_semantic_adapter_provider_error:${providerFailure.normalizedReason}`);
    return { kind: "provider_unavailable", failureClassification: "SEMANTIC_PLANNING", llmCalls, warnings };
  }

  llmCalls.push(buildSuccessInferenceRecord({ phase: "gathering", attempt: 0, decisionIndex: null, elapsedMs: invoked.elapsedMs, metadata: invoked.metadata }));

  const parsed = parseCommercialIntentPlan(invoked.rawOutput);
  if (parsed.status === "invalid") {
    warnings.push(`r2_semantic_adapter_invalid_output:${parsed.reason}`);
    return { kind: "invalid_output", failureClassification: "SEMANTIC_PLANNING", llmCalls, warnings };
  }

  const mergedIntents = mergeCommercialIntents(pendingRecords, parsed.intents);
  const resolvedIntents = resolveCommercialIntentPlan(mergedIntents, {
    commercialContextSummary: input.commercialContextSummary,
    recentCatalogContext: input.recentCatalogContext
  });

  const seeds = commercialObjectiveSeedsFromResolvedIntents(resolvedIntents);

  const stillPending = resolvedIntents
    .filter((resolved) => resolved.status !== "ready" && resolved.intent.type !== "unsupported")
    .map((resolved) => ({
      intent: resolved.intent,
      missingRequirements: resolved.requirements.filter((requirement) => requirement.status !== "resolved").map((requirement) => requirement.type),
      savedAt: input.currentTime
    }));
  const saveResult = await savePendingCommercialIntents({ opportunityId: input.opportunityId, records: stillPending, sourceMessageId: input.correlationId });
  if (!saveResult.ok) warnings.push(`r2_semantic_adapter_pending_save_failed:${saveResult.warning ?? "unknown"}`);

  return { kind: "planned", seeds, resolvedIntents, llmCalls, warnings };
}
