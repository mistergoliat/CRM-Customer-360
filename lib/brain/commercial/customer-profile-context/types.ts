import type { CommercialContextSnapshot } from "../context/buildNativeCommercialContext";
import type { PendingCatalogActionStep } from "../agent-loop/agentStepTypes";
import type { RecentCatalogContext } from "../agent-loop/recentCatalogContext";
import type { CustomerProfileCapabilities } from "../capabilities/customer-profile";

export const CUSTOMER_PROFILE_CONTEXT_STATUSES = [
  "AVAILABLE",
  "PARTIAL",
  "NOT_FOUND",
  "UNAVAILABLE",
  "CONTRACT_ERROR",
  "IDENTITY_UNAVAILABLE",
  "DISABLED"
] as const;

export type CustomerProfileContextStatus = (typeof CUSTOMER_PROFILE_CONTEXT_STATUSES)[number];

export const CUSTOMER_HISTORY_NEEDS = [
  "PRODUCT_RECOMMENDATION",
  "PRODUCT_SEARCH",
  "PRODUCT_COMPARISON",
  "CROSS_SELL",
  "UPSELL",
  "REPLACEMENT",
  "REORDER",
  "CUSTOMER_ALREADY_HAS_PRODUCT",
  "CATALOG_RESULT_REQUIRES_HISTORY_CHECK",
  "GENERAL_PROFILE",
  "RECENT_ORDERS_CONTEXT"
] as const;

export type CustomerHistoryNeed = (typeof CUSTOMER_HISTORY_NEEDS)[number];

export const CUSTOMER_PROFILE_CONTEXT_REASON_CODES = [
  "CUSTOMER_PROFILE_AVAILABLE",
  "CUSTOMER_PROFILE_PARTIAL",
  "CUSTOMER_PROFILE_DISABLED",
  "CUSTOMER_PROFILE_IDENTITY_UNAVAILABLE",
  "CUSTOMER_PROFILE_CUSTOMER_NOT_FOUND",
  "CUSTOMER_PROFILE_TIMEOUT",
  "CUSTOMER_PROFILE_UNAVAILABLE",
  "CUSTOMER_PROFILE_CONTRACT_ERROR",
  "CUSTOMER_PROFILE_PROVENANCE_MISMATCH",
  "COMMERCIAL_SUMMARY_AVAILABLE",
  "PURCHASED_PRODUCTS_AVAILABLE",
  "PURCHASE_BEHAVIOR_AVAILABLE",
  "PROFILE_AVAILABLE",
  "ORDER_STATUS_AVAILABLE",
  "RFM_NOT_AVAILABLE",
  "MONETARY_INFORMATIONAL_ONLY",
  "CATALOG_RANKING_NOT_MODIFIED"
] as const;

export type CustomerProfileContextReasonCode = (typeof CUSTOMER_PROFILE_CONTEXT_REASON_CODES)[number];

export type CustomerProfileContextCapability = "commercial-summary" | "purchased-products" | "purchase-behavior" | "profile";

export type CustomerProfileContextObservation = {
  readonly capability: CustomerProfileContextCapability | "context";
  readonly status: CustomerProfileContextStatus;
  readonly reasonCode: CustomerProfileContextReasonCode;
};

export type CustomerProfileRecentOrderContext = {
  readonly orderId: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly currentStateName: string | null;
  readonly valid: boolean;
  readonly totalPaidTaxIncl: string;
};

export type CustomerProfilePurchasedProductContext = {
  readonly productId: number;
  readonly productAttributeId: number | null;
  readonly name: string;
  readonly totalQuantity: number;
  readonly orderCount: number;
  readonly firstPurchasedAt: string | null;
  readonly lastPurchasedAt: string | null;
  readonly historicalSpentTaxIncl: string | null;
  readonly catalogStatus: "linked" | "deleted_or_unavailable";
};

export type CustomerProfilePurchaseBehaviorTopProductContext = {
  readonly productId: number;
  readonly name: string;
  readonly orderCount: number;
  readonly totalQuantityPurchased: number;
  readonly lastPurchasedAt: string | null;
  readonly isRepeated: boolean;
};

export type CustomerProfilePurchaseBehaviorTopVariantContext = {
  readonly productId: number;
  readonly productAttributeId: number | null;
  readonly name: string;
  readonly orderCount: number;
  readonly totalQuantityPurchased: number;
  readonly lastPurchasedAt: string | null;
  readonly isRepeated: boolean;
};

export type CustomerProfilePurchaseBehaviorContext = {
  readonly distinctProductCount: number | null;
  readonly distinctVariantCount: number | null;
  readonly repeatedProductCount: number | null;
  readonly diversityStatus: string | null;
  readonly concentrationStatus: string | null;
  readonly productSpendConcentration: {
    readonly top1Share: string;
    readonly top3Share: string;
    readonly hhi: string;
    readonly effectiveDiversity: string;
  } | null;
  readonly variantSpendConcentration: {
    readonly top1Share: string;
    readonly top3Share: string;
    readonly hhi: string;
    readonly effectiveDiversity: string;
  } | null;
  readonly topProducts: readonly CustomerProfilePurchaseBehaviorTopProductContext[];
  readonly topVariants: readonly CustomerProfilePurchaseBehaviorTopVariantContext[];
};

export const CUSTOMER_PROFILE_HISTORY_MATCH_STATUSES = [
  "NOT_PREVIOUSLY_PURCHASED",
  "SAME_PRODUCT_PREVIOUSLY_PURCHASED",
  "SAME_VARIANT_PREVIOUSLY_PURCHASED",
  "PRODUCT_MATCH_VARIANT_UNKNOWN",
  "HISTORY_UNAVAILABLE"
] as const;

export type CustomerProfileHistoryMatchStatus = (typeof CUSTOMER_PROFILE_HISTORY_MATCH_STATUSES)[number];

export type CustomerProfileRecommendationComparisonInput = {
  readonly productId: number;
  readonly productAttributeId?: number | null;
  readonly name?: string | null;
};

export type CustomerProfileRecommendationHistoryMatch = {
  readonly productId: number;
  readonly productAttributeId: number | null;
  readonly name: string | null;
  readonly matchStatus: CustomerProfileHistoryMatchStatus;
};

export type CustomerCommercialHistoryContext = {
  readonly status: CustomerProfileContextStatus;
  readonly customerId: number | null;
  readonly summary: {
    readonly validatedOrderCount: number;
    readonly firstPurchaseAt: string | null;
    readonly lastPurchaseAt: string | null;
    readonly historicalPurchaseValueTaxIncl: string | null;
    readonly currencyIsoCode: "CLP" | null;
    readonly monetaryInterpretation: "INFORMATIONAL_ONLY";
  } | null;
  readonly recentOrders: readonly CustomerProfileRecentOrderContext[];
  readonly purchasedProducts: readonly CustomerProfilePurchasedProductContext[];
  readonly purchaseBehavior: CustomerProfilePurchaseBehaviorContext | null;
  readonly provenance: {
    readonly source: string;
    readonly identityStatus: string;
    readonly contractVersion: string;
    readonly generatedAt: string;
  } | null;
  readonly recommendationHistoryMatches: readonly CustomerProfileRecommendationHistoryMatch[];
  readonly constraints: {
    readonly rfmAvailable: false;
    readonly monetarySegmentAvailable: false;
    readonly mayAlterCatalogRanking: false;
    readonly mayAutoExcludePurchasedProducts: false;
  };
  readonly observations: readonly CustomerProfileContextObservation[];
};

export type CustomerProfileContextConfig = {
  readonly contextEnabled: boolean;
  readonly purchasedProductsLimit: number;
  readonly topProductsLimit: number;
  readonly topVariantsLimit: number;
  readonly recentPurchasesLimit: number;
};

export type LoadCustomerCommercialHistoryContextInput = {
  readonly customerId: number | null;
  readonly commercialIntent: boolean;
  readonly historyNeeds: readonly CustomerHistoryNeed[];
  readonly requestId?: string;
  readonly customerProfileCapabilities: CustomerProfileCapabilities;
  readonly config?: CustomerProfileContextConfig;
};

export type DeriveCustomerHistoryNeedsInput = {
  readonly snapshot: CommercialContextSnapshot;
  readonly customerMessage: string;
  readonly recentCatalogContext?: RecentCatalogContext | null;
  readonly pendingCatalogAction?: PendingCatalogActionStep | null;
};

/** CP-R1-T12D. Independent of `CustomerProfileContextConfig` - see config.ts#readCustomerHistoryCommercialPolicyConfig. */
export type CustomerHistoryCommercialPolicyConfig = {
  readonly enabled: boolean;
  readonly recentPurchaseWindowDays: number;
  readonly maxSignals: number;
};
