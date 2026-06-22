import type { WhatsAppTransportErrorDetails } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function maskTraceId(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 6) {
    return `${value.slice(0, 1)}${"*".repeat(Math.max(0, value.length - 2))}${value.slice(-1)}`;
  }
  return `${value.slice(0, 3)}${"*".repeat(Math.max(0, value.length - 6))}${value.slice(-3)}`;
}

export function sanitizeWhatsAppProviderError(input: unknown, limit = 240): string | null {
  if (input === null || input === undefined) return null;
  const raw = typeof input === "string" ? input : isRecord(input) ? JSON.stringify(input) : String(input);
  const sanitized = raw
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\bBearer\s+[A-Za-z0-9._-]+\b/gi, "Bearer [redacted]")
    .replace(/\b\d{6,}\b/g, "[redacted]")
    .replace(/"?(authorization|token|secret|password)"?\s*[:=]\s*"?[A-Za-z0-9._-]{8,}"?/gi, "$1=[redacted]")
    .replace(/\bstack\s+trace\b/gi, "[redacted]")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!sanitized) return null;
  return sanitized.length > limit ? `${sanitized.slice(0, limit - 3)}...` : sanitized;
}

export function extractSafeWhatsAppProviderError(body: unknown): WhatsAppTransportErrorDetails {
  if (!isRecord(body)) {
    return {
      providerCode: null,
      providerSubcode: null,
      safeMessage: sanitizeWhatsAppProviderError(body),
      traceIdMasked: null
    };
  }

  const error = isRecord(body.error) ? body.error : null;
  return {
    providerCode: asTrimmedString(error?.code ?? null),
    providerSubcode: asTrimmedString(error?.error_subcode ?? null),
    safeMessage: sanitizeWhatsAppProviderError(error?.message ?? error?.error_data ?? body),
    traceIdMasked: maskTraceId(asTrimmedString(error?.fbtrace_id ?? null))
  };
}
