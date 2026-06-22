"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BRAIN_INBOUND_OUTBOX_PLAN_STATUSES = exports.BRAIN_INSTRUCTION_KINDS = exports.BRAIN_INSTRUCTION_TARGETS = exports.BRAIN_INSTRUCTION_STATUSES = exports.BRAIN_ERROR_CODES = exports.DEFAULT_BRAIN_PROCESS_INBOUND_OPTIONS = exports.BRAIN_SOURCES = exports.BRAIN_CONTEXT_MODES = exports.BRAIN_CHANNELS = void 0;
exports.BRAIN_CHANNELS = ["whatsapp"];
exports.BRAIN_CONTEXT_MODES = ["minimal", "standard", "recovery"];
exports.BRAIN_SOURCES = ["n8n_meta_webhook", "hub_preview", "manual_test", "system_job"];
exports.DEFAULT_BRAIN_PROCESS_INBOUND_OPTIONS = {
    dryRun: true,
    executeActions: false,
    returnInstructionsForN8n: true,
    debug: false,
    runAgentDryRun: false,
    buildExecutionPlanDryRun: false,
    preferredAgent: undefined
};
exports.BRAIN_ERROR_CODES = [
    "INVALID_INPUT",
    "CONTEXT_UNAVAILABLE",
    "ADAPTER_SKIPPED",
    "ACTION_BLOCKED",
    "UNHANDLED_ERROR"
];
exports.BRAIN_INSTRUCTION_STATUSES = ["planned", "blocked", "noop"];
exports.BRAIN_INSTRUCTION_TARGETS = ["n8n", "backend", "none"];
exports.BRAIN_INSTRUCTION_KINDS = [
    "continue_legacy_flow",
    "record_observation",
    "shadow_ai_orchestrator_call",
    "noop"
];
exports.BRAIN_INBOUND_OUTBOX_PLAN_STATUSES = [
    "skipped_by_flag",
    "skipped_by_policy",
    "planned",
    "existing",
    "warning"
];
