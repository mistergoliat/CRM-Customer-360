"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashMessageText = hashMessageText;
exports.buildDedupeKey = buildDedupeKey;
exports.checkDuplicateNoop = checkDuplicateNoop;
const node_crypto_1 = __importDefault(require("node:crypto"));
function normalizePart(value) {
    if (value === undefined || value === null)
        return "";
    return String(value).trim();
}
function hashMessageText(messageText) {
    const normalized = messageText
        .normalize("NFKC")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    return node_crypto_1.default.createHash("sha256").update(normalized).digest("hex");
}
function buildDedupeKey(input) {
    const messageHash = input.messageText ? hashMessageText(input.messageText) : "";
    const hash = node_crypto_1.default
        .createHash("sha256")
        .update([
        normalizePart(input.channel ?? "whatsapp"),
        normalizePart(input.actionType),
        normalizePart(input.waId),
        normalizePart(input.phoneNumberId),
        normalizePart(input.conversationCaseId),
        messageHash,
        normalizePart(input.sourceRequestId)
    ].join("|"))
        .digest("hex")
        .slice(0, 24);
    return `brain-outbox-${hash}`;
}
function checkDuplicateNoop(input) {
    return {
        checked: false,
        duplicate_detected: false,
        dedupe_key: buildDedupeKey(input),
        reason: "duplicate check skipped in dry-run"
    };
}
