export const CUSTOMER_ONBOARDING_ERROR_CODES = [
  "missing_required_customer_fields",
  "invalid_email",
  "ambiguous_email",
  "email_not_found",
  "customer_lookup_failed",
  "customer_creation_failed",
  "customer_link_failed",
  "db_write_disabled",
  "identity_conflict",
  "handoff_required"
] as const;

export type CustomerOnboardingErrorCode = (typeof CUSTOMER_ONBOARDING_ERROR_CODES)[number];

export function buildCustomerOnboardingError(code: CustomerOnboardingErrorCode, message: string, retryable = false) {
  return {
    code,
    message,
    retryable
  };
}
