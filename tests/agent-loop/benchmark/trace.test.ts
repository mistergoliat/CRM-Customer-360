import assert from "node:assert/strict";
import test from "node:test";
import { buildBenchmarkTurnTrace } from "@/lib/brain/commercial/agent-loop/benchmark/trace";
import type { AgentLoopResult } from "@/lib/brain/commercial/agent-loop/agentStepTypes";

function loop(overrides: Partial<AgentLoopResult> = {}): AgentLoopResult {
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

test("[T08E] buildBenchmarkTurnTrace captures decision-level budget state and non-consuming invalid_arguments correctly", () => {
  const result = loop({
    toolExecutionCount: 1,
    warnings: ["agent_loop_tool_invalid_arguments:explore_catalog:sort_and_limit_required"],
    llmCalls: [
      { phase: "gathering", attempt: 0, decisionIndex: 0, elapsedMs: 100, model: "m", providerRequestId: null, finishReason: "stop", inputTokens: 10, outputTokens: 5, reasoningTokens: null, outcome: "success" },
      { phase: "gathering", attempt: 0, decisionIndex: 1, elapsedMs: 120, model: "m", providerRequestId: null, finishReason: "stop", inputTokens: 10, outputTokens: 5, reasoningTokens: null, outcome: "success" }
    ],
    steps: [
      {
        stepIndex: 0,
        phase: "gathering",
        governance: "authorized",
        step: { type: "use_tool", tool: "search_products", arguments: { query: "barra" } },
        observation: { tool: "search_products", status: "completed", data: { query: "barra" } }
      },
      {
        stepIndex: 1,
        phase: "gathering",
        governance: "authorized",
        step: { type: "use_tool", tool: "explore_catalog", arguments: { sort: { by: "price", direction: "asc" } } },
        observation: { tool: "explore_catalog", status: "blocked", errorCode: "sort_and_limit_required" }
      }
    ]
  });

  const trace = buildBenchmarkTurnTrace(result, 750, { maxDecisions: 3, maxToolExecutions: 2, timeoutMs: 20000 });
  assert.equal(trace.configuredMaxToolExecutions, 2);
  assert.deepEqual(trace.orderedToolSequence, ["search_products", "explore_catalog"]);
  assert.equal(trace.decisionTrace[0].toolExecutionCountBeforeDecision, 0);
  assert.equal(trace.decisionTrace[0].remainingToolExecutions, 2);
  assert.equal(trace.decisionTrace[0].consumedToolBudget, true);
  assert.equal(trace.decisionTrace[1].toolExecutionCountBeforeDecision, 1);
  assert.equal(trace.decisionTrace[1].remainingToolExecutions, 1);
  assert.equal(trace.decisionTrace[1].blocked, true);
  assert.equal(trace.decisionTrace[1].invalid, true);
  assert.equal(trace.decisionTrace[1].consumedToolBudget, false, "invalid_arguments must not count toward maxToolExecutions");
});
