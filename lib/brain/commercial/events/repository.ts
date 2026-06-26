import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { safeQueryRows, withConnection } from "@/lib/db";
import type { CommercialEventPersistResult, CommercialEventV1 } from "./types";

export const COMMERCIAL_EVENT_TABLE = "commercial_event";

function asText(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function asNullableString(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function asJsonRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function commercialEventTableExists(connection?: PoolConnection) {
  const executor = connection ?? undefined;
  if (executor) {
    const [rows] = await executor.execute<RowDataPacket[]>(
      "SELECT 1 AS table_exists FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1",
      [COMMERCIAL_EVENT_TABLE]
    );
    return rows.length > 0;
  }

  const rows = await safeQueryRows<{ table_exists: number }>(
    "SELECT 1 AS table_exists FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1",
    [COMMERCIAL_EVENT_TABLE]
  );
  return rows.ok && rows.rows.length > 0;
}

export function commercialEventRowToContract(row: Record<string, unknown>): CommercialEventV1 {
  return {
    contractName: "CommercialEvent",
    schemaVersion: "1.0",
    id: asText(row.id) ?? "",
    eventType: asText(row.event_type) as CommercialEventV1["eventType"],
    source: asText(row.source) as CommercialEventV1["source"],
    sourceEventId: asNullableString(row.source_event_id),
    dedupeKey: asText(row.dedupe_key) ?? "",
    correlationId: asText(row.correlation_id) ?? "",
    causationId: asNullableString(row.causation_id),
    customerId: asNullableString(row.customer_id),
    conversationId: asNullableString(row.conversation_id),
    opportunityId: asNullableString(row.opportunity_id),
    channel: asNullableString(row.channel),
    provider: asNullableString(row.provider),
    occurredAt: asText(row.occurred_at) ?? "",
    receivedAt: asText(row.received_at) ?? "",
    payload: asJsonRecord(row.payload_json) ?? {},
    metadata: asJsonRecord(row.metadata_json) ?? {}
  };
}

async function findCommercialEventByDedupeKeyOnConnection(connection: PoolConnection, dedupeKey: string) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT * FROM \`${COMMERCIAL_EVENT_TABLE}\` WHERE dedupe_key = ? LIMIT 1`,
    [dedupeKey]
  );
  return rows[0] ? commercialEventRowToContract(rows[0] as Record<string, unknown>) : null;
}

async function findCommercialEventByDedupeKeyWithoutConnection(dedupeKey: string) {
  const rows = await safeQueryRows<Record<string, unknown>>(
    `SELECT * FROM \`${COMMERCIAL_EVENT_TABLE}\` WHERE dedupe_key = ? LIMIT 1`,
    [dedupeKey]
  );
  if (!rows.ok) return null;
  return rows.rows[0] ? commercialEventRowToContract(rows.rows[0]) : null;
}

export async function findCommercialEventByCorrelationId(correlationId: string) {
  const rows = await safeQueryRows<Record<string, unknown>>(
    `SELECT * FROM \`${COMMERCIAL_EVENT_TABLE}\` WHERE correlation_id = ? ORDER BY created_at ASC, id ASC`,
    [correlationId]
  );
  if (!rows.ok) return null;
  return rows.rows[0] ? commercialEventRowToContract(rows.rows[0]) : null;
}

export async function findCommercialEventByConversationId(conversationId: string) {
  const rows = await safeQueryRows<Record<string, unknown>>(
    `SELECT * FROM \`${COMMERCIAL_EVENT_TABLE}\` WHERE conversation_id = ? ORDER BY created_at ASC, id ASC`,
    [conversationId]
  );
  if (!rows.ok) return null;
  return rows.rows.map((row) => commercialEventRowToContract(row));
}

export async function recordCommercialEvent(event: CommercialEventV1, connection?: PoolConnection): Promise<CommercialEventPersistResult> {
  if (!(await commercialEventTableExists(connection))) {
    return { ok: false, status: "error", event: null, warning: `Tabla ${COMMERCIAL_EVENT_TABLE} no disponible` };
  }

  const runner = connection
    ? async () => insertCommercialEventOnConnection(connection, event)
    : async () => withConnection(async (innerConnection) => insertCommercialEventOnConnection(innerConnection, event));

  try {
    return await runner();
  } catch (error) {
    return { ok: false, status: "error", event: null, warning: error instanceof Error ? error.message : String(error) };
  }
}

async function insertCommercialEventOnConnection(connection: PoolConnection, event: CommercialEventV1): Promise<CommercialEventPersistResult> {
  const existing = await findCommercialEventByDedupeKeyOnConnection(connection, event.dedupeKey);
  if (existing) {
    return { ok: true, status: "duplicate", event: existing };
  }

  const [insertResult] = await connection.execute<ResultSetHeader>(
    `
      INSERT IGNORE INTO \`${COMMERCIAL_EVENT_TABLE}\` (
        id,
        contract_name,
        schema_version,
        event_type,
        source,
        source_event_id,
        dedupe_key,
        correlation_id,
        causation_id,
        customer_id,
        conversation_id,
        opportunity_id,
        channel,
        provider,
        occurred_at,
        received_at,
        payload_json,
        metadata_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
    `,
    [
      event.id,
      event.contractName,
      event.schemaVersion,
      event.eventType,
      event.source,
      event.sourceEventId,
      event.dedupeKey,
      event.correlationId,
      event.causationId,
      event.customerId,
      event.conversationId,
      event.opportunityId,
      event.channel,
      event.provider,
      event.occurredAt,
      event.receivedAt,
      JSON.stringify(event.payload),
      JSON.stringify(event.metadata)
    ]
  );

  if (insertResult.affectedRows <= 0) {
    const existing = await findCommercialEventByDedupeKeyOnConnection(connection, event.dedupeKey);
    if (existing) return { ok: true, status: "duplicate", event: existing };
    return { ok: false, status: "error", event: null, warning: "commercial_event_insert_failed" };
  }

  return { ok: true, status: "created", event };
}

export async function loadCommercialEventByDedupeKey(dedupeKey: string) {
  if (!(await commercialEventTableExists())) return null;
  return findCommercialEventByDedupeKeyWithoutConnection(dedupeKey);
}
