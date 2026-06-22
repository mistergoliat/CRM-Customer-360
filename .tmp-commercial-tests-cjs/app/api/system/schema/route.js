"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const TABLES = [
    "n8n_vw_hub_cases",
    "n8n_conversation_cases",
    "n8n_conversation_messages",
    "n8n_wa_inbound_messages",
    "hub_audit_log"
];
async function GET(request) {
    const auth = await (0, auth_1.requireOperator)(request);
    if (!auth.ok)
        return auth.response;
    const result = await Promise.all(TABLES.map(async (table) => {
        const columns = await (0, db_1.getColumns)(table);
        const count = await (0, db_1.safeScalar)(`SELECT COUNT(*) AS total FROM \`${table}\``);
        const sample = await (0, db_1.safeQueryRows)(`SELECT * FROM \`${table}\` LIMIT 1`);
        return {
            table,
            exists: columns.length > 0,
            count: count.ok ? Number(count.value ?? 0) : null,
            countError: count.ok ? null : count.error,
            columns,
            sampleKeys: sample.ok && sample.rows[0] ? Object.keys(sample.rows[0]) : [],
            sampleError: sample.ok ? null : sample.error
        };
    }));
    return Response.json({ tables: result });
}
