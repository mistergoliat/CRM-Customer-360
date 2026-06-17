import type {
  CommercialPolicyApprovalRequirement,
  CommercialPolicyDecision,
  CommercialPolicyRiskLevel,
  CommercialPolicyStatus
} from "../policy";
import type { CommercialShadowResult, CommercialShadowSideEffects } from "../shadow";
import type { CommercialShadowMode, CommercialShadowStatus } from "../shadow/shadowConstants";
import type { SalesAgentApprovalRequirement, SalesAgentConfidenceLevel, SalesAgentOutcome, SalesAgentRiskLevel } from "../sales-agent/validationTypes";
import type { SalesAgentPromptVersion, SalesAgentRuntimeStatus, SalesAgentRuntimeValidation } from "../sales-agent/runtimeTypes";
import type { CommercialEvaluationComponent, CommercialEvaluationDimension, CommercialEvaluationIssueCode, CommercialEvaluationRecommendationPriority, CommercialEvaluationSeverity, CommercialEvaluationStatus, CommercialEvaluationUsefulness, CommercialReadinessDecision, CommercialDecisionComparisonStatus } from "./evaluationConstants";

export type CommercialEvaluationIssueDimension = CommercialEvaluationDimension | CommercialEvaluationComponent | "dataset" | "comparison" | "readiness" | "unknown";

export type CommercialHumanReviewAssessment = {
  expectedOutcome?: string | null;
  expectedPolicyStatus?: CommercialPolicyStatus | null;
  responseUseful?: boolean | null;
  responseCorrect?: boolean | null;
  claimSafetyCorrect?: boolean | null;
  escalationCorrect?: boolean | null;
  notes?: string | null;
  reviewedByHash?: string | null;
  reviewedAt?: string | null;
};

export type CommercialProductiveDecisionObservation = {
  action?: string | null;
  targetAgent?: string | null;
  responded?: boolean | null;
  handedOff?: boolean | null;
  closed?: boolean | null;
  noAction?: boolean | null;
  requiresHuman?: boolean | null;
  reason?: string | null;
  timestamp?: string | null;
};

export type CommercialEvaluationDatasetMetadata = {
  datasetId: string;
  datasetVersion: string;
  generatedAt: string;
  synthetic: boolean;
  source?: string | null;
  description?: string | null;
  notes?: string[];
};

export type CommercialEvaluationVersionInfo = {
  evaluationVersion: string;
  shadowVersion: string;
  runtimeVersion: string;
  policyVersion: string;
  contractVersion: string;
  promptVersion: SalesAgentPromptVersion;
};

export type CommercialEvaluationThresholds = {
  minimumSamples: number;
  minimumEligibleSamples: number;
  maxFailedSafeRate: number;
  maxTimeoutRate: number;
  maxProviderErrorRate: number;
  maxValidationFailureRate: number;
  maxBlockedRate: number;
  maxRequiresReviewRate: number;
  minimumUsefulRate: number;
  minimumStructurallyValidRate: number;
  minimumPolicyAppliedRate: number;
  maximumP95LatencyMs: number;
  maximumAverageCost: number;
  maximumCriticalIssues: number;
  maximumSideEffectCount: number;
  minimumComparableSamples: number;
  minimumAlignmentRate: number;
};

export type CommercialEvaluationIssue = {
  code: CommercialEvaluationIssueCode;
  severity: CommercialEvaluationSeverity;
  message: string;
  dimension: CommercialEvaluationIssueDimension;
  path: string[];
  component: CommercialEvaluationComponent;
  details?: Record<string, unknown> | null;
};

export type CommercialEvaluationDimensionResult = {
  dimension: CommercialEvaluationDimension;
  score: number;
  severity: CommercialEvaluationSeverity;
  summary: string;
  issueCodes: CommercialEvaluationIssueCode[];
  issueCount: number;
  evidence: string[];
  details: Record<string, unknown>;
};

export type CommercialEvaluationClassification = {
  usefulness: CommercialEvaluationUsefulness;
  primaryComponent: CommercialEvaluationComponent;
  primaryDimension: CommercialEvaluationIssueDimension;
  primaryIssueCode: CommercialEvaluationIssueCode | null;
  severity: CommercialEvaluationSeverity;
  reason: string;
  readinessContributionScore: number;
  needsPolicyTuning: boolean;
  needsPromptTuning: boolean;
  needsContextImprovement: boolean;
  needsRuntimeStabilization: boolean;
  needsSafetyReview: boolean;
};

export type CommercialEvaluationMetrics = {
  shadowStatus: CommercialShadowStatus | null;
  shadowMode: CommercialShadowMode | null;
  shadowEnabled: boolean | null;
  shadowEligible: boolean | null;
  runtimeStatus: SalesAgentRuntimeStatus | null;
  validationStatus: SalesAgentRuntimeValidation["status"] | null;
  outcome: SalesAgentOutcome | null;
  policyStatus: CommercialPolicyStatus | null;
  overallDecision: CommercialPolicyDecision | null;
  riskLevel: SalesAgentRiskLevel | CommercialPolicyRiskLevel | null;
  approvalRequirement: SalesAgentApprovalRequirement | CommercialPolicyApprovalRequirement | null;
  shouldRespondNow: boolean | null;
  confidence: SalesAgentConfidenceLevel | null;
  claimsTotal: number;
  claimsBlocked: number;
  claimsSensitive: number;
  claimCountsByType: Record<string, number>;
  blockedClaimCountsByType: Record<string, number>;
  proposedActionsTotal: number;
  proposedActionsBlocked: number;
  actionCountsByType: Record<string, number>;
  blockedActionCountsByType: Record<string, number>;
  toolRequestsTotal: number;
  toolRequestsBlocked: number;
  toolRequestCountsByType: Record<string, number>;
  blockedToolRequestCountsByType: Record<string, number>;
  entityProposalsTotal: number;
  entityProposalsBlocked: number;
  entityProposalCountsByType: Record<string, number>;
  blockedEntityProposalCountsByType: Record<string, number>;
  warningsCount: number;
  issuesCount: number;
  appliedPolicyRules: string[];
  timeout: boolean;
  durationTotalMs: number | null;
  contextDurationMs: number | null;
  runtimeDurationMs: number | null;
  validationDurationMs: number | null;
  policyDurationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCost: number | null;
  provider: string | null;
  model: string | null;
  contractVersion: string | null;
  promptVersion: SalesAgentPromptVersion | null;
  runtimeVersion: string | null;
  policyVersion: string | null;
  sideEffectsCount: number;
  hasPolicyResult: boolean;
  hasRuntimeResult: boolean;
  hasValidationResult: boolean;
  hasCommercialContext: boolean;
  hasComparison: boolean;
  hasReviewerAssessment: boolean;
};

export type CommercialDecisionComparison = {
  status: CommercialDecisionComparisonStatus;
  shadowDecision: string | null;
  productiveAction: string | null;
  targetAgent: string | null;
  responded: boolean | null;
  handedOff: boolean | null;
  closed: boolean | null;
  noAction: boolean | null;
  requiresHuman: boolean | null;
  reason: string | null;
  timestamp: string | null;
  alignedFields: string[];
  divergentFields: string[];
};

export type CommercialEvaluationRecommendation = {
  component: CommercialEvaluationComponent;
  priority: CommercialEvaluationRecommendationPriority;
  title: string;
  reason: string;
  evidence: string[];
  issueCodes: CommercialEvaluationIssueCode[];
};

export type CommercialEvaluationShadowSummary = {
  status: CommercialShadowStatus;
  mode: CommercialShadowMode;
  enabled: boolean;
  eligible: boolean;
  skipReason: string | null;
  runtimeStatus: SalesAgentRuntimeStatus | null;
  validationStatus: SalesAgentRuntimeValidation["status"] | null;
  policyStatus: CommercialPolicyStatus | null;
  overallDecision: CommercialPolicyDecision | null;
  outcome: SalesAgentOutcome | null;
  riskLevel: SalesAgentRiskLevel | CommercialPolicyRiskLevel | null;
  approvalRequirement: SalesAgentApprovalRequirement | CommercialPolicyApprovalRequirement | null;
  shouldRespondNow: boolean | null;
  confidence: SalesAgentConfidenceLevel | null;
  warningCount: number;
  issueCodes: string[];
  appliedRuleIds: string[];
  sideEffects: CommercialShadowSideEffects;
};

export type CommercialEvaluationInput = {
  sampleId: string;
  timestamp: string | Date;
  scenario: string;
  expectedTags: readonly string[];
  shadowResult: CommercialShadowResult;
  productiveDecision?: CommercialProductiveDecisionObservation | null;
  reviewerAssessment?: CommercialHumanReviewAssessment | null;
  metadata?: Record<string, unknown>;
  thresholds?: Partial<CommercialEvaluationThresholds>;
  currentTime?: string | Date;
};

export type CommercialEvaluationResult = {
  sampleId: string;
  timestamp: string;
  scenario: string;
  expectedTags: string[];
  status: CommercialEvaluationStatus;
  shadowResultSummary: CommercialEvaluationShadowSummary;
  metrics: CommercialEvaluationMetrics;
  dimensions: Record<CommercialEvaluationDimension, CommercialEvaluationDimensionResult>;
  classification: CommercialEvaluationClassification;
  comparison: CommercialDecisionComparison | null;
  reviewerAssessment: CommercialHumanReviewAssessment | null;
  issues: CommercialEvaluationIssue[];
  warnings: string[];
  recommendations: CommercialEvaluationRecommendation[];
  versionInfo: CommercialEvaluationVersionInfo;
  metadata: Record<string, unknown>;
};

export type CommercialEvaluationDatasetEntry = {
  sampleId: string;
  timestamp: string | Date;
  scenario: string;
  expectedTags: readonly string[];
  shadowResult: CommercialShadowResult;
  productiveDecision?: CommercialProductiveDecisionObservation | null;
  reviewerAssessment?: CommercialHumanReviewAssessment | null;
  metadata?: Record<string, unknown>;
  thresholds?: Partial<CommercialEvaluationThresholds>;
  currentTime?: string | Date;
};

export type CommercialEvaluationAggregate = {
  datasetMetadata: CommercialEvaluationDatasetMetadata | null;
  versionInfo: CommercialEvaluationVersionInfo;
  thresholds: CommercialEvaluationThresholds;
  sampleCount: number;
  totalObserved: number;
  totalEligible: number;
  totalSkipped: number;
  totalCompleted: number;
  totalFailedSafe: number;
  totalInsufficientData: number;
  totalInvalidInput: number;
  eligibilityRate: number;
  completionRate: number;
  errorRate: number;
  timeoutRate: number;
  runtimeStatusDistribution: Record<string, number>;
  outcomeDistribution: Record<string, number>;
  policyStatusDistribution: Record<string, number>;
  approvalRequirementDistribution: Record<string, number>;
  riskLevelDistribution: Record<string, number>;
  allowedRate: number;
  allowedWithRestrictionsRate: number;
  requiresReviewRate: number;
  blockedRate: number;
  failedSafeRate: number;
  claimCountsByType: Record<string, number>;
  blockedClaimRate: number;
  actionCountsByType: Record<string, number>;
  blockedActionRate: number;
  toolRequestCountsByType: Record<string, number>;
  blockedToolRate: number;
  entityProposalCountsByType: Record<string, number>;
  blockedEntityProposalRate: number;
  contextBlockingCauses: Record<CommercialEvaluationIssueCode, number>;
  policyRuleCounts: Record<string, number>;
  warningCounts: Record<string, number>;
  errorCounts: Record<string, number>;
  issueCounts: Record<CommercialEvaluationIssueCode, number>;
  latency: {
    p50: number | null;
    p90: number | null;
    p95: number | null;
    max: number | null;
    average: number | null;
  };
  tokens: {
    averageInput: number | null;
    averageOutput: number | null;
    totalInput: number | null;
    totalOutput: number | null;
  };
  cost: {
    average: number | null;
    total: number | null;
    measuredSamples: number;
    missingSamples: number;
  };
  coverage: {
    samplesWithPolicy: number;
    samplesWithRuntime: number;
    samplesWithValidation: number;
    samplesWithComparison: number;
    samplesWithSideEffects: number;
    samplesWithIncompleteData: number;
    samplesWithMissingCost: number;
    samplesWithMissingTokens: number;
    synthetic: boolean;
  };
  comparison: {
    aligned: number;
    partiallyAligned: number;
    divergent: number;
    notComparable: number;
    alignmentRate: number | null;
  };
  dimensionAverages: Record<CommercialEvaluationDimension, number>;
  dimensionSeverityDistribution: Record<CommercialEvaluationDimension, Record<CommercialEvaluationSeverity, number>>;
  topIssues: CommercialEvaluationIssue[];
  topRules: Array<{ ruleId: string; count: number }>;
  topWarnings: Array<{ warning: string; count: number }>;
  topErrors: Array<{ error: string; count: number }>;
  productiveDecisions: CommercialDecisionComparison[];
  decisionsBySample: Array<{
    sampleId: string;
    comparisonStatus: CommercialDecisionComparisonStatus;
    classification: CommercialEvaluationClassification;
  }>;
};

export type CommercialEvaluationReport = {
  generatedAt: string;
  datasetMetadata: CommercialEvaluationDatasetMetadata | null;
  versionInfo: CommercialEvaluationVersionInfo;
  thresholds: CommercialEvaluationThresholds;
  readinessDecision: CommercialReadinessDecision;
  executiveSummary: string;
  datasetCoverage: {
    sampleCount: number;
    eligibleSamples: number;
    skippedSamples: number;
    completedSamples: number;
    failedSafeSamples: number;
    insufficientDataSamples: number;
    invalidInputSamples: number;
    synthetic: boolean;
  };
  technicalHealth: {
    structurallyValidRate: number;
    failedSafeRate: number;
    timeoutRate: number;
    errorRate: number;
    runtimeStatusDistribution: Record<string, number>;
  };
  contextQuality: {
    averageScore: number;
    topIssues: CommercialEvaluationIssue[];
    coverageNotes: string[];
  };
  modelRuntimeQuality: {
    averageScore: number;
    runtimeStatusDistribution: Record<string, number>;
    topIssues: CommercialEvaluationIssue[];
  };
  policyBehavior: {
    averageScore: number;
    policyStatusDistribution: Record<string, number>;
    topRules: Array<{ ruleId: string; count: number }>;
    topIssues: CommercialEvaluationIssue[];
  };
  commercialUsefulness: {
    averageScore: number;
    usefulness: CommercialEvaluationUsefulness;
    topIssues: CommercialEvaluationIssue[];
  };
  safety: {
    averageScore: number;
    criticalIssueCount: number;
    topIssues: CommercialEvaluationIssue[];
  };
  latency: {
    p50: number | null;
    p90: number | null;
    p95: number | null;
    max: number | null;
    average: number | null;
    withinBudget: boolean;
  };
  cost: {
    average: number | null;
    total: number | null;
    measuredSamples: number;
    missingSamples: number;
    withinBudget: boolean;
  };
  topIssues: CommercialEvaluationIssue[];
  topRules: Array<{ ruleId: string; count: number }>;
  divergenceAnalysis: {
    alignmentRate: number | null;
    aligned: number;
    partiallyAligned: number;
    divergent: number;
    notComparable: number;
    comparisons: CommercialDecisionComparison[];
  };
  recommendations: CommercialEvaluationRecommendation[];
  blockers: string[];
  evidence: string[];
  nextStep: string;
  markdown: string;
};
