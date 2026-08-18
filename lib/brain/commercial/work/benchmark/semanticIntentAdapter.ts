import type { AgentLoopInferenceRecord } from "@/lib/brain/commercial/agent-loop/agentStepTypes";
import type { AgentLoopProvider } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";
import { buildFailureInferenceRecord, buildSuccessInferenceRecord, buildTimeoutInferenceRecord, captureProviderFailure, invokeProviderWithDeadline } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";
import type { RecentCatalogContext } from "@/lib/brain/commercial/agent-loop/recentCatalogContext";
import { buildIntentPlannerPromptPackage } from "@/lib/brain/commercial/multi-intent/buildIntentPlannerPromptPackage";
import { parseCommercialIntentPlan } from "@/lib/brain/commercial/multi-intent/parseCommercialIntentPlan";
import { loadPendingCommercialIntents, mergeCommercialIntents, savePendingCommercialIntents } from "@/lib/brain/commercial/multi-intent/pendingIntentState";
import { readDurableCommercialLineItems, readDurableShippingDestination, resolveCommercialIntentPlan } from "@/lib/brain/commercial/multi-intent/requirementResolver";
import type { ResolvedIntent } from "@/lib/brain/commercial/multi-intent/types";
import { commercialObjectiveSeedsFromResolvedIntents } from "../semanticIntentAdapter";
import type { CommercialObjectiveSeed } from "../types";
import type { R2FailureClassification } from "./types";

/**
 * SALES-AGENT-R2-A07.5. The one small benchmark-only integration this
 * harness needs: nothing in production today connects a real customer
 * message to CommercialWork (grep-confirmed - deriveCommercialObjectives/
 * buildCommercialWorkProjection are only ever called from lib/brain/commercial/work/**
 * and its own tests). A real, already-tested semantic-interpretation LLM
 * layer does exist (LLM-R1-T09A's multi-intent planner) and already produces
 * exactly the input shape deriveCommercialObjectives expects
 * (PendingCommercialIntentRecord/CommercialIntent) - this reuses that
 * planner call and its deterministic requirement resolver UNCHANGED, and
 * adds only the one new piece of logic: mapping ResolvedIntent[] to
 * CommercialObjectiveSeed[] for the R2 executor, instead of T09A's own
 * inline actionPlanExecutor.ts (which this benchmark deliberately never
 * calls - that is the legacy, non-durable execution path).
 *
 * Turn-to-turn objective identity continuity (carrying a prior persisted
 * objectiveId forward as a seed's seedId) is NOT this adapter's concern -
 * this only resolves what ONE turn's message means. See runR2Scenario.ts for
 * how a scenario driver merges this output with a prior persisted
 * CommercialWork.
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

export type SemanticIntentAdapterResult =
  | { kind: "planned"; seeds: CommercialObjectiveSeed[]; resolvedIntents: ResolvedIntent[]; llmCalls: AgentLoopInferenceRecord[]; warnings: string[] }
  | { kind: "timeout" | "provider_unavailable" | "invalid_output"; failureClassification: R2FailureClassification; llmCalls: AgentLoopInferenceRecord[]; warnings: string[] };

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
    durableShippingDestinationName: durableDestination?.canonicalName ?? null,
    pendingIntents: pendingRecords
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
