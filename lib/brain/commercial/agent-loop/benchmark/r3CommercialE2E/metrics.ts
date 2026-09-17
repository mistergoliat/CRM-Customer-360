import { caseHasGreetingRepetition, turnHasUngroundedMutationClaim, turnHasUngroundedQuoteClaim } from "./conversationalSignals";
import type {
  BenchmarkE2ECommercialProgressionMetrics,
  BenchmarkE2EConversationalMetrics,
  BenchmarkE2EEligibilityCoherenceMetrics,
  BenchmarkE2ERunTrace,
  BenchmarkE2ESummaryMetrics,
  BenchmarkE2EToolBehaviorMetrics,
  BenchmarkE2EToolInvocationTrace,
  BenchmarkE2ETurnTrace
} from "./types";

/**
 * SALES-AGENT-R3-P7.4 (Sections "METRICS - CORE" / "METRICS -
 * CONVERSATIONAL" / "SUMMARY METRICS" / "BACKWARD COMPARISON"). Pure
 * aggregation only - no IO, no scoring/classification logic (that lives in
 * scoreCase.ts/failureClassification.ts, already applied before these traces
 * reach this module). Every rate is null (never a fabricated 0) when its
 * denominator is 0 - "no ocultar fallos detrás de promedio único" cuts both
 * ways: an undefined rate must never silently read as a good rate.
 */

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function allToolInvocations(runs: readonly BenchmarkE2ERunTrace[]): BenchmarkE2EToolInvocationTrace[] {
  return runs.flatMap((run) => run.turns.flatMap((turn) => turn.toolInvocations));
}

function allTurns(runs: readonly BenchmarkE2ERunTrace[]): BenchmarkE2ETurnTrace[] {
  return runs.flatMap((run) => run.turns);
}

function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[index];
}

function computeCommercialProgression(runs: readonly BenchmarkE2ERunTrace[]): BenchmarkE2ECommercialProgressionMetrics {
  const turns = allTurns(runs);
  const completedByCapability = (capability: string) => turns.filter((turn) => turn.toolInvocations.some((invocation) => invocation.capability === capability && invocation.toolObservation.status === "completed")).length;
  return {
    objectiveStarted: turns.filter((turn) => turn.objectiveReconciliation.decided?.decisionAction === "START").length,
    objectivePreserved: turns.filter((turn) => turn.objectiveReconciliation.decided?.decisionAction === "CONTINUE").length,
    objectiveReplacedCorrectly: turns.filter((turn) => turn.objectiveReconciliation.decided?.decisionAction === "REPLACE" && turn.objectiveReconciliation.reconciled !== null).length,
    selectionCreated: completedByCapability("select_products"),
    destinationCreated: completedByCapability("set_shipping_destination"),
    shippingCalculated: completedByCapability("calculate_shipping"),
    quoteCreated: completedByCapability("create_quote"),
    quoteRetrieved: completedByCapability("get_quote"),
    finalCommercialOutcomeQuoteExists: runs.filter((run) => run.finalState?.quote.present === true).length
  };
}

function computeToolBehavior(runs: readonly BenchmarkE2ERunTrace[]): BenchmarkE2EToolBehaviorMetrics {
  const invocations = allToolInvocations(runs);
  return {
    requestedCapabilities: invocations.length,
    gatewayCompleted: invocations.filter((invocation) => invocation.gateway?.status === "completed").length,
    gatewayRejected: invocations.filter((invocation) => invocation.gateway !== null && invocation.gateway.status !== "completed").length,
    invalidArguments: invocations.filter((invocation) => invocation.gateway?.status === "invalid_arguments").length,
    duplicateCalls: invocations.filter((invocation) => invocation.toolObservation.errorCode === "duplicate_tool_call").length,
    blockedAtTurnStartRequests: invocations.filter((invocation) => invocation.eligibilityAtTurnStart?.status === "BLOCKED").length,
    blockedThenRelevantEvidence: invocations.filter((invocation) => invocation.eligibilityAtTurnStart?.status === "BLOCKED" && invocation.inTurnEvidence.blockerPotentiallyChanged).length,
    blockedWithoutRelevantEvidence: invocations.filter((invocation) => invocation.eligibilityAtTurnStart?.status === "BLOCKED" && !invocation.inTurnEvidence.blockerPotentiallyChanged).length
  };
}

function computeEligibilityCoherence(runs: readonly BenchmarkE2ERunTrace[]): BenchmarkE2EEligibilityCoherenceMetrics {
  const invocations = allToolInvocations(runs);
  const completed = (invocation: BenchmarkE2EToolInvocationTrace) => invocation.toolObservation.status === "completed";
  return {
    eligibleThenCompleted: invocations.filter((invocation) => invocation.eligibilityAtTurnStart?.status === "ELIGIBLE" && completed(invocation)).length,
    eligibleThenRejected: invocations.filter((invocation) => invocation.eligibilityAtTurnStart?.status === "ELIGIBLE" && !completed(invocation)).length,
    blockedThenCompleted: invocations.filter((invocation) => invocation.eligibilityAtTurnStart?.status === "BLOCKED" && completed(invocation)).length,
    blockedThenRejected: invocations.filter((invocation) => invocation.eligibilityAtTurnStart?.status === "BLOCKED" && !completed(invocation)).length
  };
}

function computeConversational(runs: readonly BenchmarkE2ERunTrace[]): BenchmarkE2EConversationalMetrics {
  const turns = allTurns(runs);
  return {
    // Only counted for cases that opted in - forbiddenViolations already encodes that gate (scoreCase.ts).
    unnecessaryRequestionCount: runs.reduce((total, run) => total + (run.outcome.forbiddenViolations.filter((violation) => violation === "repeatKnownDestination" || violation === "repeatKnownSelection").length), 0),
    greetingRepetitionCount: runs.filter((run) => caseHasGreetingRepetition(run.turns)).length,
    ungroundedQuoteClaimCount: turns.filter(turnHasUngroundedQuoteClaim).length,
    ungroundedMutationClaimCount: turns.filter(turnHasUngroundedMutationClaim).length,
    responseAfterSuccessfulToolCount: turns.filter((turn) => turn.toolInvocations.some((invocation) => invocation.toolObservation.status === "completed") && turn.response.finalMessage !== null).length
  };
}

export function computeBenchmarkE2ESummaryMetrics(runs: readonly BenchmarkE2ERunTrace[]): BenchmarkE2ESummaryMetrics {
  const totalRuns = runs.length;
  const completedRuns = runs.filter((run) => run.outcome.status !== "ENVIRONMENT_BLOCKED");
  const invocations = allToolInvocations(completedRuns);
  const outboxAttemptedRuns = completedRuns.filter((run) => run.turns.some((turn) => turn.outbox.attempted));
  const outboxWrittenRuns = outboxAttemptedRuns.filter((run) => run.turns.some((turn) => turn.outbox.outboxWritten));
  const quoteEligibleRuns = completedRuns.filter((run) => run.turns.some((turn) => turn.toolInvocations.some((invocation) => invocation.capability === "create_quote")));

  const toolBehavior = computeToolBehavior(completedRuns);
  const eligibilityCoherence = computeEligibilityCoherence(completedRuns);

  const terminalReasonDistribution: Record<string, number> = {};
  for (const turn of allTurns(completedRuns)) {
    terminalReasonDistribution[turn.response.terminalReason] = (terminalReasonDistribution[turn.response.terminalReason] ?? 0) + 1;
  }

  const toolCallsPerRun = completedRuns.map((run) => run.turns.reduce((total, turn) => total + turn.toolInvocations.length, 0));
  const decisionsPerRun = completedRuns.map((run) => run.turns.reduce((total, turn) => total + turn.toolInvocations.length + (turn.response.finalMessage !== null ? 1 : 0), 0)).sort((left, right) => left - right);

  return {
    runCompletionRate: totalRuns > 0 ? completedRuns.length / totalRuns : 0,
    commercialOutcomeCompletionRate: rate(completedRuns.filter((run) => run.finalState?.quote.present === true || run.finalState?.selection.present === true).length, completedRuns.length),
    correctObjectiveBehaviorRate: rate(completedRuns.filter((run) => run.outcome.expectationResults.finalObjectiveType !== false).length, completedRuns.length),
    correctToolSelectionRate: rate(completedRuns.filter((run) => run.outcome.expectationResults.requiredToolsAnyTurn !== false && run.outcome.expectationResults.forbiddenToolsAnyTurn !== false).length, completedRuns.length),
    validArgumentsRate: rate(invocations.length - toolBehavior.invalidArguments, invocations.length),
    gatewayCompletionRate: rate(toolBehavior.gatewayCompleted, invocations.length),
    gatewayRejectionRate: rate(toolBehavior.gatewayRejected, invocations.length),
    unnecessaryRequestionRate: rate(computeConversational(completedRuns).unnecessaryRequestionCount, completedRuns.length),
    duplicateToolCallRate: rate(toolBehavior.duplicateCalls, invocations.length),
    ungroundedMutationClaimRate: rate(computeConversational(completedRuns).ungroundedMutationClaimCount, completedRuns.length),
    quoteConversionRate: rate(completedRuns.filter((run) => run.finalState?.quote.present === true).length, quoteEligibleRuns.length),
    outboxCompletionRate: rate(outboxWrittenRuns.length, outboxAttemptedRuns.length),
    blockedRequestCoherenceRate: rate(toolBehavior.blockedThenRelevantEvidence, toolBehavior.blockedAtTurnStartRequests),
    averageToolCallsPerRun: toolCallsPerRun.length > 0 ? toolCallsPerRun.reduce((total, count) => total + count, 0) / toolCallsPerRun.length : null,
    p50DecisionsPerRun: percentile(decisionsPerRun, 0.5),
    p95DecisionsPerRun: percentile(decisionsPerRun, 0.95),
    terminalReasonDistribution,
    commercialProgression: computeCommercialProgression(completedRuns),
    toolBehavior,
    eligibilityCoherence,
    conversational: computeConversational(completedRuns),
    legacy: {
      // LEGACY METRIC placeholders (Section "BACKWARD COMPARISON") - this
      // harness does not itself run the ATL-level r3StableAgentV1 corpus, so
      // these stay null here; a caller comparing against that harness's own
      // report.ts output does the join, never a fabricated recomputation.
      simpleToolSelectionPassRate: null,
      argumentValidityPassRate: null,
      mutationGroundingPassRate: null
    }
  };
}
