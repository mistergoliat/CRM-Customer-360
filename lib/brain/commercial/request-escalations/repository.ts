import { randomUUID } from "node:crypto";
import { safeExecute, safeQueryRows } from "@/lib/db";
import { appendRequestEvent, loadConversationRequest, transitionConversationRequest } from "../conversation-request";
import { applyRequestReduction } from "../request-definitions";
import {
  DEFAULT_ESCALATION_TARGET,
  ESCALATION_ALLOWED_TRANSITIONS,
  ESCALATION_CATEGORIES,
  ESCALATION_CREATED_BY,
  ESCALATION_MODES,
  ESCALATION_OPEN_STATUSES,
  ESCALATION_RESOLUTION_OUTCOMES,
  ESCALATION_STATUSES,
  ESCALATION_TARGET_TYPES
} from "./constants";
import type {
  EscalationCategory,
  EscalationCreatedBy,
  EscalationMode,
  EscalationResolutionOutcome,
  EscalationStatus,
  EscalationTargetType
} from "./constants";
import type {
  EscalateRequestInput,
  EscalateRequestResult,
  RequestEscalation,
  ResolveEscalationInput,
  ResolveEscalationResult,
  TransitionEscalationResult
} from "./types";

export const REQUEST_ESCALATION_TABLE = "crm_request_escalations";

type DbLikeRow = Record<string, unknown>;

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function asDateTimeIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return asText(value);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "bigint") return Number(value);
  return null;
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const text = asText(value);
  return text && (allowed as readonly string[]).includes(text) ? (text as T) : fallback;
}

function rowToEscalation(row: DbLikeRow): RequestEscalation {
  return {
    contractName: "RequestEscalation",
    schemaVersion: "1.0.0",
    escalationId: asText(row.escalation_id) ?? "",
    requestId: asText(row.request_id) ?? "",
    conversationId: asNumber(row.conversation_id) ?? 0,
    category: asEnum<EscalationCategory>(row.category, ESCALATION_CATEGORIES, "other"),
    mode: asEnum<EscalationMode>(row.mode, ESCALATION_MODES, "internal_consultation"),
    targetType: asEnum<EscalationTargetType>(row.target_type, ESCALATION_TARGET_TYPES, "queue"),
    targetId: asText(row.target_id) ?? DEFAULT_ESCALATION_TARGET.targetId,
    status: asEnum<EscalationStatus>(row.status, ESCALATION_STATUSES, "created"),
    reason: asText(row.reason) ?? "",
    createdBy: asEnum<EscalationCreatedBy>(row.created_by, ESCALATION_CREATED_BY, "system"),
    assignedOperatorId: asText(row.assigned_operator_id),
    resolutionOutcome: asText(row.resolution_outcome)
      ? asEnum<EscalationResolutionOutcome>(row.resolution_outcome, ESCALATION_RESOLUTION_OUTCOMES, "cancelled")
      : null,
    resolutionNote: asText(row.resolution_note),
    createdAt: asDateTimeIso(row.created_at) ?? "",
    updatedAt: asDateTimeIso(row.updated_at) ?? "",
    resolvedAt: asDateTimeIso(row.resolved_at)
  };
}

export async function loadRequestEscalation(escalationId: string): Promise<RequestEscalation | null> {
  const result = await safeQueryRows<DbLikeRow>(
    `SELECT * FROM \`${REQUEST_ESCALATION_TABLE}\` WHERE escalation_id = ? LIMIT 1`,
    [escalationId]
  );
  if (!result.ok || !result.rows[0]) return null;
  return rowToEscalation(result.rows[0]);
}

export async function findOpenEscalationForRequest(requestId: string): Promise<RequestEscalation | null> {
  const result = await safeQueryRows<DbLikeRow>(
    `SELECT * FROM \`${REQUEST_ESCALATION_TABLE}\` WHERE request_id = ? AND active_marker = 1 LIMIT 1`,
    [requestId]
  );
  if (!result.ok || !result.rows[0]) return null;
  return rowToEscalation(result.rows[0]);
}

export async function listOpenEscalations(filter: { targetType?: string; targetId?: string } = {}): Promise<RequestEscalation[]> {
  const conditions = ["active_marker = 1"];
  const params: unknown[] = [];
  if (filter.targetType) {
    conditions.push("target_type = ?");
    params.push(filter.targetType);
  }
  if (filter.targetId) {
    conditions.push("target_id = ?");
    params.push(filter.targetId);
  }
  const result = await safeQueryRows<DbLikeRow>(
    `SELECT * FROM \`${REQUEST_ESCALATION_TABLE}\` WHERE ${conditions.join(" AND ")} ORDER BY created_at ASC`,
    params
  );
  if (!result.ok) return [];
  return result.rows.map((row) => rowToEscalation(row));
}

/**
 * Escalates ONE request: at most one open escalation per request (DB unique),
 * always with a target, and the request itself is parked waiting_human by the
 * definition reducer reacting to the emitted event - sibling requests in the
 * same conversation keep working untouched.
 */
export async function escalateRequest(input: EscalateRequestInput): Promise<EscalateRequestResult> {
  const request = await loadConversationRequest(input.requestId);
  if (!request) {
    return { ok: false, status: "request_not_found", escalation: null, warning: `Request ${input.requestId} does not exist.` };
  }

  const open = await findOpenEscalationForRequest(input.requestId);
  if (open) return { ok: true, status: "duplicate", escalation: open };

  const escalationId = `esc-${randomUUID()}`;
  const targetType = input.targetType ?? DEFAULT_ESCALATION_TARGET.targetType;
  const targetId = input.targetId ?? DEFAULT_ESCALATION_TARGET.targetId;

  const insert = await safeExecute(
    `INSERT IGNORE INTO \`${REQUEST_ESCALATION_TABLE}\` (
        escalation_id, request_id, conversation_id, category, mode,
        target_type, target_id, status, reason, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'created', ?, ?)`,
    [escalationId, input.requestId, request.conversationId, input.category, input.mode, targetType, targetId, input.reason, input.createdBy]
  );

  if (!insert.ok) return { ok: false, status: "error", escalation: null, warning: insert.error };

  if (insert.affectedRows <= 0) {
    // Lost the race: another writer opened the escalation first - reuse it.
    const concurrent = await findOpenEscalationForRequest(input.requestId);
    if (concurrent) return { ok: true, status: "duplicate", escalation: concurrent };
    return { ok: false, status: "error", escalation: null, warning: "request_escalation_insert_failed" };
  }

  await appendRequestEvent({
    dedupeKey: `request:${input.requestId}:escalation:${escalationId}:human_escalation_created`,
    requestId: input.requestId,
    eventType: "human_escalation_created",
    sourceType: input.createdBy === "operator" ? "operator" : input.createdBy === "planner" ? "planner" : "system",
    sourceId: input.sourceId ?? escalationId,
    payload: { escalationId, category: input.category, mode: input.mode, targetType, targetId, reason: input.reason },
    occurredAt: new Date().toISOString()
  });

  // The reducer reacts to the event and parks the request waiting_human.
  const fresh = await loadConversationRequest(input.requestId);
  if (fresh) await applyRequestReduction(fresh);

  const escalation = await loadRequestEscalation(escalationId);
  if (!escalation) return { ok: false, status: "error", escalation: null, warning: "request_escalation_reload_failed" };
  return { ok: true, status: "created", escalation };
}

/** Explicit lifecycle step (assign/accept/start/cancel/expire/re-route) by CAS. */
export async function transitionEscalation(
  escalationId: string,
  fromStatus: EscalationStatus,
  toStatus: EscalationStatus,
  options: { operatorId?: string | null } = {}
): Promise<TransitionEscalationResult> {
  const allowed = ESCALATION_ALLOWED_TRANSITIONS[fromStatus] ?? [];
  if (!allowed.includes(toStatus)) {
    return { ok: false, status: "invalid_transition", escalation: null, warning: `Transition ${fromStatus} -> ${toStatus} is not allowed.` };
  }

  const terminal = toStatus === "resolved" || toStatus === "cancelled" || toStatus === "expired";
  const update = await safeExecute(
    `UPDATE \`${REQUEST_ESCALATION_TABLE}\`
        SET status = ?,
            assigned_operator_id = COALESCE(?, assigned_operator_id),
            resolution_outcome = ${toStatus === "cancelled" ? "'cancelled'" : toStatus === "expired" ? "'expired'" : "resolution_outcome"},
            resolved_at = ${terminal ? "CURRENT_TIMESTAMP(3)" : "resolved_at"},
            updated_at = CURRENT_TIMESTAMP(3)
      WHERE escalation_id = ? AND status = ?`,
    [toStatus, options.operatorId ?? null, escalationId, fromStatus]
  );

  if (!update.ok) return { ok: false, status: "error", escalation: null, warning: update.error };

  const current = await loadRequestEscalation(escalationId);
  if (update.affectedRows <= 0) {
    if (!current) return { ok: false, status: "not_found", escalation: null, warning: `Escalation ${escalationId} does not exist.` };
    return { ok: false, status: "conflict", escalation: current, warning: `Escalation ${escalationId} is in status ${current.status}, expected ${fromStatus}.` };
  }
  if (!current) return { ok: false, status: "error", escalation: null, warning: "request_escalation_reload_failed" };
  return { ok: true, escalation: current };
}

/**
 * Operator resolution in one act, from any open state (queue pick-up implies
 * assign+accept). Two outcomes: the operator answered the request
 * (resolved_request) or hands control back to the AI (returned_to_ai). The
 * request transition is explicit and audited - never inferred by the model.
 */
export async function resolveRequestEscalation(input: ResolveEscalationInput): Promise<ResolveEscalationResult> {
  const placeholders = ESCALATION_OPEN_STATUSES.map(() => "?").join(",");
  const update = await safeExecute(
    `UPDATE \`${REQUEST_ESCALATION_TABLE}\`
        SET status = 'resolved',
            assigned_operator_id = COALESCE(assigned_operator_id, ?),
            resolution_outcome = ?,
            resolution_note = ?,
            resolved_at = CURRENT_TIMESTAMP(3),
            updated_at = CURRENT_TIMESTAMP(3)
      WHERE escalation_id = ? AND status IN (${placeholders})`,
    [input.operatorId, input.outcome, input.resolutionNote ?? null, input.escalationId, ...ESCALATION_OPEN_STATUSES]
  );

  if (!update.ok) return { ok: false, status: "error", escalation: null, warning: update.error };

  const escalation = await loadRequestEscalation(input.escalationId);
  if (update.affectedRows <= 0) {
    if (!escalation) return { ok: false, status: "not_found", escalation: null, warning: `Escalation ${input.escalationId} does not exist.` };
    return { ok: false, status: "conflict", escalation, warning: `Escalation ${input.escalationId} is already ${escalation.status}.` };
  }
  if (!escalation) return { ok: false, status: "error", escalation: null, warning: "request_escalation_reload_failed" };

  const request = await loadConversationRequest(escalation.requestId);
  if (!request) {
    return { ok: false, status: "request_error", escalation, warning: `Request ${escalation.requestId} not found after resolution.` };
  }

  const occurredAt = new Date().toISOString();
  if (input.outcome === "resolved_request") {
    if (request.status !== "resolved") {
      const transition = await transitionConversationRequest({
        requestId: request.requestId,
        fromStatus: request.status,
        toStatus: "resolved",
        resolution: { type: input.resolutionType ?? "operator_resolved", entityType: "escalation", entityId: escalation.escalationId }
      });
      if (!transition.ok && transition.status !== "conflict") {
        return { ok: false, status: "request_error", escalation, warning: transition.warning };
      }
    }
    await appendRequestEvent({
      dedupeKey: `request:${request.requestId}:escalation:${escalation.escalationId}:request_resolved`,
      requestId: request.requestId,
      eventType: "request_resolved",
      sourceType: "operator",
      sourceId: input.operatorId,
      payload: { escalationId: escalation.escalationId, outcome: input.outcome, note: input.resolutionNote ?? null },
      occurredAt
    });
  } else {
    if (request.status === "waiting_human") {
      const transition = await transitionConversationRequest({ requestId: request.requestId, fromStatus: "waiting_human", toStatus: "active" });
      if (!transition.ok && transition.status !== "conflict") {
        return { ok: false, status: "request_error", escalation, warning: transition.warning };
      }
    }
    await appendRequestEvent({
      dedupeKey: `request:${request.requestId}:escalation:${escalation.escalationId}:request_reopened`,
      requestId: request.requestId,
      eventType: "request_reopened",
      sourceType: "operator",
      sourceId: input.operatorId,
      payload: { escalationId: escalation.escalationId, outcome: input.outcome, note: input.resolutionNote ?? null },
      occurredAt
    });
  }

  const finalRequest = await loadConversationRequest(escalation.requestId);
  return { ok: true, escalation, requestStatus: finalRequest?.status ?? "unknown" };
}
