"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.POST = POST;
const auth_1 = require("@/lib/auth");
const runAgent_1 = require("@/lib/brain/agents/runAgent");
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
            agentName: "knowledge",
            agentVersion: "brain.agent.knowledge.v1",
            outputSchema: "brain.agent.output.v1",
            decision: "blocked",
            message: "Request body must be valid JSON.",
            toolRequests: [],
            confidence: 0,
            safetyFlags: ["invalid_json"],
            validationErrors: [
                {
                    code: "INVALID_INPUT",
                    message: "Request body must be valid JSON.",
                    retryable: true
                }
            ],
            warnings: [],
            contextPacksUsed: [],
            metadata: {
                version: "brain.agent.runtime.v1",
                generatedAt: new Date().toISOString(),
                processingMs: Date.now() - startedAt,
                dryRun: true,
                debug: false,
                modelName: "disabled",
                modelVersion: "brain.model.disabled.v1",
                logStatus: "skipped"
            }
        }, { status: 400 });
    }
    const response = await (0, runAgent_1.runAgent)(body, startedAt);
    return Response.json(response, { status: response.ok ? 200 : 400 });
}
