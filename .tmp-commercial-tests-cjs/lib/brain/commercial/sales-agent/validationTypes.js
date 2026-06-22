"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SALES_AGENT_TOOL_NAMES = exports.SALES_AGENT_REQUESTED_MODES = exports.SALES_AGENT_ALLOWED_OPPORTUNITY_PROPOSED_CHANGE_KEYS = exports.SALES_AGENT_ALLOWED_LEAD_PROPOSED_CHANGE_KEYS = exports.SALES_AGENT_BLOCKED_ACTIONS = exports.SALES_AGENT_OUTPUT_CONTRACT_VERSION = exports.SALES_AGENT_OUTPUT_VALIDATION_FATAL_CODES = exports.SALES_AGENT_OUTPUT_MAX_METADATA_BYTES = exports.SALES_AGENT_OUTPUT_MAX_QUESTIONS = exports.SALES_AGENT_OUTPUT_MAX_REASON_CODES = exports.SALES_AGENT_OUTPUT_MAX_WARNINGS = exports.SALES_AGENT_OUTPUT_MAX_EVIDENCE = exports.SALES_AGENT_OUTPUT_MAX_CLAIMS = exports.SALES_AGENT_OUTPUT_MAX_ENTITY_PROPOSALS = exports.SALES_AGENT_OUTPUT_MAX_TOOL_REQUESTS = exports.SALES_AGENT_OUTPUT_MAX_ACTIONS = exports.SALES_AGENT_OUTPUT_MAX_OBJECT_DEPTH = exports.SALES_AGENT_OUTPUT_MAX_ARRAY_LENGTH = exports.SALES_AGENT_OUTPUT_MAX_DRAFT_LENGTH = exports.SALES_AGENT_OUTPUT_MAX_STRING_LENGTH = exports.SALES_AGENT_OUTPUT_VALIDATION_ISSUE_CODES = exports.SALES_AGENT_OUTPUT_VALIDATION_ISSUE_LEVELS = exports.SALES_AGENT_OUTPUT_VALIDATION_STATUSES = void 0;
const salesAgentConstants_1 = require("../salesAgentConstants");
Object.defineProperty(exports, "SALES_AGENT_ALLOWED_LEAD_PROPOSED_CHANGE_KEYS", { enumerable: true, get: function () { return salesAgentConstants_1.SALES_AGENT_ALLOWED_LEAD_PROPOSED_CHANGE_KEYS; } });
Object.defineProperty(exports, "SALES_AGENT_ALLOWED_OPPORTUNITY_PROPOSED_CHANGE_KEYS", { enumerable: true, get: function () { return salesAgentConstants_1.SALES_AGENT_ALLOWED_OPPORTUNITY_PROPOSED_CHANGE_KEYS; } });
Object.defineProperty(exports, "SALES_AGENT_BLOCKED_ACTIONS", { enumerable: true, get: function () { return salesAgentConstants_1.SALES_AGENT_BLOCKED_ACTIONS; } });
Object.defineProperty(exports, "SALES_AGENT_REQUESTED_MODES", { enumerable: true, get: function () { return salesAgentConstants_1.SALES_AGENT_REQUESTED_MODES; } });
Object.defineProperty(exports, "SALES_AGENT_TOOL_NAMES", { enumerable: true, get: function () { return salesAgentConstants_1.SALES_AGENT_TOOL_NAMES; } });
exports.SALES_AGENT_OUTPUT_VALIDATION_STATUSES = ["valid", "invalid", "failed_safe"];
exports.SALES_AGENT_OUTPUT_VALIDATION_ISSUE_LEVELS = ["info", "warning", "error", "fatal"];
exports.SALES_AGENT_OUTPUT_VALIDATION_ISSUE_CODES = [
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
];
exports.SALES_AGENT_OUTPUT_MAX_STRING_LENGTH = 4000;
exports.SALES_AGENT_OUTPUT_MAX_DRAFT_LENGTH = 2000;
exports.SALES_AGENT_OUTPUT_MAX_ARRAY_LENGTH = 20;
exports.SALES_AGENT_OUTPUT_MAX_OBJECT_DEPTH = 6;
exports.SALES_AGENT_OUTPUT_MAX_ACTIONS = 8;
exports.SALES_AGENT_OUTPUT_MAX_TOOL_REQUESTS = 8;
exports.SALES_AGENT_OUTPUT_MAX_ENTITY_PROPOSALS = 4;
exports.SALES_AGENT_OUTPUT_MAX_CLAIMS = 12;
exports.SALES_AGENT_OUTPUT_MAX_EVIDENCE = 12;
exports.SALES_AGENT_OUTPUT_MAX_WARNINGS = 20;
exports.SALES_AGENT_OUTPUT_MAX_REASON_CODES = 20;
exports.SALES_AGENT_OUTPUT_MAX_QUESTIONS = 8;
exports.SALES_AGENT_OUTPUT_MAX_METADATA_BYTES = 8192;
exports.SALES_AGENT_OUTPUT_VALIDATION_FATAL_CODES = [
    "invalid_root",
    "missing_required_field",
    "forbidden_key",
    "sensitive_claim_without_evidence",
    "hard_blocked_action",
    "contradictory_decision",
    "run_id_mismatch",
    "unsupported_contract_version",
    "contract_incomplete"
];
exports.SALES_AGENT_OUTPUT_CONTRACT_VERSION = salesAgentConstants_1.SALES_AGENT_OUTPUT_VERSION;
