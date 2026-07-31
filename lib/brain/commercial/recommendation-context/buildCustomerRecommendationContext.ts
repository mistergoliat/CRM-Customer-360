/**
 * Pure mapper: T08 purchased-products + T09 purchase-behavior + a source
 * product + explicit exclusions + a repurchase signal -> one deterministic
 * CustomerRecommendationContext. No IO, no fetch, no SQL, no Date.now, no
 * random, no env, no logs, no input mutation - see
 * docs/releases/CP-R1-T10B2-customer-recommendation-context.md.
 */
import type { PurchaseBehaviorProduct, PurchasedProductItem } from "../../../customer-profile/types";
import {
  CustomerRecommendationContextInputError,
  CUSTOMER_RECOMMENDATION_CONTEXT_VERSION,
  type BuildCustomerRecommendationContextInput,
  type CustomerPurchasedProductEvidence,
  type CustomerRecommendationContext,
  type CustomerRecommendationContextInputErrorCode,
  type CustomerRecommendationContextWarning,
  type CustomerRecommendationProfileStatus,
  type CustomerRepeatedProductEvidence,
  type ProductReference
} from "./types";

// Fixed priority order - the output warning list never depends on input/object key order.
const WARNING_PRIORITY: readonly CustomerRecommendationContextWarning[] = [
  "customer_profile_not_found",
  "customer_profile_not_linked",
  "purchased_products_degraded",
  "purchase_behavior_degraded",
  "purchased_products_failed",
  "purchase_behavior_failed",
  "partial_customer_profile",
  "inconsistent_customer_profile_status",
  "inconsistent_purchase_history",
  "source_product_previously_purchased",
  "source_variant_previously_purchased",
  "purchased_product_deleted_or_unavailable",
  "no_purchase_history"
];

const MASTER_CUSTOMER_ID_PATTERN = /^[0-9]{1,20}$/;
const DECIMAL_STRING_PATTERN = /^\d+(\.\d+)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isDecimalString(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_STRING_PATTERN.test(value);
}

function fail(code: CustomerRecommendationContextInputErrorCode): never {
  throw new CustomerRecommendationContextInputError(code);
}

function dedupeByKey<T>(items: readonly T[], keyOf: (item: T) => string, conflictCode: CustomerRecommendationContextInputErrorCode): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const key = keyOf(item);
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, item);
    } else if (JSON.stringify(existing) !== JSON.stringify(item)) {
      fail(conflictCode);
    }
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------------------
// ProductReference
// ---------------------------------------------------------------------------

function validateProductReference(value: unknown): ProductReference {
  if (!isRecord(value)) fail("invalid_product_reference");
  if (!isPositiveInteger(value.productId)) fail("invalid_product_reference");
  if (value.combinationId !== undefined && !isNonNegativeInteger(value.combinationId)) fail("invalid_product_reference");
  return value.combinationId === undefined ? { productId: value.productId } : { productId: value.productId, combinationId: value.combinationId };
}

function sortProductReferences(refs: readonly ProductReference[]): ProductReference[] {
  return [...refs].sort((a, b) => {
    if (a.productId !== b.productId) return a.productId - b.productId;
    if (a.combinationId === undefined && b.combinationId === undefined) return 0;
    if (a.combinationId === undefined) return -1;
    if (b.combinationId === undefined) return 1;
    return a.combinationId - b.combinationId;
  });
}

function normalizeExplicitExcludedProducts(refs: unknown): ProductReference[] {
  if (!Array.isArray(refs)) fail("invalid_product_reference");
  const validated = refs.map(validateProductReference);
  const deduped = dedupeByKey(validated, (r) => `${r.productId}:${r.combinationId ?? "none"}`, "invalid_product_reference");
  return sortProductReferences(deduped);
}

// ---------------------------------------------------------------------------
// Purchase history (T08)
// ---------------------------------------------------------------------------

function validatePurchasedProductItem(value: unknown): CustomerPurchasedProductEvidence {
  if (!isRecord(value)) fail("invalid_purchase_evidence");
  const { productId, productAttributeId, totalQuantityPurchased, orderCount, firstPurchasedAt, lastPurchasedAt, totalSpentTaxIncl, catalogStatus } = value;
  if (
    !isPositiveInteger(productId) ||
    !isNonNegativeInteger(productAttributeId) ||
    !isNonNegativeInteger(totalQuantityPurchased) ||
    !isNonNegativeInteger(orderCount) ||
    !isNonEmptyString(firstPurchasedAt) ||
    !isNonEmptyString(lastPurchasedAt) ||
    !isDecimalString(totalSpentTaxIncl) ||
    (catalogStatus !== "linked" && catalogStatus !== "deleted_or_unavailable")
  ) {
    fail("invalid_purchase_evidence");
  }
  return { productId, productAttributeId, totalQuantityPurchased, orderCount, firstPurchasedAt, lastPurchasedAt, totalSpentTaxIncl, catalogStatus };
}

function sortPurchaseHistoryProducts(items: readonly CustomerPurchasedProductEvidence[]): CustomerPurchasedProductEvidence[] {
  return [...items].sort((a, b) => {
    const byDate = Date.parse(b.lastPurchasedAt) - Date.parse(a.lastPurchasedAt);
    if (byDate !== 0) return byDate;
    if (a.productId !== b.productId) return a.productId - b.productId;
    return a.productAttributeId - b.productAttributeId;
  });
}

function buildPurchaseHistoryProducts(items: readonly PurchasedProductItem[]): CustomerPurchasedProductEvidence[] {
  if (!Array.isArray(items)) fail("invalid_purchase_evidence");
  const validated = items.map(validatePurchasedProductItem);
  const deduped = dedupeByKey(validated, (item) => `${item.productId}:${item.productAttributeId}`, "conflicting_purchase_evidence");
  return sortPurchaseHistoryProducts(deduped);
}

// ---------------------------------------------------------------------------
// Repeated products (T09 topProducts, isRepeated === true)
// ---------------------------------------------------------------------------

function validateRepeatedProduct(value: unknown): CustomerRepeatedProductEvidence {
  if (!isRecord(value)) fail("invalid_repeated_product_evidence");
  const { productId, orderCount, totalQuantityPurchased, daysSinceLastPurchase, spendShare } = value;
  if (
    !isPositiveInteger(productId) ||
    !isNonNegativeInteger(orderCount) ||
    !isNonNegativeInteger(totalQuantityPurchased) ||
    !isNonNegativeInteger(daysSinceLastPurchase) ||
    !isDecimalString(spendShare)
  ) {
    fail("invalid_repeated_product_evidence");
  }
  return { productId, orderCount, totalQuantityPurchased, daysSinceLastPurchase, spendShare, isRepeated: true };
}

function sortRepeatedProducts(items: readonly CustomerRepeatedProductEvidence[]): CustomerRepeatedProductEvidence[] {
  return [...items].sort((a, b) => {
    if (a.daysSinceLastPurchase !== b.daysSinceLastPurchase) return a.daysSinceLastPurchase - b.daysSinceLastPurchase;
    if (a.orderCount !== b.orderCount) return b.orderCount - a.orderCount;
    return a.productId - b.productId;
  });
}

function buildRepeatedProducts(topProducts: readonly PurchaseBehaviorProduct[]): CustomerRepeatedProductEvidence[] {
  if (!Array.isArray(topProducts)) fail("invalid_repeated_product_evidence");
  const repeated = topProducts.filter((item) => isRecord(item) && item.isRepeated === true);
  const validated = repeated.map(validateRepeatedProduct);
  const deduped = dedupeByKey(validated, (item) => String(item.productId), "invalid_repeated_product_evidence");
  return sortRepeatedProducts(deduped);
}

// ---------------------------------------------------------------------------
// Profile status composition (section 12)
// ---------------------------------------------------------------------------

type RawLookupStatus = "available" | "customer_not_found" | "customer_not_linked" | "degraded" | "failed";

function composeProfileStatus(purchasedStatus: RawLookupStatus, behaviorStatus: RawLookupStatus): { status: CustomerRecommendationProfileStatus; warnings: CustomerRecommendationContextWarning[] } {
  const warnings: CustomerRecommendationContextWarning[] = [];
  if (purchasedStatus === "customer_not_found" || behaviorStatus === "customer_not_found") warnings.push("customer_profile_not_found");
  if (purchasedStatus === "customer_not_linked" || behaviorStatus === "customer_not_linked") warnings.push("customer_profile_not_linked");
  if (purchasedStatus === "degraded") warnings.push("purchased_products_degraded");
  if (behaviorStatus === "degraded") warnings.push("purchase_behavior_degraded");
  if (purchasedStatus === "failed") warnings.push("purchased_products_failed");
  if (behaviorStatus === "failed") warnings.push("purchase_behavior_failed");

  if (purchasedStatus === "available" && behaviorStatus === "available") {
    return { status: "available", warnings };
  }
  if (purchasedStatus === "available" || behaviorStatus === "available") {
    warnings.push("partial_customer_profile");
    return { status: "partial", warnings };
  }
  if (purchasedStatus === behaviorStatus) {
    return { status: purchasedStatus, warnings };
  }

  warnings.push("inconsistent_customer_profile_status");
  const precedence: RawLookupStatus[] = ["customer_not_found", "customer_not_linked", "degraded", "failed"];
  const winner = precedence.find((status) => purchasedStatus === status || behaviorStatus === status) ?? "failed";
  return { status: winner, warnings };
}

// ---------------------------------------------------------------------------
// Source product history (section 14) and explicit exclusion history (15)
// ---------------------------------------------------------------------------

function computeSourceProductHistory(
  sourceProduct: ProductReference | null,
  products: readonly CustomerPurchasedProductEvidence[]
): { result: CustomerRecommendationContext["sourceProductHistory"]; warnings: CustomerRecommendationContextWarning[] } {
  if (sourceProduct === null) {
    return { result: { productPreviouslyPurchased: false, exactVariantPreviouslyPurchased: false, matchingPurchases: [] }, warnings: [] };
  }

  const matchingProducts = products.filter((product) => product.productId === sourceProduct.productId);
  const productPreviouslyPurchased = matchingProducts.length > 0;
  const exactVariantPreviouslyPurchased = sourceProduct.combinationId !== undefined && matchingProducts.some((product) => product.productAttributeId === sourceProduct.combinationId);
  const matchingPurchases = sortProductReferences(
    dedupeByKey(
      matchingProducts.map((product) => ({ productId: product.productId, combinationId: product.productAttributeId })),
      (ref) => `${ref.productId}:${ref.combinationId}`,
      "invalid_product_reference"
    )
  );

  const warnings: CustomerRecommendationContextWarning[] = [];
  if (productPreviouslyPurchased) warnings.push("source_product_previously_purchased");
  if (exactVariantPreviouslyPurchased) warnings.push("source_variant_previously_purchased");

  return { result: { productPreviouslyPurchased, exactVariantPreviouslyPurchased, matchingPurchases }, warnings };
}

function computeExplicitExclusionHistory(explicitExcludedProducts: readonly ProductReference[], products: readonly CustomerPurchasedProductEvidence[]): readonly ProductReference[] {
  return explicitExcludedProducts.filter((excluded) =>
    products.some((product) => product.productId === excluded.productId && (excluded.combinationId === undefined || product.productAttributeId === excluded.combinationId))
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function buildCustomerRecommendationContext(input: BuildCustomerRecommendationContextInput): CustomerRecommendationContext {
  if (!MASTER_CUSTOMER_ID_PATTERN.test(input.masterCustomerId)) fail("invalid_master_customer_id");

  const sourceProduct = input.recommendationIntent.sourceProduct === null ? null : validateProductReference(input.recommendationIntent.sourceProduct);
  const explicitExcludedProducts = normalizeExplicitExcludedProducts(input.recommendationIntent.explicitExcludedProducts);

  const { purchasedProductsResult, purchaseBehaviorResult } = input;
  const purchasedProductsAvailable = purchasedProductsResult.status === "available";
  const purchaseBehaviorAvailable = purchaseBehaviorResult.status === "available";

  const products = purchasedProductsResult.status === "available" ? buildPurchaseHistoryProducts(purchasedProductsResult.data.products) : [];
  const repeatedProducts = purchaseBehaviorResult.status === "available" ? buildRepeatedProducts(purchaseBehaviorResult.data.topProducts) : [];

  const composed = composeProfileStatus(purchasedProductsResult.status, purchaseBehaviorResult.status);
  const warnings = new Set<CustomerRecommendationContextWarning>(composed.warnings);
  let profileStatus = composed.status;

  if (products.some((product) => product.catalogStatus === "deleted_or_unavailable")) {
    warnings.add("purchased_product_deleted_or_unavailable");
  }

  if (purchasedProductsAvailable && products.length === 0) {
    warnings.add("no_purchase_history");
    const behaviorHasSignal = purchaseBehaviorResult.status === "available" && purchaseBehaviorResult.data.topProducts.length > 0;
    if (behaviorHasSignal) {
      profileStatus = "partial";
      warnings.add("inconsistent_purchase_history");
    }
  }

  const sourceProductHistory = computeSourceProductHistory(sourceProduct, products);
  for (const warning of sourceProductHistory.warnings) warnings.add(warning);

  const explicitExclusionHistory = computeExplicitExclusionHistory(explicitExcludedProducts, products);

  return {
    contextVersion: CUSTOMER_RECOMMENDATION_CONTEXT_VERSION,
    masterCustomerId: input.masterCustomerId,
    profileStatus,
    availability: { purchasedProductsAvailable, purchaseBehaviorAvailable },
    recommendationIntent: {
      sourceProduct,
      explicitExcludedProducts,
      explicitRepurchaseRequested: input.recommendationIntent.explicitRepurchaseRequested
    },
    purchaseHistory: { products, repeatedProducts },
    sourceProductHistory: sourceProductHistory.result,
    explicitExclusionHistory: { matches: explicitExclusionHistory },
    capabilities: {
      canAssessProductHistory: purchasedProductsAvailable,
      canAssessRepeatBehavior: purchaseBehaviorAvailable,
      canGenerateGenericRecommendationLater: true
    },
    warnings: WARNING_PRIORITY.filter((warning) => warnings.has(warning))
  };
}
