"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aggregateCommercialEvaluations = aggregateCommercialEvaluations;
const policyConstants_1 = require("../policy/policyConstants");
const salesAgentConstants_1 = require("../salesAgentConstants");
const runtimeTypes_1 = require("../sales-agent/runtimeTypes");
const evaluationConstants_1 = require("./evaluationConstants");
const evaluationUtils_1 = require("./evaluationUtils");
function createStringCounter(keys) {
    return keys.reduce((accumulator, key) => {
        accumulator[key] = 0;
        return accumulator;
    }, {});
}
function mergeThresholds(thresholds) {
    return {
        ...evaluationConstants_1.COMMERCIAL_EVALUATION_DEFAULT_THRESHOLDS,
        ...(thresholds ?? {})
    };
}
function createVersionInfo(results) {
    const first = results[0];
    return (first?.versionInfo ?? {
        evaluationVersion: "brain.commercial.evaluation.v1",
        shadowVersion: "brain.commercial.shadow.v1",
        runtimeVersion: "sales-agent-runtime-dry-run-v0.1.0",
        policyVersion: "brain.commercial.policy.v1",
        contractVersion: "brain.commercial.policy.contract.v1",
        promptVersion: "sales-agent-runtime-v0.1.0"
    });
}
function emptyDimensionSeverityDistribution() {
    return evaluationConstants_1.COMMERCIAL_EVALUATION_DIMENSIONS.reduce((dimensionAccumulator, dimension) => {
        dimensionAccumulator[dimension] = evaluationConstants_1.COMMERCIAL_EVALUATION_SEVERITIES.reduce((severityAccumulator, severity) => {
            severityAccumulator[severity] = 0;
            return severityAccumulator;
        }, {});
        return dimensionAccumulator;
    }, {});
}
function emptyAggregate(datasetMetadata, thresholds, versionInfo) {
    const issueCounts = (0, evaluationUtils_1.createCounter)(evaluationConstants_1.COMMERCIAL_EVALUATION_ISSUE_CODES);
    const contextBlockingCauses = (0, evaluationUtils_1.createCounter)(evaluationConstants_1.COMMERCIAL_EVALUATION_ISSUE_CODES);
    const runtimeStatusDistribution = createStringCounter(runtimeTypes_1.SALES_AGENT_RUNTIME_STATUSES);
    const outcomeDistribution = createStringCounter(salesAgentConstants_1.SALES_AGENT_OUTCOMES);
    const policyStatusDistribution = createStringCounter(policyConstants_1.COMMERCIAL_POLICY_STATUSES);
    const approvalRequirementDistribution = createStringCounter((0, evaluationUtils_1.uniqueStrings)([...salesAgentConstants_1.SALES_AGENT_APPROVAL_REQUIREMENTS, ...policyConstants_1.COMMERCIAL_POLICY_APPROVAL_REQUIREMENTS]));
    const riskLevelDistribution = createStringCounter((0, evaluationUtils_1.uniqueStrings)([...salesAgentConstants_1.SALES_AGENT_RISK_LEVELS, ...policyConstants_1.COMMERCIAL_POLICY_RISK_LEVELS]));
    return {
        datasetMetadata,
        versionInfo,
        thresholds,
        sampleCount: 0,
        totalObserved: 0,
        totalEligible: 0,
        totalSkipped: 0,
        totalCompleted: 0,
        totalFailedSafe: 0,
        totalInsufficientData: 0,
        totalInvalidInput: 0,
        eligibilityRate: 0,
        completionRate: 0,
        errorRate: 0,
        timeoutRate: 0,
        runtimeStatusDistribution,
        outcomeDistribution,
        policyStatusDistribution,
        approvalRequirementDistribution,
        riskLevelDistribution,
        allowedRate: 0,
        allowedWithRestrictionsRate: 0,
        requiresReviewRate: 0,
        blockedRate: 0,
        failedSafeRate: 0,
        claimCountsByType: {},
        blockedClaimRate: 0,
        actionCountsByType: {},
        blockedActionRate: 0,
        toolRequestCountsByType: {},
        blockedToolRate: 0,
        entityProposalCountsByType: {},
        blockedEntityProposalRate: 0,
        contextBlockingCauses,
        policyRuleCounts: {},
        warningCounts: {},
        errorCounts: {},
        issueCounts,
        latency: {
            p50: null,
            p90: null,
            p95: null,
            max: null,
            average: null
        },
        tokens: {
            averageInput: null,
            averageOutput: null,
            totalInput: null,
            totalOutput: null
        },
        cost: {
            average: null,
            total: null,
            measuredSamples: 0,
            missingSamples: 0
        },
        coverage: {
            samplesWithPolicy: 0,
            samplesWithRuntime: 0,
            samplesWithValidation: 0,
            samplesWithComparison: 0,
            samplesWithSideEffects: 0,
            samplesWithIncompleteData: 0,
            samplesWithMissingCost: 0,
            samplesWithMissingTokens: 0,
            synthetic: Boolean(datasetMetadata?.synthetic)
        },
        comparison: {
            aligned: 0,
            partiallyAligned: 0,
            divergent: 0,
            notComparable: 0,
            alignmentRate: null
        },
        dimensionAverages: evaluationConstants_1.COMMERCIAL_EVALUATION_DIMENSIONS.reduce((accumulator, dimension) => {
            accumulator[dimension] = 0;
            return accumulator;
        }, {}),
        dimensionSeverityDistribution: emptyDimensionSeverityDistribution(),
        topIssues: [],
        topRules: [],
        topWarnings: [],
        topErrors: [],
        productiveDecisions: [],
        decisionsBySample: []
    };
}
function increment(counter, key, amount = 1) {
    counter[key] = (counter[key] ?? 0) + amount;
}
function aggregateCommercialEvaluations(results, options = {}) {
    const thresholds = mergeThresholds(options.thresholds);
    const versionInfo = createVersionInfo(results);
    if (results.length === 0) {
        return emptyAggregate(options.datasetMetadata ?? null, thresholds, versionInfo);
    }
    const aggregate = emptyAggregate(options.datasetMetadata ?? null, thresholds, versionInfo);
    const issueRepresentative = new Map();
    const comparisons = [];
    aggregate.sampleCount = results.length;
    aggregate.totalObserved = results.length;
    aggregate.totalEligible = results.filter((result) => result.shadowResultSummary.eligible).length;
    aggregate.totalSkipped = results.filter((result) => result.shadowResultSummary.status === "skipped" || result.shadowResultSummary.status === "disabled").length;
    aggregate.totalCompleted = results.filter((result) => result.shadowResultSummary.status === "completed" || result.shadowResultSummary.status === "completed_with_restrictions").length;
    aggregate.totalFailedSafe = results.filter((result) => result.shadowResultSummary.status === "failed_safe" || result.shadowResultSummary.status === "context_failed" || result.shadowResultSummary.status === "runtime_failed" || result.shadowResultSummary.status === "policy_failed").length;
    aggregate.totalInsufficientData = results.filter((result) => result.status === "insufficient_data").length;
    aggregate.totalInvalidInput = results.filter((result) => result.status === "invalid_input").length;
    aggregate.eligibilityRate = aggregate.totalEligible / aggregate.totalObserved;
    aggregate.completionRate = aggregate.totalEligible > 0 ? aggregate.totalCompleted / aggregate.totalEligible : 0;
    aggregate.errorRate = (aggregate.totalFailedSafe + aggregate.totalInvalidInput) / aggregate.totalObserved;
    aggregate.timeoutRate = results.filter((result) => result.metrics.timeout).length / aggregate.totalObserved;
    aggregate.allowedRate = aggregate.totalObserved > 0 ? results.filter((result) => result.shadowResultSummary.policyStatus === "allowed").length / aggregate.totalObserved : 0;
    aggregate.allowedWithRestrictionsRate = aggregate.totalObserved > 0 ? results.filter((result) => result.shadowResultSummary.policyStatus === "allowed_with_restrictions").length / aggregate.totalObserved : 0;
    aggregate.requiresReviewRate = aggregate.totalObserved > 0 ? results.filter((result) => result.shadowResultSummary.policyStatus === "requires_review").length / aggregate.totalObserved : 0;
    aggregate.blockedRate = aggregate.totalObserved > 0 ? results.filter((result) => result.shadowResultSummary.policyStatus === "blocked").length / aggregate.totalObserved : 0;
    aggregate.failedSafeRate = aggregate.totalObserved > 0 ? results.filter((result) => result.shadowResultSummary.policyStatus === "failed_safe").length / aggregate.totalObserved : 0;
    const allClaimCounts = {};
    const allBlockedClaimCounts = {};
    const allActionCounts = {};
    const allBlockedActionCounts = {};
    const allToolCounts = {};
    const allBlockedToolCounts = {};
    const allEntityCounts = {};
    const allBlockedEntityCounts = {};
    const runtimeSamples = [];
    const inputTokensSamples = [];
    const outputTokensSamples = [];
    const costSamples = [];
    for (const result of results) {
        aggregate.coverage.samplesWithPolicy += result.metrics.hasPolicyResult ? 1 : 0;
        aggregate.coverage.samplesWithRuntime += result.metrics.hasRuntimeResult ? 1 : 0;
        aggregate.coverage.samplesWithValidation += result.metrics.hasValidationResult ? 1 : 0;
        aggregate.coverage.samplesWithComparison += result.comparison ? 1 : 0;
        aggregate.coverage.samplesWithSideEffects += result.metrics.sideEffectsCount > 0 ? 1 : 0;
        aggregate.coverage.samplesWithIncompleteData += result.status === "insufficient_data" ? 1 : 0;
        aggregate.coverage.samplesWithMissingCost += result.metrics.estimatedCost === null ? 1 : 0;
        aggregate.coverage.samplesWithMissingTokens += result.metrics.inputTokens === null || result.metrics.outputTokens === null ? 1 : 0;
        runtimeSamples.push(result.metrics.durationTotalMs ?? 0);
        inputTokensSamples.push(result.metrics.inputTokens ?? 0);
        outputTokensSamples.push(result.metrics.outputTokens ?? 0);
        if (result.metrics.estimatedCost !== null)
            costSamples.push(result.metrics.estimatedCost);
        increment(aggregate.runtimeStatusDistribution, result.metrics.runtimeStatus ?? "completed_valid");
        increment(aggregate.outcomeDistribution, result.metrics.outcome ?? "failed_safe");
        increment(aggregate.policyStatusDistribution, result.metrics.policyStatus ?? "failed_safe");
        increment(aggregate.approvalRequirementDistribution, result.metrics.approvalRequirement ?? "none");
        increment(aggregate.riskLevelDistribution, String(result.metrics.riskLevel ?? "low"));
        for (const dimension of evaluationConstants_1.COMMERCIAL_EVALUATION_DIMENSIONS) {
            aggregate.dimensionAverages[dimension] += result.dimensions[dimension].score;
            aggregate.dimensionSeverityDistribution[dimension][result.dimensions[dimension].severity] += 1;
        }
        for (const issue of result.issues) {
            aggregate.issueCounts[issue.code] += 1;
            if (issue.dimension === "context" || issue.dimension === "policy" || issue.dimension === "runtime" || issue.dimension === "safety") {
                aggregate.contextBlockingCauses[issue.code] += 1;
            }
            if (issue.severity === "warning" || issue.severity === "info") {
                increment(aggregate.warningCounts, issue.code);
            }
            else {
                increment(aggregate.errorCounts, issue.code);
            }
            if (!issueRepresentative.has(issue.code)) {
                issueRepresentative.set(issue.code, issue);
            }
        }
        for (const warning of result.warnings) {
            increment(aggregate.warningCounts, warning);
        }
        for (const ruleId of result.metrics.appliedPolicyRules) {
            increment(aggregate.policyRuleCounts, ruleId);
        }
        for (const [claimType, count] of Object.entries(result.metrics.claimCountsByType)) {
            increment(allClaimCounts, claimType, count);
        }
        for (const [claimType, count] of Object.entries(result.metrics.blockedClaimCountsByType)) {
            increment(allBlockedClaimCounts, claimType, count);
        }
        for (const [actionType, count] of Object.entries(result.metrics.actionCountsByType)) {
            increment(allActionCounts, actionType, count);
        }
        for (const [actionType, count] of Object.entries(result.metrics.blockedActionCountsByType)) {
            increment(allBlockedActionCounts, actionType, count);
        }
        for (const [toolName, count] of Object.entries(result.metrics.toolRequestCountsByType)) {
            increment(allToolCounts, toolName, count);
        }
        for (const [toolName, count] of Object.entries(result.metrics.blockedToolRequestCountsByType)) {
            increment(allBlockedToolCounts, toolName, count);
        }
        for (const [entityType, count] of Object.entries(result.metrics.entityProposalCountsByType)) {
            increment(allEntityCounts, entityType, count);
        }
        for (const [entityType, count] of Object.entries(result.metrics.blockedEntityProposalCountsByType)) {
            increment(allBlockedEntityCounts, entityType, count);
        }
        if (result.comparison) {
            comparisons.push(result.comparison);
            if (result.comparison.status === "aligned")
                aggregate.comparison.aligned += 1;
            else if (result.comparison.status === "partially_aligned")
                aggregate.comparison.partiallyAligned += 1;
            else if (result.comparison.status === "divergent")
                aggregate.comparison.divergent += 1;
            else
                aggregate.comparison.notComparable += 1;
        }
        else {
            aggregate.comparison.notComparable += 1;
        }
        aggregate.decisionsBySample.push({
            sampleId: result.sampleId,
            comparisonStatus: result.comparison?.status ?? "not_comparable",
            classification: result.classification
        });
    }
    for (const dimension of evaluationConstants_1.COMMERCIAL_EVALUATION_DIMENSIONS) {
        aggregate.dimensionAverages[dimension] = aggregate.dimensionAverages[dimension] / aggregate.sampleCount;
    }
    aggregate.claimCountsByType = allClaimCounts;
    aggregate.blockedClaimRate = aggregate.totalObserved > 0 ? (0, evaluationUtils_1.sum)(Object.values(allBlockedClaimCounts)) / Math.max(1, (0, evaluationUtils_1.sum)(Object.values(allClaimCounts)) + (0, evaluationUtils_1.sum)(Object.values(allBlockedClaimCounts))) : 0;
    aggregate.actionCountsByType = allActionCounts;
    aggregate.blockedActionRate = aggregate.totalObserved > 0 ? (0, evaluationUtils_1.sum)(Object.values(allBlockedActionCounts)) / Math.max(1, (0, evaluationUtils_1.sum)(Object.values(allActionCounts)) + (0, evaluationUtils_1.sum)(Object.values(allBlockedActionCounts))) : 0;
    aggregate.toolRequestCountsByType = allToolCounts;
    aggregate.blockedToolRate = aggregate.totalObserved > 0 ? (0, evaluationUtils_1.sum)(Object.values(allBlockedToolCounts)) / Math.max(1, (0, evaluationUtils_1.sum)(Object.values(allToolCounts)) + (0, evaluationUtils_1.sum)(Object.values(allBlockedToolCounts))) : 0;
    aggregate.entityProposalCountsByType = allEntityCounts;
    aggregate.blockedEntityProposalRate = aggregate.totalObserved > 0 ? (0, evaluationUtils_1.sum)(Object.values(allBlockedEntityCounts)) / Math.max(1, (0, evaluationUtils_1.sum)(Object.values(allEntityCounts)) + (0, evaluationUtils_1.sum)(Object.values(allBlockedEntityCounts))) : 0;
    aggregate.comparison.alignmentRate = aggregate.comparison.aligned + aggregate.comparison.partiallyAligned + aggregate.comparison.divergent > 0
        ? aggregate.comparison.aligned / (aggregate.comparison.aligned + aggregate.comparison.partiallyAligned + aggregate.comparison.divergent)
        : null;
    aggregate.latency = {
        p50: (0, evaluationUtils_1.percentile)(runtimeSamples, 0.5),
        p90: (0, evaluationUtils_1.percentile)(runtimeSamples, 0.9),
        p95: (0, evaluationUtils_1.percentile)(runtimeSamples, 0.95),
        max: runtimeSamples.length > 0 ? Math.max(...runtimeSamples) : null,
        average: (0, evaluationUtils_1.average)(runtimeSamples)
    };
    aggregate.tokens = {
        averageInput: (0, evaluationUtils_1.average)(inputTokensSamples),
        averageOutput: (0, evaluationUtils_1.average)(outputTokensSamples),
        totalInput: (0, evaluationUtils_1.sum)(inputTokensSamples),
        totalOutput: (0, evaluationUtils_1.sum)(outputTokensSamples)
    };
    aggregate.cost = {
        average: (0, evaluationUtils_1.average)(costSamples),
        total: (0, evaluationUtils_1.sum)(costSamples),
        measuredSamples: costSamples.length,
        missingSamples: aggregate.sampleCount - costSamples.length
    };
    aggregate.topIssues = [...issueRepresentative.values()].sort((left, right) => {
        const leftCount = aggregate.issueCounts[left.code] ?? 0;
        const rightCount = aggregate.issueCounts[right.code] ?? 0;
        return rightCount - leftCount || left.code.localeCompare(right.code);
    }).slice(0, 5);
    aggregate.topRules = (0, evaluationUtils_1.buildTopEntries)(aggregate.policyRuleCounts, "ruleId", 10).map((entry) => ({
        ruleId: String(entry.ruleId),
        count: entry.count
    }));
    aggregate.topWarnings = (0, evaluationUtils_1.buildTopEntries)(aggregate.warningCounts, "warning", 10).map((entry) => ({
        warning: String(entry.warning),
        count: entry.count
    }));
    aggregate.topErrors = (0, evaluationUtils_1.buildTopEntries)(aggregate.errorCounts, "error", 10).map((entry) => ({
        error: String(entry.error),
        count: entry.count
    }));
    aggregate.productiveDecisions = comparisons;
    return aggregate;
}
