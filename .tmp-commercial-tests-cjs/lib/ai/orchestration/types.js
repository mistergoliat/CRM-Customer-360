"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_AI_ORCHESTRATION_FEATURE_FLAGS = exports.DEFAULT_AI_ORCHESTRATION_LIMITS = exports.AI_ERROR_CODES = exports.AI_ACTION_STATUSES = exports.AI_ACTION_TYPES = exports.AI_NEXT_ACTIONS = exports.AI_FINAL_ACTIONS = exports.AI_CUSTOMER_SIGNALS = exports.AI_COMMERCIAL_STATUSES = exports.AI_DEPARTMENTS = exports.AI_INTENTS = exports.AI_SOURCES = exports.AI_CONTEXT_MODES = void 0;
exports.AI_CONTEXT_MODES = ["minimal", "standard", "recovery"];
exports.AI_SOURCES = ["n8n_meta_webhook", "hub_preview", "manual_test", "system_job"];
exports.AI_INTENTS = [
    "sales",
    "postventa",
    "sac",
    "knowledge",
    "followup",
    "close_request",
    "consulta_general",
    "unknown"
];
exports.AI_DEPARTMENTS = ["Ventas", "Postventa", "SAC", "Knowledge", "Operaciones", "Unknown"];
exports.AI_COMMERCIAL_STATUSES = [
    "new_lead",
    "quote_requested",
    "quote_sent",
    "purchase_intent",
    "post_sale",
    "followup_needed",
    "not_applicable",
    "unknown"
];
exports.AI_CUSTOMER_SIGNALS = [
    "asks_price",
    "asks_stock",
    "asks_shipping",
    "asks_human",
    "complaint",
    "post_sale_help",
    "decline",
    "continue",
    "no_signal",
    "unknown"
];
exports.AI_FINAL_ACTIONS = [
    "reply",
    "handoff_to_human",
    "human_required",
    "no_action",
    "close_case",
    "followup_needed"
];
exports.AI_NEXT_ACTIONS = [
    "send_reply",
    "assign_human",
    "mark_human_required",
    "close_case",
    "schedule_followup",
    "noop"
];
exports.AI_ACTION_TYPES = [
    "send_whatsapp_reply",
    "create_case",
    "update_case",
    "assign_human",
    "close_case",
    "schedule_followup",
    "noop"
];
exports.AI_ACTION_STATUSES = ["planned", "blocked"];
exports.AI_ERROR_CODES = [
    "INVALID_INPUT",
    "INVALID_OUTPUT",
    "TIMEOUT",
    "CONTEXT_EXCEEDED",
    "LOW_CONFIDENCE",
    "FEATURE_DISABLED",
    "MODEL_UNAVAILABLE",
    "UNHANDLED_ERROR"
];
exports.DEFAULT_AI_ORCHESTRATION_LIMITS = {
    maxHistoryMessages: 12,
    maxContextChars: 24000,
    maxOutputTokens: 900,
    timeoutMs: 12000
};
exports.DEFAULT_AI_ORCHESTRATION_FEATURE_FLAGS = {
    allowAutoReply: false,
    allowCaseMutation: false,
    allowHumanHandoff: true,
    allowCaseClose: false,
    allowFollowup: false,
    shadowLog: false,
    dryRun: true
};
