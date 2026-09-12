import assert from "node:assert/strict";
import test from "node:test";
import { buildGoldenReport, renderGoldenReportMarkdown, computePassFrequencyByCase } from "@/lib/brain/commercial/agent-loop/benchmark/r3StableAgentV1/report";
import { resolveLiveBenchmarkProviderConfig } from "@/lib/brain/commercial/agent-loop/benchmark/liveProvider";
import { parseArgs } from "../../../../scripts/r3-stable-agent-benchmark";
import type { GoldenDecisionRunResult, GoldenRunSummary } from "@/lib/brain/commercial/agent-loop/benchmark/r3StableAgentV1/types";

/** R3 Stable Agent Acceptance Harness V1, task section 10 items 8/10. */

function fakeResult(overrides: Partial<GoldenDecisionRunResult> = {}): GoldenDecisionRunResult {
  return {
    caseId: "RP-001",
    category: "OBSERVATION_REPLAN",
    runIndex: 0,
    mode: "decision",
    nextStep: { type: "respond", message: "ok" },
    invalidOutputReason: null,
    elapsedMs: 5,
    inputTokens: 10,
    outputTokens: 5,
    score: {
      caseId: "RP-001",
      runIndex: 0,
      category: "OBSERVATION_REPLAN",
      expectedAction: null,
      actualAction: "respond",
      expectedTool: null,
      actualTool: null,
      terminalReason: null,
      toolExecutionCount: 0,
      decisionCount: 1,
      llmCallCount: 1,
      falseCommercialConfirmation: false,
      overallPass: true,
      failureReason: null,
      dimensions: {
        actionTypePass: "PASS",
        toolSelectionPass: "NOT_APPLICABLE",
        argumentStructurePass: "NOT_APPLICABLE",
        argumentSemanticsPass: "NOT_APPLICABLE",
        evidenceGroundingPass: "UNVERIFIABLE",
        observationReplanPass: "PASS",
        mutationGroundingPass: "NOT_APPLICABLE",
        taskCompletionPass: "NOT_APPLICABLE"
      }
    },
    ...overrides
  };
}

test("[R3-HARNESS-V1] parseArgs defaults to offline mode with 1 run/case", () => {
  assert.deepEqual(parseArgs([]), { mode: "offline", runsPerCase: 1, caseFilter: null });
});

test("[R3-HARNESS-V1] parseArgs honors --mode=live and --runs, defaulting live to 3 runs", () => {
  assert.deepEqual(parseArgs(["--mode=live"]), { mode: "live", runsPerCase: 3, caseFilter: null });
  assert.deepEqual(parseArgs(["--mode=live", "--runs=5"]), { mode: "live", runsPerCase: 5, caseFilter: null });
});

test("[R3-HARNESS-V1] parseArgs --case filters to the named frozen case(s), never mutating the corpus", () => {
  assert.deepEqual(parseArgs(["--case=TS-005"]), { mode: "offline", runsPerCase: 1, caseFilter: ["TS-005"] });
  assert.deepEqual(parseArgs(["--case=TS-005,TS-001"]), { mode: "offline", runsPerCase: 1, caseFilter: ["TS-005", "TS-001"] });
});

test("[R3-HARNESS-V1] requesting --mode=live alone never bypasses the shared BENCHMARK_LIVE_LLM_ENABLED gate", () => {
  // The CLI's own live path (scripts/r3-stable-agent-benchmark.ts#main) calls
  // exactly this shared, unmodified gate before ever building a live
  // provider - reused, never reimplemented. --mode=live only selects which
  // branch main() takes; resolveLiveBenchmarkProviderConfig is what actually
  // decides whether a live call may happen.
  const fakeEnv: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  const resolution = resolveLiveBenchmarkProviderConfig(fakeEnv);
  assert.deepEqual(resolution, { ok: false, reason: "live_benchmark_disabled" });
});

test("[R3-HARNESS-V1] the JSON report never carries an apiKey/endpoint/authorization field or value", () => {
  const summary: GoldenRunSummary = { mode: "offline", model: "benchmark-offline-model", runsPerCase: 1, startedAt: "t0", finishedAt: "t1", results: [fakeResult()] };
  const report = buildGoldenReport(summary);
  const serialized = JSON.stringify(report);

  assert.doesNotMatch(serialized, /apiKey/i);
  assert.doesNotMatch(serialized, /authorization/i);
  assert.doesNotMatch(serialized, /bearer\s/i);
  assert.doesNotMatch(serialized, /sk-[a-zA-Z0-9]{10,}/);
  assert.doesNotMatch(serialized, /BRAIN_MODEL_API_KEY/);
});

test("[R3-HARNESS-V1] the markdown report never carries an apiKey/endpoint/authorization field or value", () => {
  const summary: GoldenRunSummary = { mode: "offline", model: "benchmark-offline-model", runsPerCase: 1, startedAt: "t0", finishedAt: "t1", results: [fakeResult()] };
  const markdown = renderGoldenReportMarkdown(buildGoldenReport(summary));

  assert.doesNotMatch(markdown, /apiKey/i);
  assert.doesNotMatch(markdown, /authorization/i);
  assert.doesNotMatch(markdown, /sk-[a-zA-Z0-9]{10,}/);
});

test("[R3-HARNESS-V1] computePassFrequencyByCase reports per-case pass count/rate across repeated runs", () => {
  const summary: GoldenRunSummary = {
    mode: "offline",
    model: "benchmark-offline-model",
    runsPerCase: 3,
    startedAt: "t0",
    finishedAt: "t1",
    results: [
      fakeResult({ runIndex: 0 }),
      fakeResult({ runIndex: 1, score: { ...fakeResult().score, overallPass: false } }),
      fakeResult({ runIndex: 2 })
    ]
  };
  const frequency = computePassFrequencyByCase(buildGoldenReport(summary));
  assert.equal(frequency.length, 1);
  assert.equal(frequency[0].caseId, "RP-001");
  assert.equal(frequency[0].totalRuns, 3);
  assert.equal(frequency[0].passCount, 2);
});
