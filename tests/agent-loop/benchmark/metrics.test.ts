import assert from "node:assert/strict";
import test from "node:test";
import { computeAggregateMetrics, computeMetricsByCase } from "@/lib/brain/commercial/agent-loop/benchmark/metrics";
import type { AgentLoopResult } from "@/lib/brain/commercial/agent-loop/agentStepTypes";
import type { BenchmarkCaseScore, BenchmarkProviderCallRecord, BenchmarkTurnResult } from "@/lib/brain/commercial/agent-loop/benchmark/types";

function call(overrides: Partial<BenchmarkProviderCallRecord> = {}): BenchmarkProviderCallRecord {
  return {
    caseId: "C01",
    runIndex: 0,
    callIndex: 0,
    elapsedMs: 100,
    outcome: "success",
    errorCode: null,
    finishReason: "stop",
    inputTokens: 50,
    outputTokens: 20,
    providerRequestId: "req-1",
    model: "benchmark-offline-model",
    ...overrides
  };
}

function loop(overrides: Partial<AgentLoopResult> = {}): AgentLoopResult {
  return { ran: true, terminalReason: "responded", steps: [], toolExecutionCount: 0, finalMessage: "ok", handoffReason: null, warnings: [], llmCalls: [], ...overrides };
}

function score(overrides: Partial<BenchmarkCaseScore> = {}): BenchmarkCaseScore {
  return {
    caseId: "C01",
    runIndex: 0,
    toolsUsed: [],
    requiredToolsCompleted: true,
    missingRequiredTools: [],
    forbiddenToolInvoked: false,
    invokedForbiddenTools: [],
    toolArgumentsCorrect: true,
    terminalReasonCorrect: true,
    controlledToolFailureObserved: false,
    structuredFailureObserved: false,
    overallPass: true,
    notes: [],
    ...overrides
  };
}

function turn(overrides: Partial<BenchmarkTurnResult> = {}): BenchmarkTurnResult {
  return { caseId: "C01", runIndex: 0, loop: loop(), totalElapsedMs: 500, providerCalls: [call()], score: score(), ...overrides };
}

test("[T05] computeAggregateMetrics returns all-null metrics for an empty result set (never an invented 0)", () => {
  const metrics = computeAggregateMetrics([]);
  assert.equal(metrics.totalRuns, 0);
  assert.equal(metrics.totalProviderCalls, 0);
  assert.equal(metrics.correctness.overallPassRate, null);
  assert.equal(metrics.structuralRobustness.validAgentStepRate, null);
  assert.equal(metrics.latency.llmCallLatencyMsP50, null);
  assert.equal(metrics.tokens.inputTokensPerCallAvg, null);
  assert.equal(metrics.tokens.usageComplete, false);
  assert.deepEqual(metrics.finishReasonCounts, { stop: 0, length: 0, other: 0, null_unknown: 0 });
});

test("[T05] computeAggregateMetrics counts runs and provider calls correctly", () => {
  const results = [turn({ providerCalls: [call(), call()] }), turn({ providerCalls: [call()] })];
  const metrics = computeAggregateMetrics(results);
  assert.equal(metrics.totalRuns, 2);
  assert.equal(metrics.totalProviderCalls, 3);
});

test("[T05] computeAggregateMetrics computes correctness rates from score fields", () => {
  const results = [turn({ score: score({ overallPass: true }) }), turn({ score: score({ overallPass: false, requiredToolsCompleted: false }) })];
  const metrics = computeAggregateMetrics(results);
  assert.equal(metrics.correctness.overallPassRate, 0.5);
  assert.equal(metrics.correctness.requiredToolCompletionRate, 0.5);
});

test("[T05] computeAggregateMetrics separates invalid_response, empty_response and invalid_model_json rates", () => {
  const results = [
    turn({ providerCalls: [call({ outcome: "success", errorCode: null })] }),
    turn({ providerCalls: [call({ outcome: "invalid_response", errorCode: "empty_response", inputTokens: null, outputTokens: null, finishReason: null }), call({ outcome: "success" })] }),
    turn({ providerCalls: [call({ outcome: "invalid_response", errorCode: "invalid_model_json", inputTokens: null, outputTokens: null, finishReason: null })] })
  ];
  const metrics = computeAggregateMetrics(results);
  assert.equal(metrics.totalProviderCalls, 4);
  assert.equal(metrics.structuralRobustness.validAgentStepRate, 0.5);
  assert.equal(metrics.structuralRobustness.invalidResponseRate, 0.5);
  assert.equal(metrics.structuralRobustness.emptyResponseRate, 0.25);
  assert.equal(metrics.structuralRobustness.invalidModelJsonRate, 0.25);
});

test("[T05] computeAggregateMetrics computes structured recovery activation/success rate from loop.warnings + terminalReason", () => {
  const recoveredOk = turn({ loop: loop({ warnings: ["agent_loop_structured_recovery_attempted:gathering"], terminalReason: "responded" }) });
  const recoveredFailed = turn({ loop: loop({ warnings: ["agent_loop_structured_recovery_attempted:finalization"], terminalReason: "provider_unavailable" }) });
  const noRecovery = turn({ loop: loop({ warnings: [], terminalReason: "responded" }) });

  const metrics = computeAggregateMetrics([recoveredOk, recoveredFailed, noRecovery]);
  assert.equal(metrics.structuralRobustness.structuredRecoveryActivationRate, 2 / 3);
  assert.equal(metrics.structuralRobustness.structuredRecoverySuccessRate, 0.5);
});

test("[T05] computeAggregateMetrics computes schema repair activation/success rate from loop.warnings prefix agent_step_invalid:", () => {
  const repaired = turn({ loop: loop({ warnings: ["agent_step_invalid:missing_required_field"], terminalReason: "responded" }) });
  const notRepaired = turn({ loop: loop({ warnings: [], terminalReason: "responded" }) });

  const metrics = computeAggregateMetrics([repaired, notRepaired]);
  assert.equal(metrics.structuralRobustness.schemaRepairActivationRate, 0.5);
  assert.equal(metrics.structuralRobustness.schemaRepairSuccessRate, 1);
});

test("[T05] computeAggregateMetrics computes exact p50/p95 latency percentiles over a known dataset", () => {
  const elapsedValues = [100, 150, 200, 250, 300];
  const results = elapsedValues.map((elapsedMs) => turn({ providerCalls: [call({ elapsedMs })] }));
  const metrics = computeAggregateMetrics(results);
  assert.equal(metrics.latency.llmCallLatencyMsP50, 200);
  assert.equal(metrics.latency.llmCallLatencyMsP95, 300);
});

test("[T05] computeAggregateMetrics reports llmCallsPerTurn avg/max and averages token usage while ignoring nulls, but marks usageComplete false when any call is missing tokens", () => {
  const results = [
    turn({ providerCalls: [call({ inputTokens: 40, outputTokens: 10 }), call({ inputTokens: 60, outputTokens: 30 })] }),
    turn({ providerCalls: [call({ inputTokens: null, outputTokens: null })] })
  ];
  const metrics = computeAggregateMetrics(results);
  assert.equal(metrics.latency.llmCallsPerTurnAvg, 1.5);
  assert.equal(metrics.latency.llmCallsPerTurnMax, 2);
  assert.equal(metrics.tokens.inputTokensPerCallAvg, 50);
  assert.equal(metrics.tokens.outputTokensPerCallAvg, 20);
  assert.equal(metrics.tokens.usageComplete, false);
});

test("[T05] computeAggregateMetrics classifies finish reasons into stop/length/other/null_unknown buckets", () => {
  const results = [
    turn({ providerCalls: [call({ finishReason: "stop" })] }),
    turn({ providerCalls: [call({ finishReason: "length" })] }),
    turn({ providerCalls: [call({ finishReason: "content_filter" })] }),
    turn({ providerCalls: [call({ finishReason: null, inputTokens: null, outputTokens: null })] })
  ];
  const metrics = computeAggregateMetrics(results);
  assert.deepEqual(metrics.finishReasonCounts, { stop: 1, length: 1, other: 1, null_unknown: 1 });
});

test("[T05] computeMetricsByCase buckets results per caseId independently", () => {
  const results = [turn({ caseId: "C01", score: score({ overallPass: true }) }), turn({ caseId: "C01", score: score({ overallPass: false }) }), turn({ caseId: "C02", score: score({ overallPass: true }) })];
  const byCase = computeMetricsByCase(results);
  assert.deepEqual([...byCase.keys()].sort(), ["C01", "C02"]);
  assert.equal(byCase.get("C01")?.totalRuns, 2);
  assert.equal(byCase.get("C01")?.correctness.overallPassRate, 0.5);
  assert.equal(byCase.get("C02")?.correctness.overallPassRate, 1);
});
