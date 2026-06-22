"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const auth_1 = require("@/lib/auth");
const chats_1 = require("@/lib/chats");
async function GET(request, context) {
    const auth = await (0, auth_1.requireOperator)(request);
    if (!auth.ok)
        return auth.response;
    const { caseId } = await context.params;
    const result = await (0, chats_1.getChatMessages)(caseId);
    if (!result.ok) {
        const status = result.source === "missing" ? 404 : 500;
        return Response.json({ error: result.error }, { status });
    }
    return Response.json({
        source: result.source,
        rows: result.rows
    });
}
