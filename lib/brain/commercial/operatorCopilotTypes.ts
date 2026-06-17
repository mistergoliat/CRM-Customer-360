import type {
  CommercialChannelReference,
  CommercialPriority,
  CommercialSignal,
  LeadReadModel,
  OpportunityObjection,
  OpportunityProductInterest,
  OpportunityReadModel,
  OpportunityRequirement,
} from "./types";
import type {
  FollowUpDecisionResult,
  FollowUpPlanReadModel,
} from "./followUpTypes";
import type {
  SalesAgentConfidence,
  SalesAgentCustomerCandidateReference,
  SalesAgentHardBlockedCapability,
  SalesAgentResult,
} from "./salesAgentTypes";

export type OperatorCopilotRunId = string;

export type OperatorCopilotMode =
  | "explain_decision"
  | "summarize_customer"
  | "summarize_lead"
  | "summarize_opportunity"
  | "recommend_next_action"
  | "inspect_evidence"
  | "inspect_policy"
  | "inspect_agent_run"
  | "review_pending_actions"
  | "compare_options"
  | "diagnose_block"
  | "prepare_command"
  | "answer_operator_question";

export type OperatorCopilotOutcome =
  | "explanation_provided"
  | "summary_provided"
  | "recommendation_provided"
  | "command_proposed"
  | "review_required"
  | "insufficient_context"
  | "access_restricted"
  | "blocked"
  | "failed_safe";

export type OperatorCopilotConfidence = "high" | "medium" | "low";

export type OperatorCopilotRiskLevel = "low" | "medium" | "high" | "blocked";

export type OperatorCopilotReviewDecision =
  | "approve"
  | "reject"
  | "request_changes"
  | "defer"
  | "cancel";

export type OperatorCopilotCommandType =
  | "approve_proposed_action"
  | "reject_proposed_action"
  | "request_action_changes"
  | "create_internal_task"
  | "request_sales_analysis"
  | "request_followup_evaluation"
  | "request_quote_draft"
  | "request_handoff"
  | "propose_lead_update"
  | "propose_opportunity_update"
  | "pause_ai_for_customer"
  | "resume_ai_for_customer"
  | "block_outbound"
  | "unblock_outbound"
  | "assign_operator"
  | "add_operator_note"
  | "none";

export type OperatorCopilotCommandTargetType =
  | "customer"
  | "lead"
  | "opportunity"
  | "conversation"
  | "case"
  | "proposed_action"
  | "followup_plan"
  | "quote_draft"
  | "agent_run"
  | "system";

export type OperatorCopilotRole =
  | "admin"
  | "supervisor"
  | "sales_operator"
  | "support_operator"
  | "read_only"
  | "system";

export type OperatorCopilotScopeType =
  | "customer"
  | "lead"
  | "opportunity"
  | "conversation"
  | "case"
  | "agent_run"
  | "proposed_action"
  | "followup_plan"
  | "quote_draft"
  | "work_queue"
  | "global";

export type OperatorCopilotEvidenceSource =
  | "sales_agent"
  | "followup_policy"
  | "brain_context"
  | "customer_candidate"
  | "conversation"
  | "case"
  | "prestashop"
  | "knowledge_base"
  | "product_tool"
  | "price_tool"
  | "stock_tool"
  | "order_tool"
  | "operator_note"
  | "audit_log"
  | "governance"
  | "unknown";

export type OperatorCopilotDataFreshnessLevel =
  | "fresh"
  | "recent"
  | "stale"
  | "unknown";

export type OperatorCopilotReviewItemStatus =
  | "pending"
  | "under_review"
  | "approved"
  | "rejected"
  | "changes_requested"
  | "deferred"
  | "expired"
  | "cancelled";

export type OperatorCopilotMetadata = Record<string, unknown>;

export type OperatorCopilotHardBlockedCapability = SalesAgentHardBlockedCapability;

export type OperatorCopilotScopeReference = {
  type: OperatorCopilotScopeType;
  referenceId: string;
  label?: string | null;
  metadata?: OperatorCopilotMetadata;
};

export type OperatorCopilotCustomerSummary = {
  customerMasterId?: string | null;
  customerCandidateId?: string | null;
  displayName?: string | null;
  identityStatus: "master" | "candidate" | "provisional" | "unknown";
  summary: string;
  confidence: OperatorCopilotConfidence;
  metadata?: OperatorCopilotMetadata;
};

export type OperatorCopilotSanitizedMessage = {
  messageId?: string | null;
  direction: "inbound" | "outbound" | "internal" | "unknown";
  channel: CommercialChannelReference["channel"];
  summary: string;
  sentAt?: string | null;
  authorType?: "customer" | "agent" | "operator" | "system" | "unknown";
  sanitized: boolean;
  metadata?: OperatorCopilotMetadata;
};

export type OperatorCopilotAgentRunReference = {
  runId: string;
  agentName: string;
  agentVersion: string;
  status: string;
  startedAt: string;
  completedAt?: string | null;
  durationMs?: number | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  estimatedCost?: number | null;
  decisionReference?: string | null;
  errorCode?: string | null;
  warnings: string[];
  sanitized: boolean;
  metadata?: OperatorCopilotMetadata;
};

export type OperatorCopilotEvidenceReference = {
  sourceType: OperatorCopilotEvidenceSource;
  sourceReference?: string | null;
  summary: string;
  confidence: SalesAgentConfidence;
  verified: boolean;
  observedAt?: string | null;
  expiresAt?: string | null;
  accessibleToOperator: boolean;
  metadata?: OperatorCopilotMetadata;
};

export type OperatorCopilotPolicyReference = {
  policyName: string;
  ruleId: string;
  summary: string;
  outcome: string;
  sourceReference?: string | null;
  appliedAt: string;
  version?: string | null;
  metadata?: OperatorCopilotMetadata;
};

export type OperatorCopilotDataFreshness = {
  level: OperatorCopilotDataFreshnessLevel;
  observedAt?: string | null;
  sourceUpdatedAt?: string | null;
  metadata?: OperatorCopilotMetadata;
};

export type OperatorCopilotExplanation = {
  subject: string;
  summary: string;
  keyFactors: string[];
  evidenceUsed: OperatorCopilotEvidenceReference[];
  counterEvidence: OperatorCopilotEvidenceReference[];
  assumptions: string[];
  policyRulesApplied: string[];
  blockedFactors: string[];
  missingInformation: string[];
  confidence: OperatorCopilotConfidence;
  riskLevel: OperatorCopilotRiskLevel;
  generatedAt: string;
};

export type OperatorCopilotSummary = {
  title: string;
  executiveSummary: string;
  currentState: string;
  keyEvents: string[];
  commercialSignals: CommercialSignal[];
  openRequirements: OpportunityRequirement[];
  unresolvedObjections: OpportunityObjection[];
  risks: string[];
  opportunities: string[];
  pendingDecisions: string[];
  suggestedFocus: string;
  freshness: OperatorCopilotDataFreshness;
  confidence: OperatorCopilotConfidence;
};

export type OperatorCopilotOption = {
  optionId: string;
  title: string;
  description: string;
  benefits: string[];
  risks: string[];
  constraints: string[];
  requiredEvidence: OperatorCopilotEvidenceReference[];
  requiresApproval: boolean;
  confidence: OperatorCopilotConfidence;
  recommended: boolean;
};

export type OperatorCopilotRecommendation = {
  title: string;
  recommendedAction: string;
  reason: string;
  expectedBenefit: string;
  risks: string[];
  alternatives: OperatorCopilotOption[];
  confidence: OperatorCopilotConfidence;
  urgency: CommercialPriority;
  requiresApproval: boolean;
  relatedEntityReferences: OperatorCopilotScopeReference[];
  expiresAt?: string | null;
};

export type OperatorCopilotProposedActionReference = {
  actionType: string;
  source: "sales_agent" | "followup_policy" | "copilot" | "governance" | "unknown";
  summary: string;
  payload?: Record<string, unknown>;
  confidence?: OperatorCopilotConfidence | null;
  requiresApproval?: boolean | null;
};

export type OperatorCopilotPolicyAssessment = {
  allowed: boolean;
  blocked: boolean;
  requiresApproval: boolean;
  appliedRules: string[];
  blockedCommands: OperatorCopilotCommandType[];
  blockedHardBlocks: OperatorCopilotHardBlockedCapability[];
  warnings: string[];
};

export type OperatorCopilotReviewItem = {
  reviewItemId: string;
  sourceType: OperatorCopilotEvidenceSource;
  sourceReference: string;
  title: string;
  summary: string;
  proposedAction: OperatorCopilotProposedActionReference;
  riskLevel: OperatorCopilotRiskLevel;
  requiredDecision: OperatorCopilotReviewDecision;
  evidence: OperatorCopilotEvidenceReference[];
  policyAssessment: OperatorCopilotPolicyAssessment;
  createdAt: string;
  expiresAt?: string | null;
  status: OperatorCopilotReviewItemStatus;
};

export type OperatorCopilotCommandProposal = {
  commandType: OperatorCopilotCommandType;
  targetType: OperatorCopilotCommandTargetType;
  targetId?: string | null;
  payload: Record<string, unknown>;
  reason: string;
  evidence: OperatorCopilotEvidenceReference[];
  riskLevel: OperatorCopilotRiskLevel;
  requiresApproval: boolean;
  requiredPermission: string;
  policyTags: string[];
  idempotencyHint?: string | null;
  expiresAt?: string | null;
  dryRun: boolean;
  confidence: OperatorCopilotConfidence;
};

export type OperatorCopilotRationale = {
  summary: string;
  evidence: OperatorCopilotEvidenceReference[];
  counterEvidence: OperatorCopilotEvidenceReference[];
  assumptions: string[];
  risks: string[];
  missingInformation: string[];
  policyRulesApplied: string[];
};

export type OperatorCopilotWarning = {
  code: OperatorCopilotErrorCode;
  message: string;
  severity: "info" | "warning" | "error";
  source?:
    | OperatorCopilotEvidenceSource
    | "policy"
    | "brain"
    | "sales_agent"
    | "followup_policy"
    | "governance"
    | "unknown";
  metadata?: OperatorCopilotMetadata;
};

export type OperatorCopilotPolicyContext = {
  allowedCommands?: OperatorCopilotCommandType[];
  blockedCommands?: OperatorCopilotCommandType[];
  blockedHardBlocks?: OperatorCopilotHardBlockedCapability[];
  approvalRequiredCommands?: OperatorCopilotCommandType[];
  policyTags?: string[];
  canInspectAgentRuns?: boolean;
  canInspectAudit?: boolean;
  canPrepareCommand?: boolean;
  metadata?: OperatorCopilotMetadata;
};

export type OperatorCopilotVisibleContext = {
  customerCandidate?: SalesAgentCustomerCandidateReference | null;
  customerSummary?: OperatorCopilotCustomerSummary | null;
  lead?: LeadReadModel | null;
  opportunity?: OpportunityReadModel | null;
  conversationSummary?: string | null;
  caseSummary?: string | null;
  recentMessages: OperatorCopilotSanitizedMessage[];
  commercialSignals: CommercialSignal[];
  requirements: OpportunityRequirement[];
  objections: OpportunityObjection[];
  productInterests: OpportunityProductInterest[];
  activeFollowUpPlan?: FollowUpPlanReadModel | null;
  pendingActions: OperatorCopilotReviewItem[];
  agentRuns: OperatorCopilotAgentRunReference[];
  evidence: OperatorCopilotEvidenceReference[];
  policies: OperatorCopilotPolicyReference[];
  warnings: OperatorCopilotWarning[];
  dataFreshness: OperatorCopilotDataFreshness;
  metadata?: OperatorCopilotMetadata;
};

export type OperatorCopilotOperatorContext = {
  operatorId: string;
  displayName?: string | null;
  role: OperatorCopilotRole;
  permissions: string[];
  assignedDepartments?: string[] | null;
  assignedOpportunityIds?: string[] | null;
  locale: string;
  timezone: string;
  metadata?: OperatorCopilotMetadata;
};

export type OperatorCopilotScope = {
  type: OperatorCopilotScopeType;
  referenceId?: string | null;
  relatedReferences: OperatorCopilotScopeReference[];
  requestedFields?: string[] | null;
};

export type OperatorCopilotInput = {
  runId: OperatorCopilotRunId;
  mode: OperatorCopilotMode;
  operator: OperatorCopilotOperatorContext;
  scope: OperatorCopilotScope;
  query?: string | null;
  visibleContext: OperatorCopilotVisibleContext;
  salesAgentResult?: SalesAgentResult | null;
  followUpDecisionResult?: FollowUpDecisionResult | null;
  pendingReviewItems: OperatorCopilotReviewItem[];
  availableCommands: OperatorCopilotCommandType[];
  policyContext: OperatorCopilotPolicyContext;
  currentTime: string;
  timezone: string;
  metadata?: OperatorCopilotMetadata;
};

export type OperatorCopilotAuditReference = {
  auditId: string;
  eventType: string;
  actorType: string;
  actorReference: string;
  targetType: string;
  targetReference: string;
  occurredAt: string;
  outcome: string;
  summary: string;
  immutable: boolean;
  accessibleToOperator: boolean;
  metadata?: OperatorCopilotMetadata;
};

export type OperatorCopilotResult = {
  runId: OperatorCopilotRunId;
  mode: OperatorCopilotMode;
  outcome: OperatorCopilotOutcome;
  explanation?: OperatorCopilotExplanation | null;
  summary?: OperatorCopilotSummary | null;
  recommendations: OperatorCopilotRecommendation[];
  options: OperatorCopilotOption[];
  reviewItems: OperatorCopilotReviewItem[];
  proposedCommands: OperatorCopilotCommandProposal[];
  warnings: OperatorCopilotWarning[];
  rationale: OperatorCopilotRationale;
  auditReferences: OperatorCopilotAuditReference[];
  metadata: OperatorCopilotMetadata;
};

export type OperatorCopilotReviewDecisionInput = {
  reviewItemId: string;
  decision: OperatorCopilotReviewDecision;
  reason?: string | null;
  approvedBy?: string | null;
  decidedAt?: string | null;
  metadata?: OperatorCopilotMetadata;
};

export type OperatorCopilotErrorCode =
  | "insufficient_context"
  | "unauthorized_scope"
  | "permission_denied"
  | "evidence_missing"
  | "policy_blocked"
  | "unsupported_command"
  | "stale_context"
  | "invalid_contract"
  | "agent_result_invalid"
  | "timeout"
  | "copilot_failure"
  | "unknown_error";
