export type CommercialActionType =
  | "send_whatsapp_reply"
  | "schedule_followup"
  | "create_internal_task"
  | "prepare_quote_draft"
  | "take_over_case"
  | "pause_ai"
  | "request_more_context"
  | "mark_lost_candidate"
  | "no_action";

export type CommercialActionStatus =
  | "draft"
  | "proposed"
  | "requires_review"
  | "approved"
  | "rejected"
  | "edited"
  | "blocked"
  | "planned"
  | "scheduled"
  | "executing"
  | "executed"
  | "failed"
  | "cancelled"
  | "expired";

export type OperatorReviewDecision =
  | "approve"
  | "reject"
  | "edit"
  | "request_more_context"
  | "take_over"
  | "mark_not_useful";

export type CommercialActionApprovalRequirement = "none" | "operator_review" | "manager_review" | "blocked";

export type CommercialActionRiskLevel = "low" | "medium" | "high" | "critical" | "unknown";

export type CommercialActionChannel = "whatsapp" | "email" | "internal" | "unknown";

export type CommercialActionLifecycleValidationCode =
  | "valid"
  | "invalid_root"
  | "invalid_status"
  | "invalid_action_type"
  | "invalid_review_decision"
  | "invalid_identifier"
  | "invalid_channel"
  | "missing_idempotency_key"
  | "invalid_transition"
  | "terminal_status_protected"
  | "execution_not_enabled_in_p1k_011a"
  | "unknown_issue";

export type CommercialActionLifecycleValidationResult = {
  allowed: boolean;
  code: CommercialActionLifecycleValidationCode;
  reason: string;
  fromStatus: CommercialActionStatus | null;
  toStatus: CommercialActionStatus | null;
  actionType: CommercialActionType | null;
  reviewDecision: OperatorReviewDecision | null;
  blockedReasons: string[];
  warnings: string[];
  executionNotEnabled: boolean;
  checkedAt: string;
  metadata: Record<string, unknown>;
};

export type CommercialActionLifecycleObjectValidationResult<T> = {
  valid: boolean;
  code: CommercialActionLifecycleValidationCode;
  reason: string;
  value: T | null;
  warnings: string[];
};

export type CommercialNextAction = {
  actionId: string;
  decisionId: string | null;
  opportunityId: string | null;
  caseId: string | null;
  messageId: string | null;
  type: CommercialActionType;
  status: CommercialActionStatus;
  channel: CommercialActionChannel;
  riskLevel: CommercialActionRiskLevel;
  approvalRequirement: CommercialActionApprovalRequirement;
  draftPayload: unknown;
  finalPayload: unknown | null;
  reason: string;
  blockedReasons: string[];
  idempotencyKey: string;
  executable: false;
  createdAt: string;
  updatedAt: string | null;
};

export type CommercialActionDecision = {
  decisionId: string;
  opportunityId: string | null;
  caseId: string | null;
  messageId: string | null;
  nextAction: CommercialNextAction;
  rationale: string;
  createdAt: string;
};

export type CommercialProposedAction = {
  actionId: string;
  decisionId: string | null;
  opportunityId: string | null;
  caseId: string | null;
  messageId: string | null;
  type: CommercialActionType;
  status: CommercialActionStatus;
  channel: CommercialActionChannel;
  riskLevel: CommercialActionRiskLevel;
  approvalRequirement: CommercialActionApprovalRequirement;
  draftPayload: unknown;
  finalPayload: unknown | null;
  reason: string;
  blockedReasons: string[];
  idempotencyKey: string;
  executable: false;
  createdAt: string;
  updatedAt: string | null;
};

export type CommercialOperatorReviewDraft = {
  reviewId: string;
  actionId: string;
  decision: OperatorReviewDecision;
  editedPayload: unknown | null;
  comment: string | null;
  reviewerId: string | null;
  createdAt: string;
  persisted: false;
};

export type CommercialApprovedAction = {
  actionId: string;
  proposalId: string | null;
  decisionId: string | null;
  opportunityId: string | null;
  caseId: string | null;
  messageId: string | null;
  type: CommercialActionType;
  status: Extract<CommercialActionStatus, "approved" | "edited" | "planned" | "scheduled">;
  channel: CommercialActionChannel;
  riskLevel: CommercialActionRiskLevel;
  approvalRequirement: CommercialActionApprovalRequirement;
  payload: unknown;
  reason: string;
  blockedReasons: string[];
  idempotencyKey: string;
  executable: false;
  approvedAt: string;
  approvedBy: string | null;
  updatedAt: string | null;
};

export type CommercialExecutableCommandPreview = {
  commandId: string;
  actionId: string;
  commandType: string;
  payloadPreview: unknown;
  target: {
    channel: string;
    recipient: string | null;
  };
  canExecute: false;
  blockedReasons: string[];
};

export type CommercialExecutionResult = {
  executionId: string;
  commandId: string;
  actionId: string;
  commandType: string;
  status: Extract<CommercialActionStatus, "executing" | "executed" | "failed" | "cancelled">;
  startedAt: string;
  completedAt: string | null;
  resultPayload: unknown | null;
  errorMessage: string | null;
};

export type CommercialActionLifecycleTransitionInput = {
  fromStatus: unknown;
  toStatus: unknown;
  actionType?: unknown;
  reviewDecision?: unknown;
  currentTime: string | Date;
  metadata?: Record<string, unknown>;
};
