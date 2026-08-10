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

export type ProductPublicLink = {
  canonicalUrl: string | null;
  scope: "exact_product" | "parent_product";
  available: boolean;
  unavailableReason?: "missing_link_rewrite" | "invalid_product_id" | "invalid_base_url";
  requiresVariantSelection: boolean;
  variantAttributeLabels: string[];
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
  /**
   * CRM-R1-T13E: base product weight + combination delta, rounded to 3
   * decimals by the upstream service. 0 is a real, preserved value (never
   * coerced to null); null means the service could not resolve a weight for
   * the selected variant (same "no resoluble" case as price/stock, not a
   * missing-field default). Never negative - the upstream service fails the
   * whole request closed (503) before a negative value could reach here.
   */
  weightKg: number | null;
  publicLink?: ProductPublicLink;
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

/** Mirrors the real service's POST /v1/products/batch item input (max 20 items per call). */
export type CatalogBatchItemInput = {
  productId: string;
  combinationId?: string;
  quantity?: number;
};

export type CatalogBatchItemResult =
  | { ok: true; input: CatalogBatchItemInput; product: CatalogProduct }
  | { ok: false; input: CatalogBatchItemInput; error: CatalogPortError };

export type CatalogBatchResult = {
  items: CatalogBatchItemResult[];
  provenance: CatalogProvenance;
};

export const CATALOG_EXPLORE_AVAILABILITY_FILTERS = ["available", "unavailable", "all"] as const;
export type CatalogExploreAvailabilityFilter = (typeof CATALOG_EXPLORE_AVAILABILITY_FILTERS)[number];

export const CATALOG_EXPLORE_SORT_FIELDS = ["price", "stock", "name"] as const;
export type CatalogExploreSortField = (typeof CATALOG_EXPLORE_SORT_FIELDS)[number];

export const CATALOG_EXPLORE_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type CatalogExploreSortDirection = (typeof CATALOG_EXPLORE_SORT_DIRECTIONS)[number];

export type CatalogExploreSort = {
  by: CatalogExploreSortField;
  direction: CatalogExploreSortDirection;
};

export type CatalogExplorePriceRange = {
  min?: number;
  max?: number;
};

export const CATALOG_EXPLORE_STOCK_SCOPES = ["product", "product_aggregate"] as const;
export type CatalogExploreStockScope = (typeof CATALOG_EXPLORE_STOCK_SCOPES)[number];

export const CATALOG_EXPLORE_CLASSIFICATION_SOURCES = ["category", "attribute", "rule", "text_fallback"] as const;
export type CatalogExploreClassificationSource = (typeof CATALOG_EXPLORE_CLASSIFICATION_SOURCES)[number];

/**
 * Explore endpoint input (POST /v1/products/explore, ACS-R1-05.1-T02.6).
 * Its filter/sort vocabulary and `availability` semantics are an independent
 * upstream sub-contract from searchProducts/getProductDetails - deliberately
 * not unified with CatalogAvailabilityStatus (different concept: catalog
 * scope filter, not per-item stock status). Confirmed against
 * mistergoliat/MS-pesaschile-catalog-service main@147794b / feature@efc2f7e.
 */
export type CatalogExploreInput = {
  query?: string;
  categoryId?: string;
  categorySlug?: string;
  productType?: string;
  price?: CatalogExplorePriceRange;
  availability?: CatalogExploreAvailabilityFilter;
  sort: CatalogExploreSort;
  limit: number;
};

export type CatalogExploreScope = {
  query?: string;
  categoryId?: string;
  categorySlug?: string;
  productType?: string;
  availability: CatalogExploreAvailabilityFilter;
};

export type CatalogExploreItem = {
  productId: string;
  name: string;
  /** Unknown price stays null - never presented as zero or invented (ADR-005). */
  price: number | null;
  currency: string;
  stockQuantity: number | null;
  stockScope: CatalogExploreStockScope;
  /**
   * Upstream leaves this an open string - its own vocabulary (e.g.
   * "inactive") is distinct from CatalogAvailabilityStatus. Preserved
   * verbatim, never coerced into a closed enum (ADR-005: unknown se conserva).
   */
  availability: string;
};

export type CatalogExploreResult = {
  scope: CatalogExploreScope;
  sort: CatalogExploreSort;
  totalMatched: number;
  /** Whether `items` covers every match for `scope`, or only a top slice - governs whether the agent may use absolute ranking language. */
  exhaustiveForScope: boolean;
  classificationSource?: CatalogExploreClassificationSource;
  items: CatalogExploreItem[];
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
  /**
   * ACS-R1-05-T06.2: hydrates up to 20 candidates in one call (real service
   * contract: POST /v1/products/batch). Internal enrichment step for the
   * search -> batch -> ranking pipeline - never exposed as a separate
   * LLM-facing tool (the Sales Agent only ever requests `searchProducts`).
   */
  batchGetProducts(
    input: { items: CatalogBatchItemInput[] },
    context: CatalogRequestContext
  ): Promise<CatalogPortResult<CatalogBatchResult>>;
  /**
   * ACS-R1-05.1-T02.6: extremes, top-N, rankings and filtered/sorted browse
   * (real service contract: POST /v1/products/explore). Independent
   * request/response vocabulary from searchProducts/getProductDetails - see
   * CatalogExploreInput/CatalogExploreResult.
   */
  exploreCatalog(
    input: CatalogExploreInput,
    context: CatalogRequestContext
  ): Promise<CatalogPortResult<CatalogExploreResult>>;
};

export const CATALOG_ADAPTER_CONTRACT_VERSION = "catalog-service.v1" as const;
