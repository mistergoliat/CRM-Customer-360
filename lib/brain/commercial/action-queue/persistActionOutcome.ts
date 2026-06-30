import { randomUUID } from "node:crypto";
import { safeQueryRows } from "../../../db";

const EXECUTIONS_TABLE = "crm_action_executions";
const OUTCOMES_TABLE = "crm_action_outcomes";
const ACTIONS_TABLE = "crm_agent_actions";

function toMysqlDatetime(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 23).replace("T", " ");
}

export type PersistExecutionInput = {
  actionId: string;
  actionRowId: number | null;
  outboxMessageId: number | null;
  outboxDedupeKey: string | null;
  attemptNumber: number;
  status: "requested" | "executing" | "succeeded" | "failed";
  requestedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  retryable?: boolean;
  providerRequestId?: string | null;
  correlationId?: string | null;
};

export type PersistOutcomeInput = {
  actionId: string;
  actionRowId: number | null;
  executionId: string;
  outboxMessageId: number | null;
  providerMessageId: string | null;
  outcomeType: "queued" | "sent" | "delivered" | "read" | "failed" | "unknown";
  occurredAt: string;
  providerEventJson?: Record<string, unknown> | null;
  metadataJson?: Record<string, unknown> | null;
};

export async function persistActionExecution(input: PersistExecutionInput): Promise<{ ok: boolean; executionId: string; warning?: string }> {
  const executionId = randomUUID();
  const result = await safeQueryRows(
    `INSERT INTO \`${EXECUTIONS_TABLE}\` (
      execution_id, action_id, action_row_id, outbox_message_id, outbox_dedupe_key,
      attempt_number, status, requested_at, started_at, completed_at,
      error_code, error_message, retryable, provider_request_id, correlation_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
    [
      executionId,
      input.actionId,
      input.actionRowId,
      input.outboxMessageId,
      input.outboxDedupeKey,
      input.attemptNumber,
      input.status,
      toMysqlDatetime(input.requestedAt),
      toMysqlDatetime(input.startedAt ?? null),
      toMysqlDatetime(input.completedAt ?? null),
      input.errorCode ?? null,
      input.errorMessage ?? null,
      input.retryable ? 1 : 0,
      input.providerRequestId ?? null,
      input.correlationId ?? null
    ]
  );
  if (!result.ok) return { ok: false, executionId, warning: result.error };
  return { ok: true, executionId };
}

export async function persistActionOutcome(input: PersistOutcomeInput): Promise<{ ok: boolean; outcomeId: string; warning?: string }> {
  const outcomeId = randomUUID();
  const result = await safeQueryRows(
    `INSERT INTO \`${OUTCOMES_TABLE}\` (
      outcome_id, action_id, action_row_id, execution_id, outbox_message_id,
      provider_message_id, outcome_type, occurred_at, provider_event_json, metadata_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
    [
      outcomeId,
      input.actionId,
      input.actionRowId,
      input.executionId,
      input.outboxMessageId,
      input.providerMessageId,
      input.outcomeType,
      toMysqlDatetime(input.occurredAt),
      input.providerEventJson ? JSON.stringify(input.providerEventJson) : null,
      input.metadataJson ? JSON.stringify(input.metadataJson) : null
    ]
  );
  if (!result.ok) return { ok: false, outcomeId, warning: result.error };
  return { ok: true, outcomeId };
}

/** Mark a crm_agent_action row as executed after its outbox message was sent. */
export async function markActionExecuted(
  actionId: string,
  outboxMessageId: number | null,
  providerMessageId: string | null,
  executedAt: string
): Promise<void> {
  await safeQueryRows(
    `UPDATE \`${ACTIONS_TABLE}\`
      SET status = 'executed',
          executed_at = ?,
          outbox_message_id = COALESCE(outbox_message_id, ?),
          updated_at = CURRENT_TIMESTAMP(3)
      WHERE action_id = ? AND status IN ('proposed','planned','approved')`,
    [toMysqlDatetime(executedAt), outboxMessageId, actionId]
  );
}

/** Mark a crm_agent_action row as failed after a terminal outbox failure. */
export async function markActionFailed(
  actionId: string,
  errorCode: string | null,
  errorMessage: string | null
): Promise<void> {
  await safeQueryRows(
    `UPDATE \`${ACTIONS_TABLE}\`
      SET status = 'failed',
          failure_reason = ?,
          updated_at = CURRENT_TIMESTAMP(3)
      WHERE action_id = ? AND status IN ('proposed','planned','approved')`,
    [errorCode ? `${errorCode}: ${errorMessage ?? ""}` : errorMessage, actionId]
  );
}

/** Find the action_id for an outbox message so we can update it after delivery. */
export async function loadActionIdByOutboxMessageId(outboxMessageId: number): Promise<string | null> {
  const rows = await safeQueryRows<{ action_id: string }>(
    `SELECT action_id FROM \`${ACTIONS_TABLE}\` WHERE outbox_message_id = ? LIMIT 1`,
    [outboxMessageId]
  );
  if (!rows.ok || rows.rows.length === 0) return null;
  return rows.rows[0]?.action_id ?? null;
}

/** Record an ActionOutcome when a Meta delivery webhook arrives (sent/delivered/read). */
export async function recordDeliveryOutcome(
  outboxMessageId: number,
  providerMessageId: string,
  outcomeType: "sent" | "delivered" | "read" | "failed",
  occurredAt: string,
  providerEventJson?: Record<string, unknown> | null
): Promise<void> {
  const actionId = await loadActionIdByOutboxMessageId(outboxMessageId);
  if (!actionId) return;

  const executionResult = await safeQueryRows<{ execution_id: string }>(
    `SELECT execution_id FROM crm_action_executions WHERE outbox_message_id = ? ORDER BY created_at DESC LIMIT 1`,
    [outboxMessageId]
  );
  const executionId = executionResult.ok ? (executionResult.rows[0]?.execution_id ?? "") : "";

  await persistActionOutcome({
    actionId,
    actionRowId: null,
    executionId,
    outboxMessageId,
    providerMessageId,
    outcomeType,
    occurredAt,
    providerEventJson: providerEventJson ?? null
  });
}
