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
(0, node_test_1.default)("keeps the synthetic dataset in insufficient data", () => {
    const readiness = (0, evaluation_1.decideCommercialReadiness)(buildAggregate());
    strict_1.default.equal(readiness.decision, "INSUFFICIENT_DATA");
    strict_1.default.ok(readiness.blockers.includes("dataset_is_synthetic"));
    strict_1.default.ok(readiness.score <= 20);
    strict_1.default.doesNotThrow(() => JSON.stringify(readiness));
});
(0, node_test_1.default)("is deterministic for the same aggregate", () => {
    const aggregate = buildAggregate();
    const first = (0, evaluation_1.decideCommercialReadiness)(aggregate);
    const second = (0, evaluation_1.decideCommercialReadiness)(aggregate);
    strict_1.default.deepEqual(first, second);
});
