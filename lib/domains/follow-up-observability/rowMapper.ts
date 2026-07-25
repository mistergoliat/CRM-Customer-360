import { computeCriticalSignals } from "./criticality";
import { maskWaId } from "./maskWaId";
import { buildFollowUpReason, labelForFollowUpStatus } from "./reasonLabels";
import type { FollowUpListItem } from "./types";

/**
 * Raw shape selected by listService/detailService - deliberately never
 * includes policy_notes_json (the domain never selects that column at all,
 * so there is nothing to accidentally leak downstream).
 */
export type FollowUpRawRow = {
  action_id: string;
  status: string;
  opportunity_id: number | null;
  opportunity_key?: string | null;
  conversation_case_id: number | null;
  wa_id: string | null;
  attempt_number: number;
  max_attempts: number;
  scheduled_for: string | null;
  cancel_reason: string | null;
  failure_reason: string | null;
  followup_configuration_source: string | null;
  followup_configuration_version: number | null;
  updated_at: string | null;
};

function asIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value).includes("T") ? String(value) : `${String(value).replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asNullableInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

export function shortActionId(actionId: string): string {
  if (actionId.length <= 12) return actionId;
  return `…${actionId.slice(-8)}`;
}

export function mapFollowUpRow(row: FollowUpRawRow, nowMs: number = Date.now()): FollowUpListItem {
  const scheduledFor = asIso(row.scheduled_for);
  const updatedAt = asIso(row.updated_at);

  return {
    actionId: row.action_id,
    actionIdShort: shortActionId(row.action_id),
    status: row.status,
    statusLabel: labelForFollowUpStatus(row.status),
    criticalSignals: computeCriticalSignals(
      {
        status: row.status,
        scheduledFor,
        updatedAt,
        followupConfigurationSource: row.followup_configuration_source
      },
      nowMs
    ),
    opportunityId: asNullableInt(row.opportunity_id),
    opportunityKey: row.opportunity_key ?? null,
    conversationCaseId: asNullableInt(row.conversation_case_id),
    waIdMasked: maskWaId(row.wa_id),
    attemptNumber: asNullableInt(row.attempt_number) ?? 0,
    maxAttempts: asNullableInt(row.max_attempts) ?? 1,
    scheduledFor,
    reason: buildFollowUpReason(row.cancel_reason, row.failure_reason),
    configuration: {
      source: row.followup_configuration_source,
      version: asNullableInt(row.followup_configuration_version)
    },
    updatedAt
  };
}
