import type { CommercialEvaluationResult } from "../evaluation";
import type {
  CommercialPolicyApprovalRequirement,
  CommercialPolicyDecision,
  CommercialPolicyIssue,
  CommercialPolicyRiskLevel,
  CommercialPolicyStatus
} from "../policy";
import type { SalesAgentApprovalRequirement, SalesAgentActionPriority, SalesAgentActionType, SalesAgentClaimType, SalesAgentConfidenceLevel, SalesAgentDecisionType, SalesAgentEntityType, SalesAgentEvidenceSource, SalesAgentOutcome, SalesAgentRiskLevel, SalesAgentToolRequestStatus, SalesAgentToolUrgency } from "../sales-agent/validationTypes";
import type { SalesAgentPromptVersion, SalesAgentRuntimeStatus, SalesAgentRuntimeValidationStatus } from "../sales-agent/runtimeTypes";
import type { SalesAgentToolName } from "../salesAgentTypes";
import type { CommercialShadowResult } from "../shadow";
import type { CommercialShadowStatus } from "../shadow/shadowConstants";
import type { CommercialDecisionComparisonStatus, CommercialEvaluationStatus, CommercialEvaluationUsefulness, CommercialReadinessDecision } from "../evaluation/evaluationConstants";

export const COMMERCIAL_SHADOW_REVIEW_STATUSES = ["available", "not_found", "disabled", "error"] as const;
export type CommercialShadowReviewStatus = (typeof COMMERCIAL_SHADOW_REVIEW_STATUSES)[number];

export type CommercialShadowReviewIdentifiers = {
  correlationId: string | null;
  processInboundRunId: string | null;
  salesAgentRunId: string | null;
  caseId: string | number | null;
  conversationCaseId: string | number | null;
  waId: string | null;
  email: string | null;
  phone: string | null;
  idCustomer: string | number | null;
  idOrder: string | number | null;
  invoiceNumber: string | number | null;
};

export const COMMERCIAL_SHADOW_REVIEW_ITEM_STATUSES = ["detected", "allowed", "blocked"] as const;
export type CommercialShadowReviewItemStatus = (typeof COMMERCIAL_SHADOW_REVIEW_ITEM_STATUSES)[number];

export type CommercialShadowReviewClaim = {
  status: CommercialShadowReviewItemStatus;
  type: SalesAgentClaimType | "unknown" | null;
  value: string | null;
  verified: boolean | null;
  confidence: SalesAgentConfidenceLevel | null;
  evidenceSource: SalesAgentEvidenceSource | null;
  evidenceSummary: string | null;
  evidenceReference: string | null;
  expiresAt: string | null;
  reason: string | null;
};

export type CommercialShadowReviewAction = {
  status: CommercialShadowReviewItemStatus;
  type: SalesAgentActionType | null;
  priority: SalesAgentActionPriority | null;
  confidence: SalesAgentConfidenceLevel | null;
  riskLevel: SalesAgentRiskLevel | null;
  requiresApproval: SalesAgentApprovalRequirement | null;
  reason: string | null;
  blockedReason: string | null;
  policyTags: string[];
  expiresAt: string | null;
  idempotencyHint: string | null;
};

export type CommercialShadowReviewToolRequest = {
  status: CommercialShadowReviewItemStatus;
  tool: SalesAgentToolName | null;
  purpose: string | null;
  available: boolean | null;
  blocking: boolean;
  reason: string | null;
  urgency: SalesAgentToolUrgency | null;
  statusLabel: SalesAgentToolRequestStatus | null;
  fallbackDecision: SalesAgentDecisionType | null;
  expectedEvidence: string[];
  requiredInputs: Record<string, unknown>;
};

export type CommercialShadowReviewEntityProposal = {
  status: CommercialShadowReviewItemStatus;
  entityType: SalesAgentEntityType | null;
  confidence: SalesAgentConfidenceLevel | null;
  requiresApproval: SalesAgentApprovalRequirement | null;
  reason: string | null;
  blockedReason: string | null;
  policyTags: string[];
  expiresAt: string | null;
  idempotencyHint: string | null;
  proposedChangeKeys: string[];
};

export type CommercialShadowReviewSummary = {
  shadowStatus: CommercialShadowStatus | null;
  runtimeStatus: SalesAgentRuntimeStatus | null;
  validationStatus: SalesAgentRuntimeValidationStatus | null;
  proposedOutcome: SalesAgentOutcome | null;
  governedOutcome: SalesAgentOutcome | null;
  proposedConfidence: SalesAgentConfidenceLevel | null;
  governedConfidence: SalesAgentConfidenceLevel | null;
  proposedResponse: string | null;
  governedResponse: string | null;
  proposedShouldRespondNow: boolean | null;
  governedShouldRespondNow: boolean | null;
  policyStatus: CommercialPolicyStatus | null;
  overallDecision: CommercialPolicyDecision | null;
  riskLevel: SalesAgentRiskLevel | CommercialPolicyRiskLevel | null;
  approvalRequirement: SalesAgentApprovalRequirement | CommercialPolicyApprovalRequirement | null;
  claimsCount: number;
  blockedClaimsCount: number;
  actionsCount: number;
  blockedActionsCount: number;
  toolRequestsCount: number;
  blockedToolRequestsCount: number;
  entityProposalsCount: number;
  blockedEntityProposalsCount: number;
};

export type CommercialShadowReviewPolicyTrace = {
  appliedRuleIds: string[];
  hardBlocks: string[];
  warnings: string[];
  issues: CommercialPolicyIssue[];
  versions: {
    contractVersion: string | null;
    policyVersion: string | null;
    runtimeVersion: string | null;
    promptVersion: SalesAgentPromptVersion | null;
    evaluationVersion: string | null;
  };
};

export type CommercialShadowReviewObservability = {
  totalLatencyMs: number | null;
  contextLatencyMs: number | null;
  providerLatencyMs: number | null;
  runtimeLatencyMs: number | null;
  validationLatencyMs: number | null;
  policyLatencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCost: number | null;
  currency: string | null;
  provider: string | null;
  model: string | null;
  timeout: boolean | null;
  providerFailure: string | null;
  readinessStatus: CommercialEvaluationStatus | null;
  readinessDecision: CommercialReadinessDecision | null;
  usefulness: CommercialEvaluationUsefulness | null;
  comparisonStatus: CommercialDecisionComparisonStatus | null;
};

export type CommercialShadowReviewEvaluation = {
  status: CommercialEvaluationStatus | null;
  readinessDecision: CommercialReadinessDecision | null;
  usefulness: CommercialEvaluationUsefulness | null;
  comparisonStatus: CommercialDecisionComparisonStatus | null;
  reportSummary: string | null;
};

export type CommercialShadowReviewInvariants = {
  shadow: true;
  dryRun: true;
  outboundExecuted: false;
  toolsExecuted: 0;
  commercialDbWrites: 0;
  leadCreated: false;
  opportunityCreated: false;
  caseMutated: false;
  controlsResponsePolicy: false;
  violationDetected: boolean;
  violations: string[];
};

export type CommercialShadowReviewError = {
  code: string;
  message: string;
  stage: string | null;
};

export type CommercialShadowReviewViewModel = {
  status: CommercialShadowReviewStatus;
  observedAt: string | null;
  identifiers: CommercialShadowReviewIdentifiers;
  summary: CommercialShadowReviewSummary | null;
  claims: {
    detected: CommercialShadowReviewClaim[];
    allowed: CommercialShadowReviewClaim[];
    blocked: CommercialShadowReviewClaim[];
  };
  actions: {
    proposed: CommercialShadowReviewAction[];
    blocked: CommercialShadowReviewAction[];
  };
  toolRequests: {
    proposed: CommercialShadowReviewToolRequest[];
    blocked: CommercialShadowReviewToolRequest[];
  };
  entityProposals: {
    proposed: CommercialShadowReviewEntityProposal[];
    blocked: CommercialShadowReviewEntityProposal[];
  };
  policy: CommercialShadowReviewPolicyTrace;
  observability: CommercialShadowReviewObservability;
  evaluation: CommercialShadowReviewEvaluation;
  invariants: CommercialShadowReviewInvariants;
  warnings: string[];
  error: CommercialShadowReviewError | null;
  metadata: Record<string, unknown>;
};

export type CommercialShadowReviewAvailableInput = {
  status: "available";
  identifiers: CommercialShadowReviewIdentifiers;
  observedAt?: string | Date | null;
  correlationId?: string | null;
  processInboundRunId?: string | null;
  salesAgentRunId?: string | null;
  shadowResult: CommercialShadowResult;
  evaluationResult?: CommercialEvaluationResult | null;
  warnings?: readonly string[];
  metadata?: Record<string, unknown> | null;
};

export type CommercialShadowReviewUnavailableInput = {
  status: "not_found" | "disabled";
  identifiers: CommercialShadowReviewIdentifiers;
  observedAt?: string | Date | null;
  correlationId?: string | null;
  processInboundRunId?: string | null;
  salesAgentRunId?: string | null;
  reason?: string | null;
  warnings?: readonly string[];
  metadata?: Record<string, unknown> | null;
};

export type CommercialShadowReviewErrorInput = {
  status: "error";
  identifiers: CommercialShadowReviewIdentifiers;
  observedAt?: string | Date | null;
  correlationId?: string | null;
  processInboundRunId?: string | null;
  salesAgentRunId?: string | null;
  reason?: string | null;
  error?: unknown;
  warnings?: readonly string[];
  metadata?: Record<string, unknown> | null;
};

export type CommercialShadowReviewInput =
  | CommercialShadowReviewAvailableInput
  | CommercialShadowReviewUnavailableInput
  | CommercialShadowReviewErrorInput;
