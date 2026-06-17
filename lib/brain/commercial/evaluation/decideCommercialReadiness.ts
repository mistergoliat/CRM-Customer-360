import type { CommercialReadinessDecision } from "./evaluationConstants";
import type { CommercialEvaluationAggregate, CommercialEvaluationThresholds } from "./evaluationTypes";

export type CommercialReadinessAssessment = {
  decision: CommercialReadinessDecision;
  score: number;
  blockers: string[];
  evidence: string[];
  notes: string[];
};

function mergeThresholds(
  base: CommercialEvaluationThresholds,
  override: Partial<CommercialEvaluationThresholds> | undefined
): CommercialEvaluationThresholds {
  return {
    ...base,
    ...(override ?? {})
  };
}

function rateToPercent(value: number | null) {
  if (!Number.isFinite(value ?? NaN)) return 0;
  return Math.max(0, Math.min(100, Math.round((value ?? 0) * 100)));
}

function hasCriticalSafetyIssue(aggregate: CommercialEvaluationAggregate) {
  return (aggregate.issueCounts["EVAL-SAFETY-SIDE-EFFECT"] ?? 0) > 0 || (aggregate.issueCounts["EVAL-SAFETY-SECRET-EXPOSURE"] ?? 0) > 0;
}

function hasPolicyMissing(aggregate: CommercialEvaluationAggregate) {
  return (aggregate.issueCounts["EVAL-POLICY-MISSING"] ?? 0) > 0;
}

function hasRuntimeInstability(aggregate: CommercialEvaluationAggregate, thresholds: CommercialEvaluationThresholds) {
  return (
    aggregate.timeoutRate > thresholds.maxTimeoutRate ||
    aggregate.failedSafeRate > thresholds.maxFailedSafeRate ||
    (aggregate.errorRate > thresholds.maxProviderErrorRate && aggregate.totalObserved > 0) ||
    aggregate.latency.p95 !== null && aggregate.latency.p95 > thresholds.maximumP95LatencyMs
  );
}

function hasPromptProblems(aggregate: CommercialEvaluationAggregate) {
  return (
    (aggregate.issueCounts["EVAL-MODEL-GENERIC-OUTPUT"] ?? 0) > 0 ||
    (aggregate.issueCounts["EVAL-MODEL-HARD-BLOCK-PROPOSAL"] ?? 0) > 0 ||
    (aggregate.issueCounts["EVAL-MODEL-LOW-CONFIDENCE"] ?? 0) > 0
  );
}

function hasPolicyProblems(aggregate: CommercialEvaluationAggregate) {
  return (
    aggregate.blockedRate > aggregate.thresholds.maxBlockedRate ||
    aggregate.requiresReviewRate > aggregate.thresholds.maxRequiresReviewRate ||
    (aggregate.issueCounts["EVAL-POLICY-OVERRESTRICTIVE"] ?? 0) > 0
  );
}

function buildEvidence(aggregate: CommercialEvaluationAggregate, thresholds: CommercialEvaluationThresholds) {
  return [
    `samples=${aggregate.sampleCount}`,
    `eligible=${aggregate.totalEligible}`,
    `completed=${aggregate.totalCompleted}`,
    `failed_safe_rate=${rateToPercent(aggregate.failedSafeRate)}%`,
    `timeout_rate=${rateToPercent(aggregate.timeoutRate)}%`,
    `structurally_valid_rate=${rateToPercent(aggregate.coverage.samplesWithValidation / Math.max(1, aggregate.sampleCount))}%`,
    `policy_applied_rate=${rateToPercent(aggregate.coverage.samplesWithPolicy / Math.max(1, aggregate.sampleCount))}%`,
    `useful_rate=${rateToPercent(aggregate.allowedRate)}%`,
    `p95_latency=${aggregate.latency.p95 ?? "unknown"}ms`,
    `max_side_effects=${aggregate.coverage.samplesWithSideEffects}`
  ]
    .concat(
      aggregate.datasetMetadata?.synthetic ? ["dataset_synthetic=true"] : ["dataset_synthetic=false"],
      thresholds.maximumAverageCost >= 0 ? [`cost_budget=${thresholds.maximumAverageCost}`] : []
    )
    .filter((value) => value.length > 0);
}

export function decideCommercialReadiness(
  aggregate: CommercialEvaluationAggregate,
  thresholdOverrides?: Partial<CommercialEvaluationThresholds>
): CommercialReadinessAssessment {
  const thresholds = mergeThresholds(aggregate.thresholds, thresholdOverrides);
  const blockers: string[] = [];
  const notes: string[] = [];
  const evidence = buildEvidence(aggregate, thresholds);

  if (aggregate.datasetMetadata?.synthetic) {
    blockers.push("dataset_is_synthetic");
    notes.push("Synthetic fixtures are not enough to approve a controlled pilot.");
  }

  if (aggregate.sampleCount < thresholds.minimumSamples) {
    blockers.push("minimum_samples_not_met");
    notes.push(`Observed samples ${aggregate.sampleCount} below threshold ${thresholds.minimumSamples}.`);
  }

  if (aggregate.totalEligible < thresholds.minimumEligibleSamples) {
    blockers.push("minimum_eligible_samples_not_met");
    notes.push(`Eligible samples ${aggregate.totalEligible} below threshold ${thresholds.minimumEligibleSamples}.`);
  }

  if (aggregate.coverage.samplesWithComparison < thresholds.minimumComparableSamples) {
    blockers.push("minimum_comparable_samples_not_met");
    notes.push(`Comparable samples ${aggregate.coverage.samplesWithComparison} below threshold ${thresholds.minimumComparableSamples}.`);
  }

  if (aggregate.coverage.samplesWithSideEffects > thresholds.maximumSideEffectCount) {
    return {
      decision: "NOT_READY",
      score: 0,
      blockers: [...new Set([...blockers, "side_effects_observed"])],
      evidence,
      notes: [...notes, "Any non-zero side effect count disqualifies readiness."]
    };
  }

  if (hasCriticalSafetyIssue(aggregate)) {
    return {
      decision: "NOT_READY",
      score: 0,
      blockers: [...new Set([...blockers, "critical_safety_issue"])],
      evidence,
      notes: [...notes, "Safety exposure or side effects were observed."]
    };
  }

  if (
    aggregate.datasetMetadata?.synthetic ||
    aggregate.sampleCount < thresholds.minimumSamples ||
    aggregate.totalEligible < thresholds.minimumEligibleSamples ||
    aggregate.coverage.samplesWithComparison < thresholds.minimumComparableSamples
  ) {
    return {
      decision: "INSUFFICIENT_DATA",
      score: 20,
      blockers,
      evidence,
      notes: [
        ...notes,
        aggregate.datasetMetadata?.synthetic ? "Synthetic fixtures are not enough to approve a controlled pilot." : "The sample set is still too small or not comparable enough."
      ]
    };
  }

  if (hasPolicyMissing(aggregate)) {
    return {
      decision: "NOT_READY",
      score: 10,
      blockers: [...new Set([...blockers, "policy_missing"])],
      evidence,
      notes: [...notes, "Commercial Policy was missing on at least one evaluated sample."]
    };
  }

  if (
    aggregate.totalObserved === 0 ||
    aggregate.coverage.samplesWithValidation === 0 ||
    aggregate.coverage.samplesWithRuntime === 0 ||
    aggregate.coverage.samplesWithPolicy === 0
  ) {
    return {
      decision: "INSUFFICIENT_DATA",
      score: 20,
      blockers: [...new Set([...blockers, "missing_core_coverage"])],
      evidence,
      notes: [...notes, "The sample set does not cover the full commercial pipeline."]
    };
  }

  const structuralValidRate = aggregate.coverage.samplesWithValidation / Math.max(1, aggregate.sampleCount);
  const policyAppliedRate = aggregate.coverage.samplesWithPolicy / Math.max(1, aggregate.sampleCount);
  const usefulRate = aggregate.allowedRate;
  const alignmentRate = aggregate.comparison.alignmentRate ?? 0;
  const contextIssueCount =
    (aggregate.issueCounts["EVAL-CONTEXT-INCOMPLETE"] ?? 0) +
    (aggregate.issueCounts["EVAL-CONTEXT-MISSING-EVIDENCE"] ?? 0) +
    (aggregate.issueCounts["EVAL-CONTEXT-IDENTITY-CONFLICT"] ?? 0);
  const promptIssueCount =
    (aggregate.issueCounts["EVAL-MODEL-GENERIC-OUTPUT"] ?? 0) +
    (aggregate.issueCounts["EVAL-MODEL-HARD-BLOCK-PROPOSAL"] ?? 0) +
    (aggregate.issueCounts["EVAL-MODEL-LOW-CONFIDENCE"] ?? 0);
  const runtimeIssueCount =
    (aggregate.issueCounts["EVAL-TECH-RUNTIME-ERROR"] ?? 0) +
    (aggregate.issueCounts["EVAL-TECH-TIMEOUT"] ?? 0) +
    (aggregate.issueCounts["EVAL-TECH-VALIDATION-FAILED"] ?? 0);
  const policyIssueCount =
    (aggregate.issueCounts["EVAL-POLICY-OVERRESTRICTIVE"] ?? 0) +
    (aggregate.issueCounts["EVAL-POLICY-CORRECT-BLOCK"] ?? 0);

  if (hasRuntimeInstability(aggregate, thresholds)) {
    return {
      decision: "NEEDS_RUNTIME_STABILIZATION",
      score: 35,
      blockers: [...new Set([...blockers, "runtime_instability"])],
      evidence,
      notes: [...notes, "Timeouts, provider errors, or validation failures exceed the configured budget."]
    };
  }

  if (aggregate.coverage.samplesWithIncompleteData > 0 || contextIssueCount > 0) {
    if (contextIssueCount >= promptIssueCount && contextIssueCount >= runtimeIssueCount) {
      return {
        decision: "NEEDS_CONTEXT_IMPROVEMENT",
        score: 45,
        blockers: [...new Set([...blockers, "context_quality"])],
        evidence,
        notes: [...notes, "Context gaps are the dominant issue in the sample set."]
      };
    }
  }

  if (hasPolicyProblems(aggregate) || policyIssueCount > 0) {
    if (policyIssueCount >= promptIssueCount && policyIssueCount >= contextIssueCount) {
      return {
        decision: "NEEDS_POLICY_TUNING",
        score: 55,
        blockers: [...new Set([...blockers, "policy_behavior"])],
        evidence,
        notes: [...notes, "Policy restrictions dominate the observed failures and appear tuneable."]
      };
    }
  }

  if (hasPromptProblems(aggregate) || promptIssueCount > 0) {
    if (promptIssueCount >= contextIssueCount && promptIssueCount >= policyIssueCount) {
      return {
        decision: "NEEDS_PROMPT_TUNING",
        score: 50,
        blockers: [...new Set([...blockers, "prompt_quality"])],
        evidence,
        notes: [...notes, "The model output patterns suggest prompt or contract tuning."]
      };
    }
  }

  if (
    structuralValidRate >= thresholds.minimumStructurallyValidRate &&
    policyAppliedRate >= thresholds.minimumPolicyAppliedRate &&
    usefulRate >= thresholds.minimumUsefulRate &&
    alignmentRate >= thresholds.minimumAlignmentRate &&
    aggregate.latency.p95 !== null &&
    aggregate.latency.p95 <= thresholds.maximumP95LatencyMs &&
    (aggregate.cost.average === null || aggregate.cost.average <= thresholds.maximumAverageCost) &&
    aggregate.coverage.samplesWithSideEffects === 0 &&
    aggregate.failedSafeRate <= thresholds.maxFailedSafeRate &&
    aggregate.timeoutRate <= thresholds.maxTimeoutRate &&
    aggregate.totalFailedSafe === 0 &&
    aggregate.comparison.notComparable < aggregate.sampleCount
  ) {
    return {
      decision: "READY_FOR_CONTROLLED_PILOT",
      score: 90,
      blockers,
      evidence,
      notes: [...notes, "All readiness thresholds are met with no critical blockers."]
    };
  }

  const fallbackScore = Math.max(0, Math.min(100, Math.round(
    structuralValidRate * 25 +
      policyAppliedRate * 20 +
      usefulRate * 20 +
      alignmentRate * 15 +
      (1 - aggregate.timeoutRate) * 10 +
      (1 - aggregate.failedSafeRate) * 10
  )));

  return {
    decision: "NOT_READY",
    score: fallbackScore,
    blockers: [...new Set([...blockers, "readiness_thresholds_not_met"])],
    evidence,
    notes: [...notes, "The conservative fallback keeps the system out of pilot until thresholds are met."]
  };
}
