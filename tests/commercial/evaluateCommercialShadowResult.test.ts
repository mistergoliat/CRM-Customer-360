import assert from "node:assert/strict";
import test from "node:test";
import { COMMERCIAL_EVALUATION_SYNTHETIC_DATASET } from "./fixtures/evaluation/datasetSource";
import { evaluateCommercialShadowResult } from "../../lib/brain/commercial/evaluation";

function getSample(sampleId: string) {
  const sample = COMMERCIAL_EVALUATION_SYNTHETIC_DATASET.samples.find((entry) => entry.sampleId === sampleId);
  assert.ok(sample, `Missing synthetic sample ${sampleId}`);
  return sample;
}

test("evaluates a successful synthetic shadow sample", () => {
  const result = evaluateCommercialShadowResult(getSample("sample-001"));

  assert.equal(result.status, "insufficient_data");
  assert.equal(result.shadowResultSummary.status, "completed_with_restrictions");
  assert.equal(result.metrics.claimCountsByType.general, 1);
  assert.equal(result.metrics.hasCommercialContext, false);
  assert.equal(result.classification.usefulness, "not_useful");
  assert.ok(result.issues.some((issue) => issue.code === "EVAL-COMMERCIAL-NOT-USEFUL"));
  assert.equal(result.dimensions.contextQuality.score > 0, true);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("fails safe for a sensitive price claim without evidence", () => {
  const result = evaluateCommercialShadowResult(getSample("sample-002"));

  assert.equal(result.status, "failed_safe");
  assert.equal(result.classification.needsPromptTuning, true);
  assert.ok(result.issues.some((issue) => issue.code === "EVAL-MODEL-HARD-BLOCK-PROPOSAL"));
  assert.equal(result.metrics.claimCountsByType.price, 1);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("is deterministic and does not mutate the input", () => {
  const sample = getSample("sample-003");
  const before = structuredClone(sample);

  const first = evaluateCommercialShadowResult(sample);
  const second = evaluateCommercialShadowResult(sample);

  assert.deepEqual(sample, before);
  assert.deepEqual(first, second);
});
