"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateMetaSendGuards = validateMetaSendGuards;
exports.sendMetaWhatsAppTextMessage = sendMetaWhatsAppTextMessage;
exports.getMetaSendAdapterStatus = getMetaSendAdapterStatus;
const metaPayload_1 = require("./metaPayload");
const metaClient_1 = require("./metaClient");
function asTrimmedString(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function getMetaSendAdapterStatus() {
    if (process.env.BRAIN_META_SEND_ENABLED?.trim() !== "true") {
        return "disabled";
    }
    if (!(0, metaClient_1.getMetaAccessToken)() || !(0, metaClient_1.getMetaDefaultPhoneNumberId)()) {
        return "missing_credentials";
    }
    return "configured";
}
function buildGuardResponse(input, adapterStatus, errorCode, errorMessage, blockedReasons, warnings) {
    const waId = asTrimmedString(input.waId);
    const phoneNumberId = asTrimmedString(input.phoneNumberId);
    const messageText = asTrimmedString(input.messageText);
    return {
        ok: false,
        adapterStatus,
        blockedReasons,
        warnings,
        errorCode,
        errorMessage,
        metaPayloadPreview: waId && phoneNumberId && messageText
            ? (0, metaPayload_1.buildMetaWhatsAppTextPayloadPreview)({
                waId,
                messageText
            })
            : null
    };
}
function collectPolicyBlockedReasons(input) {
    const blockedReasons = new Set();
    const actionPolicy = input.actionPolicy;
    const botEligibility = input.botEligibility;
    if (actionPolicy) {
        const blocked = actionPolicy.blockedReasons ?? actionPolicy.blocked_reasons ?? [];
        for (const reason of blocked)
            blockedReasons.add(reason);
        if (actionPolicy.allowedToAutoReply === false ||
            actionPolicy.can_auto_reply === false ||
            actionPolicy.canAutoReply === false) {
            blockedReasons.add("auto_reply_not_allowed");
        }
        if (actionPolicy.requiresHuman === true || actionPolicy.requires_human === true) {
            blockedReasons.add("requires_human");
        }
    }
    if (botEligibility) {
        const blocked = botEligibility.blockedReasons ?? botEligibility.blocked_reasons ?? [];
        for (const reason of blocked)
            blockedReasons.add(reason);
        if (botEligibility.suppressionActive === true || botEligibility.suppression_active === true) {
            blockedReasons.add("suppression_active");
        }
        if (botEligibility.recentManualReply === true || botEligibility.recent_manual_reply === true) {
            blockedReasons.add("recent_manual_reply");
        }
        if (botEligibility.activeHumanLock === true ||
            botEligibility.active_human_lock === true ||
            botEligibility.manualOperatorLock === true ||
            botEligibility.manual_operator_lock === true) {
            blockedReasons.add("manual_operator_lock");
        }
        if (botEligibility.activeHumanCase === true || botEligibility.active_human_case === true) {
            blockedReasons.add("active_human_case");
        }
        if (botEligibility.openCaseWaitingHuman === true || botEligibility.open_case_waiting_human === true) {
            blockedReasons.add("open_case_waiting_human");
        }
        if (botEligibility.requiresHuman === true || botEligibility.requires_human === true) {
            blockedReasons.add("requires_human");
        }
        if (botEligibility.canAutoReply === false ||
            botEligibility.can_auto_reply === false) {
            blockedReasons.add("auto_reply_not_allowed");
        }
    }
    return [...blockedReasons];
}
function buildInvalidPayloadResponse(input, errorMessage) {
    return buildGuardResponse(input, getMetaSendAdapterStatus(), "invalid_payload", errorMessage, ["invalid_payload"], [errorMessage]);
}
function buildBlockedPolicyResponse(input, blockedReasons, warnings) {
    return buildGuardResponse(input, getMetaSendAdapterStatus(), "blocked_by_policy", blockedReasons[0] ?? "blocked_by_policy", blockedReasons, warnings);
}
function validateMetaSendGuards(input) {
    const adapterStatus = getMetaSendAdapterStatus();
    const waId = asTrimmedString(input.waId);
    const phoneNumberId = asTrimmedString(input.phoneNumberId);
    const messageText = asTrimmedString(input.messageText);
    if (adapterStatus === "disabled") {
        return buildGuardResponse(input, adapterStatus, "disabled", "BRAIN_META_SEND_ENABLED=false", ["meta_send_disabled"], ["Meta send adapter is disabled by default."]);
    }
    if (adapterStatus === "missing_credentials") {
        return buildGuardResponse(input, adapterStatus, "missing_credentials", "META_WHATSAPP_ACCESS_TOKEN o META_WHATSAPP_DEFAULT_PHONE_NUMBER_ID no configurado", ["missing_credentials"], ["Faltan credenciales obligatorias del adaptador Meta."]);
    }
    if (!waId || !phoneNumberId || !messageText) {
        return buildInvalidPayloadResponse(input, "waId, phoneNumberId y messageText son obligatorios y no pueden venir vacios.");
    }
    const blockedReasons = collectPolicyBlockedReasons(input);
    if (blockedReasons.length > 0) {
        return buildBlockedPolicyResponse(input, blockedReasons, ["La policy o la elegibilidad bloquea el envio."]);
    }
    return {
        ok: true,
        adapterStatus: "configured",
        blockedReasons: [],
        warnings: [],
        errorCode: null,
        errorMessage: null,
        metaPayloadPreview: (0, metaPayload_1.buildMetaWhatsAppTextPayloadPreview)({
            waId,
            messageText
        })
    };
}
function guardStatusToResponseStatus(errorCode) {
    if (errorCode === "disabled")
        return "disabled";
    if (errorCode === "missing_credentials")
        return "missing_credentials";
    if (errorCode === "invalid_payload")
        return "invalid_payload";
    return "blocked_by_policy";
}
async function sendMetaWhatsAppTextMessage(input) {
    const guard = validateMetaSendGuards(input);
    if (!guard.ok) {
        return {
            ok: false,
            status: guardStatusToResponseStatus(guard.errorCode),
            error_code: guard.errorCode,
            error_message: guard.errorMessage,
            blocked_reasons: guard.blockedReasons,
            warnings: guard.warnings,
            meta_payload_preview: guard.metaPayloadPreview,
            response_body: null,
            adapter_status: guard.adapterStatus
        };
    }
    const transportResponse = await (0, metaClient_1.postMetaWhatsAppTextMessage)({
        waId: input.waId,
        phoneNumberId: input.phoneNumberId,
        messageText: input.messageText,
        timeoutMs: input.timeoutMs
    });
    return {
        ...transportResponse,
        adapter_status: guard.adapterStatus
    };
}
