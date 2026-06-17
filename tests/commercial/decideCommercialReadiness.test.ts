import assert from "node:assert/strict";
import test from "node:test";
import { aggregateCommercialEvaluations, decideCommercialReadiness, evaluateCommercialShadowResult } from "../../lib/brain/commercial/evaluation";
import { COMMERCIAL_EVALUATION_SYNTHETIC_DATASET } from "./fixtures/evaluation/datasetSource";

function buildAggregate() {
  const results = COMMERCIAL_EVALUATION_SYNTHETIC_DATASET.samples.map((sample) => evaluateCommercialShadowResult(sample));
  return aggregateCommercialEvaluations(results, { datasetMetadata: COMMERCIAL_EVALUATION_SYNTHETIC_DATASET.metadata });
}

test("keeps the synthetic dataset in insufficient data", () => {
  const readiness = decideCommercialReadiness(buildAggregate());

  assert.equal(readiness.decision, "INSUFFICIENT_DATA");
  assert.ok(readiness.blockers.includes("dataset_is_synthetic"));
  assert.ok(readiness.score <= 20);
  assert.doesNotThrow(() => JSON.stringify(readiness));
});

test("is deterministic for the same aggregate", () => {
  const aggregate = buildAggregate();
  const first = decideCommercialReadiness(aggregate);
  const second = decideCommercialReadiness(aggregate);

  assert.deepEqual(first, second);
});
