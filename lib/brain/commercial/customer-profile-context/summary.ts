import type { CustomerCommercialHistoryContext } from "./types";
import type { CustomerHistoryCommercialSignal } from "./commercial-signals";
import type { CustomerHistoryCommercialGuidance } from "./commercial-policy";

export function buildCustomerPurchaseHistorySummary(context: CustomerCommercialHistoryContext): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    status: context.status,
    constraints: {
      rfmAvailable: context.constraints.rfmAvailable,
      monetarySegmentAvailable: context.constraints.monetarySegmentAvailable,
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

export function buildCustomerRfmSummary(context: CustomerCommercialHistoryContext["customerRfm"]): Record<string, unknown> | null {
  if (context === null) {
    return null;
  }

  if (context.status !== "AVAILABLE") {
    return {
      status: context.status,
      reasonCode: context.reasonCode
    };
  }

  return {
    status: "AVAILABLE",
    contractVersion: context.contractVersion,
    snapshot: {
      referenceTime: context.snapshot.referenceTime,
      publishedAt: context.snapshot.publishedAt,
      calculationVersion: context.snapshot.calculationVersion
    },
    rfm: {
      recencyDays: context.rfm.recencyDays,
      frequencyOrders: context.rfm.frequencyOrders,
      grossOrderValueTaxIncl: context.rfm.grossOrderValueTaxIncl,
      averageOrderValueTaxIncl: context.rfm.averageOrderValueTaxIncl,
      recencyScore: context.rfm.recencyScore,
      frequencyScore: context.rfm.frequencyScore,
      monetaryScore: context.rfm.monetaryScore,
      rfmCode: context.rfm.rfmCode
    },
    segment: {
      code: context.segment.code,
      version: context.segment.version
    }
  };
}

/**
 * CP-R1-T12D (spec section 10). Compact by construction: signals are already
 * bounded/deduplicated/relevance-filtered by the time they reach here (see
 * relevance.ts#filterRelevantCustomerHistorySignals) - this function only
 * shapes them for the prompt payload, never widens what's included. Never
 * product names, spend figures, personal data, raw payloads, HTTP status
 * codes, or stack traces - allowedStatements/prohibitedStatements are
 * deliberately omitted here (already covered in English prose by
 * CUSTOMER_HISTORY_COMMERCIAL_POLICY_RULE_LINES in the prompt itself - never
 * duplicated in both places).
 */
export function buildCustomerHistoryCommercialSignalsSummary(input: { signals: readonly CustomerHistoryCommercialSignal[]; guidance: CustomerHistoryCommercialGuidance }): Record<string, unknown> {
  return {
    signals: input.signals.map((signal) => ({ ...signal })),
    guidance: {
      acknowledgeHistory: input.guidance.acknowledgeHistory,
      mentionPreviousPurchase: input.guidance.mentionPreviousPurchase,
      askReorderClarification: input.guidance.askReorderClarification,
      explainComplementRelationship: input.guidance.explainComplementRelationship,
      avoidRedundantRecommendation: input.guidance.avoidRedundantRecommendation,
      preserveCatalogOrdering: true,
      autoExcludePurchasedProducts: false,
      inferCustomerSegment: false,
      inferPurchasingPower: false,
      reasonCodes: input.guidance.reasonCodes
    }
  };
}
