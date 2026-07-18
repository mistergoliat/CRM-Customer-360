import type { CommercialContextSourceSummary } from "../types";
import type {
  SalesAgentClaim,
  SalesAgentDecision,
  SalesAgentEntityProposal,
  SalesAgentOutcome,
  SalesAgentProposedAction,
  SalesAgentResult,
  SalesAgentToolRequest
} from "../sales-agent/validationTypes";
import type { SalesAgentToolName } from "../salesAgentTypes";

export const COMMERCIAL_POLICY_STATUSES = [
  "allowed",
  "allowed_with_restrictions",
  "requires_review",
  "blocked",
  "failed_safe"
] as const;
export type CommercialPolicyStatus = (typeof COMMERCIAL_POLICY_STATUSES)[number];

export const COMMERCIAL_POLICY_DECISIONS = [
  "allow",
  "allow_with_approval",
  "block",
  "remove",
  "downgrade_to_review",
  "failed_safe"
] as const;
export type CommercialPolicyDecision = (typeof COMMERCIAL_POLICY_DECISIONS)[number];

export const COMMERCIAL_POLICY_APPROVAL_REQUIREMENTS = [
  "none",
  "operator_review",
  "explicit_operator_approval",
  "blocked"
] as const;
export type CommercialPolicyApprovalRequirement = (typeof COMMERCIAL_POLICY_APPROVAL_REQUIREMENTS)[number];

export const COMMERCIAL_POLICY_RISK_LEVELS = ["low", "medium", "high", "blocked"] as const;
export type CommercialPolicyRiskLevel = (typeof COMMERCIAL_POLICY_RISK_LEVELS)[number];

export const COMMERCIAL_POLICY_ISSUE_LEVELS = ["info", "warning", "error", "fatal"] as const;
export type CommercialPolicyIssueLevel = (typeof COMMERCIAL_POLICY_ISSUE_LEVELS)[number];

export const COMMERCIAL_POLICY_ISSUE_CODES = [
  "sensitive_claim_blocked",
  "evidence_missing",
  "evidence_unverified",
  "evidence_stale",
  "claim_source_not_authorized",
  "hard_blocked_action",
  "action_requires_approval",
  "duplicate_action",
  "expired_action",
  "tool_not_allowed",
  "tool_unavailable",
  "tool_execution_claimed",
  "invalid_entity_proposal",
  "terminal_transition_requires_evidence",
  "customer_master_mutation_blocked",
  "identity_conflict",
  "outbound_blocked",
  "opt_out_active",
  "ai_blocked",
  "human_owner_active",
  "recent_customer_reply",
  "quiet_hours_active",
  "manual_approval_required",
  "policy_context_missing",
  "policy_version_mismatch",
  "failed_safe",
  "policy_disabled",
  "invalid_input",
  "unknown_issue"
] as const;
export type CommercialPolicyIssueCode = (typeof COMMERCIAL_POLICY_ISSUE_CODES)[number];

export const COMMERCIAL_POLICY_RULE_IDS = [
  "POLICY-CLAIM-PRICE-EVIDENCE",
  "POLICY-CLAIM-STOCK-FRESHNESS",
  "POLICY-CLAIM-DELIVERY-COMMITMENT",
  "POLICY-CLAIM-DISCOUNT-APPROVAL",
  "POLICY-CLAIM-ORDER-STATUS-SOURCE",
  "POLICY-DRAFT-STATEMENT-EVIDENCE",
  "POLICY-ACTION-HARD-BLOCK",
  "POLICY-ACTION-DUPLICATE",
  "POLICY-ACTION-REVIEW",
  "POLICY-ACTION-EXPLICIT-APPROVAL",
  "POLICY-TOOL-CAPABILITY-ALLOWLIST",
  "POLICY-TOOL-NO-EXECUTION",
  "POLICY-ENTITY-TERMINAL-STATE",
  "POLICY-ENTITY-CUSTOMER-MASTER-BLOCK",
  "POLICY-OUTBOUND-OPTOUT",
  "POLICY-OUTBOUND-AI-BLOCKED",
  "POLICY-OUTBOUND-HUMAN-OWNER",
  "POLICY-OUTBOUND-QUIET-HOURS",
  "POLICY-OUTBOUND-MANUAL-APPROVAL",
  "POLICY-OUTBOUND-IDENTITY-CONFLICT",
  "POLICY-FOLLOWUP-RECENT-REPLY",
  "POLICY-GOVERNANCE-APPROVAL",
  "POLICY-GOVERNANCE-FAIL-CLOSED",
  "POLICY-VERSION-MISMATCH",
  "POLICY-DISABLED"
] as const;
export type CommercialPolicyRuleId = (typeof COMMERCIAL_POLICY_RULE_IDS)[number];

export const COMMERCIAL_POLICY_FAILED_SAFE_REASONS = [
  "invalid_input",
  "policy_version_mismatch",
  "policy_disabled",
  "policy_context_missing",
  "exception",
  "unsafe_output",
  "unknown_issue"
] as const;
export type CommercialPolicyFailedSafeReason = (typeof COMMERCIAL_POLICY_FAILED_SAFE_REASONS)[number];

export const COMMERCIAL_POLICY_EVIDENCE_FRESHNESS = ["fresh", "recent", "stale", "unknown"] as const;
export type CommercialEvidenceFreshness = (typeof COMMERCIAL_POLICY_EVIDENCE_FRESHNESS)[number];

export const COMMERCIAL_POLICY_CLAIM_VOLATILITY = ["stable", "semi_volatile", "volatile", "highly_volatile"] as const;
export type CommercialClaimVolatility = (typeof COMMERCIAL_POLICY_CLAIM_VOLATILITY)[number];

export const COMMERCIAL_POLICY_CHANNEL_CONTEXT_KEYS = [
  "channel",
  "available",
  "outboundAllowed",
  "manualApprovalRequired",
  "optOut",
  "quietHoursActive",
  "humanOwnerActive",
  "aiBlocked",
  "identityConflict",
  "recentCustomerReply",
  "recentHumanContact"
] as const;

export type CommercialPolicyChannelContext = {
  channel: string | null;
  available: boolean;
  outboundAllowed: boolean;
  manualApprovalRequired: boolean;
  optOut: boolean;
  quietHoursActive: boolean;
  humanOwnerActive: boolean;
  aiBlocked: boolean;
  identityConflict: boolean;
  recentCustomerReply: boolean;
  recentHumanContact: boolean;
};

export type CommercialPolicyContext = {
  commercialContext: CommercialContextSourceSummary | Record<string, unknown> | null;
  customerContext?: Record<string, unknown> | null;
  opportunityContext?: Record<string, unknown> | null;
  followUpContext?: Record<string, unknown> | null;
  channelContext: CommercialPolicyChannelContext;
  operatorContext?: Record<string, unknown> | null;
};

export type CommercialPolicyFeatureFlags = {
  commercialPolicyEnabled: boolean;
  allowDraftReplies: boolean;
  allowToolRequests: boolean;
  allowEntityProposals: boolean;
  allowFollowUpEvaluation: boolean;
  allowInternalTasks: boolean;
  allowQuoteDraftRequests: boolean;
  allowOperatorReviewRequests: boolean;
  allowSensitiveClaims: boolean;
  allowOutboundProposals: boolean;
};

export type CommercialPolicyInput = CommercialPolicyContext & {
  salesAgentResult: SalesAgentResult;
  currentTime: string | Date;
  contractVersion: string;
  policyVersion: string;
  allowedCapabilities: readonly SalesAgentToolName[];
  featureFlags: CommercialPolicyFeatureFlags;
  metadata?: Record<string, unknown>;
};

export type CommercialPolicyIssue = {
  code: CommercialPolicyIssueCode;
  level: CommercialPolicyIssueLevel;
  message: string;
  path: string[];
  ruleId?: CommercialPolicyRuleId | null;
  details?: Record<string, unknown> | null;
};

export type CommercialPolicyAssessmentBase = {
  decision: CommercialPolicyDecision;
  approvalRequirement: CommercialPolicyApprovalRequirement;
  riskLevel: CommercialPolicyRiskLevel;
  ruleIds: CommercialPolicyRuleId[];
  issues: CommercialPolicyIssue[];
  reason: string;
};

export type CommercialPolicyClaimAssessment = CommercialPolicyAssessmentBase & {
  index: number;
  claim: SalesAgentClaim;
  status: "allowed" | "review" | "blocked";
  volatility: CommercialClaimVolatility;
  freshness: CommercialEvidenceFreshness;
  sensitive: boolean;
};

export type CommercialPolicyClaimsEvaluationResult = {
  keptClaims: SalesAgentClaim[];
  blockedClaims: SalesAgentClaim[];
  assessments: CommercialPolicyClaimAssessment[];
  issues: CommercialPolicyIssue[];
  warnings: string[];
  appliedRules: CommercialPolicyRuleId[];
  riskLevel: CommercialPolicyRiskLevel;
  requiresApproval: CommercialPolicyApprovalRequirement;
};

export type CommercialPolicyActionAssessment = CommercialPolicyAssessmentBase & {
  index: number;
  action: SalesAgentProposedAction;
  status: "allowed" | "review" | "blocked";
  duplicateOf?: number | null;
  hardBlocked: boolean;
};

export type CommercialPolicyActionsEvaluationResult = {
  keptActions: SalesAgentProposedAction[];
  blockedActions: SalesAgentProposedAction[];
  assessments: CommercialPolicyActionAssessment[];
  issues: CommercialPolicyIssue[];
  warnings: string[];
  appliedRules: CommercialPolicyRuleId[];
  riskLevel: CommercialPolicyRiskLevel;
  requiresApproval: CommercialPolicyApprovalRequirement;
};

export type CommercialPolicyToolRequestAssessment = CommercialPolicyAssessmentBase & {
  index: number;
  toolRequest: SalesAgentToolRequest;
  status: "allowed" | "review" | "blocked";
  unavailable: boolean;
};

export type CommercialPolicyToolRequestsEvaluationResult = {
  keptToolRequests: SalesAgentToolRequest[];
  blockedToolRequests: SalesAgentToolRequest[];
  assessments: CommercialPolicyToolRequestAssessment[];
  issues: CommercialPolicyIssue[];
  warnings: string[];
  appliedRules: CommercialPolicyRuleId[];
  riskLevel: CommercialPolicyRiskLevel;
  requiresApproval: CommercialPolicyApprovalRequirement;
};

export type CommercialPolicyEntityProposalAssessment = CommercialPolicyAssessmentBase & {
  index: number;
  entityProposal: SalesAgentEntityProposal;
  status: "allowed" | "review" | "blocked";
  terminalTransition: boolean;
  customerMasterMutation: boolean;
};

export type CommercialPolicyEntityProposalsEvaluationResult = {
  keptEntityProposals: SalesAgentEntityProposal[];
  blockedEntityProposals: SalesAgentEntityProposal[];
  assessments: CommercialPolicyEntityProposalAssessment[];
  issues: CommercialPolicyIssue[];
  warnings: string[];
  appliedRules: CommercialPolicyRuleId[];
  riskLevel: CommercialPolicyRiskLevel;
  requiresApproval: CommercialPolicyApprovalRequirement;
};

export type CommercialPolicySummary = {
  originalOutcome: SalesAgentOutcome;
  governedOutcome: SalesAgentOutcome;
  allowedClaims: number;
  blockedClaims: number;
  allowedActions: number;
  blockedActions: number;
  allowedToolRequests: number;
  blockedToolRequests: number;
  allowedEntityProposals: number;
  blockedEntityProposals: number;
  reviewRequired: boolean;
  blocked: boolean;
  notes: string[];
};

export type CommercialPolicyMetadata = {
  policyVersion: string;
  contractVersion: string;
  currentTime: string;
  validatedAt: string;
  allowedCapabilities: SalesAgentToolName[];
  featureFlags: CommercialPolicyFeatureFlags;
  issueCount: number;
  warningCount: number;
  appliedRuleCount: number;
  sanitized: boolean;
  sanitizedFields: string[];
  safeMetadata: Record<string, unknown>;
  commercialContext: Record<string, unknown>;
};

export type CommercialPolicyOriginalResultReference = {
  runId: string;
  contractVersion: string;
  outcome: SalesAgentOutcome;
  decisionType: SalesAgentDecision["type"];
};

export type CommercialPolicyResult = {
  status: CommercialPolicyStatus;
  overallDecision: CommercialPolicyDecision;
  riskLevel: CommercialPolicyRiskLevel;
  requiresApproval: CommercialPolicyApprovalRequirement;
  originalResultReference: CommercialPolicyOriginalResultReference;
  governedResult: SalesAgentResult;
  claimAssessments: CommercialPolicyClaimAssessment[];
  actionAssessments: CommercialPolicyActionAssessment[];
  toolRequestAssessments: CommercialPolicyToolRequestAssessment[];
  entityProposalAssessments: CommercialPolicyEntityProposalAssessment[];
  blockedClaims: SalesAgentClaim[];
  blockedActions: SalesAgentProposedAction[];
  blockedToolRequests: SalesAgentToolRequest[];
  blockedEntityProposals: SalesAgentEntityProposal[];
  appliedRules: CommercialPolicyRuleId[];
  issues: CommercialPolicyIssue[];
  warnings: string[];
  summary: CommercialPolicySummary;
  metadata: CommercialPolicyMetadata;
};
