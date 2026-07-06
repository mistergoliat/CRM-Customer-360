type LegacyTemplateRequest = {
  name: string;
  languageCode: string;
  components?: Array<
    | {
        type: "body";
        parameters?: Array<{ type: "text"; text: string }>;
      }
    | {
        type: "header";
        parameters?: Array<{ type: "text"; text: string } | { type: "image"; image: { link: string } }>;
      }
    | {
        type: "button";
        sub_type?: string;
        index?: string;
        parameters?: Array<{ type: "text"; text: string }>;
      }
  >;
};

export async function sendWhatsAppText(input: { phoneNumberId: string; to: string; messageText?: string; template?: LegacyTemplateRequest }) {
  const version = process.env.META_GRAPH_API_VERSION || "v22.0";
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return { ok: false as const, status: 500, error: "META_ACCESS_TOKEN no configurado" };
  }

  const requestBody =
    input.template && input.template.name.trim() && input.template.languageCode.trim()
      ? {
          messaging_product: "whatsapp",
          to: input.to,
          type: "template",
          template: {
            name: input.template.name.trim(),
            language: {
              code: input.template.languageCode.trim()
            },
            ...(input.template.components && input.template.components.length > 0
              ? { components: input.template.components }
              : {})
          }
        }
      : {
          messaging_product: "whatsapp",
          to: input.to,
          type: "text",
          text: {
            preview_url: false,
            body: input.messageText ?? ""
          }
        };

  const response = await fetch(`https://graph.facebook.com/${version}/${input.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (responseBody as { error?: { message?: string } }).error?.message || `Meta Graph API HTTP ${response.status}`;
    return { ok: false as const, status: response.status, error: message, body: responseBody };
  }

  const providerMessageId = (responseBody as { messages?: Array<{ id?: string }> }).messages?.[0]?.id;
  return { ok: true as const, providerMessageId, body: responseBody };
}
