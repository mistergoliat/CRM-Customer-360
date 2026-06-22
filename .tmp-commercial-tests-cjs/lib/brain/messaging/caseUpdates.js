"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BRAIN_UPDATE_CASE_AFTER_BACKEND_SEND_FLAG = exports.BRAIN_CASE_UPDATE_TABLE = void 0;
exports.updateCaseAfterBackendOutbound = updateCaseAfterBackendOutbound;
const db_1 = require("@/lib/db");
exports.BRAIN_CASE_UPDATE_TABLE = "n8n_conversation_cases";
exports.BRAIN_UPDATE_CASE_AFTER_BACKEND_SEND_FLAG = "BRAIN_UPDATE_CASE_AFTER_BACKEND_SEND";
function buildResult(status, caseId, updatedFields, warning) {
    const result = {
        status,
        case_id: caseId,
        updated_fields: updatedFields
    };
    if (warning)
        result.warning = warning;
    return result;
}
function buildUpdateValues(columns, input) {
    const values = {};
    const updatedFields = [];
    const warnings = [];
    const canonicalMessageId = input.canonicalMessageId ?? null;
    if (columns.includes("updated_at")) {
        values.updated_at = "__CHILE_NOW__";
        updatedFields.push("updated_at");
    }
    if (columns.includes("last_message_at")) {
        values.last_message_at = "__CHILE_NOW__";
        updatedFields.push("last_message_at");
    }
    if (columns.includes("last_outbound_at")) {
        values.last_outbound_at = "__CHILE_NOW__";
        updatedFields.push("last_outbound_at");
    }
    if (columns.includes("bot_replied")) {
        values.bot_replied = 1;
        updatedFields.push("bot_replied");
    }
    if (columns.includes("final_action")) {
        values.final_action = "reply";
        updatedFields.push("final_action");
    }
    if (columns.includes("last_message_id") && canonicalMessageId !== null) {
        values.last_message_id = canonicalMessageId;
        updatedFields.push("last_message_id");
    }
    else if (input.canonicalPersistenceEnabled && canonicalMessageId === null) {
        warnings.push("canonical_message_id no disponible; last_message_id no fue actualizado.");
    }
    return { values, updatedFields, warnings };
}
function buildUpdateSql(values) {
    const assignments = [];
    const params = [];
    for (const [column, value] of Object.entries(values)) {
        if (value === undefined)
            continue;
        if (value === "__CHILE_NOW__") {
            assignments.push(`\`${column}\` = ${(0, db_1.chileNowSql)()}`);
            continue;
        }
        assignments.push(`\`${column}\` = ?`);
        params.push(value);
    }
    return { assignments, params };
}
async function updateCaseRow(caseId, values, columns) {
    const whereColumn = columns.includes("conversation_case_id") ? "conversation_case_id" : columns.includes("id") ? "id" : null;
    if (!whereColumn) {
        return { ok: false, warning: `No existe columna WHERE utilizable en ${exports.BRAIN_CASE_UPDATE_TABLE}` };
    }
    const existence = await (0, db_1.safeQueryRows)(`SELECT 1 AS exists_row FROM \`${exports.BRAIN_CASE_UPDATE_TABLE}\` WHERE \`${whereColumn}\` = ? LIMIT 1`, [caseId]);
    if (!existence.ok) {
        return { ok: false, warning: existence.error };
    }
    if (existence.rows.length === 0) {
        return { ok: false, warning: `Caso ${caseId} no encontrado en ${exports.BRAIN_CASE_UPDATE_TABLE}` };
    }
    const { assignments, params } = buildUpdateSql(values);
    if (assignments.length === 0) {
        return { ok: false, warning: `Sin columnas actualizables en ${exports.BRAIN_CASE_UPDATE_TABLE}` };
    }
    const sql = `UPDATE \`${exports.BRAIN_CASE_UPDATE_TABLE}\` SET ${assignments.join(", ")} WHERE \`${whereColumn}\` = ?`;
    return (0, db_1.withConnection)(async (connection) => {
        const [updateResult] = await connection.execute(sql, [...params, caseId]);
        return {
            ok: true,
            affectedRows: updateResult.affectedRows
        };
    });
}
async function updateCaseAfterBackendOutbound(input) {
    const caseId = input.conversationCaseId;
    if (input.enabled !== true) {
        return buildResult("skipped_by_flag", caseId, []);
    }
    if (caseId === null || caseId === undefined || caseId === "") {
        return buildResult("skipped_no_case_id", null, []);
    }
    if (input.canonicalPersistenceEnabled) {
        const canonicalStatus = input.canonicalPersistResult?.status ?? null;
        if (canonicalStatus !== "persisted" && canonicalStatus !== "existing") {
            return buildResult("skipped_no_canonical_message", caseId, [], "Canonical outbound message was not persisted.");
        }
    }
    const columns = await (0, db_1.getColumns)(exports.BRAIN_CASE_UPDATE_TABLE);
    if (columns.length === 0) {
        return buildResult("warning", caseId, [], `Tabla ${exports.BRAIN_CASE_UPDATE_TABLE} no disponible`);
    }
    const { values, updatedFields, warnings } = buildUpdateValues(columns, input);
    const updateResult = await updateCaseRow(caseId, values, columns);
    if (!updateResult.ok) {
        return buildResult("warning", caseId, updatedFields, updateResult.warning);
    }
    const resultWarnings = [...warnings];
    if (input.debug && updateResult.affectedRows === 0) {
        resultWarnings.push("Case update executed but MySQL reported 0 affected rows; this can be idempotent when values were unchanged.");
    }
    return buildResult("updated", caseId, updatedFields, resultWarnings.length > 0 ? resultWarnings.join(" ") : undefined);
}
