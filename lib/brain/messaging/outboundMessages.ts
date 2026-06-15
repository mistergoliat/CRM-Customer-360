import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { chileNowSql, getColumns, withConnection } from "@/lib/db";
import { BRAIN_MESSAGE_OUTBOX_TABLE } from "./outbox";
import type {
  BrainCanonicalOutboundPersistResult,
  BrainCanonicalOutboundPersistStatus,
  BrainOutboxStatus
} from "./types";

export const BRAIN_CANONICAL_OUTBOUND_TABLE = "n8n_conversation_messages";
export const BRAIN_PERSIST_CANONICAL_OUTBOUND_FLAG = "BRAIN_PERSIST_CANONICAL_OUTBOUND";

export type PersistCanonicalOutboundMessageInput = {
  enabled?: boolean;
  outboxId: number | null;
  dedupeKey: string;
  sourceRequestId?: string | null;
  outboxStatus: BrainOutboxStatus | string;
  conversationCaseId: string | number | null;
  waId: string | null;
  phoneNumberId: string | null;
  messageText: string | null;
  providerMessageId: string | null;
  sentAt?: string | null;
  debug?: boolean;
};

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asOptionalStringOrNumber(value: unknown): string | number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string" || typeof value === "number") return value;
  return null;
}

function compactWarnings(items: Array<string | undefined | null | false>): string[] {
  return items.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function buildPersistResult(
  status: BrainCanonicalOutboundPersistStatus,
  messageId: number | null,
  warnings: string[] = []
): BrainCanonicalOutboundPersistResult {
  const compactedWarnings = compactWarnings(warnings);
  const warning = compactedWarnings.length > 0 ? compactedWarnings.join(" ") : null;

  if (warning && status !== "skipped_by_flag") {
    return {
      status: "warning",
      message_id: messageId,
      warning
    };
  }

  return warning
    ? {
        status,
        message_id: messageId,
        warning
      }
    : {
        status,
        message_id: messageId
      };
}

function extractMessageId(row: Record<string, unknown>) {
  const candidates = [row.id, row.message_id, row.conversation_message_id, row.canonical_message_id];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === "string" && candidate.trim()) {
      const parsed = Number(candidate.trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function buildLookupClauses(columns: string[], input: PersistCanonicalOutboundMessageInput) {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  const providerMessageId = asTrimmedString(input.providerMessageId);
  const dedupeKey = asTrimmedString(input.dedupeKey);

  let finalSourceRequestId: string | null = asTrimmedString(input.sourceRequestId);
  if (!finalSourceRequestId) finalSourceRequestId = dedupeKey;
  if (!finalSourceRequestId) finalSourceRequestId = asTrimmedString(input.providerMessageId);
  if (!finalSourceRequestId && input.outboxId !== null) finalSourceRequestId = `brain_outbox:${input.outboxId}`;

  if (providerMessageId && columns.includes("provider_message_id")) {
    clauses.push("provider_message_id = ?");
    params.push(providerMessageId);
  }

  if (input.outboxId !== null) {
    if (columns.includes("source_table") && columns.includes("source_id")) {
      clauses.push("(source_table = ? AND source_id = ?)");
      params.push(BRAIN_MESSAGE_OUTBOX_TABLE, input.outboxId);
    } else if (columns.includes("source_id")) {
      clauses.push("source_id = ?");
      params.push(input.outboxId);
    }
  }

  if (finalSourceRequestId) {
    if (columns.includes("source") && columns.includes("source_request_id")) {
      clauses.push("(source = ? AND source_request_id = ?)");
      params.push("brain", finalSourceRequestId);
    } else if (columns.includes("source_request_id")) {
      clauses.push("source_request_id = ?");
      params.push(finalSourceRequestId);
    } else if (columns.includes("dedupe_key")) {
      clauses.push("dedupe_key = ?");
      params.push(finalSourceRequestId);
    }
  }

  return { clauses, params };
}

function buildSchemaAdaptationWarnings(columns: string[], input: PersistCanonicalOutboundMessageInput) {
  const warnings: string[] = [];
  const providerMessageId = asTrimmedString(input.providerMessageId);
  const dedupeKey = asTrimmedString(input.dedupeKey);
  const hasProviderMessageId = columns.includes("provider_message_id");
  const hasSourceTableId = columns.includes("source_table") && columns.includes("source_id");
  const hasSourceId = columns.includes("source_id");
  const hasSourceRequestId = columns.includes("source_request_id");
  const hasDedupeKey = columns.includes("dedupe_key");

  if (!providerMessageId) {
    warnings.push("Meta response did not expose a provider_message_id; persisted row will rely on fallback identifiers.");
  } else if (!hasProviderMessageId) {
    warnings.push("provider_message_id column missing; using fallback identifiers for canonical outbound persistence.");
  }

  if (input.outboxId !== null && !hasSourceTableId && hasSourceId) {
    warnings.push("source_table column missing; source_id fallback will be used without table anchoring.");
  } else if (input.outboxId !== null && !hasSourceId && !hasSourceTableId) {
    warnings.push("source_id/source_table columns missing; outbox_id fallback is unavailable.");
  }

  if (dedupeKey && !hasSourceRequestId && hasDedupeKey) {
    warnings.push("source_request_id column missing; dedupe_key fallback will be used.");
  } else if (dedupeKey && !hasSourceRequestId && !hasDedupeKey) {
    warnings.push("source_request_id/dedupe_key columns missing; dedupe fallback is unavailable.");
  }

  return warnings;
}

function resolveCanonicalDedupeKey(input: PersistCanonicalOutboundMessageInput) {
  const candidates = [
    asTrimmedString(input.dedupeKey),
    asTrimmedString(input.providerMessageId),
    asTrimmedString(input.sourceRequestId),
    input.outboxId !== null ? `brain_outbox:${input.outboxId}` : null
  ];
  return candidates.find((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0) ?? null;
}

function buildInsertValues(input: PersistCanonicalOutboundMessageInput) {
  const messageText = asTrimmedString(input.messageText);
  const providerMessageId = asTrimmedString(input.providerMessageId);
  const dedupeKey = asTrimmedString(input.dedupeKey);

  return {
    conversation_case_id: asOptionalStringOrNumber(input.conversationCaseId),
    wa_id: asTrimmedString(input.waId),
    phone_number_id: asTrimmedString(input.phoneNumberId),
    channel: "whatsapp",
    platform: "meta",
    direction: "outbound",
    message_direction: "outbound",
    message_type: "text",
    type: "text",
    message_text: messageText,
    text: messageText,
    body: messageText,
    message: messageText,
    content: messageText,
    raw_text: messageText,
    provider_message_id: providerMessageId,
    whatsapp_message_id: providerMessageId,
    wa_message_id: providerMessageId,
    source: "brain",
    source_table: BRAIN_MESSAGE_OUTBOX_TABLE,
    source_id: input.outboxId,
    source_request_id: dedupeKey,
    status: "sent",
    message_status: "sent",
    final_action: "brain_backend_send",
    message_at: "__CHILE_NOW__",
    occurred_at: "__CHILE_NOW__",
    sent_at: input.sentAt ?? "__CHILE_NOW__",
    created_at: "__CHILE_NOW__",
    updated_at: "__CHILE_NOW__"
  };
}

function buildInsertSql(columns: string[], values: Record<string, unknown>) {
  const insertColumns: string[] = [];
  const placeholders: string[] = [];
  const params: Array<string | number | null> = [];

  for (const [column, value] of Object.entries(values)) {
    if (!columns.includes(column) || value === undefined) continue;
    insertColumns.push(`\`${column}\``);
    if (value === "__CHILE_NOW__") {
      placeholders.push(chileNowSql());
      continue;
    }
    placeholders.push("?");
    params.push(value as string | number | null);
  }

  return {
    insertColumns,
    placeholders,
    params
  };
}

async function lookupCanonicalOutboundMessage(connection: PoolConnection, clauses: string[], params: Array<string | number>) {
  const sql = `SELECT * FROM \`${BRAIN_CANONICAL_OUTBOUND_TABLE}\`${clauses.length > 0 ? ` WHERE ${clauses.join(" OR ")}` : ""} LIMIT 1`;
  const [rows] = await connection.execute<RowDataPacket[]>(sql, params);
  const row = (rows[0] ?? {}) as Record<string, unknown>;
  return {
    row: rows[0] ? row : null,
    messageId: rows[0] ? extractMessageId(row) : null
  };
}

export async function persistCanonicalOutboundMessage(
  input: PersistCanonicalOutboundMessageInput
): Promise<BrainCanonicalOutboundPersistResult> {
  if (input.enabled !== true) {
    return {
      status: "skipped_by_flag",
      message_id: null
    };
  }

  const outboxStatus = String(input.outboxStatus ?? "").toLowerCase();
  const waId = asTrimmedString(input.waId);
  const phoneNumberId = asTrimmedString(input.phoneNumberId);
  const messageText = asTrimmedString(input.messageText);
  const providerMessageId = asTrimmedString(input.providerMessageId);
  const sourceRequestId = asTrimmedString(input.sourceRequestId);
  const warnings: string[] = [];
  const resolvedDedupeKey = resolveCanonicalDedupeKey(input);

  if (outboxStatus !== "sent") {
    return buildPersistResult("skipped", null, [`Canonical outbound persistence requires sent status, received ${input.outboxStatus}.`]);
  }

  if (!waId || !phoneNumberId || !messageText) {
    return buildPersistResult("skipped", null, [
      "Canonical outbound persistence requires wa_id, phone_number_id and message_text."
    ]);
  }

  const columns = await getColumns(BRAIN_CANONICAL_OUTBOUND_TABLE);
  if (columns.length === 0) {
    return buildPersistResult("skipped", null, [`Tabla ${BRAIN_CANONICAL_OUTBOUND_TABLE} no disponible`]);
  }

  const lookup = buildLookupClauses(columns, input);
  if (lookup.clauses.length === 0) {
    return buildPersistResult("skipped", null, [
      "No compatible dedupe columns were found for canonical outbound persistence."
    ]);
  }

  if (!columns.includes("message_text") && !columns.includes("text") && !columns.includes("body") && !columns.includes("message") && !columns.includes("content") && !columns.includes("raw_text")) {
    return buildPersistResult("skipped", null, [
      `Tabla ${BRAIN_CANONICAL_OUTBOUND_TABLE} no contiene columnas compatibles para el texto del mensaje.`
    ]);
  }

  if (!resolvedDedupeKey) {
    return buildPersistResult("skipped", null, [
      "No se pudo resolver una dedupe key estable para canonical outbound persistence."
    ]);
  }

  const values = buildInsertValues({
    ...input,
    dedupeKey: resolvedDedupeKey,
    sourceRequestId,
    messageText,
    phoneNumberId,
    providerMessageId,
    waId
  });
  const insert = buildInsertSql(columns, values);
  if (insert.insertColumns.length === 0) {
    return buildPersistResult("skipped", null, [
      `Sin columnas insertables en ${BRAIN_CANONICAL_OUTBOUND_TABLE}.`
    ]);
  }

  warnings.push(...buildSchemaAdaptationWarnings(columns, input));

  const sql = `INSERT IGNORE INTO \`${BRAIN_CANONICAL_OUTBOUND_TABLE}\` (${insert.insertColumns.join(", ")}) VALUES (${insert.placeholders.join(", ")})`;

  try {
    return await withConnection(async (connection) => {
      const existingLookup = await lookupCanonicalOutboundMessage(connection, lookup.clauses, lookup.params);
      if (existingLookup.row) {
        return buildPersistResult("existing", existingLookup.messageId, warnings);
      }

      const [insertResult] = await connection.execute<ResultSetHeader>(sql, insert.params);

      const persistedLookup = await lookupCanonicalOutboundMessage(connection, lookup.clauses, lookup.params);
      if (persistedLookup.row) {
        return buildPersistResult(insertResult.affectedRows > 0 ? "persisted" : "existing", persistedLookup.messageId, warnings);
      }

      return buildPersistResult("warning", null, [
        `Canonical outbound row insert completed but ${BRAIN_CANONICAL_OUTBOUND_TABLE} lookup could not confirm the row.`
      ]);
    });
  } catch (error) {
    return buildPersistResult("warning", null, [
      error instanceof Error ? error.message : String(error)
    ]);
  }
}
