"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SALES_AGENT_RUNTIME_VALIDATION_STATUSES = exports.BRAIN_SALES_AGENT_DRY_RUN = exports.BRAIN_SALES_AGENT_ENABLED = exports.SALES_AGENT_CONTRACT_VERSION = exports.SALES_AGENT_RUNTIME_VERSION = exports.SALES_AGENT_PROMPT_VERSION = exports.SALES_AGENT_RUNTIME_DEFAULT_DRY_RUN = exports.SALES_AGENT_RUNTIME_DEFAULT_ENABLED = exports.SALES_AGENT_RUNTIME_DEFAULT_MODE = exports.SALES_AGENT_RUNTIME_MAX_OUTPUT_CHARACTERS = exports.SALES_AGENT_RUNTIME_MAX_INPUT_CHARACTERS = exports.SALES_AGENT_RUNTIME_DEFAULT_TIMEOUT_MS = exports.SALES_AGENT_RUNTIME_WARNINGS = exports.SALES_AGENT_RUNTIME_ERROR_CODES = exports.SALES_AGENT_RUNTIME_MODES = exports.SALES_AGENT_RUNTIME_STATUSES = void 0;
const validationTypes_1 = require("./validationTypes");
exports.SALES_AGENT_RUNTIME_STATUSES = [
    "completed_valid",
    "completed_failed_safe",
    "provider_unavailable",
    "provider_error",
    "timeout",
    "validation_failed_safe",
    "cancelled",
    "invalid_input",
    "disabled"
];
exports.SALES_AGENT_RUNTIME_MODES = ["dry_run", "fixture", "shadow"];
exports.SALES_AGENT_RUNTIME_ERROR_CODES = [
    "invalid_input",
    "disabled",
    "provider_unavailable",
    "authentication_error",
    "rate_limit",
    "timeout",
    "invalid_response",
    "network_error",
    "provider_error",
    "cancelled",
    "contract_version_mismatch",
    "prompt_build_failed",
    "validation_failed_safe",
    "input_too_large",
    "output_too_large",
    "unknown_error"
];
exports.SALES_AGENT_RUNTIME_WARNINGS = [
    "runtime_disabled",
    "provider_not_called",
    "provider_unavailable",
    "provider_error",
    "provider_timeout",
    "provider_cancelled",
    "provider_invalid_response",
    "validation_failed_safe",
    "invalid_input",
    "contract_version_mismatch",
    "prompt_build_failed",
    "input_too_large",
    "output_too_large",
    "raw_output_captured",
    "raw_output_sanitized",
    "prompt_preview_included",
    "metadata_sanitized",
    "unknown_error"
];
exports.SALES_AGENT_RUNTIME_DEFAULT_TIMEOUT_MS = 15000;
exports.SALES_AGENT_RUNTIME_MAX_INPUT_CHARACTERS = 20000;
exports.SALES_AGENT_RUNTIME_MAX_OUTPUT_CHARACTERS = 12000;
exports.SALES_AGENT_RUNTIME_DEFAULT_MODE = "dry_run";
exports.SALES_AGENT_RUNTIME_DEFAULT_ENABLED = false;
exports.SALES_AGENT_RUNTIME_DEFAULT_DRY_RUN = true;
exports.SALES_AGENT_PROMPT_VERSION = "sales-agent-runtime-v0.1.0";
exports.SALES_AGENT_RUNTIME_VERSION = "sales-agent-runtime-dry-run-v0.1.0";
exports.SALES_AGENT_CONTRACT_VERSION = validationTypes_1.SALES_AGENT_OUTPUT_CONTRACT_VERSION;
exports.BRAIN_SALES_AGENT_ENABLED = "BRAIN_SALES_AGENT_ENABLED";
exports.BRAIN_SALES_AGENT_DRY_RUN = "BRAIN_SALES_AGENT_DRY_RUN";
exports.SALES_AGENT_RUNTIME_VALIDATION_STATUSES = [
    "skipped",
    "valid",
    "invalid",
    "failed_safe"
];
