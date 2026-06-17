import { COMMERCIAL_POLICY_APPROVAL_REQUIREMENTS, COMMERCIAL_POLICY_RISK_LEVELS, COMMERCIAL_POLICY_STATUSES } from "../policy/policyConstants";
import { SALES_AGENT_APPROVAL_REQUIREMENTS, SALES_AGENT_OUTCOMES, SALES_AGENT_RISK_LEVELS } from "../salesAgentConstants";
import { SALES_AGENT_RUNTIME_STATUSES } from "../sales-agent/runtimeTypes";
import {
  COMMERCIAL_EVALUATION_DEFAULT_THRESHOLDS,
  COMMERCIAL_EVALUATION_DIMENSIONS,
  COMMERCIAL_EVALUATION_ISSUE_CODES,
  COMMERCIAL_EVALUATION_SEVERITIES,
  type CommercialEvaluationDimension,
  type CommercialEvaluationIssueCode,
  type CommercialEvaluationSeverity
} from "./evaluationConstants";
import type {
  CommercialDecisionComparison,
  CommercialEvaluationAggregate,
  CommercialEvaluationDatasetMetadata,
  CommercialEvaluationIssue,
  CommercialEvaluationResult,
  CommercialEvaluationThresholds,
  CommercialEvaluationVersionInfo
} from "./evaluationTypes";
import { buildTopEntries, createCounter, average, percentile, sum, uniqueStrings } from "./evaluationUtils";

function createStringCounter(keys: readonly string[]) {
  return keys.reduce<Record<string, number>>((accumulator, key) => {
    accumulator[key] = 0;
    return accumulator;
  }, {});
}

function mergeThresholds(thresholds: Partial<CommercialEvaluationThresholds> | undefined): CommercialEvaluationThresholds {
  return {
    ...COMMERCIAL_EVALUATION_DEFAULT_THRESHOLDS,
    ...(thresholds ?? {})
  };
}

function createVersionInfo(results: readonly CommercialEvaluationResult[]): CommercialEvaluationVersionInfo {
  const first = results[0];
  return (
    first?.versionInfo ?? {
      evaluationVersion: "brain.commercial.evaluation.v1",
      shadowVersion: "brain.commercial.shadow.v1",
      runtimeVersion: "sales-agent-runtime-dry-run-v0.1.0",
      policyVersion: "brain.commercial.policy.v1",
      contractVersion: "brain.commercial.policy.contract.v1",
      promptVersion: "sales-agent-runtime-v0.1.0"
    }
  );
}

function emptyDimensionSeverityDistribution() {
  return COMMERCIAL_EVALUATION_DIMENSIONS.reduce((dimensionAccumulator, dimension) => {
    dimensionAccumulator[dimension] = COMMERCIAL_EVALUATION_SEVERITIES.reduce((severityAccumulator, severity) => {
      severityAccumulator[severity] = 0;
      return severityAccumulator;
    }, {} as Record<CommercialEvaluationSeverity, number>);
    return dimensionAccumulator;
  }, {} as Record<CommercialEvaluationDimension, Record<CommercialEvaluationSeverity, number>>);
}

function emptyAggregate(
  datasetMetadata: CommercialEvaluationDatasetMetadata | null,
  thresholds: CommercialEvaluationThresholds,
  versionInfo: CommercialEvaluationVersionInfo
): CommercialEvaluationAggregate {
  const issueCounts = createCounter(COMMERCIAL_EVALUATION_ISSUE_CODES);
  const contextBlockingCauses = createCounter(COMMERCIAL_EVALUATION_ISSUE_CODES);
  const runtimeStatusDistribution = createStringCounter(SALES_AGENT_RUNTIME_STATUSES);
  const outcomeDistribution = createStringCounter(SALES_AGENT_OUTCOMES);
  const policyStatusDistribution = createStringCounter(COMMERCIAL_POLICY_STATUSES);
  const approvalRequirementDistribution = createStringCounter(
    uniqueStrings([...SALES_AGENT_APPROVAL_REQUIREMENTS, ...COMMERCIAL_POLICY_APPROVAL_REQUIREMENTS])
  );
  const riskLevelDistribution = createStringCounter(uniqueStrings([...SALES_AGENT_RISK_LEVELS, ...COMMERCIAL_POLICY_RISK_LEVELS]));

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
    dimensionAverages: COMMERCIAL_EVALUATION_DIMENSIONS.reduce((accumulator, dimension) => {
      accumulator[dimension] = 0;
      return accumulator;
    }, {} as Record<CommercialEvaluationDimension, number>),
    dimensionSeverityDistribution: emptyDimensionSeverityDistribution(),
    topIssues: [],
    topRules: [],
    topWarnings: [],
    topErrors: [],
    productiveDecisions: [],
    decisionsBySample: []
  };
}

function increment(counter: Record<string, number>, key: string, amount = 1) {
  counter[key] = (counter[key] ?? 0) + amount;
}

export function aggregateCommercialEvaluations(
  results: readonly CommercialEvaluationResult[],
  options: {
    datasetMetadata?: CommercialEvaluationDatasetMetadata | null;
    thresholds?: Partial<CommercialEvaluationThresholds>;
  } = {}
): CommercialEvaluationAggregate {
  const thresholds = mergeThresholds(options.thresholds);
  const versionInfo = createVersionInfo(results);
  if (results.length === 0) {
    return emptyAggregate(options.datasetMetadata ?? null, thresholds, versionInfo);
  }

  const aggregate = emptyAggregate(options.datasetMetadata ?? null, thresholds, versionInfo);
  const issueRepresentative = new Map<CommercialEvaluationIssueCode, CommercialEvaluationIssue>();
  const comparisons: CommercialDecisionComparison[] = [];

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

  const allClaimCounts: Record<string, number> = {};
  const allBlockedClaimCounts: Record<string, number> = {};
  const allActionCounts: Record<string, number> = {};
  const allBlockedActionCounts: Record<string, number> = {};
  const allToolCounts: Record<string, number> = {};
  const allBlockedToolCounts: Record<string, number> = {};
  const allEntityCounts: Record<string, number> = {};
  const allBlockedEntityCounts: Record<string, number> = {};

  const runtimeSamples: number[] = [];
  const inputTokensSamples: number[] = [];
  const outputTokensSamples: number[] = [];
  const costSamples: number[] = [];

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
    if (result.metrics.estimatedCost !== null) costSamples.push(result.metrics.estimatedCost);

    increment(aggregate.runtimeStatusDistribution, result.metrics.runtimeStatus ?? "completed_valid");
    increment(aggregate.outcomeDistribution, result.metrics.outcome ?? "failed_safe");
    increment(aggregate.policyStatusDistribution, result.metrics.policyStatus ?? "failed_safe");
    increment(aggregate.approvalRequirementDistribution, result.metrics.approvalRequirement ?? "none");
    increment(aggregate.riskLevelDistribution, String(result.metrics.riskLevel ?? "low"));

    for (const dimension of COMMERCIAL_EVALUATION_DIMENSIONS) {
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
      } else {
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
      if (result.comparison.status === "aligned") aggregate.comparison.aligned += 1;
      else if (result.comparison.status === "partially_aligned") aggregate.comparison.partiallyAligned += 1;
      else if (result.comparison.status === "divergent") aggregate.comparison.divergent += 1;
      else aggregate.comparison.notComparable += 1;
    } else {
      aggregate.comparison.notComparable += 1;
    }

    aggregate.decisionsBySample.push({
      sampleId: result.sampleId,
      comparisonStatus: result.comparison?.status ?? "not_comparable",
      classification: result.classification
    });
  }

  for (const dimension of COMMERCIAL_EVALUATION_DIMENSIONS) {
    aggregate.dimensionAverages[dimension] = aggregate.dimensionAverages[dimension] / aggregate.sampleCount;
  }

  aggregate.claimCountsByType = allClaimCounts;
  aggregate.blockedClaimRate = aggregate.totalObserved > 0 ? sum(Object.values(allBlockedClaimCounts)) / Math.max(1, sum(Object.values(allClaimCounts)) + sum(Object.values(allBlockedClaimCounts))) : 0;
  aggregate.actionCountsByType = allActionCounts;
  aggregate.blockedActionRate = aggregate.totalObserved > 0 ? sum(Object.values(allBlockedActionCounts)) / Math.max(1, sum(Object.values(allActionCounts)) + sum(Object.values(allBlockedActionCounts))) : 0;
  aggregate.toolRequestCountsByType = allToolCounts;
  aggregate.blockedToolRate = aggregate.totalObserved > 0 ? sum(Object.values(allBlockedToolCounts)) / Math.max(1, sum(Object.values(allToolCounts)) + sum(Object.values(allBlockedToolCounts))) : 0;
  aggregate.entityProposalCountsByType = allEntityCounts;
  aggregate.blockedEntityProposalRate = aggregate.totalObserved > 0 ? sum(Object.values(allBlockedEntityCounts)) / Math.max(1, sum(Object.values(allEntityCounts)) + sum(Object.values(allBlockedEntityCounts))) : 0;
  aggregate.comparison.alignmentRate = aggregate.comparison.aligned + aggregate.comparison.partiallyAligned + aggregate.comparison.divergent > 0
    ? aggregate.comparison.aligned / (aggregate.comparison.aligned + aggregate.comparison.partiallyAligned + aggregate.comparison.divergent)
    : null;
  aggregate.latency = {
    p50: percentile(runtimeSamples, 0.5),
    p90: percentile(runtimeSamples, 0.9),
    p95: percentile(runtimeSamples, 0.95),
    max: runtimeSamples.length > 0 ? Math.max(...runtimeSamples) : null,
    average: average(runtimeSamples)
  };
  aggregate.tokens = {
    averageInput: average(inputTokensSamples),
    averageOutput: average(outputTokensSamples),
    totalInput: sum(inputTokensSamples),
    totalOutput: sum(outputTokensSamples)
  };
  aggregate.cost = {
    average: average(costSamples),
    total: sum(costSamples),
    measuredSamples: costSamples.length,
    missingSamples: aggregate.sampleCount - costSamples.length
  };
  aggregate.topIssues = [...issueRepresentative.values()].sort((left, right) => {
    const leftCount = aggregate.issueCounts[left.code] ?? 0;
    const rightCount = aggregate.issueCounts[right.code] ?? 0;
    return rightCount - leftCount || left.code.localeCompare(right.code);
  }).slice(0, 5);
  aggregate.topRules = buildTopEntries(aggregate.policyRuleCounts, "ruleId", 10).map((entry) => ({
    ruleId: String(entry.ruleId),
    count: entry.count
  }));
  aggregate.topWarnings = buildTopEntries(aggregate.warningCounts, "warning", 10).map((entry) => ({
    warning: String(entry.warning),
    count: entry.count
  }));
  aggregate.topErrors = buildTopEntries(aggregate.errorCounts, "error", 10).map((entry) => ({
    error: String(entry.error),
    count: entry.count
  }));
  aggregate.productiveDecisions = comparisons;

  return aggregate;
}
