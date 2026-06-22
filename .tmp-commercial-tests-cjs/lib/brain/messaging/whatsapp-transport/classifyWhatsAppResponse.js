"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyWhatsAppResponse = classifyWhatsAppResponse;
exports.classifyWhatsAppClientException = classifyWhatsAppClientException;
const sanitizeWhatsAppProviderError_1 = require("./sanitizeWhatsAppProviderError");
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asTrimmedString(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function getHeader(headers, name) {
    const lowered = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === lowered) {
            const trimmed = asTrimmedString(value);
            if (trimmed)
                return trimmed;
        }
    }
    return null;
}
function parseRetryAfterSeconds(value, referenceTime) {
    if (!value)
        return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.floor(seconds);
    }
    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime()))
        return null;
    const reference = new Date(referenceTime);
    if (Number.isNaN(reference.getTime()))
        return null;
    return Math.max(0, Math.floor((parsedDate.getTime() - reference.getTime()) / 1000));
}
function extractProviderMessageId(body) {
    if (!isRecord(body))
        return null;
    const messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0)
        return null;
    const first = messages[0];
    if (!isRecord(first))
        return null;
    return asTrimmedString(first.id);
}
function hasExplicitDuplicateSignal(body) {
    if (!isRecord(body))
        return false;
    if (body.duplicate_accepted === true)
        return true;
    if (body.status === "duplicate_accepted")
        return true;
    const messages = body.messages;
    if (Array.isArray(messages) && messages.length > 0 && isRecord(messages[0]) && messages[0].duplicate_accepted === true) {
        return true;
    }
    return false;
}
function buildResult(input) {
    return {
        status: input.status,
        providerMessageId: input.providerMessageId,
        providerRequestId: input.providerRequestId,
        errorCode: input.errorCode,
        errorMessageSafe: input.errorMessageSafe,
        retryAfterSeconds: input.retryAfterSeconds,
        acceptedAt: input.acceptedAt,
        completedAt: input.completedAt,
        metadata: {
            provider: "whatsapp_cloud_api",
            sandbox: true,
            simulated: input.simulated
        }
    };
}
function classifyHttpStatus(response, context) {
    const providerRequestId = getHeader(response.headers, "x-request-id") ?? getHeader(response.headers, "x-fb-request-id") ?? context.requestId;
    const safeError = (0, sanitizeWhatsAppProviderError_1.extractSafeWhatsAppProviderError)(response.body);
    const providerMessageId = extractProviderMessageId(response.body);
    const duplicateSignal = hasExplicitDuplicateSignal(response.body);
    if (response.statusCode >= 200 && response.statusCode < 300) {
        if (duplicateSignal) {
            return buildResult({
                status: "duplicate_accepted",
                providerMessageId,
                providerRequestId,
                errorCode: "provider_duplicate",
                errorMessageSafe: safeError.safeMessage,
                retryAfterSeconds: null,
                acceptedAt: providerMessageId ? response.completedAt : null,
                completedAt: response.completedAt,
                simulated: context.simulated
            });
        }
        if (!providerMessageId) {
            return buildResult({
                status: "temporary_failure",
                providerMessageId: null,
                providerRequestId,
                errorCode: "unknown",
                errorMessageSafe: safeError.safeMessage ?? "Accepted response missing provider message id.",
                retryAfterSeconds: null,
                acceptedAt: null,
                completedAt: response.completedAt,
                simulated: context.simulated
            });
        }
        return buildResult({
            status: "accepted",
            providerMessageId,
            providerRequestId,
            errorCode: "none",
            errorMessageSafe: null,
            retryAfterSeconds: null,
            acceptedAt: response.completedAt,
            completedAt: response.completedAt,
            simulated: context.simulated
        });
    }
    if (response.statusCode === 400) {
        const normalizedCode = safeError.providerCode ?? safeError.providerSubcode;
        const errorCode = normalizedCode === "invalid_recipient"
            ? "invalid_recipient"
            : normalizedCode === "invalid_payload"
                ? "invalid_payload"
                : normalizedCode === "policy_rejected"
                    ? "policy_rejected"
                    : "unknown";
        return buildResult({
            status: "permanent_failure",
            providerMessageId: null,
            providerRequestId,
            errorCode,
            errorMessageSafe: safeError.safeMessage ?? "Bad request.",
            retryAfterSeconds: null,
            acceptedAt: null,
            completedAt: response.completedAt,
            simulated: context.simulated
        });
    }
    if (response.statusCode === 401) {
        return buildResult({
            status: "permanent_failure",
            providerMessageId: null,
            providerRequestId,
            errorCode: "authentication_error",
            errorMessageSafe: safeError.safeMessage ?? "Authentication error.",
            retryAfterSeconds: null,
            acceptedAt: null,
            completedAt: response.completedAt,
            simulated: context.simulated
        });
    }
    if (response.statusCode === 403) {
        return buildResult({
            status: "permanent_failure",
            providerMessageId: null,
            providerRequestId,
            errorCode: "permission_error",
            errorMessageSafe: safeError.safeMessage ?? "Permission error.",
            retryAfterSeconds: null,
            acceptedAt: null,
            completedAt: response.completedAt,
            simulated: context.simulated
        });
    }
    if (response.statusCode === 404) {
        return buildResult({
            status: "permanent_failure",
            providerMessageId: null,
            providerRequestId,
            errorCode: "invalid_payload",
            errorMessageSafe: safeError.safeMessage ?? "Not found.",
            retryAfterSeconds: null,
            acceptedAt: null,
            completedAt: response.completedAt,
            simulated: context.simulated
        });
    }
    if (response.statusCode === 408) {
        return buildResult({
            status: "timeout",
            providerMessageId: null,
            providerRequestId,
            errorCode: "timeout",
            errorMessageSafe: safeError.safeMessage ?? "Request timed out.",
            retryAfterSeconds: null,
            acceptedAt: null,
            completedAt: response.completedAt,
            simulated: context.simulated
        });
    }
    if (response.statusCode === 409) {
        if (duplicateSignal || safeError.providerCode === "provider_duplicate" || safeError.providerSubcode === "provider_duplicate") {
            return buildResult({
                status: "duplicate_accepted",
                providerMessageId,
                providerRequestId,
                errorCode: "provider_duplicate",
                errorMessageSafe: safeError.safeMessage,
                retryAfterSeconds: null,
                acceptedAt: providerMessageId ? response.completedAt : null,
                completedAt: response.completedAt,
                simulated: context.simulated
            });
        }
        return buildResult({
            status: "temporary_failure",
            providerMessageId: null,
            providerRequestId,
            errorCode: "unknown",
            errorMessageSafe: safeError.safeMessage ?? "Conflict.",
            retryAfterSeconds: null,
            acceptedAt: null,
            completedAt: response.completedAt,
            simulated: context.simulated
        });
    }
    if (response.statusCode === 429) {
        return buildResult({
            status: "rate_limited",
            providerMessageId: null,
            providerRequestId,
            errorCode: "rate_limited",
            errorMessageSafe: safeError.safeMessage ?? "Rate limited.",
            retryAfterSeconds: parseRetryAfterSeconds(getHeader(response.headers, "retry-after"), response.completedAt),
            acceptedAt: null,
            completedAt: response.completedAt,
            simulated: context.simulated
        });
    }
    if (response.statusCode >= 500 && response.statusCode <= 599) {
        return buildResult({
            status: "temporary_failure",
            providerMessageId: null,
            providerRequestId,
            errorCode: "provider_unavailable",
            errorMessageSafe: safeError.safeMessage ?? `Provider HTTP ${response.statusCode}.`,
            retryAfterSeconds: null,
            acceptedAt: null,
            completedAt: response.completedAt,
            simulated: context.simulated
        });
    }
    return buildResult({
        status: "temporary_failure",
        providerMessageId: null,
        providerRequestId,
        errorCode: "unknown",
        errorMessageSafe: safeError.safeMessage ?? `Provider HTTP ${response.statusCode}.`,
        retryAfterSeconds: null,
        acceptedAt: null,
        completedAt: response.completedAt,
        simulated: context.simulated
    });
}
function classifyClientException(error, context) {
    const typed = error;
    const providerRequestId = context.requestId;
    const message = typeof typed?.message === "string" ? typed.message : error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    const kind = typed?.kind ?? (lower.includes("timeout") || lower.includes("aborted") ? "timeout" : lower.includes("network") ? "network" : "unknown");
    if (kind === "timeout") {
        return buildResult({
            status: "timeout",
            providerMessageId: typed?.providerMessageId ?? null,
            providerRequestId,
            errorCode: "timeout",
            errorMessageSafe: message,
            retryAfterSeconds: null,
            acceptedAt: null,
            completedAt: context.attemptedAt,
            simulated: context.simulated
        });
    }
    if (kind === "network") {
        return buildResult({
            status: "temporary_failure",
            providerMessageId: typed?.providerMessageId ?? null,
            providerRequestId,
            errorCode: "network_error",
            errorMessageSafe: message,
            retryAfterSeconds: null,
            acceptedAt: null,
            completedAt: context.attemptedAt,
            simulated: context.simulated
        });
    }
    return buildResult({
        status: "temporary_failure",
        providerMessageId: typed?.providerMessageId ?? null,
        providerRequestId,
        errorCode: "unknown",
        errorMessageSafe: message,
        retryAfterSeconds: null,
        acceptedAt: null,
        completedAt: context.attemptedAt,
        simulated: context.simulated
    });
}
function classifyWhatsAppResponse(response, context) {
    return classifyHttpStatus(response, context);
}
function classifyWhatsAppClientException(error, context) {
    return classifyClientException(error, context);
}
