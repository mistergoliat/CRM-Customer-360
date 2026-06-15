import type { BrainMetaWhatsAppTextPayloadPreview } from "./types";

export type BrainMetaWhatsAppTextPayloadInput = {
  waId: string;
  messageText: string;
};

export function buildMetaWhatsAppTextPayloadPreview(input: BrainMetaWhatsAppTextPayloadInput): BrainMetaWhatsAppTextPayloadPreview {
  return {
    messaging_product: "whatsapp",
    to: input.waId.trim(),
    type: "text",
    text: {
      body: input.messageText.trim()
    }
  };
}
