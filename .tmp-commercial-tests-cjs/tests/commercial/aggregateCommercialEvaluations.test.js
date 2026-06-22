"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const evaluation_1 = require("../../lib/brain/commercial/evaluation");
const datasetSource_1 = require("./fixtures/evaluation/datasetSource");
function buildAggregate() {
    const results = datasetSource_1.COMMERCIAL_EVALUATION_SYNTHETIC_DATASET.samples.map((sample) => (0, evaluation_1.evaluateCommercialShadowResult)(sample));
    return (0, evaluation_1.aggregateCommercialEvaluations)(results, { datasetMetadata: datasetSource_1.COMMERCIAL_EVALUATION_SYNTHETIC_DATASET.metadata });
}
(0, node_test_1.default)("aggregates the synthetic commercial evaluation dataset", () => {
    const aggregate = buildAggregate();
    strict_1.default.equal(aggregate.sampleCount, 30);
    strict_1.default.equal(aggregate.totalObserved, 30);
    strict_1.default.equal(aggregate.coverage.synthetic, true);
    strict_1.default.ok(aggregate.totalCompleted > 0);
    strict_1.default.ok(aggregate.totalSkipped > 0);
    strict_1.default.ok(aggregate.totalInsufficientData > 0);
    strict_1.default.ok(aggregate.claimCountsByType.general > 0);
    strict_1.default.ok(aggregate.blockedClaimRate >= 0);
    strict_1.default.ok(aggregate.dimensionAverages.contextQuality >= 0);
    strict_1.default.ok(aggregate.topIssues.length > 0);
    strict_1.default.doesNotThrow(() => JSON.stringify(aggregate));
});
(0, node_test_1.default)("is deterministic for the same inputs", () => {
    const first = buildAggregate();
    const second = buildAggregate();
    strict_1.default.deepEqual(first, second);
});
