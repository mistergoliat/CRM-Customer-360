"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSandboxExecutionPreview = buildSandboxExecutionPreview;
function buildSandboxExecutionPreview(input, validation) {
    return {
        canExecute: false,
        channel: input.action.channel,
        recipientMasked: validation.recipientMasked,
        messagePreview: validation.messagePreview,
        idempotencyKey: input.action.idempotencyKey
    };
}
