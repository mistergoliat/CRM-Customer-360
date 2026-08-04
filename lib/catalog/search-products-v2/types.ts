/**
 * Local, independent contracts for MS-pesaschile-catalog-service's
 * POST /api/v2/recommendations/search-products (SearchProducts V2). Ported
 * field-by-field from the real service's own Zod contracts
 * (services/src/application/recommendation/search-products-v2/contracts.ts,
 * services/src/domain/recommendation/customer-affinity/contracts.ts,
 * services/src/domain/recommendation/relationship-engine/contracts.ts in the
 * MS-Stock/services repo) - never imported as a dependency, so this repo
 * stays free of a cross-repo package. Same porting rule already used by
 * lib/catalog/types.ts and lib/customer-profile/types.ts.
 *
 * CP-R1-T10B5 scope: transport plumbing only. This client does not resolve
 * identity (`customerId` is an opaque string here, not masterCustomerId),
 * does not recompute score/rank/ownership, does not generate commercial
 * text, and is not wired to the Sales Agent or the Agent Tool Loop.
 */

export type SearchProductsV2ProductIdentity = {
  productId: string;
  combinationId?: string;
};

export type SearchProductsV2Money = {
  amount: number;
  currency: string;
};

export type SearchProductsV2RequestContext = {
  customerId?: string;
  intent?: string;
  useCase?: string;
  budget?: SearchProductsV2Money;
  preferredProducts?: readonly SearchProductsV2ProductIdentity[];
  excludedProducts?: readonly SearchProductsV2ProductIdentity[];
  /**
   * Explicit current-intent repurchase signal (real contract's
   * explicitRepurchaseProducts) - never derived from ownership/history by
   * this client. Must not share an identity with excludedProducts.
   */
  explicitRepurchaseProducts?: readonly SearchProductsV2ProductIdentity[];
};

export type SearchProductsV2Filters = {
  inStockOnly?: boolean;
};

/**
 * `filters.productIds` deliberately omitted: the real request schema
 * technically accepts it, but the service rejects it at runtime
 * (`INVALID_REQUEST`, "productIds filter is not supported by SearchProducts
 * V2 V1") - confirmed against services/src/application/recommendation/
 * search-products-v2/defaultSearchProductsV2Service.ts. Never send it.
 */
export type SearchProductsV2ClientRequest = {
  query?: string;
  sourceProduct: SearchProductsV2ProductIdentity;
  customer?: { customerId: string };
  context?: SearchProductsV2RequestContext;
  filters?: SearchProductsV2Filters;
  limit?: number;
};

export const SEARCH_PRODUCTS_V2_STOCK_STATUSES = ["in_stock", "out_of_stock", "available_for_order", "unknown"] as const;
export type SearchProductsV2StockStatus = (typeof SEARCH_PRODUCTS_V2_STOCK_STATUSES)[number];

export type SearchProductsV2Stock = {
  status: SearchProductsV2StockStatus;
  quantity?: number;
  available: boolean;
};

export const SEARCH_PRODUCTS_V2_AVAILABILITY_STATUSES = ["available", "out_of_stock", "inactive", "unavailable_for_order", "unknown"] as const;
export type SearchProductsV2AvailabilityStatus = (typeof SEARCH_PRODUCTS_V2_AVAILABILITY_STATUSES)[number];

export type SearchProductsV2Availability = {
  status: SearchProductsV2AvailabilityStatus;
  purchasable: boolean;
  active: boolean;
  availableForOrder: boolean;
  stockQuantity: number | null;
  stockKnown: boolean;
  evaluatedAt: string;
};

export type SearchProductsV2Pricing = {
  baseGrossAmount: number;
  finalGrossAmount: number;
  currency: string;
  taxIncluded: true;
  taxRate: number;
  discountApplied: boolean;
  discountType: "percentage" | "amount" | null;
  discountValue: number | null;
  specificPriceId: number | null;
  evaluatedAt: string;
};

export const SEARCH_PRODUCTS_V2_PUBLIC_LINK_SCOPES = ["exact_product", "parent_product"] as const;
export const SEARCH_PRODUCTS_V2_PUBLIC_LINK_UNAVAILABLE_REASONS = ["missing_link_rewrite", "invalid_product_id", "invalid_base_url"] as const;

export type SearchProductsV2ProductPublicLink = {
  canonicalUrl: string | null;
  scope: (typeof SEARCH_PRODUCTS_V2_PUBLIC_LINK_SCOPES)[number];
  available: boolean;
  unavailableReason?: (typeof SEARCH_PRODUCTS_V2_PUBLIC_LINK_UNAVAILABLE_REASONS)[number];
  requiresVariantSelection: boolean;
  variantAttributeLabels: readonly string[];
};

/**
 * Same object for `sourceProduct` (echoed/enriched) and every
 * `recommendations[].product` - both use the real service's
 * searchProductsV2CatalogProductSummarySchema.
 */
export type SearchProductsV2ProductSummary = {
  productId: string;
  combinationId?: string;
  name: string;
  reference?: string;
  description?: string;
  category?: string;
  active: boolean;
  /** Unknown price stays null - never presented as zero or invented. */
  price: SearchProductsV2Money | null;
  stock: SearchProductsV2Stock;
  availability?: SearchProductsV2Availability;
  pricing?: SearchProductsV2Pricing | null;
  publicLink?: SearchProductsV2ProductPublicLink;
  productUrl?: string;
  imageUrl?: string;
};

/**
 * Neutral pass-through fact from Customer Profile (via T09/T10 upstream) -
 * genuinely optional. Absent on sourceProduct and on excluded[] entries
 * always; absent per-recommendation whenever the upstream affinity provider
 * did not evaluate that exact productId::combinationId identity. Never
 * fabricate `previouslyPurchased: false` when this field is simply absent,
 * and never derive it from score/rank/reasons.
 */
export type SearchProductsV2Ownership = {
  previouslyPurchased: boolean;
  exactVariantPreviouslyPurchased: boolean;
  totalOrderCount?: number;
  firstPurchasedAt?: string;
  lastPurchasedAt?: string;
};

export const SEARCH_PRODUCTS_V2_REASON_CODES = [
  "STRONG_COMMERCIAL_RELEVANCE",
  "CUSTOMER_PRODUCT_AFFINITY",
  "CUSTOMER_CATEGORY_AFFINITY",
  "CUSTOMER_BRAND_AFFINITY",
  "RECENT_PRODUCT_INTEREST",
  "RECENT_CATEGORY_INTEREST",
  "OWNED_COMPATIBLE_PRODUCT",
  "REPEAT_PURCHASE_PATTERN",
  "OBSERVED_SPEND_COMPATIBILITY",
  "EXPLICIT_CONTEXT_PREFERENCE",
  "EXPLICIT_REPURCHASE_INTENT",
  "GENERAL_COMMERCIAL_FALLBACK"
] as const;
export type SearchProductsV2ReasonCode = (typeof SEARCH_PRODUCTS_V2_REASON_CODES)[number];

export const SEARCH_PRODUCTS_V2_REASON_SOURCES = ["commercial", "affinity", "context", "fallback"] as const;
export type SearchProductsV2ReasonSource = (typeof SEARCH_PRODUCTS_V2_REASON_SOURCES)[number];

export type SearchProductsV2Reason = {
  code: SearchProductsV2ReasonCode;
  source: SearchProductsV2ReasonSource;
};

/**
 * Full, real 17-value enum. Both globally-scoped (no `product`) and
 * per-product-scoped (`product` present) warnings live in this same shape -
 * used both at the result's top-level `warnings[]` and inside each
 * `recommendations[].warnings[]`. `RESULTS_TRUNCATED` is declared upstream
 * but has no known emission site as of this task - reserved, do not assume
 * it fires.
 */
export const SEARCH_PRODUCTS_V2_WARNING_CODES = [
  "NO_COMMERCIAL_CANDIDATES",
  "CUSTOMER_NOT_IDENTIFIED",
  "NO_CUSTOMER_HISTORY",
  "PARTIAL_CUSTOMER_HISTORY",
  "CUSTOMER_HISTORY_NOT_LINKED",
  "CUSTOMER_REFERENCE_NOT_FOUND",
  "CUSTOMER_AFFINITY_UNAVAILABLE",
  "AFFINITY_MISSING_FOR_PRODUCT",
  "PERSONALIZATION_CONTEXT_PARTIALLY_APPLIED",
  "RESULTS_TRUNCATED",
  "CATALOG_PRODUCT_MISSING",
  "CATALOG_PRODUCT_INACTIVE",
  "CATALOG_PRICE_UNAVAILABLE",
  "CATALOG_STOCK_UNKNOWN",
  "UPSTREAM_COMMERCIAL_WARNING",
  "UPSTREAM_AFFINITY_WARNING",
  "UPSTREAM_PERSONALIZATION_WARNING"
] as const;
export type SearchProductsV2WarningCode = (typeof SEARCH_PRODUCTS_V2_WARNING_CODES)[number];

export type SearchProductsV2Warning = {
  code: SearchProductsV2WarningCode;
  /** Present = scoped to a product; absent = global. Never a separate array. */
  product?: SearchProductsV2ProductIdentity;
  details?: Readonly<Record<string, unknown>>;
};

export const SEARCH_PRODUCTS_V2_EXCLUSION_CODES = [
  "EXPLICIT_CONTEXT_EXCLUSION",
  "EXPLICIT_PRODUCT_REJECTION",
  "BELOW_MINIMUM_PERSONALIZED_SCORE",
  "RESULT_LIMIT_TRUNCATION",
  "MISSING_CATALOG_PRODUCT",
  "INACTIVE_PRODUCT",
  "OUT_OF_STOCK_FILTERED"
] as const;
export type SearchProductsV2ExclusionCode = (typeof SEARCH_PRODUCTS_V2_EXCLUSION_CODES)[number];

export type SearchProductsV2Exclusion = {
  product: SearchProductsV2ProductIdentity;
  code: SearchProductsV2ExclusionCode;
};

export const SEARCH_PRODUCTS_V2_AFFINITY_CONFIDENCES = ["none", "low", "medium", "high"] as const;
export type SearchProductsV2AffinityConfidence = (typeof SEARCH_PRODUCTS_V2_AFFINITY_CONFIDENCES)[number];

export const SEARCH_PRODUCTS_V2_COMMERCIAL_REASON_CODES = ["FREQUENTLY_BOUGHT_TOGETHER", "RELATED_PRODUCT_FALLBACK", "CUSTOMER_AFFINITY_MATCH"] as const;
export type SearchProductsV2CommercialReasonCode = (typeof SEARCH_PRODUCTS_V2_COMMERCIAL_REASON_CODES)[number];

export type SearchProductsV2CommercialReason = {
  code: SearchProductsV2CommercialReasonCode;
  /** Human-readable, Spanish, real service copy - passed through verbatim, never re-authored. */
  label: string;
};

export type SearchProductsV2RelationshipEvidence = {
  jointCount: number;
  support: number;
  confidence: number;
  lift: number;
};

export type SearchProductsV2Relationship = {
  type: string;
  reliability: number;
  evidence: SearchProductsV2RelationshipEvidence;
};

export type SearchProductsV2Ranking = {
  rank: number;
  score: number;
};

/**
 * `rank`/`score` are duplicated at the recommendation top level and again
 * inside `ranking` by the real contract - both preserved verbatim, never
 * collapsed into one.
 */
export type SearchProductsV2Recommendation = {
  product: SearchProductsV2ProductSummary;
  rank: number;
  score: number;
  commercialScore: number;
  affinityScore: number;
  affinityConfidence: SearchProductsV2AffinityConfidence;
  ranking: SearchProductsV2Ranking;
  relationship: SearchProductsV2Relationship;
  commercialReason: SearchProductsV2CommercialReason;
  reasons: readonly SearchProductsV2Reason[];
  /** Scoped to this product only - distinct from the result's top-level `warnings[]`. */
  warnings: readonly SearchProductsV2Warning[];
  ownership?: SearchProductsV2Ownership;
};

/**
 * Complete, real 5-value enum. `applied: true` never coexists with `reason`;
 * `applied: false` always has a `reason` except `customer_not_provided`
 * (no `customer` was sent at all, so there is nothing to name).
 */
export const SEARCH_PRODUCTS_V2_PERSONALIZATION_REASONS = [
  "customer_not_provided",
  "customer_affinity_unavailable",
  "customer_reference_not_found",
  "customer_history_not_linked",
  "no_customer_history"
] as const;
export type SearchProductsV2PersonalizationReason = (typeof SEARCH_PRODUCTS_V2_PERSONALIZATION_REASONS)[number];

export type SearchProductsV2Personalization = {
  applied: boolean;
  reason?: SearchProductsV2PersonalizationReason;
  customerId?: string;
};

export type SearchProductsV2Snapshot = {
  id: string;
  modelVersion: string;
};

export type SearchProductsV2Statistics = {
  commercialCandidates: number;
  affinityCandidates: number;
  personalizedRecommendations: number;
  excludedRecommendations: number;
  customerAffinityCalls: 0 | 1;
  personalizationCalls: 0 | 1;
  degradedStages: number;
  warningsGenerated: number;
};

/**
 * Only 2 real degradation reasons exist. `CUSTOMER_HISTORY_NOT_LINKED` /
 * `CUSTOMER_REFERENCE_NOT_FOUND` are warning/personalization-reason values,
 * never degradation reasons - confirmed against the real service: they never
 * set `degraded=true` and never move `customerAffinity` past `completed`.
 */
export const SEARCH_PRODUCTS_V2_DEGRADATION_CODES = ["CUSTOMER_AFFINITY_RETRYABLE_FAILURE", "CUSTOMER_AFFINITY_PROVIDER_RESPONSE_INVALID"] as const;
export type SearchProductsV2DegradationCode = (typeof SEARCH_PRODUCTS_V2_DEGRADATION_CODES)[number];

export type SearchProductsV2ExecutionStages = {
  commercialRecommendation: "completed" | "failed";
  customerAffinity: "completed" | "skipped" | "degraded" | "failed";
  personalization: "completed" | "skipped" | "failed";
};

/**
 * `degraded: true` with a valid HTTP 200 payload is a successful protocol
 * outcome for this client, never mapped to an error result.
 */
export type SearchProductsV2Execution = {
  correlationId: string;
  degraded: boolean;
  degradationReasons: readonly SearchProductsV2DegradationCode[];
  stages: SearchProductsV2ExecutionStages;
};

export type SearchProductsV2ClientResponse = {
  query: string | null;
  sourceProduct: SearchProductsV2ProductSummary;
  customer?: { customerId: string };
  recommendations: readonly SearchProductsV2Recommendation[];
  excluded: readonly SearchProductsV2Exclusion[];
  personalization: SearchProductsV2Personalization;
  snapshot: SearchProductsV2Snapshot;
  warnings: readonly SearchProductsV2Warning[];
  statistics: SearchProductsV2Statistics;
  execution: SearchProductsV2Execution;
};

export const SEARCH_PRODUCTS_V2_CLIENT_ERROR_CODES = [
  "configuration_error",
  "invalid_request",
  "timeout",
  "aborted",
  "network_error",
  "unauthorized",
  "forbidden",
  "rate_limited",
  "catalog_service_error",
  "invalid_response_body",
  "invalid_response_schema",
  "unexpected_http_status"
] as const;
export type SearchProductsV2ClientErrorCode = (typeof SEARCH_PRODUCTS_V2_CLIENT_ERROR_CODES)[number];

/**
 * `message` is always safe (never a raw response body, header, stack, or
 * secret - see httpCatalogSearchProductsV2Client.ts#sanitizeErrorMessage).
 * `providerErrorCode` mirrors the real service's own closed error code
 * (e.g. "SOURCE_PRODUCT_NOT_FOUND") when the HTTP error body carried one.
 */
export type SearchProductsV2ClientError = {
  code: SearchProductsV2ClientErrorCode;
  message: string;
  retryable: boolean;
  httpStatus?: number;
  providerErrorCode?: string;
};

export type SearchProductsV2ClientResult = { ok: true; value: SearchProductsV2ClientResponse } | { ok: false; error: SearchProductsV2ClientError };

export type SearchProductsV2ClientCallContext = {
  correlationId?: string;
  signal?: AbortSignal;
};

export type CatalogSearchProductsV2Client = {
  searchProducts(request: SearchProductsV2ClientRequest, context?: SearchProductsV2ClientCallContext): Promise<SearchProductsV2ClientResult>;
};

export const SEARCH_PRODUCTS_V2_CLIENT_CONTRACT_VERSION = "catalog-search-products-v2.v1" as const;
