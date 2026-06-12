export async function sendWhatsAppText(input: { phoneNumberId: string; to: string; messageText: string }) {
  const version = process.env.META_GRAPH_API_VERSION || "v22.0";
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return { ok: false as const, status: 500, error: "META_ACCESS_TOKEN no configurado" };
  }

  const response = await fetch(`https://graph.facebook.com/${version}/${input.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: input.to,
      type: "text",
      text: {
        preview_url: false,
        body: input.messageText
      }
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || `Meta Graph API HTTP ${response.status}`;
    return { ok: false as const, status: response.status, error: message, body };
  }

  const providerMessageId = body?.messages?.[0]?.id;
  return { ok: true as const, providerMessageId, body };
}
