"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMMERCIAL_EVALUATION_DEFAULT_MARKDOWN_TITLE = exports.COMMERCIAL_EVALUATION_DEFAULT_THRESHOLDS = exports.COMMERCIAL_EVALUATION_ISSUE_CODES = exports.COMMERCIAL_EVALUATION_RECOMMENDATION_PRIORITIES = exports.COMMERCIAL_EVALUATION_COMPARISON_STATUSES = exports.COMMERCIAL_EVALUATION_USEFULNESS = exports.COMMERCIAL_EVALUATION_COMPONENTS = exports.COMMERCIAL_EVALUATION_READINESS_DECISIONS = exports.COMMERCIAL_EVALUATION_SEVERITIES = exports.COMMERCIAL_EVALUATION_DIMENSIONS = exports.COMMERCIAL_EVALUATION_STATUSES = exports.COMMERCIAL_EVALUATION_VERSION = void 0;
exports.COMMERCIAL_EVALUATION_VERSION = "brain.commercial.evaluation.v1";
exports.COMMERCIAL_EVALUATION_STATUSES = [
    "evaluated",
    "evaluated_with_warnings",
    "insufficient_data",
    "invalid_input",
    "failed_safe"
];
exports.COMMERCIAL_EVALUATION_DIMENSIONS = [
    "technicalValidity",
    "contextQuality",
    "runtimeQuality",
    "policyQuality",
    "commercialUsefulness",
    "safety",
    "latency",
    "cost",
    "observability",
    "readinessContribution"
];
exports.COMMERCIAL_EVALUATION_SEVERITIES = ["info", "warning", "error", "critical"];
exports.COMMERCIAL_EVALUATION_READINESS_DECISIONS = [
    "READY_FOR_CONTROLLED_PILOT",
    "NEEDS_POLICY_TUNING",
    "NEEDS_PROMPT_TUNING",
    "NEEDS_CONTEXT_IMPROVEMENT",
    "NEEDS_RUNTIME_STABILIZATION",
    "INSUFFICIENT_DATA",
    "NOT_READY"
];
exports.COMMERCIAL_EVALUATION_COMPONENTS = [
    "context",
    "prompt",
    "runtime",
    "policy",
    "safety",
    "latency",
    "cost",
    "observability",
    "data",
    "unknown"
];
exports.COMMERCIAL_EVALUATION_USEFULNESS = [
    "useful",
    "partially_useful",
    "not_useful",
    "cannot_determine"
];
exports.COMMERCIAL_EVALUATION_COMPARISON_STATUSES = [
    "aligned",
    "partially_aligned",
    "divergent",
    "not_comparable"
];
exports.COMMERCIAL_EVALUATION_RECOMMENDATION_PRIORITIES = ["low", "medium", "high", "critical"];
exports.COMMERCIAL_EVALUATION_ISSUE_CODES = [
    "EVAL-TECH-INVALID-SHADOW",
    "EVAL-TECH-RUNTIME-ERROR",
    "EVAL-TECH-TIMEOUT",
    "EVAL-TECH-VALIDATION-FAILED",
    "EVAL-CONTEXT-INCOMPLETE",
    "EVAL-CONTEXT-MISSING-EVIDENCE",
    "EVAL-CONTEXT-IDENTITY-CONFLICT",
    "EVAL-POLICY-OVERRESTRICTIVE",
    "EVAL-POLICY-CORRECT-BLOCK",
    "EVAL-POLICY-MISSING",
    "EVAL-MODEL-GENERIC-OUTPUT",
    "EVAL-MODEL-HARD-BLOCK-PROPOSAL",
    "EVAL-MODEL-LOW-CONFIDENCE",
    "EVAL-COMMERCIAL-NOT-USEFUL",
    "EVAL-COMMERCIAL-PARTIALLY-USEFUL",
    "EVAL-SAFETY-SIDE-EFFECT",
    "EVAL-SAFETY-SECRET-EXPOSURE",
    "EVAL-OBSERVABILITY-INCOMPLETE",
    "EVAL-DATA-INSUFFICIENT"
];
exports.COMMERCIAL_EVALUATION_DEFAULT_THRESHOLDS = {
    minimumSamples: 50,
    minimumEligibleSamples: 20,
    maxFailedSafeRate: 0.15,
    maxTimeoutRate: 0.05,
    maxProviderErrorRate: 0.1,
    maxValidationFailureRate: 0.1,
    maxBlockedRate: 0.75,
    maxRequiresReviewRate: 0.85,
    minimumUsefulRate: 0.55,
    minimumStructurallyValidRate: 0.85,
    minimumPolicyAppliedRate: 0.9,
    maximumP95LatencyMs: 5000,
    maximumAverageCost: 0.05,
    maximumCriticalIssues: 0,
    maximumSideEffectCount: 0,
    minimumComparableSamples: 20,
    minimumAlignmentRate: 0.6
};
exports.COMMERCIAL_EVALUATION_DEFAULT_MARKDOWN_TITLE = "# Commercial Evaluation Report";
