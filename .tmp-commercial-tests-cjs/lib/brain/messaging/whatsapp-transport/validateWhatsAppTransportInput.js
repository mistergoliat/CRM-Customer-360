"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeWhatsAppRecipient = normalizeWhatsAppRecipient;
exports.validateWhatsAppTransportInput = validateWhatsAppTransportInput;
const autonomy_sandbox_1 = require("../../commercial/autonomy-sandbox");
const constants_1 = require("./constants");
function asTrimmedString(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function isValidTimestamp(value) {
    if (typeof value !== "string")
        return false;
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime());
}
function isRawJsonLikeMessage(message) {
    const trimmed = message.trim();
    if (!trimmed)
        return false;
    if (trimmed.startsWith("{") || trimmed.startsWith("["))
        return true;
    if (trimmed.includes('"messaging_product"') || trimmed.includes('"recipient_type"') || trimmed.includes('"preview_url"'))
        return true;
    try {
        const parsed = JSON.parse(trimmed);
        return typeof parsed === "object" && parsed !== null;
    }
    catch {
        return false;
    }
}
function hasUnresolvedPlaceholder(message) {
    return /\{\{[^}]+\}\}|\$\{[^}]+\}|<<[^>]+>>/.test(message);
}
function hasCredentialLikeContent(message) {
    return /\bBearer\s+[A-Za-z0-9._-]+\b/i.test(message) || /\b(access[_-]?token|authorization|password|secret)\b/i.test(message);
}
function buildFailureResult(input) {
    return {
        ok: false,
        requestId: input.requestId,
        normalizedRecipient: null,
        recipientMasked: input.recipientMasked,
        errorCode: input.errorCode,
        errorMessageSafe: input.errorMessageSafe,
        warnings: [input.errorMessageSafe, ...(input.warnings ?? [])].filter((value) => Boolean(value))
    };
}
function isExactWhitelistMatch(recipient, allowedRecipients) {
    return allowedRecipients.map((value) => (0, constants_1.normalizeWhatsAppRecipientDigits)(value)).filter((value) => Boolean(value)).includes(recipient);
}
function normalizeWhatsAppRecipient(value) {
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    if (!/^[\d\s()+-]+$/.test(trimmed))
        return null;
    const stripped = trimmed
        .replace(/[\s()-]+/g, "")
        .replace(/^\++/, "");
    if (!/^\d+$/.test(stripped))
        return null;
    return stripped;
}
function validateWhatsAppTransportInput(input, config) {
    const commandId = asTrimmedString(input.commandId);
    const idempotencyKey = asTrimmedString(input.idempotencyKey);
    const recipientMasked = (0, autonomy_sandbox_1.maskWaId)(input.recipient);
    const requestedRecipient = asTrimmedString(input.recipient);
    const messageText = asTrimmedString(input.messageText);
    const attemptedAt = asTrimmedString(input.attemptedAt);
    const requestId = commandId && idempotencyKey ? (0, constants_1.buildWhatsAppRequestId)(commandId, idempotencyKey) : null;
    if (!config.enabled) {
        return buildFailureResult({
            requestId,
            recipientMasked,
            errorCode: "policy_rejected",
            errorMessageSafe: "WhatsApp transport is disabled."
        });
    }
    if (!config.sandbox || !input.sandbox) {
        return buildFailureResult({
            requestId,
            recipientMasked,
            errorCode: "policy_rejected",
            errorMessageSafe: "Sandbox mode is required for WhatsApp transport."
        });
    }
    if (!config.requireExactWhitelistMatch) {
        return buildFailureResult({
            requestId,
            recipientMasked,
            errorCode: "policy_rejected",
            errorMessageSafe: "Exact recipient whitelist matching is required."
        });
    }
    if (!commandId) {
        return buildFailureResult({
            requestId,
            recipientMasked,
            errorCode: "invalid_payload",
            errorMessageSafe: "commandId is required."
        });
    }
    if (!idempotencyKey) {
        return buildFailureResult({
            requestId,
            recipientMasked,
            errorCode: "invalid_payload",
            errorMessageSafe: "idempotencyKey is required."
        });
    }
    if (input.channel !== "whatsapp") {
        return buildFailureResult({
            requestId,
            recipientMasked,
            errorCode: "invalid_payload",
            errorMessageSafe: "Only the whatsapp channel is supported."
        });
    }
    if (input.commandType !== "whatsapp_text") {
        return buildFailureResult({
            requestId,
            recipientMasked,
            errorCode: "invalid_payload",
            errorMessageSafe: "Only whatsapp_text commands are supported."
        });
    }
    if (!requestedRecipient) {
        return buildFailureResult({
            requestId,
            recipientMasked: null,
            errorCode: "invalid_recipient",
            errorMessageSafe: "Recipient is required."
        });
    }
    const normalizedRecipient = normalizeWhatsAppRecipient(requestedRecipient);
    if (!normalizedRecipient) {
        return buildFailureResult({
            requestId,
            recipientMasked,
            errorCode: "invalid_recipient",
            errorMessageSafe: "Recipient format is invalid."
        });
    }
    const normalizedAllowedRecipients = config.allowedRecipients
        .map((value) => (0, constants_1.normalizeWhatsAppRecipientDigits)(value))
        .filter((value) => Boolean(value));
    if (normalizedAllowedRecipients.length === 0 || !isExactWhitelistMatch(normalizedRecipient, config.allowedRecipients)) {
        return buildFailureResult({
            requestId,
            recipientMasked: (0, autonomy_sandbox_1.maskWaId)(normalizedRecipient),
            errorCode: "invalid_recipient",
            errorMessageSafe: "Recipient is not whitelisted."
        });
    }
    if (!messageText) {
        return buildFailureResult({
            requestId,
            recipientMasked: (0, autonomy_sandbox_1.maskWaId)(normalizedRecipient),
            errorCode: "invalid_payload",
            errorMessageSafe: "messageText is required."
        });
    }
    if (messageText.length > config.maxTextLength) {
        return buildFailureResult({
            requestId,
            recipientMasked: (0, autonomy_sandbox_1.maskWaId)(normalizedRecipient),
            errorCode: "invalid_payload",
            errorMessageSafe: "messageText exceeds the configured maximum length."
        });
    }
    if (hasUnresolvedPlaceholder(messageText)) {
        return buildFailureResult({
            requestId,
            recipientMasked: (0, autonomy_sandbox_1.maskWaId)(normalizedRecipient),
            errorCode: "invalid_payload",
            errorMessageSafe: "messageText contains unresolved placeholders."
        });
    }
    if (isRawJsonLikeMessage(messageText)) {
        return buildFailureResult({
            requestId,
            recipientMasked: (0, autonomy_sandbox_1.maskWaId)(normalizedRecipient),
            errorCode: "invalid_payload",
            errorMessageSafe: "messageText must not contain a raw JSON payload."
        });
    }
    if (hasCredentialLikeContent(messageText)) {
        return buildFailureResult({
            requestId,
            recipientMasked: (0, autonomy_sandbox_1.maskWaId)(normalizedRecipient),
            errorCode: "invalid_payload",
            errorMessageSafe: "messageText contains blocked credential-like content."
        });
    }
    if (!requestedRecipient || !normalizedRecipient) {
        return buildFailureResult({
            requestId,
            recipientMasked,
            errorCode: "invalid_recipient",
            errorMessageSafe: "Recipient is required."
        });
    }
    if (!config.graphBaseUrl.trim() || !config.graphApiVersion.trim() || !config.phoneNumberId.trim()) {
        return buildFailureResult({
            requestId,
            recipientMasked: (0, autonomy_sandbox_1.maskWaId)(normalizedRecipient),
            errorCode: "invalid_payload",
            errorMessageSafe: "WhatsApp Graph configuration is incomplete."
        });
    }
    if (!config.accessToken.trim()) {
        return buildFailureResult({
            requestId,
            recipientMasked: (0, autonomy_sandbox_1.maskWaId)(normalizedRecipient),
            errorCode: "authentication_error",
            errorMessageSafe: "WhatsApp access token is required."
        });
    }
    if (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0) {
        return buildFailureResult({
            requestId,
            recipientMasked: (0, autonomy_sandbox_1.maskWaId)(normalizedRecipient),
            errorCode: "invalid_payload",
            errorMessageSafe: "timeoutMs must be a positive finite number."
        });
    }
    if (!isValidTimestamp(attemptedAt)) {
        return buildFailureResult({
            requestId,
            recipientMasked: (0, autonomy_sandbox_1.maskWaId)(normalizedRecipient),
            errorCode: "invalid_payload",
            errorMessageSafe: "attemptedAt must be a valid ISO timestamp."
        });
    }
    return {
        ok: true,
        requestId,
        normalizedRecipient,
        recipientMasked: (0, autonomy_sandbox_1.maskWaId)(normalizedRecipient),
        errorCode: null,
        errorMessageSafe: null,
        warnings: []
    };
}
