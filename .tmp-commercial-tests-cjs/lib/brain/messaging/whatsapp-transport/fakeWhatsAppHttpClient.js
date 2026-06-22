"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FakeWhatsAppHttpClient = void 0;
const constants_1 = require("./constants");
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asTrimmedString(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function getRecordField(value, key) {
    if (!value)
        return undefined;
    return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
}
function scenarioStatusCode(scenario) {
    switch (scenario) {
        case "accepted":
        case "duplicate_accepted":
        case "malformed_success":
            return 200;
        case "invalid_recipient":
        case "invalid_payload":
        case "policy_rejected":
            return 400;
        case "authentication_error":
            return 401;
        case "permission_error":
            return 403;
        case "rate_limited":
            return 429;
        case "provider_unavailable":
            return 503;
        case "timeout":
        case "network_error":
        case "unknown_error":
            return 0;
    }
    return 0;
}
function scenarioBody(input) {
    const providerMessageId = (0, constants_1.buildFakeWhatsAppProviderMessageId)({
        requestId: input.requestId,
        commandId: input.commandId,
        idempotencyKey: input.idempotencyKey
    });
    switch (input.scenario) {
        case "accepted":
            return {
                messaging_product: "whatsapp",
                contacts: [{ input: input.recipient, wa_id: input.recipient }],
                messages: [{ id: providerMessageId }]
            };
        case "duplicate_accepted":
            return {
                messaging_product: "whatsapp",
                duplicate_accepted: true,
                contacts: [{ input: input.recipient, wa_id: input.recipient }],
                messages: [{ id: providerMessageId, duplicate_accepted: true }]
            };
        case "malformed_success":
            return {
                messaging_product: "whatsapp",
                contacts: [{ input: input.recipient, wa_id: input.recipient }]
            };
        case "invalid_recipient":
            return {
                error: {
                    message: "Invalid recipient.",
                    type: "invalid_recipient",
                    code: "invalid_recipient",
                    fbtrace_id: `fbtrace-${providerMessageId.slice(-12)}`
                }
            };
        case "invalid_payload":
            return {
                error: {
                    message: "Invalid payload.",
                    type: "invalid_payload",
                    code: "invalid_payload",
                    fbtrace_id: `fbtrace-${providerMessageId.slice(-12)}`
                }
            };
        case "authentication_error":
            return {
                error: {
                    message: "Authentication error.",
                    type: "authentication_error",
                    code: "authentication_error",
                    fbtrace_id: `fbtrace-${providerMessageId.slice(-12)}`
                }
            };
        case "permission_error":
            return {
                error: {
                    message: "Permission error.",
                    type: "permission_error",
                    code: "permission_error",
                    fbtrace_id: `fbtrace-${providerMessageId.slice(-12)}`
                }
            };
        case "policy_rejected":
            return {
                error: {
                    message: "Policy rejected.",
                    type: "policy_rejected",
                    code: "policy_rejected",
                    fbtrace_id: `fbtrace-${providerMessageId.slice(-12)}`
                }
            };
        case "rate_limited":
            return {
                error: {
                    message: "Rate limited.",
                    type: "rate_limited",
                    code: "rate_limited",
                    fbtrace_id: `fbtrace-${providerMessageId.slice(-12)}`
                }
            };
        case "provider_unavailable":
            return {
                error: {
                    message: "Provider unavailable.",
                    type: "provider_unavailable",
                    code: "provider_unavailable",
                    fbtrace_id: `fbtrace-${providerMessageId.slice(-12)}`
                }
            };
        case "unknown_error":
            return {
                error: {
                    message: "Unknown provider error.",
                    type: "unknown_error",
                    code: "unknown_error",
                    fbtrace_id: `fbtrace-${providerMessageId.slice(-12)}`
                }
            };
        case "timeout":
        case "network_error":
            return null;
    }
}
function buildHeaders(input) {
    const headers = {
        "x-request-id": input.requestId
    };
    if (input.scenario === "rate_limited") {
        headers["retry-after"] = String(input.explicitRetryAfterSeconds ?? 120);
    }
    return headers;
}
function clone(value) {
    return structuredClone(value);
}
function resolveScenario(input, config) {
    const body = isRecord(input.body) ? input.body : null;
    const metadata = isRecord(getRecordField(body, "metadata")) ? getRecordField(body, "metadata") : null;
    const commandId = asTrimmedString(getRecordField(body, "commandId")) ?? asTrimmedString(getRecordField(metadata, "commandId")) ?? input.requestId;
    const idempotencyKey = asTrimmedString(input.headers["X-Idempotency-Key"]) ??
        asTrimmedString(input.headers["x-idempotency-key"]) ??
        asTrimmedString(getRecordField(body, "idempotencyKey")) ??
        input.requestId;
    return (config.scenarioByRequestId?.[input.requestId] ??
        config.scenarioByIdempotencyKey?.[idempotencyKey] ??
        config.scenarioByCommandId?.[commandId] ??
        config.defaultScenario ??
        "accepted");
}
class FakeWhatsAppHttpClient {
    rawRequestsForTests = [];
    safeRequestLog = [];
    config;
    constructor(config = {}) {
        this.config = { ...config };
    }
    snapshotSafeLog() {
        return this.safeRequestLog.map((entry) => ({ ...entry }));
    }
    snapshotRawRequestsForTests() {
        return this.rawRequestsForTests.map((entry) => ({
            ...entry,
            headers: { ...entry.headers },
            body: clone(entry.body)
        }));
    }
    async postJson(input) {
        const scenario = resolveScenario(input, this.config);
        this.rawRequestsForTests.push({
            url: input.url,
            headers: clone(input.headers),
            body: clone(input.body),
            timeoutMs: input.timeoutMs,
            requestId: input.requestId
        });
        const body = isRecord(input.body) ? input.body : null;
        const metadata = isRecord(getRecordField(body, "metadata")) ? getRecordField(body, "metadata") : null;
        const text = isRecord(getRecordField(body, "text")) ? getRecordField(body, "text") : null;
        const commandId = asTrimmedString(getRecordField(body, "commandId")) ?? asTrimmedString(getRecordField(metadata, "commandId")) ?? input.requestId;
        const idempotencyKey = asTrimmedString(input.headers["X-Idempotency-Key"]) ?? asTrimmedString(input.headers["x-idempotency-key"]) ?? input.requestId;
        const recipient = isRecord(body) ? asTrimmedString(getRecordField(body, "to")) : null;
        const messageText = isRecord(text) ? asTrimmedString(getRecordField(text, "body")) : null;
        const completedAt = asTrimmedString(getRecordField(body, "completedAt")) ?? "2026-06-17T12:00:00.000Z";
        const safeLogEntry = {
            requestId: input.requestId,
            commandId,
            idempotencyKey,
            recipientMasked: (0, constants_1.maskWhatsAppRecipient)(recipient),
            messageLength: messageText?.length ?? 0,
            scenario,
            statusCode: scenarioStatusCode(scenario),
            completedAt
        };
        this.safeRequestLog.push(safeLogEntry);
        if (scenario === "timeout") {
            const error = new Error("Fake WhatsApp request timed out.");
            error.kind = "timeout";
            throw error;
        }
        if (scenario === "network_error") {
            const error = new Error("Fake WhatsApp network error.");
            error.kind = "network";
            throw error;
        }
        if (scenario === "unknown_error") {
            const error = new Error("Fake WhatsApp unknown error.");
            error.kind = "unknown";
            throw error;
        }
        const statusCode = scenarioStatusCode(scenario);
        const responseBody = scenarioBody({
            scenario,
            requestId: input.requestId,
            commandId,
            idempotencyKey,
            recipient,
            messageText
        });
        return {
            statusCode,
            headers: buildHeaders({
                scenario,
                requestId: input.requestId,
                explicitRetryAfterSeconds: this.config.explicitRetryAfterSeconds ?? null
            }),
            body: responseBody,
            completedAt
        };
    }
}
exports.FakeWhatsAppHttpClient = FakeWhatsAppHttpClient;
