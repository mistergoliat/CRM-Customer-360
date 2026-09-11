import assert from "node:assert/strict";
import test from "node:test";
import { scoreGoldenCase } from "@/lib/brain/commercial/agent-loop/benchmark/r3StableAgentV1/scoreGoldenCase";
import type { GoldenDecisionCase, GoldenTurnCase } from "@/lib/brain/commercial/agent-loop/benchmark/r3StableAgentV1/types";
import type { AgentLoopResult, AgentLoopStepRecord } from "@/lib/brain/commercial/agent-loop/agentStepTypes";

/**
 * R3 Stable Agent Acceptance Harness V1, task section 10 items 2/3/4/5/6:
 * scorer correctness, PASS/FAIL/NOT_APPLICABLE classification, and
 * false-commercial-confirmation detection.
 */

function baseLoop(overrides: Partial<AgentLoopResult> = {}): AgentLoopResult {
  return { ran: true, terminalReason: "responded", steps: [], toolExecutionCount: 0, finalMessage: "ok", handoffReason: null, warnings: [], llmCalls: [], ...overrides };
}

function useToolStep(tool: string, args: Record<string, unknown>, status: "completed" | "failed" | "blocked" = "completed", errorCode?: string): AgentLoopStepRecord {
  return { stepIndex: 0, step: { type: "use_tool", tool, arguments: args }, governance: "authorized", observation: { tool, status, ...(errorCode ? { errorCode } : {}) }, phase: "gathering" };
}

function respondStep(message: string): AgentLoopStepRecord {
  return { stepIndex: 0, step: { type: "respond", message }, governance: null, observation: null, phase: "gathering" };
}

function baseTurnCase(overrides: Partial<GoldenTurnCase["expected"]> = {}): GoldenTurnCase {
  return {
    mode: "turn",
    caseId: "T-CASE",
    category: "SIMPLE_TOOL_SELECTION",
    description: "test",
    customerMessage: "x",
    commercialContextSummary: {},
    offlineScript: [{ kind: "respond", message: "x" }],
    expected: { requiredTools: [], forbiddenTools: [], firstActionType: null, expectedTool: null, terminalReason: null, ...overrides },
    notes: "n/a"
  };
}

test("[R3-HARNESS-V1] a turn matching every expectation scores overallPass=true, no-tool dimensions NOT_APPLICABLE", () => {
  const loop = baseLoop({ steps: [respondStep("hola")] });
  const testCase = baseTurnCase({ firstActionType: "respond", terminalReason: "responded" });
  const score = scoreGoldenCase(testCase, 0, { loop, decisionCount: 1 });

  assert.equal(score.overallPass, true);
  assert.equal(score.dimensions.actionTypePass, "PASS");
  assert.equal(score.dimensions.mutationGroundingPass, "PASS");
  assert.equal(score.dimensions.taskCompletionPass, "PASS");
  assert.equal(score.falseCommercialConfirmation, false);
});

test("[R3-HARNESS-V1] a missing required tool fails taskCompletionPass and overallPass", () => {
  const loop = baseLoop({ steps: [respondStep("hola")] });
  const testCase = baseTurnCase({ requiredTools: ["search_products"], terminalReason: "responded" });
  const score = scoreGoldenCase(testCase, 0, { loop, decisionCount: 1 });

  assert.equal(score.dimensions.taskCompletionPass, "FAIL");
  assert.equal(score.overallPass, false);
});

test("[R3-HARNESS-V1] a forbidden tool invocation fails toolSelectionPass regardless of outcome", () => {
  const loop = baseLoop({ steps: [useToolStep("select_products", { items: [] }, "blocked"), respondStep("ok")] });
  const testCase = baseTurnCase({ forbiddenTools: ["select_products"], terminalReason: "responded" });
  const score = scoreGoldenCase(testCase, 0, { loop, decisionCount: 2 });

  assert.equal(score.dimensions.toolSelectionPass, "FAIL");
  assert.equal(score.overallPass, false);
});

test("[R3-HARNESS-V1] argumentStructurePass is NOT_APPLICABLE when no tool was ever used", () => {
  const loop = baseLoop({ steps: [respondStep("hola")] });
  const testCase = baseTurnCase({ firstActionType: "respond", terminalReason: "responded" });
  const score = scoreGoldenCase(testCase, 0, { loop, decisionCount: 1 });
  assert.equal(score.dimensions.argumentStructurePass, "NOT_APPLICABLE");
});

test("[R3-HARNESS-V1] a case-specific argumentSemantics predicate drives argumentSemanticsPass", () => {
  const loop = baseLoop({ steps: [useToolStep("select_products", { items: [{ productId: "31", quantity: 2 }] }), respondStep("listo")] });
  const failingCase = baseTurnCase({
    requiredTools: ["select_products"],
    expectedTool: "select_products",
    terminalReason: "responded",
    argumentSemantics: (loopResult) => {
      const call = loopResult.steps.find((record) => record.step.type === "use_tool" && record.step.tool === "select_products");
      const items = call?.step.type === "use_tool" ? call.step.arguments.items : null;
      const matches = Array.isArray(items) && items[0]?.quantity === 3;
      return { pass: matches ? "PASS" : "FAIL", notes: matches ? [] : ["expected quantity 3"] };
    }
  });
  const score = scoreGoldenCase(failingCase, 0, { loop, decisionCount: 2 });
  assert.equal(score.dimensions.argumentSemanticsPass, "FAIL");
  assert.equal(score.overallPass, false);
});

test("[R3-HARNESS-V1] false commercial confirmation: an unbacked selection claim fails mutationGroundingPass and is flagged", () => {
  const loop = baseLoop({ finalMessage: "Perfecto, te dejo 3 unidades listas.", steps: [respondStep("Perfecto, te dejo 3 unidades listas.")] });
  const testCase = baseTurnCase({ terminalReason: "responded" });
  const score = scoreGoldenCase(testCase, 0, { loop, decisionCount: 1 });

  assert.equal(score.falseCommercialConfirmation, true);
  assert.equal(score.dimensions.mutationGroundingPass, "FAIL");
  assert.equal(score.dimensions.evidenceGroundingPass, "FAIL");
  assert.equal(score.overallPass, false);
});

test("[R3-HARNESS-V1] a backed selection claim is never flagged as a false commercial confirmation", () => {
  const loop = baseLoop({
    finalMessage: "Perfecto, te dejo 3 unidades listas.",
    steps: [useToolStep("select_products", { items: [{ productId: "31", quantity: 3 }] }), respondStep("Perfecto, te dejo 3 unidades listas.")]
  });
  const testCase = baseTurnCase({ requiredTools: ["select_products"], terminalReason: "responded" });
  const score = scoreGoldenCase(testCase, 0, { loop, decisionCount: 2 });

  assert.equal(score.falseCommercialConfirmation, false);
  assert.equal(score.dimensions.mutationGroundingPass, "PASS");
});

test("[R3-HARNESS-V1] CM-005-style checkFalseQuoteClaim flags an unbacked quote confirmation", () => {
  const loop = baseLoop({ finalMessage: "Tu cotización ya está lista.", steps: [respondStep("Tu cotización ya está lista.")] });
  const testCase = baseTurnCase({ terminalReason: "responded", checkFalseQuoteClaim: true });
  const score = scoreGoldenCase(testCase, 0, { loop, decisionCount: 1 });

  assert.equal(score.falseCommercialConfirmation, true);
  assert.equal(score.dimensions.mutationGroundingPass, "FAIL");
});

test("[R3-HARNESS-V1] decision-mode: a next step within the allowed set passes observationReplanPass", () => {
  const testCase: GoldenDecisionCase = {
    mode: "decision",
    caseId: "D-CASE",
    category: "OBSERVATION_REPLAN",
    description: "test",
    customerMessage: "x",
    priorSteps: [],
    offlineNextStep: { kind: "respond", message: "x" },
    expected: { allowedNextActionTypes: ["respond", "use_tool"], allowedNextTools: ["get_product_details"], groundedProductIds: ["31"] },
    notes: "n/a"
  };
  const score = scoreGoldenCase(testCase, 0, { nextStep: { type: "respond", message: "hola" }, invalidOutputReason: null });
  assert.equal(score.dimensions.observationReplanPass, "PASS");
  assert.equal(score.dimensions.evidenceGroundingPass, "UNVERIFIABLE");
  assert.equal(score.overallPass, true);
});

test("[R3-HARNESS-V1] decision-mode: an out-of-set next tool fails observationReplanPass/toolSelectionPass", () => {
  const testCase: GoldenDecisionCase = {
    mode: "decision",
    caseId: "D-CASE-2",
    category: "OBSERVATION_REPLAN",
    description: "test",
    customerMessage: "x",
    priorSteps: [],
    offlineNextStep: { kind: "respond", message: "x" },
    expected: { allowedNextActionTypes: ["respond"], allowedNextTools: [], groundedProductIds: [] },
    notes: "n/a"
  };
  const score = scoreGoldenCase(testCase, 0, { nextStep: { type: "use_tool", tool: "get_product_details", arguments: { productId: "999" } }, invalidOutputReason: null });
  assert.equal(score.dimensions.actionTypePass, "FAIL");
  assert.equal(score.dimensions.observationReplanPass, "FAIL");
  assert.equal(score.overallPass, false);
});

test("[R3-HARNESS-V1] decision-mode: a use_tool citing an unobserved productId fails evidenceGroundingPass", () => {
  const testCase: GoldenDecisionCase = {
    mode: "decision",
    caseId: "D-CASE-3",
    category: "OBSERVATION_REPLAN",
    description: "test",
    customerMessage: "x",
    priorSteps: [],
    offlineNextStep: { kind: "respond", message: "x" },
    expected: { allowedNextActionTypes: ["use_tool"], allowedNextTools: ["get_product_details"], groundedProductIds: ["31"] },
    notes: "n/a"
  };
  const score = scoreGoldenCase(testCase, 0, { nextStep: { type: "use_tool", tool: "get_product_details", arguments: { productId: "999" } }, invalidOutputReason: null });
  assert.equal(score.dimensions.evidenceGroundingPass, "FAIL");
  assert.equal(score.overallPass, false);
});

test("[R3-HARNESS-V1] decision-mode: an invalid model output fails closed", () => {
  const testCase: GoldenDecisionCase = {
    mode: "decision",
    caseId: "D-CASE-4",
    category: "OBSERVATION_REPLAN",
    description: "test",
    customerMessage: "x",
    priorSteps: [],
    offlineNextStep: { kind: "respond", message: "x" },
    expected: { allowedNextActionTypes: ["respond"], groundedProductIds: [] },
    notes: "n/a"
  };
  const score = scoreGoldenCase(testCase, 0, { nextStep: null, invalidOutputReason: "missing_or_invalid_type: bad" });
  assert.equal(score.overallPass, false);
  assert.equal(score.dimensions.observationReplanPass, "FAIL");
});
