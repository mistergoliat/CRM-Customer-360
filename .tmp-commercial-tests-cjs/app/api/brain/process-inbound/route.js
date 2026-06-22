"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.POST = POST;
const auth_1 = require("@/lib/auth");
const processInbound_1 = require("@/lib/brain/processInbound");
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
        return Response.json(await (0, processInbound_1.processInbound)(null, startedAt));
    }
    return Response.json(await (0, processInbound_1.processInbound)(body, startedAt));
}
