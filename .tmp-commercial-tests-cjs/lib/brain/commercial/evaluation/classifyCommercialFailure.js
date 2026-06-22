"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyCommercialFailure = classifyCommercialFailure;
const evaluationConstants_1 = require("./evaluationConstants");
function worstSeverity(left, right) {
    const order = new Map([
        ["info", 0],
        ["warning", 1],
        ["error", 2],
        ["critical", 3]
    ]);
    return (order.get(left) ?? 0) >= (order.get(right) ?? 0) ? left : right;
}
function severityForScore(score) {
    if (score >= 85)
        return "info";
    if (score >= 65)
        return "warning";
    if (score >= 40)
        return "error";
    return "critical";
}
function primaryComponentFromIssueCode(code) {
    if (code === "EVAL-SAFETY-SIDE-EFFECT" || code === "EVAL-SAFETY-SECRET-EXPOSURE")
        return "safety";
    if (code === "EVAL-TECH-RUNTIME-ERROR" || code === "EVAL-TECH-TIMEOUT" || code === "EVAL-TECH-VALIDATION-FAILED")
        return "runtime";
    if (code === "EVAL-CONTEXT-INCOMPLETE" || code === "EVAL-CONTEXT-MISSING-EVIDENCE" || code === "EVAL-CONTEXT-IDENTITY-CONFLICT")
        return "context";
    if (code === "EVAL-POLICY-OVERRESTRICTIVE" || code === "EVAL-POLICY-CORRECT-BLOCK" || code === "EVAL-POLICY-MISSING")
        return "policy";
    if (code === "EVAL-MODEL-GENERIC-OUTPUT" || code === "EVAL-MODEL-HARD-BLOCK-PROPOSAL" || code === "EVAL-MODEL-LOW-CONFIDENCE")
        return "prompt";
    if (code === "EVAL-OBSERVABILITY-INCOMPLETE")
        return "observability";
    if (code === "EVAL-DATA-INSUFFICIENT")
        return "data";
    if (code === "EVAL-COMMERCIAL-NOT-USEFUL" || code === "EVAL-COMMERCIAL-PARTIALLY-USEFUL")
        return "prompt";
    return "unknown";
}
function primaryComponentFromDimension(dimension) {
    if (dimension === "technicalValidity" || dimension === "runtimeQuality")
        return "runtime";
    if (dimension === "contextQuality")
        return "context";
    if (dimension === "policyQuality")
        return "policy";
    if (dimension === "commercialUsefulness")
        return "prompt";
    if (dimension === "safety")
        return "safety";
    if (dimension === "latency")
        return "latency";
    if (dimension === "cost")
        return "cost";
    if (dimension === "observability")
        return "observability";
    if (dimension === "readinessContribution")
        return "data";
    return "unknown";
}
function pickPrimaryIssue(issues) {
    if (issues.length === 0)
        return null;
    const sorted = [...issues].sort((left, right) => {
        const severityOrder = new Map([
            ["critical", 0],
            ["error", 1],
            ["warning", 2],
            ["info", 3]
        ]);
        const leftSeverity = severityOrder.get(left.severity) ?? 3;
        const rightSeverity = severityOrder.get(right.severity) ?? 3;
        if (leftSeverity !== rightSeverity)
            return leftSeverity - rightSeverity;
        return left.code.localeCompare(right.code);
    });
    return sorted[0] ?? null;
}
function bestDimension(dimensions) {
    return [...evaluationConstants_1.COMMERCIAL_EVALUATION_DIMENSIONS]
        .map((dimension) => dimensions[dimension])
        .sort((left, right) => left.score - right.score || left.dimension.localeCompare(right.dimension))[0] ?? null;
}
function classifyUsefulness(score, shadowResultSummary, comparisonStatus) {
    if (shadowResultSummary.status === "failed_safe" || shadowResultSummary.status === "context_failed" || shadowResultSummary.status === "runtime_failed" || shadowResultSummary.status === "policy_failed") {
        return "cannot_determine";
    }
    if (score >= 80 && comparisonStatus === "aligned")
        return "useful";
    if (score >= 45)
        return "partially_useful";
    if (score > 0)
        return "not_useful";
    return "cannot_determine";
}
function classifyCommercialFailure(input) {
    const primaryIssue = pickPrimaryIssue(input.issues);
    const primaryDimension = bestDimension(input.dimensions);
    const readinessScore = input.dimensions.readinessContribution.score;
    const contextScore = input.dimensions.contextQuality.score;
    const runtimeScore = input.dimensions.runtimeQuality.score;
    const policyScore = input.dimensions.policyQuality.score;
    const safetyScore = input.dimensions.safety.score;
    const usefulnessScore = input.dimensions.commercialUsefulness.score;
    const primaryComponent = primaryIssue ? primaryComponentFromIssueCode(primaryIssue.code) : primaryDimension ? primaryComponentFromDimension(primaryDimension.dimension) : "unknown";
    const severity = input.issues.reduce((current, issue) => worstSeverity(current, issue.severity), primaryIssue?.severity ?? severityForScore(readinessScore));
    const needsContextImprovement = contextScore < 60 || input.issues.some((issue) => issue.code === "EVAL-CONTEXT-INCOMPLETE" || issue.code === "EVAL-CONTEXT-MISSING-EVIDENCE" || issue.code === "EVAL-CONTEXT-IDENTITY-CONFLICT");
    const needsRuntimeStabilization = runtimeScore < 60 || input.issues.some((issue) => issue.code === "EVAL-TECH-RUNTIME-ERROR" || issue.code === "EVAL-TECH-TIMEOUT" || issue.code === "EVAL-TECH-VALIDATION-FAILED");
    const needsPolicyTuning = policyScore < 65 ||
        input.issues.some((issue) => issue.code === "EVAL-POLICY-OVERRESTRICTIVE" || issue.code === "EVAL-POLICY-MISSING" || issue.code === "EVAL-POLICY-CORRECT-BLOCK");
    const needsPromptTuning = usefulnessScore < 60 ||
        input.issues.some((issue) => issue.code === "EVAL-MODEL-GENERIC-OUTPUT" || issue.code === "EVAL-MODEL-HARD-BLOCK-PROPOSAL" || issue.code === "EVAL-MODEL-LOW-CONFIDENCE");
    const needsSafetyReview = safetyScore < 90 ||
        input.issues.some((issue) => issue.code === "EVAL-SAFETY-SIDE-EFFECT" || issue.code === "EVAL-SAFETY-SECRET-EXPOSURE");
    return {
        usefulness: classifyUsefulness(usefulnessScore, input.shadowResultSummary, input.comparison?.status ?? null),
        primaryComponent,
        primaryDimension: primaryDimension?.dimension ?? "unknown",
        primaryIssueCode: primaryIssue?.code ?? null,
        severity,
        reason: primaryIssue?.message ?? primaryDimension?.summary ?? "Commercial evaluation is inconclusive.",
        readinessContributionScore: readinessScore,
        needsPolicyTuning,
        needsPromptTuning,
        needsContextImprovement,
        needsRuntimeStabilization,
        needsSafetyReview
    };
}
