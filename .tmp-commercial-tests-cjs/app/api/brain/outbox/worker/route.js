"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.POST = POST;
const auth_1 = require("@/lib/auth");
const outboxWorker_1 = require("@/lib/brain/messaging/outboxWorker");
exports.dynamic = "force-dynamic";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asBoolean(value) {
    if (typeof value === "boolean")
        return value;
    if (value === 1 || value === "1" || String(value).toLowerCase() === "true")
        return true;
    if (value === 0 || value === "0" || String(value).toLowerCase() === "false")
        return false;
    return undefined;
}
function asLimit(value) {
    if (typeof value !== "number" || !Number.isFinite(value))
        return undefined;
    const normalized = Math.floor(value);
    return normalized > 0 ? normalized : undefined;
}
function asOutboxId(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        const normalized = Math.floor(value);
        return normalized > 0 ? normalized : undefined;
    }
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed)) {
            const normalized = Math.floor(parsed);
            return normalized > 0 ? normalized : undefined;
        }
    }
    return undefined;
}
function normalizeRequest(input) {
    if (!isRecord(input))
        return null;
    return {
        requestId: typeof input.requestId === "string" ? input.requestId.trim() || undefined : undefined,
        dryRun: asBoolean(input.dryRun),
        lockOnly: asBoolean(input.lockOnly),
        sendLocked: asBoolean(input.sendLocked),
        outboxId: asOutboxId(input.outboxId),
        limit: asLimit(input.limit),
        debug: asBoolean(input.debug),
        metadata: isRecord(input.metadata) ? input.metadata : undefined
    };
}
function buildInvalidPayloadResponse() {
    return {
        ok: false,
        disabled: false,
        status: "failed",
        reason: "invalid_payload",
        error_code: "invalid_payload",
        error_message: "Request body must be an object.",
        blocked_reasons: ["invalid_payload"],
        warnings: ["Payload invalido para el worker de outbox."],
        dryRun: true,
        lockOnly: false,
        sendLocked: false,
        debug: false,
        locked_count: 0,
        sent_count: 0,
        failed_count: 0,
        skipped_count: 0,
        candidates: [],
        locked_records: [],
        skipped_records: [],
        sent_records: [],
        failed_records: [],
        plan: {
            mode: "failed",
            enabled: false,
            allowRealSend: false,
            dryRun: true,
            lockOnly: false,
            sendLocked: false,
            debug: false,
            limit: outboxWorker_1.DEFAULT_OUTBOX_WORKER_BATCH_SIZE,
            batchSize: outboxWorker_1.DEFAULT_OUTBOX_WORKER_BATCH_SIZE,
            lockSeconds: outboxWorker_1.DEFAULT_OUTBOX_WORKER_LOCK_SECONDS,
            candidateCount: 0,
            lockedCount: 0,
            skippedCount: 0,
            selectedCount: 0,
            sentCount: 0,
            failedCount: 0,
            candidates: [],
            lockedRecords: [],
            skippedRecords: [],
            sentRecords: [],
            failedRecords: [],
            transitionResults: [],
            blocked_reasons: ["invalid_payload"],
            warnings: ["Payload invalido para el worker de outbox."],
            notes: [
                "No DB query is executed for invalid payloads.",
                "The worker remains disabled until BRAIN_OUTBOX_WORKER_ENABLED=true."
            ]
        },
        metadata: {
            version: outboxWorker_1.BRAIN_OUTBOX_WORKER_VERSION,
            generatedAt: new Date().toISOString(),
            processingMs: 0,
            enabled: false,
            allowRealSend: false,
            dryRun: true,
            lockOnly: false,
            sendLocked: false,
            debug: false,
            limit: outboxWorker_1.DEFAULT_OUTBOX_WORKER_BATCH_SIZE,
            batchSize: outboxWorker_1.DEFAULT_OUTBOX_WORKER_BATCH_SIZE,
            lockSeconds: outboxWorker_1.DEFAULT_OUTBOX_WORKER_LOCK_SECONDS,
            outboxId: null
        }
    };
}
async function POST(request) {
    const auth = await (0, auth_1.requireAiOrchestrationAccess)(request);
    if (!auth.ok)
        return auth.response;
    let body = null;
    try {
        body = await request.json();
    }
    catch {
        body = null;
    }
    if (process.env.BRAIN_OUTBOX_WORKER_ENABLED?.trim() !== "true") {
        const response = await (0, outboxWorker_1.planOutboxWorkerRun)({});
        return Response.json(response, { status: 200 });
    }
    const normalized = normalizeRequest(body);
    if (!normalized) {
        return Response.json(buildInvalidPayloadResponse(), { status: 400 });
    }
    const response = await (0, outboxWorker_1.planOutboxWorkerRun)(normalized);
    const statusCode = response.status === "blocked" ? 409 : response.status === "failed" ? 503 : 200;
    return Response.json(response, { status: statusCode });
}
