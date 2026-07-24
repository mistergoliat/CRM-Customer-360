import { safeQueryRows } from "@/lib/db";

/**
 * ACS-R1-05.1-T02.3D. Native-path equivalent of the legacy
 * sales-consultative/repository.ts#loadFollowUpActionHistory, scoped the
 * same way (opportunity_id when known, else conversation_case_id - never
 * wa_id/customer as the primary identity) but keyed on the new deterministic
 * followup_sequence_key column (migrations/027) instead of two separate
 * conditional WHERE branches - the key itself already encodes the
 * opportunity-first/case-fallback precedence (buildFollowUpSequenceKey
 * below), so a single equality lookup does the same scoping the legacy
 * two-branch query does.
 */

export type FollowUpAttemptHistoryRow = {
  id: number;
  actionId: string;
  status: string;
  attemptNumber: number;
  maxAttempts: number;
  scheduledFor: string | null;
  createdAt: string | null;
};

export type FollowUpAttemptHistoryResult = {
  ok: boolean;
  warning: string | null;
  sequenceKey: string | null;
  /** A row already in an active status (planned/requires_review/executing) for this sequence - creating a second one is never attempted while this is non-null. */
  activeRow: FollowUpAttemptHistoryRow | null;
  /** Highest attemptNumber among rows that actually consumed a real attempt (executing/executed/failed) - blocked/cancelled/expired rows never advance this. */
  maxConsumedAttemptNumber: number;
  /** The row that produced maxConsumedAttemptNumber - its scheduledFor is attempt (maxConsumedAttemptNumber+1)'s reference point, never "now". */
  lastConsumedRow: FollowUpAttemptHistoryRow | null;
};

/** Active statuses for schedule_followup rows - identical set to the legacy FOLLOW_UP_ACTIVE_ACTION_STATUSES (sales-consultative/followUpPlanAdapter.ts), reused by name here so both never silently diverge. */
export const FOLLOW_UP_ACTIVE_STATUSES = ["planned", "requires_review", "executing"] as const;

/** Same set as legacy FOLLOW_UP_ATTEMPT_CONSUMING_STATUSES - only a row that got (or is getting) a real attempt consumes attempt_number accounting. */
export const FOLLOW_UP_ATTEMPT_CONSUMING_STATUSES = ["executing", "executed", "failed"] as const;

/**
 * opportunity_id first, conversation_case_id fallback, never wa_id/customer.
 * Deterministic and time-independent (unlike the digest-based idempotencyKey,
 * which includes createdAt and therefore differs per turn for the same
 * logical sequence) - this is what buildActionContext persists into
 * crm_agent_actions.followup_sequence_key and what the DB's own
 * active_followup_sequence_key generated column enforces uniqueness on.
 */
export function buildFollowUpSequenceKey(opportunityId: number | string | null, conversationCaseId: number | string | null): string | null {
  if (opportunityId !== null && opportunityId !== undefined && String(opportunityId).trim() !== "") {
    return `followup-opportunity-${opportunityId}`;
  }
  if (conversationCaseId !== null && conversationCaseId !== undefined && String(conversationCaseId).trim() !== "") {
    return `followup-case-${conversationCaseId}`;
  }
  return null;
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function loadFollowUpAttemptHistory(input: {
  opportunityId: number | string | null;
  conversationCaseId: number | string | null;
}): Promise<FollowUpAttemptHistoryResult> {
  const sequenceKey = buildFollowUpSequenceKey(input.opportunityId, input.conversationCaseId);
  if (!sequenceKey) {
    return { ok: true, warning: null, sequenceKey: null, activeRow: null, maxConsumedAttemptNumber: 0, lastConsumedRow: null };
  }

  const result = await safeQueryRows<{
    id: number;
    action_id: string;
    status: string;
    attempt_number: number;
    max_attempts: number;
    scheduled_for: string | null;
    created_at: string | null;
  }>(
    `SELECT id, action_id, status, attempt_number, max_attempts, scheduled_for, created_at
      FROM crm_agent_actions
      WHERE action_type = 'schedule_followup' AND followup_sequence_key = ?
      ORDER BY id DESC LIMIT 50`,
    [sequenceKey]
  );

  if (!result.ok) {
    return { ok: false, warning: result.error, sequenceKey, activeRow: null, maxConsumedAttemptNumber: 0, lastConsumedRow: null };
  }

  const rows: FollowUpAttemptHistoryRow[] = result.rows.map((row) => ({
    id: row.id,
    actionId: row.action_id,
    status: row.status,
    attemptNumber: Number.isFinite(Number(row.attempt_number)) ? Number(row.attempt_number) : 0,
    maxAttempts: Number.isFinite(Number(row.max_attempts)) && Number(row.max_attempts) > 0 ? Number(row.max_attempts) : 1,
    scheduledFor: toIsoOrNull(row.scheduled_for),
    createdAt: toIsoOrNull(row.created_at)
  }));

  const activeRow = rows.find((row) => (FOLLOW_UP_ACTIVE_STATUSES as readonly string[]).includes(row.status)) ?? null;

  let lastConsumedRow: FollowUpAttemptHistoryRow | null = null;
  let maxConsumedAttemptNumber = 0;
  for (const row of rows) {
    if (!(FOLLOW_UP_ATTEMPT_CONSUMING_STATUSES as readonly string[]).includes(row.status)) continue;
    if (row.attemptNumber > maxConsumedAttemptNumber) {
      maxConsumedAttemptNumber = row.attemptNumber;
      lastConsumedRow = row;
    }
  }

  return { ok: true, warning: null, sequenceKey, activeRow, maxConsumedAttemptNumber, lastConsumedRow };
}
