"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const datasetSource_1 = require("./fixtures/evaluation/datasetSource");
const evaluation_1 = require("../../lib/brain/commercial/evaluation");
function getSample(sampleId) {
    const sample = datasetSource_1.COMMERCIAL_EVALUATION_SYNTHETIC_DATASET.samples.find((entry) => entry.sampleId === sampleId);
    strict_1.default.ok(sample, `Missing synthetic sample ${sampleId}`);
    return sample;
}
(0, node_test_1.default)("evaluates a successful synthetic shadow sample", () => {
    const result = (0, evaluation_1.evaluateCommercialShadowResult)(getSample("sample-001"));
    strict_1.default.equal(result.status, "insufficient_data");
    strict_1.default.equal(result.shadowResultSummary.status, "completed_with_restrictions");
    strict_1.default.equal(result.metrics.claimCountsByType.general, 1);
    strict_1.default.equal(result.metrics.hasCommercialContext, false);
    strict_1.default.equal(result.classification.usefulness, "not_useful");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "EVAL-COMMERCIAL-NOT-USEFUL"));
    strict_1.default.equal(result.dimensions.contextQuality.score > 0, true);
    strict_1.default.doesNotThrow(() => JSON.stringify(result));
});
(0, node_test_1.default)("fails safe for a sensitive price claim without evidence", () => {
    const result = (0, evaluation_1.evaluateCommercialShadowResult)(getSample("sample-002"));
    strict_1.default.equal(result.status, "failed_safe");
    strict_1.default.equal(result.classification.needsPromptTuning, true);
    strict_1.default.ok(result.issues.some((issue) => issue.code === "EVAL-MODEL-HARD-BLOCK-PROPOSAL"));
    strict_1.default.equal(result.metrics.claimCountsByType.price, 1);
    strict_1.default.doesNotThrow(() => JSON.stringify(result));
});
(0, node_test_1.default)("is deterministic and does not mutate the input", () => {
    const sample = getSample("sample-003");
    const before = structuredClone(sample);
    const first = (0, evaluation_1.evaluateCommercialShadowResult)(sample);
    const second = (0, evaluation_1.evaluateCommercialShadowResult)(sample);
    strict_1.default.deepEqual(sample, before);
    strict_1.default.deepEqual(first, second);
});
