import assert from "node:assert/strict";
import test from "node:test";
import { computeGoldenAggregateMetrics, GOLDEN_BASELINE_THRESHOLDS } from "@/lib/brain/commercial/agent-loop/benchmark/r3StableAgentV1/metrics";
import type { GoldenCaseCategory, GoldenCaseScore, GoldenDimension, GoldenRunResult, GoldenScoreValue } from "@/lib/brain/commercial/agent-loop/benchmark/r3StableAgentV1/types";

/** R3 Stable Agent Acceptance Harness V1, task section 10 item 7: aggregation math. */

function fakeScore(
  overrides: Partial<Omit<GoldenCaseScore, "dimensions">> & { category: GoldenCaseCategory; dimensions?: Partial<Record<GoldenDimension, GoldenScoreValue>> }
): GoldenCaseScore {
  const dimensions: Record<GoldenDimension, GoldenScoreValue> = {
    actionTypePass: "PASS",
    toolSelectionPass: "PASS",
    argumentStructurePass: "PASS",
    argumentSemanticsPass: "NOT_APPLICABLE",
    evidenceGroundingPass: "PASS",
    observationReplanPass: "NOT_APPLICABLE",
    mutationGroundingPass: "PASS",
    taskCompletionPass: "PASS",
    ...overrides.dimensions
  };
  return {
    caseId: "X",
    runIndex: 0,
    expectedAction: null,
    actualAction: null,
    expectedTool: null,
    actualTool: null,
    terminalReason: "responded",
    toolExecutionCount: 0,
    decisionCount: 1,
    llmCallCount: 1,
    falseCommercialConfirmation: false,
    overallPass: true,
    failureReason: null,
    ...overrides,
    dimensions
  };
}

/**
 * A minimal test double - computeGoldenAggregateMetrics only ever reads
 * `.score` off a GoldenRunResult, so only that field needs to be real; the
 * rest of the discriminated union's shape is irrelevant to this test file.
 */
function fakeResult(score: GoldenCaseScore): GoldenRunResult {
  return {
    caseId: score.caseId,
    category: score.category,
    runIndex: score.runIndex,
    mode: "decision",
    nextStep: null,
    invalidOutputReason: null,
    elapsedMs: 1,
    inputTokens: null,
    outputTokens: null,
    score
  } as unknown as GoldenRunResult;
}

test("[R3-HARNESS-V1] overallPassRate is the fraction of overallPass=true results", () => {
  const results = [
    fakeResult(fakeScore({ category: "NO_TOOL", overallPass: true })),
    fakeResult(fakeScore({ category: "NO_TOOL", overallPass: true })),
    fakeResult(fakeScore({ category: "NO_TOOL", overallPass: false }))
  ];
  const metrics = computeGoldenAggregateMetrics(results);
  assert.equal(metrics.totalRuns, 3);
  assert.ok(metrics.overallPassRate !== null && Math.abs(metrics.overallPassRate - 2 / 3) < 1e-9);
});

test("[R3-HARNESS-V1] an empty result set never reports an invented 0 rate", () => {
  const metrics = computeGoldenAggregateMetrics([]);
  assert.equal(metrics.overallPassRate, null);
  assert.equal(metrics.totalRuns, 0);
  assert.equal(metrics.byCategory.NO_TOOL.overallPassRate, null);
});

test("[R3-HARNESS-V1] baseline.simpleToolSelection reads SIMPLE_TOOL_SELECTION's toolSelectionPass rate only", () => {
  const results = [
    fakeResult(fakeScore({ category: "SIMPLE_TOOL_SELECTION", dimensions: { toolSelectionPass: "PASS" } })),
    fakeResult(fakeScore({ category: "SIMPLE_TOOL_SELECTION", dimensions: { toolSelectionPass: "FAIL" } })),
    // A different category's toolSelectionPass must never leak into this baseline metric.
    fakeResult(fakeScore({ category: "TOOL_BOUNDARY", dimensions: { toolSelectionPass: "FAIL" } }))
  ];
  const metrics = computeGoldenAggregateMetrics(results);
  assert.ok(metrics.baseline.simpleToolSelection !== null && Math.abs(metrics.baseline.simpleToolSelection - 0.5) < 1e-9);
});

test("[R3-HARNESS-V1] falseCommercialConfirmationCount counts across every category, not only COMMERCIAL_MUTATION", () => {
  const results = [
    fakeResult(fakeScore({ category: "NO_TOOL", falseCommercialConfirmation: true })),
    fakeResult(fakeScore({ category: "COMMERCIAL_MUTATION", falseCommercialConfirmation: true })),
    fakeResult(fakeScore({ category: "COMMERCIAL_MUTATION", falseCommercialConfirmation: false }))
  ];
  const metrics = computeGoldenAggregateMetrics(results);
  assert.equal(metrics.falseCommercialConfirmationCount, 2);
});

test("[R3-HARNESS-V1] GOLDEN_BASELINE_THRESHOLDS mirrors the task's own section 8 targets", () => {
  assert.equal(GOLDEN_BASELINE_THRESHOLDS.noToolCorrectness, 0.95);
  assert.equal(GOLDEN_BASELINE_THRESHOLDS.simpleToolSelection, 0.9);
  assert.equal(GOLDEN_BASELINE_THRESHOLDS.boundaryToolSelection, 0.8);
  assert.equal(GOLDEN_BASELINE_THRESHOLDS.argumentStructureValidity, 0.95);
  assert.equal(GOLDEN_BASELINE_THRESHOLDS.observationReplanCorrectness, 0.85);
  assert.equal(GOLDEN_BASELINE_THRESHOLDS.mutationGrounding, 1);
});
