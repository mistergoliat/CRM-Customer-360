import { FOLLOW_UP_EXECUTING_STALE_SECONDS, FOLLOW_UP_PLANNED_OVERDUE_MINUTES, type FollowUpCriticalSignal } from "./constants";

/**
 * Pure signal detection (matches production semantics exactly, never a
 * second definition of "stale"/"overdue"):
 *  - planned_overdue compares scheduled_for (application-computed UTC wall
 *    time) against UTC_TIMESTAMP()/Date.now(), the same clock the worker's
 *    own selectDueFollowUps uses for "due".
 *  - executing_stale compares updated_at against the session clock
 *    (CURRENT_TIMESTAMP(3)), the exact clock claimStaleExecutingFollowUp
 *    itself uses (ACS-R1-05-T03.2 fixed a UTC-vs-session-clock bug here -
 *    never regress that by using UTC_TIMESTAMP() for this one).
 */

export function isPlannedOverdue(status: string, scheduledFor: string | null, nowMs: number): boolean {
  if (status !== "planned" || !scheduledFor) return false;
  const scheduledMs = new Date(scheduledFor).getTime();
  if (Number.isNaN(scheduledMs)) return false;
  return scheduledMs < nowMs - FOLLOW_UP_PLANNED_OVERDUE_MINUTES * 60_000;
}

export function isExecutingStale(status: string, updatedAt: string | null, nowMs: number): boolean {
  if (status !== "executing" || !updatedAt) return false;
  const updatedMs = new Date(updatedAt).getTime();
  if (Number.isNaN(updatedMs)) return false;
  return updatedMs < nowMs - FOLLOW_UP_EXECUTING_STALE_SECONDS * 1000;
}

export function isMissingSchedule(status: string, scheduledFor: string | null): boolean {
  return status === "planned" && !scheduledFor;
}

export function isMissingConfiguration(followupConfigurationSource: string | null | undefined): boolean {
  return followupConfigurationSource === null || followupConfigurationSource === undefined;
}

export function isRequiresReview(status: string): boolean {
  return status === "requires_review";
}

export type FollowUpCriticalityInput = {
  status: string;
  scheduledFor: string | null;
  updatedAt: string | null;
  followupConfigurationSource: string | null | undefined;
};

export function computeCriticalSignals(input: FollowUpCriticalityInput, nowMs: number = Date.now()): FollowUpCriticalSignal[] {
  const signals: FollowUpCriticalSignal[] = [];
  if (isPlannedOverdue(input.status, input.scheduledFor, nowMs)) signals.push("planned_overdue");
  if (isExecutingStale(input.status, input.updatedAt, nowMs)) signals.push("executing_stale");
  if (isMissingSchedule(input.status, input.scheduledFor)) signals.push("missing_schedule");
  if (isMissingConfiguration(input.followupConfigurationSource)) signals.push("missing_configuration");
  if (isRequiresReview(input.status)) signals.push("requires_review");
  return signals;
}

/**
 * Single source of truth for the SQL text behind each signal - reused
 * verbatim by both listService (WHERE filter, needs the `a.` alias because
 * it joins crm_opportunities, which also has status/updated_at/wa_id
 * columns) and summaryService (SUM aggregate, no join, no alias needed) - so
 * the SQL and the pure JS functions above can never disagree with each
 * other, and the two services can never drift from one another. `prefix` is
 * a fixed internal literal (never user input) prepended to each bare column
 * name.
 */
export function buildFollowUpCriticalitySql(prefix: string = ""): Record<FollowUpCriticalSignal, string> {
  const col = (name: string) => `${prefix}${name}`;
  return {
    planned_overdue: `(${col("status")} = 'planned' AND ${col("scheduled_for")} < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${FOLLOW_UP_PLANNED_OVERDUE_MINUTES} MINUTE))`,
    executing_stale: `(${col("status")} = 'executing' AND ${col("updated_at")} < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ${FOLLOW_UP_EXECUTING_STALE_SECONDS} SECOND))`,
    missing_schedule: `(${col("status")} = 'planned' AND ${col("scheduled_for")} IS NULL)`,
    missing_configuration: `(${col("followup_configuration_source")} IS NULL)`,
    requires_review: `(${col("status")} = 'requires_review')`
  };
}
