import type {
  OperatorCopilotCommandTargetType,
  OperatorCopilotCommandType,
  OperatorCopilotConfidence,
  OperatorCopilotDataFreshnessLevel,
  OperatorCopilotErrorCode,
  OperatorCopilotEvidenceSource,
  OperatorCopilotHardBlockedCapability,
  OperatorCopilotMode,
  OperatorCopilotOutcome,
  OperatorCopilotReviewDecision,
  OperatorCopilotReviewItemStatus,
  OperatorCopilotRole,
  OperatorCopilotScopeType,
  OperatorCopilotRiskLevel,
} from "./operatorCopilotTypes";

export const OPERATOR_COPILOT_MODES = [
  "explain_decision",
  "summarize_customer",
  "summarize_lead",
  "summarize_opportunity",
  "recommend_next_action",
  "inspect_evidence",
  "inspect_policy",
  "inspect_agent_run",
  "review_pending_actions",
  "compare_options",
  "diagnose_block",
  "prepare_command",
  "answer_operator_question",
] as const satisfies readonly OperatorCopilotMode[];

export const OPERATOR_COPILOT_OUTCOMES = [
  "explanation_provided",
  "summary_provided",
  "recommendation_provided",
  "command_proposed",
  "review_required",
  "insufficient_context",
  "access_restricted",
  "blocked",
  "failed_safe",
] as const satisfies readonly OperatorCopilotOutcome[];

export const OPERATOR_COPILOT_CONFIDENCE_LEVELS = [
  "high",
  "medium",
  "low",
] as const satisfies readonly OperatorCopilotConfidence[];

export const OPERATOR_COPILOT_RISK_LEVELS = [
  "low",
  "medium",
  "high",
  "blocked",
] as const satisfies readonly OperatorCopilotRiskLevel[];

export const OPERATOR_COPILOT_REVIEW_DECISIONS = [
  "approve",
  "reject",
  "request_changes",
  "defer",
  "cancel",
] as const satisfies readonly OperatorCopilotReviewDecision[];

export const OPERATOR_COPILOT_COMMAND_TYPES = [
  "approve_proposed_action",
  "reject_proposed_action",
  "request_action_changes",
  "create_internal_task",
  "request_sales_analysis",
  "request_followup_evaluation",
  "request_quote_draft",
  "request_handoff",
  "propose_lead_update",
  "propose_opportunity_update",
  "pause_ai_for_customer",
  "resume_ai_for_customer",
  "block_outbound",
  "unblock_outbound",
  "assign_operator",
  "add_operator_note",
  "none",
] as const satisfies readonly OperatorCopilotCommandType[];

export const OPERATOR_COPILOT_ERROR_CODES = [
  "insufficient_context",
  "unauthorized_scope",
  "permission_denied",
  "evidence_missing",
  "policy_blocked",
  "unsupported_command",
  "stale_context",
  "invalid_contract",
  "agent_result_invalid",
  "timeout",
  "copilot_failure",
  "unknown_error",
] as const satisfies readonly OperatorCopilotErrorCode[];

export const OPERATOR_COPILOT_ROLES = [
  "admin",
  "supervisor",
  "sales_operator",
  "support_operator",
  "read_only",
  "system",
] as const satisfies readonly OperatorCopilotRole[];

export const OPERATOR_COPILOT_SCOPE_TYPES = [
  "customer",
  "lead",
  "opportunity",
  "conversation",
  "case",
  "agent_run",
  "proposed_action",
  "followup_plan",
  "quote_draft",
  "work_queue",
  "global",
] as const satisfies readonly OperatorCopilotScopeType[];

export const OPERATOR_COPILOT_REVIEW_ITEM_STATUSES = [
  "pending",
  "under_review",
  "approved",
  "rejected",
  "changes_requested",
  "deferred",
  "expired",
  "cancelled",
] as const satisfies readonly OperatorCopilotReviewItemStatus[];

export const OPERATOR_COPILOT_COMMAND_TARGET_TYPES = [
  "customer",
  "lead",
  "opportunity",
  "conversation",
  "case",
  "proposed_action",
  "followup_plan",
  "quote_draft",
  "agent_run",
  "system",
] as const satisfies readonly OperatorCopilotCommandTargetType[];

export const OPERATOR_COPILOT_EVIDENCE_SOURCES = [
  "sales_agent",
  "followup_policy",
  "brain_context",
  "customer_candidate",
  "conversation",
  "case",
  "prestashop",
  "knowledge_base",
  "product_tool",
  "price_tool",
  "stock_tool",
  "order_tool",
  "operator_note",
  "audit_log",
  "governance",
  "unknown",
] as const satisfies readonly OperatorCopilotEvidenceSource[];

export const OPERATOR_COPILOT_DATA_FRESHNESS_LEVELS = [
  "fresh",
  "recent",
  "stale",
  "unknown",
] as const satisfies readonly OperatorCopilotDataFreshnessLevel[];

export const OPERATOR_COPILOT_HARD_BLOCKED_COMMANDS = [
  "send_message_directly",
  "execute_phone_call",
  "merge_customer_identity",
  "modify_customer_master_identity",
  "apply_discount",
  "confirm_unverified_stock",
  "commit_delivery_date",
  "commit_dispatch_date",
  "issue_final_quote",
  "mark_won_without_evidence",
  "bypass_governance",
  "alter_audit_log",
  "delete_evidence",
] as const satisfies readonly OperatorCopilotHardBlockedCapability[];

export const OPERATOR_COPILOT_DEFAULT_DRY_RUN = true as const;
