"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BRAIN_INSTRUCTIONS_VERSION = exports.BRAIN_RUNTIME_VERSION = void 0;
exports.makeBrainRequestId = makeBrainRequestId;
exports.makeBrainTraceId = makeBrainTraceId;
exports.summarizeBrainContext = summarizeBrainContext;
const node_crypto_1 = __importDefault(require("node:crypto"));
exports.BRAIN_RUNTIME_VERSION = "p1d-foundation-0.1.0";
exports.BRAIN_INSTRUCTIONS_VERSION = "brain.instructions.v1";
function makeBrainRequestId(request) {
    const hash = node_crypto_1.default
        .createHash("sha256")
        .update(`${request.source}:${request.channel}:${request.waId}:${request.phoneNumberId}:${request.messageId}:${request.messageText}`)
        .digest("hex")
        .slice(0, 16);
    return `brain-${hash}`;
}
function makeBrainTraceId(request) {
    const hash = node_crypto_1.default.createHash("sha256").update(`${request.source}:${request.waId}:${request.messageId}`).digest("hex").slice(0, 12);
    return `trace-${hash}`;
}
function summarizeBrainContext(context) {
    return {
        traceId: context.traceId,
        status: context.status,
        confidence: context.confidence,
        notes: context.notes.slice(0, 3),
        warnings: context.warnings.slice(0, 3)
    };
}
