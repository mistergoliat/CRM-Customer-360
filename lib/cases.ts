import { getColumns, insertExistingColumns, safeQueryRows, updateExistingColumns, type DbRow } from "./db";

export type CaseFilters = {
  q?: string;
  status?: string;
  department?: string;
  priority?: string;
  requiresHuman?: string;
  page?: number;
};

export type CaseListResult = {
  rows: DbRow[];
  total: number;
  page: number;
  pageSize: number;
  error?: string;
};

const CASES_VIEW = "n8n_vw_hub_cases";
const CASES_TABLE = "n8n_conversation_cases";
const MESSAGES_TABLE = "n8n_conversation_messages";
const WA_MESSAGES_TABLE = "n8n_wa_inbound_messages";

export type TimelineDirection = "inbound" | "outbound" | "manual" | "system";

export type TimelineEntry = {
  key: string;
  source: string;
  direction: TimelineDirection;
  body: string;
  messageType: string | null;
  occurredAt: string | null;
  status: string | null;
  intent: string | null;
  department: string | null;
  finalAction: string | null;
  sourceId: string | null;
  idOrder: string | null;
  providerMessageId: string | null;
  technicalOrigin: string | null;
};

export async function listCases(filters: CaseFilters): Promise<CaseListResult> {
  const pageSize = 25;
  const page = Math.max(1, Number(filters.page || 1));
  const offset = (page - 1) * pageSize;
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.q) {
    where.push("(wa_id LIKE ? OR contact_name LIKE ? OR id_order LIKE ? OR invoice_number LIKE ?)");
    const term = `%${filters.q}%`;
    params.push(term, term, term, term);
  }
  if (filters.status) {
    where.push("status = ?");
    params.push(filters.status);
  }
  if (filters.department) {
    where.push("department = ?");
    params.push(filters.department);
  }
  if (filters.priority) {
    where.push("priority = ?");
    params.push(filters.priority);
  }
  if (filters.requiresHuman === "1" || filters.requiresHuman === "0") {
    where.push("requires_human = ?");
    params.push(Number(filters.requiresHuman));
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const countResult = await safeQueryRows<{ total: number }>(`SELECT COUNT(*) AS total FROM ${CASES_VIEW} ${whereSql}`, params);
  const rowsResult = await safeQueryRows(
    `SELECT * FROM ${CASES_VIEW} ${whereSql} ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC LIMIT ${pageSize} OFFSET ${offset}`,
    params
  );

  if (!rowsResult.ok) {
    return { rows: [], total: 0, page, pageSize, error: rowsResult.error };
  }

  return {
    rows: rowsResult.rows,
    total: countResult.ok ? Number(countResult.rows[0]?.total ?? 0) : rowsResult.rows.length,
    page,
    pageSize,
    error: countResult.ok ? undefined : countResult.error
  };
}

export async function getCaseById(id: string | number) {
  const rows = await safeQueryRows(`SELECT * FROM ${CASES_VIEW} WHERE conversation_case_id = ? LIMIT 1`, [id]);
  if (!rows.ok) return { ok: false as const, error: rows.error, row: null };
  return { ok: true as const, row: rows.rows[0] ?? null };
}

function firstExisting(columns: string[], candidates: string[]) {
  return candidates.find((candidate) => columns.includes(candidate));
}

function firstValue(row: DbRow, candidates: string[]) {
  for (const candidate of candidates) {
    const value = row[candidate];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function normalizeDirection(value: unknown, row: DbRow, source: string): TimelineDirection {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "inbound") return "inbound";
  if (normalized === "outbound") return "outbound";
  if (normalized === "manual") return "manual";

  if (source === WA_MESSAGES_TABLE) return "inbound";

  const sourceTable = String(row.source_table || "").toLowerCase();
  const finalAction = String(row.final_action || "").toLowerCase();

  if (sourceTable.includes("hub") || finalAction.includes("manual")) return "manual";
  if (sourceTable.includes("system") || finalAction.includes("notify")) return "system";
  if (sourceTable.includes("outbound")) return "outbound";

  return "system";
}

function normalizeTimelineRows(rows: DbRow[], source: string): TimelineEntry[] {
  return rows
    .map((row, index) => {
      const direction = normalizeDirection(firstValue(row, ["direction", "message_direction"]), row, source);
      const occurredAt = firstValue(row, ["occurred_at", "message_at", "sent_at", "received_at", "created_at", "updated_at"]);
      return {
        key: `${source}-${String(firstValue(row, ["id", "provider_message_id"]) || index)}`,
        source,
        direction,
        body: String(firstValue(row, ["message_text", "text", "body", "message", "content", "raw_text", "last_message"]) || "sin datos"),
        messageType: firstValue(row, ["message_type"]) ? String(firstValue(row, ["message_type"])) : null,
        occurredAt: occurredAt ? String(occurredAt) : null,
        status: firstValue(row, ["message_status", "processing_status", "status", "last_message_status"])
          ? String(firstValue(row, ["message_status", "processing_status", "status", "last_message_status"]))
          : null,
        intent: firstValue(row, ["intent", "last_message_intent"]) ? String(firstValue(row, ["intent", "last_message_intent"])) : null,
        department: firstValue(row, ["department", "last_message_department"])
          ? String(firstValue(row, ["department", "last_message_department"]))
          : null,
        finalAction: firstValue(row, ["final_action", "last_message_final_action"])
          ? String(firstValue(row, ["final_action", "last_message_final_action"]))
          : null,
        sourceId: firstValue(row, ["source_id"]) ? String(firstValue(row, ["source_id"])) : null,
        idOrder: firstValue(row, ["id_order"]) ? String(firstValue(row, ["id_order"])) : null,
        providerMessageId: firstValue(row, ["provider_message_id", "context_message_id", "last_message_id"])
          ? String(firstValue(row, ["provider_message_id", "context_message_id", "last_message_id"]))
          : null,
        technicalOrigin: firstValue(row, ["source_table", "processing_route"]) ? String(firstValue(row, ["source_table", "processing_route"])) : source
      };
    })
    .sort((a, b) => {
      const left = a.occurredAt ? new Date(a.occurredAt).getTime() : 0;
      const right = b.occurredAt ? new Date(b.occurredAt).getTime() : 0;
      return left - right;
    });
}

export async function getCaseTimeline(caseRow: DbRow) {
  const caseId = caseRow.conversation_case_id;
  const messageColumns = await getColumns(MESSAGES_TABLE);
  const dateColumn = firstExisting(messageColumns, [
    "occurred_at",
    "message_at",
    "sent_at",
    "received_at",
    "created_at",
    "updated_at"
  ]);

  if (messageColumns.includes("conversation_case_id")) {
    const statusFilter = messageColumns.includes("message_type") ? " AND COALESCE(message_type, '') <> 'status'" : "";
    const rows = await safeQueryRows(
      `SELECT * FROM ${MESSAGES_TABLE} WHERE conversation_case_id = ?${statusFilter} ORDER BY ${dateColumn ? `\`${dateColumn}\`` : "1"} ASC`,
      [caseId]
    );
    if (rows.ok && rows.rows.length > 0) {
      return { ok: true as const, rows: normalizeTimelineRows(rows.rows, MESSAGES_TABLE), source: MESSAGES_TABLE };
    }
  }

  const waId = caseRow.wa_id;
  const fallbackColumns = await getColumns(WA_MESSAGES_TABLE);
  const fallbackDateColumn = firstExisting(fallbackColumns, [
    "occurred_at",
    "message_at",
    "received_at",
    "created_at",
    "updated_at"
  ]);
  if (waId && fallbackColumns.includes("wa_id")) {
    const rows = await safeQueryRows(
      `SELECT * FROM ${WA_MESSAGES_TABLE} WHERE wa_id = ? ORDER BY ${fallbackDateColumn ? `\`${fallbackDateColumn}\`` : "1"} ASC LIMIT 200`,
      [waId]
    );
    if (rows.ok) return { ok: true as const, rows: normalizeTimelineRows(rows.rows, WA_MESSAGES_TABLE), source: WA_MESSAGES_TABLE };
    return { ok: false as const, rows: [], source: WA_MESSAGES_TABLE, error: rows.error };
  }

  return { ok: true as const, rows: [], source: "empty" };
}

export async function getCaseFilterOptions(column: string) {
  const allowed = new Set(["status", "department", "priority"]);
  if (!allowed.has(column)) return [];
  const result = await safeQueryRows<{ value: string }>(
    `SELECT DISTINCT ${column} AS value FROM ${CASES_VIEW} WHERE ${column} IS NOT NULL AND ${column} <> '' ORDER BY ${column} ASC LIMIT 50`
  );
  return result.ok ? result.rows.map((row) => row.value).filter(Boolean) : [];
}

export async function updateCaseLifecycle(id: string, values: Record<string, unknown>) {
  return updateExistingColumns(CASES_TABLE, ["conversation_case_id", "id"], id, values);
}

async function tryInsert(tableName: string, values: Record<string, unknown>, requiredAny: string[]) {
  try {
    return await insertExistingColumns(tableName, values, requiredAny);
  } catch (error) {
    return { ok: false as const, warning: error instanceof Error ? error.message : String(error) };
  }
}

export async function insertManualOutbound(caseRow: DbRow, messageText: string, providerMessageId?: string) {
  const baseValues = {
    conversation_case_id: caseRow.conversation_case_id,
    active_case_key: caseRow.active_case_key,
    wa_id: caseRow.wa_id,
    contact_id: caseRow.contact_id,
    contact_name: caseRow.contact_name,
    phone_number_id: caseRow.phone_number_id || process.env.DEFAULT_PHONE_NUMBER_ID,
    direction: "outbound",
    message_direction: "outbound",
    source: "hub_webapp",
    source_table: "hub_webapp",
    channel: "whatsapp",
    platform: "whatsapp",
    type: "text",
    message_type: "text",
    message_text: messageText,
    text: messageText,
    body: messageText,
    message: messageText,
    content: messageText,
    raw_text: messageText,
    provider_message_id: providerMessageId,
    whatsapp_message_id: providerMessageId,
    wa_message_id: providerMessageId,
    status: "sent",
    final_action: "manual_operator_reply",
    occurred_at: "__CHILE_NOW__",
    message_at: "__CHILE_NOW__",
    sent_at: "__CHILE_NOW__",
    created_at: "__CHILE_NOW__",
    updated_at: "__CHILE_NOW__"
  };

  const conversationInsert = await tryInsert(MESSAGES_TABLE, baseValues, ["message_text", "text", "body", "message", "content"]);
  const waInsert = await tryInsert(WA_MESSAGES_TABLE, baseValues, ["message_text", "text", "body", "message", "content"]);

  return { conversationInsert, waInsert };
}

export async function recentInboundMessages(limit = 20) {
  const columns = await getColumns(WA_MESSAGES_TABLE);
  if (columns.length === 0) return { ok: true as const, rows: [] };
  const dateColumn = firstExisting(columns, ["occurred_at", "message_at", "received_at", "created_at", "updated_at"]);
  const directionColumn = firstExisting(columns, ["direction", "message_direction"]);
  const where = directionColumn ? `WHERE (${directionColumn} = 'inbound' OR ${directionColumn} IS NULL)` : "";
  return safeQueryRows(`SELECT * FROM ${WA_MESSAGES_TABLE} ${where} ORDER BY ${dateColumn ? `\`${dateColumn}\`` : "1"} DESC LIMIT ${limit}`);
}

export async function recentOutboundMessages(limit = 20) {
  const columns = await getColumns(MESSAGES_TABLE);
  if (columns.length === 0) return { ok: true as const, rows: [] };
  const dateColumn = firstExisting(columns, ["occurred_at", "message_at", "sent_at", "created_at", "updated_at"]);
  const directionColumn = firstExisting(columns, ["direction", "message_direction"]);
  const where = directionColumn ? `WHERE ${directionColumn} IN ('outbound', 'manual')` : "";
  return safeQueryRows(`SELECT * FROM ${MESSAGES_TABLE} ${where} ORDER BY ${dateColumn ? `\`${dateColumn}\`` : "1"} DESC LIMIT ${limit}`);
}

export async function getCaseTableColumns() {
  return getColumns(CASES_TABLE);
}
