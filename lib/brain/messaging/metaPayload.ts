import type {
  BrainMetaWhatsAppTemplateComponent,
  BrainMetaWhatsAppTemplatePayloadPreview,
  BrainMetaWhatsAppTextPayloadPreview
} from "./types";

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

export type BrainMetaWhatsAppTemplatePayloadInput = {
  waId: string;
  templateName: string;
  languageCode: string;
  components?: BrainMetaWhatsAppTemplateComponent[];
};

function normalizeTemplateComponents(components?: BrainMetaWhatsAppTemplateComponent[]) {
  if (!components || components.length === 0) return undefined;
  return components.map((component) => {
    if (component.type === "body") {
      return {
        type: "body" as const,
        ...(component.parameters && component.parameters.length > 0 ? { parameters: component.parameters } : {})
      };
    }
    if (component.type === "header") {
      return {
        type: "header" as const,
        ...(component.parameters && component.parameters.length > 0 ? { parameters: component.parameters } : {})
      };
    }
    return {
      type: "button" as const,
      ...(component.sub_type ? { sub_type: component.sub_type } : {}),
      ...(component.index ? { index: component.index } : {}),
      ...(component.parameters && component.parameters.length > 0 ? { parameters: component.parameters } : {})
    };
  });
}

export function buildMetaWhatsAppTemplatePayloadPreview(
  input: BrainMetaWhatsAppTemplatePayloadInput
): BrainMetaWhatsAppTemplatePayloadPreview {
  const preview: BrainMetaWhatsAppTemplatePayloadPreview = {
    messaging_product: "whatsapp",
    to: input.waId.trim(),
    type: "template",
    template: {
      name: input.templateName.trim(),
      language: {
        code: input.languageCode.trim()
      }
    }
  };

  const components = normalizeTemplateComponents(input.components);
  if (components) {
    preview.template.components = components;
  }

  return preview;
}
