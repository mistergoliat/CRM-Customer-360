"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeEmail = normalizeEmail;
exports.normalizePhoneChile = normalizePhoneChile;
exports.normalizeWaId = normalizeWaId;
exports.normalizeIdentityValue = normalizeIdentityValue;
exports.normalizeLooseIdentifier = normalizeLooseIdentifier;
exports.buildChilePhoneCandidates = buildChilePhoneCandidates;
function trimText(value) {
    if (value === null || value === undefined)
        return null;
    const text = String(value).trim();
    return text.length > 0 ? text : null;
}
function digitsOnly(value) {
    const text = trimText(value);
    if (!text)
        return null;
    const digits = text.replace(/\D+/g, "");
    return digits.length > 0 ? digits : null;
}
function normalizeEmail(value) {
    const text = trimText(value);
    if (!text)
        return null;
    const cleaned = text.replace(/^<|>$/g, "").trim().toLowerCase();
    return cleaned.length > 0 ? cleaned : null;
}
function normalizePhoneChile(value) {
    const digits = digitsOnly(value);
    if (!digits)
        return null;
    if (digits.startsWith("56") && digits.length >= 11 && digits.length <= 12) {
        return digits.slice(0, 11);
    }
    if (digits.length === 9 && digits.startsWith("9")) {
        return `56${digits}`;
    }
    if (digits.length === 11 && digits.startsWith("569")) {
        return digits;
    }
    return null;
}
function normalizeWaId(value) {
    const normalizedPhone = normalizePhoneChile(value);
    if (normalizedPhone)
        return normalizedPhone;
    const digits = digitsOnly(value);
    if (!digits)
        return null;
    return digits;
}
function normalizeRut(value) {
    const text = trimText(value);
    if (!text)
        return null;
    const normalized = text.replace(/[.\-\s]/g, "").toUpperCase();
    return normalized.length > 0 ? normalized : null;
}
function normalizeIdentityValue(type, value) {
    switch (type) {
        case "email":
            return normalizeEmail(value);
        case "wa_id":
            return normalizeWaId(value);
        case "phone":
            return normalizePhoneChile(value);
        case "rut":
            return normalizeRut(value);
        case "prestashop_customer_id":
        case "order_id":
        case "invoice_number":
        case "appsheet_customer_id":
            return trimText(value);
        default:
            return trimText(value);
    }
}
function normalizeLooseIdentifier(value) {
    return trimText(value);
}
function buildChilePhoneCandidates(value) {
    const normalized = normalizePhoneChile(value);
    const digits = digitsOnly(value);
    const candidates = new Set();
    if (normalized)
        candidates.add(normalized);
    if (digits)
        candidates.add(digits);
    if (normalized && normalized.startsWith("56") && normalized.length === 11) {
        candidates.add(normalized.slice(2));
    }
    if (digits && digits.length === 9 && digits.startsWith("9")) {
        candidates.add(digits);
        candidates.add(`56${digits}`);
    }
    return Array.from(candidates);
}
