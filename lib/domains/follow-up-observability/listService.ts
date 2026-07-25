import { safeQueryRows } from "@/lib/db";
import { FOLLOW_UP_ACTION_TYPE, FOLLOW_UP_LIST_MAX_LIMIT, type FollowUpCriticalSignal, type FollowUpSummaryRange } from "./constants";
import { buildFollowUpCriticalitySql } from "./criticality";
import { mapFollowUpRow, type FollowUpRawRow } from "./rowMapper";
import type { FollowUpListReadModel } from "./types";

export type FollowUpListFilters = {
  range?: FollowUpSummaryRange;
  status?: string[];
  reason?: string;
  opportunityId?: number;
  conversationCaseId?: number;
  actionId?: string;
  criticality?: FollowUpCriticalSignal;
  page: number;
  limit: number;
};

const RANGE_HOURS: Record<FollowUpSummaryRange, number> = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 };

function toMysqlDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/** `a.`-prefixed - this query joins crm_opportunities, which also has status/updated_at/conversation_case_id/wa_id columns. */
const CRITICALITY_SQL = buildFollowUpCriticalitySql("a.");

export async function listFollowUps(filters: FollowUpListFilters): Promise<FollowUpListReadModel> {
  const limit = Math.max(1, Math.min(filters.limit, FOLLOW_UP_LIST_MAX_LIMIT));
  const page = Math.max(1, filters.page);
  const offset = (page - 1) * limit;

  const where: string[] = [`a.action_type = ?`];
  const params: Array<string | number> = [FOLLOW_UP_ACTION_TYPE];

  if (filters.range) {
    where.push(`a.updated_at >= ?`);
    params.push(toMysqlDateTime(new Date(Date.now() - RANGE_HOURS[filters.range] * 3_600_000)));
  }
  if (filters.status && filters.status.length > 0) {
    where.push(`a.status IN (${filters.status.map(() => "?").join(",")})`);
    params.push(...filters.status);
  }
  if (filters.reason) {
    where.push(`(a.cancel_reason = ? OR a.failure_reason LIKE ?)`);
    params.push(filters.reason, `%${filters.reason}%`);
  }
  if (filters.opportunityId !== undefined) {
    where.push(`a.opportunity_id = ?`);
    params.push(filters.opportunityId);
  }
  if (filters.conversationCaseId !== undefined) {
    where.push(`a.conversation_case_id = ?`);
    params.push(filters.conversationCaseId);
  }
  if (filters.actionId) {
    where.push(`a.action_id = ?`);
    params.push(filters.actionId);
  }
  if (filters.criticality) {
    where.push(CRITICALITY_SQL[filters.criticality]);
  }

  const whereSql = where.join(" AND ");

  const countResult = await safeQueryRows<{ total: number }>(`SELECT COUNT(*) AS total FROM crm_agent_actions a WHERE ${whereSql}`, params);

  const rowsResult = await safeQueryRows<FollowUpRawRow>(
    `
      SELECT
        a.action_id, a.status, a.opportunity_id, o.opportunity_key, a.conversation_case_id, a.wa_id,
        a.attempt_number, a.max_attempts, a.scheduled_for, a.cancel_reason, a.failure_reason,
        a.followup_configuration_source, a.followup_configuration_version, a.updated_at
      FROM crm_agent_actions a
      LEFT JOIN crm_opportunities o ON o.id = a.opportunity_id
      WHERE ${whereSql}
      ORDER BY a.updated_at DESC, a.id DESC
      LIMIT ? OFFSET ?
    `,
    [...params, limit, offset]
  );

  const warnings: string[] = [];
  if (!countResult.ok) {
    console.error("follow_up_observability_list_count_failed", countResult.error);
    warnings.push("list_unavailable");
  }
  if (!rowsResult.ok) {
    console.error("follow_up_observability_list_query_failed", rowsResult.error);
    warnings.push("list_unavailable");
  }

  const nowMs = Date.now();
  const items = rowsResult.ok ? rowsResult.rows.map((row) => mapFollowUpRow(row, nowMs)) : [];
  const total = countResult.ok ? Number(countResult.rows[0]?.total ?? 0) : 0;

  return { items, pagination: { page, limit, total }, warnings };
}
