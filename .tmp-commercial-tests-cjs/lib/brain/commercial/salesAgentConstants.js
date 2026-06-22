"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SALES_AGENT_ALLOWED_OPPORTUNITY_PROPOSED_CHANGE_KEYS = exports.SALES_AGENT_ALLOWED_LEAD_PROPOSED_CHANGE_KEYS = exports.SALES_AGENT_ERROR_CODES = exports.PRODUCT_FIT_ASSESSMENTS = exports.CUSTOMER_READINESS_LEVELS = exports.QUALIFICATION_STATES = exports.SALES_AGENT_EVIDENCE_SOURCES = exports.SALES_AGENT_SENSITIVE_CLAIMS = exports.SALES_AGENT_CLAIM_TYPES = exports.SALES_AGENT_MESSAGE_INTENTS = exports.SALES_AGENT_TOOL_REQUEST_STATUSES = exports.SALES_AGENT_TOOL_NAMES = exports.SALES_AGENT_BLOCKED_ACTIONS = exports.SALES_AGENT_ACTION_TYPES = exports.SALES_AGENT_DECISION_TYPES = exports.SALES_AGENT_OUTCOMES = exports.SALES_AGENT_APPROVAL_REQUIREMENTS = exports.SALES_AGENT_RISK_LEVELS = exports.SALES_AGENT_CONFIDENCE_LEVELS = exports.SALES_AGENT_OUTPUT_VERSION = exports.SALES_AGENT_INPUT_VERSION = exports.SALES_AGENT_STRUCTURAL_SIGNALS = exports.SALES_AGENT_REQUESTED_MODES = void 0;
const types_1 = require("../tools/types");
exports.SALES_AGENT_REQUESTED_MODES = ["minimal", "standard", "recovery"];
exports.SALES_AGENT_STRUCTURAL_SIGNALS = [
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
];
exports.SALES_AGENT_INPUT_VERSION = "brain.sales-agent.input.v1";
exports.SALES_AGENT_OUTPUT_VERSION = "brain.sales-agent.output.v1";
exports.SALES_AGENT_CONFIDENCE_LEVELS = ["low", "medium", "high"];
exports.SALES_AGENT_RISK_LEVELS = ["low", "medium", "high", "blocked"];
exports.SALES_AGENT_APPROVAL_REQUIREMENTS = ["none", "review", "operator_review", "handoff", "blocked"];
exports.SALES_AGENT_OUTCOMES = [
    "response_proposed",
    "tool_required",
    "waiting_for_customer",
    "blocked_by_policy",
    "no_commercial_action",
    "insufficient_context",
    "failed_safe"
];
exports.SALES_AGENT_DECISION_TYPES = [
    "respond_now",
    "request_tool",
    "request_human",
    "wait_for_customer",
    "blocked_by_policy",
    "no_commercial_action",
    "insufficient_context",
    "failed_safe"
];
exports.SALES_AGENT_ACTION_TYPES = [
    "send_whatsapp_message",
    "draft_response",
    "request_tool",
    "request_human_review",
    "follow_up",
    "no_action",
    "create_lead",
    "create_opportunity",
    "mutate_case"
];
exports.SALES_AGENT_BLOCKED_ACTIONS = ["create_lead", "create_opportunity", "mutate_case"];
exports.SALES_AGENT_TOOL_NAMES = types_1.BRAIN_TOOL_NAMES;
exports.SALES_AGENT_TOOL_REQUEST_STATUSES = ["planned", "blocked", "noop"];
exports.SALES_AGENT_MESSAGE_INTENTS = [
    "answer",
    "clarify",
    "quote",
    "handoff",
    "follow_up",
    "confirm",
    "reject",
    "no_response",
    "blocked"
];
exports.SALES_AGENT_CLAIM_TYPES = [
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
];
exports.SALES_AGENT_SENSITIVE_CLAIMS = [
    "price",
    "stock",
    "delivery",
    "dispatch",
    "order_status",
    "service_availability",
    "promotion"
];
exports.SALES_AGENT_EVIDENCE_SOURCES = [
    "customer_message",
    "customer_candidate",
    "conversation_history",
    "order_context",
    "product_service_context",
    "policy_context",
    "tool_result",
    "operator_input",
    "legacy_field"
];
exports.QUALIFICATION_STATES = ["unknown", "unqualified", "qualified", "disqualified", "pending"];
exports.CUSTOMER_READINESS_LEVELS = ["unknown", "not_ready", "developing", "ready", "blocked"];
exports.PRODUCT_FIT_ASSESSMENTS = ["unknown", "poor", "partial", "good", "strong"];
exports.SALES_AGENT_ERROR_CODES = [
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
];
exports.SALES_AGENT_ALLOWED_LEAD_PROPOSED_CHANGE_KEYS = [
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
];
exports.SALES_AGENT_ALLOWED_OPPORTUNITY_PROPOSED_CHANGE_KEYS = [
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
];
