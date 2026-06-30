import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { queryRows, safeQueryRows, withConnection } from "@/lib/db";
import type {
  BrainCanonicalOutboundPersistResult,
  BrainCanonicalOutboundPersistStatus,
  BrainOutboxStatus
} from "./types";

export const BRAIN_CANONICAL_OUTBOUND_TABLE = "conversation_message";
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

function asOptionalStringOrNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string" || typeof value === "number") return value;
  return null;
}

function toMysqlDateTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 23).replace("T", " ") : date.toISOString().slice(0, 23).replace("T", " ");
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
  return warning ? { status, message_id: messageId, warning } : { status, message_id: messageId };
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

function toConversationId(value: string | number | null) {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function loadConversationByIdOrPublicId(conversationCaseId: string | number | null) {
  const numeric = toConversationId(conversationCaseId);
  if (numeric !== null) {
    const rows = await safeQueryRows<{ id: number; public_id: string }>("SELECT id, public_id FROM conversation WHERE id = ? LIMIT 1", [numeric]);
    if (rows.ok && rows.rows[0]) return rows.rows[0];
  }

  const publicId = asTrimmedString(conversationCaseId);
  if (!publicId) return null;
  const rows = await safeQueryRows<{ id: number; public_id: string }>("SELECT id, public_id FROM conversation WHERE public_id = ? LIMIT 1", [publicId]);
  if (!rows.ok) return null;
  return rows.rows[0] ?? null;
}

async function lookupCanonicalOutboundMessage(connection: PoolConnection, providerMessageId: string | null) {
  if (!providerMessageId) return { row: null as Record<string, unknown> | null, messageId: null as number | null };
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT * FROM \`${BRAIN_CANONICAL_OUTBOUND_TABLE}\` WHERE provider = ? AND provider_message_id = ? LIMIT 1`,
    ["meta", providerMessageId]
  );
  const row = (rows[0] ?? {}) as Record<string, unknown>;
  return {
    row: rows[0] ? row : null,
    messageId: rows[0] ? extractMessageId(row) : null
  };
}

function buildInsertValues(input: PersistCanonicalOutboundMessageInput, conversationId: number | null, conversationPublicId: string | null) {
  const messageText = asTrimmedString(input.messageText);
  const providerMessageId = asTrimmedString(input.providerMessageId);
  return {
    public_id: `msg-${conversationPublicId ? conversationPublicId.slice(0, 12) : "out"}-${providerMessageId ? providerMessageId.slice(0, 12) : String(input.outboxId ?? "0")}`,
    conversation_id: conversationId,
    provider: "meta",
    provider_message_id: providerMessageId,
    direction: "outbound",
    sender_type: "agent",
    message_type: "text",
    body: messageText,
    status: "sent",
    provider_timestamp: toMysqlDateTime(input.sentAt ?? new Date()),
    metadata_json: JSON.stringify({
      outbox_id: input.outboxId,
      dedupe_key: input.dedupeKey,
      source_request_id: input.sourceRequestId ?? null,
      wa_id: input.waId,
      phone_number_id: input.phoneNumberId
    })
  };
}

export async function persistCanonicalOutboundMessage(
  input: PersistCanonicalOutboundMessageInput
): Promise<BrainCanonicalOutboundPersistResult> {
  if (input.enabled !== true) {
    return { status: "skipped_by_flag", message_id: null };
  }

  const outboxStatus = String(input.outboxStatus ?? "").toLowerCase();
  const waId = asTrimmedString(input.waId);
  const phoneNumberId = asTrimmedString(input.phoneNumberId);
  const messageText = asTrimmedString(input.messageText);
  const providerMessageId = asTrimmedString(input.providerMessageId);

  if (outboxStatus !== "sent") {
    return buildPersistResult("skipped", null, [`Canonical outbound persistence requires sent status, received ${input.outboxStatus}.`]);
  }
  if (!waId || !phoneNumberId || !messageText) {
    return buildPersistResult("skipped", null, ["Canonical outbound persistence requires wa_id, phone_number_id and message_text."]);
  }

  const conversation = await loadConversationByIdOrPublicId(input.conversationCaseId);
  if (!conversation) {
    return buildPersistResult("skipped", null, ["Conversation not found for canonical outbound persistence."]);
  }

  try {
    return await withConnection(async (connection) => {
      const existingLookup = await lookupCanonicalOutboundMessage(connection, providerMessageId);
      if (existingLookup.row) {
        await queryRows(
          "UPDATE conversation SET last_message_at = COALESCE(last_message_at, CURRENT_TIMESTAMP(3)), last_outbound_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
          [conversation.id]
        );
        return buildPersistResult("existing", existingLookup.messageId, []);
      }

      const values = buildInsertValues(input, conversation.id, conversation.public_id);
      const [insertResult] = await connection.execute<ResultSetHeader>(
        `
          INSERT INTO \`${BRAIN_CANONICAL_OUTBOUND_TABLE}\` (
            public_id,
            conversation_id,
            provider,
            provider_message_id,
            direction,
            sender_type,
            message_type,
            body,
            status,
            provider_timestamp,
            metadata_json,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
        `,
        [
          values.public_id,
          values.conversation_id,
          values.provider,
          values.provider_message_id,
          values.direction,
          values.sender_type,
          values.message_type,
          values.body,
          values.status,
          values.provider_timestamp,
          values.metadata_json
        ]
      );

      const lookup = await lookupCanonicalOutboundMessage(connection, providerMessageId);
      await queryRows(
        "UPDATE conversation SET last_message_at = CURRENT_TIMESTAMP(3), last_outbound_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
        [conversation.id]
      );
      return buildPersistResult(insertResult.affectedRows > 0 ? "persisted" : "existing", lookup.messageId, []);
    });
  } catch (error) {
    return buildPersistResult("warning", null, [error instanceof Error ? error.message : String(error)]);
  }
}
