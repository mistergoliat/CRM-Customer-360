"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDbWriteEnabled = isDbWriteEnabled;
exports.dbWriteDisabledResponse = dbWriteDisabledResponse;
exports.canPersistTraceability = canPersistTraceability;
const db_1 = require("./db");
const action_policy_1 = require("./action-policy");
function isDbWriteEnabled() {
    return String(process.env.DB_WRITE_ENABLED || "false").toLowerCase() === "true";
}
function dbWriteDisabledResponse(status = 409) {
    return Response.json({
        code: action_policy_1.DB_WRITE_DISABLED_CODE,
        message: action_policy_1.DB_WRITE_DISABLED_MESSAGE
    }, { status });
}
async function canPersistTraceability() {
    const tables = await Promise.all([
        (0, db_1.hasTable)("n8n_conversation_cases"),
        (0, db_1.hasTable)("n8n_conversation_messages"),
        (0, db_1.hasTable)("hub_audit_log")
    ]);
    return {
        ok: tables.every(Boolean),
        details: {
            n8n_conversation_cases: tables[0],
            n8n_conversation_messages: tables[1],
            hub_audit_log: tables[2]
        }
    };
}
