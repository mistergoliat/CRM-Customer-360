/**
 * CP-R1-T10B7: contracts for the internal application capability that
 * orchestrates CustomerRecommendationContext (CP-R1-T10B2) ->
 * buildSearchProductsV2Request (CP-R1-T10B6) -> CatalogSearchProductsV2Client
 * (CP-R1-T10B5) -> a structured recommendation result. This is the only CRM
 * orchestration point for product recommendations - it does not select a
 * candidate, does not call get_product_details, does not persist, and is
 * not registered as a model-facing tool (that separation already exists:
 * see lib/brain/commercial/capability-gateway for governed, agent-facing
 * capabilities) - see
 * docs/releases/CP-R1-T10B7-catalog-recommendation-capability.md.
 */
import type { CatalogSearchProductsV2Client, SearchProductsV2ClientError, SearchProductsV2Exclusion, SearchProductsV2Execution, SearchProductsV2Personalization, SearchProductsV2Recommendation, SearchProductsV2Snapshot, SearchProductsV2Statistics, SearchProductsV2Warning } from "../../../../catalog/search-products-v2/types";
import type { BuildSearchProductsV2RequestInput, BuildSearchProductsV2RequestSkipReason } from "../../recommendation-context/searchProductsV2RequestTypes";

/**
 * Identical fields to `BuildSearchProductsV2RequestInput` (CP-R1-T10B6) plus
 * `signal` - business input and mapper input are the same shape here on
 * purpose (never duplicated), `signal` is transport/cancellation-only and is
 * deliberately kept out of the mapper call, forwarded only to the T10B5
 * client.
 */
export type CatalogRecommendationCapabilityInput = BuildSearchProductsV2RequestInput & {
  signal?: AbortSignal;
};

/**
 * Same shape as `SearchProductsV2ClientError` (CP-R1-T10B5) - reused
 * verbatim, never redefined. `SOURCE_PRODUCT_NOT_FOUND`/
 * `SOURCE_PRODUCT_INACTIVE` are not separate `code` values: they surface as
 * `code: "catalog_service_error"` (httpStatus 404/409) with
 * `providerErrorCode` carrying the remote code, exactly as T10B5 classifies
 * them - never reclassified into a new, incompatible taxonomy here.
 */
export type CatalogRecommendationCapabilityError = SearchProductsV2ClientError;

export type CatalogRecommendationCapabilityMetadata = {
  explicitRepurchaseApplied: boolean;
  excludedProductCount: number;
  recommendationCount: number;
  degraded: boolean;
};

export type CatalogRecommendationCapabilityResult =
  | {
      status: "completed";
      customerMode: "identified" | "generic";
      recommendations: readonly SearchProductsV2Recommendation[];
      excluded: readonly SearchProductsV2Exclusion[];
      warnings: readonly SearchProductsV2Warning[];
      personalization: SearchProductsV2Personalization;
      execution: SearchProductsV2Execution;
      statistics: SearchProductsV2Statistics;
      snapshot: SearchProductsV2Snapshot;
      metadata: CatalogRecommendationCapabilityMetadata;
    }
  | {
      status: "skipped";
      reason: BuildSearchProductsV2RequestSkipReason;
    }
  | {
      status: "failed";
      error: CatalogRecommendationCapabilityError;
    };

export type CatalogRecommendationCapability = {
  execute(input: CatalogRecommendationCapabilityInput): Promise<CatalogRecommendationCapabilityResult>;
};

export type CreateCatalogRecommendationCapabilityDeps = {
  catalogSearchProductsV2Client: CatalogSearchProductsV2Client;
};
