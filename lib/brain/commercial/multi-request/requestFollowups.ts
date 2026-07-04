import { createHash, randomUUID } from "node:crypto";
import { safeExecute, safeQueryRows } from "@/lib/db";
import { appendRequestEvent, listRequestMessageLinks, loadConversationRequest } from "../conversation-request";
import type { ConversationRequest } from "../conversation-request";
import { resolveRequestDefinition } from "../request-definitions";
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

function toSqlDateTime(iso: string): string {
  return iso.slice(0, 19).replace("T", " ");
}

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

export type ScheduleRequestFollowupInput = {
  requestId: string;
  purpose: string;
  scheduledFor: string;
  turnPlanId?: string | null;
};

export type ScheduleRequestFollowupResult =
  | { ok: true; status: "created" | "duplicate"; followup: RequestFollowup }
  | { ok: false; status: "request_not_found" | "error"; followup: null; warning: string };

/** One pending follow-up per request: rescheduling means cancel + schedule. */
export async function scheduleRequestFollowup(input: ScheduleRequestFollowupInput): Promise<ScheduleRequestFollowupResult> {
  const request = await loadConversationRequest(input.requestId);
  if (!request) return { ok: false, status: "request_not_found", followup: null, warning: `Request ${input.requestId} does not exist.` };

  const pending = await listPendingFollowupsForRequest(input.requestId);
  if (pending.length > 0) return { ok: true, status: "duplicate", followup: pending[0] };

  const actionId = `action-${randomUUID()}`;
  const idempotencyKey = `followup-${createHash("sha256").update(`${input.requestId}:${input.purpose}:${input.scheduledFor}`).digest("hex").slice(0, 40)}`;

  const insert = await safeExecute(
    `INSERT IGNORE INTO \`${AGENT_ACTIONS_TABLE}\` (
        action_id, idempotency_key, request_id, action_type, status,
        risk_level, approval_requirement, draft_payload_json, scheduled_for,
        source, created_by
      ) VALUES (?, ?, ?, ?, 'scheduled', 'low', 'none', ?, ?, 'multi_request_runtime', 'ai')`,
    [
      actionId,
      idempotencyKey,
      input.requestId,
      REQUEST_FOLLOWUP_ACTION_TYPE,
      JSON.stringify({ purpose: input.purpose, turnPlanId: input.turnPlanId ?? null }),
      toSqlDateTime(input.scheduledFor)
    ]
  );

  if (!insert.ok) return { ok: false, status: "error", followup: null, warning: insert.error };

  const after = await listPendingFollowupsForRequest(input.requestId);
  const followup = after.find((row) => row.actionId === actionId) ?? after[0] ?? null;
  if (!followup) return { ok: false, status: "error", followup: null, warning: "request_followup_reload_failed" };
  return { ok: true, status: insert.affectedRows > 0 ? "created" : "duplicate", followup };
}

/** Applies the request definition's follow-up policy; definitions without one schedule nothing. */
export async function scheduleFollowupFromDefinition(
  request: ConversationRequest,
  options: { now?: Date; turnPlanId?: string | null } = {}
): Promise<ScheduleRequestFollowupResult | null> {
  const policy = resolveRequestDefinition(request.intentType).followupPolicy;
  if (!policy) return null;
  const now = options.now ?? new Date();
  const scheduledFor = new Date(now.getTime() + policy.delayMinutes * 60_000).toISOString();
  return scheduleRequestFollowup({ requestId: request.requestId, purpose: policy.purpose, scheduledFor, turnPlanId: options.turnPlanId ?? null });
}

export type RequestFollowupTickResult = {
  executed: RequestFollowup[];
  cancelled: Array<{ followup: RequestFollowup; reason: string }>;
  warnings: string[];
};

async function cancelFollowupRow(actionId: string, reason: string): Promise<boolean> {
  const update = await safeExecute(
    `UPDATE \`${AGENT_ACTIONS_TABLE}\`
        SET status = 'cancelled', cancel_reason = ?, cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE action_id = ? AND status = 'scheduled'`,
    [reason.slice(0, 64), actionId]
  );
  return update.ok && update.affectedRows > 0;
}

/**
 * Lazy cancellation at execution time - nothing is sent before the tick, so
 * deciding here is race-free by construction: a follow-up only executes if
 * the request is still workable, no human owns it, and the customer has NOT
 * already replied to that request since it was scheduled. Execution is
 * exactly-once by CAS.
 */
export async function runRequestFollowupTick(options: { now?: Date; limit?: number } = {}): Promise<RequestFollowupTickResult> {
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const result: RequestFollowupTickResult = { executed: [], cancelled: [], warnings: [] };

  const due = await safeQueryRows<DbLikeRow>(
    `SELECT * FROM \`${AGENT_ACTIONS_TABLE}\`
      WHERE action_type = ? AND status = 'scheduled' AND request_id IS NOT NULL AND scheduled_for <= ?
      ORDER BY scheduled_for ASC
      LIMIT ${limit}`,
    [REQUEST_FOLLOWUP_ACTION_TYPE, toSqlDateTime(now.toISOString())]
  );
  if (!due.ok) return { ...result, warnings: [due.error] };

  for (const row of due.rows) {
    const followup = rowToFollowup(row);
    const request = await loadConversationRequest(followup.requestId);

    if (!request || request.status === "resolved" || request.status === "cancelled" || request.status === "unresolvable") {
      if (await cancelFollowupRow(followup.actionId, request ? `request_${request.status}` : "request_not_found")) {
        result.cancelled.push({ followup, reason: request ? `request_${request.status}` : "request_not_found" });
      }
      continue;
    }

    if (request.status === "waiting_human") {
      if (await cancelFollowupRow(followup.actionId, "human_owns_request")) {
        result.cancelled.push({ followup, reason: "human_owns_request" });
      }
      continue;
    }

    const links = await listRequestMessageLinks(followup.requestId);
    const customerRepliedAfterScheduling = links.some(
      (link) =>
        link.createdAt > followup.createdAt &&
        (link.relationType === "continued" || link.relationType === "modified" || link.relationType === "answered" || link.relationType === "confirmed")
    );
    if (customerRepliedAfterScheduling) {
      if (await cancelFollowupRow(followup.actionId, "customer_replied")) {
        result.cancelled.push({ followup, reason: "customer_replied" });
      }
      continue;
    }

    const claim = await safeExecute(
      `UPDATE \`${AGENT_ACTIONS_TABLE}\`
          SET status = 'executed', executed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE action_id = ? AND status = 'scheduled'`,
      [followup.actionId]
    );
    if (!claim.ok) {
      result.warnings.push(`followup_claim_failed:${followup.actionId}:${claim.error}`);
      continue;
    }
    if (claim.affectedRows <= 0) continue; // another worker won the CAS

    await appendRequestEvent({
      dedupeKey: `request:${followup.requestId}:followup:${followup.actionId}:action_executed`,
      requestId: followup.requestId,
      eventType: "action_executed",
      sourceType: "system",
      sourceId: followup.actionId,
      payload: { actionType: REQUEST_FOLLOWUP_ACTION_TYPE, purpose: followup.purpose },
      occurredAt: now.toISOString()
    });
    result.executed.push({ ...followup, status: "executed" });
  }

  return result;
}
