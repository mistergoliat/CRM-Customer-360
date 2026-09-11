import assert from "node:assert/strict";
import test from "node:test";
import { R3_STABLE_AGENT_V1_CORPUS } from "@/lib/brain/commercial/agent-loop/benchmark/r3StableAgentV1/corpus";
import { validateGoldenCorpus, validateGoldenCase } from "@/lib/brain/commercial/agent-loop/benchmark/r3StableAgentV1/validateCorpus";
import { GOLDEN_CASE_CATEGORIES } from "@/lib/brain/commercial/agent-loop/benchmark/r3StableAgentV1/types";
import type { GoldenCase } from "@/lib/brain/commercial/agent-loop/benchmark/r3StableAgentV1/types";

/**
 * R3 Stable Agent Acceptance Harness V1, task section 10 items 1/9: golden
 * case schema validation and stable caseId uniqueness.
 */

test("[R3-HARNESS-V1] the frozen golden corpus is between 20 and 25 cases", () => {
  assert.ok(R3_STABLE_AGENT_V1_CORPUS.length >= 20 && R3_STABLE_AGENT_V1_CORPUS.length <= 25, `expected 20-25 cases, got ${R3_STABLE_AGENT_V1_CORPUS.length}`);
});

test("[R3-HARNESS-V1] every caseId is unique", () => {
  const ids = R3_STABLE_AGENT_V1_CORPUS.map((testCase) => testCase.caseId);
  assert.equal(new Set(ids).size, ids.length, `duplicate caseId(s) found among: ${ids.join(", ")}`);
});

test("[R3-HARNESS-V1] the full corpus passes schema validation", () => {
  const result = validateGoldenCorpus(R3_STABLE_AGENT_V1_CORPUS);
  assert.deepEqual(result, { ok: true });
});

test("[R3-HARNESS-V1] every case declares a known category, present in the corpus", () => {
  const categoriesUsed = new Set(R3_STABLE_AGENT_V1_CORPUS.map((testCase) => testCase.category));
  for (const category of categoriesUsed) {
    assert.ok((GOLDEN_CASE_CATEGORIES as readonly string[]).includes(category), `unknown category ${category}`);
  }
  // Section 2's suggested distribution: every one of the 5 categories present.
  assert.equal(categoriesUsed.size, GOLDEN_CASE_CATEGORIES.length);
});

test("[R3-HARNESS-V1] category OBSERVATION_REPLAN cases are all decision-mode, every other category is turn-mode", () => {
  for (const testCase of R3_STABLE_AGENT_V1_CORPUS) {
    if (testCase.category === "OBSERVATION_REPLAN") assert.equal(testCase.mode, "decision", `${testCase.caseId} should be decision-mode`);
    else assert.equal(testCase.mode, "turn", `${testCase.caseId} should be turn-mode`);
  }
});

test("[R3-HARNESS-V1] validateGoldenCase flags requiredTools/forbiddenTools overlap", () => {
  const broken: GoldenCase = {
    mode: "turn",
    caseId: "BROKEN-1",
    category: "SIMPLE_TOOL_SELECTION",
    description: "broken fixture",
    customerMessage: "x",
    commercialContextSummary: {},
    offlineScript: [{ kind: "respond", message: "x" }],
    expected: { requiredTools: ["search_products"], forbiddenTools: ["search_products"], firstActionType: null, expectedTool: null, terminalReason: null },
    notes: "n/a"
  };
  const errors = validateGoldenCase(broken);
  assert.ok(errors.some((error) => error.includes("cannot be both requiredTools and forbiddenTools")));
});

test("[R3-HARNESS-V1] validateGoldenCase flags a decision-mode case with empty priorSteps", () => {
  const broken: GoldenCase = {
    mode: "decision",
    caseId: "BROKEN-2",
    category: "OBSERVATION_REPLAN",
    description: "broken fixture",
    customerMessage: "x",
    priorSteps: [],
    offlineNextStep: { kind: "respond", message: "x" },
    expected: { allowedNextActionTypes: ["respond"], groundedProductIds: [] },
    notes: "n/a"
  };
  const errors = validateGoldenCase(broken);
  assert.ok(errors.some((error) => error.includes("at least one prior step")));
});

test("[R3-HARNESS-V1] validateGoldenCorpus flags a duplicate caseId", () => {
  const [first] = R3_STABLE_AGENT_V1_CORPUS;
  const result = validateGoldenCorpus([first, first]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((error) => error.includes("duplicate caseId")));
});
