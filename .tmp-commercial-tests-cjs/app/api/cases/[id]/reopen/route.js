"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const auth_1 = require("@/lib/auth");
const audit_1 = require("@/lib/audit");
const caseActions_1 = require("@/lib/caseActions");
async function POST(request, context) {
    const auth = await (0, auth_1.requireOperator)(request);
    if (!auth.ok)
        return auth.response;
    const { id } = await context.params;
    try {
        return await (0, caseActions_1.reopenCase)(id);
    }
    catch (error) {
        await (0, audit_1.auditLog)({ action: "api_error", entityType: "case", entityId: id, after: { error: error instanceof Error ? error.message : String(error) } });
        return Response.json({ error: "Error interno al reabrir caso" }, { status: 500 });
    }
}
