"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.POST = POST;
const auth_1 = require("@/lib/auth");
const actionRouter_1 = require("@/lib/brain/actions/actionRouter");
exports.dynamic = "force-dynamic";
async function POST(request) {
    const auth = await (0, auth_1.requireAiOrchestrationAccess)(request);
    if (!auth.ok)
        return auth.response;
    const startedAt = Date.now();
    let body;
    try {
        body = await request.json();
    }
    catch {
        return Response.json(await (0, actionRouter_1.resolveBrainAction)(null, startedAt), { status: 400 });
    }
    const response = await (0, actionRouter_1.resolveBrainAction)(body, startedAt);
    return Response.json(response, { status: response.ok ? 200 : 400 });
}
