export const COMMERCIAL_CONTEXT_VERSION = "brain.commercial.context.v1" as const;
export const COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES = 12;
export const COMMERCIAL_CONTEXT_STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

export const COMMERCIAL_CONTEXT_WARNINGS = [
  "missing_latest_customer_message",
  "missing_customer_reference",
  "missing_conversation_history",
  "missing_channel",
  "missing_commercial_entity",
  "stale_context",
  "identity_conflict",
  "ai_blocked",
  "human_owner_active",
  "unsupported_context_shape",
  "sanitization_applied"
] as const;

export type CommercialContextWarning = (typeof COMMERCIAL_CONTEXT_WARNINGS)[number];

export const COMMERCIAL_CONTEXT_COMPLETENESS = ["complete", "partial", "minimal", "insufficient"] as const;
export type CommercialContextCompleteness = (typeof COMMERCIAL_CONTEXT_COMPLETENESS)[number];

export const COMMERCIAL_CONTEXT_RESULT_STATUSES = ["success", "insufficient_context", "invalid_input"] as const;
export type CommercialContextBuilderStatus = (typeof COMMERCIAL_CONTEXT_RESULT_STATUSES)[number];

