import type { BrainToolName } from "../tools/types";
import { SALES_AGENT_REQUESTED_MODES, SALES_AGENT_STRUCTURAL_SIGNALS } from "./salesAgentConstants";

export type SerializableId = string | number | null;
export type SalesAgentRequestedMode = (typeof SALES_AGENT_REQUESTED_MODES)[number];
export type SalesAgentToolName = BrainToolName;
export type SalesAgentStructuralSignal = (typeof SALES_AGENT_STRUCTURAL_SIGNALS)[number];

export type SalesAgentMessageDirection = "inbound" | "outbound" | "manual" | "system";

export type SalesAgentMessageSnapshot = {
  id: SerializableId;
  direction: SalesAgentMessageDirection | null;
  text: string | null;
  occurredAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  messageType: string | null;
  finalAction: string | null;
  status: string | null;
  intent: string | null;
  department: string | null;
  channel: string | null;
  platform: string | null;
  waId: string | null;
  phoneNumberId: string | null;
  conversationCaseId: SerializableId;
  source: string | null;
};

export type SalesAgentIdentityContext = {
  conversationCaseId: SerializableId;
  waId: string | null;
  phoneNumberId: string | null;
  email: string | null;
  phone: string | null;
  idCustomer: SerializableId;
  idOrder: SerializableId;
  invoiceNumber: SerializableId;
  contactId: SerializableId;
  customerCandidate: Record<string, unknown> | null;
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
  lead?: Record<string, unknown> | undefined;
  opportunity?: Record<string, unknown> | undefined;
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
  availableCapabilities: SalesAgentToolName[];
  policyContext?: SalesAgentPolicyContext;
  metadata: Record<string, unknown>;
};

import type {
  CommercialActorReference,
  CommercialChannelReference,
  CommercialIntent,
  CommercialPriority,
  CommercialSignal,
  CommercialTemperature,
  CommercialValueEstimate,
  LeadReadModel,
  LeadSource,
  LeadStatus,
  OpportunityObjection,
  OpportunityProductInterest,
  OpportunityReadModel,
  OpportunityRequirement,
  OpportunityStage,
  OpportunityStatus,
} from "./types";
import type { FollowUpDecisionResult, FollowUpPlanReadModel } from "./followUpTypes";

export type SalesAgentRunId = string;

export type SalesAgentRequestedMode =
  | "respond"
  | "analyze"
  | "recommend_next_action"
  | "qualify"
  | "product_advice"
  | "quote_assistance"
  | "operator_assistance";

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

export type SalesAgentHardBlockedCapability =
  | "send_message_directly"
  | "execute_phone_call"
  | "merge_customer_identity"
  | "modify_customer_master_identity"
  | "apply_discount"
  | "confirm_unverified_stock"
  | "commit_delivery_date"
  | "commit_dispatch_date"
  | "issue_final_quote"
  | "mark_won_without_evidence"
  | "bypass_governance"
  | "alter_audit_log"
  | "delete_evidence";

export type SalesAgentToolName =
  | "knowledge_search"
  | "product_search"
  | "product_detail"
  | "price_lookup"
  | "stock_lookup"
  | "order_lookup"
  | "quote_draft_builder"
  | "followup_policy"
  | "customer_context_lookup"
  | "none";

export type SalesAgentConfidence = "high" | "medium" | "low";

export type SalesAgentRiskLevel = "low" | "medium" | "high" | "blocked";

export type SalesAgentApprovalRequirement =
  | "none"
  | "operator_review"
  | "explicit_operator_approval"
  | "blocked";

export type SalesAgentOutcome =
  | "response_proposed"
  | "action_proposed"
  | "tool_required"
  | "human_review_required"
  | "waiting_for_customer"
  | "no_action"
  | "blocked"
  | "failed_safe";

export type SalesAgentMessageIntent =
  | "answer_information"
  | "ask_requirements"
  | "qualify_need"
  | "recommend_product"
  | "explain_product_difference"
  | "explain_price"
  | "request_customer_data"
  | "explain_quote_process"
  | "acknowledge_objection"
  | "recover_conversation"
  | "confirm_human_review"
  | "wait"
  | "none";

export type SalesAgentClaimType =
  | "product_feature"
  | "product_compatibility"
  | "price"
  | "stock"
  | "discount"
  | "delivery"
  | "dispatch"
  | "warranty"
  | "service_availability"
  | "order_status"
  | "commercial_condition";

export type SalesAgentToolRequestStatus =
  | "proposed"
  | "required"
  | "optional"
  | "unavailable"
  | "blocked";

export type SalesAgentEvidenceSource =
  | "customer_message"
  | "conversation_history"
  | "brain_context"
  | "customer_candidate"
  | "prestashop"
  | "knowledge_base"
  | "product_tool"
  | "price_tool"
  | "stock_tool"
  | "order_tool"
  | "operator_input"
  | "policy"
  | "unknown";

export type SalesAgentErrorCode =
  | "insufficient_context"
  | "tool_unavailable"
  | "evidence_missing"
  | "policy_blocked"
  | "identity_conflict"
  | "invalid_contract"
  | "agent_failure"
  | "timeout"
  | "unknown_error";

export type QualificationState =
  | "not_started"
  | "partial"
  | "sufficient"
  | "complete"
  | "not_applicable"
  | "blocked";

export type CustomerReadiness =
  | "browsing"
  | "exploring"
  | "evaluating"
  | "ready_for_recommendation"
  | "ready_for_quote"
  | "ready_for_human_close"
  | "not_ready"
  | "unknown";

export type ProductFitAssessment =
  | "strong_fit"
  | "possible_fit"
  | "weak_fit"
  | "no_fit"
  | "insufficient_information"
  | "not_applicable";

export type SalesAgentMetadata = Record<string, unknown>;

export type SalesAgentMessageSnapshot = {
  messageId?: string | null;
  direction: "inbound" | "outbound" | "internal" | "unknown";
  channel: CommercialChannelReference["channel"];
  text: string;
  sentAt?: string | null;
  authorType?: "customer" | "agent" | "operator" | "system" | "unknown";
  metadata?: SalesAgentMetadata;
};

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
  platform:
    | "whatsapp"
    | "email"
    | "web"
    | "phone"
    | "hub"
    | "legacy"
    | "unknown";
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

export type SalesAgentCommercialContext = {
  leadStatus?: LeadStatus | null;
  opportunityStatus?: OpportunityStatus | null;
  opportunityStage?: OpportunityStage | null;
  primaryIntent?: CommercialIntent | null;
  priority: CommercialPriority;
  temperature: CommercialTemperature;
  estimatedValue?: CommercialValueEstimate | null;
  currentNextBestAction?: FollowUpDecisionResult | null;
  nextFollowUpAt?: string | null;
  activeFollowUpPlan?: FollowUpPlanReadModel | null;
  quoteStatus?: "none" | "draft" | "pending_review" | "sent" | "unknown" | null;
  source: LeadSource | "brain" | "system" | "unknown";
  assignedActor?: CommercialActorReference | null;
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
  observedAt?: string | null;
  expiresAt?: string | null;
  verified: boolean;
  metadata?: SalesAgentMetadata;
};

export type SalesAgentClaim = {
  type: SalesAgentClaimType;
  value?: string | number | boolean | Record<string, unknown> | null;
  summary?: string | null;
  evidenceSource: SalesAgentEvidenceSource;
  confidence: SalesAgentConfidence;
  verified: boolean;
  expiresAt?: string | null;
  requiresApproval: boolean;
  metadata?: SalesAgentMetadata;
};

export type SalesAgentEvidenceSummary = {
  summary: string;
  evidence: SalesAgentEvidence[];
  counterEvidence: SalesAgentEvidence[];
};

export type SalesAgentOpportunityAssessment = {
  summary: string;
  fit: ProductFitAssessment;
  recommendedStatus?: OpportunityStatus | null;
  recommendedStage?: OpportunityStage | null;
  confidence: SalesAgentConfidence;
};

export type SalesAgentObjectionAssessment = {
  summary: string;
  unresolvedObjections: Array<{
    type: OpportunityObjection["type"];
    summary: string;
    severity: SalesAgentRiskLevel;
    source: SalesAgentEvidenceSource;
    confidence: SalesAgentConfidence;
  }>;
};

export type SalesAgentAnalysis = {
  commercialContext: SalesAgentCommercialContext;
  customerContext?: SalesAgentCustomerContext | null;
  detectedIntent: CommercialIntent;
  detectedSignals: CommercialSignal[];
  qualificationState: QualificationState;
  missingInformation: string[];
  productFitAssessment: ProductFitAssessment;
  opportunityAssessment: SalesAgentOpportunityAssessment;
  objectionAssessment: SalesAgentObjectionAssessment;
  customerReadiness: CustomerReadiness;
  evidenceSummary: SalesAgentEvidenceSummary;
  risks: string[];
  assumptions: string[];
  confidence: SalesAgentConfidence;
};

export type SalesAgentNextBestAction = {
  summary: string;
  decisionType: SalesAgentDecisionType;
  actionType: SalesAgentActionType;
  tool?: SalesAgentToolName | null;
  recommendedChannel: CommercialChannelReference["channel"];
  urgency: CommercialPriority;
  confidence: SalesAgentConfidence;
  riskLevel: SalesAgentRiskLevel;
  requiresApproval: SalesAgentApprovalRequirement;
  reasonCodes: string[];
  followUpEvaluation?: FollowUpDecisionResult | null;
};

export type SalesAgentDecision = {
  type: SalesAgentDecisionType;
  outcome: SalesAgentOutcome;
  confidence: SalesAgentConfidence;
  riskLevel: SalesAgentRiskLevel;
  requiresApproval: SalesAgentApprovalRequirement;
  primaryReason: string;
  reasonCodes: string[];
  nextBestAction?: SalesAgentNextBestAction | null;
  shouldRespondNow: boolean;
  shouldRequestTool: boolean;
  shouldRequestHuman: boolean;
  shouldEvaluateFollowUp: boolean;
  proposedActions: SalesAgentProposedAction[];
};

export type SalesAgentProposedAction = {
  type: SalesAgentActionType;
  priority: CommercialPriority;
  confidence: SalesAgentConfidence;
  riskLevel: SalesAgentRiskLevel;
  requiresApproval: SalesAgentApprovalRequirement;
  reason: string;
  payload: Record<string, unknown>;
  expiresAt?: string | null;
  idempotencyHint?: string | null;
  dependencies: string[];
  policyTags: string[];
};

export type SalesAgentToolRequest = {
  tool: SalesAgentToolName;
  status: SalesAgentToolRequestStatus;
  purpose: string;
  requiredInputs: string[];
  optionalInputs: string[];
  urgency: CommercialPriority;
  blocking: boolean;
  reason: string;
  expectedEvidence: string[];
  fallbackDecision: SalesAgentDecisionType | "none";
  metadata?: SalesAgentMetadata;
};

export type SalesAgentEntityType = "lead" | "opportunity" | "unknown";

export type SalesAgentEntityProposal =
  | {
      entityType: "lead";
      entityId?: string | null;
      proposedChanges: {
        status?: LeadStatus | null;
        primaryIntent?: CommercialIntent | null;
        commercialTemperature?: CommercialTemperature | null;
        signals?: CommercialSignal[];
        displayName?: string | null;
        contactReferences?: CommercialChannelReference[];
      };
      evidence: SalesAgentEvidence[];
      confidence: SalesAgentConfidence;
      requiresApproval: SalesAgentApprovalRequirement;
      reason: string;
    }
  | {
      entityType: "opportunity";
      entityId?: string | null;
      proposedChanges: {
        status?: OpportunityStatus | null;
        stage?: OpportunityStage | null;
        primaryIntent?: CommercialIntent | null;
        priority?: CommercialPriority | null;
        commercialTemperature?: CommercialTemperature | null;
        productInterests?: OpportunityProductInterest[];
        requirements?: OpportunityRequirement[];
        objections?: OpportunityObjection[];
        signals?: CommercialSignal[];
        estimatedValue?: CommercialValueEstimate | null;
        currentNextBestAction?: FollowUpDecisionResult | null;
        nextFollowUpAt?: string | null;
      };
      evidence: SalesAgentEvidence[];
      confidence: SalesAgentConfidence;
      requiresApproval: SalesAgentApprovalRequirement;
      reason: string;
    }
  | {
      entityType: "unknown";
      entityId?: string | null;
      proposedChanges: Record<string, unknown>;
      evidence: SalesAgentEvidence[];
      confidence: SalesAgentConfidence;
      requiresApproval: SalesAgentApprovalRequirement;
      reason: string;
    };

export type SalesAgentResponseProposal = {
  messageIntent: SalesAgentMessageIntent;
  draftText?: string | null;
  language: string;
  tone: string;
  questions: string[];
  claims: SalesAgentClaim[];
  disclaimers: string[];
  requiresApproval: boolean;
  blockedClaims: SalesAgentClaim[];
  confidence: SalesAgentConfidence;
};

export type SalesAgentPolicyContext = {
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

export type SalesAgentInput = {
  runId: SalesAgentRunId;
  currentTime: string;
  timezone: string;
  lead?: LeadReadModel | null;
  opportunity?: OpportunityReadModel | null;
  customerCandidate?: SalesAgentCustomerCandidateReference | null;
  conversationContext: SalesAgentConversationContext;
  recentMessages: SalesAgentMessageSnapshot[];
  commercialSignals: CommercialSignal[];
  unresolvedObjections: OpportunityObjection[];
  knownRequirements: OpportunityRequirement[];
  knownProductInterests: OpportunityProductInterest[];
  knowledgeContext?: SalesAgentKnowledgeContext | null;
  availableCapabilities: Array<SalesAgentActionType | SalesAgentToolName>;
  policyContext: SalesAgentPolicyContext;
  requestedMode: SalesAgentRequestedMode;
  metadata?: SalesAgentMetadata;
};

export type SalesAgentPolicyAssessment = {
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
  policyAssessment: SalesAgentPolicyAssessment;
  rationale: SalesAgentRationale;
  evidence: SalesAgentEvidence[];
  warnings: SalesAgentWarning[];
  metadata: SalesAgentMetadata;
};