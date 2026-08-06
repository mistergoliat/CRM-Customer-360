import type { CustomerCommercialHistoryContext } from "./types";

export function buildCustomerPurchaseHistorySummary(context: CustomerCommercialHistoryContext): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    status: context.status,
    constraints: {
      rfmAvailable: false,
      monetarySegmentAvailable: false,
      mayAlterCatalogRanking: false,
      mayAutoExcludePurchasedProducts: false
    },
    reasonCodes: context.observations.map((observation) => observation.reasonCode)
  };

  if (context.provenance) {
    summary.source = "PrestaShop direct customer profile";
    summary.contractVersion = context.provenance.contractVersion;
    summary.generatedAt = context.provenance.generatedAt;
  }

  if (context.summary) {
    summary.summary = {
      validatedOrderCount: context.summary.validatedOrderCount,
      firstPurchaseAt: context.summary.firstPurchaseAt,
      lastPurchaseAt: context.summary.lastPurchaseAt,
      historicalPurchaseValueTaxIncl: context.summary.historicalPurchaseValueTaxIncl,
      currencyIsoCode: context.summary.currencyIsoCode,
      monetaryInterpretation: context.summary.monetaryInterpretation
    };
  }

  if (context.recentOrders.length > 0) {
    summary.recentOrders = context.recentOrders.map((order) => ({
      createdAt: order.createdAt,
      currentStateName: order.currentStateName,
      valid: order.valid,
      totalPaidTaxIncl: order.totalPaidTaxIncl
    }));
  }

  if (context.purchasedProducts.length > 0) {
    summary.purchasedProducts = context.purchasedProducts.map((product) => ({
      productId: product.productId,
      productAttributeId: product.productAttributeId,
      name: product.name,
      totalQuantity: product.totalQuantity,
      orderCount: product.orderCount,
      firstPurchasedAt: product.firstPurchasedAt,
      lastPurchasedAt: product.lastPurchasedAt
    }));
  }

  if (context.purchaseBehavior) {
    summary.purchaseBehavior = {
      distinctProductCount: context.purchaseBehavior.distinctProductCount,
      distinctVariantCount: context.purchaseBehavior.distinctVariantCount,
      repeatedProductCount: context.purchaseBehavior.repeatedProductCount,
      diversityStatus: context.purchaseBehavior.diversityStatus,
      concentrationStatus: context.purchaseBehavior.concentrationStatus,
      topProducts: context.purchaseBehavior.topProducts.map((product) => ({
        productId: product.productId,
        name: product.name,
        orderCount: product.orderCount,
        lastPurchasedAt: product.lastPurchasedAt,
        isRepeated: product.isRepeated
      })),
      topVariants: context.purchaseBehavior.topVariants.map((variant) => ({
        productId: variant.productId,
        productAttributeId: variant.productAttributeId,
        name: variant.name,
        orderCount: variant.orderCount,
        lastPurchasedAt: variant.lastPurchasedAt,
        isRepeated: variant.isRepeated
      }))
    };
  }

  if (context.recommendationHistoryMatches.length > 0) {
    summary.recommendationHistoryMatches = context.recommendationHistoryMatches.map((match) => ({
      productId: match.productId,
      productAttributeId: match.productAttributeId,
      name: match.name,
      matchStatus: match.matchStatus
    }));
  }

  return summary;
}
