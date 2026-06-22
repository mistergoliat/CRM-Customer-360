"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMetaWhatsAppTextPayloadPreview = buildMetaWhatsAppTextPayloadPreview;
function buildMetaWhatsAppTextPayloadPreview(input) {
    return {
        messaging_product: "whatsapp",
        to: input.waId.trim(),
        type: "text",
        text: {
            body: input.messageText.trim()
        }
    };
}
