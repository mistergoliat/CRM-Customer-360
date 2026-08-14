import type { AssembleQuoteInputSuccess } from "./types";

/**
 * SALES-AGENT-R1-T2. Closed error taxonomy the task itself specified
 * (section 23) - consumed by T3/T6, never surfaced as a WhatsApp response
 * directly from here.
 */
export const QUOTE_ASSEMBLY_ERROR_CODES = [
  "missing_opportunity",
  "no_commercial_line_items",
  "catalog_unavailable",
  "catalog_product_not_found",
  "catalog_variant_not_found",
  "invalid_quantity",
  "catalog_price_missing",
  "catalog_tax_metadata_missing",
  "currency_mismatch",
  "customer_snapshot_incomplete",
  "shipping_selection_missing",
  /** SALES-AGENT-R1-T2.1: the selected option no longer matches the opportunity's current commercial_line_items/shipping_destination - must be recalculated and re-selected, never silently reused. */
  "shipping_selection_stale",
  /**
   * SALES-AGENT-R1-T2.1: a real, documented contract gap, not a bug - Carrier
   * MS provides no tax metadata (no taxIncluded/taxRate/currency) for any
   * shipping option, and Quote Service has no shipping line-item
   * representation yet. A valid, fresh selection exists but cannot become a
   * QuoteServiceCreateRequest line without fabricating data - which this
   * assembler will never do. See docs/integrations/quote-input-assembly.md.
   */
  "shipping_tax_metadata_missing"
] as const;
export type QuoteAssemblyErrorCode = (typeof QUOTE_ASSEMBLY_ERROR_CODES)[number];

/**
 * `details` is allowlisted safe-to-log data only - productId/combinationId/
 * reason/field names. Never a customer name/email/phone, never a raw
 * Catalog/DB error message (task section 11: "sin datos sensibles").
 */
export type QuoteAssemblyError = {
  code: QuoteAssemblyErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

export type AssembleQuoteInputResult = AssembleQuoteInputSuccess | { ok: false; error: QuoteAssemblyError };

export function assemblyError(code: QuoteAssemblyErrorCode, message: string, details?: Record<string, unknown>): { ok: false; error: QuoteAssemblyError } {
  return { ok: false, error: { code, message, ...(details ? { details } : {}) } };
}
