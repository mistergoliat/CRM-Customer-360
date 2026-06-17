import type { CommercialContextSourceSummary } from "../types";
import type { SalesAgentRequestedMode, SalesAgentToolName } from "../salesAgentTypes";
import {
  CUSTOMER_READINESS_LEVELS,
  PRODUCT_FIT_ASSESSMENTS,
  SALES_AGENT_ACTION_TYPES,
  SALES_AGENT_ALLOWED_LEAD_PROPOSED_CHANGE_KEYS,
  SALES_AGENT_ALLOWED_OPPORTUNITY_PROPOSED_CHANGE_KEYS,
  SALES_AGENT_APPROVAL_REQUIREMENTS,
  SALES_AGENT_BLOCKED_ACTIONS,
  SALES_AGENT_CLAIM_TYPES,
  SALES_AGENT_CONFIDENCE_LEVELS,
  SALES_AGENT_DECISION_TYPES,
  SALES_AGENT_EVIDENCE_SOURCES,
  SALES_AGENT_ERROR_CODES,
  SALES_AGENT_MESSAGE_INTENTS,
  SALES_AGENT_OUTCOMES,
  SALES_AGENT_OUTPUT_VERSION,
  SALES_AGENT_REQUESTED_MODES,
  SALES_AGENT_RISK_LEVELS,
  SALES_AGENT_TOOL_NAMES,
  SALES_AGENT_TOOL_REQUEST_STATUSES,
  QUALIFICATION_STATES
} from "../salesAgentConstants";

export const SALES_AGENT_OUTPUT_VALIDATION_STATUSES = ["valid", "invalid", "failed_safe"] as const;
export type SalesAgentOutputValidationStatus = (typeof SALES_AGENT_OUTPUT_VALIDATION_STATUSES)[number];

export const SALES_AGENT_OUTPUT_VALIDATION_ISSUE_LEVELS = ["info", "warning", "error", "fatal"] as const;
export type SalesAgentOutputValidationIssueLevel = (typeof SALES_AGENT_OUTPUT_VALIDATION_ISSUE_LEVELS)[number];

export const SALES_AGENT_OUTPUT_VALIDATION_ISSUE_CODES = [
  "invalid_root",
  "missing_required_field",
  "invalid_field_type",
  "invalid_enum_value",
  "invalid_nested_contract",
  "excessive_string_length",
  "excessive_array_length",
  "excessive_object_depth",
  "unsafe_metadata",
  "non_serializable_value",
  "forbidden_key",
  "sensitive_claim_without_evidence",
  "hard_blocked_action",
  "contradictory_decision",
  "invalid_tool_request",
  "invalid_entity_proposal",
  "invalid_policy_assessment",
  "invalid_rationale",
  "run_id_mismatch",
  "unsupported_contract_version",
  "contract_incomplete",
  "unknown_issue"
] as const;
export type SalesAgentOutputValidationIssueCode = (typeof SALES_AGENT_OUTPUT_VALIDATION_ISSUE_CODES)[number];

export const SALES_AGENT_OUTPUT_MAX_STRING_LENGTH = 4000;
export const SALES_AGENT_OUTPUT_MAX_DRAFT_LENGTH = 2000;
export const SALES_AGENT_OUTPUT_MAX_ARRAY_LENGTH = 20;
export const SALES_AGENT_OUTPUT_MAX_OBJECT_DEPTH = 6;
export const SALES_AGENT_OUTPUT_MAX_ACTIONS = 8;
export const SALES_AGENT_OUTPUT_MAX_TOOL_REQUESTS = 8;
export const SALES_AGENT_OUTPUT_MAX_ENTITY_PROPOSALS = 4;
export const SALES_AGENT_OUTPUT_MAX_CLAIMS = 12;
export const SALES_AGENT_OUTPUT_MAX_EVIDENCE = 12;
export const SALES_AGENT_OUTPUT_MAX_WARNINGS = 20;
export const SALES_AGENT_OUTPUT_MAX_REASON_CODES = 20;
export const SALES_AGENT_OUTPUT_MAX_QUESTIONS = 8;
export const SALES_AGENT_OUTPUT_MAX_METADATA_BYTES = 8192;

export const SALES_AGENT_OUTPUT_VALIDATION_FATAL_CODES = [
  "invalid_root",
  "missing_required_field",
  "forbidden_key",
  "sensitive_claim_without_evidence",
  "hard_blocked_action",
  "contradictory_decision",
  "run_id_mismatch",
  "unsupported_contract_version",
  "contract_incomplete"
] as const satisfies readonly SalesAgentOutputValidationIssueCode[];

export type SalesAgentConfidenceLevel = (typeof SALES_AGENT_CONFIDENCE_LEVELS)[number];
export type SalesAgentRiskLevel = (typeof SALES_AGENT_RISK_LEVELS)[number];
export type SalesAgentApprovalRequirement = (typeof SALES_AGENT_APPROVAL_REQUIREMENTS)[number];
export type SalesAgentOutcome = (typeof SALES_AGENT_OUTCOMES)[number];
export type SalesAgentDecisionType = (typeof SALES_AGENT_DECISION_TYPES)[number];
export type SalesAgentActionType = (typeof SALES_AGENT_ACTION_TYPES)[number];
export type SalesAgentToolRequestStatus = (typeof SALES_AGENT_TOOL_REQUEST_STATUSES)[number];
export type SalesAgentMessageIntent = (typeof SALES_AGENT_MESSAGE_INTENTS)[number];
export type SalesAgentClaimType = (typeof SALES_AGENT_CLAIM_TYPES)[number];
export type SalesAgentEvidenceSource = (typeof SALES_AGENT_EVIDENCE_SOURCES)[number];
export type SalesAgentQualificationState = (typeof QUALIFICATION_STATES)[number];
export type SalesAgentCustomerReadinessLevel = (typeof CUSTOMER_READINESS_LEVELS)[number];
export type SalesAgentProductFitAssessment = (typeof PRODUCT_FIT_ASSESSMENTS)[number];
export type SalesAgentErrorCode = (typeof SALES_AGENT_ERROR_CODES)[number];
export type SalesAgentEntityType = "lead" | "opportunity";
export type SalesAgentActionPriority = "low" | "medium" | "high";
export type SalesAgentToolUrgency = "low" | "medium" | "high";
export type SalesAgentDecisionReasonCode = string;

export type SalesAgentEvidence = {
  source: SalesAgentEvidenceSource;
  summary: string;
  verified: boolean;
  confidence: SalesAgentConfidenceLevel;
  reference?: string | null;
  capturedAt?: string | null;
  expiresAt?: string | null;
};

export type SalesAgentClaim = {
  type: SalesAgentClaimType;
  value: string;
  evidenceSource: SalesAgentEvidenceSource;
  evidenceSummary: string;
  evidenceReference?: string | null;
  verified: boolean;
  confidence: SalesAgentConfidenceLevel;
  expiresAt?: string | null;
};

export type SalesAgentAnalysis = {
  summary: string;
  qualificationState: SalesAgentQualificationState;
  customerReadiness: SalesAgentCustomerReadinessLevel;
  productFit: SalesAgentProductFitAssessment;
  confidence: SalesAgentConfidenceLevel;
  riskLevel: SalesAgentRiskLevel;
  reasonCodes: SalesAgentDecisionReasonCode[];
};

export type SalesAgentDecision = {
  type: SalesAgentDecisionType;
  reason: string;
  confidence: SalesAgentConfidenceLevel;
  riskLevel: SalesAgentRiskLevel;
  requiresApproval: SalesAgentApprovalRequirement;
  errorCode?: SalesAgentErrorCode | null;
  reasonCodes: SalesAgentDecisionReasonCode[];
  policyTags: string[];
};

export type SalesAgentProposedAction = {
  type: SalesAgentActionType;
  priority: SalesAgentActionPriority;
  confidence: SalesAgentConfidenceLevel;
  riskLevel: SalesAgentRiskLevel;
  requiresApproval: SalesAgentApprovalRequirement;
  reason: string;
  payload: Record<string, unknown>;
  dependencies: string[];
  policyTags: string[];
  expiresAt?: string | null;
  idempotencyHint?: string | null;
};

export type SalesAgentToolRequest = {
  tool: SalesAgentToolName;
  purpose: string;
  status: SalesAgentToolRequestStatus;
  requiredInputs: Record<string, unknown>;
  optionalInputs?: Record<string, unknown> | null;
  urgency: SalesAgentToolUrgency;
  blocking: boolean;
  reason: string;
  expectedEvidence: string[];
  fallbackDecision: SalesAgentDecisionType | null;
  confidence?: SalesAgentConfidenceLevel;
  riskLevel?: SalesAgentRiskLevel;
};

export type SalesAgentEntityProposal = {
  entityType: SalesAgentEntityType;
  proposedChanges: Record<string, unknown>;
  evidence: SalesAgentEvidence[];
  confidence: SalesAgentConfidenceLevel;
  requiresApproval: SalesAgentApprovalRequirement;
  reason: string;
  policyTags: string[];
  expiresAt?: string | null;
  idempotencyHint?: string | null;
};

export type SalesAgentResponseProposal = {
  messageIntent: SalesAgentMessageIntent;
  draftText?: string | null;
  language: string;
  tone: string;
  questions: string[];
  claims: SalesAgentClaim[];
  disclaimers: string[];
  requiresApproval: SalesAgentApprovalRequirement;
  blockedClaims: SalesAgentClaimType[];
  confidence: SalesAgentConfidenceLevel;
};

export type SalesAgentPolicyAssessment = {
  status: "allowed" | "blocked" | "review";
  blocked: boolean;
  reason: string;
  confidence: SalesAgentConfidenceLevel;
  riskLevel: SalesAgentRiskLevel;
  approvalRequirement: SalesAgentApprovalRequirement;
  errorCode?: SalesAgentErrorCode | null;
  reasonCodes: SalesAgentDecisionReasonCode[];
  policyTags: string[];
};

export type SalesAgentRationale = {
  summary: string;
  evidence: string[];
  counterEvidence: string[];
  assumptions: string[];
  riskFlags: string[];
  missingInformation: string[];
  policyRulesApplied: string[];
};

export type SalesAgentResult = {
  runId: string;
  contractVersion: string;
  outcome: SalesAgentOutcome;
  analysis: SalesAgentAnalysis;
  decision: SalesAgentDecision;
  shouldRespondNow: boolean;
  shouldRequestTool: boolean;
  shouldRequestHuman: boolean;
  shouldEvaluateFollowUp: boolean;
  proposedActions: SalesAgentProposedAction[];
  toolRequests: SalesAgentToolRequest[];
  entityProposals: SalesAgentEntityProposal[];
  responseProposal: SalesAgentResponseProposal | null;
  evidence: SalesAgentEvidence[];
  policyAssessment: SalesAgentPolicyAssessment;
  warnings: string[];
  rationale: SalesAgentRationale;
  metadata: Record<string, unknown>;
};

export type SalesAgentOutputValidationContext = {
  expectedRunId?: string;
  contractVersion?: string;
  allowedCapabilities: readonly SalesAgentToolName[];
  requestedMode?: SalesAgentRequestedMode;
  commercialContextSummary?: CommercialContextSourceSummary | null;
  currentTime: string | Date;
  strictMode: boolean;
  metadata?: Record<string, unknown>;
};

export type SalesAgentOutputValidationMetadata = {
  contractVersion: string;
  currentTime: string;
  validatedAt: string;
  strictMode: boolean;
  expectedRunId: string | null;
  requestedMode: SalesAgentRequestedMode | null;
  allowedCapabilities: SalesAgentToolName[];
  issueCount: number;
  warningCount: number;
  fatalCount: number;
  sanitized: boolean;
  sanitizedFields: string[];
  rootType: string;
  outputBytes: number;
  metadataBytes: number;
  commercialContextSummary: CommercialContextSourceSummary | null;
  safeMetadata: Record<string, unknown>;
};

export type SalesAgentOutputValidationResult =
  | {
      status: "valid";
      result: SalesAgentResult;
      warnings: string[];
      issues: SalesAgentOutputValidationIssue[];
      metadata: SalesAgentOutputValidationMetadata;
    }
  | {
      status: "invalid";
      result: null;
      warnings: string[];
      issues: SalesAgentOutputValidationIssue[];
      metadata: SalesAgentOutputValidationMetadata;
    }
  | {
      status: "failed_safe";
      result: SalesAgentResult;
      warnings: string[];
      issues: SalesAgentOutputValidationIssue[];
      metadata: SalesAgentOutputValidationMetadata;
    };

export type SalesAgentOutputValidationIssue = {
  code: SalesAgentOutputValidationIssueCode;
  level: SalesAgentOutputValidationIssueLevel;
  message: string;
  path: string[];
  details?: Record<string, unknown>;
};

export const SALES_AGENT_OUTPUT_CONTRACT_VERSION = SALES_AGENT_OUTPUT_VERSION;

export { SALES_AGENT_BLOCKED_ACTIONS, SALES_AGENT_ALLOWED_LEAD_PROPOSED_CHANGE_KEYS, SALES_AGENT_ALLOWED_OPPORTUNITY_PROPOSED_CHANGE_KEYS, SALES_AGENT_REQUESTED_MODES, SALES_AGENT_TOOL_NAMES };
