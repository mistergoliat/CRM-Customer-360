"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.POST = POST;
const auth_1 = require("@/lib/auth");
const responseExecutor_1 = require("@/lib/brain/messaging/responseExecutor");
exports.dynamic = "force-dynamic";
async function POST(request) {
    const auth = await (0, auth_1.requireAiOrchestrationAccess)(request);
    if (!auth.ok)
        return auth.response;
    const startedAt = Date.now();
    let body = null;
    try {
        body = await request.json();
    }
    catch {
        body = null;
    }
    return Response.json(await (0, responseExecutor_1.resolveBrainExecution)(body, startedAt));
}
