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
