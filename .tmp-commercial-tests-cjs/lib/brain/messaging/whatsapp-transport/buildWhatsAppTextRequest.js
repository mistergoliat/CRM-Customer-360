"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildWhatsAppTextRequest = buildWhatsAppTextRequest;
exports.buildSafeWhatsAppRequestSummary = buildSafeWhatsAppRequestSummary;
const constants_1 = require("./constants");
const validateWhatsAppTransportInput_1 = require("./validateWhatsAppTransportInput");
function buildAuthorizationHeader(accessToken) {
    return `Bearer ${accessToken.trim()}`;
}
function buildWhatsAppTextRequest(input, config) {
    const recipient = (0, validateWhatsAppTransportInput_1.normalizeWhatsAppRecipient)(input.recipient);
    if (!recipient) {
        throw new Error("invalid_recipient");
    }
    const requestId = (0, constants_1.buildWhatsAppRequestId)(input.commandId.trim(), input.idempotencyKey.trim());
    const baseUrl = (0, constants_1.normalizeWhatsAppUrlSegment)(config.graphBaseUrl);
    const apiVersion = (0, constants_1.normalizeWhatsAppUrlSegment)(config.graphApiVersion);
    const phoneNumberId = (0, constants_1.normalizeWhatsAppUrlSegment)(config.phoneNumberId);
    return {
        requestId,
        url: `${baseUrl}/${apiVersion}/${encodeURIComponent(phoneNumberId)}/messages`,
        method: "POST",
        headers: {
            Authorization: buildAuthorizationHeader(config.accessToken),
            "Content-Type": "application/json",
            "X-Idempotency-Key": input.idempotencyKey.trim()
        },
        body: {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: recipient,
            type: "text",
            text: {
                preview_url: false,
                body: input.messageText.trim()
            }
        },
        timeoutMs: Math.floor(config.timeoutMs),
        audit: {
            recipientMasked: (0, constants_1.maskWhatsAppRecipient)(recipient) ?? "",
            commandId: input.commandId.trim(),
            idempotencyKey: input.idempotencyKey.trim(),
            sandbox: true
        }
    };
}
function buildSafeWhatsAppRequestSummary(request) {
    return {
        requestId: request.requestId,
        commandId: request.audit.commandId,
        idempotencyKey: request.audit.idempotencyKey,
        url: request.url,
        method: request.method,
        recipientMasked: request.audit.recipientMasked,
        sandbox: true,
        timeoutMs: request.timeoutMs,
        bodyLength: JSON.stringify(request.body).length
    };
}
