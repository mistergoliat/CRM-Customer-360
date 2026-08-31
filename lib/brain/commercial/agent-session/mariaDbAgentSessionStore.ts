// SALES-AGENT-R3-A01. Real MariaDB-backed AgentSessionStore (migrations/033_agent_sessions.sql).
// Same pool/helpers every other domain in this repo uses (lib/db.ts) - no
// second persistence engine, per ADR-009. Dedupe/race handling mirrors
// lib/brain/commercial/events/repository.ts's proven
// check-then-insert-ignore-then-recheck pattern exactly.

import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { safeQueryRows, withConnection } from "@/lib/db";
import { AGENT_SESSION_CONTRACT_NAME, AGENT_SESSION_SCHEMA_VERSION } from "./types";
import type {
  AgentSession,
  AgentSessionEvent,
  AgentSessionSummary,
  AppendEventInput,
  AppendEventResult,
  EnsureSessionInput,
  LoadRecentEventsInput
} from "./types";
import { buildAgentSessionEventId, buildAgentSessionId } from "./dedupe";
import { sanitizeAgentSessionPayload } from "./sanitizer";
import { projectAgentSessionSummary } from "./summary";
import { AGENT_SESSION_DEFAULT_MAX_AGE_MS, AGENT_SESSION_DEFAULT_MAX_RECENT_EVENTS, AGENT_SESSION_HARD_MAX_RECENT_EVENTS, type AgentSessionStore } from "./store";

const SESSIONS_TABLE = "agent_sessions";
const EVENTS_TABLE = "agent_session_events";

function asJsonRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // fall through to empty record
    }
  }
  return {};
}

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

function sessionRowToContract(row: Record<string, unknown>): AgentSession {
  return {
    contractName: AGENT_SESSION_CONTRACT_NAME,
    schemaVersion: AGENT_SESSION_SCHEMA_VERSION,
    id: String(row.id),
    conversationId: Number(row.conversation_id),
    status: (row.status as AgentSession["status"]) ?? "active",
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at)
  };
}

function eventRowToContract(row: Record<string, unknown>): AgentSessionEvent {
  return {
    contractName: AGENT_SESSION_CONTRACT_NAME,
    schemaVersion: AGENT_SESSION_SCHEMA_VERSION,
    eventId: String(row.id),
    sessionId: String(row.session_id),
    conversationId: Number(row.conversation_id),
    eventType: row.event_type as AgentSessionEvent["eventType"],
    correlationId: String(row.correlation_id),
    causationId: row.causation_id === null || row.causation_id === undefined ? null : String(row.causation_id),
    dedupeKey: String(row.dedupe_key),
    payload: asJsonRecord(row.payload_json),
    occurredAt: asIso(row.occurred_at),
    createdAt: asIso(row.created_at)
  };
}

async function findSessionByConversationId(connection: PoolConnection, conversationId: number): Promise<AgentSession | null> {
  const [rows] = await connection.execute<RowDataPacket[]>(`SELECT * FROM \`${SESSIONS_TABLE}\` WHERE conversation_id = ? LIMIT 1`, [conversationId]);
  return rows[0] ? sessionRowToContract(rows[0] as Record<string, unknown>) : null;
}

async function findSessionById(connection: PoolConnection, sessionId: string): Promise<AgentSession | null> {
  const [rows] = await connection.execute<RowDataPacket[]>(`SELECT * FROM \`${SESSIONS_TABLE}\` WHERE id = ? LIMIT 1`, [sessionId]);
  return rows[0] ? sessionRowToContract(rows[0] as Record<string, unknown>) : null;
}

async function findEventByDedupeKey(connection: PoolConnection, dedupeKey: string): Promise<AgentSessionEvent | null> {
  const [rows] = await connection.execute<RowDataPacket[]>(`SELECT * FROM \`${EVENTS_TABLE}\` WHERE dedupe_key = ? LIMIT 1`, [dedupeKey]);
  return rows[0] ? eventRowToContract(rows[0] as Record<string, unknown>) : null;
}

export function createMariaDbAgentSessionStore(): AgentSessionStore {
  async function ensureSession(input: EnsureSessionInput): Promise<AgentSession> {
    return withConnection(async (connection) => {
      const existing = await findSessionByConversationId(connection, input.conversationId);
      if (existing) return existing;

      const id = buildAgentSessionId(input.conversationId);
      try {
        await connection.execute<ResultSetHeader>(
          `INSERT IGNORE INTO \`${SESSIONS_TABLE}\` (id, conversation_id, status, created_at, updated_at)
           VALUES (?, ?, 'active', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
          [id, input.conversationId]
        );
      } catch (error) {
        // A concurrent ensureSession() for the same conversation can race
        // here (both pass the SELECT above before either INSERTs) - the
        // UNIQUE KEY on conversation_id is the real guarantee; INSERT IGNORE
        // already absorbs that, but a non-duplicate-key error still throws.
        const message = error instanceof Error ? error.message : String(error);
        if (!/ER_DUP_ENTRY|Duplicate entry/i.test(message)) throw error;
      }

      const created = await findSessionByConversationId(connection, input.conversationId);
      if (created) return created;
      throw new Error("agent_session_ensure_failed");
    });
  }

  async function appendEvent(input: AppendEventInput): Promise<AppendEventResult> {
    let sanitizedPayload: Record<string, unknown>;
    try {
      sanitizedPayload = sanitizeAgentSessionPayload(input.payload);
    } catch (error) {
      return { ok: false, status: "error", event: null, warning: error instanceof Error ? error.message : String(error) };
    }

    return withConnection(async (connection) => {
      const existing = await findEventByDedupeKey(connection, input.dedupeKey);
      if (existing) return { ok: true, status: "duplicate", event: existing };

      const occurredAt = input.occurredAt?.trim() || new Date().toISOString();
      const id = buildAgentSessionEventId(input.dedupeKey);

      try {
        const [result] = await connection.execute<ResultSetHeader>(
          `INSERT IGNORE INTO \`${EVENTS_TABLE}\` (
             id, session_id, conversation_id, event_type, correlation_id, causation_id,
             dedupe_key, payload_json, occurred_at, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
          [
            id,
            input.sessionId,
            input.conversationId,
            input.eventType,
            input.correlationId,
            input.causationId ?? null,
            input.dedupeKey,
            JSON.stringify(sanitizedPayload),
            occurredAt
          ]
        );

        if (result.affectedRows <= 0) {
          const raced = await findEventByDedupeKey(connection, input.dedupeKey);
          if (raced) return { ok: true, status: "duplicate", event: raced };
          return { ok: false, status: "error", event: null, warning: "agent_session_event_insert_failed" };
        }
      } catch (error) {
        const raced = await findEventByDedupeKey(connection, input.dedupeKey);
        if (raced) return { ok: true, status: "duplicate", event: raced };
        return { ok: false, status: "error", event: null, warning: error instanceof Error ? error.message : String(error) };
      }

      const event: AgentSessionEvent = {
        contractName: AGENT_SESSION_CONTRACT_NAME,
        schemaVersion: AGENT_SESSION_SCHEMA_VERSION,
        eventId: id,
        sessionId: input.sessionId,
        conversationId: input.conversationId,
        eventType: input.eventType,
        correlationId: input.correlationId,
        causationId: input.causationId ?? null,
        dedupeKey: input.dedupeKey,
        payload: sanitizedPayload,
        occurredAt,
        createdAt: new Date().toISOString()
      };
      return { ok: true, status: "created", event };
    });
  }

  async function loadSession(sessionId: string): Promise<AgentSession | null> {
    return withConnection((connection) => findSessionById(connection, sessionId));
  }

  async function loadSessionForConversation(conversationId: number): Promise<AgentSession | null> {
    return withConnection((connection) => findSessionByConversationId(connection, conversationId));
  }

  async function loadRecentEvents(input: LoadRecentEventsInput): Promise<AgentSessionEvent[]> {
    const maxEvents = Math.min(input.maxEvents ?? AGENT_SESSION_DEFAULT_MAX_RECENT_EVENTS, AGENT_SESSION_HARD_MAX_RECENT_EVENTS);
    const maxAgeMs = input.maxAgeMs ?? AGENT_SESSION_DEFAULT_MAX_AGE_MS;
    const cutoffIso = new Date(Date.now() - maxAgeMs).toISOString().slice(0, 23);

    const rows = await safeQueryRows<Record<string, unknown>>(
      `SELECT * FROM \`${EVENTS_TABLE}\`
       WHERE session_id = ? AND occurred_at >= ?
       ORDER BY occurred_at DESC, seq DESC
       LIMIT ?`,
      [input.sessionId, cutoffIso, maxEvents]
    );
    if (!rows.ok) return [];
    return rows.rows.map(eventRowToContract).reverse(); // ascending occurredAt order for the caller.
  }

  async function loadAllEvents(sessionId: string): Promise<AgentSessionEvent[]> {
    const rows = await safeQueryRows<Record<string, unknown>>(
      `SELECT * FROM \`${EVENTS_TABLE}\` WHERE session_id = ? ORDER BY occurred_at ASC, seq ASC`,
      [sessionId]
    );
    if (!rows.ok) return [];
    return rows.rows.map(eventRowToContract);
  }

  async function loadSummary(sessionId: string): Promise<AgentSessionSummary | null> {
    const rows = await safeQueryRows<Record<string, unknown>>(
      `SELECT summary_json, summary_version FROM \`${SESSIONS_TABLE}\` WHERE id = ? LIMIT 1`,
      [sessionId]
    );
    if (!rows.ok || rows.rows.length === 0) return null;
    const row = rows.rows[0];
    if (!row.summary_json) return null;
    const summary = asJsonRecord(row.summary_json) as unknown as AgentSessionSummary;
    return { ...summary, version: Number(row.summary_version ?? 0) };
  }

  async function rebuildSummary(sessionId: string): Promise<AgentSessionSummary> {
    return withConnection(async (connection) => {
      const session = await findSessionById(connection, sessionId);
      const conversationId = session?.conversationId ?? 0;
      const allEvents = await loadAllEvents(sessionId);
      const projected = projectAgentSessionSummary(sessionId, conversationId, allEvents);

      // Optimistic-concurrency style CAS, mirroring work/repository.ts's
      // expectedVersion pattern: read current version, write with
      // version = version + 1 guarded by a WHERE on the version we read.
      // A lost race here just means the summary gets rebuilt again on the
      // next call - it is always reconstructible, never a correctness bug.
      const [currentRows] = await connection.execute<RowDataPacket[]>(
        `SELECT summary_version FROM \`${SESSIONS_TABLE}\` WHERE id = ? LIMIT 1`,
        [sessionId]
      );
      const currentVersion = currentRows[0] ? Number((currentRows[0] as Record<string, unknown>).summary_version ?? 0) : 0;
      const nextVersion = currentVersion + 1;
      const stored: AgentSessionSummary = { ...projected, version: nextVersion };

      await connection.execute(
        `UPDATE \`${SESSIONS_TABLE}\`
         SET summary_json = ?, summary_version = ?, summary_updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND summary_version = ?`,
        [JSON.stringify(stored), nextVersion, sessionId, currentVersion]
      );

      return stored;
    });
  }

  return { ensureSession, appendEvent, loadSession, loadSessionForConversation, loadRecentEvents, loadSummary, rebuildSummary };
}
