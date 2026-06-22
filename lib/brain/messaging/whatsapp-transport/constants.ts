import { createHash } from "node:crypto";
import { maskWaId } from "../../commercial/autonomy-sandbox";

export const WHATSAPP_TRANSPORT_VERSION = "brain.messaging.whatsapp-transport.v1" as const;

export const WHATSAPP_TRANSPORT_PROVIDER_NAME = "whatsapp_cloud_api" as const;

export const WHATSAPP_TRANSPORT_SUPPORTED_CHANNEL = "whatsapp" as const;

export const WHATSAPP_TRANSPORT_SUPPORTED_COMMAND_TYPES = ["whatsapp_text"] as const;

export const FAKE_WHATSAPP_HTTP_CLIENT_SCENARIOS = [
  "accepted",
  "malformed_success",
  "invalid_recipient",
  "invalid_payload",
  "authentication_error",
  "permission_error",
  "policy_rejected",
  "rate_limited",
  "provider_unavailable",
  "timeout",
  "network_error",
  "duplicate_accepted",
  "unknown_error"
] as const;

export type FakeWhatsAppHttpClientScenario = (typeof FAKE_WHATSAPP_HTTP_CLIENT_SCENARIOS)[number];

export function buildStableWhatsAppDigest(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function buildWhatsAppRequestId(commandId: string, idempotencyKey: string): string {
  const digest = buildStableWhatsAppDigest({ commandId, idempotencyKey });
  return `whatsapp-request:${digest.slice(0, 24)}`;
}

export function buildFakeWhatsAppProviderMessageId(input: {
  requestId: string;
  commandId: string;
  idempotencyKey: string;
}): string {
  const digest = buildStableWhatsAppDigest(input);
  return `wamid.fake:${digest.slice(0, 24)}`;
}

export function normalizeWhatsAppRecipientDigits(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[\d\s()+-]+$/.test(trimmed)) return null;

  const stripped = trimmed
    .replace(/[\s()-]+/g, "")
    .replace(/^\++/, "");

  if (!/^\d+$/.test(stripped)) return null;
  return stripped;
}

export function maskWhatsAppRecipient(value: string | null | undefined): string | null {
  return maskWaId(normalizeWhatsAppRecipientDigits(value));
}

export function normalizeWhatsAppUrlSegment(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

export function sanitizeWhatsAppTokenLikeValue(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\bBearer\s+[A-Za-z0-9._-]+\b/gi, "Bearer [redacted]")
    .replace(/\b[A-Za-z0-9_=-]{24,}\b/g, "[redacted]");
}
