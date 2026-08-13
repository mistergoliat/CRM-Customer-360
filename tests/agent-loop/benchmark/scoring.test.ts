import assert from "node:assert/strict";
import test from "node:test";
import { scoreCase } from "@/lib/brain/commercial/agent-loop/benchmark/scoring";
import type { AgentLoopResult, AgentLoopStepRecord } from "@/lib/brain/commercial/agent-loop/agentStepTypes";
import type { BenchmarkGroundTruth } from "@/lib/brain/commercial/agent-loop/benchmark/types";

function baseLoop(overrides: Partial<AgentLoopResult> = {}): AgentLoopResult {
  return {
    ran: true,
    terminalReason: "responded",
    steps: [],
    toolExecutionCount: 0,
    finalMessage: "ok",
    handoffReason: null,
    warnings: [],
    llmCalls: [],
    ...overrides
  };
}

function useToolStep(tool: string, args: Record<string, unknown>, status: "completed" | "failed" | "blocked" = "completed", data?: unknown): AgentLoopStepRecord {
  return {
    stepIndex: 0,
    step: { type: "use_tool", tool, arguments: args },
    governance: "authorized",
    observation: { tool, status, ...(data !== undefined ? { data } : {}) },
    phase: "gathering"
  };
}

function baseGroundTruth(overrides: Partial<BenchmarkGroundTruth> = {}): BenchmarkGroundTruth {
  return { requiredTools: [], forbiddenTools: [], expectedTerminalReason: "responded", notes: "n/a", ...overrides };
}

test("[T05] scoreCase fails when a required tool never completes", () => {
  const loop = baseLoop({ steps: [] });
  const score = scoreCase("C-required", 0, loop, baseGroundTruth({ requiredTools: ["select_products"] }));
  assert.equal(score.requiredToolsCompleted, false);
  assert.deepEqual(score.missingRequiredTools, ["select_products"]);
  assert.equal(score.overallPass, false);
});

test("[T05] scoreCase passes when a required tool completes", () => {
  const loop = baseLoop({ steps: [useToolStep("search_products", { query: "x" })] });
  const score = scoreCase("C-required-ok", 0, loop, baseGroundTruth({ requiredTools: ["search_products"] }));
  assert.equal(score.requiredToolsCompleted, true);
  assert.equal(score.overallPass, true);
});

test("[T05] scoreCase flags a forbidden tool invocation even if it never completed", () => {
  const loop = baseLoop({ steps: [useToolStep("select_products", { items: [] }, "blocked")] });
  const score = scoreCase("C-forbidden", 0, loop, baseGroundTruth({ forbiddenTools: ["select_products"] }));
  assert.equal(score.forbiddenToolInvoked, true);
  assert.deepEqual(score.invokedForbiddenTools, ["select_products"]);
  assert.equal(score.overallPass, false);
});

test("[T05] scoreCase checks select_products productId/quantity, rejecting a wrong product", () => {
  const loop = baseLoop({ steps: [useToolStep("select_products", { items: [{ productId: "32", quantity: 2 }] })] });
  const score = scoreCase("C-wrong-product", 0, loop, baseGroundTruth({ selectedProductId: "31", quantity: 2 }));
  assert.equal(score.toolArgumentsCorrect, false);
  assert.equal(score.overallPass, false);
});

test("[T05] scoreCase accepts a matching select_products productId/quantity", () => {
  const loop = baseLoop({ steps: [useToolStep("select_products", { items: [{ productId: "31", quantity: 2 }] })] });
  const score = scoreCase("C-right-product", 0, loop, baseGroundTruth({ selectedProductId: "31", quantity: 2, requiredTools: ["select_products"] }));
  assert.equal(score.toolArgumentsCorrect, true);
  assert.equal(score.overallPass, true);
});

test("[T05] scoreCase rejects a resolved destination when ambiguity (null expected) was required", () => {
  const loop = baseLoop({ steps: [useToolStep("set_shipping_destination", { destination: "Santiago" }, "completed", { status: "resolved", destination: { communeId: 99 } })] });
  const score = scoreCase("C-ambiguous", 0, loop, baseGroundTruth({ expectedDestinationCommuneId: null, requiredTools: ["set_shipping_destination"] }));
  assert.equal(score.toolArgumentsCorrect, false);
  assert.equal(score.overallPass, false);
});

test("[T05] scoreCase accepts a resolved destination matching the expected communeId", () => {
  const loop = baseLoop({ steps: [useToolStep("set_shipping_destination", { destination: "ñuñoa" }, "completed", { status: "resolved", destination: { communeId: 99 } })] });
  const score = scoreCase("C-destination-ok", 0, loop, baseGroundTruth({ expectedDestinationCommuneId: 99, requiredTools: ["set_shipping_destination"] }));
  assert.equal(score.toolArgumentsCorrect, true);
  assert.equal(score.overallPass, true);
});

test("[T05] scoreCase flags a terminalReason mismatch", () => {
  const loop = baseLoop({ terminalReason: "handoff" });
  const score = scoreCase("C-terminal", 0, loop, baseGroundTruth({ expectedTerminalReason: "responded" }));
  assert.equal(score.terminalReasonCorrect, false);
  assert.equal(score.overallPass, false);
});

test("[T05] scoreCase requires an expected controlled tool failure to actually be observed", () => {
  const passingLoop = baseLoop({ steps: [useToolStep("get_product_details", { productId: "999" }, "failed")] });
  const passingScore = scoreCase("C-tool-fail-observed", 0, passingLoop, baseGroundTruth({ expectsControlledToolFailure: true }));
  assert.equal(passingScore.controlledToolFailureObserved, true);
  assert.equal(passingScore.overallPass, true);

  const missingLoop = baseLoop({ steps: [] });
  const missingScore = scoreCase("C-tool-fail-missing", 0, missingLoop, baseGroundTruth({ expectsControlledToolFailure: true }));
  assert.equal(missingScore.controlledToolFailureObserved, false);
  assert.equal(missingScore.overallPass, false);
});

test("[T05] scoreCase requires an expected structured provider failure to actually be observed", () => {
  const passingLoop = baseLoop({
    llmCalls: [
      { phase: "gathering", attempt: 0, decisionIndex: 0, elapsedMs: 10, model: "m", providerRequestId: null, finishReason: null, inputTokens: null, outputTokens: null, reasoningTokens: null, outcome: "invalid_response" }
    ]
  });
  const passingScore = scoreCase("C-structured-observed", 0, passingLoop, baseGroundTruth({ expectsStructuredFailure: true }));
  assert.equal(passingScore.structuredFailureObserved, true);
  assert.equal(passingScore.overallPass, true);

  const missingLoop = baseLoop({});
  const missingScore = scoreCase("C-structured-missing", 0, missingLoop, baseGroundTruth({ expectsStructuredFailure: true }));
  assert.equal(missingScore.structuredFailureObserved, false);
  assert.equal(missingScore.overallPass, false);
});
