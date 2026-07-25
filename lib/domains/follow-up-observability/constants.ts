import { FOLLOW_UP_STALE_EXECUTING_LOCK_SECONDS } from "@/lib/brain/commercial/followup/followUpWorkerPolicy";

/**
 * Read-only observability domain for schedule_followup rows
 * (ACS-R1-05.1-T02.4). crm_agent_actions stays the single source of truth -
 * nothing here persists derived state.
 */
export const FOLLOW_UP_ACTION_TYPE = "schedule_followup";

/** Decision 4 (approved audit): planned overdue threshold, UI-only concept - the worker itself has no upper bound on how overdue a 'planned' row can be. */
export const FOLLOW_UP_PLANNED_OVERDUE_MINUTES = 15;

/** Decision 5 (approved audit): reuse the exact production constant, never a second copy of "300". */
export const FOLLOW_UP_EXECUTING_STALE_SECONDS = FOLLOW_UP_STALE_EXECUTING_LOCK_SECONDS;

export const FOLLOW_UP_LIST_DEFAULT_LIMIT = 25;
export const FOLLOW_UP_LIST_MAX_LIMIT = 100;

export const FOLLOW_UP_SUMMARY_RANGES = ["24h", "7d", "30d"] as const;
export type FollowUpSummaryRange = (typeof FOLLOW_UP_SUMMARY_RANGES)[number];

export const FOLLOW_UP_STATUS_VALUES = [
  "planned",
  "executing",
  "failed",
  "cancelled",
  "executed",
  "blocked",
  "requires_review",
  "expired"
] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUS_VALUES)[number];

export const FOLLOW_UP_CRITICALITY_VALUES = [
  "planned_overdue",
  "executing_stale",
  "missing_schedule",
  "missing_configuration",
  "requires_review"
] as const;
export type FollowUpCriticalSignal = (typeof FOLLOW_UP_CRITICALITY_VALUES)[number];

/** Decision 2 (approved audit): the accepted gap - never inject a fabricated timeline. */
export const FOLLOW_UP_TECHNICAL_HISTORY_UNAVAILABLE_MESSAGE = "Historial técnico detallado no disponible";
