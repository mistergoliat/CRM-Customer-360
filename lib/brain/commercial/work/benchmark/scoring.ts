import { resolveCapabilityGovernance } from "@/lib/brain/commercial/capability-gateway";
import type { CommercialObjective } from "../types";
import type { CommercialWorkStatus } from "../statuses";
import type { PersistedCommercialWork } from "../persistenceTypes";
import type { CapabilityCallLogEntry, R2ArchitectureScenario, R2ScenarioRunOutcome, R2ScenarioScore } from "./types";

/**
 * SALES-AGENT-R2-A07.5. The central architectural property under test: a
 * commercial objective is "lost work" unless it terminated, or is durably
 * represented as work the customer or the system still owes an answer to.
 * FAILED is deliberately NOT safe here (retry-exhausted with no HANDOFF is
 * real lost work) - see docs/releases/SALES-AGENT-R2-A07.5-*.md Part 3.
 */
const DURABLY_SAFE_OBJECTIVE_STATUSES = new Set(["COMPLETED", "CANCELLED", "SUPERSEDED", "WAITING_CUSTOMER", "WAITING_SYSTEM"]);

export function isObjectiveDurablyRepresented(objective: CommercialObjective, work: Pick<PersistedCommercialWork, "status" | "steps">): boolean {
  if (DURABLY_SAFE_OBJECTIVE_STATUSES.has(objective.status)) return true;
  if (work.status === "HANDOFF") return true;
  const ownedSteps = work.steps.filter((step) => step.objectiveIds.includes(objective.objectiveId));
  return ownedSteps.some((step) => step.status === "RETRY_SCHEDULED");
}

export function countLostObjectives(work: Pick<PersistedCommercialWork, "status" | "steps" | "objectives">): { lost: number; total: number } {
  const total = work.objectives.length;
  const lost = work.objectives.filter((objective) => !isObjectiveDurablyRepresented(objective, work)).length;
  return { lost, total };
}

/**
 * Real governance metadata (capability-gateway registry), never a
 * hand-maintained duplicate list - calculate_shipping is governance-tagged
 * read_only (a real-time Carrier MS price lookup, no durable write of its
 * own), so calling it twice for a genuinely changed request (R2-08's
 * correction) is not a duplicate side effect - only select_products/
 * set_shipping_destination/create_quote (sideEffect:"mutating") are.
 */
function isMutatingCapability(capabilityName: string): boolean {
  return resolveCapabilityGovernance(capabilityName)?.sideEffect === "mutating";
}

/** >1 real (non-injected-fault) "completed" call to a MUTATING capability for the same step - the crash-recovery/evidence-repair path should always short-circuit a second real mutating call. */
function hasDuplicateSideEffect(calls: readonly CapabilityCallLogEntry[]): boolean {
  const completedRealCallsByStep = new Map<string, number>();
  for (const call of calls) {
    if (call.injectedFault || call.status !== "completed" || !call.stepId || !isMutatingCapability(call.capabilityName)) continue;
    completedRealCallsByStep.set(call.stepId, (completedRealCallsByStep.get(call.stepId) ?? 0) + 1);
  }
  return [...completedRealCallsByStep.values()].some((count) => count > 1);
}

/** A COMPLETED step with no evidence is a completion the executor cannot back with a durable fact/capability record - should be structurally impossible, a finding if it happens. */
function hasUnbackedMutationClaim(work: Pick<PersistedCommercialWork, "steps">): boolean {
  return work.steps.some((step) => step.status === "COMPLETED" && step.evidence.length === 0);
}

/**
 * A capability invoked (logged) for a step whose FINAL blockers still carry
 * STALE_EVIDENCE for that step. Known scorer limitation, not a design gap:
 * `activateUnblockedSteps` clears blockers once a step later re-activates,
 * so this under-counts staleness that was resolved within the same run - it
 * is exact for the R2-05/06/08 scenarios that keep the stale step blocked
 * through the end of the run, which is what those scenarios assert.
 */
function hasStaleEvidenceExecuted(calls: readonly CapabilityCallLogEntry[], work: Pick<PersistedCommercialWork, "steps">): boolean {
  const staleStepIds = new Set(
    work.steps.filter((step) => step.blockers.some((blocker) => blocker.code === "STALE_EVIDENCE")).map((step) => step.stepId)
  );
  return calls.some((call) => call.stepId && staleStepIds.has(call.stepId) && call.status === "completed");
}

function statusMatches<T extends string>(actual: T, expected: T | T[]): boolean {
  return Array.isArray(expected) ? expected.includes(actual) : expected === actual;
}

/**
 * A turn that fills in a previously-missing requirement (R2-04) re-seeds the
 * prior objective (see runR2Scenario.ts#carryForwardActiveObjectives) and a
 * fresh same-family seed, which deriveCommercialObjectives correctly
 * supersedes - so more than one objective of the same type can legitimately
 * exist in one CommercialWork, oldest first. Expectations always mean the
 * currently-live one, never a superseded/cancelled ancestor.
 */
function currentObjectiveOfType(work: PersistedCommercialWork, type: string) {
  const live = [...work.objectives].reverse().find((objective) => objective.type === type && objective.status !== "SUPERSEDED" && objective.status !== "CANCELLED");
  return live ?? [...work.objectives].reverse().find((objective) => objective.type === type);
}

function scoreObjectiveExpectations(scenario: R2ArchitectureScenario, work: PersistedCommercialWork): { objectiveDetectionCorrect: boolean; requirementResolutionCorrect: boolean } {
  let objectiveDetectionCorrect = true;
  let requirementResolutionCorrect = true;
  for (const expected of scenario.expected.objectives) {
    const found = currentObjectiveOfType(work, expected.type);
    if (!found || !statusMatches(found.status, expected.status)) {
      objectiveDetectionCorrect = false;
      continue;
    }
    if (expected.missingRequirements) {
      const actual = [...found.missingRequirements].sort();
      const wanted = [...expected.missingRequirements].sort();
      if (JSON.stringify(actual) !== JSON.stringify(wanted)) requirementResolutionCorrect = false;
    }
  }
  return { objectiveDetectionCorrect, requirementResolutionCorrect };
}

/** Same "prefer the currently-live owner" rule as currentObjectiveOfType - a step whose owning objective was superseded is stale DB history, never what a status expectation means. */
function currentStepOfType(work: PersistedCommercialWork, type: string) {
  const liveObjectiveIds = new Set(
    work.objectives.filter((objective) => objective.status !== "SUPERSEDED" && objective.status !== "CANCELLED").map((objective) => objective.objectiveId)
  );
  const candidates = work.steps.filter((step) => step.type === type);
  return candidates.find((step) => step.objectiveIds.some((id) => liveObjectiveIds.has(id))) ?? candidates[candidates.length - 1];
}

function scoreWorkGraph(scenario: R2ArchitectureScenario, work: PersistedCommercialWork): boolean {
  if (!statusMatches<CommercialWorkStatus>(work.status, scenario.expected.workStatus)) return false;
  return scenario.expected.stepStatuses.every((expected) => {
    const found = currentStepOfType(work, expected.type);
    return Boolean(found) && statusMatches(found!.status, expected.status);
  });
}

function scoreDurableFacts(scenario: R2ArchitectureScenario, work: PersistedCommercialWork): boolean {
  const expected = scenario.expected.durableFacts;
  if (expected.commercialLineItems) {
    const selectObjective = currentObjectiveOfType(work, "SELECT_PRODUCTS");
    if (selectObjective?.status !== "COMPLETED" || !selectObjective.resolvedInputs.commercialLineItemsFactId) return false;
  }
  if (typeof expected.createdQuoteExists === "boolean") {
    const quoteObjective = currentObjectiveOfType(work, "CREATE_QUOTE");
    const exists = Boolean(quoteObjective?.resolvedInputs.createdQuoteFactId);
    if (exists !== expected.createdQuoteExists) return false;
  }
  return true;
}

export function scoreR2Scenario(scenario: R2ArchitectureScenario, outcome: R2ScenarioRunOutcome): R2ScenarioScore {
  const base = { scenarioId: scenario.scenarioId, runIndex: outcome.runIndex };

  if (outcome.blocked || !outcome.finalWork) {
    return {
      ...base,
      blocked: true,
      objectiveDetectionCorrect: false,
      requirementResolutionCorrect: false,
      requiredObjectivesCompleted: false,
      workGraphCorrect: false,
      durableRemainingWorkCorrect: false,
      lostObjectiveCount: 0,
      totalObjectiveCount: 0,
      duplicateSideEffect: false,
      unbackedMutationClaim: false,
      staleEvidenceExecuted: false,
      retryRecovered: null,
      restartRecovered: null,
      customerReasked: false,
      customerVisibleOutcome: "unacceptable",
      safetyFailure: false,
      handoffOccurred: false,
      followUpCorrect: null,
      overallPass: false,
      failureClassification: outcome.runFailureClassification
    };
  }

  const work = outcome.finalWork;
  const { objectiveDetectionCorrect, requirementResolutionCorrect } = scoreObjectiveExpectations(scenario, work);
  const workGraphCorrect = scoreWorkGraph(scenario, work);
  const durableRemainingWorkCorrect = scoreDurableFacts(scenario, work);
  const { lost, total } = countLostObjectives(work);
  const duplicateSideEffect = hasDuplicateSideEffect(outcome.capabilityCalls);
  const unbackedMutationClaim = hasUnbackedMutationClaim(work);
  const staleEvidenceExecuted = hasStaleEvidenceExecuted(outcome.capabilityCalls, work);
  const requiredObjectivesCompleted = scenario.expected.objectives
    .filter((expected) => !Array.isArray(expected.status) && expected.status === "COMPLETED")
    .every((expected) => work.objectives.some((objective) => objective.type === expected.type && objective.status === "COMPLETED"));

  const recoveredCleanly = work.steps.some((step) => step.status === "COMPLETED") && !work.steps.some((step) => step.status === "FAILED");
  const retryRecovered = outcome.retryOccurred ? recoveredCleanly : null;
  // Independent of retryOccurred/retryRecovered - R2-06 (crashAfterSideEffect)
  // never sets retryOccurred, so this must not be derived FROM retryRecovered
  // (that previously collapsed a pure restart-recovery run to null always).
  const restartRecovered = outcome.restartRecoveryOccurred ? recoveredCleanly : null;

  const customerVisibleOutcome = lost > 0 || duplicateSideEffect || unbackedMutationClaim ? "unacceptable" : scenario.expected.customerVisibleOutcome;
  const safetyFailure = unbackedMutationClaim;
  const handoffOccurred = work.status === "HANDOFF";
  const followUpCorrect = scenario.followUp ? outcome.followUpScheduled === scenario.expected.followUpExpected && outcome.followUpCancelled === Boolean(scenario.followUp.simulateInboundBeforeDue) : null;

  const overallPass =
    objectiveDetectionCorrect &&
    requirementResolutionCorrect &&
    requiredObjectivesCompleted &&
    workGraphCorrect &&
    durableRemainingWorkCorrect &&
    lost === 0 &&
    !duplicateSideEffect &&
    !unbackedMutationClaim &&
    !staleEvidenceExecuted &&
    handoffOccurred === scenario.expected.handoffExpected &&
    (followUpCorrect ?? true);

  return {
    ...base,
    blocked: false,
    objectiveDetectionCorrect,
    requirementResolutionCorrect,
    requiredObjectivesCompleted,
    workGraphCorrect,
    durableRemainingWorkCorrect,
    lostObjectiveCount: lost,
    totalObjectiveCount: total,
    duplicateSideEffect,
    unbackedMutationClaim,
    staleEvidenceExecuted,
    retryRecovered,
    restartRecovered,
    customerReasked: false,
    customerVisibleOutcome,
    safetyFailure,
    handoffOccurred,
    followUpCorrect,
    overallPass,
    failureClassification: overallPass ? null : outcome.runFailureClassification
  };
}
