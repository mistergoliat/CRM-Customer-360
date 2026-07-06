import { auditLog } from "./audit";
import { getCaseById, getCaseTableColumns, insertManualOutbound, updateCaseLifecycle } from "./cases";
import type { DbRow } from "./db";
import { sendWhatsAppText } from "./meta";
import { errorResponse } from "./api-response";
import { canPersistTraceability, dbWriteDisabledResponse, isDbWriteEnabled } from "./write-access";

const WHATSAPP_REOPEN_TEMPLATE_NAME = "retomar_conversacion_v1";
const WHATSAPP_REOPEN_TEMPLATE_LANGUAGE = "es_CL";

function isTruthy(value: unknown) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function isClosed(row: DbRow) {
  return ["closed", "resolved", "done"].includes(String(row.status ?? "").toLowerCase());
}

function caseNotFound(id: string) {
  return errorResponse("CASE_NOT_FOUND", `Caso ${id} no existe`, 404);
}

async function requireWriteAccess() {
  if (!isDbWriteEnabled()) return dbWriteDisabledResponse();

  const traceability = await canPersistTraceability();
  if (!traceability.ok) {
    return errorResponse(
      "TRACEABILITY_UNAVAILABLE",
      "No se puede ejecutar la accion porque la trazabilidad en DB no esta disponible.",
      409,
      { details: traceability.details }
    );
  }

  return null;
}

export async function manualReply(id: string, messageText: string) {
  if (!messageText || messageText.trim().length === 0) {
    return errorResponse("VALIDATION_ERROR", "message_text requerido", 400);
  }
  if (messageText.length > 4096) {
    return errorResponse("VALIDATION_ERROR", "message_text excede 4096 caracteres", 400);
  }

  const caseResult = await getCaseById(id);
  if (!caseResult.ok) {
    await auditLog({ action: "db_query_error", entityType: "case", entityId: id, after: { error: caseResult.error } });
    return errorResponse("DB_QUERY_ERROR", caseResult.error, 500);
  }
  if (!caseResult.row) return caseNotFound(id);
  if (isClosed(caseResult.row)) {
    return errorResponse("CASE_CLOSED", "El caso esta cerrado. Reabrir antes de enviar respuesta manual.", 409);
  }

  const waId = String(caseResult.row.wa_id || "");
  const phoneNumberId = String(caseResult.row.phone_number_id || process.env.DEFAULT_PHONE_NUMBER_ID || "");
  if (!waId) return errorResponse("MISSING_WA_ID", "El caso no tiene wa_id", 400);
  if (!phoneNumberId) return errorResponse("MISSING_PHONE_NUMBER_ID", "El caso no tiene phone_number_id ni DEFAULT_PHONE_NUMBER_ID", 400);

  const writeAccess = await requireWriteAccess();
  if (writeAccess) return writeAccess;

  const windowOpen = !("whatsapp_window_open" in caseResult.row) || isTruthy(caseResult.row.whatsapp_window_open);
  const meta = await sendWhatsAppText(
    windowOpen
      ? { phoneNumberId, to: waId, messageText }
      : {
          phoneNumberId,
          to: waId,
          messageText,
          template: {
            name: WHATSAPP_REOPEN_TEMPLATE_NAME,
            languageCode: WHATSAPP_REOPEN_TEMPLATE_LANGUAGE,
            components: [
              {
                type: "body",
                parameters: [{ type: "text", text: messageText }]
              }
            ]
          }
        }
  );
  if (!meta.ok) {
    await auditLog({
      action: "meta_send_error",
      entityType: "case",
      entityId: id,
      after: { error: meta.error, status: meta.status }
    });
    return errorResponse("META_SEND_ERROR", meta.error, meta.status);
  }

  const warnings: string[] = [];
  const inserts = await insertManualOutbound(caseResult.row, messageText, meta.providerMessageId);
  if (!inserts.conversationInsert.ok) warnings.push(inserts.conversationInsert.warning);
  if (!inserts.waInsert.ok) warnings.push(inserts.waInsert.warning);

  const update = await updateCaseLifecycle(id, {
    last_message_at: "__CHILE_NOW__",
    updated_at: "__CHILE_NOW__",
    final_action: "manual_operator_reply",
    bot_replied: 0
  });
  if (!update.ok) warnings.push(update.warning);

  await auditLog({
    action: "manual_reply_sent",
    entityType: "case",
    entityId: id,
    after: { provider_message_id: meta.providerMessageId, warnings, template_used: !windowOpen }
  });

  return Response.json({
    ok: true,
    message: "Respuesta enviada por Meta Graph API",
    provider_message_id: meta.providerMessageId,
    warnings: warnings.filter(Boolean)
  });
}

export async function closeCase(id: string, reason?: string) {
  const caseResult = await getCaseById(id);
  if (!caseResult.ok) return errorResponse("DB_QUERY_ERROR", caseResult.error, 500);
  if (!caseResult.row) return caseNotFound(id);

  const writeAccess = await requireWriteAccess();
  if (writeAccess) return writeAccess;

  const update = await updateCaseLifecycle(id, {
    status: "closed",
    lifecycle_status: "closed",
    final_action: "manual_closed_by_operator",
    requires_human: 0,
    updated_at: "__CHILE_NOW__"
  });
  if (!update.ok) return errorResponse("CASE_UPDATE_FAILED", update.warning, 409);

  await auditLog({ action: "case_closed", entityType: "case", entityId: id, before: caseResult.row, after: { reason } });
  return Response.json({ ok: true, message: "Caso cerrado" });
}

export async function reopenCase(id: string) {
  const caseResult = await getCaseById(id);
  if (!caseResult.ok) return errorResponse("DB_QUERY_ERROR", caseResult.error, 500);
  if (!caseResult.row) return caseNotFound(id);

  const writeAccess = await requireWriteAccess();
  if (writeAccess) return writeAccess;

  const update = await updateCaseLifecycle(id, {
    status: "human_required",
    lifecycle_status: "waiting_human",
    requires_human: 1,
    updated_at: "__CHILE_NOW__"
  });
  if (!update.ok) return errorResponse("CASE_UPDATE_FAILED", update.warning, 409);

  await auditLog({ action: "case_reopened", entityType: "case", entityId: id, before: caseResult.row });
  return Response.json({ ok: true, message: "Caso reabierto" });
}

export async function changePriority(id: string, priority: string) {
  if (!["low", "normal", "high", "urgent"].includes(priority)) {
    return errorResponse("VALIDATION_ERROR", "priority invalida", 400);
  }
  const caseResult = await getCaseById(id);
  if (!caseResult.ok) return errorResponse("DB_QUERY_ERROR", caseResult.error, 500);
  if (!caseResult.row) return caseNotFound(id);

  const writeAccess = await requireWriteAccess();
  if (writeAccess) return writeAccess;

  const update = await updateCaseLifecycle(id, { priority, updated_at: "__CHILE_NOW__" });
  if (!update.ok) return errorResponse("CASE_UPDATE_FAILED", update.warning, 409);

  await auditLog({
    action: "case_priority_changed",
    entityType: "case",
    entityId: id,
    before: { priority: caseResult.row.priority },
    after: { priority }
  });
  return Response.json({ ok: true, message: "Prioridad actualizada" });
}

export async function blockAi(id: string) {
  const caseResult = await getCaseById(id);
  if (!caseResult.ok) return errorResponse("DB_QUERY_ERROR", caseResult.error, 500);
  if (!caseResult.row) return caseNotFound(id);

  const writeAccess = await requireWriteAccess();
  if (writeAccess) return writeAccess;

  const columns = await getCaseTableColumns();
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
    const proposal =
      "ALTER TABLE n8n_conversation_cases ADD COLUMN ai_blocked TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN ai_blocked_at DATETIME NULL;";
    await auditLog({ action: "ai_blocked", entityType: "case", entityId: id, after: { applied: false, proposal } });
    return errorResponse(
      "AI_BLOCK_COLUMN_MISSING",
      "No existe una columna clara para bloquear IA/autorespuesta. No se aplico update silencioso.",
      409,
      { proposed_sql: proposal }
    );
  }

  const update = await updateCaseLifecycle(id, {
    [blockColumn]: 1,
    ai_blocked_at: "__CHILE_NOW__",
    updated_at: "__CHILE_NOW__"
  });
  if (!update.ok) return errorResponse("CASE_UPDATE_FAILED", update.warning, 409);

  await auditLog({ action: "ai_blocked", entityType: "case", entityId: id, after: { column: blockColumn } });
  return Response.json({ ok: true, message: "IA/autorespuesta bloqueada", column: blockColumn });
}
