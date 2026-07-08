/**
 * Catalog port (ADR-005): the commercial domain depends on this contract only
 * - never on HTTP endpoints, API keys, or PrestaShop SQL directly. Field
 * shapes are trimmed to what the real MS-pesaschile-catalog-service returns;
 * fields it does not provide (dimensions, compatibility) are intentionally
 * absent rather than invented.
 */

export const CATALOG_AVAILABILITY_STATUSES = [
  "in_stock",
  "out_of_stock",
  "unknown"
] as const;
export type CatalogAvailabilityStatus = (typeof CATALOG_AVAILABILITY_STATUSES)[number];

export type CatalogProvenance = {
  source: "catalog_service_http";
  retrievedAt: string;
  /** True when the upstream service served this from its own cache, not a fresh read. */
  cached: boolean;
};

export type CatalogAttribute = {
  group: string;
  value: string;
};

export type CatalogProductVariant = {
  variantId: string;
  sku: string | null;
  label: string | null;
  attributes: CatalogAttribute[];
  /** Price delta vs. the base product; null when unknown. Never zero-filled. */
  priceImpact: number | null;
  stockQuantity: number | null;
  availability: CatalogAvailabilityStatus;
  isDefault: boolean;
};

export type CatalogProductPrice = {
  /** Unknown price stays null - never presented as zero or invented (ADR-005). */
  amount: number | null;
  currency: string | null;
  taxIncluded: boolean | null;
  discountApplied: boolean;
};

export type CatalogProduct = {
  productId: string;
  name: string;
  sku: string | null;
  shortDescription: string | null;
  longDescription: string | null;
  active: boolean;
  selectedVariant: CatalogProductVariant | null;
  variants: CatalogProductVariant[];
  price: CatalogProductPrice | null;
  availability: CatalogAvailabilityStatus;
  stockQuantity: number | null;
  provenance: CatalogProvenance;
};

export type CatalogSearchResultItem = {
  productId: string;
  combinationId: string;
  sku: string | null;
  name: string;
  variantLabel: string | null;
  shortDescription: string | null;
  stockQuantity: number | null;
  availability: CatalogAvailabilityStatus;
  matchType: "exact_sku" | "exact_name" | "partial_name" | "description";
};

export type CatalogSearchResult = {
  query: string;
  items: CatalogSearchResultItem[];
  provenance: CatalogProvenance;
};

export const CATALOG_PORT_ERROR_CODES = [
  "invalid_input",
  "unauthorized",
  "rate_limited",
  "not_found",
  "unavailable",
  "timeout",
  "invalid_response",
  "not_configured",
  "unknown_error"
] as const;
export type CatalogPortErrorCode = (typeof CATALOG_PORT_ERROR_CODES)[number];

export type CatalogPortError = {
  code: CatalogPortErrorCode;
  message: string;
  retryable: boolean;
  providerErrorCode?: string | null;
  correlationId?: string | null;
};

export type CatalogPortResult<T> = { ok: true; value: T } | { ok: false; error: CatalogPortError };

export type CatalogRequestContext = {
  correlationId: string;
};

export type CatalogPort = {
  searchProducts(
    input: { query: string; limit?: number; includeOutOfStock?: boolean },
    context: CatalogRequestContext
  ): Promise<CatalogPortResult<CatalogSearchResult>>;
  getProductDetails(
    input: { productId: string; combinationId?: string },
    context: CatalogRequestContext
  ): Promise<CatalogPortResult<CatalogProduct | null>>;
};

export const CATALOG_ADAPTER_CONTRACT_VERSION = "catalog-service.v1" as const;
