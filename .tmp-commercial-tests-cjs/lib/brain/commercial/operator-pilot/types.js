"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_SDR_OPERATOR_PILOT_COMMAND_OUTCOMES = exports.AI_SDR_OPERATOR_PILOT_COMMAND_TYPES = exports.AI_SDR_OPERATOR_PILOT_STATUSES = void 0;
exports.AI_SDR_OPERATOR_PILOT_STATUSES = [
    "available",
    "not_found",
    "disabled",
    "waiting_for_operational_loop",
    "error"
];
exports.AI_SDR_OPERATOR_PILOT_COMMAND_TYPES = [
    "approve_ai_draft",
    "reject_ai_draft",
    "edit_ai_draft",
    "take_over_case",
    "request_more_context",
    "mark_not_useful"
];
exports.AI_SDR_OPERATOR_PILOT_COMMAND_OUTCOMES = ["blocked_by_flag", "not_persisted", "not_executed"];
