import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import { safeExecute, safeQueryRows } from "../../../db";

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
  status: "requested" | "executing" | "succeeded" | "failed" | "cancelled";
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
  /** Deterministic idempotency key (see buildDeliveryOutcomeDedupeKey) - NULL when no stable identity exists yet. */
  outcomeDedupeKey?: string | null;
};

export type PersistOutcomeResult = {
  ok: boolean;
  outcomeId: string;
  inserted: boolean;
  duplicate: boolean;
  warning?: string;
};

/**
 * Deterministic idempotency key for a provider delivery outcome
 * (ACS-R1-05-T04 section 7): `provider + provider_message_id + outcome_type`,
 * hashed because provider_message_id can be long. Two concurrent/duplicate
 * webhooks for the same logical event hash to the same key and leave exactly
 * one row, backed by crm_action_outcomes.outcome_dedupe_key's unique index
 * (migration 025) - never a random UUID.
 */
export function buildDeliveryOutcomeDedupeKey(provider: string, providerMessageId: string, outcomeType: string): string {
  return crypto.createHash("sha256").update(`delivery|${provider}|${providerMessageId}|${outcomeType}`).digest("hex");
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Pulls the optional A/B-testing attribution folded into an outbox row's meta_payload_json (ACS-R1-05-T04 section 11). */
export function extractDeliveryExperimentAttribution(metaPayloadJson: unknown): Record<string, string> | null {
  const metaPayload = parseJsonRecord(metaPayloadJson);
  if (!metaPayload) return null;
  const experiment = parseJsonRecord(metaPayload.experiment);
  if (!experiment) return null;
  const entries = Object.entries(experiment).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0);
  if (entries.length === 0) return null;
  return Object.fromEntries(entries);
}

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

/**
 * Append-only, idempotent outcome insert. When `outcomeDedupeKey` is set,
 * INSERT IGNORE backed by crm_action_outcomes' unique index is the source of
 * truth for "already recorded" - never a pre-check SELECT, which cannot rule
 * out two concurrent callers observing absence at the same time.
 */
export async function persistActionOutcome(input: PersistOutcomeInput): Promise<PersistOutcomeResult> {
  const outcomeId = randomUUID();
  const outcomeDedupeKey = input.outcomeDedupeKey ?? null;

  const result = await safeExecute(
    `INSERT IGNORE INTO \`${OUTCOMES_TABLE}\` (
      outcome_id, action_id, action_row_id, execution_id, outbox_message_id,
      provider_message_id, outcome_type, outcome_dedupe_key, occurred_at, provider_event_json, metadata_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
    [
      outcomeId,
      input.actionId,
      input.actionRowId,
      input.executionId,
      input.outboxMessageId,
      input.providerMessageId,
      input.outcomeType,
      outcomeDedupeKey,
      toMysqlDatetime(input.occurredAt),
      input.providerEventJson ? JSON.stringify(input.providerEventJson) : null,
      input.metadataJson ? JSON.stringify(input.metadataJson) : null
    ]
  );

  if (!result.ok) return { ok: false, outcomeId, inserted: false, duplicate: false, warning: result.error };
  if (result.affectedRows > 0) return { ok: true, outcomeId, inserted: true, duplicate: false };

  if (!outcomeDedupeKey) {
    // No stable identity to dedupe on (e.g. a terminal send failure with no
    // provider_message_id yet) - affectedRows=0 here would only happen for a
    // genuine SQL-level rejection, which safeExecute already reported ok.
    return { ok: true, outcomeId, inserted: false, duplicate: false };
  }

  const existing = await safeQueryRows<{ outcome_id: string }>(`SELECT outcome_id FROM \`${OUTCOMES_TABLE}\` WHERE outcome_dedupe_key = ? LIMIT 1`, [outcomeDedupeKey]);
  const existingOutcomeId = existing.ok ? existing.rows[0]?.outcome_id ?? outcomeId : outcomeId;
  return { ok: true, outcomeId: existingOutcomeId, inserted: false, duplicate: true };
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

/** Record an ActionOutcome when a Meta delivery webhook arrives (sent/delivered/read/failed). */
export async function recordDeliveryOutcome(
  outboxMessageId: number,
  providerMessageId: string,
  outcomeType: "sent" | "delivered" | "read" | "failed",
  occurredAt: string,
  providerEventJson?: Record<string, unknown> | null,
  metadataJson?: Record<string, unknown> | null
): Promise<PersistOutcomeResult> {
  // Same fallback id as the send path, so outbox rows without a linked
  // crm_agent_actions row still get a traceable delivery outcome.
  const actionId = (await loadActionIdByOutboxMessageId(outboxMessageId)) ?? `outbox:${outboxMessageId}`;

  const executionResult = await safeQueryRows<{ execution_id: string }>(
    `SELECT execution_id FROM crm_action_executions WHERE outbox_message_id = ? ORDER BY created_at DESC LIMIT 1`,
    [outboxMessageId]
  );
  const executionId = executionResult.ok ? (executionResult.rows[0]?.execution_id ?? "") : "";

  return persistActionOutcome({
    actionId,
    actionRowId: null,
    executionId,
    outboxMessageId,
    providerMessageId,
    outcomeType,
    occurredAt,
    providerEventJson: providerEventJson ?? null,
    metadataJson: metadataJson ?? null,
    outcomeDedupeKey: buildDeliveryOutcomeDedupeKey("meta", providerMessageId, outcomeType)
  });
}
