import { safeQueryRows } from "@/lib/db";
import { FOLLOW_UP_ACTION_TYPE, type FollowUpSummaryRange } from "./constants";
import { buildFollowUpCriticalitySql } from "./criticality";
import type { FollowUpSummary, FollowUpSummaryReadModel } from "./types";

const RANGE_HOURS: Record<FollowUpSummaryRange, number> = {
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30
};

function toMysqlDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function toCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getFollowUpSummary(range: FollowUpSummaryRange): Promise<FollowUpSummaryReadModel> {
  const boundary = toMysqlDateTime(new Date(Date.now() - RANGE_HOURS[range] * 3_600_000));
  const criticalitySql = buildFollowUpCriticalitySql();

  const result = await safeQueryRows<Record<string, unknown>>(
    `
      SELECT
        SUM(status = 'planned') AS planned,
        SUM(${criticalitySql.planned_overdue}) AS planned_overdue,
        SUM(status = 'executing') AS executing,
        SUM(${criticalitySql.executing_stale}) AS executing_stale,
        SUM(status = 'executed') AS executed,
        SUM(status = 'cancelled') AS cancelled,
        SUM(status = 'failed') AS failed,
        SUM(status = 'blocked') AS blocked,
        SUM(${criticalitySql.requires_review}) AS requires_review,
        SUM(${criticalitySql.missing_schedule}) AS missing_schedule,
        SUM(${criticalitySql.missing_configuration}) AS missing_configuration
      FROM crm_agent_actions
      WHERE action_type = ? AND updated_at >= ?
    `,
    [FOLLOW_UP_ACTION_TYPE, boundary]
  );

  const empty: FollowUpSummary = {
    range,
    planned: 0,
    plannedOverdue: 0,
    executing: 0,
    executingStale: 0,
    executed: 0,
    cancelled: 0,
    failed: 0,
    blocked: 0,
    requiresReview: 0,
    missingSchedule: 0,
    missingConfiguration: 0
  };

  if (!result.ok) {
    console.error("follow_up_observability_summary_query_failed", result.error);
    return { summary: empty, warnings: ["summary_unavailable"] };
  }

  const row = result.rows[0] ?? {};
  return {
    summary: {
      range,
      planned: toCount(row.planned),
      plannedOverdue: toCount(row.planned_overdue),
      executing: toCount(row.executing),
      executingStale: toCount(row.executing_stale),
      executed: toCount(row.executed),
      cancelled: toCount(row.cancelled),
      failed: toCount(row.failed),
      blocked: toCount(row.blocked),
      requiresReview: toCount(row.requires_review),
      missingSchedule: toCount(row.missing_schedule),
      missingConfiguration: toCount(row.missing_configuration)
    },
    warnings: []
  };
}
