import { randomUUID } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { safeQueryRows, withTransaction } from "@/lib/db";
import { hashSignalValue, redactSignalValue } from "./redact";
import {
  IDENTITY_EVIDENCE_TERMINAL_STATUSES,
  type IdentityEvidenceRecord,
  type IdentityEvidenceStatus,
  type IdentityEvidenceTransitionResult,
  type RecordIdentityEvidenceInput,
  type RecordIdentityEvidenceResult
} from "./types";

const TABLE = "crm_customer_identity_evidence";
const DUPLICATE_ENTRY_ERRNO = 1062;

function isDuplicateEntryError(error: unknown) {
  return Boolean(error && typeof error === "object" && "errno" in error && (error as { errno?: number }).errno === DUPLICATE_ENTRY_ERRNO);
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
    return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
  }
  return new Date(0).toISOString();
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return toIso(value);
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function toMysqlDatetime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 23).replace("T", " ");
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function toRecord(row: Record<string, unknown>): IdentityEvidenceRecord {
  return {
    evidenceId: String(row.evidence_id),
    conversationId: String(row.conversation_id),
    messageId: toStringOrNull(row.message_id),
    correlationId: String(row.correlation_id),
    channel: String(row.channel),
    provider: String(row.provider),
    channelEvidence: (toStringOrNull(row.channel_evidence) as IdentityEvidenceRecord["channelEvidence"]) ?? null,
    signalType: row.signal_type as IdentityEvidenceRecord["signalType"],
    source: row.source as IdentityEvidenceRecord["source"],
    sourceRecordRef: toStringOrNull(row.source_record_ref),
    signalHash: toStringOrNull(row.signal_hash),
    signalDisplay: toStringOrNull(row.signal_display),
    masterCustomerId: toStringOrNull(row.master_customer_id),
    prestashopCustomerId: toStringOrNull(row.prestashop_customer_id),
    strength: row.strength as IdentityEvidenceRecord["strength"],
    status: row.status as IdentityEvidenceStatus,
    conflictGroupId: toStringOrNull(row.conflict_group_id),
    conflictCode: toStringOrNull(row.conflict_code),
    observedAt: toIso(row.observed_at),
    verifiedAt: toIsoOrNull(row.verified_at),
    supersededAt: toIsoOrNull(row.superseded_at),
    supersededByEvidenceId: toStringOrNull(row.superseded_by_evidence_id),
    staleAt: toIsoOrNull(row.stale_at),
    revokedAt: toIsoOrNull(row.revoked_at),
    metadata: parseMetadata(row.metadata_json),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

async function findByEvidenceIdOnConnection(connection: PoolConnection, evidenceId: string): Promise<IdentityEvidenceRecord | null> {
  const [rows] = await connection.execute<RowDataPacket[]>(`SELECT * FROM \`${TABLE}\` WHERE evidence_id = ? LIMIT 1`, [evidenceId]);
  return rows[0] ? toRecord(rows[0] as Record<string, unknown>) : null;
}

async function findByIdempotencyKeyOnConnection(connection: PoolConnection, idempotencyKey: string): Promise<IdentityEvidenceRecord | null> {
  const [rows] = await connection.execute<RowDataPacket[]>(`SELECT * FROM \`${TABLE}\` WHERE idempotency_key = ? LIMIT 1`, [idempotencyKey]);
  return rows[0] ? toRecord(rows[0] as Record<string, unknown>) : null;
}

/** Row-locked (PARTE 19) - callers must already be inside the same transaction. At most one row is expected in normal operation; returns every non-terminal row defensively. */
async function findCurrentForSignalForUpdate(
  connection: PoolConnection,
  conversationId: string,
  signalType: string
): Promise<IdentityEvidenceRecord[]> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT * FROM \`${TABLE}\` WHERE conversation_id = ? AND signal_type = ? AND status NOT IN ('SUPERSEDED', 'REVOKED') ORDER BY id DESC FOR UPDATE`,
    [conversationId, signalType]
  );
  return rows.map((row) => toRecord(row as Record<string, unknown>));
}

function deriveInitialStatus(input: RecordIdentityEvidenceInput): IdentityEvidenceStatus {
  if (input.conflictGroupId || input.strength === "conflict") return "CONFLICTED";
  if (input.verified || input.strength === "verified") return "VERIFIED";
  if (input.strength === "strong" || input.strength === "candidate") return "CANDIDATE";
  return "OBSERVED";
}

async function insertRow(
  connection: PoolConnection,
  input: RecordIdentityEvidenceInput,
  status: IdentityEvidenceStatus,
  evidenceId: string,
  idempotencyKey: string,
  signalHash: string | null,
  signalDisplay: string | null
): Promise<ResultSetHeader> {
  const [result] = await connection.execute<ResultSetHeader>(
    `
      INSERT INTO \`${TABLE}\` (
        evidence_id, conversation_id, message_id, correlation_id,
        channel, provider, channel_evidence,
        signal_type, source, source_record_ref, signal_hash, signal_display,
        master_customer_id, prestashop_customer_id,
        strength, status,
        conflict_group_id, conflict_code,
        observed_at, verified_at,
        idempotency_key, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      evidenceId,
      input.conversationId,
      input.messageId ?? null,
      input.correlationId,
      input.channel,
      input.provider,
      input.channelEvidence ?? null,
      input.signalType,
      input.source,
      input.sourceRecordRef ?? null,
      signalHash,
      signalDisplay,
      input.masterCustomerId ?? null,
      input.prestashopCustomerId ?? null,
      input.strength,
      status,
      input.conflictGroupId ?? null,
      input.conflictCode ?? null,
      toMysqlDatetime(input.observedAt),
      status === "VERIFIED" ? toMysqlDatetime(input.observedAt) : null,
      idempotencyKey,
      JSON.stringify(input.metadata ?? {})
    ]
  );
  return result;
}

/**
 * PARTE 5/18/19: the only write path that inserts a row. Idempotent on
 * (conversationId, messageId, signalType, sourceRecordRef, normalized
 * value) - a replay of the same inbound never creates a second row. When
 * the same (conversationId, signalType) already has a current (non-
 * terminal) row for a DIFFERENT value, that row is transactionally
 * SUPERSEDED before the new one is inserted - never a silent overwrite.
 * Row-locks the current row(s) for that signal for the duration of the
 * transaction so two concurrent corrections serialize instead of racing.
 */
export async function recordIdentityEvidence(input: RecordIdentityEvidenceInput): Promise<RecordIdentityEvidenceResult> {
  const signalHash = hashSignalValue(input.normalizedSignalValue ?? null) ?? (input.sourceRecordRef ? hashSignalValue(input.sourceRecordRef) : null) ?? (input.prestashopCustomerId ? hashSignalValue(input.prestashopCustomerId) : null);
  const signalDisplay = redactSignalValue(input.normalizedSignalValue ?? input.sourceRecordRef ?? input.prestashopCustomerId ?? null);
  const comparisonKey = input.normalizedSignalValue ?? input.sourceRecordRef ?? input.prestashopCustomerId ?? input.masterCustomerId ?? null;
  const idempotencyKey = hashSignalValue(
    `${input.conversationId}|${input.messageId ?? "none"}|${input.signalType}|${input.sourceRecordRef ?? "none"}|${comparisonKey ?? "none"}`
  )!;
  const forceInsert = deriveInitialStatus(input) === "CONFLICTED";

  try {
    return await withTransaction(async (connection) => {
      const existingByIdempotency = await findByIdempotencyKeyOnConnection(connection, idempotencyKey);
      if (existingByIdempotency) {
        return { ok: true, status: "duplicate", record: existingByIdempotency };
      }

      const currentRows = await findCurrentForSignalForUpdate(connection, input.conversationId, input.signalType);
      const currentMatchingValue = currentRows.find((row) => row.signalHash !== null && row.signalHash === signalHash);

      if (currentMatchingValue && !forceInsert) {
        // Same value already current for this signal on this conversation -
        // a genuine repeat observation, not a correction. No new row.
        return { ok: true, status: "unchanged", record: currentMatchingValue };
      }

      const evidenceId = randomUUID();
      const initialStatus = deriveInitialStatus(input);

      let insertResult: ResultSetHeader;
      try {
        insertResult = await insertRow(connection, input, initialStatus, evidenceId, idempotencyKey, signalHash, signalDisplay);
      } catch (error) {
        if (isDuplicateEntryError(error)) {
          const raced = await findByIdempotencyKeyOnConnection(connection, idempotencyKey);
          if (raced) return { ok: true, status: "duplicate", record: raced };
        }
        throw error;
      }
      if (insertResult.affectedRows <= 0) {
        return { ok: false, status: "error", error: "identity_evidence_insert_failed" };
      }

      if (currentRows.length > 0) {
        await connection.execute(
          `UPDATE \`${TABLE}\` SET status = 'SUPERSEDED', superseded_at = CURRENT_TIMESTAMP(3), superseded_by_evidence_id = ?
           WHERE evidence_id IN (${currentRows.map(() => "?").join(",")}) AND status NOT IN ('SUPERSEDED', 'REVOKED')`,
          [evidenceId, ...currentRows.map((row) => row.evidenceId)]
        );
      }

      const inserted = await findByEvidenceIdOnConnection(connection, evidenceId);
      if (!inserted) return { ok: false, status: "error", error: "identity_evidence_reload_failed" };
      return { ok: true, status: "created", record: inserted };
    });
  } catch (error) {
    return { ok: false, status: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

async function transitionStatus(
  evidenceId: string,
  from: readonly IdentityEvidenceStatus[],
  to: IdentityEvidenceStatus,
  extra: { verifiedAt?: string; staleAt?: string; revokedAt?: string; conflictGroupId?: string; conflictCode?: string } = {}
): Promise<IdentityEvidenceTransitionResult> {
  try {
    return await withTransaction(async (connection) => {
      const [rows] = await connection.execute<RowDataPacket[]>(`SELECT * FROM \`${TABLE}\` WHERE evidence_id = ? LIMIT 1 FOR UPDATE`, [evidenceId]);
      const current = rows[0] ? toRecord(rows[0] as Record<string, unknown>) : null;
      if (!current) return { ok: false, error: "identity_evidence_not_found" };
      if (!from.includes(current.status)) {
        return { ok: false, error: `identity_evidence_invalid_transition:${current.status}->${to}` };
      }

      const assignments = ["status = ?"];
      const params: Array<string | null> = [to];
      if (extra.verifiedAt) {
        assignments.push("verified_at = ?");
        params.push(toMysqlDatetime(extra.verifiedAt));
      }
      if (extra.staleAt) {
        assignments.push("stale_at = ?");
        params.push(toMysqlDatetime(extra.staleAt));
      }
      if (extra.revokedAt) {
        assignments.push("revoked_at = ?");
        params.push(toMysqlDatetime(extra.revokedAt));
      }
      if (extra.conflictGroupId) {
        assignments.push("conflict_group_id = ?");
        params.push(extra.conflictGroupId);
      }
      if (extra.conflictCode) {
        assignments.push("conflict_code = ?");
        params.push(extra.conflictCode);
      }
      params.push(evidenceId);

      await connection.execute(`UPDATE \`${TABLE}\` SET ${assignments.join(", ")} WHERE evidence_id = ?`, params);
      const updated = await findByEvidenceIdOnConnection(connection, evidenceId);
      if (!updated) return { ok: false, error: "identity_evidence_reload_failed" };
      return { ok: true, record: updated };
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// PARTE 4 legal transitions. Never exported as a generic setStatus.
export async function markIdentityEvidenceVerified(evidenceId: string, verifiedAt: string): Promise<IdentityEvidenceTransitionResult> {
  return transitionStatus(evidenceId, ["OBSERVED", "CANDIDATE"], "VERIFIED", { verifiedAt });
}

export async function markIdentityEvidenceConflicted(
  evidenceId: string,
  conflictGroupId: string,
  conflictCode: string
): Promise<IdentityEvidenceTransitionResult> {
  return transitionStatus(evidenceId, ["OBSERVED", "CANDIDATE", "VERIFIED"], "CONFLICTED", { conflictGroupId, conflictCode });
}

export async function markIdentityEvidenceStale(evidenceId: string, staleAt: string): Promise<IdentityEvidenceTransitionResult> {
  return transitionStatus(evidenceId, ["OBSERVED", "CANDIDATE", "VERIFIED", "CONFLICTED"], "STALE", { staleAt });
}

export async function revokeIdentityEvidence(evidenceId: string, revokedAt: string): Promise<IdentityEvidenceTransitionResult> {
  return transitionStatus(evidenceId, ["OBSERVED", "CANDIDATE", "VERIFIED", "CONFLICTED", "STALE"], "REVOKED", { revokedAt });
}

export async function supersedeIdentityEvidence(evidenceId: string, supersededByEvidenceId: string): Promise<IdentityEvidenceTransitionResult> {
  try {
    return await withTransaction(async (connection) => {
      const [rows] = await connection.execute<RowDataPacket[]>(`SELECT * FROM \`${TABLE}\` WHERE evidence_id = ? LIMIT 1 FOR UPDATE`, [evidenceId]);
      const current = rows[0] ? toRecord(rows[0] as Record<string, unknown>) : null;
      if (!current) return { ok: false, error: "identity_evidence_not_found" };
      if (IDENTITY_EVIDENCE_TERMINAL_STATUSES.includes(current.status)) {
        return { ok: false, error: `identity_evidence_invalid_transition:${current.status}->SUPERSEDED` };
      }
      await connection.execute(
        `UPDATE \`${TABLE}\` SET status = 'SUPERSEDED', superseded_at = CURRENT_TIMESTAMP(3), superseded_by_evidence_id = ? WHERE evidence_id = ?`,
        [supersededByEvidenceId, evidenceId]
      );
      const updated = await findByEvidenceIdOnConnection(connection, evidenceId);
      if (!updated) return { ok: false, error: "identity_evidence_reload_failed" };
      return { ok: true, record: updated };
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------------------
// Read API (PARTE 16). Every function here is a plain, bounded SQL query -
// never a second decision engine. safeQueryRows never throws.
// ---------------------------------------------------------------------------

/**
 * SALES-AGENT-R2-ID-R2-A04. Same query as getCurrentEvidenceForConversation,
 * but surfaces a DB failure instead of swallowing it into an empty array -
 * a caller that must fail closed on a technical failure (the verification
 * policy, PARTE 19/IVP19) cannot tell "genuinely no evidence" apart from
 * "the query failed" through the plain variant below.
 */
export async function getCurrentEvidenceForConversationOrFail(
  conversationId: string
): Promise<{ ok: true; records: IdentityEvidenceRecord[] } | { ok: false; error: string }> {
  const result = await safeQueryRows<Record<string, unknown>>(
    `SELECT * FROM \`${TABLE}\` WHERE conversation_id = ? AND status NOT IN ('SUPERSEDED', 'REVOKED') ORDER BY signal_type ASC, id DESC`,
    [conversationId]
  );
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, records: result.rows.map(toRecord) };
}

export async function getCurrentEvidenceForConversation(conversationId: string): Promise<IdentityEvidenceRecord[]> {
  const result = await getCurrentEvidenceForConversationOrFail(conversationId);
  return result.ok ? result.records : [];
}

export async function getCurrentEvidenceForMasterCustomer(masterCustomerId: string): Promise<IdentityEvidenceRecord[]> {
  const result = await safeQueryRows<Record<string, unknown>>(
    `SELECT * FROM \`${TABLE}\` WHERE master_customer_id = ? AND status NOT IN ('SUPERSEDED', 'REVOKED') ORDER BY conversation_id ASC, signal_type ASC, id DESC`,
    [masterCustomerId]
  );
  return result.ok ? result.rows.map(toRecord) : [];
}

export async function getEvidenceBySignal(input: { signalType: string; sourceRecordRef: string }): Promise<IdentityEvidenceRecord[]> {
  const result = await safeQueryRows<Record<string, unknown>>(
    `SELECT * FROM \`${TABLE}\` WHERE signal_type = ? AND source_record_ref = ? ORDER BY id DESC`,
    [input.signalType, input.sourceRecordRef]
  );
  return result.ok ? result.rows.map(toRecord) : [];
}

export async function getUnresolvedEvidence(conversationId: string): Promise<IdentityEvidenceRecord[]> {
  const result = await safeQueryRows<Record<string, unknown>>(
    `SELECT * FROM \`${TABLE}\` WHERE conversation_id = ? AND master_customer_id IS NULL AND status IN ('OBSERVED', 'CANDIDATE') ORDER BY id DESC`,
    [conversationId]
  );
  return result.ok ? result.rows.map(toRecord) : [];
}

export async function getConflictEvidence(conflictGroupId: string): Promise<IdentityEvidenceRecord[]> {
  const result = await safeQueryRows<Record<string, unknown>>(`SELECT * FROM \`${TABLE}\` WHERE conflict_group_id = ? ORDER BY id ASC`, [
    conflictGroupId
  ]);
  return result.ok ? result.rows.map(toRecord) : [];
}

export async function getHistoricalEvidence(conversationId: string, signalType: string): Promise<IdentityEvidenceRecord[]> {
  const result = await safeQueryRows<Record<string, unknown>>(
    `SELECT * FROM \`${TABLE}\` WHERE conversation_id = ? AND signal_type = ? ORDER BY id ASC`,
    [conversationId, signalType]
  );
  return result.ok ? result.rows.map(toRecord) : [];
}

export async function getEvidenceById(evidenceId: string): Promise<IdentityEvidenceRecord | null> {
  const result = await safeQueryRows<Record<string, unknown>>(`SELECT * FROM \`${TABLE}\` WHERE evidence_id = ? LIMIT 1`, [evidenceId]);
  return result.ok && result.rows[0] ? toRecord(result.rows[0]) : null;
}
