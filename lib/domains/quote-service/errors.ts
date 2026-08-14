/**
 * Typed error boundary for the Quote Service adapter. `class` is a closed,
 * coarse bucket callers can branch on without knowing every real error code;
 * `code` preserves the real service's own code verbatim (its error vocabulary
 * is itself stable/documented - README "Main Error Codes") so a caller that
 * needs finer distinction (e.g. idempotency_key_reused_with_different_payload
 * vs optimistic_concurrency_conflict, both class "conflict") still can.
 *
 * Same shape family as CatalogPortResult/CatalogPortError
 * (lib/catalog/types.ts) - ok/error discriminated union, never a thrown
 * exception for an expected business/HTTP outcome.
 */

export const QUOTE_SERVICE_ERROR_CLASSES = [
  "auth",
  "validation",
  "not_found",
  "conflict",
  "invalid_transition",
  "upstream_unavailable",
  "timeout",
  "malformed_response",
  "not_configured"
] as const;
export type QuoteServiceErrorClass = (typeof QUOTE_SERVICE_ERROR_CLASSES)[number];

export type QuoteServiceError = {
  readonly class: QuoteServiceErrorClass;
  /** Verbatim `error.code` from the real envelope when present; an adapter-only code (see below) otherwise. Never includes secrets - sanitized before this type is constructed. */
  readonly code: string;
  readonly message: string;
  readonly httpStatus: number | null;
  readonly details?: Record<string, unknown>;
  readonly retryable: boolean;
};

export type QuoteServiceResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: QuoteServiceError };

/** Adapter-only codes - never returned by the real service's error envelope. */
export const QUOTE_SERVICE_ADAPTER_ERROR_CODES = {
  timeout: "quote_service_timeout",
  networkUnavailable: "quote_service_unavailable",
  malformedResponse: "quote_service_malformed_response",
  notConfigured: "quote_service_not_configured"
} as const;

/**
 * Real error codes documented in the Quote Service's own README ("Main Error
 * Codes") and confirmed in src/http/errors.ts / src/domain/errors.ts /
 * src/application/quote/errors.ts, grouped by the class this adapter exposes.
 * A code the real service returns that is NOT in this table (a future
 * addition on their side) falls back to the HTTP-status heuristic in
 * classifyByStatus - never dropped, never crashes this table lookup.
 */
const ERROR_CODE_CLASS_TABLE: Record<string, QuoteServiceErrorClass> = {
  missing_authentication: "auth",
  invalid_authentication: "auth",

  validation_error: "validation",
  invalid_quote_reference: "validation",
  invalid_quote_number: "validation",
  invalid_actor: "validation",
  invalid_source: "validation",
  invalid_currency: "validation",
  invalid_customer_snapshot: "validation",
  invalid_line_quantity: "validation",
  invalid_line_price: "validation",
  invalid_tax_rate: "validation",
  invalid_valid_until: "validation",
  invalid_email_recipient: "validation",
  quote_email_recipient_missing: "validation",

  quote_not_found: "not_found",
  quote_delivery_not_found: "not_found",
  document_not_found: "not_found",

  draft_only_operation: "conflict",
  quote_already_terminal: "conflict",
  quote_already_superseded: "conflict",
  optimistic_concurrency_conflict: "conflict",
  idempotency_key_reused_with_different_payload: "conflict",
  idempotency_request_in_progress: "conflict",
  quote_email_delivery_not_allowed: "conflict",

  invalid_quote_status_transition: "invalid_transition",

  document_generation_failed: "upstream_unavailable",
  document_storage_failed: "upstream_unavailable",
  document_issuance_unavailable: "upstream_unavailable",
  email_delivery_unavailable: "upstream_unavailable",
  internal_server_error: "upstream_unavailable"
};

/** Never retries a conflict/validation/auth outcome automatically - only technical, transient failures are retryable (mirrors httpCarrierServiceAdapter.ts's carrier_service_unavailable/timeout split). */
const RETRYABLE_CLASSES = new Set<QuoteServiceErrorClass>(["upstream_unavailable", "timeout"]);

/**
 * Fallback for an httpStatus/code combination this table does not recognize
 * (a future error code the real service adds that this adapter has not been
 * updated for yet) - conservative by HTTP status range, same discipline as
 * httpCatalogAdapter.ts's mapProviderErrorCode default branch.
 */
function classifyByStatus(httpStatus: number): QuoteServiceErrorClass {
  if (httpStatus === 401) return "auth";
  if (httpStatus === 404) return "not_found";
  if (httpStatus === 409) return "conflict";
  if (httpStatus === 400 || httpStatus === 422) return "validation";
  if (httpStatus === 503) return "upstream_unavailable";
  if (httpStatus >= 500) return "upstream_unavailable";
  return "malformed_response";
}

export function classifyQuoteServiceErrorCode(code: string, httpStatus: number): QuoteServiceErrorClass {
  return ERROR_CODE_CLASS_TABLE[code] ?? classifyByStatus(httpStatus);
}

export function isRetryableQuoteServiceErrorClass(errorClass: QuoteServiceErrorClass): boolean {
  return RETRYABLE_CLASSES.has(errorClass);
}
