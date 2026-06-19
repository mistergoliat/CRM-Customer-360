import type { CommercialProposedAction } from "../action-lifecycle";

export type CommercialFollowUpIntent =
  | "quote_followup"
  | "product_interest_followup"
  | "missing_information_followup"
  | "payment_or_checkout_followup"
  | "availability_followup"
  | "post_handoff_followup"
  | "reactivation_followup"
  | "no_followup";

export type CommercialFollowUpPlanStatus =
  | "not_needed"
  | "recommended"
  | "requires_operator_review"
  | "blocked"
  | "cancelled"
  | "expired"
  | "invalid";

export type CommercialFollowUpBlockReason =
  | "case_closed"
  | "ai_blocked"
  | "human_owner_active"
  | "customer_replied_after_last_agent_message"
  | "high_risk_intent"
  | "complaint_or_warranty"
  | "missing_customer_identity"
  | "missing_channel"
  | "outside_policy_window"
  | "cooldown_active"
  | "max_attempts_reached"
  | "unsafe_message"
  | "no_commercial_opportunity";

export type CommercialFollowUpCancelReason =
  | "customer_replied"
  | "case_closed"
  | "human_took_over"
  | "ai_blocked"
  | "opportunity_closed"
  | "policy_changed"
  | "expired";

export type CommercialFollowUpRiskLevel = "low" | "medium" | "high" | "critical" | "unknown";

export type CommercialFollowUpApprovalRequirement = "none" | "operator_review" | "manager_review" | "blocked";

export type CommercialFollowUpChannel = "whatsapp" | "email" | "internal" | "unknown";

export type CommercialFollowUpPlan = {
  planId: string;
  opportunityId: string | null;
  decisionId: string | null;
  caseId: string | null;
  messageId: string | null;

  status: CommercialFollowUpPlanStatus;
  intent: CommercialFollowUpIntent;

  channel: CommercialFollowUpChannel;
  recipient: string | null;

  scheduledFor: string | null;
  timezone: string;

  draftMessage: string | null;

  riskLevel: CommercialFollowUpRiskLevel;
  approvalRequirement: CommercialFollowUpApprovalRequirement;

  blockReasons: CommercialFollowUpBlockReason[];
  cancelReason: CommercialFollowUpCancelReason | null;

  rationale: string;
  policyNotes: string[];

  attemptNumber: number;
  maxAttempts: number;

  idempotencyKey: string;

  executable: false;
  persisted: false;

  createdAt: string;
};

export type CommercialFollowUpOpportunitySnapshot = {
  id: string | null;
  status: string | null;
  stage: string | null;
  temperature: string | null;
  priority: string | null;
  primaryIntent: string | null;
  currentSummary: string | null;
  missingRequirements: unknown;
  productInterests: unknown;
  objections: unknown;
  signals: unknown;
  lastActivityAt: string | null;
  lastCustomerMessageId: string | null;
  lastAgentDecisionId: string | null;
  nextActionType: string | null;
  humanOwnerActive: boolean;
  aiBlocked: boolean;
  closedAt: string | null;
};

export type CommercialFollowUpCaseContext = {
  caseId: string | null;
  status: string | null;
  lifecycleStatus: string | null;
  department: string | null;
  priority: string | null;
  requiresHuman: boolean;
  lastMessageAt: string | null;
  closedAt: string | null;
};

export type CommercialFollowUpConversationContext = {
  waId: string | null;
  channel: CommercialFollowUpChannel;
  lastCustomerMessageAt: string | null;
  lastAgentMessageAt: string | null;
  lastInboundText: string | null;
  lastOutboundText: string | null;
};

export type CommercialFollowUpLastDecision = {
  decisionId: string | null;
  nextActionJson: unknown;
  policyStatus: string | null;
  riskLevel: string | null;
  approvalRequirement: string | null;
  decisionStatus: string | null;
  createdAt: string | null;
};

export type CommercialFollowUpPolicy = {
  maxAttempts: number;
  cooldownHours: number;
  defaultDelayHours: number;
  requireOperatorReview: boolean;
  allowLowRiskAutoApprovalPreview: boolean;
};

export type CommercialFollowUpPlanningInput = {
  now: string;
  timezone: string;
  opportunity: CommercialFollowUpOpportunitySnapshot | null;
  caseContext: CommercialFollowUpCaseContext | null;
  conversation: CommercialFollowUpConversationContext;
  lastDecision: CommercialFollowUpLastDecision | null;
  policy: CommercialFollowUpPolicy;
};

export type CommercialFollowUpPlanValidationCode =
  | "valid"
  | "invalid_root"
  | "missing_required_field"
  | "invalid_enum_value"
  | "invalid_iso_timestamp"
  | "invalid_number"
  | "invalid_boolean"
  | "invalid_string"
  | "invalid_invariant"
  | "draft_message_too_long"
  | "rationale_too_long"
  | "too_many_policy_notes"
  | "too_many_block_reasons"
  | "unknown_issue";

export type CommercialFollowUpPlanValidationResult = {
  valid: boolean;
  code: CommercialFollowUpPlanValidationCode;
  reason: string;
  value: CommercialFollowUpPlan | null;
  warnings: string[];
};

export type CommercialFollowUpActionPreviewResult = CommercialProposedAction;
