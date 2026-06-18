import type { BrainToolName } from "../tools/types";
import type { CommercialChannelReference, LeadReadModel, LeadSource, OpportunityReadModel } from "./types";
import type { FollowUpDecisionResult } from "./followUpTypes";

export type SerializableId = string | number | null;
export type SalesAgentRequestedMode = "minimal" | "standard" | "recovery";
export type SalesAgentToolName = BrainToolName;
export type SalesAgentStructuralSignal =
  | "customer_message_present"
  | "customer_candidate_available"
  | "customer_reference_available"
  | "order_reference_available"
  | "product_service_context_available"
  | "conversation_history_available"
  | "human_owner_active"
  | "ai_blocked"
  | "manual_reply_active"
  | "commercial_entity_available";

export type SalesAgentMessageSnapshot = {
  id?: SerializableId;
  messageId?: string | null;
  direction: "inbound" | "outbound" | "manual" | "system" | "internal" | "unknown" | null;
  text: string | null;
  occurredAt?: string | null;
  sentAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  messageType?: string | null;
  finalAction?: string | null;
  status?: string | null;
  intent?: string | null;
  department?: string | null;
  channel?: string | null;
  platform?: string | null;
  waId?: string | null;
  phoneNumberId?: string | null;
  conversationCaseId?: SerializableId;
  source?: string | null;
  authorType?: "customer" | "agent" | "operator" | "system" | "unknown" | null;
  metadata?: Record<string, unknown>;
};

export type SalesAgentIdentityContext = {
  conversationCaseId: SerializableId;
  waId: string | null;
  phoneNumberId?: string | null;
  email: string | null;
  phone: string | null;
  idCustomer: SerializableId;
  idOrder: SerializableId;
  invoiceNumber: SerializableId;
  contactId: SerializableId;
  customerCandidate?: Record<string, unknown> | null;
};

export type SalesAgentMessageContext = {
  latestInboundMessage: SalesAgentMessageSnapshot | null;
  latestOutboundMessage: SalesAgentMessageSnapshot | null;
  recentMessages: SalesAgentMessageSnapshot[];
  latestInboundAt: string | null;
  latestOutboundAt: string | null;
};

export type SalesAgentCaseContext = {
  status: string | null;
  lifecycleStatus: string | null;
  department: string | null;
  humanOwnershipActive: boolean;
  aiBlocked: boolean;
  manualReplyActive: boolean;
};

export type SalesAgentCommercialContext = {
  commercialIntentLegacy: string | null;
  orderContext: Record<string, unknown> | null;
  productServiceContext: Record<string, unknown> | null;
  lead?: Record<string, unknown> | null;
  opportunity?: Record<string, unknown> | null;
  leadStatus?: string | null;
  opportunityStatus?: string | null;
  opportunityStage?: string | null;
  primaryIntent?: string | null;
  priority?: string | null;
  temperature?: string | null;
  estimatedValue?: Record<string, unknown> | null;
  currentNextBestAction?: Record<string, unknown> | null;
  nextFollowUpAt?: string | null;
  activeFollowUpPlan?: Record<string, unknown> | null;
  quoteStatus?: string | null;
  source?: string | null;
  assignedActor?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
};

export type SalesAgentPolicyContext = {
  policyId?: string;
  source?: string;
  dryRun?: boolean;
  allowAutoReply?: boolean;
  allowHumanHandoff?: boolean;
  allowCaseMutation?: boolean;
  allowCaseClose?: boolean;
  allowFollowup?: boolean;
  continueLegacyFlow?: boolean;
  blockedReasons?: string[];
  notes?: string[];
  allowedActions?: string[];
  blockedActions?: string[];
  blockedClaims?: string[];
  allowedTools?: readonly SalesAgentToolName[];
  approvalRequiredActions?: string[];
  approvalRequiredClaims?: string[];
  policyTags?: string[];
  canRespond?: boolean;
  canDraft?: boolean;
  canRequestTool?: boolean;
  canChangeLead?: boolean;
  canChangeOpportunity?: boolean;
  metadata?: Record<string, unknown>;
};

export type SalesAgentInput = {
  requestedMode: SalesAgentRequestedMode;
  currentTime: string;
  timezone: string;
  channel: string | null;
  platform: string | null;
  department: string | null;
  identity: SalesAgentIdentityContext;
  messages: SalesAgentMessageContext;
  caseContext: SalesAgentCaseContext;
  commercial: SalesAgentCommercialContext;
  structuralSignals: SalesAgentStructuralSignal[];
  availableCapabilities: readonly SalesAgentToolName[];
  policyContext?: SalesAgentPolicyContext;
  metadata: Record<string, unknown>;
  runId?: string;
  lead?: Record<string, unknown> | null;
  opportunity?: Record<string, unknown> | null;
  customerCandidate?: Record<string, unknown> | null;
  conversationContext?: Record<string, unknown>;
  recentMessages?: SalesAgentMessageSnapshot[];
  commercialSignals?: unknown[];
  unresolvedObjections?: unknown[];
  knownRequirements?: unknown[];
  knownProductInterests?: unknown[];
  knowledgeContext?: Record<string, unknown> | null;
};

export type SalesAgentRunId = string;
export type SalesAgentConfidence = "high" | "medium" | "low";
export type SalesAgentRiskLevel = "low" | "medium" | "high" | "blocked";
export type SalesAgentApprovalRequirement = "none" | "operator_review" | "explicit_operator_approval" | "blocked";
export type SalesAgentOutcome = "response_proposed" | "action_proposed" | "tool_required" | "human_review_required" | "waiting_for_customer" | "no_action" | "blocked" | "failed_safe";
export type SalesAgentMessageIntent = "answer_information" | "ask_requirements" | "qualify_need" | "recommend_product" | "explain_product_difference" | "explain_price" | "request_customer_data" | "explain_quote_process" | "acknowledge_objection" | "recover_conversation" | "confirm_human_review" | "wait" | "none";
export type SalesAgentClaimType = "product_feature" | "product_compatibility" | "price" | "stock" | "discount" | "delivery" | "dispatch" | "warranty" | "service_availability" | "order_status" | "commercial_condition";
export type SalesAgentToolRequestStatus = "proposed" | "required" | "optional" | "unavailable" | "blocked";
export type SalesAgentErrorCode = "insufficient_context" | "tool_unavailable" | "evidence_missing" | "policy_blocked" | "identity_conflict" | "invalid_contract" | "agent_failure" | "timeout" | "unknown_error";
export type SalesAgentEvidenceSource = "customer_message" | "conversation_history" | "brain_context" | "customer_candidate" | "prestashop" | "knowledge_base" | "product_tool" | "price_tool" | "stock_tool" | "order_tool" | "operator_input" | "policy" | "unknown";
export type QualificationState = "not_started" | "partial" | "sufficient" | "complete" | "not_applicable" | "blocked";
export type CustomerReadiness = "browsing" | "exploring" | "evaluating" | "ready_for_recommendation" | "ready_for_quote" | "ready_for_human_close" | "not_ready" | "unknown";
export type ProductFitAssessment = "strong_fit" | "possible_fit" | "weak_fit" | "no_fit" | "insufficient_information" | "not_applicable";
export type SalesAgentHardBlockedCapability = "send_message_directly" | "execute_phone_call" | "merge_customer_identity" | "modify_customer_master_identity" | "apply_discount" | "confirm_unverified_stock" | "commit_delivery_date" | "commit_dispatch_date" | "issue_final_quote" | "mark_won_without_evidence" | "bypass_governance" | "alter_audit_log" | "delete_evidence";

export type SalesAgentMetadata = Record<string, unknown>;

export type SalesAgentCustomerCandidateReference = {
  id: string;
  displayName?: string | null;
  summary?: string | null;
  confidence?: SalesAgentConfidence | null;
  source?: LeadSource | "brain" | "system" | "unknown";
  metadata?: SalesAgentMetadata;
};

export type SalesAgentCustomerContext = {
  customerMasterId?: string | null;
  customerCandidate?: SalesAgentCustomerCandidateReference | null;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  waId?: string | null;
  source?: LeadSource | "brain" | "system" | "unknown";
  confidence?: SalesAgentConfidence | null;
  metadata?: SalesAgentMetadata;
};

export type SalesAgentConversationContext = {
  channel: CommercialChannelReference["channel"];
  platform: "whatsapp" | "email" | "web" | "phone" | "hub" | "legacy" | "unknown";
  direction: "inbound" | "outbound" | "internal" | "unknown";
  latestCustomerMessage: string;
  latestOutboundMessage?: string | null;
  conversationCaseId?: string | number | null;
  threadReference?: string | null;
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
  messageCount?: number | null;
  language: string;
  businessHours: boolean;
  humanOwnerActive: boolean;
  aiBlocked: boolean;
  metadata?: SalesAgentMetadata;
};

export type SalesAgentKnowledgeFact = {
  label: string;
  summary: string;
  confidence: SalesAgentConfidence;
  evidenceSource: SalesAgentEvidenceSource;
  verified: boolean;
  sourceReference?: string | null;
};

export type SalesAgentKnowledgeContext = {
  summary?: string | null;
  facts?: SalesAgentKnowledgeFact[];
  lastUpdatedAt?: string | null;
  metadata?: SalesAgentMetadata;
};

export type SalesAgentEvidence = {
  sourceType: SalesAgentEvidenceSource;
  sourceReference?: string | null;
  evidenceType: string;
  summary: string;
  confidence: SalesAgentConfidence;
};

export type SalesAgentClaim = {
  type: SalesAgentClaimType;
  value: string;
  evidence: SalesAgentEvidence[];
  evidenceSource: SalesAgentEvidenceSource;
  confidence: SalesAgentConfidence;
  verified?: boolean;
  riskLevel?: SalesAgentRiskLevel;
  requiresApproval?: SalesAgentApprovalRequirement;
  blockedReason?: string | null;
};

export type SalesAgentAnalysis = {
  messageIntent: SalesAgentMessageIntent;
  claims: SalesAgentClaim[];
  blockedClaims: SalesAgentClaim[];
  confidence: SalesAgentConfidence;
  riskLevel: SalesAgentRiskLevel;
  rationale: string;
  summary: string;
  signals?: string[];
};

export type SalesAgentDecision = {
  decisionType: SalesAgentDecisionType;
  actionType: SalesAgentActionType;
  confidence: SalesAgentConfidence;
  riskLevel: SalesAgentRiskLevel;
  requiresApproval: SalesAgentApprovalRequirement;
  reason: string;
};

export type SalesAgentActionType =
  | "draft_customer_reply"
  | "query_knowledge"
  | "query_products"
  | "query_price"
  | "query_stock"
  | "query_order"
  | "create_quote_draft"
  | "evaluate_followup"
  | "create_internal_task"
  | "request_operator_review"
  | "request_handoff"
  | "propose_lead_update"
  | "propose_opportunity_update"
  | "record_commercial_signal"
  | "none";

export type SalesAgentDecisionType =
  | "answer_customer"
  | "ask_clarifying_question"
  | "qualify_lead"
  | "advance_opportunity"
  | "recommend_products"
  | "request_product_lookup"
  | "request_price_lookup"
  | "request_stock_lookup"
  | "request_order_lookup"
  | "request_quote_draft"
  | "propose_followup_evaluation"
  | "propose_internal_task"
  | "propose_operator_review"
  | "propose_handoff"
  | "wait_for_customer"
  | "pause_commercial_contact"
  | "recommend_stalled"
  | "recommend_lost"
  | "no_commercial_action"
  | "insufficient_context"
  | "blocked_by_policy";

export type SalesAgentProposedAction = {
  type: SalesAgentActionType;
  reason: string;
  confidence: SalesAgentConfidence;
  riskLevel: SalesAgentRiskLevel;
  requiresApproval: SalesAgentApprovalRequirement;
  payload?: Record<string, unknown> | null;
};

export type SalesAgentToolRequest = {
  toolName: SalesAgentToolName;
  status: SalesAgentToolRequestStatus;
  reason: string;
  confidence?: SalesAgentConfidence | null;
  blocking?: boolean;
  expectedEvidence?: string[];
  requiredInputs?: Record<string, unknown>;
  optionalInputs?: Record<string, unknown>;
  fallbackDecision: SalesAgentDecisionType | "none";
  riskLevel?: SalesAgentRiskLevel;
};

export type SalesAgentEntityType = "lead" | "opportunity" | "unknown";

export type SalesAgentEntityProposal =
  | {
      entityType: "lead";
      proposedChanges: Partial<LeadReadModel> | Record<string, unknown>;
      evidence: SalesAgentEvidence[];
      confidence: SalesAgentConfidence;
      requiresApproval: SalesAgentApprovalRequirement;
      reason: string;
      blockedReason?: string | null;
      expiresAt?: string | null;
      policyTags?: string[];
      idempotencyHint?: string | null;
      mutationIntent?: "create" | "update" | "noop";
    }
  | {
      entityType: "opportunity";
      proposedChanges: Partial<OpportunityReadModel> | Record<string, unknown>;
      evidence: SalesAgentEvidence[];
      confidence: SalesAgentConfidence;
      requiresApproval: SalesAgentApprovalRequirement;
      reason: string;
      blockedReason?: string | null;
      expiresAt?: string | null;
      policyTags?: string[];
      idempotencyHint?: string | null;
      mutationIntent?: "create" | "update" | "noop";
    }
  | {
      entityType: "unknown";
      proposedChanges: Record<string, unknown>;
      evidence: SalesAgentEvidence[];
      confidence: SalesAgentConfidence;
      requiresApproval: SalesAgentApprovalRequirement;
      reason: string;
      blockedReason?: string | null;
      expiresAt?: string | null;
      policyTags?: string[];
      idempotencyHint?: string | null;
      mutationIntent?: "create" | "update" | "noop";
    };

export type SalesAgentResponseProposal = {
  messageIntent: SalesAgentMessageIntent;
  draftText: string;
  claims: SalesAgentClaim[];
  disclaimers: string[];
  requiresApproval: boolean;
  blockedClaims: SalesAgentClaim[];
  confidence: SalesAgentConfidence;
};

export type SalesAgentPolicyAssessment = {
  allowedActions?: SalesAgentActionType[];
  blockedActions?: SalesAgentActionType[];
  blockedClaims?: SalesAgentClaimType[];
  allowedTools?: SalesAgentToolName[];
  approvalRequiredActions?: SalesAgentActionType[];
  approvalRequiredClaims?: SalesAgentClaimType[];
  policyTags?: string[];
  canRespond?: boolean;
  canDraft?: boolean;
  canRequestTool?: boolean;
  canChangeLead?: boolean;
  canChangeOpportunity?: boolean;
  metadata?: SalesAgentMetadata;
};

export type SalesAgentPolicyAssessmentSummary = {
  allowed: boolean;
  blocked: boolean;
  requiresApproval: boolean;
  appliedRules: string[];
  blockedActions: SalesAgentActionType[];
  blockedClaims: SalesAgentClaimType[];
  warnings: string[];
};

export type SalesAgentRationale = {
  summary: string;
  evidence: SalesAgentEvidence[];
  counterEvidence: SalesAgentEvidence[];
  assumptions: string[];
  riskFlags: string[];
  missingInformation: string[];
  policyRulesApplied: string[];
};

export type SalesAgentWarning = {
  code: SalesAgentErrorCode;
  message: string;
  severity: "info" | "warning" | "error";
  source?: SalesAgentEvidenceSource | SalesAgentToolName | "brain" | "policy" | "knowledge_agent" | "unknown";
  metadata?: SalesAgentMetadata;
};

export type SalesAgentResult = {
  runId: SalesAgentRunId;
  requestedMode: SalesAgentRequestedMode;
  outcome: SalesAgentOutcome;
  commercialContext: SalesAgentCommercialContext;
  customerContext?: SalesAgentCustomerContext | null;
  analysis: SalesAgentAnalysis;
  decision: SalesAgentDecision;
  responseProposal?: SalesAgentResponseProposal | null;
  toolRequests: SalesAgentToolRequest[];
  proposedActions: SalesAgentProposedAction[];
  entityProposals: SalesAgentEntityProposal[];
  followUpEvaluation?: FollowUpDecisionResult | null;
  policyAssessment: SalesAgentPolicyAssessmentSummary;
  rationale: SalesAgentRationale;
  evidence: SalesAgentEvidence[];
  warnings: SalesAgentWarning[];
  metadata: SalesAgentMetadata;
};
