import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { withConnection, hasTable } from "../../../db";
import { CRM_AGENT_ACTIONS_TABLE, COMMERCIAL_AGENT_ACTION_QUEUE_DEFAULT_FEATURE_FLAGS } from "./constants";
import { buildAgentActionStorageRow, deserializeAgentActionRow } from "./serializeAgentAction";
import { validateAgentAction } from "./validateAgentAction";
import type {
  AgentActionQueueConnection,
  AgentActionQueueDatabaseAdapter,
  CrmAgentAction,
  PersistAgentActionResult,
  PersistAgentActionStatus
} from "./types";

function toIsoString(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function toMysqlDateTime(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const date = value instanceof Date ? value : new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date(0) : date;
  return safeDate.toISOString().slice(0, 19).replace("T", " ");
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))];
}

type ExecuteValues = Parameters<PoolConnection["execute"]>[1];

function toExecuteValues(values: unknown[]): ExecuteValues {
  return values as unknown as ExecuteValues;
}

function sanitizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/\b(sk-[A-Za-z0-9_-]+)\b/gi, "[redacted]")
    .replace(/\b(authorization|api[-_]?key|token|secret|password|cookie)\s*[:=]?\s*[^\s,;]+/gi, "$1=[redacted]")
    .trim();
}

/**
 * ACS-R1-05-T06.2 (second correction, section 11): identifies MariaDB/MySQL's
 * real duplicate-key error (mysql2 surfaces it as `error.code === "ER_DUP_ENTRY"`)
 * so it can be recovered from specifically - never used to swallow any other
 * kind of persistence error, which must keep surfacing as "failed".
 */
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ER_DUP_ENTRY";
}

async function defaultHasTable(tableName: string) {
  try {
    return await hasTable(tableName);
  } catch {
    return false;
  }
}

function normalizeFeatureFlags(featureFlags?: Partial<typeof COMMERCIAL_AGENT_ACTION_QUEUE_DEFAULT_FEATURE_FLAGS> | null) {
  return {
    queueEnabled: featureFlags?.queueEnabled ?? COMMERCIAL_AGENT_ACTION_QUEUE_DEFAULT_FEATURE_FLAGS.queueEnabled,
    persistenceEnabled: featureFlags?.persistenceEnabled ?? COMMERCIAL_AGENT_ACTION_QUEUE_DEFAULT_FEATURE_FLAGS.persistenceEnabled
  };
}

async function loadExistingActionByIdempotencyKey(
  connection: AgentActionQueueConnection,
  idempotencyKey: string
): Promise<CrmAgentAction | null> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT * FROM ${CRM_AGENT_ACTIONS_TABLE} WHERE idempotency_key = ? LIMIT 1`,
    toExecuteValues([idempotencyKey])
  );
  const first = rows[0];
  if (!first) return null;
  return deserializeAgentActionRow(first);
}

async function insertAction(connection: AgentActionQueueConnection, action: CrmAgentAction, currentTime: string) {
  const row = buildAgentActionStorageRow(action);
  const [result] = await connection.execute<ResultSetHeader>(
    `
      INSERT INTO ${CRM_AGENT_ACTIONS_TABLE} (
        action_id,
        idempotency_key,
        opportunity_id,
        decision_id,
        decision_row_id,
        conversation_case_id,
        message_id,
        wa_id,
        channel,
        action_type,
        status,
        risk_level,
        approval_requirement,
        draft_payload_json,
        final_payload_json,
        execution_payload_json,
        draft_message,
        final_message,
        scheduled_for,
        expires_at,
        attempt_number,
        max_attempts,
        block_reasons_json,
        cancel_reason,
        failure_reason,
        policy_status,
        policy_notes_json,
        source,
        created_by,
        approved_by,
        approved_at,
        executed_at,
        cancelled_at,
        outbox_message_id,
        lifecycle_version,
        policy_version,
        runtime_version,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    toExecuteValues([
      row.action_id,
      row.idempotency_key,
      row.opportunity_id,
      row.decision_id,
      row.decision_row_id,
      row.conversation_case_id,
      row.message_id,
      row.wa_id,
      row.channel,
      row.action_type,
      row.status,
      row.risk_level,
      row.approval_requirement,
      JSON.stringify(row.draft_payload_json ?? null),
      JSON.stringify(row.final_payload_json ?? null),
      JSON.stringify(row.execution_payload_json ?? null),
      row.draft_message,
      row.final_message,
      toMysqlDateTime(row.scheduled_for),
      toMysqlDateTime(row.expires_at),
      row.attempt_number,
      row.max_attempts,
      JSON.stringify(row.block_reasons_json ?? []),
      row.cancel_reason,
      row.failure_reason,
      row.policy_status,
      JSON.stringify(row.policy_notes_json ?? []),
      row.source,
      row.created_by,
      row.approved_by,
      toMysqlDateTime(row.approved_at),
      toMysqlDateTime(row.executed_at),
      toMysqlDateTime(row.cancelled_at),
      row.outbox_message_id,
      row.lifecycle_version,
      row.policy_version,
      row.runtime_version,
      toMysqlDateTime(row.created_at ?? currentTime),
      toMysqlDateTime(row.updated_at ?? currentTime)
    ])
  );
  return result.insertId ?? null;
}

async function updateExistingAction(connection: AgentActionQueueConnection, action: CrmAgentAction, currentTime: string, existingRowId: number | null) {
  const row = buildAgentActionStorageRow({
    ...action,
    id: existingRowId,
    updatedAt: currentTime
  });
  await connection.execute(
    `
      UPDATE ${CRM_AGENT_ACTIONS_TABLE}
      SET
        opportunity_id = ?,
        decision_id = ?,
        decision_row_id = ?,
        conversation_case_id = ?,
        message_id = ?,
        wa_id = ?,
        channel = ?,
        action_type = ?,
        status = ?,
        risk_level = ?,
        approval_requirement = ?,
        draft_payload_json = ?,
        final_payload_json = ?,
        execution_payload_json = ?,
        draft_message = ?,
        final_message = ?,
        scheduled_for = ?,
        expires_at = ?,
        attempt_number = ?,
        max_attempts = ?,
        block_reasons_json = ?,
        cancel_reason = ?,
        failure_reason = ?,
        policy_status = ?,
        policy_notes_json = ?,
        source = ?,
        created_by = ?,
        approved_by = ?,
        approved_at = ?,
        executed_at = ?,
        cancelled_at = ?,
        outbox_message_id = ?,
        lifecycle_version = ?,
        policy_version = ?,
        runtime_version = ?,
        updated_at = ?
      WHERE idempotency_key = ?
    `,
    toExecuteValues([
      row.opportunity_id,
      row.decision_id,
      row.decision_row_id,
      row.conversation_case_id,
      row.message_id,
      row.wa_id,
      row.channel,
      row.action_type,
      row.status,
      row.risk_level,
      row.approval_requirement,
      JSON.stringify(row.draft_payload_json ?? null),
      JSON.stringify(row.final_payload_json ?? null),
      JSON.stringify(row.execution_payload_json ?? null),
      row.draft_message,
      row.final_message,
      toMysqlDateTime(row.scheduled_for),
      toMysqlDateTime(row.expires_at),
      row.attempt_number,
      row.max_attempts,
      JSON.stringify(row.block_reasons_json ?? []),
      row.cancel_reason,
      row.failure_reason,
      row.policy_status,
      JSON.stringify(row.policy_notes_json ?? []),
      row.source,
      row.created_by,
      row.approved_by,
      toMysqlDateTime(row.approved_at),
      toMysqlDateTime(row.executed_at),
      toMysqlDateTime(row.cancelled_at),
      row.outbox_message_id,
      row.lifecycle_version,
      row.policy_version,
      row.runtime_version,
      toMysqlDateTime(row.updated_at ?? currentTime),
      action.idempotencyKey
    ])
  );
}

function normalizeResult(
  status: PersistAgentActionStatus,
  action: CrmAgentAction,
  rowId: number | null,
  error: string | null,
  dryRun: boolean,
  warnings: string[]
): PersistAgentActionResult {
  return {
    status,
    action,
    rowId,
    error,
    dryRun,
    warnings: uniqueStrings(warnings)
  };
}

export async function persistAgentAction(
  input: {
    action: CrmAgentAction;
    currentTime: string | Date;
    featureFlags?: Partial<typeof COMMERCIAL_AGENT_ACTION_QUEUE_DEFAULT_FEATURE_FLAGS> | null;
    dataAccess?: AgentActionQueueDatabaseAdapter | null;
  }
): Promise<PersistAgentActionResult> {
  const currentTime = toIsoString(input.currentTime);
  const featureFlags = normalizeFeatureFlags(input.featureFlags);
  const validation = validateAgentAction(input.action);
  const validatedAction = validation.action ?? input.action;

  if (!validation.valid || !validation.action) {
    return normalizeResult("failed", validatedAction, null, validation.reason, true, validation.warnings);
  }

  if (!featureFlags.queueEnabled) {
    return normalizeResult("skipped_by_flag", validation.action, null, "Agent action queue is disabled.", true, validation.warnings);
  }

  if (!featureFlags.persistenceEnabled) {
    return normalizeResult("dry_run", validation.action, null, "Agent action persistence is disabled.", true, validation.warnings);
  }

  const adapter = input.dataAccess ?? {
    hasTable: defaultHasTable,
    withConnection: async <T>(fn: (connection: AgentActionQueueConnection) => Promise<T>) => withConnection((connection) => fn(connection))
  };

  try {
    const tableExists = adapter.hasTable ? await adapter.hasTable(CRM_AGENT_ACTIONS_TABLE) : await defaultHasTable(CRM_AGENT_ACTIONS_TABLE);
    if (!tableExists) {
      return normalizeResult("failed", validation.action, null, "crm_agent_actions table is not available.", true, ["agent_action_queue_missing"]);
    }

    if (!adapter.withConnection) {
      return normalizeResult("failed", validation.action, null, "No connection adapter available.", true, ["agent_action_queue_missing_connection"]);
    }

    return await adapter.withConnection(async (connection) => {
      try {
        await connection.beginTransaction();
        const existing = await loadExistingActionByIdempotencyKey(connection, validation.action!.idempotencyKey);
        if (existing) {
          if (["executed", "cancelled", "expired", "failed"].includes(existing.status)) {
            await connection.rollback();
            return normalizeResult("duplicate_ignored", existing, existing.id, "Existing terminal action was left unchanged.", false, validation.warnings);
          }

          await updateExistingAction(connection, validation.action!, currentTime, existing.id);
          await connection.commit();
          return normalizeResult("updated_existing", {
            ...validation.action!,
            id: existing.id,
            createdAt: existing.createdAt ?? validation.action!.createdAt,
            updatedAt: currentTime
          }, existing.id, null, false, validation.warnings);
        }

        try {
          const rowId = await insertAction(connection, validation.action!, currentTime);
          await connection.commit();
          return normalizeResult("inserted", {
            ...validation.action!,
            id: typeof rowId === "number" ? rowId : null,
            createdAt: validation.action!.createdAt ?? currentTime,
            updatedAt: currentTime
          }, typeof rowId === "number" ? rowId : null, null, false, validation.warnings);
        } catch (insertError) {
          if (!isDuplicateKeyError(insertError)) throw insertError;
          /**
           * ACS-R1-05-T06.2 (second correction, section 11): our own SELECT
           * above found nothing, but a concurrent transaction won the
           * `uq_crm_agent_actions_idempotency_key` race (migrations/005)
           * between that SELECT and this INSERT. The row now exists - this
           * is not a real persistence failure, so it must never surface as
           * one (a caller like dispatchFallbackAction treats "failed" as
           * "nothing happened", which would wrongly report continuity
           * failure for a turn a concurrent call actually handled).
           * Re-select and resolve to the winner's row exactly like the
           * "existing" branch above, never re-writing what it wrote.
           */
          const winner = await loadExistingActionByIdempotencyKey(connection, validation.action!.idempotencyKey);
          await connection.rollback();
          if (!winner) {
            return normalizeResult(
              "failed",
              validation.action!,
              null,
              "Concurrent insert reported a duplicate idempotency key but the row could not be reselected.",
              false,
              validation.warnings
            );
          }
          return normalizeResult("duplicate_ignored", winner, winner.id, "Existing action from a concurrent insert was reused.", false, validation.warnings);
        }
      } catch (error) {
        try {
          await connection.rollback();
        } catch {
          // ignore rollback issues
        }
        return normalizeResult("failed", validation.action!, null, sanitizeError(error), false, validation.warnings);
      }
    });
  } catch (error) {
    return normalizeResult("failed", validation.action, null, sanitizeError(error), false, validation.warnings);
  }
}
