import { computeGoldenAggregateMetrics, GOLDEN_BASELINE_THRESHOLDS } from "./metrics";
import type { GoldenAggregateMetrics } from "./metrics";
import type { GoldenCaseScore, GoldenRunResult, GoldenRunSummary } from "./types";

/**
 * R3 Stable Agent Acceptance Harness V1, sections 7/8/11. Builds the JSON/MD
 * artifact pair. Never includes provider endpoints/API keys - only the model
 * name (already the only provider field runGoldenSuite.ts's own model string
 * carries), same discipline the legacy liveProvider.ts already established
 * ("No guardar API key").
 */

export type GoldenReport = {
  generatedAt: string;
  mode: GoldenRunSummary["mode"];
  model: string | null;
  runsPerCase: number;
  aggregateMetrics: GoldenAggregateMetrics;
  thresholds: typeof GOLDEN_BASELINE_THRESHOLDS;
  perCaseRuns: Array<{
    caseId: string;
    category: GoldenRunResult["category"];
    runIndex: number;
    overallPass: boolean;
    expectedAction: GoldenCaseScore["expectedAction"];
    actualAction: GoldenCaseScore["actualAction"];
    expectedTool: GoldenCaseScore["expectedTool"];
    actualTool: GoldenCaseScore["actualTool"];
    terminalReason: GoldenCaseScore["terminalReason"];
    toolExecutionCount: number;
    decisionCount: number;
    llmCallCount: number;
    falseCommercialConfirmation: boolean;
    dimensions: GoldenCaseScore["dimensions"];
    failureReason: string | null;
  }>;
};

export function buildGoldenReport(summary: GoldenRunSummary): GoldenReport {
  return {
    generatedAt: new Date().toISOString(),
    mode: summary.mode,
    model: summary.model,
    runsPerCase: summary.runsPerCase,
    aggregateMetrics: computeGoldenAggregateMetrics(summary.results),
    thresholds: GOLDEN_BASELINE_THRESHOLDS,
    perCaseRuns: summary.results.map((result) => ({
      caseId: result.score.caseId,
      category: result.category,
      runIndex: result.runIndex,
      overallPass: result.score.overallPass,
      expectedAction: result.score.expectedAction,
      actualAction: result.score.actualAction,
      expectedTool: result.score.expectedTool,
      actualTool: result.score.actualTool,
      terminalReason: result.score.terminalReason,
      toolExecutionCount: result.score.toolExecutionCount,
      decisionCount: result.score.decisionCount,
      llmCallCount: result.score.llmCallCount,
      falseCommercialConfirmation: result.score.falseCommercialConfirmation,
      dimensions: result.score.dimensions,
      failureReason: result.score.failureReason
    }))
  };
}

/** Per-case pass frequency across N repeated runs (task section 7: "report per-case pass frequency"). */
export function computePassFrequencyByCase(report: GoldenReport): Array<{ caseId: string; passCount: number; totalRuns: number; passRate: number }> {
  const byCase = new Map<string, { passCount: number; totalRuns: number }>();
  for (const run of report.perCaseRuns) {
    const bucket = byCase.get(run.caseId) ?? { passCount: 0, totalRuns: 0 };
    bucket.totalRuns += 1;
    if (run.overallPass) bucket.passCount += 1;
    byCase.set(run.caseId, bucket);
  }
  return [...byCase.entries()].map(([caseId, bucket]) => ({ caseId, ...bucket, passRate: bucket.totalRuns === 0 ? 0 : bucket.passCount / bucket.totalRuns }));
}

function formatPercent(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function formatThresholdCheck(value: number | null, threshold: number | null): string {
  if (threshold === null) return `${formatPercent(value)} (no target specified)`;
  if (value === null) return `n/a (target ${formatPercent(threshold)})`;
  return `${formatPercent(value)} ${value >= threshold ? "PASS" : "BELOW TARGET"} (target ${formatPercent(threshold)})`;
}

export function renderGoldenReportMarkdown(report: GoldenReport): string {
  const failedRuns = report.perCaseRuns.filter((run) => !run.overallPass);
  const falseConfirmations = report.perCaseRuns.filter((run) => run.falseCommercialConfirmation);
  const passFrequency = computePassFrequencyByCase(report);

  return [
    `# R3 Stable Agent Acceptance Harness V1 - Benchmark Result`,
    ``,
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `Model: ${report.model ?? "n/a"}`,
    `Runs per case: ${report.runsPerCase}`,
    `Total runs: ${report.aggregateMetrics.totalRuns}`,
    ``,
    `## Baseline metrics vs. acceptance targets`,
    ``,
    `- No-tool correctness: ${formatThresholdCheck(report.aggregateMetrics.baseline.noToolCorrectness, report.thresholds.noToolCorrectness)}`,
    `- Simple tool selection: ${formatThresholdCheck(report.aggregateMetrics.baseline.simpleToolSelection, report.thresholds.simpleToolSelection)}`,
    `- Boundary tool selection: ${formatThresholdCheck(report.aggregateMetrics.baseline.boundaryToolSelection, report.thresholds.boundaryToolSelection)}`,
    `- Argument structure validity: ${formatThresholdCheck(report.aggregateMetrics.baseline.argumentStructureValidity, report.thresholds.argumentStructureValidity)}`,
    `- Argument semantic correctness: ${formatThresholdCheck(report.aggregateMetrics.baseline.argumentSemanticCorrectness, report.thresholds.argumentSemanticCorrectness)}`,
    `- Observation/replan correctness: ${formatThresholdCheck(report.aggregateMetrics.baseline.observationReplanCorrectness, report.thresholds.observationReplanCorrectness)}`,
    `- Mutation grounding: ${formatThresholdCheck(report.aggregateMetrics.baseline.mutationGrounding, report.thresholds.mutationGrounding)}`,
    `- Task completion: ${formatThresholdCheck(report.aggregateMetrics.baseline.taskCompletion, report.thresholds.taskCompletion)}`,
    `- FALSE_COMMERCIAL_CONFIRMATION_COUNT: ${report.aggregateMetrics.falseCommercialConfirmationCount} ${report.aggregateMetrics.falseCommercialConfirmationCount === 0 ? "PASS (target 0)" : "ZERO-TOLERANCE VIOLATION (target 0)"}`,
    ``,
    `## Overall`,
    ``,
    `Overall pass rate: ${formatPercent(report.aggregateMetrics.overallPassRate)} (${report.aggregateMetrics.totalRuns} runs)`,
    ``,
    `## Per-category`,
    ``,
    ...Object.values(report.aggregateMetrics.byCategory).map((category) => `- ${category.category}: overallPassRate=${formatPercent(category.overallPassRate)} (${category.totalRuns} runs)`),
    ``,
    `## Per-case pass frequency`,
    ``,
    ...passFrequency.map((entry) => `- ${entry.caseId}: ${entry.passCount}/${entry.totalRuns} (${formatPercent(entry.passRate)})`),
    ``,
    `## False commercial confirmations (${falseConfirmations.length})`,
    ``,
    ...(falseConfirmations.length === 0
      ? ["(none)"]
      : falseConfirmations.map((run) => `- ${run.caseId} run ${run.runIndex + 1}: ${run.failureReason ?? "flagged"}`)),
    ``,
    `## Failing runs (${failedRuns.length})`,
    ``,
    ...(failedRuns.length === 0
      ? ["(none)"]
      : failedRuns.map(
          (run) =>
            `- ${run.caseId} run ${run.runIndex + 1} [${run.category}]: expectedAction=${run.expectedAction ?? "n/a"} actualAction=${run.actualAction ?? "n/a"} expectedTool=${run.expectedTool ?? "n/a"} actualTool=${run.actualTool ?? "n/a"} terminalReason=${run.terminalReason ?? "n/a"} - ${run.failureReason ?? "no reason recorded"}`
        )),
    ``
  ].join("\n");
}
