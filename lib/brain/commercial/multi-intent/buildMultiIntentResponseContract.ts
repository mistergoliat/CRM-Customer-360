import type { ExecutedActionStep } from "./actionPlanExecutor";
import type { CommercialRequirementType, IntentExecutionStatus, IntentOutcome, MultiIntentResponseContract, ResolvedIntent } from "./types";

/**
 * LLM-R1-T09A, Part 10/13 (semantica de partial completion + Response
 * Contract). Classifies each intent's REAL final outcome - never what a
 * step's Gateway envelope status alone implies, always what its `data.status`
 * actually says (e.g. set_shipping_destination can return Gateway
 * status="completed" for "needs_clarification"/"not_found" too - those are
 * not a successful resolution, and calculate_shipping's own
 * "shipping_destination_required" is a second, independent signal of the
 * same real gap). Never aborts the whole plan because one intent is
 * incomplete (Part 10's explicit requirement) - each intent's classification
 * is computed independently from its own resolution status and its own
 * executed steps only.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dataStatus(observation: ExecutedActionStep["observation"]): string | null {
  return isRecord(observation.data) && typeof observation.data.status === "string" ? observation.data.status : null;
}

function classifyIntentOutcome(resolved: ResolvedIntent, executedSteps: ExecutedActionStep[]): IntentOutcome {
  if (resolved.intent.type === "unsupported") {
    return { intentIndex: resolved.intentIndex, intent: resolved.intent, status: "unsupported", missingRequirements: [], ambiguousRequirements: [], executionResults: [] };
  }

  const missingRequirements: CommercialRequirementType[] = resolved.requirements.filter((requirement) => requirement.status === "missing").map((requirement) => requirement.type);
  const ambiguousRequirements: CommercialRequirementType[] = resolved.requirements.filter((requirement) => requirement.status === "ambiguous").map((requirement) => requirement.type);

  if (resolved.status === "needs_clarification") {
    return { intentIndex: resolved.intentIndex, intent: resolved.intent, status: "needs_clarification", missingRequirements, ambiguousRequirements, executionResults: [] };
  }
  if (resolved.status === "waiting_for_information") {
    return { intentIndex: resolved.intentIndex, intent: resolved.intent, status: "waiting_for_information", missingRequirements, ambiguousRequirements, executionResults: [] };
  }

  // resolved.status === "ready": the requirement resolver considered this
  // intent executable - the real outcome now depends entirely on what its
  // own planned steps actually did.
  const ownSteps = executedSteps.filter((executed) => executed.step.forIntentIndex === resolved.intentIndex);
  const executionResults = ownSteps.map((executed) => ({ capability: executed.step.capability, observation: executed.observation }));

  const fail = (status: IntentExecutionStatus = "failed", extraAmbiguous: CommercialRequirementType[] = []): IntentOutcome => ({
    intentIndex: resolved.intentIndex,
    intent: resolved.intent,
    status,
    missingRequirements,
    ambiguousRequirements: [...ambiguousRequirements, ...extraAmbiguous],
    executionResults
  });

  if (ownSteps.length === 0) return fail(); // defensive: a "ready" intent always plans at least one step
  if (ownSteps.some((executed) => executed.skippedDependencyFailed)) return fail();

  if (resolved.intent.type === "select_products") {
    return ownSteps[0].observation.status === "completed" ? fail("completed") : fail();
  }

  // get_shipping_quote
  const destinationStep = ownSteps.find((executed) => executed.step.capability === "set_shipping_destination");
  if (destinationStep?.observation.status === "completed") {
    const status = dataStatus(destinationStep.observation);
    if (status === "needs_clarification" || status === "not_found") return fail("needs_clarification", ["DESTINATION"]);
  }

  const shippingStep = ownSteps.find((executed) => executed.step.capability === "calculate_shipping");
  if (!shippingStep) return fail();

  const shippingStatus = shippingStep.observation.status === "completed" ? dataStatus(shippingStep.observation) : null;
  if (shippingStatus === "available" || shippingStatus === "no_shipping_options") return fail("completed");

  return fail();
}

export function classifyMultiIntentOutcomes(resolvedIntents: ResolvedIntent[], executedSteps: ExecutedActionStep[]): IntentOutcome[] {
  return resolvedIntents.map((resolved) => classifyIntentOutcome(resolved, executedSteps));
}

export function buildMultiIntentResponseContract(outcomes: IntentOutcome[]): MultiIntentResponseContract {
  return {
    completedIntents: outcomes.filter((outcome) => outcome.status === "completed"),
    pendingIntents: outcomes.filter((outcome) => outcome.status === "waiting_for_information"),
    failedIntents: outcomes.filter((outcome) => outcome.status === "failed"),
    needsClarificationIntents: outcomes.filter((outcome) => outcome.status === "needs_clarification"),
    unsupportedIntents: outcomes.filter((outcome) => outcome.status === "unsupported"),
    missingRequirements: [...new Set(outcomes.flatMap((outcome) => outcome.missingRequirements))]
  };
}

/**
 * Part 13/16. What actually reaches the finalizer prompt as
 * commercialContext.multiIntentPlan (see buildAgentStepPromptPackage.ts's
 * MULTI_INTENT_PLAN_RULE_LINES) - a compact, bounded projection, never the
 * full internal ResolvedIntent/IntentOutcome objects (which carry raw
 * ToolObservation payloads the finalizer already sees separately via
 * priorStepsThisTurn). completedIntents/failedIntents are deliberately
 * omitted here: the real ToolObservations in priorStepsThisTurn already
 * ground what the model may say about them via the existing SELECT_PRODUCTS/
 * CALCULATE_SHIPPING rule blocks - duplicating that state here would be a
 * second, potentially-drifting source of the same facts.
 */
export function buildMultiIntentPlanPromptProjection(resolvedIntents: ResolvedIntent[], outcomes: IntentOutcome[]) {
  const candidatesByIntentIndex = new Map<number, { name: string }[]>();
  for (const resolved of resolvedIntents) {
    const ambiguous = resolved.requirements.find((requirement) => requirement.status === "ambiguous");
    if (ambiguous && ambiguous.status === "ambiguous") {
      candidatesByIntentIndex.set(resolved.intentIndex, ambiguous.candidates.map((candidate) => ({ name: candidate.name })));
    }
  }

  return {
    pendingIntents: outcomes.filter((outcome) => outcome.status === "waiting_for_information").map((outcome) => ({ type: outcome.intent.type, missing: outcome.missingRequirements })),
    needsClarificationIntents: outcomes
      .filter((outcome) => outcome.status === "needs_clarification")
      .map((outcome) => ({ type: outcome.intent.type, ambiguous: outcome.ambiguousRequirements, candidates: candidatesByIntentIndex.get(outcome.intentIndex) ?? [] })),
    unsupportedIntents: outcomes
      .filter((outcome) => outcome.status === "unsupported")
      .map((outcome) => ({ description: outcome.intent.type === "unsupported" ? (outcome.intent.description ?? null) : null }))
  };
}
