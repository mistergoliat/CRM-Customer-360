"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.POST = POST;
const auth_1 = require("@/lib/auth");
const metaSendAdapter_1 = require("@/lib/brain/messaging/metaSendAdapter");
exports.dynamic = "force-dynamic";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asTrimmedString(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function normalizeRequest(input) {
    if (!isRecord(input))
        return null;
    const waId = asTrimmedString(input.waId);
    const phoneNumberId = asTrimmedString(input.phoneNumberId);
    const messageText = asTrimmedString(input.messageText);
    if (!waId || !phoneNumberId || !messageText)
        return null;
    return {
        waId,
        phoneNumberId,
        messageText,
        timeoutMs: typeof input.timeoutMs === "number" ? input.timeoutMs : undefined,
        source: asTrimmedString(input.source),
        sourceRequestId: asTrimmedString(input.sourceRequestId),
        conversationCaseId: typeof input.conversationCaseId === "string" || typeof input.conversationCaseId === "number"
            ? input.conversationCaseId
            : undefined,
        actionPolicy: isRecord(input.actionPolicy) ? input.actionPolicy : undefined,
        botEligibility: isRecord(input.botEligibility) ? input.botEligibility : undefined,
        metadata: isRecord(input.metadata) ? input.metadata : undefined
    };
}
function buildDisabledResponse(errorMessage) {
    return {
        ok: false,
        status: "disabled",
        error_code: "disabled",
        error_message: errorMessage,
        blocked_reasons: ["meta_send_test_disabled"],
        warnings: ["El endpoint de prueba Meta esta deshabilitado por defecto."],
        meta_payload_preview: null,
        response_body: null,
        adapter_status: "disabled"
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
    if (process.env.BRAIN_META_SEND_TEST_ENABLED?.trim() !== "true") {
        return Response.json(buildDisabledResponse("BRAIN_META_SEND_TEST_ENABLED=false"), { status: 200 });
    }
    const normalized = normalizeRequest(body);
    if (!normalized) {
        return Response.json({
            ok: false,
            status: "invalid_payload",
            error_code: "invalid_payload",
            error_message: "waId, phoneNumberId y messageText son obligatorios.",
            blocked_reasons: ["invalid_payload"],
            warnings: ["Request body invalido o incompleto."],
            meta_payload_preview: null,
            response_body: null
        }, { status: 400 });
    }
    const guard = (0, metaSendAdapter_1.validateMetaSendGuards)(normalized);
    if (!guard.ok) {
        return Response.json({
            ok: false,
            status: guard.errorCode ?? "failed",
            error_code: guard.errorCode,
            error_message: guard.errorMessage,
            blocked_reasons: guard.blockedReasons,
            warnings: guard.warnings,
            meta_payload_preview: guard.metaPayloadPreview,
            response_body: null,
            adapter_status: guard.adapterStatus
        }, { status: 200 });
    }
    const result = await (0, metaSendAdapter_1.sendMetaWhatsAppTextMessage)(normalized);
    return Response.json(result);
}
