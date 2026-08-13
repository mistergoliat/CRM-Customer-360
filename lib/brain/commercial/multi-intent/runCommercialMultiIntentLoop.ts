import {
  buildFailureInferenceRecord,
  buildSuccessInferenceRecord,
  buildTimeoutInferenceRecord,
  captureProviderFailure,
  invokeProviderWithDeadline,
  MUTATION_CLAIM_GUARD_FALLBACK_MESSAGE
} from "../agent-loop/runAgentToolLoop";
import type { RunAgentToolLoopInput } from "../agent-loop/runAgentToolLoop";
import { buildAgentStepPromptPackage } from "../agent-loop/buildAgentStepPromptPackage";
import type { AgentLoopPriorAttemptFailure } from "../agent-loop/buildAgentStepPromptPackage";
import { validateAgentStep } from "../agent-loop/validateAgentStep";
import { checkUnbackedCommercialMutationClaim } from "../agent-loop/commercialMutationClaims";
import type { AgentLoopInferenceRecord, AgentLoopProviderFailure, AgentLoopResult, AgentLoopStepRecord, AgentStepRespond } from "../agent-loop/agentStepTypes";
import type { CapabilityGatewayContext } from "../capability-gateway/types";
import { SALES_AGENT_CONFIGURATION_SAFE_DEFAULT } from "../sales-agent-configuration";
import { buildIntentPlannerPromptPackage } from "./buildIntentPlannerPromptPackage";
import type { IntentPlannerPriorAttemptFailure } from "./buildIntentPlannerPromptPackage";
import { parseCommercialIntentPlan } from "./parseCommercialIntentPlan";
import { resolveCommercialIntentPlan, readDurableCommercialLineItems, readDurableShippingDestination } from "./requirementResolver";
import { planCommercialActions } from "./executionPlanner";
import { executeCommercialActionPlan } from "./actionPlanExecutor";
import { classifyMultiIntentOutcomes, buildMultiIntentResponseContract, buildMultiIntentPlanPromptProjection } from "./buildMultiIntentResponseContract";
import { loadPendingCommercialIntents, savePendingCommercialIntents, mergeCommercialIntents } from "./pendingIntentState";
import type { CommercialIntent, PendingCommercialIntentRecord } from "./types";

/**
 * LLM-R1-T09A. The backend Multi-Intent Planning + Requirement Resolution
 * runtime - see docs/architecture/commercial-multi-intent-planning.md for the
 * full design and the CURRENT_FLOW/PROPOSED_INSERTION_POINT audit.
 *
 * Same input/output contract as the legacy runAgentToolLoop.ts (RunAgentToolLoopInput
 * in, AgentLoopResult out) so it is a drop-in alternative behind a feature
 * flag (runNativeAgentToolLoopCycle.ts) - every downstream consumer
 * (dispatchAgentLoopResponse, recordAgentToolLoopCompletedCommercialEvent,
 * pendingCatalogAction persistence) works unmodified.
 *
 * Exactly two real LLM calls per turn in the common case (planner, then
 * finalizer - each with at most one guided-repair retry, Part 20), instead of
 * the legacy loop's up to `maxDecisions` independent gathering decisions:
 *
 *   1. Planner (buildIntentPlannerPromptPackage): one message -> structured
 *      CommercialIntentPlan JSON. Semantic interpretation only - no catalog
 *      identity, no tool selection, no execution.
 *   2. Deterministic backend (no LLM): merge with pending intents (Part 12) ->
 *      resolve requirements (requirementResolver.ts) -> plan actions
 *      (executionPlanner.ts) -> execute through the same Capability Gateway
 *      every other tool in this system uses (actionPlanExecutor.ts) ->
 *      classify real outcomes (buildMultiIntentResponseContract.ts).
 *   3. Finalizer: reuses buildAgentStepPromptPackage's existing "finalization"
 *      phase verbatim (respond/handoff only, Part 16 - the model never
 *      executes), fed this turn's real executed steps as priorSteps (so every
 *      existing grounding rule - stock disclosure, shipping grounding, the
 *      T08C/T08D evidence rules - applies unchanged) plus the new
 *      multiIntentPlan projection (MULTI_INTENT_PLAN_RULE_LINES) for
 *      pending/ambiguous/unsupported intents, which never produce a tool
 *      observation of their own. The same Commercial Mutation Execution
 *      Guard (commercialMutationClaims.ts) still gates the output (Part 16).
 *
 * Provider-level failure handling mirrors runAgentToolLoop.ts's own
 * discipline throughout: one guided-repair attempt for a structural
 * ("invalid_response") failure, fail closed otherwise - never executes a
 * partially parsed plan (Part 20).
 */

const DEFAULT_TIMEOUT_MS = 20000;
const FINALIZATION_MAX_ATTEMPTS = 2;

function emptyResult(terminalReason: AgentLoopResult["terminalReason"], warnings: string[], llmCalls: AgentLoopInferenceRecord[], extra: Partial<AgentLoopResult> = {}): AgentLoopResult {
  return {
    ran: true,
    terminalReason,
    steps: [],
    toolExecutionCount: 0,
    finalMessage: null,
    handoffReason: null,
    warnings,
    finalPendingCatalogAction: null,
    llmCalls,
    ...extra
  };
}

/**
 * Part 20 (bounded, structured-output planner). One repair attempt on either
 * a provider-level structural failure or a schema-invalid plan, then fails
 * closed - a real, honest handoff, never a guess at what the customer meant.
 */
async function runPlannerPhase(input: {
  loopInput: RunAgentToolLoopInput;
  deadline: number;
  pendingRecords: PendingCommercialIntentRecord[];
  warnings: string[];
  llmCalls: AgentLoopInferenceRecord[];
}): Promise<
  | { kind: "planned"; intents: CommercialIntent[] }
  | { kind: "timeout" }
  | { kind: "provider_unavailable"; providerFailure: AgentLoopProviderFailure }
  | { kind: "invalid_output" }
> {
  const { loopInput, deadline, pendingRecords, warnings, llmCalls } = input;
  const durableSelectionItems = readDurableCommercialLineItems(loopInput.commercialContextSummary);
  const durableDestination = readDurableShippingDestination(loopInput.commercialContextSummary);

  let attempt = 0;
  let repairUsed = false;
  let priorAttemptFailure: IntentPlannerPriorAttemptFailure | null = null;

  while (true) {
    if (Date.now() > deadline) {
      warnings.push("agent_loop_timeout");
      return { kind: "timeout" };
    }

    const promptPackage = buildIntentPlannerPromptPackage({
      customerMessage: loopInput.customerMessage,
      recentCatalogContext: loopInput.recentCatalogContext ?? null,
      hasDurableSelection: durableSelectionItems.length > 0,
      durableSelectionItemCount: durableSelectionItems.length,
      durableShippingDestinationName: durableDestination?.canonicalName ?? null,
      pendingIntents: pendingRecords,
      priorAttemptFailure
    });
    priorAttemptFailure = null;

    const invoked = await invokeProviderWithDeadline(loopInput.provider!, promptPackage.messages, loopInput.correlationId, deadline, loopInput.abortSignal);
    const callAttempt = attempt;
    attempt += 1;

    if (invoked.kind === "timeout") {
      llmCalls.push(buildTimeoutInferenceRecord({ phase: "gathering", attempt: callAttempt, decisionIndex: null, elapsedMs: invoked.elapsedMs }));
      warnings.push("agent_loop_timeout");
      return { kind: "timeout" };
    }
    if (invoked.kind === "error") {
      const providerFailure = captureProviderFailure(loopInput.provider!, loopInput.correlationId, invoked.error, invoked.elapsedMs);
      llmCalls.push(buildFailureInferenceRecord({ phase: "gathering", attempt: callAttempt, decisionIndex: null, elapsedMs: invoked.elapsedMs, providerFailure }));
      warnings.push(`agent_loop_provider_error:${providerFailure.normalizedReason}`);
      if (providerFailure.normalizedReason === "invalid_response" && !repairUsed) {
        repairUsed = true;
        priorAttemptFailure = { kind: "invalid_response" };
        warnings.push("agent_loop_structured_recovery_attempted:multi_intent_planner");
        continue;
      }
      return { kind: "provider_unavailable", providerFailure };
    }

    llmCalls.push(buildSuccessInferenceRecord({ phase: "gathering", attempt: callAttempt, decisionIndex: null, elapsedMs: invoked.elapsedMs, metadata: invoked.metadata }));

    const parsed = parseCommercialIntentPlan(invoked.rawOutput);
    if (parsed.status === "invalid") {
      warnings.push(`multi_intent_planner_invalid_output:${parsed.reason}`);
      if (!repairUsed) {
        repairUsed = true;
        priorAttemptFailure = { kind: "invalid_plan_shape" };
        continue;
      }
      warnings.push("multi_intent_planner_failed_closed");
      return { kind: "invalid_output" };
    }

    if (parsed.droppedDuplicateTypes.length > 0) {
      warnings.push(`multi_intent_duplicate_intent_dropped:${parsed.droppedDuplicateTypes.join(",")}`);
    }
    return { kind: "planned", intents: parsed.intents };
  }
}

function buildRespondedResult(
  step: AgentStepRespond,
  steps: AgentLoopStepRecord[],
  toolExecutionCount: number,
  warnings: string[],
  llmCalls: AgentLoopInferenceRecord[],
  correlationId: string
): AgentLoopResult {
  const mutationClaimCheck = checkUnbackedCommercialMutationClaim({ terminalReason: "responded", finalMessage: step.message, steps });
  if (mutationClaimCheck.unbacked) {
    warnings.push(`agent_loop_mutation_claim_blocked:${mutationClaimCheck.matchedPattern ?? "unknown"}`);
  }
  // LLM-R1-T09B, Part 9. Bounded, enum-only observability of the Commercial
  // Mutation Execution Guard's own decision - never the claimed/final message
  // text, never reasoning. Pure additive logging; the guard's logic above is
  // unchanged (Part 3's "no modificar... mutation guard salvo bug real").
  console.info({ event: "multi_intent_mutation_guard_evaluated", correlationId, claimed: mutationClaimCheck.claimed, backed: mutationClaimCheck.backed, blocked: mutationClaimCheck.unbacked });
  const finalMessage = mutationClaimCheck.unbacked ? MUTATION_CLAIM_GUARD_FALLBACK_MESSAGE : step.message;
  // T09A scope: no send_product_link continuity in the multi-intent path
  // (Part 26 - this task orchestrates existing capabilities, never a new
  // one, and pendingCatalogAction only ever originates from
  // get_product_details/recommend_catalog_products, neither of which this
  // task's two intents plan) - always null, a documented limitation, not a
  // bug (see docs/architecture/commercial-multi-intent-planning.md).
  return { ran: true, terminalReason: "responded", steps, toolExecutionCount, finalMessage, handoffReason: null, warnings, finalPendingCatalogAction: null, llmCalls };
}

export async function runCommercialMultiIntentLoop(input: RunAgentToolLoopInput): Promise<AgentLoopResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const identityConfiguration = input.identityConfiguration ?? SALES_AGENT_CONFIGURATION_SAFE_DEFAULT;
  const deadline = Date.now() + timeoutMs;
  const warnings: string[] = [];
  const llmCalls: AgentLoopInferenceRecord[] = [];

  if (!input.provider) {
    return emptyResult("provider_unavailable", ["provider_unavailable"], []);
  }

  const plannerStartedAt = Date.now();
  const pendingRecords = await loadPendingCommercialIntents(input.opportunityId);
  if (pendingRecords.length > 0) {
    warnings.push(`multi_intent_pending_loaded:${pendingRecords.map((record) => record.intent.type).join(",")}`);
  }

  const plannerOutcome = await runPlannerPhase({ loopInput: input, deadline, pendingRecords, warnings, llmCalls });
  const plannerElapsedMs = Date.now() - plannerStartedAt;

  if (plannerOutcome.kind === "timeout") return emptyResult("timeout", warnings, llmCalls);
  if (plannerOutcome.kind === "provider_unavailable") return emptyResult("provider_unavailable", warnings, llmCalls, { providerFailure: plannerOutcome.providerFailure });
  if (plannerOutcome.kind === "invalid_output") {
    return { ...emptyResult("handoff", warnings, llmCalls), handoffReason: "multi_intent_planner_invalid_output" };
  }

  const mergedIntents = mergeCommercialIntents(pendingRecords, plannerOutcome.intents);

  const executorStartedAt = Date.now();
  const resolvedIntents = resolveCommercialIntentPlan(mergedIntents, {
    commercialContextSummary: input.commercialContextSummary,
    recentCatalogContext: input.recentCatalogContext ?? null
  });
  const plannedSteps = planCommercialActions(resolvedIntents);

  const gatewayContext: CapabilityGatewayContext = {
    correlationId: input.correlationId,
    conversationId: input.conversationId,
    opportunityId: input.opportunityId,
    trustedCustomerSession: input.trustedCustomerSession ?? null
  };
  const { executedSteps, stepRecords } = await executeCommercialActionPlan(plannedSteps, gatewayContext);
  const toolExecutionCount = executedSteps.filter((executed) => !executed.skippedDependencyFailed).length;

  const outcomes = classifyMultiIntentOutcomes(resolvedIntents, executedSteps);
  const responseContract = buildMultiIntentResponseContract(outcomes);
  const executorElapsedMs = Date.now() - executorStartedAt;

  if (input.opportunityId) {
    const stillPending: PendingCommercialIntentRecord[] = responseContract.pendingIntents.map((outcome) => ({
      intent: outcome.intent,
      missingRequirements: outcome.missingRequirements,
      savedAt: input.currentTime
    }));
    const saveResult = await savePendingCommercialIntents({ opportunityId: input.opportunityId, records: stillPending, sourceMessageId: input.correlationId });
    if (!saveResult.ok) warnings.push(`multi_intent_pending_save_failed:${saveResult.warning ?? "unknown"}`);
  }

  // Part 27. Bounded, enum/count-only observability - never free-text
  // productReference/destination values, never raw ToolObservation payloads.
  console.info({
    event: "multi_intent_turn_completed",
    correlationId: input.correlationId,
    detectedIntentTypes: mergedIntents.map((intent) => intent.type),
    intentCount: mergedIntents.length,
    plannedActionTypes: plannedSteps.map((step) => step.capability),
    outcomeStatuses: outcomes.map((outcome) => outcome.status),
    missingRequirementTypes: responseContract.missingRequirements,
    pendingIntentCount: responseContract.pendingIntents.length,
    plannerElapsedMs,
    executorElapsedMs
  });

  const finalizerStartedAt = Date.now();
  const multiIntentPlan = buildMultiIntentPlanPromptProjection(resolvedIntents, outcomes);
  const finalizerCommercialContextSummary = { ...input.commercialContextSummary, multiIntentPlan };

  let finalizationPendingRepairSignal: AgentLoopPriorAttemptFailure | null = null;
  for (let attempt = 0; attempt < FINALIZATION_MAX_ATTEMPTS; attempt += 1) {
    if (Date.now() > deadline) {
      warnings.push("agent_loop_timeout");
      return emptyResult("timeout", warnings, llmCalls, { steps: stepRecords, toolExecutionCount });
    }

    const promptPackage = buildAgentStepPromptPackage({
      currentTime: input.currentTime,
      customerMessage: input.customerMessage,
      commercialContextSummary: finalizerCommercialContextSummary,
      recentCatalogContext: input.recentCatalogContext ?? null,
      pendingCatalogAction: input.pendingCatalogAction ?? null,
      availableTools: [],
      priorSteps: stepRecords,
      stepsRemaining: 1,
      phase: "finalization",
      identityConfiguration,
      priorAttemptFailure: finalizationPendingRepairSignal
    });
    finalizationPendingRepairSignal = null;

    const invoked = await invokeProviderWithDeadline(input.provider, promptPackage.messages, input.correlationId, deadline, input.abortSignal);
    if (invoked.kind === "timeout") {
      llmCalls.push(buildTimeoutInferenceRecord({ phase: "finalization", attempt, decisionIndex: null, elapsedMs: invoked.elapsedMs }));
      warnings.push("agent_loop_timeout");
      return emptyResult("timeout", warnings, llmCalls, { steps: stepRecords, toolExecutionCount });
    }
    if (invoked.kind === "error") {
      const providerFailure = captureProviderFailure(input.provider, input.correlationId, invoked.error, invoked.elapsedMs);
      llmCalls.push(buildFailureInferenceRecord({ phase: "finalization", attempt, decisionIndex: null, elapsedMs: invoked.elapsedMs, providerFailure }));
      warnings.push(`agent_loop_provider_error:${providerFailure.normalizedReason}`);
      if (providerFailure.normalizedReason === "invalid_response" && attempt < FINALIZATION_MAX_ATTEMPTS - 1) {
        finalizationPendingRepairSignal = { kind: "invalid_response" };
        warnings.push("agent_loop_structured_recovery_attempted:finalization");
        continue;
      }
      return emptyResult("provider_unavailable", warnings, llmCalls, { steps: stepRecords, toolExecutionCount, providerFailure });
    }

    llmCalls.push(buildSuccessInferenceRecord({ phase: "finalization", attempt, decisionIndex: null, elapsedMs: invoked.elapsedMs, metadata: invoked.metadata }));

    const validation = validateAgentStep(invoked.rawOutput, ["respond", "handoff"]);
    if (validation.status === "invalid") {
      warnings.push(`agent_step_invalid:${validation.reason}`);
      if (attempt < FINALIZATION_MAX_ATTEMPTS - 1) {
        finalizationPendingRepairSignal = { kind: "invalid_agent_step", reasonCode: validation.reasonCode };
        continue;
      }
      warnings.push("agent_loop_finalization_failed");
      return emptyResult("invalid_output", warnings, llmCalls, { steps: stepRecords, toolExecutionCount });
    }

    const step = validation.step;
    stepRecords.push({ stepIndex: stepRecords.length, step, governance: null, observation: null, phase: "finalization" });

    if (step.type === "respond") {
      const result = buildRespondedResult(step, stepRecords, toolExecutionCount, warnings, llmCalls, input.correlationId);
      console.info({ event: "multi_intent_finalizer_completed", correlationId: input.correlationId, finalizerElapsedMs: Date.now() - finalizerStartedAt });
      return result;
    }
    if (step.type === "handoff") {
      console.info({ event: "multi_intent_finalizer_completed", correlationId: input.correlationId, finalizerElapsedMs: Date.now() - finalizerStartedAt });
      return { ran: true, terminalReason: "handoff", steps: stepRecords, toolExecutionCount, finalMessage: null, handoffReason: step.reason, warnings, finalPendingCatalogAction: null, llmCalls };
    }
  }

  return emptyResult("invalid_output", warnings, llmCalls, { steps: stepRecords, toolExecutionCount });
}
