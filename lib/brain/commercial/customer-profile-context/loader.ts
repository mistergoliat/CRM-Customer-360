import type {
  CustomerCommercialHistoryContext,
  CustomerProfileContextCapability,
  CustomerProfileContextConfig,
  CustomerProfileContextObservation,
  CustomerProfilePurchasedProductContext,
  CustomerProfileRecommendationComparisonInput,
  LoadCustomerCommercialHistoryContextInput
} from "./types";
import { readCustomerProfileContextConfig } from "./config";
import { compareRecommendationsWithPurchaseHistory } from "./compareRecommendationsWithPurchaseHistory";

const PRODUCT_HISTORY_NEEDS = new Set([
  "PRODUCT_RECOMMENDATION",
  "PRODUCT_SEARCH",
  "PRODUCT_COMPARISON",
  "CROSS_SELL",
  "UPSELL",
  "REPLACEMENT",
  "REORDER",
  "CUSTOMER_ALREADY_HAS_PRODUCT",
  "CATALOG_RESULT_REQUIRES_HISTORY_CHECK"
] as const);

function createBaseContext(input: {
  status: CustomerCommercialHistoryContext["status"];
  customerId: number | null;
  observations: readonly CustomerProfileContextObservation[];
}): CustomerCommercialHistoryContext {
  return {
    status: input.status,
    customerId: input.customerId,
    summary: null,
    recentOrders: [],
    purchasedProducts: [],
    purchaseBehavior: null,
    provenance: null,
    recommendationHistoryMatches: [],
    constraints: {
      rfmAvailable: false,
      monetarySegmentAvailable: false,
      mayAlterCatalogRanking: false,
      mayAutoExcludePurchasedProducts: false
    },
    observations: input.observations
  };
}

function contextObservation(
  capability: CustomerProfileContextCapability | "context",
  status: CustomerCommercialHistoryContext["status"],
  reasonCode: CustomerProfileContextObservation["reasonCode"]
): CustomerProfileContextObservation {
  return { capability, status, reasonCode };
}

function isValidCustomerId(value: number | null): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function resolveConfig(config?: CustomerProfileContextConfig): CustomerProfileContextConfig {
  return config ?? readCustomerProfileContextConfig();
}

function shouldLoadProductHistory(historyNeeds: readonly LoadCustomerCommercialHistoryContextInput["historyNeeds"][number][]) {
  return historyNeeds.some((need) => PRODUCT_HISTORY_NEEDS.has(need as (typeof PRODUCT_HISTORY_NEEDS extends Set<infer T> ? T : never)));
}

function shouldLoadProfile(historyNeeds: readonly LoadCustomerCommercialHistoryContextInput["historyNeeds"][number][]) {
  return historyNeeds.includes("GENERAL_PROFILE") || historyNeeds.includes("RECENT_ORDERS_CONTEXT");
}

function mapUnavailableReason(reason: string): CustomerProfileContextObservation["reasonCode"] {
  return reason === "CUSTOMER_PROFILE_TIMEOUT" ? "CUSTOMER_PROFILE_TIMEOUT" : "CUSTOMER_PROFILE_UNAVAILABLE";
}

function mapContractReason(reason: string): CustomerProfileContextObservation["reasonCode"] {
  return reason === "PROVENANCE_MISMATCH" ? "CUSTOMER_PROFILE_PROVENANCE_MISMATCH" : "CUSTOMER_PROFILE_CONTRACT_ERROR";
}

function buildPurchasedProductsContext(products: ReadonlyArray<{
  productId: number;
  productAttributeId: number;
  productName: string;
  totalQuantityPurchased: number;
  orderCount: number;
  firstPurchasedAt: string;
  lastPurchasedAt: string;
  totalSpentTaxIncl: string;
  catalogStatus: "linked" | "deleted_or_unavailable";
}>): CustomerProfilePurchasedProductContext[] {
  return products.map((product) => ({
    productId: product.productId,
    productAttributeId: product.productAttributeId,
    name: product.productName,
    totalQuantity: product.totalQuantityPurchased,
    orderCount: product.orderCount,
    firstPurchasedAt: product.firstPurchasedAt,
    lastPurchasedAt: product.lastPurchasedAt,
    historicalSpentTaxIncl: product.totalSpentTaxIncl,
    catalogStatus: product.catalogStatus
  }));
}

export function buildCatalogHistoryComparisons(input: {
  purchasedProducts: readonly CustomerProfilePurchasedProductContext[] | null;
  candidates: readonly CustomerProfileRecommendationComparisonInput[];
}) {
  return compareRecommendationsWithPurchaseHistory(input.candidates, input.purchasedProducts);
}

export async function loadCustomerCommercialHistoryContext(input: LoadCustomerCommercialHistoryContextInput): Promise<CustomerCommercialHistoryContext> {
  const config = resolveConfig(input.config);

  if (!config.contextEnabled) {
    return createBaseContext({
      status: "DISABLED",
      customerId: input.customerId,
      observations: [contextObservation("context", "DISABLED", "CUSTOMER_PROFILE_DISABLED")]
    });
  }

  if (!input.commercialIntent || !isValidCustomerId(input.customerId)) {
    return createBaseContext({
      status: "IDENTITY_UNAVAILABLE",
      customerId: null,
      observations: [contextObservation("context", "IDENTITY_UNAVAILABLE", "CUSTOMER_PROFILE_IDENTITY_UNAVAILABLE")]
    });
  }

  const observations: CustomerProfileContextObservation[] = [
    contextObservation("context", "AVAILABLE", "RFM_NOT_AVAILABLE"),
    contextObservation("context", "AVAILABLE", "MONETARY_INFORMATIONAL_ONLY"),
    contextObservation("context", "AVAILABLE", "CATALOG_RANKING_NOT_MODIFIED")
  ];

  const summaryResult = await input.customerProfileCapabilities.getCommercialSummary({
    customerId: input.customerId,
    requestId: input.requestId
  });

  if (summaryResult.status === "NOT_FOUND") {
    observations.unshift(contextObservation("context", "NOT_FOUND", "CUSTOMER_PROFILE_CUSTOMER_NOT_FOUND"));
    return createBaseContext({ status: "NOT_FOUND", customerId: input.customerId, observations });
  }

  if (summaryResult.status === "UNAVAILABLE") {
    observations.unshift(contextObservation("context", "UNAVAILABLE", mapUnavailableReason(summaryResult.reason)));
    if (summaryResult.reason === "CUSTOMER_PROFILE_DISABLED") {
      return createBaseContext({ status: "DISABLED", customerId: input.customerId, observations: [contextObservation("context", "DISABLED", "CUSTOMER_PROFILE_DISABLED")] });
    }
    return createBaseContext({ status: "UNAVAILABLE", customerId: input.customerId, observations });
  }

  if (summaryResult.status === "CONTRACT_ERROR" || summaryResult.status === "INVALID_REQUEST") {
    observations.unshift(
      contextObservation(
        "context",
        "CONTRACT_ERROR",
        summaryResult.status === "CONTRACT_ERROR" ? mapContractReason(summaryResult.reason) : "CUSTOMER_PROFILE_CONTRACT_ERROR"
      )
    );
    return createBaseContext({ status: "CONTRACT_ERROR", customerId: input.customerId, observations });
  }

  observations.unshift(contextObservation("commercial-summary", "AVAILABLE", "COMMERCIAL_SUMMARY_AVAILABLE"));

  let purchasedProducts: CustomerCommercialHistoryContext["purchasedProducts"] = [];
  let purchaseBehavior: CustomerCommercialHistoryContext["purchaseBehavior"] = null;
  let recentOrders: CustomerCommercialHistoryContext["recentOrders"] = [];
  let requestedSecondaryCount = 0;
  let failedSecondaryCount = 0;

  const productHistoryRequested = shouldLoadProductHistory(input.historyNeeds);
  if (productHistoryRequested) {
    requestedSecondaryCount += 2;
    const [purchasedProductsResult, purchaseBehaviorResult] = await Promise.allSettled([
      input.customerProfileCapabilities.getPurchasedProducts({
        customerId: input.customerId,
        limit: config.purchasedProductsLimit,
        offset: 0,
        requestId: input.requestId
      }),
      input.customerProfileCapabilities.getPurchaseBehavior({
        customerId: input.customerId,
        topProducts: config.topProductsLimit,
        topVariants: config.topVariantsLimit,
        requestId: input.requestId
      })
    ]);

    const purchasedProductsValue = purchasedProductsResult.status === "fulfilled" ? purchasedProductsResult.value : { status: "UNAVAILABLE" as const, reason: "CUSTOMER_PROFILE_UNAVAILABLE" as const, retryable: true };
    if (purchasedProductsValue.status === "AVAILABLE") {
      purchasedProducts = buildPurchasedProductsContext(purchasedProductsValue.data.products);
      observations.push(contextObservation("purchased-products", "AVAILABLE", "PURCHASED_PRODUCTS_AVAILABLE"));
    } else {
      failedSecondaryCount += 1;
    }

    const purchaseBehaviorValue = purchaseBehaviorResult.status === "fulfilled" ? purchaseBehaviorResult.value : { status: "UNAVAILABLE" as const, reason: "CUSTOMER_PROFILE_UNAVAILABLE" as const, retryable: true };
    if (purchaseBehaviorValue.status === "AVAILABLE") {
      purchaseBehavior = {
        distinctProductCount: purchaseBehaviorValue.data.summary.distinctProductCount,
        distinctVariantCount: purchaseBehaviorValue.data.summary.distinctVariantCount,
        repeatedProductCount: purchaseBehaviorValue.data.summary.repeatedProductCount,
        diversityStatus: null,
        concentrationStatus: null,
        productSpendConcentration: purchaseBehaviorValue.data.summary.productSpendConcentration,
        variantSpendConcentration: purchaseBehaviorValue.data.summary.variantSpendConcentration,
        topProducts: purchaseBehaviorValue.data.topProducts.map((product) => ({
          productId: product.productId,
          name: product.latestObservedProductName,
          orderCount: product.orderCount,
          totalQuantityPurchased: product.totalQuantityPurchased,
          lastPurchasedAt: product.lastPurchasedAt,
          isRepeated: product.isRepeated
        })),
        topVariants: purchaseBehaviorValue.data.topVariants.map((variant) => ({
          productId: variant.productId,
          productAttributeId: variant.productAttributeId,
          name: variant.productName,
          orderCount: variant.orderCount,
          totalQuantityPurchased: variant.totalQuantityPurchased,
          lastPurchasedAt: variant.lastPurchasedAt,
          isRepeated: variant.isRepeated
        }))
      };
      observations.push(contextObservation("purchase-behavior", "AVAILABLE", "PURCHASE_BEHAVIOR_AVAILABLE"));
    } else {
      failedSecondaryCount += 1;
    }
  }

  if (shouldLoadProfile(input.historyNeeds)) {
    requestedSecondaryCount += 1;
    const profileResult = await input.customerProfileCapabilities.getProfile({
      customerId: input.customerId,
      requestId: input.requestId
    });

    if (profileResult.status === "AVAILABLE") {
      recentOrders = profileResult.data.profile.recentOrders.slice(0, config.recentPurchasesLimit).map((order) => ({
        orderId: order.orderId,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        currentStateName: order.currentState.name,
        valid: order.valid,
        totalPaidTaxIncl: order.totalPaidTaxIncl
      }));
      observations.push(contextObservation("profile", "AVAILABLE", "PROFILE_AVAILABLE"));
    } else {
      failedSecondaryCount += 1;
    }
  }

  const status = requestedSecondaryCount > 0 && failedSecondaryCount > 0 ? "PARTIAL" : "AVAILABLE";
  observations.unshift(contextObservation("context", status, status === "PARTIAL" ? "CUSTOMER_PROFILE_PARTIAL" : "CUSTOMER_PROFILE_AVAILABLE"));

  return {
    status,
    customerId: input.customerId,
    summary: {
      validatedOrderCount: summaryResult.data.summary.totalOrders,
      firstPurchaseAt: summaryResult.data.summary.firstOrderAt,
      lastPurchaseAt: summaryResult.data.summary.lastOrderAt,
      historicalPurchaseValueTaxIncl: summaryResult.data.summary.totalSpentTaxIncl,
      currencyIsoCode: summaryResult.data.summary.currencyIsoCode,
      monetaryInterpretation: "INFORMATIONAL_ONLY"
    },
    recentOrders,
    purchasedProducts,
    purchaseBehavior,
    provenance: {
      source: summaryResult.data.provenance.customerIdentity.source,
      identityStatus: summaryResult.data.provenance.customerIdentity.status,
      contractVersion: summaryResult.data.provenance.contractVersion,
      generatedAt: summaryResult.data.provenance.generatedAt
    },
    recommendationHistoryMatches: [],
    constraints: {
      rfmAvailable: false,
      monetarySegmentAvailable: false,
      mayAlterCatalogRanking: false,
      mayAutoExcludePurchasedProducts: false
    },
    observations
  };
}
