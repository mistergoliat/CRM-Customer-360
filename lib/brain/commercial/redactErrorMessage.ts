/**
 * Shared error-message redaction (ACS-R1-05-T06, P1-2). Same pattern already
 * applied ad hoc in persistAgentAction.ts / runCommercialOperationalLoop.ts /
 * runSalesAgentDryRun.ts / buildCommercialShadowReview.ts - centralized here
 * so the two sites that previously persisted raw error.message
 * (runFollowupTick.ts, persistActionOutcome.ts#markActionFailed) can reuse it
 * instead of writing a fifth copy.
 */
export function redactErrorMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/\b(sk-[A-Za-z0-9_-]+)\b/gi, "[redacted]")
    .replace(/\b(authorization|api[-_]?key|token|secret|password|cookie)\s*[:=]?\s*[^\s,;]+/gi, "$1=[redacted]")
    .trim();
}
