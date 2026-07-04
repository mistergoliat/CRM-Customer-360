import { createHash, randomUUID } from "node:crypto";
import { safeExecute, safeQueryRows } from "@/lib/db";
import {
  CONVERSATION_REQUEST_ACTIVE_STATUSES,
  CONVERSATION_REQUEST_DOMAINS,
  CONVERSATION_REQUEST_PRIORITIES,
  CONVERSATION_REQUEST_STATUSES,
  REQUEST_EVENT_SOURCE_TYPES,
  REQUEST_EVENT_TYPES,
  REQUEST_LIFECYCLE_ALLOWED_TRANSITIONS,
  REQUEST_MESSAGE_LINKED_BY,
  REQUEST_MESSAGE_RELATION_TYPES
} from "./constants";
import type {
  ConversationRequestDomain,
  ConversationRequestPriority,
  ConversationRequestStatus,
  RequestEventSourceType,
  RequestEventType,
  RequestMessageLinkedBy,
  RequestMessageRelationType
} from "./constants";
import type {
  AppendRequestEventInput,
  AppendRequestEventResult,
  ConversationRequest,
  CreateConversationRequestInput,
  CreateConversationRequestResult,
  LinkMessageToRequestInput,
  LinkMessageToRequestResult,
  RequestEvent,
  RequestMessageLink,
  TransitionConversationRequestInput,
  TransitionConversationRequestResult
} from "./types";

export const CONVERSATION_REQUEST_TABLE = "crm_conversation_requests";
export const REQUEST_EVENT_TABLE = "crm_request_events";
export const REQUEST_MESSAGE_LINK_TABLE = "crm_request_message_links";

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
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
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

function asJsonRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const text = asText(value);
  return text && (allowed as readonly string[]).includes(text) ? (text as T) : fallback;
}

function isoToSqlDateTime(value: string): string {
  const date = new Date(value);
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  return safe.toISOString().slice(0, 23).replace("T", " ");
}

function rowToConversationRequest(row: DbLikeRow): ConversationRequest {
  const resolutionType = asText(row.resolution_type);
  return {
    contractName: "ConversationRequest",
    schemaVersion: "1.0.0",
    requestId: asText(row.request_id) ?? "",
    creationKey: asText(row.creation_key) ?? "",
    conversationId: asNumber(row.conversation_id) ?? 0,
    opportunityId: asNumber(row.opportunity_id),
    intentType: asText(row.intent_type) ?? "unknown",
    intentDomain: asEnum<ConversationRequestDomain>(row.intent_domain, CONVERSATION_REQUEST_DOMAINS, "general"),
    status: asEnum<ConversationRequestStatus>(row.status, CONVERSATION_REQUEST_STATUSES, "detected"),
    priority: asEnum<ConversationRequestPriority>(row.priority, CONVERSATION_REQUEST_PRIORITIES, "normal"),
    parentRequestId: asText(row.parent_request_id),
    createdFromMessageId: asText(row.created_from_message_id) ?? "",
    resolution: resolutionType
      ? {
          type: resolutionType,
          entityType: asText(row.resolution_entity_type),
          entityId: asText(row.resolution_entity_id)
        }
      : null,
    createdAt: asDateTimeIso(row.created_at) ?? "",
    updatedAt: asDateTimeIso(row.updated_at) ?? "",
    resolvedAt: asDateTimeIso(row.resolved_at)
  };
}

function rowToRequestEvent(row: DbLikeRow): RequestEvent {
  return {
    requestEventId: asText(row.request_event_id) ?? "",
    dedupeKey: asText(row.dedupe_key) ?? "",
    requestId: asText(row.request_id) ?? "",
    eventType: asEnum<RequestEventType>(row.event_type, REQUEST_EVENT_TYPES, "request_detected"),
    sourceType: asEnum<RequestEventSourceType>(row.source_type, REQUEST_EVENT_SOURCE_TYPES, "system"),
    sourceId: asText(row.source_id),
    payload: asJsonRecord(row.payload_json),
    occurredAt: asDateTimeIso(row.occurred_at) ?? "",
    createdAt: asDateTimeIso(row.created_at) ?? ""
  };
}

function rowToRequestMessageLink(row: DbLikeRow): RequestMessageLink {
  return {
    requestId: asText(row.request_id) ?? "",
    messageId: asText(row.message_id) ?? "",
    relationType: asEnum<RequestMessageRelationType>(row.relation_type, REQUEST_MESSAGE_RELATION_TYPES, "mentioned"),
    confidence: asNumber(row.confidence),
    linkedBy: asEnum<RequestMessageLinkedBy>(row.linked_by, REQUEST_MESSAGE_LINKED_BY, "deterministic"),
    createdAt: asDateTimeIso(row.created_at) ?? ""
  };
}

async function findRequestByCreationKey(creationKey: string): Promise<ConversationRequest | null> {
  const result = await safeQueryRows<DbLikeRow>(
    `SELECT * FROM \`${CONVERSATION_REQUEST_TABLE}\` WHERE creation_key = ? LIMIT 1`,
    [creationKey]
  );
  if (!result.ok) return null;
  return result.rows[0] ? rowToConversationRequest(result.rows[0]) : null;
}

export async function loadConversationRequest(requestId: string): Promise<ConversationRequest | null> {
  const result = await safeQueryRows<DbLikeRow>(
    `SELECT * FROM \`${CONVERSATION_REQUEST_TABLE}\` WHERE request_id = ? LIMIT 1`,
    [requestId]
  );
  if (!result.ok) return null;
  return result.rows[0] ? rowToConversationRequest(result.rows[0]) : null;
}

export async function listActiveConversationRequests(conversationId: number): Promise<ConversationRequest[]> {
  const placeholders = CONVERSATION_REQUEST_ACTIVE_STATUSES.map(() => "?").join(",");
  const result = await safeQueryRows<DbLikeRow>(
    `SELECT * FROM \`${CONVERSATION_REQUEST_TABLE}\`
      WHERE conversation_id = ? AND status IN (${placeholders})
      ORDER BY created_at ASC, id ASC`,
    [conversationId, ...CONVERSATION_REQUEST_ACTIVE_STATUSES]
  );
  if (!result.ok) return [];
  return result.rows.map((row) => rowToConversationRequest(row));
}

/**
 * Idempotent by creation_key (UNIQUE): a retry of the same detection returns
 * the existing request without a second row. Never idempotent by intent_type -
 * a new detection of the same type always creates a new, independent request.
 */
export async function createConversationRequest(input: CreateConversationRequestInput): Promise<CreateConversationRequestResult> {
  const existing = await findRequestByCreationKey(input.creationKey);
  if (existing) return { ok: true, status: "duplicate", request: existing };

  const requestId = `convreq-${randomUUID()}`;
  const insert = await safeExecute(
    `INSERT IGNORE INTO \`${CONVERSATION_REQUEST_TABLE}\` (
        request_id, creation_key, conversation_id, opportunity_id,
        intent_type, intent_domain, status, priority,
        parent_request_id, created_from_message_id
      ) VALUES (?, ?, ?, ?, ?, ?, 'detected', ?, ?, ?)`,
    [
      requestId,
      input.creationKey,
      input.conversationId,
      input.opportunityId ?? null,
      input.intentType,
      input.intentDomain,
      input.priority ?? "normal",
      input.parentRequestId ?? null,
      input.createdFromMessageId
    ]
  );

  if (!insert.ok) {
    return { ok: false, status: "error", request: null, warning: insert.error };
  }

  if (insert.affectedRows <= 0) {
    // Lost the race against a concurrent identical detection - reuse its row.
    const concurrent = await findRequestByCreationKey(input.creationKey);
    if (concurrent) return { ok: true, status: "duplicate", request: concurrent };
    return { ok: false, status: "error", request: null, warning: "conversation_request_insert_failed" };
  }

  const created = await loadConversationRequest(requestId);
  if (!created) return { ok: false, status: "error", request: null, warning: "conversation_request_reload_failed" };
  return { ok: true, status: "created", request: created };
}

/**
 * Compare-and-swap transition: the UPDATE only applies when the row is still
 * in `fromStatus`; affectedRows = 0 is a concurrency conflict, never success.
 * Reopening (resolved/unresolvable -> active) clears resolution fields - the
 * prior resolution stays visible in crm_request_events, not on the row.
 */
export async function transitionConversationRequest(input: TransitionConversationRequestInput): Promise<TransitionConversationRequestResult> {
  const allowed = REQUEST_LIFECYCLE_ALLOWED_TRANSITIONS[input.fromStatus] ?? [];
  if (!allowed.includes(input.toStatus)) {
    return {
      ok: false,
      status: "invalid_transition",
      request: null,
      warning: `Transition ${input.fromStatus} -> ${input.toStatus} is not allowed.`
    };
  }

  const resolves = input.toStatus === "resolved";
  const reopens = input.fromStatus === "resolved" || input.fromStatus === "unresolvable";
  const resolution = resolves ? input.resolution ?? null : null;

  const update = await safeExecute(
    `UPDATE \`${CONVERSATION_REQUEST_TABLE}\`
        SET status = ?,
            resolved_at = ${resolves ? "CURRENT_TIMESTAMP(3)" : reopens ? "NULL" : "resolved_at"},
            resolution_type = ${resolves || reopens ? "?" : "resolution_type"},
            resolution_entity_type = ${resolves || reopens ? "?" : "resolution_entity_type"},
            resolution_entity_id = ${resolves || reopens ? "?" : "resolution_entity_id"},
            updated_at = CURRENT_TIMESTAMP(3)
      WHERE request_id = ? AND status = ?`,
    resolves || reopens
      ? [input.toStatus, resolution?.type ?? null, resolution?.entityType ?? null, resolution?.entityId ?? null, input.requestId, input.fromStatus]
      : [input.toStatus, input.requestId, input.fromStatus]
  );

  if (!update.ok) {
    return { ok: false, status: "error", request: null, warning: update.error };
  }

  const current = await loadConversationRequest(input.requestId);
  if (update.affectedRows <= 0) {
    if (!current) {
      return { ok: false, status: "not_found", request: null, warning: `Request ${input.requestId} does not exist.` };
    }
    return {
      ok: false,
      status: "conflict",
      request: current,
      warning: `Request ${input.requestId} is in status ${current.status}, expected ${input.fromStatus}.`
    };
  }

  if (!current) {
    return { ok: false, status: "error", request: null, warning: "conversation_request_reload_failed" };
  }
  return { ok: true, status: "transitioned", request: current };
}

async function findRequestEventByDedupeKey(dedupeKey: string): Promise<RequestEvent | null> {
  const result = await safeQueryRows<DbLikeRow>(
    `SELECT * FROM \`${REQUEST_EVENT_TABLE}\` WHERE dedupe_key = ? LIMIT 1`,
    [dedupeKey]
  );
  if (!result.ok) return null;
  return result.rows[0] ? rowToRequestEvent(result.rows[0]) : null;
}

/**
 * Append-only and idempotent: request_event_id derives from the dedupe_key,
 * so a retry of the same semantic event produces the same identity and
 * collapses to a single row via the UNIQUE constraints.
 */
export async function appendRequestEvent(input: AppendRequestEventInput): Promise<AppendRequestEventResult> {
  const requestEventId = `revt-${createHash("sha256").update(input.dedupeKey).digest("hex").slice(0, 32)}`;

  const insert = await safeExecute(
    `INSERT IGNORE INTO \`${REQUEST_EVENT_TABLE}\` (
        request_event_id, dedupe_key, request_id, event_type, source_type, source_id, payload_json, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      requestEventId,
      input.dedupeKey,
      input.requestId,
      input.eventType,
      input.sourceType,
      input.sourceId ?? null,
      input.payload ? JSON.stringify(input.payload) : null,
      isoToSqlDateTime(input.occurredAt)
    ]
  );

  if (!insert.ok) {
    return { ok: false, status: "error", event: null, warning: insert.error };
  }

  const event = await findRequestEventByDedupeKey(input.dedupeKey);
  if (!event) return { ok: false, status: "error", event: null, warning: "request_event_reload_failed" };
  return { ok: true, status: insert.affectedRows > 0 ? "created" : "duplicate", event };
}

export async function listRequestEvents(requestId: string): Promise<RequestEvent[]> {
  const result = await safeQueryRows<DbLikeRow>(
    `SELECT * FROM \`${REQUEST_EVENT_TABLE}\` WHERE request_id = ? ORDER BY occurred_at ASC, id ASC`,
    [requestId]
  );
  if (!result.ok) return [];
  return result.rows.map((row) => rowToRequestEvent(row));
}

/** Idempotent by (request_id, message_id, relation_type) - the DB unique triple. */
export async function linkMessageToRequest(input: LinkMessageToRequestInput): Promise<LinkMessageToRequestResult> {
  const insert = await safeExecute(
    `INSERT IGNORE INTO \`${REQUEST_MESSAGE_LINK_TABLE}\` (
        request_id, message_id, relation_type, confidence, linked_by
      ) VALUES (?, ?, ?, ?, ?)`,
    [input.requestId, input.messageId, input.relationType, input.confidence ?? null, input.linkedBy]
  );

  if (!insert.ok) {
    return { ok: false, status: "error", link: null, warning: insert.error };
  }

  const result = await safeQueryRows<DbLikeRow>(
    `SELECT * FROM \`${REQUEST_MESSAGE_LINK_TABLE}\`
      WHERE request_id = ? AND message_id = ? AND relation_type = ? LIMIT 1`,
    [input.requestId, input.messageId, input.relationType]
  );
  const row = result.ok ? result.rows[0] : null;
  if (!row) return { ok: false, status: "error", link: null, warning: "request_message_link_reload_failed" };
  return { ok: true, status: insert.affectedRows > 0 ? "created" : "duplicate", link: rowToRequestMessageLink(row) };
}

export async function listRequestMessageLinks(requestId: string): Promise<RequestMessageLink[]> {
  const result = await safeQueryRows<DbLikeRow>(
    `SELECT * FROM \`${REQUEST_MESSAGE_LINK_TABLE}\` WHERE request_id = ? ORDER BY created_at ASC, id ASC`,
    [requestId]
  );
  if (!result.ok) return [];
  return result.rows.map((row) => rowToRequestMessageLink(row));
}
