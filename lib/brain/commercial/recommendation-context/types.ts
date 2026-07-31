/**
 * CustomerRecommendationContext (CP-R1-T10B2): the first internal input for
 * Customer Recommendation. Combines Customer Profile T08/T09 evidence
 * (lib/customer-profile) with a source product and explicit conversation
 * signals (exclusions, repurchase intent) into one deterministic snapshot.
 *
 * This is NOT a recommendation engine and does not call SearchProducts V2 -
 * see docs/releases/CP-R1-T10B2-customer-recommendation-context.md. Purchase
 * history here is evidence a later task may weigh, never an automatic
 * exclude/prefer/boost rule.
 */
import type { CustomerProfileLookupResult, GetPurchaseBehaviorData, GetPurchasedProductsData } from "../../../customer-profile/types";

/**
 * Shared product identifier across the CRM/Catalog Service boundary.
 * `combinationId` belongs to the CRM/Catalog Service contract; Customer
 * Profile's `productAttributeId` is the same concept under its own contract.
 * The two are equated only inside this mapper - never renamed upstream.
 */
export type ProductReference = {
  productId: number;
  combinationId?: number;
};

export type CustomerRecommendationProfileStatus = "available" | "partial" | "customer_not_found" | "customer_not_linked" | "degraded" | "failed";

/** Historical fact from Customer Profile T08 - never productName/productReference; Catalog Service owns current identity. */
export type CustomerPurchasedProductEvidence = {
  productId: number;
  productAttributeId: number;
  totalQuantityPurchased: number;
  orderCount: number;
  firstPurchasedAt: string;
  lastPurchasedAt: string;
  totalSpentTaxIncl: string;
  catalogStatus: "linked" | "deleted_or_unavailable";
};

/** Derived exclusively from purchaseBehaviorResult.data.topProducts where isRepeated === true - never topVariants. */
export type CustomerRepeatedProductEvidence = {
  productId: number;
  orderCount: number;
  totalQuantityPurchased: number;
  daysSinceLastPurchase: number;
  spendShare: string;
  isRepeated: true;
};

export type CustomerRecommendationContextWarning =
  | "customer_profile_not_found"
  | "customer_profile_not_linked"
  | "purchased_products_degraded"
  | "purchase_behavior_degraded"
  | "purchased_products_failed"
  | "purchase_behavior_failed"
  | "partial_customer_profile"
  | "inconsistent_customer_profile_status"
  | "inconsistent_purchase_history"
  | "source_product_previously_purchased"
  | "source_variant_previously_purchased"
  | "purchased_product_deleted_or_unavailable"
  | "no_purchase_history";

export type BuildCustomerRecommendationContextInput = {
  masterCustomerId: string;
  purchasedProductsResult: CustomerProfileLookupResult<GetPurchasedProductsData>;
  purchaseBehaviorResult: CustomerProfileLookupResult<GetPurchaseBehaviorData>;
  recommendationIntent: {
    sourceProduct: ProductReference | null;
    explicitExcludedProducts: readonly ProductReference[];
    explicitRepurchaseRequested: boolean;
  };
};

export type CustomerRecommendationContext = {
  contextVersion: "customer-recommendation-context-v1";
  masterCustomerId: string;
  profileStatus: CustomerRecommendationProfileStatus;
  availability: {
    purchasedProductsAvailable: boolean;
    purchaseBehaviorAvailable: boolean;
  };
  recommendationIntent: {
    sourceProduct: ProductReference | null;
    explicitExcludedProducts: readonly ProductReference[];
    explicitRepurchaseRequested: boolean;
  };
  purchaseHistory: {
    products: readonly CustomerPurchasedProductEvidence[];
    repeatedProducts: readonly CustomerRepeatedProductEvidence[];
  };
  sourceProductHistory: {
    productPreviouslyPurchased: boolean;
    exactVariantPreviouslyPurchased: boolean;
    matchingPurchases: readonly ProductReference[];
  };
  explicitExclusionHistory: {
    matches: readonly ProductReference[];
  };
  capabilities: {
    canAssessProductHistory: boolean;
    canAssessRepeatBehavior: boolean;
    canGenerateGenericRecommendationLater: true;
  };
  warnings: readonly CustomerRecommendationContextWarning[];
};

export type CustomerRecommendationContextInputErrorCode =
  | "invalid_master_customer_id"
  | "invalid_product_reference"
  | "invalid_purchase_evidence"
  | "conflicting_purchase_evidence"
  | "invalid_repeated_product_evidence";

/** Thrown only for malformed input shapes - never for a legitimate upstream Customer Profile state (not_found/degraded/failed all resolve to a valid context instead). Message is the code itself; never the offending payload. */
export class CustomerRecommendationContextInputError extends Error {
  readonly code: CustomerRecommendationContextInputErrorCode;

  constructor(code: CustomerRecommendationContextInputErrorCode) {
    super(code);
    this.name = "CustomerRecommendationContextInputError";
    this.code = code;
  }
}

export const CUSTOMER_RECOMMENDATION_CONTEXT_VERSION = "customer-recommendation-context-v1" as const;
