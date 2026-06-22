"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppMessageTransport = void 0;
const buildWhatsAppTextRequest_1 = require("./buildWhatsAppTextRequest");
const classifyWhatsAppResponse_1 = require("./classifyWhatsAppResponse");
const constants_1 = require("./constants");
const sanitizeWhatsAppProviderError_1 = require("./sanitizeWhatsAppProviderError");
const validateWhatsAppTransportInput_1 = require("./validateWhatsAppTransportInput");
function buildFailedResult(input) {
    return {
        status: input.status ?? "permanent_failure",
        providerMessageId: input.providerMessageId ?? null,
        providerRequestId: input.providerRequestId ?? null,
        errorCode: input.errorCode,
        errorMessageSafe: input.errorMessageSafe,
        retryAfterSeconds: null,
        acceptedAt: null,
        completedAt: input.attemptedAt,
        metadata: {
            provider: constants_1.WHATSAPP_TRANSPORT_PROVIDER_NAME,
            sandbox: true,
            simulated: true
        }
    };
}
class WhatsAppMessageTransport {
    input;
    constructor(input) {
        this.input = input;
    }
    buildTrace(result, input, completedAt) {
        const validation = (0, validateWhatsAppTransportInput_1.validateWhatsAppTransportInput)(input, this.input.config);
        return {
            requestId: validation.requestId ?? "whatsapp-request:invalid",
            commandId: input.commandId,
            recipientMasked: validation.recipientMasked ?? "",
            attemptedAt: input.attemptedAt,
            completedAt,
            httpStatus: null,
            resultStatus: result.status,
            errorCode: result.errorCode,
            providerMessageId: result.providerMessageId,
            sandbox: true,
            simulated: true
        };
    }
    async send(sendInput) {
        const validation = (0, validateWhatsAppTransportInput_1.validateWhatsAppTransportInput)(sendInput, this.input.config);
        if (!validation.ok) {
            return buildFailedResult({
                attemptedAt: sendInput.attemptedAt,
                errorCode: validation.errorCode ?? "unknown",
                errorMessageSafe: (0, sanitizeWhatsAppProviderError_1.sanitizeWhatsAppProviderError)(validation.errorMessageSafe ?? "Invalid WhatsApp transport input."),
                providerRequestId: validation.requestId,
                status: "permanent_failure"
            });
        }
        const request = (0, buildWhatsAppTextRequest_1.buildWhatsAppTextRequest)(sendInput, this.input.config);
        try {
            const response = await this.input.client.postJson({
                url: request.url,
                headers: request.headers,
                body: request.body,
                timeoutMs: request.timeoutMs,
                requestId: request.requestId
            });
            const result = (0, classifyWhatsAppResponse_1.classifyWhatsAppResponse)(response, {
                requestId: request.requestId,
                commandId: sendInput.commandId,
                idempotencyKey: sendInput.idempotencyKey,
                attemptedAt: sendInput.attemptedAt,
                recipientMasked: request.audit.recipientMasked,
                sandbox: true,
                simulated: true
            });
            return result;
        }
        catch (error) {
            const result = (0, classifyWhatsAppResponse_1.classifyWhatsAppClientException)(error, {
                requestId: request.requestId,
                commandId: sendInput.commandId,
                idempotencyKey: sendInput.idempotencyKey,
                attemptedAt: sendInput.attemptedAt,
                recipientMasked: request.audit.recipientMasked,
                sandbox: true,
                simulated: true
            });
            return result;
        }
    }
    buildRequestSummary(sendInput) {
        const request = (0, buildWhatsAppTextRequest_1.buildWhatsAppTextRequest)(sendInput, this.input.config);
        return (0, buildWhatsAppTextRequest_1.buildSafeWhatsAppRequestSummary)(request);
    }
}
exports.WhatsAppMessageTransport = WhatsAppMessageTransport;
