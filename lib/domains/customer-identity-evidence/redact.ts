import { createHash } from "node:crypto";

// PARTE 17. One-way, never reversible - used only to detect "is this the
// same value as before" for correction/idempotency, never to recover the
// original value. signalDisplay is a fixed-format redaction for read-only
// audit surfaces (same discipline as follow-up-observability/maskWaId.ts).

export function hashSignalValue(normalizedValue: string | null | undefined): string | null {
  if (typeof normalizedValue !== "string") return null;
  const trimmed = normalizedValue.trim();
  if (!trimmed) return null;
  return createHash("sha256").update(trimmed).digest("hex");
}

export function redactSignalValue(normalizedValue: string | null | undefined): string | null {
  if (typeof normalizedValue !== "string") return null;
  const trimmed = normalizedValue.trim();
  if (!trimmed) return null;
  const last4 = trimmed.slice(-4);
  return `****${last4}`;
}
