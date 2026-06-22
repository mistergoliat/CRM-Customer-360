"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const auth_1 = require("@/lib/auth");
const chats_1 = require("@/lib/chats");
async function GET(request) {
    const auth = await (0, auth_1.requireOperator)(request);
    if (!auth.ok)
        return auth.response;
    const { searchParams } = new URL(request.url);
    const page = Number(searchParams.get("page") || 1);
    const q = searchParams.get("q") || "";
    const result = await (0, chats_1.listChats)({ page, q });
    return Response.json(result);
}
