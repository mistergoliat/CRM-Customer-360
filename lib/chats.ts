import type { DbRow } from "./db";
import { queryRows, safeQueryRows } from "./db";
import { getCaseById, getCaseTimeline, type TimelineEntry } from "./cases";

export type ChatListItem = {
  conversation_case_id: number;
  active_case_key: string | null;
  wa_id: string | null;
  contact_name: string | null;
  phone_number_id: string | null;
  department: string | null;
  status: string | null;
  priority: string | null;
  service_code: string | null;
  requires_human: number | boolean | null;
  whatsapp_window_open: number | boolean | null;
  message_count: number | null;
  last_message: string | null;
  last_message_at: string | null;
  updated_at: string | null;
};

export type ChatListResult = {
  rows: ChatListItem[];
  total: number;
  page: number;
  pageSize: number;
  error?: string;
};

export type ChatCaseContext = {
  conversation_case_id: number | null;
  active_case_key: string | null;
  status: string | null;
  department: string | null;
  service_code: string | null;
  priority: string | null;
  requires_human: number | boolean | null;
  bot_replied: number | boolean | null;
  final_action: string | null;
  id_order: string | null;
  invoice_number: string | null;
  source_table: string | null;
  source_id: string | null;
  phone_number_id: string | null;
  whatsapp_window_open: number | boolean | null;
  wa_id: string | null;
  contact_name: string | null;
  message_count: number | null;
};

type ChatListFilters = {
  page?: number;
  q?: string;
};

const CHAT_LIST_COLUMNS = `
  conversation_case_id,
  active_case_key,
  wa_id,
  contact_name,
  phone_number_id,
  department,
  status,
  priority,
  service_code,
  requires_human,
  whatsapp_window_open,
  message_count,
  last_message,
  last_message_at,
  updated_at
`;

const CHAT_CONTEXT_COLUMNS = `
  conversation_case_id,
  active_case_key,
  status,
  department,
  service_code,
  priority,
  requires_human,
  bot_replied,
  final_action,
  id_order,
  invoice_number,
  source_table,
  source_id,
  phone_number_id,
  whatsapp_window_open,
  wa_id,
  contact_name,
  message_count
`;

export async function listChats(filters: ChatListFilters = {}): Promise<ChatListResult> {
  const pageSize = 30;
  const page = Math.max(1, Number(filters.page || 1));
  const offset = (page - 1) * pageSize;
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.q) {
    where.push("(contact_name LIKE ? OR wa_id LIKE ? OR id_order LIKE ? OR invoice_number LIKE ?)");
    const term = `%${filters.q}%`;
    params.push(term, term, term, term);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const orderSql = `
    ORDER BY
      COALESCE(requires_human, 0) DESC,
      CASE
        WHEN COALESCE(status, '') IN ('active', 'open', 'human_required', 'pending') THEN 0
        ELSE 1
      END ASC,
      CASE
        WHEN COALESCE(priority, '') = 'urgent' THEN 0
        WHEN COALESCE(priority, '') = 'high' THEN 1
        WHEN COALESCE(priority, '') = 'normal' THEN 2
        WHEN COALESCE(priority, '') = 'low' THEN 3
        ELSE 4
      END ASC,
      COALESCE(last_message_at, updated_at, created_at) DESC
  `;

  const countResult = await safeQueryRows<{ total: number }>(`SELECT COUNT(*) AS total FROM n8n_vw_hub_cases ${whereSql}`, params);
  const rowsResult = await safeQueryRows<ChatListItem>(
    `SELECT ${CHAT_LIST_COLUMNS} FROM n8n_vw_hub_cases ${whereSql} ${orderSql} LIMIT ${pageSize} OFFSET ${offset}`,
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

export async function getChatContext(caseId: string | number) {
  const result = await safeQueryRows<ChatCaseContext>(
    `SELECT ${CHAT_CONTEXT_COLUMNS} FROM n8n_vw_hub_cases WHERE conversation_case_id = ? LIMIT 1`,
    [caseId]
  );
  if (!result.ok) return { ok: false as const, error: result.error, row: null };
  return { ok: true as const, row: result.rows[0] ?? null };
}

export async function getChatMessages(caseId: string | number) {
  const caseResult = await getCaseById(caseId);
  if (!caseResult.ok) return { ok: false as const, error: caseResult.error, rows: [] as TimelineEntry[], source: "error" };
  if (!caseResult.row) return { ok: false as const, error: "Caso no encontrado", rows: [] as TimelineEntry[], source: "missing" };
  return getCaseTimeline(caseResult.row);
}

export async function getInitialChatView(caseId?: string | null, q?: string) {
  const list = await listChats({ page: 1, q });
  const selectedCaseId = caseId || (list.rows[0] ? String(list.rows[0].conversation_case_id) : null);

  if (!selectedCaseId) {
    return {
      list,
      selectedCaseId: null,
      context: { ok: true as const, row: null },
      messages: { ok: true as const, rows: [] as TimelineEntry[], source: "empty" }
    };
  }

  const [context, messages] = await Promise.all([getChatContext(selectedCaseId), getChatMessages(selectedCaseId)]);
  return { list, selectedCaseId, context, messages };
}

export async function getChatPreviewIds(limit = 5) {
  const rows = await queryRows<{ conversation_case_id: number }>(
    `SELECT conversation_case_id
     FROM n8n_vw_hub_cases
     ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC
     LIMIT ?`,
    [limit]
  );
  return rows.map((row) => row.conversation_case_id);
}
