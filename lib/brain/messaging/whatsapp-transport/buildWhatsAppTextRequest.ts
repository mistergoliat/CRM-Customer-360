import {
  buildWhatsAppRequestId,
  maskWhatsAppRecipient,
  normalizeWhatsAppUrlSegment
} from "./constants";
import { normalizeWhatsAppRecipient } from "./validateWhatsAppTransportInput";
import type {
  WhatsAppProviderRequest,
  WhatsAppTransportConfig,
  WhatsAppTransportSendInput,
  WhatsAppTransportSafeRequestSummary
} from "./types";

function buildAuthorizationHeader(accessToken: string) {
  return `Bearer ${accessToken.trim()}`;
}

export function buildWhatsAppTextRequest(
  input: WhatsAppTransportSendInput,
  config: WhatsAppTransportConfig
): WhatsAppProviderRequest {
  const recipient = normalizeWhatsAppRecipient(input.recipient);
  if (!recipient) {
    throw new Error("invalid_recipient");
  }

  const requestId = buildWhatsAppRequestId(input.commandId.trim(), input.idempotencyKey.trim());
  const baseUrl = normalizeWhatsAppUrlSegment(config.graphBaseUrl);
  const apiVersion = normalizeWhatsAppUrlSegment(config.graphApiVersion);
  const phoneNumberId = normalizeWhatsAppUrlSegment(config.phoneNumberId);

  return {
    requestId,
    url: `${baseUrl}/${apiVersion}/${encodeURIComponent(phoneNumberId)}/messages`,
    method: "POST",
    headers: {
      Authorization: buildAuthorizationHeader(config.accessToken),
      "Content-Type": "application/json",
      "X-Idempotency-Key": input.idempotencyKey.trim()
    },
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "text",
      text: {
        preview_url: false,
        body: input.messageText.trim()
      }
    },
    timeoutMs: Math.floor(config.timeoutMs),
    audit: {
      recipientMasked: maskWhatsAppRecipient(recipient) ?? "",
      commandId: input.commandId.trim(),
      idempotencyKey: input.idempotencyKey.trim(),
      sandbox: true
    }
  };
}

export function buildSafeWhatsAppRequestSummary(request: WhatsAppProviderRequest): WhatsAppTransportSafeRequestSummary {
  return {
    requestId: request.requestId,
    commandId: request.audit.commandId,
    idempotencyKey: request.audit.idempotencyKey,
    url: request.url,
    method: request.method,
    recipientMasked: request.audit.recipientMasked,
    sandbox: true,
    timeoutMs: request.timeoutMs,
    bodyLength: JSON.stringify(request.body).length
  };
}
