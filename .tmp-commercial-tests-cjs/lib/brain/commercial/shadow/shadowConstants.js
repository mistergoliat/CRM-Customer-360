"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMMERCIAL_SHADOW_DEFAULT_FEATURE_FLAGS = exports.COMMERCIAL_SHADOW_POLICY_TIMEOUT_MS = exports.COMMERCIAL_SHADOW_RUNTIME_TIMEOUT_MS = exports.COMMERCIAL_SHADOW_CONTEXT_TIMEOUT_MS = exports.COMMERCIAL_SHADOW_DEFAULT_TIMEOUT_MS = exports.COMMERCIAL_SHADOW_WARNING_VALUES = exports.COMMERCIAL_SHADOW_EXECUTION_DISPOSITIONS = exports.COMMERCIAL_SHADOW_FAILURE_STAGES = exports.COMMERCIAL_SHADOW_MODES = exports.COMMERCIAL_SHADOW_STATUSES = exports.COMMERCIAL_SHADOW_VERSION = void 0;
exports.COMMERCIAL_SHADOW_VERSION = "brain.commercial.shadow.v1";
exports.COMMERCIAL_SHADOW_STATUSES = [
    "disabled",
    "skipped",
    "completed",
    "completed_with_restrictions",
    "failed_safe",
    "context_failed",
    "runtime_failed",
    "policy_failed",
    "timeout",
    "cancelled"
];
exports.COMMERCIAL_SHADOW_MODES = ["shadow", "fixture", "dry_run"];
exports.COMMERCIAL_SHADOW_FAILURE_STAGES = [
    "eligibility",
    "context_builder",
    "sales_agent_runtime",
    "output_validation",
    "commercial_policy",
    "shadow_complete"
];
exports.COMMERCIAL_SHADOW_EXECUTION_DISPOSITIONS = [
    "observe_only",
    "discard_after_observation",
    "not_executed"
];
exports.COMMERCIAL_SHADOW_WARNING_VALUES = [
    "shadow_disabled",
    "shadow_skipped",
    "shadow_runtime_disabled",
    "shadow_policy_disabled",
    "shadow_timeout",
    "shadow_cancelled",
    "shadow_latency_budget_exceeded",
    "shadow_provider_unavailable",
    "shadow_provider_error",
    "shadow_context_failed",
    "shadow_runtime_failed",
    "shadow_policy_failed",
    "shadow_invalid_input",
    "shadow_result_sanitized",
    "shadow_prompt_sanitized",
    "shadow_raw_output_sanitized",
    "shadow_real_provider_blocked",
    "shadow_capture_result_disabled",
    "shadow_capture_metrics_disabled"
];
exports.COMMERCIAL_SHADOW_DEFAULT_TIMEOUT_MS = 5000;
exports.COMMERCIAL_SHADOW_CONTEXT_TIMEOUT_MS = 1500;
exports.COMMERCIAL_SHADOW_RUNTIME_TIMEOUT_MS = 3000;
exports.COMMERCIAL_SHADOW_POLICY_TIMEOUT_MS = 1000;
exports.COMMERCIAL_SHADOW_DEFAULT_FEATURE_FLAGS = {
    commercialShadowEnabled: false,
    commercialRuntimeEnabled: false,
    commercialPolicyEnabled: false,
    commercialShadowCaptureMetrics: true,
    commercialShadowCaptureResult: true,
    commercialShadowCaptureWarnings: true,
    commercialShadowIncludePromptPreview: false,
    commercialShadowIncludeRawOutputPreview: false,
    commercialShadowFailOpenForInbound: true,
    commercialShadowAllowRealProvider: false
};
