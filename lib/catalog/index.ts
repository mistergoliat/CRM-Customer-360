import { createHttpCatalogAdapter, readHttpCatalogAdapterConfig } from "./httpCatalogAdapter";
import type { CatalogPort } from "./types";

export * from "./types";
export { createHttpCatalogAdapter, readHttpCatalogAdapterConfig } from "./httpCatalogAdapter";

/**
 * Productive CatalogService factory (ADR-005). Returns null when
 * CATALOG_SERVICE_BASE_URL / CATALOG_SERVICE_API_KEY are not configured so
 * callers can report `unavailable` instead of crashing - never falls back to
 * PrestaShop SQL or a snapshot as a productive substitute.
 */
export function createCatalogPort(): CatalogPort | null {
  const config = readHttpCatalogAdapterConfig();
  if (!config) return null;
  return createHttpCatalogAdapter(config);
}
