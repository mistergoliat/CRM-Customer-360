import { createHttpQuoteServiceAdapter } from "./httpQuoteServiceAdapter";
import { readQuoteServiceConfig } from "./config";
import type { QuoteServicePort } from "@/lib/domains/quote-service";

export * from "./config";
export * from "./httpQuoteServiceAdapter";

/**
 * Productive QuoteServicePort factory. Returns null when
 * QUOTE_SERVICE_BASE_URL/QUOTE_SERVICE_AUTH_TOKEN are not configured, same
 * convention as createCatalogPort/createCarrierService - callers report
 * unavailable instead of crashing. SALES-AGENT-R1-T1: no caller exists yet
 * (no capability, no runtime wiring) - this factory is exported for T2+.
 */
export function createQuoteServicePort(): QuoteServicePort | null {
  const config = readQuoteServiceConfig();
  if (!config) return null;
  return createHttpQuoteServiceAdapter(config);
}
