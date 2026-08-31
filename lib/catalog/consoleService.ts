import { randomUUID } from "node:crypto";
import { createCatalogPort, type CatalogPort, type CatalogPortError, type CatalogPortResult, type CatalogProduct, type CatalogProductSemantics, type CatalogSearchResultItem } from "@/lib/catalog";
import { DEFAULT_RECOMMENDATION_LIMIT, MAX_RECOMMENDATION_LIMIT } from "@/lib/catalog/consoleLimits";
import { createCatalogSearchProductsV2Client, type CatalogSearchProductsV2Client, type SearchProductsV2ClientError, type SearchProductsV2ProductSummary } from "@/lib/catalog/search-products-v2";

const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 20;
const MAX_QUERY_LENGTH = 120;
const PRODUCT_ID_PATTERN = /^\d{1,20}$/;

export type CatalogConsoleErrorCode =
  | "invalid_query"
  | "invalid_product_id"
  | "invalid_limit"
  | "catalog_not_configured"
  | "catalog_unauthorized"
  | "catalog_unavailable"
  | "catalog_timeout"
  | "product_not_found"
  | "invalid_catalog_response"
  | "catalog_request_failed";

export type CatalogConsoleError = {
  code: CatalogConsoleErrorCode;
  message: string;
  retryable: boolean;
};

export type CatalogConsoleProduct = {
  productId: string;
  combinationId?: string;
  name: string;
  reference: string | null;
  description: string | null;
  price: { amount: number; currency: string } | null;
  stock: { quantity: number | null; status: string; available: boolean | null };
  availability: string;
  active: boolean | null;
  publicLink: string | null;
  source: "search" | "detail" | "recommendations_v2";
};

export type CatalogConsoleRecommendation = CatalogConsoleProduct & {
  rank: number;
  score: number;
  commercialScore: number;
  affinityScore: number;
  affinityConfidence: string;
  commercialReason: string;
  warnings: string[];
  relationship: {
    type: string;
    reliability: number;
    evidence: {
      jointCount: number;
      support: number;
      confidence: number;
      lift: number;
      reliability: number;
    };
  };
};

export type CatalogRecommendationExcludedItem = {
  productId: string;
  combinationId?: string;
  code: string;
};

export type CatalogRecommendationStatistics = {
  recommendationsReturned: number;
  commercialCandidates: number;
  affinityCandidates: number;
  personalizedRecommendations: number;
  excludedRecommendations: number;
  warningsGenerated: number;
};

type CatalogRecommendationsBaseBlock = {
  requestedLimit: number;
  shownCount: number;
  truncatedByLimitCount: number;
  excluded: CatalogRecommendationExcludedItem[];
  statistics: CatalogRecommendationStatistics;
  warnings: string[];
  execution: { degraded: boolean; stages: Record<string, string> };
  snapshot: { id: string; modelVersion: string };
};

export type CatalogSearchProductsResult =
  | { ok: true; query: string; items: CatalogConsoleProduct[] }
  | { ok: false; error: CatalogConsoleError };

export type CatalogRecommendationsBlock =
  | (CatalogRecommendationsBaseBlock & {
      status: "available";
      items: CatalogConsoleRecommendation[];
    })
  | (CatalogRecommendationsBaseBlock & { status: "empty" })
  | { status: "error"; error: CatalogConsoleError };

/**
 * CATALOG-INTELLIGENCE-A00.5.1: semantics is a degradable inspection branch
 * of the product context - its failure never turns the whole context result
 * into { ok: false }, unlike product detail. "not_available" means the
 * product exists commercially but is outside the classified universe (real
 * service 404), distinct from "error" (e.g. the snapshot is not loaded, a
 * real 503).
 */
export type CatalogSemanticsBlock =
  | { status: "available"; semantics: CatalogProductSemantics }
  | { status: "not_available" }
  | { status: "error"; error: CatalogConsoleError };

export type CatalogProductContextResult =
  | { ok: true; product: CatalogConsoleProduct; recommendations: CatalogRecommendationsBlock; semantics: CatalogSemanticsBlock; warnings: string[] }
  | { ok: false; error: CatalogConsoleError };

type Deps = {
  catalogPort?: CatalogPort | null;
  recommendationsClient?: CatalogSearchProductsV2Client;
  correlationId?: string;
};

function normalizeQuery(query: string): string | null {
  const trimmed = query.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_QUERY_LENGTH) return null;
  return trimmed;
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isInteger(limit) || limit === undefined || limit < 1) return DEFAULT_SEARCH_LIMIT;
  return Math.min(limit, MAX_SEARCH_LIMIT);
}

export function normalizeCatalogRecommendationLimit(limit: number | undefined): { ok: true; value: number } | { ok: false; error: CatalogConsoleError } {
  if (limit === undefined) return { ok: true, value: DEFAULT_RECOMMENDATION_LIMIT };
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECOMMENDATION_LIMIT) {
    return { ok: false, error: { code: "invalid_limit", message: `Recommendation limit must be an integer between 1 and ${MAX_RECOMMENDATION_LIMIT}.`, retryable: false } };
  }
  return { ok: true, value: limit };
}

export function isValidCatalogConsoleProductId(productId: string): boolean {
  return PRODUCT_ID_PATTERN.test(productId.trim());
}

function unavailableError(message = "Catalog Service is not configured."): CatalogConsoleError {
  return { code: "catalog_not_configured", message, retryable: false };
}

function mapCatalogPortError(error: CatalogPortError): CatalogConsoleError {
  switch (error.code) {
    case "invalid_input":
      return { code: "invalid_query", message: "Invalid catalog search input.", retryable: false };
    case "unauthorized":
      return { code: "catalog_unauthorized", message: "Catalog Service rejected the CRM credentials.", retryable: false };
    case "not_found":
      return { code: "product_not_found", message: "Product was not found.", retryable: false };
    case "timeout":
      return { code: "catalog_timeout", message: "Catalog Service request timed out.", retryable: true };
    case "rate_limited":
    case "unavailable":
      return { code: "catalog_unavailable", message: "Catalog Service is temporarily unavailable.", retryable: true };
    case "invalid_response":
      return { code: "invalid_catalog_response", message: "Catalog Service returned an unexpected response.", retryable: false };
    case "not_configured":
      return unavailableError();
    case "unknown_error":
      return { code: "catalog_request_failed", message: "Catalog Service request failed.", retryable: error.retryable };
  }
}

function mapRecommendationsError(error: SearchProductsV2ClientError): CatalogConsoleError {
  switch (error.code) {
    case "configuration_error":
      return unavailableError("Catalog Service recommendations client is not configured.");
    case "invalid_request":
      return { code: "invalid_product_id", message: "Invalid product recommendation request.", retryable: false };
    case "unauthorized":
    case "forbidden":
      return { code: "catalog_unauthorized", message: "Catalog Service rejected the CRM credentials.", retryable: false };
    case "timeout":
      return { code: "catalog_timeout", message: "Catalog Service recommendations request timed out.", retryable: true };
    case "network_error":
    case "rate_limited":
      return { code: "catalog_unavailable", message: "Catalog Service recommendations are temporarily unavailable.", retryable: true };
    case "catalog_service_error":
      if (error.providerErrorCode === "SOURCE_PRODUCT_NOT_FOUND") {
        return { code: "product_not_found", message: "Product was not found.", retryable: false };
      }
      return { code: "catalog_request_failed", message: "Catalog recommendation engine returned an error.", retryable: error.retryable };
    case "invalid_response_body":
    case "invalid_response_schema":
    case "unexpected_http_status":
      return { code: "invalid_catalog_response", message: "Catalog recommendation engine returned an unexpected response.", retryable: false };
    case "aborted":
      return { code: "catalog_request_failed", message: "Catalog recommendation request was cancelled.", retryable: false };
  }
}

function mapSearchItem(item: CatalogSearchResultItem): CatalogConsoleProduct {
  return {
    productId: item.productId,
    combinationId: item.combinationId,
    name: item.name,
    reference: item.sku,
    description: item.shortDescription,
    price: null,
    stock: { quantity: item.stockQuantity, status: item.availability, available: item.availability === "in_stock" ? true : item.availability === "out_of_stock" ? false : null },
    availability: item.availability,
    active: null,
    publicLink: null,
    source: "search"
  };
}

function mapProductDetail(product: CatalogProduct): CatalogConsoleProduct {
  return {
    productId: product.productId,
    combinationId: product.selectedVariant?.variantId,
    name: product.name,
    reference: product.selectedVariant?.sku ?? product.sku,
    description: product.longDescription ?? product.shortDescription,
    price: product.price?.amount !== null && product.price?.currency ? { amount: product.price.amount, currency: product.price.currency } : null,
    stock: {
      quantity: product.stockQuantity,
      status: product.availability,
      available: product.availability === "in_stock" ? true : product.availability === "out_of_stock" ? false : null
    },
    availability: product.availability,
    active: product.active,
    publicLink: product.publicLink?.available ? product.publicLink.canonicalUrl : null,
    source: "detail"
  };
}

function mapProductSummary(product: SearchProductsV2ProductSummary, source: "recommendations_v2" = "recommendations_v2"): CatalogConsoleProduct {
  const quantity = product.availability?.stockQuantity ?? product.stock.quantity ?? null;
  return {
    productId: product.productId,
    combinationId: product.combinationId,
    name: product.name,
    reference: product.reference ?? null,
    description: product.description ?? null,
    price: product.price ? { amount: product.price.amount, currency: product.price.currency } : null,
    stock: { quantity, status: product.stock.status, available: product.stock.available },
    availability: product.availability?.status ?? product.stock.status,
    active: product.active,
    publicLink: product.publicLink?.available ? product.publicLink.canonicalUrl : product.productUrl ?? null,
    source
  };
}

export async function searchCatalogConsoleProducts(query: string, limit?: number, deps: Deps = {}): Promise<CatalogSearchProductsResult> {
  const normalizedQuery = normalizeQuery(query);
  if (normalizedQuery === null) {
    return { ok: false, error: { code: "invalid_query", message: `Query must be 1-${MAX_QUERY_LENGTH} characters.`, retryable: false } };
  }

  const catalogPort = deps.catalogPort ?? createCatalogPort();
  if (catalogPort === null) return { ok: false, error: unavailableError() };

  const result = await catalogPort.searchProducts(
    { query: normalizedQuery, limit: normalizeLimit(limit), includeOutOfStock: true },
    { correlationId: deps.correlationId ?? randomUUID() }
  );

  if (!result.ok) return { ok: false, error: mapCatalogPortError(result.error) };
  return { ok: true, query: result.value.query, items: result.value.items.map(mapSearchItem) };
}

export async function getCatalogConsoleProductContext(productId: string, deps: Deps = {}): Promise<CatalogProductContextResult> {
  return getCatalogConsoleProductContextWithLimit(productId, DEFAULT_RECOMMENDATION_LIMIT, deps);
}

export async function getCatalogConsoleProductContextWithLimit(productId: string, recommendationLimit: number | undefined, deps: Deps = {}): Promise<CatalogProductContextResult> {
  const normalizedProductId = productId.trim();
  if (!isValidCatalogConsoleProductId(normalizedProductId)) {
    return { ok: false, error: { code: "invalid_product_id", message: "Product id must be numeric.", retryable: false } };
  }
  const normalizedLimit = normalizeCatalogRecommendationLimit(recommendationLimit);
  if (!normalizedLimit.ok) return { ok: false, error: normalizedLimit.error };

  const correlationId = deps.correlationId ?? randomUUID();
  const catalogPort = deps.catalogPort ?? createCatalogPort();
  const recommendationsClient = deps.recommendationsClient ?? createCatalogSearchProductsV2Client();

  const semanticsPromise: Promise<CatalogPortResult<CatalogProductSemantics | null>> = catalogPort?.getProductSemantics
    ? catalogPort.getProductSemantics({ productId: normalizedProductId }, { correlationId })
    : Promise.resolve({ ok: false as const, error: { code: "not_configured" as const, message: "Catalog Service is not configured.", retryable: false } });

  const [detailResult, recommendationsResult, semanticsResult] = await Promise.all([
    catalogPort
      ? catalogPort.getProductDetails({ productId: normalizedProductId }, { correlationId })
      : Promise.resolve({ ok: false as const, error: { code: "not_configured" as const, message: "Catalog Service is not configured.", retryable: false } }),
    recommendationsClient.searchProducts({ sourceProduct: { productId: normalizedProductId }, limit: normalizedLimit.value }, { correlationId }),
    semanticsPromise
  ]);

  const semantics: CatalogSemanticsBlock = semanticsResult.ok
    ? semanticsResult.value === null
      ? { status: "not_available" }
      : { status: "available", semantics: semanticsResult.value }
    : { status: "error", error: mapCatalogPortError(semanticsResult.error) };

  const warnings: string[] = [];
  let product: CatalogConsoleProduct | null = null;

  if (detailResult.ok && detailResult.value !== null) {
    product = mapProductDetail(detailResult.value);
  } else if (detailResult.ok && detailResult.value === null) {
    warnings.push("product_detail_not_found");
  } else if (!detailResult.ok) {
    warnings.push(`product_detail_${detailResult.error.code}`);
  }

  let recommendations: CatalogRecommendationsBlock;
  if (recommendationsResult.ok) {
    if (product === null) product = mapProductSummary(recommendationsResult.value.sourceProduct);
    const mappedRecommendations = recommendationsResult.value.recommendations.slice(0, normalizedLimit.value).map((recommendation) => {
      const mappedProduct = mapProductSummary(recommendation.product);
      return {
        ...mappedProduct,
        rank: recommendation.rank,
        score: recommendation.score,
        commercialScore: recommendation.commercialScore,
        affinityScore: recommendation.affinityScore,
        affinityConfidence: recommendation.affinityConfidence,
        commercialReason: recommendation.commercialReason.label,
        warnings: recommendation.warnings.map((warning) => warning.code),
        relationship: {
          type: recommendation.relationship.type,
          reliability: recommendation.relationship.reliability,
          evidence: {
            jointCount: recommendation.relationship.evidence.jointCount,
            support: recommendation.relationship.evidence.support,
            confidence: recommendation.relationship.evidence.confidence,
            lift: recommendation.relationship.evidence.lift,
            reliability: recommendation.relationship.reliability
          }
        }
      };
    });

    const excluded = recommendationsResult.value.excluded.map((excludedItem) => ({
      productId: excludedItem.product.productId,
      combinationId: excludedItem.product.combinationId,
      code: excludedItem.code
    }));
    const base = {
      requestedLimit: normalizedLimit.value,
      shownCount: mappedRecommendations.length,
      truncatedByLimitCount: recommendationsResult.value.excluded.filter((excludedItem) => excludedItem.code === "RESULT_LIMIT_TRUNCATION").length,
      excluded,
      statistics: {
        recommendationsReturned: recommendationsResult.value.recommendations.length,
        commercialCandidates: recommendationsResult.value.statistics.commercialCandidates,
        affinityCandidates: recommendationsResult.value.statistics.affinityCandidates,
        personalizedRecommendations: recommendationsResult.value.statistics.personalizedRecommendations,
        excludedRecommendations: recommendationsResult.value.statistics.excludedRecommendations,
        warningsGenerated: recommendationsResult.value.statistics.warningsGenerated
      },
      warnings: recommendationsResult.value.warnings.map((warning) => warning.code),
      execution: { degraded: recommendationsResult.value.execution.degraded, stages: recommendationsResult.value.execution.stages },
      snapshot: recommendationsResult.value.snapshot
    };
    recommendations =
      mappedRecommendations.length > 0
        ? { status: "available", items: mappedRecommendations, ...base }
        : { status: "empty", ...base };
  } else {
    recommendations = { status: "error", error: mapRecommendationsError(recommendationsResult.error) };
  }

  if (product === null) {
    if (!detailResult.ok) return { ok: false, error: mapCatalogPortError(detailResult.error) };
    if (!recommendationsResult.ok) return { ok: false, error: mapRecommendationsError(recommendationsResult.error) };
    return { ok: false, error: { code: "product_not_found", message: "Product was not found.", retryable: false } };
  }

  return { ok: true, product, recommendations, semantics, warnings };
}

export function statusForCatalogConsoleError(error: CatalogConsoleError): number {
  switch (error.code) {
    case "invalid_query":
    case "invalid_product_id":
    case "invalid_limit":
      return 400;
    case "product_not_found":
      return 404;
    case "catalog_not_configured":
    case "catalog_unavailable":
      return 503;
    case "catalog_timeout":
      return 504;
    case "catalog_unauthorized":
    case "invalid_catalog_response":
    case "catalog_request_failed":
      return 502;
  }
}
