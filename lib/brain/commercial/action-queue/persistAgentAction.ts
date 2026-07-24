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

/**
 * ACS-R1-05-T07. Action types that are the single durable reply to one
 * specific inbound customer message - never more than one per (conversation,
 * message) pair, regardless of which decision record authored it.
 */
const OUTBOX_BACKED_SINGLE_REPLY_ACTION_TYPES = new Set(["send_whatsapp_reply", "request_more_context"]);

/**
 * ACS-R1-05-T07 (found by tests/e2e/reactiveTurnRestartRecovery.e2e.test.ts,
 * T07-E3): buildAgentAction's idempotency_key digest includes decisionId,
 * which runCommercialOperationalLoop mints fresh on every cycle execution -
 * two genuinely concurrent runNativeAutonomousCycle runs for the identical
 * inbound message (e.g. a redelivered webhook processed twice before either
 * commits its own dedupe check) therefore produce two DIFFERENT idempotency
 * keys and, without this check, two separate action rows with two separate
 * outbox messages carrying identical content - a real duplicate send. This
 * is a secondary, content-independent match keyed on the one thing that IS
 * guaranteed stable across repeated processing of the same turn: which
 * inbound message this reply answers. Scoped to the single-reply-per-message
 * action types only, and opt-in via enforceSingleReplyPerMessage below -
 * every other action type/caller (proactive follow-up scheduling, quote
 * preparation, etc.) is not necessarily 1:1 with a single inbound message
 * and keeps its existing digest-only idempotency semantics unchanged.
 */
async function loadExistingSingleReplyActionForMessage(
  connection: AgentActionQueueConnection,
  action: CrmAgentAction
): Promise<CrmAgentAction | null> {
  if (!OUTBOX_BACKED_SINGLE_REPLY_ACTION_TYPES.has(action.actionType)) return null;
  const conversationCaseId = action.conversationCaseId;
  const messageId = action.messageId;
  if (conversationCaseId === null || messageId === null) return null;

  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT * FROM ${CRM_AGENT_ACTIONS_TABLE}
      WHERE conversation_case_id = ? AND message_id = ? AND action_type = ?
      ORDER BY id ASC LIMIT 1`,
    toExecuteValues([String(conversationCaseId), String(messageId), action.actionType])
  );
  const first = rows[0];
  if (!first) return null;
  return deserializeAgentActionRow(first);
}

/**
 * ACS-R1-05-T07. The secondary (conversation_case_id, message_id,
 * action_type) match above is itself vulnerable to the same
 * check-then-insert race it exists to close (two connections could both
 * find nothing and both insert) - there is no unique index to fall back on
 * for this scope (unlike idempotency_key), so a MySQL/MariaDB advisory lock
 * serializes concurrent persistAgentAction calls for the identical
 * (conversation, message, action_type) instead. Session-scoped: must run on
 * the same connection as the transaction it guards, and is always released
 * before that connection returns to the pool.
 */
function buildSingleReplyLockKey(action: CrmAgentAction, enforceSingleReplyPerMessage: boolean): string | null {
  if (!enforceSingleReplyPerMessage) return null;
  if (!OUTBOX_BACKED_SINGLE_REPLY_ACTION_TYPES.has(action.actionType)) return null;
  if (action.conversationCaseId === null || action.messageId === null) return null;
  return `crm-agent-action-reply:${action.conversationCaseId}:${action.messageId}:${action.actionType}`;
}

/**
 * ACS-R1-05.1-T02.3D. Same shape as buildSingleReplyLockKey, for the
 * analogous "at most one ACTIVE schedule_followup row per sequence"
 * invariant - migrations/027's active_followup_sequence_key generated
 * column/unique index is the ultimate backstop, but a proactive check-then-
 * insert under an advisory lock avoids surfacing that as a raw DB error on
 * the common (non-concurrent) path.
 */
function buildFollowUpSequenceLockKey(action: CrmAgentAction): string | null {
  if (action.actionType !== "schedule_followup") return null;
  if (!action.followUpSequenceKey) return null;
  return `crm-agent-action-followup-sequence:${action.followUpSequenceKey}`;
}

async function loadActiveFollowUpForSequence(connection: AgentActionQueueConnection, sequenceKey: string): Promise<CrmAgentAction | null> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT * FROM ${CRM_AGENT_ACTIONS_TABLE}
      WHERE followup_sequence_key = ? AND action_type = 'schedule_followup' AND status IN ('planned', 'requires_review', 'executing')
      ORDER BY id DESC LIMIT 1`,
    toExecuteValues([sequenceKey])
  );
  const first = rows[0];
  return first ? deserializeAgentActionRow(first) : null;
}

async function withOptionalSingleReplyLock<T>(connection: AgentActionQueueConnection, lockKey: string | null, fn: () => Promise<T>): Promise<T> {
  if (!lockKey) return fn();

  const [lockRows] = await connection.execute<RowDataPacket[]>("SELECT GET_LOCK(?, 10) AS acquired", toExecuteValues([lockKey]));
  const acquired = Number((lockRows[0] as { acquired?: unknown } | undefined)?.acquired) === 1;
  if (!acquired) {
    throw new Error(`persist_agent_action_lock_timeout:${lockKey}`);
  }

  try {
    return await fn();
  } finally {
    try {
      await connection.execute("SELECT RELEASE_LOCK(?)", toExecuteValues([lockKey]));
    } catch {
      // ignore release failures - MySQL/MariaDB releases session locks automatically when the connection closes
    }
  }
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
        followup_sequence_key,
        followup_configuration_source,
        followup_configuration_id,
        followup_configuration_version,
        followup_configuration_hash,
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      row.followup_sequence_key,
      row.followup_configuration_source,
      row.followup_configuration_id,
      row.followup_configuration_version,
      row.followup_configuration_hash,
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
        followup_sequence_key = ?,
        followup_configuration_source = ?,
        followup_configuration_id = ?,
        followup_configuration_version = ?,
        followup_configuration_hash = ?,
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
      row.followup_sequence_key,
      row.followup_configuration_source,
      row.followup_configuration_id,
      row.followup_configuration_version,
      row.followup_configuration_hash,
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
    /**
     * ACS-R1-05-T07. Opt-in only: additionally treats any existing action
     * for the same (conversation_case_id, message_id, action_type) as a
     * duplicate of this one, even when its idempotency_key digest differs
     * (e.g. because a concurrent cycle run minted a different decisionId for
     * the identical inbound message). Correct for "the one primary reply to
     * this message" callers (runCommercialExecutionBridge); wrong for
     * dispatchFallbackAction, whose idempotency key already scopes correctly
     * by fallbackClass and deliberately allows more than one fallback action
     * to answer the same message over time - defaults to false so every
     * existing caller keeps its current, unchanged semantics.
     */
    enforceSingleReplyPerMessage?: boolean;
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

    const enforceSingleReplyPerMessage = input.enforceSingleReplyPerMessage ?? false;
    const singleReplyLockKey = buildSingleReplyLockKey(validation.action, enforceSingleReplyPerMessage);
    // Never both non-null for the same action (schedule_followup is never an
    // OUTBOX_BACKED_SINGLE_REPLY_ACTION_TYPES member) - nesting is simple and
    // correct either way, since at most one of the two ever actually locks.
    const followUpSequenceLockKey = buildFollowUpSequenceLockKey(validation.action);

    return await adapter.withConnection((connection) =>
      withOptionalSingleReplyLock(connection, singleReplyLockKey, () =>
      withOptionalSingleReplyLock(connection, followUpSequenceLockKey, async () => {
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

        // ACS-R1-05-T07: a DIFFERENT cycle run (different decisionId/content
        // digest, same underlying inbound message) already answered this
        // exact message. Unlike the idempotency-key match above (the same
        // retried attempt, safe to refresh), this is always left untouched -
        // whichever run's action got here first is the one and only reply to
        // this message, regardless of its current status. Never
        // second-guessed or overwritten by a later/losing concurrent run.
        const existingForMessage = enforceSingleReplyPerMessage
          ? await loadExistingSingleReplyActionForMessage(connection, validation.action!)
          : null;
        if (existingForMessage) {
          await connection.rollback();
          return normalizeResult(
            "duplicate_ignored",
            existingForMessage,
            existingForMessage.id,
            "An existing action already answers this exact inbound message.",
            false,
            validation.warnings
          );
        }

        // ACS-R1-05.1-T02.3D: at most one ACTIVE schedule_followup row per
        // sequence (opportunity_id, or conversation_case_id fallback) - a
        // different attemptNumber/scheduledFor while one is still
        // planned/requires_review/executing is never a reason to create a
        // second row; the existing active one is reused/reported instead,
        // mirroring the legacy planner's active_followup_exists outcome.
        const existingActiveForSequence = followUpSequenceLockKey && validation.action!.followUpSequenceKey
          ? await loadActiveFollowUpForSequence(connection, validation.action!.followUpSequenceKey)
          : null;
        if (existingActiveForSequence) {
          await connection.rollback();
          return normalizeResult(
            "duplicate_ignored",
            existingActiveForSequence,
            existingActiveForSequence.id,
            "An active follow-up already exists for this sequence.",
            false,
            validation.warnings
          );
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
           * ACS-R1-05-T07 (fixes an incomplete ACS-R1-05-T06.2 second
           * correction): our own SELECT above found nothing, but a
           * concurrent transaction won the
           * `uq_crm_agent_actions_idempotency_key` race (migrations/005)
           * between that SELECT and this INSERT. The row now exists - this
           * is not a real persistence failure, so it must never surface as
           * one (a caller like dispatchFallbackAction treats "failed" as
           * "nothing happened", which would wrongly report continuity
           * failure for a turn a concurrent call actually handled).
           * Re-select and resolve to the winner's row exactly like the
           * "existing" branch above, never re-writing what it wrote.
           *
           * ROLLBACK MUST run before the re-select, never after: this
           * connection's transaction was opened with beginTransaction()
           * (REPEATABLE READ by default), so a plain SELECT still inside
           * that transaction reuses the snapshot taken before the winner's
           * INSERT committed and reliably returns nothing even though the
           * duplicate-key error proves the row now exists (confirmed with a
           * real concurrent MariaDB run - tests/commercial/
           * continuityConcurrency.test.ts). Rolling back first ends that
           * transaction so the re-select runs as its own fresh
           * (autocommit) read and actually observes the winner's committed row.
           */
          await connection.rollback();
          const winner =
            (await loadExistingActionByIdempotencyKey(connection, validation.action!.idempotencyKey)) ??
            // The duplicate could instead be migrations/027's
            // uq_crm_agent_actions_active_followup_sequence race (a
            // concurrent insert for the same sequence winning between our
            // own existingActiveForSequence SELECT and this INSERT) - the
            // idempotency-key digest differs (it includes createdAt), so
            // that lookup alone would find nothing for this specific race.
            (followUpSequenceLockKey && validation.action!.followUpSequenceKey
              ? await loadActiveFollowUpForSequence(connection, validation.action!.followUpSequenceKey)
              : null);
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
      }))
    );
  } catch (error) {
    return normalizeResult("failed", validation.action, null, sanitizeError(error), false, validation.warnings);
  }
}
