import type { BenchmarkCase } from "./types";

/**
 * LLM-R1-T05. Runtime sanity checks on top of BenchmarkCase's TS shape - a
 * fixture can be well-typed and still be internally inconsistent (a
 * duplicated caseId, a tool marked both required and forbidden, a case that
 * claims expectsStructuredFailure but never scripts an invalid_response
 * step). Catching this here means a broken fixture fails fast and loud
 * instead of silently producing a misleading benchmark result.
 */
export function validateBenchmarkCase(testCase: BenchmarkCase): string[] {
  const errors: string[] = [];

  if (!testCase.caseId.trim()) errors.push("caseId must be non-empty");
  if (testCase.offlineScript.length === 0) errors.push(`${testCase.caseId}: offlineScript must have at least one scripted step`);

  const overlap = testCase.groundTruth.requiredTools.filter((tool) => testCase.groundTruth.forbiddenTools.includes(tool));
  if (overlap.length > 0) errors.push(`${testCase.caseId}: tool(s) [${overlap.join(", ")}] cannot be both requiredTools and forbiddenTools`);

  if (testCase.groundTruth.expectsStructuredFailure === true) {
    const hasInvalidResponseStep = testCase.offlineScript.some((step) => step.kind === "invalid_response");
    if (!hasInvalidResponseStep) errors.push(`${testCase.caseId}: expectsStructuredFailure=true but offlineScript has no "invalid_response" step`);
  }

  return errors;
}

export type BenchmarkCorpusValidationResult = { ok: true } | { ok: false; errors: string[] };

export function validateBenchmarkCorpus(cases: BenchmarkCase[]): BenchmarkCorpusValidationResult {
  const errors: string[] = [];

  const seenCaseIds = new Set<string>();
  for (const testCase of cases) {
    if (seenCaseIds.has(testCase.caseId)) errors.push(`duplicate caseId: ${testCase.caseId}`);
    seenCaseIds.add(testCase.caseId);
    errors.push(...validateBenchmarkCase(testCase));
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
