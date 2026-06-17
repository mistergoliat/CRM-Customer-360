import assert from "node:assert/strict";
import test from "node:test";
import { aggregateCommercialEvaluations, buildCommercialEvaluationReport, evaluateCommercialShadowResult } from "../../lib/brain/commercial/evaluation";
import { COMMERCIAL_EVALUATION_SYNTHETIC_DATASET } from "./fixtures/evaluation/datasetSource";

function buildAggregate() {
  const results = COMMERCIAL_EVALUATION_SYNTHETIC_DATASET.samples.map((sample) => evaluateCommercialShadowResult(sample));
  return aggregateCommercialEvaluations(results, { datasetMetadata: COMMERCIAL_EVALUATION_SYNTHETIC_DATASET.metadata });
}

test("builds a stable readiness report for the synthetic dataset", () => {
  const report = buildCommercialEvaluationReport(buildAggregate());

  assert.equal(report.readinessDecision, "INSUFFICIENT_DATA");
  assert.equal(report.datasetCoverage.synthetic, true);
  assert.ok(report.markdown.includes("# Commercial Evaluation Report"));
  assert.ok(report.nextStep.includes("non-synthetic samples"));
  assert.ok(report.blockers.length > 0);
  assert.doesNotThrow(() => JSON.stringify(report));
});

test("is deterministic for the same aggregate", () => {
  const aggregate = buildAggregate();
  const first = buildCommercialEvaluationReport(aggregate);
  const second = buildCommercialEvaluationReport(aggregate);

  assert.deepEqual(first, second);
});
