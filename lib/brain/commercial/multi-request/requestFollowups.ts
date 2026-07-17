import { safeQueryRows } from "@/lib/db";
import { AGENT_ACTIONS_TABLE } from "./deferredActions";

export const REQUEST_FOLLOWUP_ACTION_TYPE = "request_followup";

export type RequestFollowup = {
  actionId: string;
  requestId: string;
  purpose: string;
  status: string;
  scheduledFor: string | null;
  createdAt: string;
};

type DbLikeRow = Record<string, unknown>;

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asDateTimeIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return asText(value);
}

function rowToFollowup(row: DbLikeRow): RequestFollowup {
  let purpose = "";
  const raw = row.draft_payload_json;
  const payload =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : typeof raw === "string" && raw.trim()
        ? (() => {
            try {
              return JSON.parse(raw) as Record<string, unknown>;
            } catch {
              return null;
            }
          })()
        : null;
  if (payload && typeof payload.purpose === "string") purpose = payload.purpose;
  return {
    actionId: asText(row.action_id) ?? "",
    requestId: asText(row.request_id) ?? "",
    purpose,
    status: asText(row.status) ?? "",
    scheduledFor: asDateTimeIso(row.scheduled_for),
    createdAt: asDateTimeIso(row.created_at) ?? ""
  };
}

/**
 * Read-only projection over `crm_agent_actions` for the HUB request view
 * (`requestsView.ts`). ACS-R1-05-T05 removed the write-side of this module
 * (`scheduleRequestFollowup`/`scheduleFollowupFromDefinition`/
 * `runRequestFollowupTick`): it had zero productive callers and duplicated
 * follow-up scheduling/persistence that `sales-consultative` already owns.
 * This query only reads rows that some other path may have left behind under
 * `action_type = 'request_followup'`; nothing in this codebase writes that
 * action type anymore.
 */
export async function listPendingFollowupsForRequest(requestId: string): Promise<RequestFollowup[]> {
  const result = await safeQueryRows<DbLikeRow>(
    `SELECT * FROM \`${AGENT_ACTIONS_TABLE}\`
      WHERE request_id = ? AND action_type = ? AND status = 'scheduled'
      ORDER BY scheduled_for ASC`,
    [requestId, REQUEST_FOLLOWUP_ACTION_TYPE]
  );
  if (!result.ok) return [];
  return result.rows.map((row) => rowToFollowup(row));
}
