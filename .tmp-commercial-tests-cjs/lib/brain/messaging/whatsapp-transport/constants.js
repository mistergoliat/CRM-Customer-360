"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FAKE_WHATSAPP_HTTP_CLIENT_SCENARIOS = exports.WHATSAPP_TRANSPORT_SUPPORTED_COMMAND_TYPES = exports.WHATSAPP_TRANSPORT_SUPPORTED_CHANNEL = exports.WHATSAPP_TRANSPORT_PROVIDER_NAME = exports.WHATSAPP_TRANSPORT_VERSION = void 0;
exports.buildStableWhatsAppDigest = buildStableWhatsAppDigest;
exports.buildWhatsAppRequestId = buildWhatsAppRequestId;
exports.buildFakeWhatsAppProviderMessageId = buildFakeWhatsAppProviderMessageId;
exports.normalizeWhatsAppRecipientDigits = normalizeWhatsAppRecipientDigits;
exports.maskWhatsAppRecipient = maskWhatsAppRecipient;
exports.normalizeWhatsAppUrlSegment = normalizeWhatsAppUrlSegment;
exports.sanitizeWhatsAppTokenLikeValue = sanitizeWhatsAppTokenLikeValue;
const node_crypto_1 = require("node:crypto");
const autonomy_sandbox_1 = require("../../commercial/autonomy-sandbox");
exports.WHATSAPP_TRANSPORT_VERSION = "brain.messaging.whatsapp-transport.v1";
exports.WHATSAPP_TRANSPORT_PROVIDER_NAME = "whatsapp_cloud_api";
exports.WHATSAPP_TRANSPORT_SUPPORTED_CHANNEL = "whatsapp";
exports.WHATSAPP_TRANSPORT_SUPPORTED_COMMAND_TYPES = ["whatsapp_text"];
exports.FAKE_WHATSAPP_HTTP_CLIENT_SCENARIOS = [
    "accepted",
    "malformed_success",
    "invalid_recipient",
    "invalid_payload",
    "authentication_error",
    "permission_error",
    "policy_rejected",
    "rate_limited",
    "provider_unavailable",
    "timeout",
    "network_error",
    "duplicate_accepted",
    "unknown_error"
];
function buildStableWhatsAppDigest(payload) {
    return (0, node_crypto_1.createHash)("sha256").update(JSON.stringify(payload)).digest("hex");
}
function buildWhatsAppRequestId(commandId, idempotencyKey) {
    const digest = buildStableWhatsAppDigest({ commandId, idempotencyKey });
    return `whatsapp-request:${digest.slice(0, 24)}`;
}
function buildFakeWhatsAppProviderMessageId(input) {
    const digest = buildStableWhatsAppDigest(input);
    return `wamid.fake:${digest.slice(0, 24)}`;
}
function normalizeWhatsAppRecipientDigits(value) {
    if (value === null || value === undefined)
        return null;
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
function maskWhatsAppRecipient(value) {
    return (0, autonomy_sandbox_1.maskWaId)(normalizeWhatsAppRecipientDigits(value));
}
function normalizeWhatsAppUrlSegment(value) {
    return String(value ?? "")
        .trim()
        .replace(/^\/+/, "")
        .replace(/\/+$/, "");
}
function sanitizeWhatsAppTokenLikeValue(value) {
    return value
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\bBearer\s+[A-Za-z0-9._-]+\b/gi, "Bearer [redacted]")
        .replace(/\b[A-Za-z0-9_=-]{24,}\b/g, "[redacted]");
}
