import assert from "node:assert/strict";
import test from "node:test";
import { BENCHMARK_CORPUS } from "@/tests/fixtures/agent-loop-benchmark/corpus";
import { validateBenchmarkCorpus } from "@/lib/brain/commercial/agent-loop/benchmark/validateCorpus";
import type { BenchmarkCase } from "@/lib/brain/commercial/agent-loop/benchmark/types";

function baseCase(overrides: Partial<BenchmarkCase> = {}): BenchmarkCase {
  return {
    caseId: "CX",
    description: "test fixture",
    customerMessage: "hola",
    commercialContextSummary: {},
    groundTruth: { requiredTools: [], forbiddenTools: [], expectedTerminalReason: "responded", notes: "n/a" },
    offlineScript: [{ kind: "respond", message: "hola" }],
    ...overrides
  };
}

test("[T05] BENCHMARK_CORPUS has the 12 required cases C01-C12, no duplicates", () => {
  const expectedIds = Array.from({ length: 12 }, (_, index) => `C${String(index + 1).padStart(2, "0")}`);
  const actualIds = BENCHMARK_CORPUS.map((testCase) => testCase.caseId);
  assert.deepEqual([...actualIds].sort(), expectedIds);
  assert.equal(new Set(actualIds).size, actualIds.length);
});

test("[T05] every corpus case has a non-empty offlineScript and ground truth notes", () => {
  for (const testCase of BENCHMARK_CORPUS) {
    assert.ok(testCase.offlineScript.length > 0, `${testCase.caseId} offlineScript must not be empty`);
    assert.ok(testCase.groundTruth.notes.trim().length > 0, `${testCase.caseId} groundTruth.notes must not be empty`);
  }
});

test("[T05] validateBenchmarkCorpus accepts the real corpus", () => {
  const result = validateBenchmarkCorpus(BENCHMARK_CORPUS);
  assert.deepEqual(result, { ok: true });
});

test("[T05] validateBenchmarkCorpus rejects a duplicate caseId", () => {
  const result = validateBenchmarkCorpus([baseCase({ caseId: "C01" }), baseCase({ caseId: "C01" })]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((error) => error.includes("duplicate caseId: C01")));
});

test("[T05] validateBenchmarkCorpus rejects an empty offlineScript", () => {
  const result = validateBenchmarkCorpus([baseCase({ caseId: "C01", offlineScript: [] })]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((error) => error.includes("offlineScript must have at least one")));
});

test("[T05] validateBenchmarkCorpus rejects a tool that is both required and forbidden", () => {
  const result = validateBenchmarkCorpus([
    baseCase({ caseId: "C01", groundTruth: { requiredTools: ["search_products"], forbiddenTools: ["search_products"], expectedTerminalReason: "responded", notes: "n/a" } })
  ]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((error) => error.includes("cannot be both requiredTools and forbiddenTools")));
});

test("[T05] validateBenchmarkCorpus rejects expectsStructuredFailure=true with no invalid_response step", () => {
  const result = validateBenchmarkCorpus([
    baseCase({ caseId: "C01", groundTruth: { requiredTools: [], forbiddenTools: [], expectedTerminalReason: "responded", expectsStructuredFailure: true, notes: "n/a" } })
  ]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((error) => error.includes('no "invalid_response" step')));
});
