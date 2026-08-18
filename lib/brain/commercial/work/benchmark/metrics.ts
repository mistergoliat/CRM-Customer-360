import type { R2ScenarioRunResult } from "./types";

function rate(count: number, total: number): number | null {
  if (total === 0) return null;
  return count / total;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(sortedAscending: number[], p: number): number | null {
  if (sortedAscending.length === 0) return null;
  const index = Math.min(sortedAscending.length - 1, Math.ceil((p / 100) * sortedAscending.length) - 1);
  return sortedAscending[Math.max(0, index)];
}

export type R2AggregateMetrics = {
  totalRuns: number;
  scoredRuns: number;
  blockedRuns: number;
  architecture: {
    objectiveDetectionCorrectRate: number | null;
    requirementResolutionCorrectRate: number | null;
    requiredObjectiveCompletionRate: number | null;
    workGraphCorrectRate: number | null;
    durableRemainingWorkCorrectRate: number | null;
    /** The central metric - target 0. See scoring.ts#isObjectiveDurablyRepresented. */
    lostCommercialWorkRate: number | null;
    duplicateSideEffectRate: number | null;
    unbackedCommercialMutationClaimRate: number | null;
    staleEvidenceExecutionRate: number | null;
    retryRecoveryRate: number | null;
    restartRecoveryRate: number | null;
  };
  customerVisible: {
    customerReaskRate: number | null;
    customerVisibleCorrectRate: number | null;
    safetyFailureRate: number | null;
  };
  efficiency: {
    llmCallsPerTurnAvg: number | null;
    llmCallsPerCompletedObjectiveAvg: number | null;
    capabilityExecutionsPerTurnAvg: number | null;
    turnLatencyMsP50: number | null;
    turnLatencyMsP95: number | null;
    commercialCompletionLatencyMsP50: number | null;
    commercialCompletionLatencyMsP95: number | null;
  };
};

/**
 * SALES-AGENT-R2-A07.5. Pure aggregation over already-scored runs - mirrors
 * lib/brain/commercial/agent-loop/benchmark/metrics.ts's own discipline
 * (every rate null, never 0, when its denominator is empty) but is a
 * separate module on purpose: this scores CommercialWork architecture
 * properties, the legacy module scores Agent Tool Loop transcripts, and the
 * two must never be conflated into one number.
 */
export function computeR2AggregateMetrics(results: R2ScenarioRunResult[]): R2AggregateMetrics {
  const totalRuns = results.length;
  const blockedRuns = results.filter((result) => result.score.blocked).length;
  const scored = results.filter((result) => !result.score.blocked);
  const scoredRuns = scored.length;

  const totalLostObjectives = scored.reduce((sum, result) => sum + result.score.lostObjectiveCount, 0);
  const totalObjectives = scored.reduce((sum, result) => sum + result.score.totalObjectiveCount, 0);

  const retryApplicable = scored.filter((result) => result.score.retryRecovered !== null);
  const restartApplicable = scored.filter((result) => result.score.restartRecovered !== null);

  const completedObjectiveCounts = scored.map((result) => result.outcome.finalWork?.objectives.filter((objective) => objective.status === "COMPLETED").length ?? 0);
  const totalCompletedObjectives = completedObjectiveCounts.reduce((sum, value) => sum + value, 0);

  const turnLatencies = results.map((result) => result.outcome.turnLatencyMs).sort((a, b) => a - b);
  const completionLatencies = results
    .map((result) => result.outcome.commercialCompletionLatencyMs)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);

  return {
    totalRuns,
    scoredRuns,
    blockedRuns,
    architecture: {
      objectiveDetectionCorrectRate: rate(scored.filter((result) => result.score.objectiveDetectionCorrect).length, scoredRuns),
      requirementResolutionCorrectRate: rate(scored.filter((result) => result.score.requirementResolutionCorrect).length, scoredRuns),
      requiredObjectiveCompletionRate: rate(scored.filter((result) => result.score.requiredObjectivesCompleted).length, scoredRuns),
      workGraphCorrectRate: rate(scored.filter((result) => result.score.workGraphCorrect).length, scoredRuns),
      durableRemainingWorkCorrectRate: rate(scored.filter((result) => result.score.durableRemainingWorkCorrect).length, scoredRuns),
      lostCommercialWorkRate: rate(totalLostObjectives, totalObjectives),
      duplicateSideEffectRate: rate(scored.filter((result) => result.score.duplicateSideEffect).length, scoredRuns),
      unbackedCommercialMutationClaimRate: rate(scored.filter((result) => result.score.unbackedMutationClaim).length, scoredRuns),
      staleEvidenceExecutionRate: rate(scored.filter((result) => result.score.staleEvidenceExecuted).length, scoredRuns),
      retryRecoveryRate: rate(retryApplicable.filter((result) => result.score.retryRecovered).length, retryApplicable.length),
      restartRecoveryRate: rate(restartApplicable.filter((result) => result.score.restartRecovered).length, restartApplicable.length)
    },
    customerVisible: {
      customerReaskRate: rate(scored.filter((result) => result.score.customerReasked).length, scoredRuns),
      customerVisibleCorrectRate: rate(scored.filter((result) => result.score.customerVisibleOutcome === "correct").length, scoredRuns),
      safetyFailureRate: rate(scored.filter((result) => result.score.safetyFailure).length, scoredRuns)
    },
    efficiency: {
      llmCallsPerTurnAvg: average(results.map((result) => result.outcome.llmCallCount)),
      llmCallsPerCompletedObjectiveAvg: totalCompletedObjectives > 0 ? results.reduce((sum, result) => sum + result.outcome.llmCallCount, 0) / totalCompletedObjectives : null,
      capabilityExecutionsPerTurnAvg: average(results.map((result) => result.outcome.capabilityCalls.length)),
      turnLatencyMsP50: percentile(turnLatencies, 50),
      turnLatencyMsP95: percentile(turnLatencies, 95),
      commercialCompletionLatencyMsP50: percentile(completionLatencies, 50),
      commercialCompletionLatencyMsP95: percentile(completionLatencies, 95)
    }
  };
}

/** Separate from R2AggregateMetrics since not every scenario schedules a follow-up - named export so the deliverable doc's A07 evidence section can slice on it directly. */
export function computeFollowUpCorrectRate(results: R2ScenarioRunResult[]): number | null {
  const applicable = results.filter((result) => result.score.followUpCorrect !== null);
  return rate(applicable.filter((result) => result.score.followUpCorrect).length, applicable.length);
}
