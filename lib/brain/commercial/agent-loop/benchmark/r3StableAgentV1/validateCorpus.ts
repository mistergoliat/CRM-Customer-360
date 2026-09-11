import { GOLDEN_CASE_CATEGORIES } from "./types";
import type { GoldenCase } from "./types";

/** R3 Stable Agent Acceptance Harness V1, section 10.1/10.9. Runtime sanity checks on top of GoldenCase's TS shape. */
export function validateGoldenCase(testCase: GoldenCase): string[] {
  const errors: string[] = [];

  if (!testCase.caseId.trim()) errors.push("caseId must be non-empty");
  if (!(GOLDEN_CASE_CATEGORIES as readonly string[]).includes(testCase.category)) errors.push(`${testCase.caseId}: unknown category "${testCase.category}"`);

  if (testCase.mode === "turn") {
    if (testCase.offlineScript.length === 0) errors.push(`${testCase.caseId}: offlineScript must have at least one scripted step`);
    const overlap = testCase.expected.requiredTools.filter((tool) => testCase.expected.forbiddenTools.includes(tool));
    if (overlap.length > 0) errors.push(`${testCase.caseId}: tool(s) [${overlap.join(", ")}] cannot be both requiredTools and forbiddenTools`);
    if (testCase.expected.expectedTool && testCase.expected.forbiddenTools.includes(testCase.expected.expectedTool)) {
      errors.push(`${testCase.caseId}: expectedTool "${testCase.expected.expectedTool}" cannot also be forbidden`);
    }
  } else {
    if (testCase.priorSteps.length === 0) errors.push(`${testCase.caseId}: decision-mode cases require at least one prior step (the injected observation)`);
    if (testCase.expected.allowedNextActionTypes.length === 0) errors.push(`${testCase.caseId}: allowedNextActionTypes must be non-empty`);
    if (testCase.expected.allowedNextActionTypes.includes("use_tool") && !testCase.expected.allowedNextTools?.length) {
      errors.push(`${testCase.caseId}: allowedNextActionTypes includes "use_tool" but allowedNextTools is empty`);
    }
  }

  return errors;
}

export type GoldenCorpusValidationResult = { ok: true } | { ok: false; errors: string[] };

export function validateGoldenCorpus(cases: GoldenCase[]): GoldenCorpusValidationResult {
  const errors: string[] = [];
  const seenCaseIds = new Set<string>();

  for (const testCase of cases) {
    if (seenCaseIds.has(testCase.caseId)) errors.push(`duplicate caseId: ${testCase.caseId}`);
    seenCaseIds.add(testCase.caseId);
    errors.push(...validateGoldenCase(testCase));
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
