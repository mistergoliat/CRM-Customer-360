/**
 * CP-R1-T10B6: local contracts for wiring CustomerRecommendationContext
 * (CP-R1-T10B2) into a SearchProductsV2ClientRequest (CP-R1-T10B5). Kept as
 * its own file, separate from ./types.ts (CustomerRecommendationContext's
 * own contract, untouched by this task) - this is a one-way transformation
 * downstream of that context, not a redefinition of it.
 */
import type { SearchProductsV2ClientRequest } from "../../../catalog/search-products-v2/types";
import type { CustomerRecommendationContext, ProductReference } from "./types";

/**
 * `masterCustomerId`/`sourceProduct` are accepted both here and inside
 * `recommendationContext` deliberately: `recommendationContext` may be
 * entirely absent (Customer Profile fully unavailable, no context could be
 * built) while identity/source product are still known from elsewhere in
 * the same turn - see "Generic mode" in
 * docs/releases/CP-R1-T10B6-identity-recommendation-context-wiring.md.
 * These two duplicated sources are compatible only when they represent the
 * same identity after contractual normalization: when only one is present,
 * it is used as-is; when both are present, each is normalized independently
 * and then compared - an agreement uses the normalized value, a
 * disagreement produces `status: "skipped"`
 * (`customer_identity_mismatch`/`source_product_mismatch`) rather than
 * silently picking one - see "Architecture" in that document for the exact
 * resolution rule.
 *
 * There is deliberately no top-level `explicitRepurchaseRequested` flag:
 * that signal only exists inside a built `recommendationContext`.
 */
export type BuildSearchProductsV2RequestInput = {
  masterCustomerId?: string | null;
  sourceProduct?: ProductReference | null;
  recommendationContext?: CustomerRecommendationContext | null;
  query?: string | null;
  explicitExcludedProducts?: readonly ProductReference[];
  correlationId?: string | null;
  limit?: number;
  inStockOnly?: boolean;
};

export const BUILD_SEARCH_PRODUCTS_V2_REQUEST_SKIP_REASONS = [
  "source_product_missing",
  "source_product_invalid",
  "source_product_mismatch",
  "invalid_customer_identity",
  "customer_identity_mismatch",
  "contradictory_product_context",
  "invalid_excluded_product",
  "invalid_query",
  "invalid_correlation_id",
  "invalid_limit"
] as const;
export type BuildSearchProductsV2RequestSkipReason = (typeof BUILD_SEARCH_PRODUCTS_V2_REQUEST_SKIP_REASONS)[number];

export type BuildSearchProductsV2RequestMetadata = {
  customerMode: "identified" | "generic";
  explicitRepurchaseApplied: boolean;
  excludedProductCount: number;
};

export type BuildSearchProductsV2RequestCallContext = {
  correlationId?: string;
};

export type BuildSearchProductsV2RequestResult =
  | {
      status: "ready";
      request: SearchProductsV2ClientRequest;
      callContext: BuildSearchProductsV2RequestCallContext;
      metadata: BuildSearchProductsV2RequestMetadata;
    }
  | {
      status: "skipped";
      reason: BuildSearchProductsV2RequestSkipReason;
    };
