import type { BenchmarkProviderCallRecord, BenchmarkTurnResult } from "./types";

function percentile(sortedAscending: number[], p: number): number | null {
  if (sortedAscending.length === 0) return null;
  const index = Math.min(sortedAscending.length - 1, Math.ceil((p / 100) * sortedAscending.length) - 1);
  return sortedAscending[Math.max(0, index)];
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rate(count: number, total: number): number | null {
  if (total === 0) return null;
  return count / total;
}

function classifyFinishReason(finishReason: string | null): "stop" | "length" | "other" | "null_unknown" {
  if (finishReason === null) return "null_unknown";
  if (finishReason === "stop") return "stop";
  if (finishReason === "length") return "length";
  return "other";
}

const GRACEFUL_TERMINAL_REASONS = new Set(["responded", "handoff"]);

export type BenchmarkAggregateMetrics = {
  totalRuns: number;
  totalProviderCalls: number;
  correctness: {
    requiredToolCompletionRate: number | null;
    forbiddenToolInvocationRate: number | null;
    toolArgumentAccuracy: number | null;
    terminalReasonCorrectness: number | null;
    overallPassRate: number | null;
  };
  structuralRobustness: {
    validAgentStepRate: number | null;
    invalidResponseRate: number | null;
    emptyResponseRate: number | null;
    invalidModelJsonRate: number | null;
    invalidJsonEnvelopeRate: number | null;
    structuredRecoveryActivationRate: number | null;
    structuredRecoverySuccessRate: number | null;
    schemaRepairActivationRate: number | null;
    schemaRepairSuccessRate: number | null;
  };
  latency: {
    llmCallsPerTurnAvg: number | null;
    llmCallsPerTurnMax: number | null;
    llmCallLatencyMsP50: number | null;
    llmCallLatencyMsP95: number | null;
    completeTurnLatencyMsP50: number | null;
    completeTurnLatencyMsP95: number | null;
    llmTotalMsPerCompletedTurnAvg: number | null;
  };
  tokens: {
    inputTokensPerCallAvg: number | null;
    outputTokensPerCallAvg: number | null;
    inputTokensPerCompletedTurnAvg: number | null;
    outputTokensPerCompletedTurnAvg: number | null;
    /** false whenever at least one provider call is missing token usage - same T02 discipline: never silently treat a partial average as complete. */
    usageComplete: boolean;
  };
  /** Counts, not rates - the report divides by totalProviderCalls itself so partial corpora stay legible. */
  finishReasonCounts: { stop: number; length: number; other: number; null_unknown: number };
};

/**
 * LLM-R1-T05, Part B. Pure aggregation over already-produced results - never
 * re-runs anything, never re-classifies a provider outcome (reuses exactly
 * what instrumentedProvider.ts/scoring.ts already recorded). Every rate is
 * `null` (never an invented 0) when its denominator is zero, so an empty or
 * partial run is never misreported as "0% failure".
 */
export function computeAggregateMetrics(results: BenchmarkTurnResult[]): BenchmarkAggregateMetrics {
  const allCalls: BenchmarkProviderCallRecord[] = results.flatMap((result) => result.providerCalls);
  const totalRuns = results.length;
  const totalProviderCalls = allCalls.length;

  const requiredToolCompletionRate = rate(results.filter((result) => result.score.requiredToolsCompleted).length, totalRuns);
  const forbiddenToolInvocationRate = rate(results.filter((result) => result.score.forbiddenToolInvoked).length, totalRuns);
  const toolArgumentAccuracy = rate(results.filter((result) => result.score.toolArgumentsCorrect).length, totalRuns);
  const terminalReasonCorrectness = rate(results.filter((result) => result.score.terminalReasonCorrect).length, totalRuns);
  const overallPassRate = rate(results.filter((result) => result.score.overallPass).length, totalRuns);

  const validAgentStepRate = rate(allCalls.filter((call) => call.outcome === "success").length, totalProviderCalls);
  const invalidResponseRate = rate(allCalls.filter((call) => call.outcome === "invalid_response").length, totalProviderCalls);
  const emptyResponseRate = rate(allCalls.filter((call) => call.errorCode === "empty_response").length, totalProviderCalls);
  const invalidModelJsonRate = rate(allCalls.filter((call) => call.errorCode === "invalid_model_json").length, totalProviderCalls);
  const invalidJsonEnvelopeRate = rate(allCalls.filter((call) => call.errorCode === "invalid_json_response").length, totalProviderCalls);

  const structuredRecoveryRuns = results.filter((result) => result.loop.warnings.some((warning) => warning.startsWith("agent_loop_structured_recovery_attempted")));
  const structuredRecoveryActivationRate = rate(structuredRecoveryRuns.length, totalRuns);
  const structuredRecoverySuccessRate = rate(structuredRecoveryRuns.filter((result) => GRACEFUL_TERMINAL_REASONS.has(result.loop.terminalReason)).length, structuredRecoveryRuns.length);

  const schemaRepairRuns = results.filter((result) => result.loop.warnings.some((warning) => warning.startsWith("agent_step_invalid:")));
  const schemaRepairActivationRate = rate(schemaRepairRuns.length, totalRuns);
  const schemaRepairSuccessRate = rate(schemaRepairRuns.filter((result) => GRACEFUL_TERMINAL_REASONS.has(result.loop.terminalReason)).length, schemaRepairRuns.length);

  const llmCallCounts = results.map((result) => result.providerCalls.length);
  const callLatencies = allCalls.map((call) => call.elapsedMs).sort((a, b) => a - b);
  const turnLatencies = results.map((result) => result.totalElapsedMs).sort((a, b) => a - b);
  const completedTurns = results.filter((result) => result.loop.terminalReason === "responded");
  const llmTotalMsPerCompletedTurnAvg = average(completedTurns.map((result) => result.providerCalls.reduce((sum, call) => sum + call.elapsedMs, 0)));

  const inputTokenValues = allCalls.map((call) => call.inputTokens).filter((value): value is number => value !== null);
  const outputTokenValues = allCalls.map((call) => call.outputTokens).filter((value): value is number => value !== null);
  const usageComplete = allCalls.length > 0 && allCalls.every((call) => call.inputTokens !== null && call.outputTokens !== null);
  const completedTurnInputTokens = completedTurns
    .map((result) => (result.providerCalls.every((call) => call.inputTokens !== null) ? result.providerCalls.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0) : null))
    .filter((value): value is number => value !== null);
  const completedTurnOutputTokens = completedTurns
    .map((result) => (result.providerCalls.every((call) => call.outputTokens !== null) ? result.providerCalls.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0) : null))
    .filter((value): value is number => value !== null);

  const finishReasonCounts = { stop: 0, length: 0, other: 0, null_unknown: 0 };
  for (const call of allCalls) {
    finishReasonCounts[classifyFinishReason(call.finishReason)] += 1;
  }

  return {
    totalRuns,
    totalProviderCalls,
    correctness: { requiredToolCompletionRate, forbiddenToolInvocationRate, toolArgumentAccuracy, terminalReasonCorrectness, overallPassRate },
    structuralRobustness: {
      validAgentStepRate,
      invalidResponseRate,
      emptyResponseRate,
      invalidModelJsonRate,
      invalidJsonEnvelopeRate,
      structuredRecoveryActivationRate,
      structuredRecoverySuccessRate,
      schemaRepairActivationRate,
      schemaRepairSuccessRate
    },
    latency: {
      llmCallsPerTurnAvg: average(llmCallCounts),
      llmCallsPerTurnMax: llmCallCounts.length > 0 ? Math.max(...llmCallCounts) : null,
      llmCallLatencyMsP50: percentile(callLatencies, 50),
      llmCallLatencyMsP95: percentile(callLatencies, 95),
      completeTurnLatencyMsP50: percentile(turnLatencies, 50),
      completeTurnLatencyMsP95: percentile(turnLatencies, 95),
      llmTotalMsPerCompletedTurnAvg
    },
    tokens: {
      inputTokensPerCallAvg: average(inputTokenValues),
      outputTokensPerCallAvg: average(outputTokenValues),
      inputTokensPerCompletedTurnAvg: average(completedTurnInputTokens),
      outputTokensPerCompletedTurnAvg: average(completedTurnOutputTokens),
      usageComplete
    },
    finishReasonCounts
  };
}

/** Per-case breakdown - same shape, one aggregate per caseId, for the "C01 -> N calls" style analysis Part E asks for. */
export function computeMetricsByCase(results: BenchmarkTurnResult[]): Map<string, BenchmarkAggregateMetrics> {
  const byCase = new Map<string, BenchmarkTurnResult[]>();
  for (const result of results) {
    const bucket = byCase.get(result.caseId) ?? [];
    bucket.push(result);
    byCase.set(result.caseId, bucket);
  }
  return new Map([...byCase.entries()].map(([caseId, caseResults]) => [caseId, computeAggregateMetrics(caseResults)]));
}
