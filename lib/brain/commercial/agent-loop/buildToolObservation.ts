import type { CapabilityGatewayResult } from "../capability-gateway/types";
import { SHIPPING_CALCULATION_STALE_ERROR_CODE } from "@/lib/domains/selected-shipping-option";
import type { CatalogExploreResult, CatalogProduct, CatalogSearchResult } from "@/lib/catalog";
import type { CompanyKnowledgeSearchResult } from "../capability-gateway/companyKnowledgeCapability";
import type { SearchProductsV2Personalization, SearchProductsV2Recommendation, SearchProductsV2Warning } from "@/lib/catalog/search-products-v2/types";
import type { BuildSearchProductsV2RequestSkipReason } from "../recommendation-context/searchProductsV2RequestTypes";
import type { ToolObservation } from "./agentStepTypes";

const MAX_SEARCH_ITEMS = 5;
const MAX_EXPLORE_ITEMS = 10;
/** CP-R1-T10B8D: exported so recentCatalogContext.ts can slice recommend_catalog_products history at the exact same count the model observed live - "observed by the model" must equal "eligible for continuity" (see spec section 11). */
export const MAX_RECOMMENDATIONS = 5;
const MAX_REASONS_PER_RECOMMENDATION = 5;
const MAX_RECOMMENDATION_WARNINGS = 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectSearchProducts(data: unknown) {
  if (!isRecord(data)) return { items: [] };
  const result = data as CatalogSearchResult;
  return {
    query: result.query,
    items: (result.items ?? []).slice(0, MAX_SEARCH_ITEMS).map((item) => ({
      productId: item.productId,
      name: item.name,
      availability: item.availability,
      stockQuantity: item.stockQuantity
    }))
  };
}

function projectProductDetails(data: unknown) {
  if (!isRecord(data)) return null;
  const product = data as CatalogProduct;
  return {
    productId: product.productId,
    name: product.name,
    shortDescription: product.shortDescription,
    price: product.price ? { amount: product.price.amount, currency: product.price.currency } : null,
    availability: product.availability,
    stockQuantity: product.stockQuantity,
    ...(product.publicLink
      ? {
          publicLink: {
            canonicalUrl: product.publicLink.canonicalUrl,
            scope: product.publicLink.scope,
            available: product.publicLink.available,
            ...(product.publicLink.unavailableReason ? { unavailableReason: product.publicLink.unavailableReason } : {}),
            requiresVariantSelection: product.publicLink.requiresVariantSelection,
            variantAttributeLabels: [...product.publicLink.variantAttributeLabels]
          }
        }
      : {})
  };
}

/**
 * ACS-R1-05.1-T02.6. Keeps scope/sort/totalMatched/exhaustiveForScope/
 * classificationSource - the model needs exhaustiveForScope to know whether
 * it may use absolute ranking language, and stockScope to distinguish direct
 * product stock from a variant-aggregated figure. Never the raw gateway
 * payload - still capped and re-listed field by field like every other
 * projection here.
 */
function projectExploreCatalog(data: unknown) {
  if (!isRecord(data)) return null;
  const result = data as CatalogExploreResult;
  return {
    scope: result.scope,
    sort: result.sort,
    totalMatched: result.totalMatched,
    exhaustiveForScope: result.exhaustiveForScope,
    ...(result.classificationSource ? { classificationSource: result.classificationSource } : {}),
    products: (result.items ?? []).slice(0, MAX_EXPLORE_ITEMS).map((item) => ({
      productId: item.productId,
      name: item.name,
      price: item.price,
      currency: item.currency,
      stockQuantity: item.stockQuantity,
      stockScope: item.stockScope,
      availability: item.availability
    }))
  };
}

/**
 * CRM-R1-T13D. The capability's own `data` is already the small, bounded
 * shape agreed for this tool (status/destination/input/reason) - passed
 * through as-is, never re-derived here, so this projection can never drift
 * from lib/brain/commercial/capability-gateway/shippingDestinationCapability.ts.
 */
function projectSetShippingDestination(data: unknown) {
  return isRecord(data) ? data : null;
}

/**
 * CRM-R1-T13E.2. select_products' own `data` (status/items/changed) is
 * already the small, bounded shape agreed at the capability layer - passed
 * through as-is, same pattern as projectSetShippingDestination.
 */
function projectSelectProducts(data: unknown) {
  return isRecord(data) ? data : null;
}

/**
 * SALES-AGENT-R1-T2.1. select_shipping_option's own `data`
 * (status/carrierName/serviceType/totalCost/estimatedDelivery/changed) is
 * already the small, bounded, real-Carrier-MS-sourced shape agreed at the
 * capability layer - passed through as-is, same pattern as
 * projectSelectProducts. Never includes shippingQuoteExecutionId/
 * selectionFactId/destinationFactId - those never leave
 * selectShippingOptionCapability.ts/the durable fact.
 */
function projectSelectShippingOption(data: unknown) {
  return isRecord(data) ? data : null;
}

/**
 * SALES-AGENT-R1-T2.1.1. select_shipping_option's staleness rejection - the
 * one blocked reason for this tool that carries an extra safe field (WHICH
 * fact moved since the source calculate_shipping ran: selection_changed vs.
 * destination_changed), never the fact IDs themselves - those never leave
 * lib/domains/selected-shipping-option/service.ts#checkShippingEvidenceFreshness.
 */
function projectSelectShippingOptionStale(result: CapabilityGatewayResult, warnings: { warnings?: string[] }): ToolObservation {
  const data = isRecord(result.data) ? result.data : null;
  const reason = typeof data?.reason === "string" ? data.reason : undefined;
  return { tool: "select_shipping_option", status: "blocked", errorCode: SHIPPING_CALCULATION_STALE_ERROR_CODE, ...(reason ? { reason } : {}), ...warnings };
}

/**
 * CRM-R1-T13E.2 / SALES-AGENT-R1-T2.1. calculate_shipping's own `data` is
 * allowlisted, not passed through raw as before - `selectionFactId`/
 * `destinationFactId` (added in T2.1 so select_shipping_option's evidence
 * gate can detect staleness later) are internal correlation data the model
 * has no use for and must never see, same discipline as every other
 * evidence field in this file. `options[].index` IS shown - it is exactly
 * the stable, deterministic identity the model must cite (never a label)
 * when later calling select_shipping_option.
 */
function projectCalculateShipping(data: unknown) {
  if (!isRecord(data)) return null;
  const options = Array.isArray(data.options)
    ? data.options.slice(0, MAX_EXPLORE_ITEMS).map((option) => {
        if (!isRecord(option)) return null;
        return {
          index: option.index,
          carrierName: option.carrierName,
          serviceType: option.serviceType,
          totalCost: option.totalCost,
          estimatedDelivery: option.estimatedDelivery
        };
      }).filter((option): option is NonNullable<typeof option> => option !== null)
    : undefined;

  return {
    status: data.status,
    ...(data.destination !== undefined ? { destination: data.destination } : {}),
    ...(data.totalWeightKg !== undefined ? { totalWeightKg: data.totalWeightKg } : {}),
    ...(data.totalBoleta !== undefined ? { totalBoleta: data.totalBoleta } : {}),
    ...(options !== undefined ? { options } : {})
  };
}

function projectCompanyKnowledge(data: unknown) {
  if (!isRecord(data)) return { entries: [] };
  const result = data as CompanyKnowledgeSearchResult;
  return {
    query: result.query,
    entries: (result.entries ?? []).map((entry) => ({
      topic: entry.topic,
      answer: entry.answer,
      source: entry.source
    }))
  };
}

/**
 * CP-R1-T10B8B's mapCatalogRecommendationResultToOutcome shapes: "completed"
 * -> data.status "completed", "skipped" -> Gateway status "completed" with
 * data.status "skipped", "failed" -> Gateway status "failed" with this data
 * shape too (code/retryable/message/httpStatus?/providerErrorCode?). Ported
 * here (never imported from the T10B8B adapter file - buildToolObservation
 * only depends on the Gateway's own generic contract) because
 * CapabilityGatewayResult.data is untyped (Record<string, unknown> | null).
 */
type RecommendCatalogProductsCompletedData = {
  status: "completed";
  customerMode: "identified" | "generic";
  recommendations: readonly SearchProductsV2Recommendation[];
  warnings: readonly SearchProductsV2Warning[];
  personalization: SearchProductsV2Personalization;
  metadata: { recommendationCount: number; degraded: boolean };
};

/**
 * `reason` is imported from T10B6 (BuildSearchProductsV2RequestSkipReason) -
 * never a manually re-listed union - so an invented/misspelled reason string
 * fails at compile time instead of silently type-checking as a plain string.
 */
type RecommendCatalogProductsSkippedData = { status: "skipped"; reason: BuildSearchProductsV2RequestSkipReason };

type RecommendCatalogProductsFailedData = { status: "failed"; providerErrorCode?: string };

function projectRecommendation(recommendation: SearchProductsV2Recommendation) {
  const ownership = recommendation.ownership;
  return {
    productId: recommendation.product.productId,
    ...(recommendation.product.combinationId !== undefined ? { combinationId: recommendation.product.combinationId } : {}),
    name: recommendation.product.name,
    rank: recommendation.rank,
    score: recommendation.score,
    reasons: recommendation.reasons.slice(0, MAX_REASONS_PER_RECOMMENDATION).map((reason) => reason.code),
    ...(ownership
      ? {
          ownership: {
            previouslyPurchased: ownership.previouslyPurchased,
            exactVariantPreviouslyPurchased: ownership.exactVariantPreviouslyPurchased,
            ...(ownership.totalOrderCount !== undefined ? { totalOrderCount: ownership.totalOrderCount } : {}),
            ...(ownership.lastPurchasedAt !== undefined ? { lastPurchasedAt: ownership.lastPurchasedAt } : {})
          }
        }
      : {})
  };
}

function projectRecommendationWarning(warning: SearchProductsV2Warning) {
  return {
    code: warning.code,
    ...(warning.product?.productId !== undefined ? { productId: warning.product.productId } : {}),
    ...(warning.product?.combinationId !== undefined ? { combinationId: warning.product.combinationId } : {})
  };
}

/**
 * CP-R1-T10B8C. recommend_catalog_products is the only tool whose Gateway
 * "completed" status covers two distinct outcomes (real completed vs.
 * skipped, see the type comment above) - handled here, before the shared
 * per-tool `data` switch below, so skipped never collapses into a
 * `{status:"completed", recommendations:[]}` observation (spec section 14:
 * that would erase the difference between a valid empty result and a request
 * never sent).
 */
function projectRecommendCatalogProductsCompleted(data: unknown, warnings: { warnings?: string[] }): ToolObservation {
  const tool = "recommend_catalog_products";
  if (!isRecord(data)) return { tool, status: "completed", data: null, ...warnings };

  if (data.status === "skipped") {
    const skipped = data as unknown as RecommendCatalogProductsSkippedData;
    return { tool, status: "skipped", reason: skipped.reason, ...warnings };
  }

  const completed = data as unknown as RecommendCatalogProductsCompletedData;
  return {
    tool,
    status: "completed",
    data: {
      customerMode: completed.customerMode,
      degraded: completed.metadata.degraded,
      recommendationCount: completed.metadata.recommendationCount,
      recommendations: completed.recommendations.slice(0, MAX_RECOMMENDATIONS).map(projectRecommendation),
      warnings: completed.warnings.slice(0, MAX_RECOMMENDATION_WARNINGS).map(projectRecommendationWarning),
      personalization: {
        applied: completed.personalization.applied,
        ...(completed.personalization.reason !== undefined ? { reason: completed.personalization.reason } : {})
      }
    },
    ...warnings
  };
}

/** CP-R1-T10B8C. Never message/sourceProduct/query/exclusions/headers/API key/stack - only a closed error code, retryable and (when present) the remote provider's own code. */
function projectRecommendCatalogProductsFailed(result: CapabilityGatewayResult, warnings: { warnings?: string[] }): ToolObservation {
  const data = isRecord(result.data) ? (result.data as unknown as RecommendCatalogProductsFailedData) : null;
  return {
    tool: "recommend_catalog_products",
    status: "failed",
    errorCode: result.errorCode ?? "capability_execution_failed",
    retryable: result.retryable,
    ...(data?.providerErrorCode !== undefined ? { providerErrorCode: data.providerErrorCode } : {}),
    ...warnings
  };
}

/**
 * Projects a real CapabilityGatewayResult into the bounded, structured
 * ToolObservation the loop feeds back to the model. Never the raw gateway
 * result: no credentials, no full internal payload, no raw error message, no
 * SQL, no data the observation schema does not name explicitly.
 */
export function buildToolObservation(tool: string, result: CapabilityGatewayResult): ToolObservation {
  // ACS-R1-05.1-T02.6.1. Fixed, sanitized warning codes only (e.g.
  // explore_catalog_legacy_sort_alias_used) - result.warnings is always an
  // array (never undefined, see executeCapability.ts), so this is safe
  // regardless of outcome status.
  const warnings = result.warnings.length > 0 ? { warnings: result.warnings } : {};

  if (tool === "recommend_catalog_products" && result.status === "completed") {
    return projectRecommendCatalogProductsCompleted(result.data, warnings);
  }

  if (tool === "recommend_catalog_products" && result.status === "failed") {
    return projectRecommendCatalogProductsFailed(result, warnings);
  }

  if (tool === "select_shipping_option" && result.status === "invalid_arguments" && result.errorCode === SHIPPING_CALCULATION_STALE_ERROR_CODE) {
    return projectSelectShippingOptionStale(result, warnings);
  }

  if (result.status === "completed") {
    const data =
      tool === "search_products"
        ? projectSearchProducts(result.data)
        : tool === "get_product_details"
          ? projectProductDetails(result.data)
          : tool === "search_company_knowledge"
            ? projectCompanyKnowledge(result.data)
            : tool === "explore_catalog"
              ? projectExploreCatalog(result.data)
              : tool === "set_shipping_destination"
                ? projectSetShippingDestination(result.data)
                : tool === "select_products"
                  ? projectSelectProducts(result.data)
                  : tool === "calculate_shipping"
                    ? projectCalculateShipping(result.data)
                    : tool === "select_shipping_option"
                      ? projectSelectShippingOption(result.data)
                      : null;
    return { tool, status: "completed", data, ...warnings };
  }

  if (result.status === "denied" || result.status === "requires_approval" || result.status === "invalid_arguments") {
    return { tool, status: "blocked", errorCode: result.errorCode ?? result.status, ...warnings };
  }

  return { tool, status: "failed", errorCode: result.errorCode ?? "capability_execution_failed", ...warnings };
}
