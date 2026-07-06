import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { safeExecute, safeQueryRows, withTransaction } from "@/lib/db";
import { REQUEST_FACT_STATUSES } from "./constants";
import type { RequestFactStatus } from "./constants";
import type { ChangeRequestFactStatusResult, RequestFact, UpsertRequestFactInput, UpsertRequestFactResult } from "./types";

export const REQUEST_FACT_TABLE = "crm_request_facts";

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
  return null;
}

function parseValueJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function rowToRequestFact(row: DbLikeRow): RequestFact {
  const status = asText(row.status);
  return {
    factId: asText(row.fact_id) ?? "",
    requestId: asText(row.request_id) ?? "",
    factKey: asText(row.fact_key) ?? "",
    value: parseValueJson(row.value_json),
    status: status && (REQUEST_FACT_STATUSES as readonly string[]).includes(status) ? (status as RequestFactStatus) : "inferred",
    sourceMessageId: asText(row.source_message_id),
    sourceToolExecutionId: asText(row.source_tool_execution_id),
    confidence: asNumber(row.confidence),
    createdAt: asDateTimeIso(row.created_at) ?? "",
    updatedAt: asDateTimeIso(row.updated_at) ?? "",
    supersededAt: asDateTimeIso(row.superseded_at)
  };
}

export async function getActiveRequestFact(requestId: string, factKey: string): Promise<RequestFact | null> {
  const result = await safeQueryRows<DbLikeRow>(
    `SELECT * FROM \`${REQUEST_FACT_TABLE}\` WHERE request_id = ? AND fact_key = ? AND superseded_at IS NULL LIMIT 1`,
    [requestId, factKey]
  );
  if (!result.ok || !result.rows[0]) return null;
  return rowToRequestFact(result.rows[0]);
}

export async function listActiveRequestFacts(requestId: string): Promise<RequestFact[]> {
  const result = await safeQueryRows<DbLikeRow>(
    `SELECT * FROM \`${REQUEST_FACT_TABLE}\` WHERE request_id = ? AND superseded_at IS NULL ORDER BY fact_key ASC`,
    [requestId]
  );
  if (!result.ok) return [];
  return result.rows.map((row) => rowToRequestFact(row));
}

export async function listRequestFactHistory(requestId: string, factKey: string): Promise<RequestFact[]> {
  const result = await safeQueryRows<DbLikeRow>(
    `SELECT * FROM \`${REQUEST_FACT_TABLE}\` WHERE request_id = ? AND fact_key = ? ORDER BY created_at ASC, id ASC`,
    [requestId, factKey]
  );
  if (!result.ok) return [];
  return result.rows.map((row) => rowToRequestFact(row));
}

/**
 * Never updates the current value in place: inside one transaction, the
 * active row (if any) is superseded and a fresh version is inserted. The DB
 * unique key (request_id, fact_key, active_marker) makes a concurrent double
 * insert impossible - the loser gets a conflict, never a silent overwrite.
 */
export async function upsertRequestFact(input: UpsertRequestFactInput): Promise<UpsertRequestFactResult> {
  const factId = `fact-${randomUUID()}`;
  const status = input.status ?? "inferred";

  try {
    const versioned = await withTransaction(async (connection) => {
      const [superseded] = await connection.execute<ResultSetHeader>(
        `UPDATE \`${REQUEST_FACT_TABLE}\`
            SET superseded_at = CURRENT_TIMESTAMP(3), status = 'superseded', updated_at = CURRENT_TIMESTAMP(3)
          WHERE request_id = ? AND fact_key = ? AND superseded_at IS NULL`,
        [input.requestId, input.factKey]
      );

      await connection.execute<ResultSetHeader>(
        `INSERT INTO \`${REQUEST_FACT_TABLE}\` (
            fact_id, request_id, fact_key, value_json, status,
            source_message_id, source_tool_execution_id, confidence
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          factId,
          input.requestId,
          input.factKey,
          JSON.stringify(input.value ?? null),
          status,
          input.sourceMessageId ?? null,
          input.sourceToolExecutionId ?? null,
          input.confidence ?? null
        ]
      );

      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT * FROM \`${REQUEST_FACT_TABLE}\` WHERE fact_id = ? LIMIT 1`,
        [factId]
      );
      return { hadPrevious: superseded.affectedRows > 0, row: rows[0] as DbLikeRow | undefined };
    });

    if (!versioned.row) return { ok: false, status: "error", fact: null, warning: "request_fact_reload_failed" };
    return { ok: true, status: versioned.hadPrevious ? "versioned" : "created", fact: rowToRequestFact(versioned.row) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isDuplicate = /duplicate entry/i.test(message);
    return { ok: false, status: isDuplicate ? "conflict" : "error", fact: null, warning: message };
  }
}

/** CAS status move on the ACTIVE row only; the value never changes here. */
async function changeActiveFactStatus(
  requestId: string,
  factKey: string,
  toStatus: RequestFactStatus,
  fromStatuses: readonly RequestFactStatus[],
  alsoSupersede = false
): Promise<ChangeRequestFactStatusResult> {
  const placeholders = fromStatuses.map(() => "?").join(",");
  const update = await safeExecute(
    `UPDATE \`${REQUEST_FACT_TABLE}\`
        SET status = ?, ${alsoSupersede ? "superseded_at = CURRENT_TIMESTAMP(3)," : ""} updated_at = CURRENT_TIMESTAMP(3)
      WHERE request_id = ? AND fact_key = ? AND superseded_at IS NULL AND status IN (${placeholders})`,
    [toStatus, requestId, factKey, ...fromStatuses]
  );

  if (!update.ok) return { ok: false, status: "error", fact: null, warning: update.error };

  if (update.affectedRows <= 0) {
    const current = await getActiveRequestFact(requestId, factKey);
    if (!current) return { ok: false, status: "not_found", fact: null, warning: `No active fact ${factKey} for request ${requestId}.` };
    return {
      ok: false,
      status: "conflict",
      fact: current,
      warning: `Active fact ${factKey} is in status ${current.status}, expected one of: ${fromStatuses.join(", ")}.`
    };
  }

  if (alsoSupersede) {
    // The row left the active slot; read it back through history.
    const history = await listRequestFactHistory(requestId, factKey);
    const rejected = [...history].reverse().find((fact) => fact.status === toStatus);
    if (!rejected) return { ok: false, status: "error", fact: null, warning: "request_fact_reload_failed" };
    return { ok: true, status: "updated", fact: rejected };
  }

  const fact = await getActiveRequestFact(requestId, factKey);
  if (!fact) return { ok: false, status: "error", fact: null, warning: "request_fact_reload_failed" };
  return { ok: true, status: "updated", fact };
}

export async function confirmRequestFact(requestId: string, factKey: string): Promise<ChangeRequestFactStatusResult> {
  return changeActiveFactStatus(requestId, factKey, "confirmed", ["inferred", "confirmed"]);
}

export async function verifyRequestFact(requestId: string, factKey: string): Promise<ChangeRequestFactStatusResult> {
  return changeActiveFactStatus(requestId, factKey, "verified", ["inferred", "confirmed", "verified"]);
}

/** Rejecting frees the active slot: a new value can be inserted afterwards. */
export async function rejectRequestFact(requestId: string, factKey: string): Promise<ChangeRequestFactStatusResult> {
  return changeActiveFactStatus(requestId, factKey, "rejected", ["inferred", "confirmed", "verified"], true);
}

/** Withdraws the current value without a replacement. */
export async function supersedeRequestFact(requestId: string, factKey: string): Promise<ChangeRequestFactStatusResult> {
  return changeActiveFactStatus(requestId, factKey, "superseded", ["inferred", "confirmed", "verified", "rejected"], true);
}
