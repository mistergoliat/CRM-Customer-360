import type {
  CustomerProfilePurchasedProductContext,
  CustomerProfileRecommendationComparisonInput,
  CustomerProfileRecommendationHistoryMatch
} from "./types";

export function compareRecommendationsWithPurchaseHistory(
  recommendations: readonly CustomerProfileRecommendationComparisonInput[],
  purchasedProducts: readonly CustomerProfilePurchasedProductContext[] | null
): CustomerProfileRecommendationHistoryMatch[] {
  return recommendations.map((recommendation) => {
    if (purchasedProducts === null) {
      return {
        productId: recommendation.productId,
        productAttributeId: recommendation.productAttributeId ?? null,
        name: recommendation.name ?? null,
        matchStatus: "HISTORY_UNAVAILABLE"
      };
    }

    const productMatches = purchasedProducts.filter((item) => item.productId === recommendation.productId);
    if (productMatches.length === 0) {
      return {
        productId: recommendation.productId,
        productAttributeId: recommendation.productAttributeId ?? null,
        name: recommendation.name ?? null,
        matchStatus: "NOT_PREVIOUSLY_PURCHASED"
      };
    }

    if (recommendation.productAttributeId === null || recommendation.productAttributeId === undefined) {
      return {
        productId: recommendation.productId,
        productAttributeId: null,
        name: recommendation.name ?? null,
        matchStatus: "PRODUCT_MATCH_VARIANT_UNKNOWN"
      };
    }

    const variantMatch = productMatches.some((item) => item.productAttributeId === recommendation.productAttributeId);
    return {
      productId: recommendation.productId,
      productAttributeId: recommendation.productAttributeId,
      name: recommendation.name ?? null,
      matchStatus: variantMatch ? "SAME_VARIANT_PREVIOUSLY_PURCHASED" : "SAME_PRODUCT_PREVIOUSLY_PURCHASED"
    };
  });
}
