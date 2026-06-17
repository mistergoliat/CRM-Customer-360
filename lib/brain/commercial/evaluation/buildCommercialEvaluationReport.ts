import { COMMERCIAL_EVALUATION_DEFAULT_MARKDOWN_TITLE, type CommercialEvaluationIssueCode, type CommercialReadinessDecision } from "./evaluationConstants";
import type { CommercialEvaluationAggregate, CommercialEvaluationIssue, CommercialEvaluationRecommendation, CommercialEvaluationReport } from "./evaluationTypes";
import { decideCommercialReadiness } from "./decideCommercialReadiness";
import { uniqueStrings } from "./evaluationUtils";

function formatNumber(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "unknown";
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "unknown";
  return `${formatNumber(value * 100, 1)}%`;
}

function issueLabel(issue: CommercialEvaluationIssue) {
  return `${issue.code}: ${issue.message}`;
}

function recommendationLabel(recommendation: CommercialEvaluationRecommendation) {
  return `${recommendation.component} [${recommendation.priority}]: ${recommendation.title}`;
}

function nextStepForDecision(decision: CommercialReadinessDecision) {
  if (decision === "READY_FOR_CONTROLLED_PILOT") {
    return "Prepare a controlled pilot milestone with representative real samples and explicit guardrails.";
  }
  if (decision === "NEEDS_POLICY_TUNING") {
    return "Tune policy thresholds and allowlist rules before considering a pilot.";
  }
  if (decision === "NEEDS_PROMPT_TUNING") {
    return "Tighten the prompt contract and model guidance, then rerun the evaluation.";
  }
  if (decision === "NEEDS_CONTEXT_IMPROVEMENT") {
    return "Improve commercial context coverage and rerun with richer samples.";
  }
  if (decision === "NEEDS_RUNTIME_STABILIZATION") {
    return "Stabilize runtime failures, timeouts, and validation issues before rerunning.";
  }
  if (decision === "INSUFFICIENT_DATA") {
    return "Collect more representative, non-synthetic samples and rerun the offline evaluation.";
  }
  return "Keep the system in shadow and clear the blockers before any pilot.";
}

function buildMarkdown(report: Omit<CommercialEvaluationReport, "markdown">) {
  const topIssues = report.topIssues.length > 0 ? report.topIssues.map((issue) => `- ${issueLabel(issue)}`).join("\n") : "- none";
  const blockers = report.blockers.length > 0 ? report.blockers.map((blocker) => `- ${blocker}`).join("\n") : "- none";
  const recommendations = report.recommendations.length > 0 ? report.recommendations.map((recommendation) => `- ${recommendationLabel(recommendation)}: ${recommendation.reason}`).join("\n") : "- none";
  const evidence = report.evidence.length > 0 ? report.evidence.map((item) => `- ${item}`).join("\n") : "- none";

  return [
    COMMERCIAL_EVALUATION_DEFAULT_MARKDOWN_TITLE,
    "",
    `Readiness decision: **${report.readinessDecision}**`,
    "",
    `Executive summary: ${report.executiveSummary}`,
    "",
    "## Dataset Coverage",
    `- samples: ${report.datasetCoverage.sampleCount}`,
    `- eligible: ${report.datasetCoverage.eligibleSamples}`,
    `- skipped: ${report.datasetCoverage.skippedSamples}`,
    `- completed: ${report.datasetCoverage.completedSamples}`,
    `- failed-safe: ${report.datasetCoverage.failedSafeSamples}`,
    `- synthetic: ${report.datasetCoverage.synthetic ? "yes" : "no"}`,
    "",
    "## Technical Health",
    `- structurally valid rate: ${formatPercent(report.technicalHealth.structurallyValidRate)}`,
    `- failed-safe rate: ${formatPercent(report.technicalHealth.failedSafeRate)}`,
    `- timeout rate: ${formatPercent(report.technicalHealth.timeoutRate)}`,
    `- error rate: ${formatPercent(report.technicalHealth.errorRate)}`,
    "",
    "## Context Quality",
    `- average score: ${formatNumber(report.contextQuality.averageScore)}`,
    `- notes: ${report.contextQuality.coverageNotes.join("; ") || "none"}`,
    "",
    "## Model / Runtime",
    `- average score: ${formatNumber(report.modelRuntimeQuality.averageScore)}`,
    `- runtime statuses: ${JSON.stringify(report.modelRuntimeQuality.runtimeStatusDistribution)}`,
    "",
    "## Policy Behavior",
    `- average score: ${formatNumber(report.policyBehavior.averageScore)}`,
    `- policy statuses: ${JSON.stringify(report.policyBehavior.policyStatusDistribution)}`,
    `- top rules: ${JSON.stringify(report.topRules)}`,
    "",
    "## Commercial Usefulness",
    `- average score: ${formatNumber(report.commercialUsefulness.averageScore)}`,
    `- usefulness: ${report.commercialUsefulness.usefulness}`,
    "",
    "## Safety",
    `- average score: ${formatNumber(report.safety.averageScore)}`,
    `- critical issues: ${report.safety.criticalIssueCount}`,
    "",
    "## Latency",
    `- p95: ${formatNumber(report.latency.p95)} ms`,
    `- within budget: ${report.latency.withinBudget ? "yes" : "no"}`,
    "",
    "## Cost",
    `- average: ${formatNumber(report.cost.average)}`,
    `- total: ${formatNumber(report.cost.total)}`,
    `- measured samples: ${report.cost.measuredSamples}`,
    "",
    "## Top Issues",
    topIssues,
    "",
    "## Blockers",
    blockers,
    "",
    "## Recommendations",
    recommendations,
    "",
    "## Evidence",
    evidence,
    "",
    `Next step: ${report.nextStep}`
  ].join("\n");
}

function buildCoverageNotes(aggregate: CommercialEvaluationAggregate) {
  const notes = [
    aggregate.coverage.synthetic ? "Synthetic dataset." : "Non-synthetic dataset.",
    aggregate.coverage.samplesWithMissingCost > 0 ? "Some samples do not have measured cost." : "Cost measured in all samples.",
    aggregate.coverage.samplesWithMissingTokens > 0 ? "Some samples are missing token counts." : "Token counts are available for all samples."
  ];
  return uniqueStrings(notes);
}

function buildTopIssues(aggregate: CommercialEvaluationAggregate) {
  return aggregate.topIssues.slice(0, 5);
}

function buildTopRules(aggregate: CommercialEvaluationAggregate) {
  return aggregate.topRules.slice(0, 10);
}

function buildRecommendations(aggregate: CommercialEvaluationAggregate, readinessDecision: CommercialReadinessDecision): CommercialEvaluationRecommendation[] {
  if (aggregate.topIssues.length === 0) {
    return [
      {
        component: "data",
        priority: readinessDecision === "READY_FOR_CONTROLLED_PILOT" ? "low" : "medium",
        title: "Continue collecting representative samples",
        reason: "The evaluation is still dominated by synthetic or incomplete data.",
        evidence: [],
        issueCodes: []
      }
    ];
  }

  return aggregate.topIssues.slice(0, 3).map((issue, index) => ({
    component: issue.component,
    priority: index === 0 ? "critical" : index === 1 ? "high" : "medium",
    title: issue.code,
    reason: issue.message,
    evidence: [issue.message],
    issueCodes: [issue.code as CommercialEvaluationIssueCode]
  }));
}

export function buildCommercialEvaluationReport(aggregate: CommercialEvaluationAggregate): CommercialEvaluationReport {
  const readiness = decideCommercialReadiness(aggregate);
  const topIssues = buildTopIssues(aggregate);
  const topRules = buildTopRules(aggregate);
  const recommendations = buildRecommendations(aggregate, readiness.decision);
  const coverageNotes = buildCoverageNotes(aggregate);
  const usefulScore = aggregate.dimensionAverages.commercialUsefulness;
  const structuredReport: Omit<CommercialEvaluationReport, "markdown"> = {
    generatedAt: aggregate.datasetMetadata?.generatedAt ?? "1970-01-01T00:00:00.000Z",
    datasetMetadata: aggregate.datasetMetadata,
    versionInfo: aggregate.versionInfo,
    thresholds: aggregate.thresholds,
    readinessDecision: readiness.decision,
    executiveSummary:
      readiness.decision === "READY_FOR_CONTROLLED_PILOT"
        ? "The commercial shadow is stable enough for a controlled pilot."
        : readiness.decision === "INSUFFICIENT_DATA"
          ? "The synthetic dataset is not enough to approve a pilot."
          : `The commercial shadow requires attention before any pilot: ${readiness.notes[0] ?? "unresolved blockers remain."}`,
    datasetCoverage: {
      sampleCount: aggregate.sampleCount,
      eligibleSamples: aggregate.totalEligible,
      skippedSamples: aggregate.totalSkipped,
      completedSamples: aggregate.totalCompleted,
      failedSafeSamples: aggregate.totalFailedSafe,
      insufficientDataSamples: aggregate.totalInsufficientData,
      invalidInputSamples: aggregate.totalInvalidInput,
      synthetic: aggregate.coverage.synthetic
    },
    technicalHealth: {
      structurallyValidRate: aggregate.sampleCount > 0 ? aggregate.coverage.samplesWithValidation / aggregate.sampleCount : 0,
      failedSafeRate: aggregate.failedSafeRate,
      timeoutRate: aggregate.timeoutRate,
      errorRate: aggregate.errorRate,
      runtimeStatusDistribution: aggregate.runtimeStatusDistribution
    },
    contextQuality: {
      averageScore: aggregate.dimensionAverages.contextQuality,
      topIssues: topIssues.filter((issue) => issue.dimension === "context"),
      coverageNotes
    },
    modelRuntimeQuality: {
      averageScore: aggregate.dimensionAverages.runtimeQuality,
      runtimeStatusDistribution: aggregate.runtimeStatusDistribution,
      topIssues: topIssues.filter((issue) => issue.component === "runtime" || issue.component === "prompt")
    },
    policyBehavior: {
      averageScore: aggregate.dimensionAverages.policyQuality,
      policyStatusDistribution: aggregate.policyStatusDistribution,
      topRules,
      topIssues: topIssues.filter((issue) => issue.dimension === "policy")
    },
    commercialUsefulness: {
      averageScore: usefulScore,
      usefulness:
        usefulScore >= 80
          ? "useful"
          : usefulScore >= 45
            ? "partially_useful"
            : usefulScore > 0
              ? "not_useful"
              : "cannot_determine",
      topIssues: topIssues.filter((issue) => issue.dimension === "commercialUsefulness" || issue.component === "prompt")
    },
    safety: {
      averageScore: aggregate.dimensionAverages.safety,
      criticalIssueCount: aggregate.topIssues.filter((issue) => issue.severity === "critical").length,
      topIssues: topIssues.filter((issue) => issue.dimension === "safety")
    },
    latency: {
      p50: aggregate.latency.p50,
      p90: aggregate.latency.p90,
      p95: aggregate.latency.p95,
      max: aggregate.latency.max,
      average: aggregate.latency.average,
      withinBudget: aggregate.latency.p95 !== null && aggregate.latency.p95 <= aggregate.thresholds.maximumP95LatencyMs
    },
    cost: {
      average: aggregate.cost.average,
      total: aggregate.cost.total,
      measuredSamples: aggregate.cost.measuredSamples,
      missingSamples: aggregate.cost.missingSamples,
      withinBudget: aggregate.cost.average === null || aggregate.cost.average <= aggregate.thresholds.maximumAverageCost
    },
    topIssues,
    topRules,
    divergenceAnalysis: {
      alignmentRate: aggregate.comparison.alignmentRate,
      aligned: aggregate.comparison.aligned,
      partiallyAligned: aggregate.comparison.partiallyAligned,
      divergent: aggregate.comparison.divergent,
      notComparable: aggregate.comparison.notComparable,
      comparisons: aggregate.productiveDecisions
    },
    recommendations,
    blockers: readiness.blockers.length > 0 ? readiness.blockers : [readiness.decision === "READY_FOR_CONTROLLED_PILOT" ? "none" : "readiness_thresholds_not_met"],
    evidence: readiness.evidence,
    nextStep: nextStepForDecision(readiness.decision)
  };

  return {
    ...structuredReport,
    markdown: buildMarkdown(structuredReport)
  };
}
