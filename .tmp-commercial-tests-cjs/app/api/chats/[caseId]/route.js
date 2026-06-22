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
    const result = await (0, chats_1.getChatContext)(caseId);
    if (!result.ok) {
        return Response.json({ error: result.error }, { status: 500 });
    }
    if (!result.row) {
        return Response.json({ error: "Caso no encontrado" }, { status: 404 });
    }
    return Response.json(result.row);
}
