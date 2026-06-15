import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { safeQueryRows, withConnection } from "@/lib/db";
import type { BrainExecutionActionType, BrainExecutionPlan, BrainOutboxPreview, BrainOutboxStatus } from "./types";
import type { BrainDedupeCheckResult, BrainDedupeKeyInput } from "./dedupe";
import { buildDedupeKey, hashMessageText } from "./dedupe";

export const BRAIN_MESSAGE_OUTBOX_TABLE = "brain_message_outbox";
export const BRAIN_MESSAGE_OUTBOX_MODEL_VERSION = "brain.message-outbox.v1";

export type BrainOutboxRecord = {
  id?: number;
  dedupe_key: string;
  channel: "whatsapp";
  direction: "outbound";
  status: BrainOutboxStatus;
  source: string | null;
  source_request_id: string | null;
  source_agent_name: string | null;
  source_agent_version: string | null;
  wa_id: string | null;
  phone_number_id: string | null;
  conversation_case_id: string | number | null;
  message_text: string | null;
  message_hash: string | null;
  meta_payload_json: Record<string, unknown> | null;
  provider_message_id: string | null;
  error_code: string | null;
  error_message: string | null;
  planned_at?: string;
  locked_at?: string | null;
  sent_at?: string | null;
  failed_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type BrainOutboxRecordInput = {
  dedupeKeyInput: BrainDedupeKeyInput;
  status: BrainOutboxStatus;
  source: string | null;
  sourceRequestId?: string | null;
  sourceAgentName?: string | null;
  sourceAgentVersion?: string | null;
  waId?: string | null;
  phoneNumberId?: string | null;
  conversationCaseId?: string | number | null;
  messageText?: string | null;
  metaPayloadJson?: Record<string, unknown> | null;
  providerMessageId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type BrainOutboxLookupResult =
  | { ok: true; row: BrainOutboxRecord | null; warning?: string }
  | { ok: false; row: null; warning: string };

export type BrainOutboxPersistResult =
  | { ok: true; persisted: boolean; existing: boolean; row: BrainOutboxRecord; warning?: string }
  | { ok: false; persisted: false; existing: false; row: null; warning: string };

export type BrainOutboxPreviewInput = {
  actionType: BrainExecutionActionType;
  status: BrainExecutionPlan["status"];
  dedupeCheck: BrainDedupeCheckResult;
  reason: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asOptionalStringOrNumber(value: unknown): string | number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string" || typeof value === "number") return value;
  return null;
}

async function brainOutboxTableExists() {
  const rows = await safeQueryRows<{ table_exists: number }>(
    "SELECT 1 AS table_exists FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1",
    [BRAIN_MESSAGE_OUTBOX_TABLE]
  );
  return rows.ok && rows.rows.length > 0;
}

function normalizeRecordJson(value: Record<string, unknown> | null | undefined) {
  if (!value) return null;
  return value;
}

export function buildOutboxPreview(input: BrainOutboxPreviewInput): BrainOutboxPreview {
  return {
    dedupe_key: input.dedupeCheck.dedupe_key,
    channel: "whatsapp",
    status: input.status,
    action_type: input.actionType,
    duplicate_detected: input.dedupeCheck.duplicate_detected,
    reason: input.reason
  };
}

export function buildOutboxRecord(input: BrainOutboxRecordInput): BrainOutboxRecord {
  return {
    dedupe_key: buildDedupeKey(input.dedupeKeyInput),
    channel: "whatsapp",
    direction: "outbound",
    status: input.status,
    source: input.source,
    source_request_id: input.sourceRequestId ?? input.dedupeKeyInput.sourceRequestId ?? null,
    source_agent_name: input.sourceAgentName ?? null,
    source_agent_version: input.sourceAgentVersion ?? null,
    wa_id: input.waId ?? input.dedupeKeyInput.waId ?? null,
    phone_number_id: input.phoneNumberId ?? input.dedupeKeyInput.phoneNumberId ?? null,
    conversation_case_id: input.conversationCaseId ?? input.dedupeKeyInput.conversationCaseId ?? null,
    message_text: input.messageText ?? null,
    message_hash: input.messageText ? hashMessageText(input.messageText) : null,
    meta_payload_json: normalizeRecordJson(input.metaPayloadJson),
    provider_message_id: input.providerMessageId ?? null,
    error_code: input.errorCode ?? null,
    error_message: input.errorMessage ?? null
  };
}

function serializeMetaPayloadJson(value: Record<string, unknown> | null) {
  if (!value) return null;
  return JSON.stringify(value);
}

function rowToRecord(row: Record<string, unknown>): BrainOutboxRecord {
  const rawMetaPayload = row.meta_payload_json;
  let metaPayloadJson: Record<string, unknown> | null = null;
  if (isRecord(rawMetaPayload)) {
    metaPayloadJson = rawMetaPayload;
  } else if (typeof rawMetaPayload === "string" && rawMetaPayload.trim()) {
    try {
      const parsed = JSON.parse(rawMetaPayload);
      metaPayloadJson = isRecord(parsed) ? parsed : null;
    } catch {
      metaPayloadJson = null;
    }
  }

  return {
    id: typeof row.id === "number" ? row.id : Number(row.id ?? 0) || undefined,
    dedupe_key: asString(row.dedupe_key) ?? "",
    channel: "whatsapp",
    direction: "outbound",
    status: (asString(row.status) as BrainOutboxStatus) ?? "planned",
    source: asString(row.source),
    source_request_id: asString(row.source_request_id),
    source_agent_name: asString(row.source_agent_name),
    source_agent_version: asString(row.source_agent_version),
    wa_id: asString(row.wa_id),
    phone_number_id: asString(row.phone_number_id),
    conversation_case_id: asOptionalStringOrNumber(row.conversation_case_id),
    message_text: asString(row.message_text),
    message_hash: asString(row.message_hash),
    meta_payload_json: metaPayloadJson,
    provider_message_id: asString(row.provider_message_id),
    error_code: asString(row.error_code),
    error_message: asString(row.error_message),
    planned_at: asString(row.planned_at) ?? undefined,
    locked_at: asString(row.locked_at),
    sent_at: asString(row.sent_at),
    failed_at: asString(row.failed_at),
    created_at: asString(row.created_at) ?? undefined,
    updated_at: asString(row.updated_at) ?? undefined
  };
}

export async function findOutboxByDedupeKey(dedupeKey: string): Promise<BrainOutboxLookupResult> {
  if (!(await brainOutboxTableExists())) {
    return { ok: false, row: null, warning: `Tabla ${BRAIN_MESSAGE_OUTBOX_TABLE} no disponible` };
  }

  const rows = await safeQueryRows<Record<string, unknown>>(`SELECT * FROM \`${BRAIN_MESSAGE_OUTBOX_TABLE}\` WHERE dedupe_key = ? LIMIT 1`, [dedupeKey]);
  if (!rows.ok) {
    return { ok: false, row: null, warning: rows.error };
  }

  return { ok: true, row: rows.rows[0] ? rowToRecord(rows.rows[0]) : null };
}

export async function createOutboxPlannedRecord(input: BrainOutboxRecordInput): Promise<BrainOutboxPersistResult> {
  if (!(await brainOutboxTableExists())) {
    return {
      ok: false,
      persisted: false,
      existing: false,
      row: null,
      warning: `Tabla ${BRAIN_MESSAGE_OUTBOX_TABLE} no disponible`
    };
  }

  const record = buildOutboxRecord(input);
  const existingLookup = await findOutboxByDedupeKey(record.dedupe_key);
  if (existingLookup.ok && existingLookup.row) {
    return { ok: true, persisted: false, existing: true, row: existingLookup.row, warning: "Existing outbox record reused." };
  }
  if (!existingLookup.ok) {
    return { ok: false, persisted: false, existing: false, row: null, warning: existingLookup.warning };
  }

  const sql = `
    INSERT IGNORE INTO \`${BRAIN_MESSAGE_OUTBOX_TABLE}\`
      (
        dedupe_key,
        channel,
        direction,
        status,
        source,
        source_request_id,
        source_agent_name,
        source_agent_version,
        wa_id,
        phone_number_id,
        conversation_case_id,
        message_text,
        message_hash,
        meta_payload_json,
        provider_message_id,
        error_code,
        error_message,
        planned_at,
        locked_at,
        sent_at,
        failed_at,
        created_at,
        updated_at
      )
    VALUES (
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      CURRENT_TIMESTAMP,
      NULL,
      NULL,
      NULL,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `;

  try {
    const persistResult = await withConnection(async (connection) => {
      const [insertResult] = await connection.execute<ResultSetHeader>(sql, [
        record.dedupe_key,
        record.channel,
        record.direction,
        record.status,
        record.source,
        record.source_request_id,
        record.source_agent_name,
        record.source_agent_version,
        record.wa_id,
        record.phone_number_id,
        record.conversation_case_id,
        record.message_text,
        record.message_hash,
        serializeMetaPayloadJson(record.meta_payload_json),
        record.provider_message_id,
        record.error_code,
        record.error_message
      ]);

      if (insertResult.affectedRows > 0 && insertResult.insertId > 0) {
        const [insertedRows] = await connection.execute<RowDataPacket[]>(
          `SELECT * FROM \`${BRAIN_MESSAGE_OUTBOX_TABLE}\` WHERE id = ? LIMIT 1`,
          [insertResult.insertId]
        );
        return {
          ok: true as const,
          persisted: true,
          existing: false,
          row: insertedRows[0] ? rowToRecord(insertedRows[0] as Record<string, unknown>) : record
        };
      }

      const [existingRows] = await connection.execute<RowDataPacket[]>(
        `SELECT * FROM \`${BRAIN_MESSAGE_OUTBOX_TABLE}\` WHERE dedupe_key = ? LIMIT 1`,
        [record.dedupe_key]
      );
      return {
        ok: true as const,
        persisted: false,
        existing: true,
        row: existingRows[0] ? rowToRecord(existingRows[0] as Record<string, unknown>) : record,
        warning: "Duplicate outbox key reused."
      };
    });

    return persistResult;
  } catch (error) {
    return {
      ok: false,
      persisted: false,
      existing: false,
      row: null,
      warning: error instanceof Error ? error.message : String(error)
    };
  }
}
