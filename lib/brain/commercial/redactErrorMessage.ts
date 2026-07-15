/**
 * Shared error-message redaction (ACS-R1-05-T06/T06.1, P1-2). Credential
 * patterns match what was already applied ad hoc in persistAgentAction.ts /
 * runCommercialOperationalLoop.ts / runSalesAgentDryRun.ts /
 * buildCommercialShadowReview.ts - centralized here so every site that
 * persists a caught error (runFollowupTick.ts, persistActionOutcome.ts#
 * markActionFailed, autonomousOutboxTick.ts) reuses one implementation
 * instead of writing another copy. T06.1 added email/phone redaction:
 * a Meta API error can echo the recipient's own phone number or an email
 * address back in its message.
 */
export function redactErrorMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/\b(sk-[A-Za-z0-9_-]+)\b/gi, "[redacted]")
    .replace(/\b(authorization|api[-_]?key|token|secret|password|cookie)\s*[:=]?\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .replace(/\+?\d[\d\s()-]{6,}\d/g, (match) => ((match.match(/\d/g) ?? []).length >= 8 ? "[redacted-phone]" : match))
    .trim();
}
