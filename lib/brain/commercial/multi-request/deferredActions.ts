import { createHash, randomUUID } from "node:crypto";
import { safeExecute, safeQueryRows } from "@/lib/db";
import { appendRequestEvent, loadConversationRequest } from "../conversation-request";

export const AGENT_ACTIONS_TABLE = "crm_agent_actions";

export type DeferredRequestAction = {
  actionId: string;
  requestId: string;
  actionType: string;
  status: string;
  reason: string;
  payload: Record<string, unknown> | null;
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

function rowToDeferredAction(row: DbLikeRow): DeferredRequestAction {
  let payload: Record<string, unknown> | null = null;
  const raw = row.draft_payload_json;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) payload = raw as Record<string, unknown>;
  else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      payload = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      payload = null;
    }
  }
  return {
    actionId: asText(row.action_id) ?? "",
    requestId: asText(row.request_id) ?? "",
    actionType: asText(row.action_type) ?? "",
    status: asText(row.status) ?? "",
    reason: asText(row.cancel_reason) ?? (payload?.deferReason as string | undefined) ?? "",
    payload,
    scheduledFor: asDateTimeIso(row.scheduled_for),
    createdAt: asDateTimeIso(row.created_at) ?? ""
  };
}

export type DeferRequestActionInput = {
  requestId: string;
  /** Stable per turn: a retry of the same turn defers the same action once. */
  turnPlanId: string;
  actionType: string;
  reason: string;
  payload?: Record<string, unknown> | null;
  scheduledFor?: string | null;
};

export type DeferRequestActionResult =
  | { ok: true; status: "created" | "duplicate"; action: DeferredRequestAction }
  | { ok: false; status: "request_not_found" | "error"; action: null; warning: string };

async function findActionByIdempotencyKey(idempotencyKey: string): Promise<DeferredRequestAction | null> {
  const result = await safeQueryRows<DbLikeRow>(
    `SELECT * FROM \`${AGENT_ACTIONS_TABLE}\` WHERE idempotency_key = ? LIMIT 1`,
    [idempotencyKey]
  );
  if (!result.ok || !result.rows[0]) return null;
  return rowToDeferredAction(result.rows[0]);
}

/**
 * A deferral is not a failure and never loses work: the pending action lands
 * in crm_agent_actions (the durable action source, ADR-003) as `scheduled`,
 * tagged with its request, and the action_deferred event feeds the trail so
 * the response can honestly say "quede pendiente de esto".
 */
export async function deferRequestAction(input: DeferRequestActionInput): Promise<DeferRequestActionResult> {
  const request = await loadConversationRequest(input.requestId);
  if (!request) return { ok: false, status: "request_not_found", action: null, warning: `Request ${input.requestId} does not exist.` };

  const idempotencyKey = `deferred-${createHash("sha256").update(`${input.requestId}:${input.turnPlanId}:${input.actionType}`).digest("hex").slice(0, 40)}`;
  const existing = await findActionByIdempotencyKey(idempotencyKey);
  if (existing) return { ok: true, status: "duplicate", action: existing };

  const actionId = `action-${randomUUID()}`;
  const payload = { ...(input.payload ?? {}), deferReason: input.reason, turnPlanId: input.turnPlanId };

  const insert = await safeExecute(
    `INSERT IGNORE INTO \`${AGENT_ACTIONS_TABLE}\` (
        action_id, idempotency_key, request_id, conversation_case_id,
        action_type, status, risk_level, approval_requirement,
        draft_payload_json, scheduled_for, source, created_by
      ) VALUES (?, ?, ?, NULL, ?, 'scheduled', 'low', 'none', ?, ?, 'multi_request_runtime', 'ai')`,
    [
      actionId,
      idempotencyKey,
      input.requestId,
      input.actionType,
      JSON.stringify(payload),
      input.scheduledFor ? input.scheduledFor.slice(0, 19).replace("T", " ") : null
    ]
  );

  if (!insert.ok) return { ok: false, status: "error", action: null, warning: insert.error };

  if (insert.affectedRows <= 0) {
    const concurrent = await findActionByIdempotencyKey(idempotencyKey);
    if (concurrent) return { ok: true, status: "duplicate", action: concurrent };
    return { ok: false, status: "error", action: null, warning: "deferred_action_insert_failed" };
  }

  await appendRequestEvent({
    dedupeKey: `request:${input.requestId}:turn:${input.turnPlanId}:action_deferred:${input.actionType}`,
    requestId: input.requestId,
    eventType: "action_deferred",
    sourceType: "planner",
    sourceId: input.turnPlanId,
    payload: { actionId, actionType: input.actionType, reason: input.reason, scheduledFor: input.scheduledFor ?? null },
    occurredAt: new Date().toISOString()
  });

  const action = await findActionByIdempotencyKey(idempotencyKey);
  if (!action) return { ok: false, status: "error", action: null, warning: "deferred_action_reload_failed" };
  return { ok: true, status: "created", action };
}

export async function listDeferredActionsForRequest(requestId: string): Promise<DeferredRequestAction[]> {
  const result = await safeQueryRows<DbLikeRow>(
    `SELECT * FROM \`${AGENT_ACTIONS_TABLE}\` WHERE request_id = ? AND status = 'scheduled' ORDER BY created_at ASC`,
    [requestId]
  );
  if (!result.ok) return [];
  return result.rows.map((row) => rowToDeferredAction(row));
}

export type DeferredActionCompletionResult =
  | { ok: true; action: DeferredRequestAction }
  | { ok: false; status: "not_found" | "conflict" | "error"; warning: string };

/** CAS scheduled -> executed, emitting action_executed for the request trail. */
export async function completeDeferredAction(actionId: string, resultSummary: string): Promise<DeferredActionCompletionResult> {
  const update = await safeExecute(
    `UPDATE \`${AGENT_ACTIONS_TABLE}\`
        SET status = 'executed', executed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE action_id = ? AND status = 'scheduled'`,
    [actionId]
  );
  if (!update.ok) return { ok: false, status: "error", warning: update.error };

  const rows = await safeQueryRows<DbLikeRow>(`SELECT * FROM \`${AGENT_ACTIONS_TABLE}\` WHERE action_id = ? LIMIT 1`, [actionId]);
  const row = rows.ok ? rows.rows[0] : null;
  if (update.affectedRows <= 0) {
    if (!row) return { ok: false, status: "not_found", warning: `Action ${actionId} does not exist.` };
    return { ok: false, status: "conflict", warning: `Action ${actionId} is in status ${asText(row.status)}, expected scheduled.` };
  }
  if (!row) return { ok: false, status: "error", warning: "deferred_action_reload_failed" };

  const action = rowToDeferredAction(row);
  if (action.requestId) {
    await appendRequestEvent({
      dedupeKey: `request:${action.requestId}:action:${actionId}:action_executed`,
      requestId: action.requestId,
      eventType: "action_executed",
      sourceType: "system",
      sourceId: actionId,
      payload: { actionId, actionType: action.actionType, resultSummary },
      occurredAt: new Date().toISOString()
    });
  }
  return { ok: true, action };
}

/** CAS scheduled -> cancelled; the reason lands on the row (cancel_reason). */
export async function cancelDeferredAction(actionId: string, reason: string): Promise<DeferredActionCompletionResult> {
  const update = await safeExecute(
    `UPDATE \`${AGENT_ACTIONS_TABLE}\`
        SET status = 'cancelled', cancel_reason = ?, cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE action_id = ? AND status = 'scheduled'`,
    [reason.slice(0, 64), actionId]
  );
  if (!update.ok) return { ok: false, status: "error", warning: update.error };

  const rows = await safeQueryRows<DbLikeRow>(`SELECT * FROM \`${AGENT_ACTIONS_TABLE}\` WHERE action_id = ? LIMIT 1`, [actionId]);
  const row = rows.ok ? rows.rows[0] : null;
  if (update.affectedRows <= 0) {
    if (!row) return { ok: false, status: "not_found", warning: `Action ${actionId} does not exist.` };
    return { ok: false, status: "conflict", warning: `Action ${actionId} is in status ${asText(row.status)}, expected scheduled.` };
  }
  if (!row) return { ok: false, status: "error", warning: "deferred_action_reload_failed" };
  return { ok: true, action: rowToDeferredAction(row) };
}
