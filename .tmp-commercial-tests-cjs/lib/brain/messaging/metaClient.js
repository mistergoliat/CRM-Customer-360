"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_META_GRAPH_VERSION = exports.DEFAULT_META_SEND_TIMEOUT_MS = void 0;
exports.getMetaAccessToken = getMetaAccessToken;
exports.getMetaDefaultPhoneNumberId = getMetaDefaultPhoneNumberId;
exports.buildMetaGraphUrl = buildMetaGraphUrl;
exports.postMetaWhatsAppTextMessage = postMetaWhatsAppTextMessage;
exports.sendMetaWhatsAppTextMessage = sendMetaWhatsAppTextMessage;
const metaPayload_1 = require("./metaPayload");
exports.DEFAULT_META_SEND_TIMEOUT_MS = 8000;
exports.DEFAULT_META_GRAPH_VERSION = "v25.0";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asTrimmedString(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function normalizeTimeoutMs(timeoutMs) {
    if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs))
        return exports.DEFAULT_META_SEND_TIMEOUT_MS;
    return Math.min(Math.max(Math.floor(timeoutMs), 1000), 30000);
}
function getMetaGraphVersion() {
    return process.env.BRAIN_META_GRAPH_VERSION?.trim() || exports.DEFAULT_META_GRAPH_VERSION;
}
function getMetaAccessToken() {
    return process.env.META_WHATSAPP_ACCESS_TOKEN?.trim() || null;
}
function getMetaDefaultPhoneNumberId() {
    return process.env.META_WHATSAPP_DEFAULT_PHONE_NUMBER_ID?.trim() || null;
}
function buildMetaGraphUrl(phoneNumberId) {
    return `https://graph.facebook.com/${encodeURIComponent(getMetaGraphVersion())}/${encodeURIComponent(phoneNumberId.trim())}/messages`;
}
function buildInvalidPayloadResponse(message, metaPayloadPreview) {
    return {
        ok: false,
        status: "invalid_payload",
        error_code: "invalid_payload",
        error_message: message,
        blocked_reasons: ["invalid_payload"],
        warnings: [message],
        meta_payload_preview: metaPayloadPreview ?? null,
        response_body: null
    };
}
function buildDisabledResponse(metaPayloadPreview) {
    return {
        ok: false,
        status: "disabled",
        error_code: "disabled",
        error_message: "BRAIN_META_SEND_ENABLED=false",
        blocked_reasons: ["meta_send_disabled"],
        warnings: ["Meta send adapter is disabled by default."],
        meta_payload_preview: metaPayloadPreview ?? null,
        response_body: null
    };
}
function buildMissingCredentialsResponse(metaPayloadPreview, detail) {
    return {
        ok: false,
        status: "missing_credentials",
        error_code: "missing_credentials",
        error_message: detail,
        blocked_reasons: ["missing_credentials"],
        warnings: [detail],
        meta_payload_preview: metaPayloadPreview ?? null,
        response_body: null
    };
}
function buildFailedResponse(status, errorCode, errorMessage, metaPayloadPreview, httpStatus, responseBody) {
    return {
        ok: false,
        status,
        error_code: errorCode,
        error_message: errorMessage,
        blocked_reasons: [errorCode],
        warnings: [errorMessage],
        http_status: httpStatus ?? null,
        provider_message_id: null,
        meta_payload_preview: metaPayloadPreview ?? null,
        response_body: responseBody ?? null
    };
}
function extractProviderMessageId(body) {
    if (!isRecord(body))
        return null;
    const messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0)
        return null;
    const firstMessage = messages[0];
    if (!isRecord(firstMessage))
        return null;
    return asTrimmedString(firstMessage.id) ?? asTrimmedString(firstMessage.message_id);
}
function sanitizeResponseBody(body) {
    if (!isRecord(body))
        return null;
    return body;
}
async function postMetaWhatsAppTextMessage(input) {
    const waId = asTrimmedString(input.waId);
    const phoneNumberId = asTrimmedString(input.phoneNumberId);
    const messageText = asTrimmedString(input.messageText);
    const metaPayloadPreview = waId && messageText ? (0, metaPayload_1.buildMetaWhatsAppTextPayloadPreview)({ waId, messageText }) : null;
    if (process.env.BRAIN_META_SEND_ENABLED?.trim() !== "true") {
        return buildDisabledResponse(metaPayloadPreview);
    }
    if (!waId || !phoneNumberId || !messageText) {
        return buildInvalidPayloadResponse("waId, phoneNumberId y messageText son obligatorios.", metaPayloadPreview);
    }
    const accessToken = getMetaAccessToken();
    const defaultPhoneNumberId = getMetaDefaultPhoneNumberId();
    if (!accessToken || !defaultPhoneNumberId) {
        return buildMissingCredentialsResponse(metaPayloadPreview, "META_WHATSAPP_ACCESS_TOKEN o META_WHATSAPP_DEFAULT_PHONE_NUMBER_ID no configurado");
    }
    const timeoutMs = normalizeTimeoutMs(input.timeoutMs);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(buildMetaGraphUrl(phoneNumberId), {
            method: "POST",
            headers: {
                authorization: `Bearer ${accessToken}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                to: waId,
                type: "text",
                text: {
                    body: messageText
                }
            }),
            signal: controller.signal
        });
        const responseBody = await response.json().catch(() => null);
        if (!response.ok) {
            let message = `Meta Graph API HTTP ${response.status}`;
            if (isRecord(responseBody) && isRecord(responseBody.error) && typeof responseBody.error.message === "string") {
                message = responseBody.error.message;
            }
            return buildFailedResponse("failed", "meta_http_error", message, metaPayloadPreview, response.status, sanitizeResponseBody(responseBody));
        }
        return {
            ok: true,
            status: "sent",
            error_code: null,
            error_message: null,
            blocked_reasons: [],
            warnings: [],
            http_status: response.status,
            provider_message_id: extractProviderMessageId(responseBody),
            meta_payload_preview: metaPayloadPreview,
            response_body: sanitizeResponseBody(responseBody)
        };
    }
    catch (error) {
        const isAbortError = error instanceof Error &&
            (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"));
        return buildFailedResponse("failed", "meta_network_error", isAbortError ? `Meta send timeout after ${timeoutMs}ms` : error instanceof Error ? error.message : String(error), metaPayloadPreview);
    }
    finally {
        clearTimeout(timeout);
    }
}
async function sendMetaWhatsAppTextMessage(input) {
    return postMetaWhatsAppTextMessage(input);
}
