import { BRAIN_TOOL_NAMES } from "../tools/types";

export const SALES_AGENT_REQUESTED_MODES = ["minimal", "standard", "recovery"] as const;

export const SALES_AGENT_STRUCTURAL_SIGNALS = [
  "customer_message_present",
  "customer_candidate_available",
  "customer_reference_available",
  "order_reference_available",
  "product_service_context_available",
  "conversation_history_available",
  "human_owner_active",
  "ai_blocked",
  "manual_reply_active",
  "commercial_entity_available"
] as const;

export const SALES_AGENT_INPUT_VERSION = "brain.sales-agent.input.v1" as const;
export const SALES_AGENT_OUTPUT_VERSION = "brain.sales-agent.output.v1" as const;

export const SALES_AGENT_CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export const SALES_AGENT_RISK_LEVELS = ["low", "medium", "high", "blocked"] as const;
export const SALES_AGENT_APPROVAL_REQUIREMENTS = ["none", "review", "operator_review", "handoff", "blocked"] as const;
export const SALES_AGENT_OUTCOMES = [
  "response_proposed",
  "tool_required",
  "waiting_for_customer",
  "blocked_by_policy",
  "no_commercial_action",
  "insufficient_context",
  "failed_safe"
] as const;
export const SALES_AGENT_DECISION_TYPES = [
  "respond_now",
  "request_tool",
  "request_human",
  "wait_for_customer",
  "blocked_by_policy",
  "no_commercial_action",
  "insufficient_context",
  "failed_safe"
] as const;
export const SALES_AGENT_ACTION_TYPES = [
  "send_whatsapp_message",
  "draft_response",
  "request_tool",
  "request_human_review",
  "follow_up",
  "no_action",
  "create_lead",
  "create_opportunity",
  "mutate_case"
] as const;
export const SALES_AGENT_BLOCKED_ACTIONS = ["create_lead", "create_opportunity", "mutate_case"] as const;
export const SALES_AGENT_TOOL_NAMES = BRAIN_TOOL_NAMES;
export const SALES_AGENT_TOOL_REQUEST_STATUSES = ["planned", "blocked", "noop"] as const;
export const SALES_AGENT_MESSAGE_INTENTS = [
  "answer",
  "clarify",
  "quote",
  "handoff",
  "follow_up",
  "confirm",
  "reject",
  "no_response",
  "blocked"
] as const;
export const SALES_AGENT_CLAIM_TYPES = [
  "general",
  "product",
  "price",
  "stock",
  "delivery",
  "dispatch",
  "order_status",
  "service_availability",
  "promotion",
  "warranty"
] as const;
export const SALES_AGENT_SENSITIVE_CLAIMS = [
  "price",
  "stock",
  "delivery",
  "dispatch",
  "order_status",
  "service_availability",
  "promotion"
] as const;
export const SALES_AGENT_EVIDENCE_SOURCES = [
  "customer_message",
  "customer_candidate",
  "conversation_history",
  "order_context",
  "product_service_context",
  "policy_context",
  "tool_result",
  "operator_input",
  "legacy_field"
] as const;
export const QUALIFICATION_STATES = ["unknown", "unqualified", "qualified", "disqualified", "pending"] as const;
export const CUSTOMER_READINESS_LEVELS = ["unknown", "not_ready", "developing", "ready", "blocked"] as const;
export const PRODUCT_FIT_ASSESSMENTS = ["unknown", "poor", "partial", "good", "strong"] as const;
export const SALES_AGENT_ERROR_CODES = [
  "none",
  "invalid_output",
  "missing_context",
  "blocked_by_policy",
  "tool_unavailable",
  "contract_error",
  "unsupported_contract_version",
  "run_id_mismatch",
  "forbidden_key",
  "non_serializable_value",
  "unknown"
] as const;

export const SALES_AGENT_ALLOWED_LEAD_PROPOSED_CHANGE_KEYS = [
  "status",
  "qualificationState",
  "customerReadiness",
  "productFit",
  "source",
  "score",
  "notes",
  "reason",
  "nextFollowUpAt",
  "lastInteractionAt"
] as const;

export const SALES_AGENT_ALLOWED_OPPORTUNITY_PROPOSED_CHANGE_KEYS = [
  "status",
  "stage",
  "amount",
  "currency",
  "probability",
  "expectedCloseAt",
  "reason",
  "notes",
  "nextFollowUpAt",
  "lastInteractionAt"
] as const;
=======
import type {
  SalesAgentActionType,
  SalesAgentApprovalRequirement,
  SalesAgentClaimType,
  SalesAgentConfidence,
  SalesAgentDecisionType,
  SalesAgentErrorCode,
  SalesAgentEvidenceSource,
  SalesAgentHardBlockedCapability,
  SalesAgentMessageIntent,
  SalesAgentOutcome,
  SalesAgentRequestedMode,
  SalesAgentRiskLevel,
  SalesAgentToolName,
  SalesAgentToolRequestStatus,
  CustomerReadiness,
  ProductFitAssessment,
  QualificationState,
} from "./salesAgentTypes";

export const SALES_AGENT_DECISION_TYPES = [
  "answer_customer",
  "ask_clarifying_question",
  "qualify_lead",
  "advance_opportunity",
  "recommend_products",
  "request_product_lookup",
  "request_price_lookup",
  "request_stock_lookup",
  "request_order_lookup",
  "request_quote_draft",
  "propose_followup_evaluation",
  "propose_internal_task",
  "propose_operator_review",
  "propose_handoff",
  "wait_for_customer",
  "pause_commercial_contact",
  "recommend_stalled",
  "recommend_lost",
  "no_commercial_action",
  "insufficient_context",
  "blocked_by_policy",
] as const satisfies readonly SalesAgentDecisionType[];

export const SALES_AGENT_ACTION_TYPES = [
  "draft_customer_reply",
  "query_knowledge",
  "query_products",
  "query_price",
  "query_stock",
  "query_order",
  "create_quote_draft",
  "evaluate_followup",
  "create_internal_task",
  "request_operator_review",
  "request_handoff",
  "propose_lead_update",
  "propose_opportunity_update",
  "record_commercial_signal",
  "none",
] as const satisfies readonly SalesAgentActionType[];

export const SALES_AGENT_TOOL_NAMES = [
  "knowledge_search",
  "product_search",
  "product_detail",
  "price_lookup",
  "stock_lookup",
  "order_lookup",
  "quote_draft_builder",
  "followup_policy",
  "customer_context_lookup",
  "none",
] as const satisfies readonly SalesAgentToolName[];

export const SALES_AGENT_CONFIDENCE_LEVELS = [
  "high",
  "medium",
  "low",
] as const satisfies readonly SalesAgentConfidence[];

export const SALES_AGENT_RISK_LEVELS = [
  "low",
  "medium",
  "high",
  "blocked",
] as const satisfies readonly SalesAgentRiskLevel[];

export const SALES_AGENT_APPROVAL_REQUIREMENTS = [
  "none",
  "operator_review",
  "explicit_operator_approval",
  "blocked",
] as const satisfies readonly SalesAgentApprovalRequirement[];

export const SALES_AGENT_OUTCOMES = [
  "response_proposed",
  "action_proposed",
  "tool_required",
  "human_review_required",
  "waiting_for_customer",
  "no_action",
  "blocked",
  "failed_safe",
] as const satisfies readonly SalesAgentOutcome[];

export const SALES_AGENT_REQUESTED_MODES = [
  "respond",
  "analyze",
  "recommend_next_action",
  "qualify",
  "product_advice",
  "quote_assistance",
  "operator_assistance",
] as const satisfies readonly SalesAgentRequestedMode[];

export const SALES_AGENT_MESSAGE_INTENTS = [
  "answer_information",
  "ask_requirements",
  "qualify_need",
  "recommend_product",
  "explain_product_difference",
  "explain_price",
  "request_customer_data",
  "explain_quote_process",
  "acknowledge_objection",
  "recover_conversation",
  "confirm_human_review",
  "wait",
  "none",
] as const satisfies readonly SalesAgentMessageIntent[];

export const SALES_AGENT_CLAIM_TYPES = [
  "product_feature",
  "product_compatibility",
  "price",
  "stock",
  "discount",
  "delivery",
  "dispatch",
  "warranty",
  "service_availability",
  "order_status",
  "commercial_condition",
] as const satisfies readonly SalesAgentClaimType[];

export const SALES_AGENT_TOOL_REQUEST_STATUSES = [
  "proposed",
  "required",
  "optional",
  "unavailable",
  "blocked",
] as const satisfies readonly SalesAgentToolRequestStatus[];

export const SALES_AGENT_ERROR_CODES = [
  "insufficient_context",
  "tool_unavailable",
  "evidence_missing",
  "policy_blocked",
  "identity_conflict",
  "invalid_contract",
  "agent_failure",
  "timeout",
  "unknown_error",
] as const satisfies readonly SalesAgentErrorCode[];

export const SALES_AGENT_EVIDENCE_SOURCES = [
  "customer_message",
  "conversation_history",
  "brain_context",
  "customer_candidate",
  "prestashop",
  "knowledge_base",
  "product_tool",
  "price_tool",
  "stock_tool",
  "order_tool",
  "operator_input",
  "policy",
  "unknown",
] as const satisfies readonly SalesAgentEvidenceSource[];

export const QUALIFICATION_STATES = [
  "not_started",
  "partial",
  "sufficient",
  "complete",
  "not_applicable",
  "blocked",
] as const satisfies readonly QualificationState[];

export const CUSTOMER_READINESS_LEVELS = [
  "browsing",
  "exploring",
  "evaluating",
  "ready_for_recommendation",
  "ready_for_quote",
  "ready_for_human_close",
  "not_ready",
  "unknown",
] as const satisfies readonly CustomerReadiness[];

export const PRODUCT_FIT_ASSESSMENTS = [
  "strong_fit",
  "possible_fit",
  "weak_fit",
  "no_fit",
  "insufficient_information",
  "not_applicable",
] as const satisfies readonly ProductFitAssessment[];

export const SALES_AGENT_SENSITIVE_CLAIMS = [
  "price",
  "stock",
  "discount",
  "delivery",
  "dispatch",
  "warranty",
  "service_availability",
  "order_status",
  "commercial_condition",
] as const satisfies readonly SalesAgentClaimType[];

export const SALES_AGENT_HARD_BLOCKED_CAPABILITIES = [
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
] as const satisfies readonly SalesAgentHardBlockedCapability[];

export const SALES_AGENT_BLOCKED_ACTIONS = SALES_AGENT_HARD_BLOCKED_CAPABILITIES;