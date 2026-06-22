"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.POST = POST;
const auth_1 = require("@/lib/auth");
const legacyAdapters_1 = require("@/lib/brain/context/legacyAdapters");
const resolveContext_1 = require("@/lib/brain/context/resolveContext");
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
        return Response.json({
            ok: false,
            partial_context: false,
            errors: [
                {
                    code: "INVALID_INPUT",
                    message: "Request body must be valid JSON.",
                    retryable: true
                }
            ],
            warnings: []
        }, { status: 400 });
    }
    const normalized = (0, legacyAdapters_1.normalizeBrainContextResolveRequest)(body);
    if (!normalized.ok) {
        return Response.json({
            ok: false,
            partial_context: false,
            errors: normalized.errors,
            warnings: []
        }, { status: 400 });
    }
    const response = await (0, resolveContext_1.resolveBackendBrainContext)(normalized.value, startedAt);
    return Response.json(response, { status: response.ok ? 200 : 503 });
}
