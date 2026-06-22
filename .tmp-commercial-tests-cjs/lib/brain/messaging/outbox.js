"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BRAIN_MESSAGE_OUTBOX_MODEL_VERSION = exports.BRAIN_MESSAGE_OUTBOX_TABLE = void 0;
exports.buildOutboxPreview = buildOutboxPreview;
exports.buildOutboxRecord = buildOutboxRecord;
exports.findOutboxByDedupeKey = findOutboxByDedupeKey;
exports.createOutboxPlannedRecord = createOutboxPlannedRecord;
const db_1 = require("@/lib/db");
const dedupe_1 = require("./dedupe");
exports.BRAIN_MESSAGE_OUTBOX_TABLE = "brain_message_outbox";
exports.BRAIN_MESSAGE_OUTBOX_MODEL_VERSION = "brain.message-outbox.v1";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asString(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function asOptionalStringOrNumber(value) {
    if (value === undefined || value === null || value === "")
        return null;
    if (typeof value === "string" || typeof value === "number")
        return value;
    return null;
}
async function brainOutboxTableExists() {
    const rows = await (0, db_1.safeQueryRows)("SELECT 1 AS table_exists FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1", [exports.BRAIN_MESSAGE_OUTBOX_TABLE]);
    return rows.ok && rows.rows.length > 0;
}
function normalizeRecordJson(value) {
    if (!value)
        return null;
    return value;
}
function buildOutboxPreview(input) {
    return {
        dedupe_key: input.dedupeCheck.dedupe_key,
        channel: "whatsapp",
        status: input.status,
        action_type: input.actionType,
        duplicate_detected: input.dedupeCheck.duplicate_detected,
        reason: input.reason
    };
}
function buildOutboxRecord(input) {
    return {
        dedupe_key: (0, dedupe_1.buildDedupeKey)(input.dedupeKeyInput),
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
        message_hash: input.messageText ? (0, dedupe_1.hashMessageText)(input.messageText) : null,
        meta_payload_json: normalizeRecordJson(input.metaPayloadJson),
        provider_message_id: input.providerMessageId ?? null,
        error_code: input.errorCode ?? null,
        error_message: input.errorMessage ?? null
    };
}
function serializeMetaPayloadJson(value) {
    if (!value)
        return null;
    return JSON.stringify(value);
}
function rowToRecord(row) {
    const rawMetaPayload = row.meta_payload_json;
    let metaPayloadJson = null;
    if (isRecord(rawMetaPayload)) {
        metaPayloadJson = rawMetaPayload;
    }
    else if (typeof rawMetaPayload === "string" && rawMetaPayload.trim()) {
        try {
            const parsed = JSON.parse(rawMetaPayload);
            metaPayloadJson = isRecord(parsed) ? parsed : null;
        }
        catch {
            metaPayloadJson = null;
        }
    }
    return {
        id: typeof row.id === "number" ? row.id : Number(row.id ?? 0) || undefined,
        dedupe_key: asString(row.dedupe_key) ?? "",
        channel: "whatsapp",
        direction: "outbound",
        status: asString(row.status) ?? "planned",
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
async function findOutboxByDedupeKey(dedupeKey) {
    if (!(await brainOutboxTableExists())) {
        return { ok: false, row: null, warning: `Tabla ${exports.BRAIN_MESSAGE_OUTBOX_TABLE} no disponible` };
    }
    const rows = await (0, db_1.safeQueryRows)(`SELECT * FROM \`${exports.BRAIN_MESSAGE_OUTBOX_TABLE}\` WHERE dedupe_key = ? LIMIT 1`, [dedupeKey]);
    if (!rows.ok) {
        return { ok: false, row: null, warning: rows.error };
    }
    return { ok: true, row: rows.rows[0] ? rowToRecord(rows.rows[0]) : null };
}
async function createOutboxPlannedRecord(input) {
    if (!(await brainOutboxTableExists())) {
        return {
            ok: false,
            persisted: false,
            existing: false,
            row: null,
            warning: `Tabla ${exports.BRAIN_MESSAGE_OUTBOX_TABLE} no disponible`
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
    INSERT IGNORE INTO \`${exports.BRAIN_MESSAGE_OUTBOX_TABLE}\`
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
        const persistResult = await (0, db_1.withConnection)(async (connection) => {
            const [insertResult] = await connection.execute(sql, [
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
                const [insertedRows] = await connection.execute(`SELECT * FROM \`${exports.BRAIN_MESSAGE_OUTBOX_TABLE}\` WHERE id = ? LIMIT 1`, [insertResult.insertId]);
                return {
                    ok: true,
                    persisted: true,
                    existing: false,
                    row: insertedRows[0] ? rowToRecord(insertedRows[0]) : record
                };
            }
            const [existingRows] = await connection.execute(`SELECT * FROM \`${exports.BRAIN_MESSAGE_OUTBOX_TABLE}\` WHERE dedupe_key = ? LIMIT 1`, [record.dedupe_key]);
            return {
                ok: true,
                persisted: false,
                existing: true,
                row: existingRows[0] ? rowToRecord(existingRows[0]) : record,
                warning: "Duplicate outbox key reused."
            };
        });
        return persistResult;
    }
    catch (error) {
        return {
            ok: false,
            persisted: false,
            existing: false,
            row: null,
            warning: error instanceof Error ? error.message : String(error)
        };
    }
}
