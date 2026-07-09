// Centralized, structured warning vocabulary for the native customer
// session (ACS-R1-04-T06). Never a raw message, SQL fragment, URL, header,
// payload, stack trace, candidate list or PII - see task section 20.
export const NATIVE_SESSION_WARNINGS = [
  "customer_identity_conflict",
  "customer_identity_unavailable",
  "customer_identity_invalid_input",
  "customer_onboarding_version_conflict",
  "customer_onboarding_temporarily_blocked",
  "customer_service_unavailable",
  "customer_creation_conflict",
  "customer_link_conflict",
  "customer_consent_required"
] as const;

export type NativeSessionWarning = (typeof NATIVE_SESSION_WARNINGS)[number];

export function isNativeSessionWarning(value: string): value is NativeSessionWarning {
  return (NATIVE_SESSION_WARNINGS as readonly string[]).includes(value);
}

/** Combines warnings from multiple sources (session, runtime, Customer 360) without duplicates. */
export function mergeWarnings(...groups: Array<readonly string[] | undefined>): string[] {
  return [...new Set(groups.flatMap((group) => group ?? []))];
}
