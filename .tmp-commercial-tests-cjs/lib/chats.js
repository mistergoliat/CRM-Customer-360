"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listChats = listChats;
exports.getChatContext = getChatContext;
exports.getChatMessages = getChatMessages;
exports.getInitialChatView = getInitialChatView;
exports.getChatPreviewIds = getChatPreviewIds;
const db_1 = require("./db");
const cases_1 = require("./cases");
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
async function listChats(filters = {}) {
    const pageSize = 30;
    const page = Math.max(1, Number(filters.page || 1));
    const offset = (page - 1) * pageSize;
    const where = [];
    const params = [];
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
    const countResult = await (0, db_1.safeQueryRows)(`SELECT COUNT(*) AS total FROM n8n_vw_hub_cases ${whereSql}`, params);
    const rowsResult = await (0, db_1.safeQueryRows)(`SELECT ${CHAT_LIST_COLUMNS} FROM n8n_vw_hub_cases ${whereSql} ${orderSql} LIMIT ${pageSize} OFFSET ${offset}`, params);
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
async function getChatContext(caseId) {
    const result = await (0, db_1.safeQueryRows)(`SELECT ${CHAT_CONTEXT_COLUMNS} FROM n8n_vw_hub_cases WHERE conversation_case_id = ? LIMIT 1`, [caseId]);
    if (!result.ok)
        return { ok: false, error: result.error, row: null };
    return { ok: true, row: result.rows[0] ?? null };
}
async function getChatMessages(caseId) {
    const caseResult = await (0, cases_1.getCaseById)(caseId);
    if (!caseResult.ok)
        return { ok: false, error: caseResult.error, rows: [], source: "error" };
    if (!caseResult.row)
        return { ok: false, error: "Caso no encontrado", rows: [], source: "missing" };
    return (0, cases_1.getCaseTimeline)(caseResult.row);
}
async function getInitialChatView(caseId, q) {
    const list = await listChats({ page: 1, q });
    const selectedCaseId = caseId || (list.rows[0] ? String(list.rows[0].conversation_case_id) : null);
    if (!selectedCaseId) {
        return {
            list,
            selectedCaseId: null,
            context: { ok: true, row: null },
            messages: { ok: true, rows: [], source: "empty" }
        };
    }
    const [context, messages] = await Promise.all([getChatContext(selectedCaseId), getChatMessages(selectedCaseId)]);
    return { list, selectedCaseId, context, messages };
}
async function getChatPreviewIds(limit = 5) {
    const rows = await (0, db_1.queryRows)(`SELECT conversation_case_id
     FROM n8n_vw_hub_cases
     ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC
     LIMIT ?`, [limit]);
    return rows.map((row) => row.conversation_case_id);
}
