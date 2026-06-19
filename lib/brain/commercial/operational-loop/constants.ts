export const COMMERCIAL_OPERATIONAL_LOOP_VERSION = "brain.commercial.operational-loop.v1" as const;

export const COMMERCIAL_OPERATIONAL_LOOP_STATUSES = [
  "completed",
  "skipped",
  "blocked",
  "failed_safe",
  "persistence_failed"
] as const;
export type CommercialOperationalLoopStatus = (typeof COMMERCIAL_OPERATIONAL_LOOP_STATUSES)[number];

export const COMMERCIAL_OPERATIONAL_LOOP_MODES = ["shadow", "fixture", "dry_run"] as const;
export type CommercialOperationalLoopMode = (typeof COMMERCIAL_OPERATIONAL_LOOP_MODES)[number];

export const COMMERCIAL_OPERATIONAL_LOOP_NEXT_ACTION_TYPES = [
  "respond",
  "ask_clarifying_question",
  "qualify",
  "recommend_products",
  "prepare_quote",
  "wait_for_customer",
  "propose_followup",
  "escalate_to_operator",
  "pause",
  "close_as_lost_candidate",
  "no_action"
] as const;
export type CommercialOperationalLoopNextActionType = (typeof COMMERCIAL_OPERATIONAL_LOOP_NEXT_ACTION_TYPES)[number];

export const COMMERCIAL_OPERATIONAL_LOOP_SKIP_REASONS = [
  "skipped_by_flag",
  "not_eligible",
  "no_commercial_signal",
  "no_shadow_result",
  "missing_commercial_context",
  "unsupported_context_shape",
  "duplicate_invocation",
  "terminal_state"
] as const;
export type CommercialOperationalLoopSkipReason = (typeof COMMERCIAL_OPERATIONAL_LOOP_SKIP_REASONS)[number];

export const COMMERCIAL_OPERATIONAL_LOOP_STAGE_NAMES = [
  "eligibility",
  "load_state",
  "identity_resolution",
  "state_reduction",
  "next_action_selection",
  "transition_validation",
  "persistence",
  "decision_record",
  "loop_complete"
] as const;
export type CommercialOperationalLoopStageName = (typeof COMMERCIAL_OPERATIONAL_LOOP_STAGE_NAMES)[number];

export const COMMERCIAL_OPERATIONAL_LOOP_STAGE_STATUSES = [
  "completed",
  "skipped",
  "blocked",
  "failed_safe",
  "persistence_failed",
  "timeout",
  "cancelled"
] as const;
export type CommercialOperationalLoopStageStatus = (typeof COMMERCIAL_OPERATIONAL_LOOP_STAGE_STATUSES)[number];

export const COMMERCIAL_OPERATIONAL_LOOP_WARNING_VALUES = [
  "commercial_loop_disabled",
  "commercial_loop_skipped",
  "commercial_loop_cancelled",
  "commercial_shadow_unavailable",
  "commercial_context_missing",
  "commercial_state_missing",
  "commercial_state_ambiguous",
  "commercial_state_terminal",
  "commercial_state_policy_blocked",
  "commercial_state_human_owner_active",
  "commercial_state_ai_blocked",
  "commercial_state_conflict",
  "commercial_state_persistence_disabled",
  "commercial_state_persistence_failed",
  "commercial_state_retry_reused",
  "commercial_state_sanitized",
  "commercial_state_no_action",
  "commercial_state_transition_blocked",
  "commercial_state_timeout",
  "commercial_state_cancelled",
  "commercial_state_failed_safe",
  "commercial_state_duplicate_decision",
  "commercial_state_persistence_skipped",
  "commercial_state_persistence_completed"
] as const;
export type CommercialOperationalLoopWarning = (typeof COMMERCIAL_OPERATIONAL_LOOP_WARNING_VALUES)[number];

export const COMMERCIAL_OPERATIONAL_LOOP_DEFAULT_TIMEOUT_MS = 4000;
export const COMMERCIAL_OPERATIONAL_LOOP_DEFAULT_MODE = "dry_run" as const;
export const COMMERCIAL_OPERATIONAL_LOOP_DEFAULT_ENABLED = false;
export const COMMERCIAL_OPERATIONAL_LOOP_DEFAULT_PERSISTENCE_ENABLED = false;

export const BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED = "BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED" as const;
export const BRAIN_COMMERCIAL_STATE_PERSISTENCE_ENABLED = "BRAIN_COMMERCIAL_STATE_PERSISTENCE_ENABLED" as const;
