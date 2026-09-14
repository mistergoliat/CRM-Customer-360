import { createHttpQuoteServiceAdapter } from "./httpQuoteServiceAdapter";
import { readQuoteServiceConfig } from "./config";
import type { QuoteServicePort } from "@/lib/domains/quote-service";

export * from "./config";
export * from "./httpQuoteServiceAdapter";

/**
 * Productive QuoteServicePort factory. Returns null when
 * QUOTE_SERVICE_BASE_URL/QUOTE_SERVICE_AUTH_TOKEN are not configured, same
 * convention as createCatalogPort/createCarrierService - callers report
 * unavailable instead of crashing. Capabilities call this factory at runtime
 * and receive a governed temporary block when the external dependency is not
 * configured.
 */
export function createQuoteServicePort(): QuoteServicePort | null {
  const config = readQuoteServiceConfig();
  if (!config) return null;
  return createHttpQuoteServiceAdapter(config);
}
