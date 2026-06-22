"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.manualReply = manualReply;
exports.closeCase = closeCase;
exports.reopenCase = reopenCase;
exports.changePriority = changePriority;
exports.blockAi = blockAi;
const audit_1 = require("./audit");
const cases_1 = require("./cases");
const meta_1 = require("./meta");
const api_response_1 = require("./api-response");
const write_access_1 = require("./write-access");
function isTruthy(value) {
    return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}
function isClosed(row) {
    return ["closed", "resolved", "done"].includes(String(row.status ?? "").toLowerCase());
}
function caseNotFound(id) {
    return (0, api_response_1.errorResponse)("CASE_NOT_FOUND", `Caso ${id} no existe`, 404);
}
async function requireWriteAccess() {
    if (!(0, write_access_1.isDbWriteEnabled)())
        return (0, write_access_1.dbWriteDisabledResponse)();
    const traceability = await (0, write_access_1.canPersistTraceability)();
    if (!traceability.ok) {
        return (0, api_response_1.errorResponse)("TRACEABILITY_UNAVAILABLE", "No se puede ejecutar la accion porque la trazabilidad en DB no esta disponible.", 409, { details: traceability.details });
    }
    return null;
}
async function manualReply(id, messageText) {
    if (!messageText || messageText.trim().length === 0) {
        return (0, api_response_1.errorResponse)("VALIDATION_ERROR", "message_text requerido", 400);
    }
    if (messageText.length > 4096) {
        return (0, api_response_1.errorResponse)("VALIDATION_ERROR", "message_text excede 4096 caracteres", 400);
    }
    const caseResult = await (0, cases_1.getCaseById)(id);
    if (!caseResult.ok) {
        await (0, audit_1.auditLog)({ action: "db_query_error", entityType: "case", entityId: id, after: { error: caseResult.error } });
        return (0, api_response_1.errorResponse)("DB_QUERY_ERROR", caseResult.error, 500);
    }
    if (!caseResult.row)
        return caseNotFound(id);
    if (isClosed(caseResult.row)) {
        return (0, api_response_1.errorResponse)("CASE_CLOSED", "El caso esta cerrado. Reabrir antes de enviar respuesta manual.", 409);
    }
    if ("whatsapp_window_open" in caseResult.row && !isTruthy(caseResult.row.whatsapp_window_open)) {
        return (0, api_response_1.errorResponse)("TEMPLATE_REQUIRED", "La ventana WhatsApp 24h esta cerrada. Se requiere template; no implementado en fase 1.", 409);
    }
    const waId = String(caseResult.row.wa_id || "");
    const phoneNumberId = String(caseResult.row.phone_number_id || process.env.DEFAULT_PHONE_NUMBER_ID || "");
    if (!waId)
        return (0, api_response_1.errorResponse)("MISSING_WA_ID", "El caso no tiene wa_id", 400);
    if (!phoneNumberId)
        return (0, api_response_1.errorResponse)("MISSING_PHONE_NUMBER_ID", "El caso no tiene phone_number_id ni DEFAULT_PHONE_NUMBER_ID", 400);
    const writeAccess = await requireWriteAccess();
    if (writeAccess)
        return writeAccess;
    const meta = await (0, meta_1.sendWhatsAppText)({ phoneNumberId, to: waId, messageText });
    if (!meta.ok) {
        await (0, audit_1.auditLog)({
            action: "meta_send_error",
            entityType: "case",
            entityId: id,
            after: { error: meta.error, status: meta.status }
        });
        return (0, api_response_1.errorResponse)("META_SEND_ERROR", meta.error, meta.status);
    }
    const warnings = [];
    const inserts = await (0, cases_1.insertManualOutbound)(caseResult.row, messageText, meta.providerMessageId);
    if (!inserts.conversationInsert.ok)
        warnings.push(inserts.conversationInsert.warning);
    if (!inserts.waInsert.ok)
        warnings.push(inserts.waInsert.warning);
    const update = await (0, cases_1.updateCaseLifecycle)(id, {
        last_message_at: "__CHILE_NOW__",
        updated_at: "__CHILE_NOW__",
        final_action: "manual_operator_reply",
        bot_replied: 0
    });
    if (!update.ok)
        warnings.push(update.warning);
    await (0, audit_1.auditLog)({
        action: "manual_reply_sent",
        entityType: "case",
        entityId: id,
        after: { provider_message_id: meta.providerMessageId, warnings }
    });
    return Response.json({
        ok: true,
        message: "Respuesta enviada por Meta Graph API",
        provider_message_id: meta.providerMessageId,
        warnings: warnings.filter(Boolean)
    });
}
async function closeCase(id, reason) {
    const caseResult = await (0, cases_1.getCaseById)(id);
    if (!caseResult.ok)
        return (0, api_response_1.errorResponse)("DB_QUERY_ERROR", caseResult.error, 500);
    if (!caseResult.row)
        return caseNotFound(id);
    const writeAccess = await requireWriteAccess();
    if (writeAccess)
        return writeAccess;
    const update = await (0, cases_1.updateCaseLifecycle)(id, {
        status: "closed",
        lifecycle_status: "closed",
        final_action: "manual_closed_by_operator",
        requires_human: 0,
        updated_at: "__CHILE_NOW__"
    });
    if (!update.ok)
        return (0, api_response_1.errorResponse)("CASE_UPDATE_FAILED", update.warning, 409);
    await (0, audit_1.auditLog)({ action: "case_closed", entityType: "case", entityId: id, before: caseResult.row, after: { reason } });
    return Response.json({ ok: true, message: "Caso cerrado" });
}
async function reopenCase(id) {
    const caseResult = await (0, cases_1.getCaseById)(id);
    if (!caseResult.ok)
        return (0, api_response_1.errorResponse)("DB_QUERY_ERROR", caseResult.error, 500);
    if (!caseResult.row)
        return caseNotFound(id);
    const writeAccess = await requireWriteAccess();
    if (writeAccess)
        return writeAccess;
    const update = await (0, cases_1.updateCaseLifecycle)(id, {
        status: "human_required",
        lifecycle_status: "waiting_human",
        requires_human: 1,
        updated_at: "__CHILE_NOW__"
    });
    if (!update.ok)
        return (0, api_response_1.errorResponse)("CASE_UPDATE_FAILED", update.warning, 409);
    await (0, audit_1.auditLog)({ action: "case_reopened", entityType: "case", entityId: id, before: caseResult.row });
    return Response.json({ ok: true, message: "Caso reabierto" });
}
async function changePriority(id, priority) {
    if (!["low", "normal", "high", "urgent"].includes(priority)) {
        return (0, api_response_1.errorResponse)("VALIDATION_ERROR", "priority invalida", 400);
    }
    const caseResult = await (0, cases_1.getCaseById)(id);
    if (!caseResult.ok)
        return (0, api_response_1.errorResponse)("DB_QUERY_ERROR", caseResult.error, 500);
    if (!caseResult.row)
        return caseNotFound(id);
    const writeAccess = await requireWriteAccess();
    if (writeAccess)
        return writeAccess;
    const update = await (0, cases_1.updateCaseLifecycle)(id, { priority, updated_at: "__CHILE_NOW__" });
    if (!update.ok)
        return (0, api_response_1.errorResponse)("CASE_UPDATE_FAILED", update.warning, 409);
    await (0, audit_1.auditLog)({
        action: "case_priority_changed",
        entityType: "case",
        entityId: id,
        before: { priority: caseResult.row.priority },
        after: { priority }
    });
    return Response.json({ ok: true, message: "Prioridad actualizada" });
}
async function blockAi(id) {
    const caseResult = await (0, cases_1.getCaseById)(id);
    if (!caseResult.ok)
        return (0, api_response_1.errorResponse)("DB_QUERY_ERROR", caseResult.error, 500);
    if (!caseResult.row)
        return caseNotFound(id);
    const writeAccess = await requireWriteAccess();
    if (writeAccess)
        return writeAccess;
    const columns = await (0, cases_1.getCaseTableColumns)();
    const blockColumn = [
        "ai_blocked",
        "block_ai",
        "ai_autoreply_blocked",
        "auto_reply_blocked",
        "disable_ai",
        "disable_autoreply",
        "bot_blocked",
        "human_lock"
    ].find((column) => columns.includes(column));
    if (!blockColumn) {
        const proposal = "ALTER TABLE n8n_conversation_cases ADD COLUMN ai_blocked TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN ai_blocked_at DATETIME NULL;";
        await (0, audit_1.auditLog)({ action: "ai_blocked", entityType: "case", entityId: id, after: { applied: false, proposal } });
        return (0, api_response_1.errorResponse)("AI_BLOCK_COLUMN_MISSING", "No existe una columna clara para bloquear IA/autorespuesta. No se aplico update silencioso.", 409, { proposed_sql: proposal });
    }
    const update = await (0, cases_1.updateCaseLifecycle)(id, {
        [blockColumn]: 1,
        ai_blocked_at: "__CHILE_NOW__",
        updated_at: "__CHILE_NOW__"
    });
    if (!update.ok)
        return (0, api_response_1.errorResponse)("CASE_UPDATE_FAILED", update.warning, 409);
    await (0, audit_1.auditLog)({ action: "ai_blocked", entityType: "case", entityId: id, after: { column: blockColumn } });
    return Response.json({ ok: true, message: "IA/autorespuesta bloqueada", column: blockColumn });
}
