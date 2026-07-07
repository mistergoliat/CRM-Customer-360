import { createHash } from "node:crypto";
import { safeExecute, safeQueryRows } from "@/lib/db";
import { TURN_PLAN_STATUSES, TURN_PLANNER_SCHEMA_VERSION } from "./constants";
import type { TurnPlanStatus } from "./constants";
import type { MarkTurnPlanResult, PersistTurnPlanInput, PersistTurnPlanResult, TurnPlan, TurnPlanRecord } from "./turnPlanTypes";

export const TURN_PLAN_TABLE = "crm_turn_plans";

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

function parsePlanJson(value: unknown): TurnPlan | null {
  const parsed =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : typeof value === "string" && value.trim()
        ? (() => {
            try {
              const result = JSON.parse(value);
              return result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>) : null;
            } catch {
              return null;
            }
          })()
        : null;
  if (!parsed || parsed.contractName !== "TurnPlan") return null;
  return parsed as unknown as TurnPlan;
}

function rowToTurnPlanRecord(row: DbLikeRow): TurnPlanRecord | null {
  const plan = parsePlanJson(row.plan_json);
  if (!plan) return null;
  const status = asText(row.status);
  return {
    turnPlanId: asText(row.turn_plan_id) ?? "",
    correlationId: asText(row.correlation_id) ?? "",
    conversationId: asNumber(row.conversation_id) ?? 0,
    inboundMessageId: asText(row.inbound_message_id) ?? "",
    plannerSchemaVersion: asText(row.planner_schema_version) ?? "",
    inputHash: asText(row.input_hash) ?? "",
    status: status && (TURN_PLAN_STATUSES as readonly string[]).includes(status) ? (status as TurnPlanStatus) : "planned",
    plan,
    errorCode: asText(row.error_code),
    createdAt: asDateTimeIso(row.created_at) ?? "",
    updatedAt: asDateTimeIso(row.updated_at) ?? ""
  };
}

/**
 * Deterministic identity: the same inbound message under the same planner
 * schema always maps to the same turn_plan_id, so concurrent retries compute
 * identical ids and the INSERT IGNORE race is harmless. This is also what
 * keeps request creation_keys (sha256(turnPlanId + detectionId)) stable.
 */
export function buildTurnPlanId(inboundMessageId: string, plannerSchemaVersion: string = TURN_PLANNER_SCHEMA_VERSION): string {
  const digest = createHash("sha256").update(`${inboundMessageId}:${plannerSchemaVersion}`).digest("hex");
  return `turnplan-${digest.slice(0, 32)}`;
}

/** Canonical hash of the planner input, for audit/diagnosis of plan reuse. */
export function buildTurnPlanInputHash(value: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? "null";
  } catch {
    serialized = String(value);
  }
  return createHash("sha256").update(serialized).digest("hex");
}

export async function loadTurnPlanById(turnPlanId: string): Promise<TurnPlanRecord | null> {
  const result = await safeQueryRows<DbLikeRow>(`SELECT * FROM \`${TURN_PLAN_TABLE}\` WHERE turn_plan_id = ? LIMIT 1`, [turnPlanId]);
  if (!result.ok || !result.rows[0]) return null;
  return rowToTurnPlanRecord(result.rows[0]);
}

/**
 * The retry lookup: a re-processed inbound finds its existing plan here and
 * must NOT invoke the planner again. A different planner schema version
 * misses on purpose (new contract, new plan).
 */
export async function loadExistingTurnPlan(
  inboundMessageId: string,
  plannerSchemaVersion: string = TURN_PLANNER_SCHEMA_VERSION
): Promise<TurnPlanRecord | null> {
  const result = await safeQueryRows<DbLikeRow>(
    `SELECT * FROM \`${TURN_PLAN_TABLE}\` WHERE inbound_message_id = ? AND planner_schema_version = ? LIMIT 1`,
    [inboundMessageId, plannerSchemaVersion]
  );
  if (!result.ok || !result.rows[0]) return null;
  return rowToTurnPlanRecord(result.rows[0]);
}

export async function persistTurnPlan(input: PersistTurnPlanInput): Promise<PersistTurnPlanResult> {
  const plannerSchemaVersion = input.plan.schemaVersion;
  const existing = await loadExistingTurnPlan(input.inboundMessageId, plannerSchemaVersion);
  if (existing) return { ok: true, status: "duplicate", record: existing };

  const turnPlanId = buildTurnPlanId(input.inboundMessageId, plannerSchemaVersion);
  const insert = await safeExecute(
    `INSERT IGNORE INTO \`${TURN_PLAN_TABLE}\` (
        turn_plan_id, correlation_id, conversation_id, inbound_message_id,
        planner_schema_version, input_hash, status, plan_json
      ) VALUES (?, ?, ?, ?, ?, ?, 'planned', ?)`,
    [
      turnPlanId,
      input.correlationId,
      input.conversationId,
      input.inboundMessageId,
      plannerSchemaVersion,
      input.inputHash,
      JSON.stringify(input.plan)
    ]
  );

  if (!insert.ok) {
    return { ok: false, status: "error", record: null, warning: insert.error };
  }

  const record = await loadTurnPlanById(turnPlanId);
  if (!record) return { ok: false, status: "error", record: null, warning: "turn_plan_reload_failed" };
  return { ok: true, status: insert.affectedRows > 0 ? "created" : "duplicate", record };
}

/** CAS status move; affectedRows = 0 is a conflict, never reported as success. */
async function markTurnPlanStatus(
  turnPlanId: string,
  toStatus: TurnPlanStatus,
  fromStatuses: readonly TurnPlanStatus[],
  errorCode: string | null = null
): Promise<MarkTurnPlanResult> {
  const placeholders = fromStatuses.map(() => "?").join(",");
  const update = await safeExecute(
    `UPDATE \`${TURN_PLAN_TABLE}\`
        SET status = ?, error_code = ?, updated_at = CURRENT_TIMESTAMP(3)
      WHERE turn_plan_id = ? AND status IN (${placeholders})`,
    [toStatus, errorCode, turnPlanId, ...fromStatuses]
  );

  if (!update.ok) return { ok: false, status: "error", record: null, warning: update.error };

  const record = await loadTurnPlanById(turnPlanId);
  if (update.affectedRows <= 0) {
    if (!record) return { ok: false, status: "not_found", record: null, warning: `Turn plan ${turnPlanId} does not exist.` };
    return {
      ok: false,
      status: "conflict",
      record,
      warning: `Turn plan ${turnPlanId} is in status ${record.status}, expected one of: ${fromStatuses.join(", ")}.`
    };
  }
  if (!record) return { ok: false, status: "error", record: null, warning: "turn_plan_reload_failed" };
  return { ok: true, status: "updated", record };
}

export async function markTurnPlanPartiallyExecuted(turnPlanId: string): Promise<MarkTurnPlanResult> {
  return markTurnPlanStatus(turnPlanId, "partially_executed", ["planned"]);
}

export async function markTurnPlanExecuted(turnPlanId: string): Promise<MarkTurnPlanResult> {
  return markTurnPlanStatus(turnPlanId, "executed", ["planned", "partially_executed"]);
}

export async function markTurnPlanFailed(turnPlanId: string, errorCode: string): Promise<MarkTurnPlanResult> {
  return markTurnPlanStatus(turnPlanId, "failed", ["planned", "partially_executed"], errorCode);
}
