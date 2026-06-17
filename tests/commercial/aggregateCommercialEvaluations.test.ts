import assert from "node:assert/strict";
import test from "node:test";
import { aggregateCommercialEvaluations, evaluateCommercialShadowResult } from "../../lib/brain/commercial/evaluation";
import { COMMERCIAL_EVALUATION_SYNTHETIC_DATASET } from "./fixtures/evaluation/datasetSource";

function buildAggregate() {
  const results = COMMERCIAL_EVALUATION_SYNTHETIC_DATASET.samples.map((sample) => evaluateCommercialShadowResult(sample));
  return aggregateCommercialEvaluations(results, { datasetMetadata: COMMERCIAL_EVALUATION_SYNTHETIC_DATASET.metadata });
}

test("aggregates the synthetic commercial evaluation dataset", () => {
  const aggregate = buildAggregate();

  assert.equal(aggregate.sampleCount, 30);
  assert.equal(aggregate.totalObserved, 30);
  assert.equal(aggregate.coverage.synthetic, true);
  assert.ok(aggregate.totalCompleted > 0);
  assert.ok(aggregate.totalSkipped > 0);
  assert.ok(aggregate.totalInsufficientData > 0);
  assert.ok(aggregate.claimCountsByType.general > 0);
  assert.ok(aggregate.blockedClaimRate >= 0);
  assert.ok(aggregate.dimensionAverages.contextQuality >= 0);
  assert.ok(aggregate.topIssues.length > 0);
  assert.doesNotThrow(() => JSON.stringify(aggregate));
});

test("is deterministic for the same inputs", () => {
  const first = buildAggregate();
  const second = buildAggregate();

  assert.deepEqual(first, second);
});
