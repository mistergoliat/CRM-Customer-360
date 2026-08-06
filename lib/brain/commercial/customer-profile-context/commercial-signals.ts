import type { CustomerCommercialHistoryContext, CustomerProfileContextStatus, CustomerProfilePurchasedProductContext } from "./types";

/**
 * CP-R1-T12D. Closed union - never add a signal type here that cannot be
 * justified directly from `CustomerCommercialHistoryContext` (spec section 6:
 * no RFM/VIP/segment/purchasing-power/lifetime-value signal exists or will
 * ever be added to this union).
 */
export const CUSTOMER_HISTORY_UNAVAILABLE_REASONS = ["IDENTITY_UNAVAILABLE", "DISABLED", "NOT_FOUND", "TIMEOUT", "UNAVAILABLE", "CONTRACT_ERROR"] as const;
export type CustomerHistoryUnavailableReason = (typeof CUSTOMER_HISTORY_UNAVAILABLE_REASONS)[number];

export type CustomerHistoryReorderConfidence = "LOW" | "MEDIUM";

export type CustomerHistoryCommercialSignal =
  | { readonly type: "CUSTOMER_HAS_PURCHASE_HISTORY"; readonly evidence: { readonly validatedOrderCount: number; readonly lastPurchaseAt: string | null } }
  | { readonly type: "CUSTOMER_HAS_NO_PURCHASE_HISTORY" }
  | { readonly type: "HISTORY_UNAVAILABLE"; readonly reason: CustomerHistoryUnavailableReason }
  | { readonly type: "PRODUCT_PREVIOUSLY_PURCHASED"; readonly productId: number; readonly lastPurchasedAt: string | null; readonly orderCount: number; readonly totalQuantity: number }
  | {
      readonly type: "VARIANT_PREVIOUSLY_PURCHASED";
      readonly productId: number;
      readonly productAttributeId: number;
      readonly lastPurchasedAt: string | null;
      readonly orderCount: number;
      readonly totalQuantity: number;
    }
  | { readonly type: "PRODUCT_PURCHASE_REPEATED"; readonly productId: number; readonly productAttributeId: number | null; readonly orderCount: number; readonly totalQuantity: number }
  | {
      readonly type: "POSSIBLE_REORDER";
      readonly productId: number;
      readonly productAttributeId: number | null;
      readonly confidence: CustomerHistoryReorderConfidence;
      readonly evidence: readonly string[];
    }
  | {
      readonly type: "POSSIBLE_COMPLEMENT";
      readonly recommendedProductId: number;
      readonly relatedPurchasedProductIds: readonly number[];
      readonly confidence: "LOW";
      readonly evidence: readonly string[];
    }
  | { readonly type: "RECENT_PURCHASE_RELEVANT"; readonly productId: number; readonly productAttributeId: number | null; readonly purchasedAt: string };

/**
 * CP-R1-T12D (spec section 9 / "POSSIBLE_COMPLEMENT"). A product-product
 * relationship this conversation's own Catalog recommendation actually
 * asserted this turn (a completed `recommend_catalog_products` result's
 * `sourceProduct` -> candidate link) - never inferred from historical
 * co-occurrence alone. The current `runNativeAgentToolLoopCycle.ts` wiring
 * loads Customer Profile context before the tool-calling phase runs, so this
 * evidence is not yet threaded through at runtime (see the T12D release doc,
 * "Limitaciones") - this function and its signal type are still fully
 * implemented and tested so the contract is ready the day that wiring is
 * extended, and so `derivePossibleComplementSignals` is provably inert
 * (returns `[]`) rather than silently absent.
 */
export type CustomerHistoryCatalogComplementEvidence = {
  readonly recommendedProductId: number;
  readonly sourceProductId: number;
};

const DEFAULT_RECENT_PURCHASE_WINDOW_DAYS = 90;
/** Spec section 5: "orderCount >= 2", never `totalQuantity >= 2` - several units in one order never demonstrates purchase repeated over time. */
const REPEATED_ORDER_COUNT_THRESHOLD = 2;
/** Spec section 5: confidence is never HIGH; MEDIUM only once a third order corroborates the pattern beyond the bare repeated-purchase threshold. */
const REORDER_MEDIUM_CONFIDENCE_ORDER_COUNT = 3;

function isUnavailableStatus(status: CustomerProfileContextStatus): boolean {
  return status !== "AVAILABLE" && status !== "PARTIAL";
}

function mapUnavailableReason(context: CustomerCommercialHistoryContext): CustomerHistoryUnavailableReason {
  const reasonCode = context.observations.find((observation) => observation.capability === "context")?.reasonCode;
  switch (reasonCode) {
    case "CUSTOMER_PROFILE_DISABLED":
      return "DISABLED";
    case "CUSTOMER_PROFILE_IDENTITY_UNAVAILABLE":
      return "IDENTITY_UNAVAILABLE";
    case "CUSTOMER_PROFILE_CUSTOMER_NOT_FOUND":
      return "NOT_FOUND";
    case "CUSTOMER_PROFILE_TIMEOUT":
      return "TIMEOUT";
    case "CUSTOMER_PROFILE_CONTRACT_ERROR":
    case "CUSTOMER_PROFILE_PROVENANCE_MISMATCH":
      return "CONTRACT_ERROR";
    default:
      return "UNAVAILABLE";
  }
}

/** Several purchased-product rows can share a productId (one per distinct variant) when the match itself is not variant-specific - summed/most-recent across them, never fabricated. */
function aggregatePurchaseEvidence(products: readonly CustomerProfilePurchasedProductContext[]): { lastPurchasedAt: string | null; orderCount: number; totalQuantity: number } {
  let lastPurchasedAt: string | null = null;
  let orderCount = 0;
  let totalQuantity = 0;
  for (const product of products) {
    orderCount += product.orderCount;
    totalQuantity += product.totalQuantity;
    if (product.lastPurchasedAt && (!lastPurchasedAt || product.lastPurchasedAt > lastPurchasedAt)) lastPurchasedAt = product.lastPurchasedAt;
  }
  return { lastPurchasedAt, orderCount, totalQuantity };
}

function isWithinRecentWindow(purchasedAt: string | null, referenceTime: string, windowDays: number): purchasedAt is string {
  if (!purchasedAt) return false;
  const purchasedMs = Date.parse(purchasedAt);
  const referenceMs = Date.parse(referenceTime);
  if (!Number.isFinite(purchasedMs) || !Number.isFinite(referenceMs)) return false;
  const ageMs = referenceMs - purchasedMs;
  return ageMs >= 0 && ageMs <= windowDays * 24 * 60 * 60 * 1000;
}

/**
 * One entry per `recommendationHistoryMatches` match (already the exact,
 * pre-existing match against this turn's/carried-forward candidates - see
 * `compareRecommendationsWithPurchaseHistory.ts`, unmodified by T12D):
 * PRODUCT_PREVIOUSLY_PURCHASED or VARIANT_PREVIOUSLY_PURCHASED, plus
 * POSSIBLE_REORDER/RECENT_PURCHASE_RELEVANT when their own evidence
 * thresholds are met for that same match.
 */
function deriveMatchSignals(input: { context: CustomerCommercialHistoryContext; referenceTime: string; recentPurchaseWindowDays: number }): CustomerHistoryCommercialSignal[] {
  const signals: CustomerHistoryCommercialSignal[] = [];

  for (const match of input.context.recommendationHistoryMatches) {
    if (match.matchStatus === "NOT_PREVIOUSLY_PURCHASED" || match.matchStatus === "HISTORY_UNAVAILABLE") continue;

    const isVariantMatch = match.matchStatus === "SAME_VARIANT_PREVIOUSLY_PURCHASED" && match.productAttributeId !== null;
    const relatedPurchases = input.context.purchasedProducts.filter(
      (product) => product.productId === match.productId && (!isVariantMatch || product.productAttributeId === match.productAttributeId)
    );
    if (relatedPurchases.length === 0) continue;

    const evidence = aggregatePurchaseEvidence(relatedPurchases);
    const productAttributeId = isVariantMatch ? (match.productAttributeId as number) : null;

    signals.push(
      isVariantMatch
        ? {
            type: "VARIANT_PREVIOUSLY_PURCHASED",
            productId: match.productId,
            productAttributeId: productAttributeId as number,
            lastPurchasedAt: evidence.lastPurchasedAt,
            orderCount: evidence.orderCount,
            totalQuantity: evidence.totalQuantity
          }
        : { type: "PRODUCT_PREVIOUSLY_PURCHASED", productId: match.productId, lastPurchasedAt: evidence.lastPurchasedAt, orderCount: evidence.orderCount, totalQuantity: evidence.totalQuantity }
    );

    if (evidence.orderCount >= REPEATED_ORDER_COUNT_THRESHOLD) {
      signals.push({
        type: "POSSIBLE_REORDER",
        productId: match.productId,
        productAttributeId,
        confidence: evidence.orderCount >= REORDER_MEDIUM_CONFIDENCE_ORDER_COUNT ? "MEDIUM" : "LOW",
        evidence: [`orderCount=${evidence.orderCount}`, "current_request_matches_previously_purchased_product"]
      });
    }

    if (isWithinRecentWindow(evidence.lastPurchasedAt, input.referenceTime, input.recentPurchaseWindowDays)) {
      signals.push({ type: "RECENT_PURCHASE_RELEVANT", productId: match.productId, productAttributeId, purchasedAt: evidence.lastPurchasedAt });
    }
  }

  return signals;
}

/** Spec section 5: derived from the full purchased-products list (already bounded by config.purchasedProductsLimit), independent of current-turn relevance - the relevance layer (relevance.ts), not derivation, decides exposure. */
function deriveRepeatedPurchaseSignals(purchasedProducts: readonly CustomerProfilePurchasedProductContext[]): CustomerHistoryCommercialSignal[] {
  return purchasedProducts
    .filter((product) => product.orderCount >= REPEATED_ORDER_COUNT_THRESHOLD)
    .map((product) => ({
      type: "PRODUCT_PURCHASE_REPEATED" as const,
      productId: product.productId,
      productAttributeId: product.productAttributeId,
      orderCount: product.orderCount,
      totalQuantity: product.totalQuantity
    }));
}

function derivePossibleComplementSignals(input: {
  purchasedProducts: readonly CustomerProfilePurchasedProductContext[];
  catalogRelationshipEvidence: readonly CustomerHistoryCatalogComplementEvidence[];
}): CustomerHistoryCommercialSignal[] {
  const relatedBySourceProduct = new Map<number, number[]>();
  for (const evidence of input.catalogRelationshipEvidence) {
    const wasPurchased = input.purchasedProducts.some((product) => product.productId === evidence.sourceProductId);
    if (!wasPurchased) continue;
    const related = relatedBySourceProduct.get(evidence.recommendedProductId) ?? [];
    if (!related.includes(evidence.sourceProductId)) related.push(evidence.sourceProductId);
    relatedBySourceProduct.set(evidence.recommendedProductId, related);
  }

  return [...relatedBySourceProduct.entries()].map(([recommendedProductId, relatedPurchasedProductIds]) => ({
    type: "POSSIBLE_COMPLEMENT" as const,
    recommendedProductId,
    relatedPurchasedProductIds,
    confidence: "LOW" as const,
    evidence: ["catalog_recommendation_source_product_previously_purchased"]
  }));
}

export type DeriveCustomerHistoryCommercialSignalsInput = {
  readonly context: CustomerCommercialHistoryContext;
  /** Current turn time - never `Date.now()` inside this pure module. */
  readonly referenceTime: string;
  readonly recentPurchaseWindowDays?: number;
  readonly catalogRelationshipEvidence?: readonly CustomerHistoryCatalogComplementEvidence[];
};

/**
 * CP-R1-T12D. Pure, deterministic. Never mutates `context` or any of its
 * nested arrays (only ever reads via `.filter`/`.map`/spread into new
 * objects). Emits every signal the evidence supports, bounded only by the
 * already-capped `purchasedProducts`/`recommendationHistoryMatches` inputs -
 * `relevance.ts#filterRelevantCustomerHistorySignals` is the layer that
 * decides what actually reaches the model, never this function.
 */
export function deriveCustomerHistoryCommercialSignals(input: DeriveCustomerHistoryCommercialSignalsInput): CustomerHistoryCommercialSignal[] {
  const { context } = input;
  const recentPurchaseWindowDays = input.recentPurchaseWindowDays ?? DEFAULT_RECENT_PURCHASE_WINDOW_DAYS;

  if (isUnavailableStatus(context.status)) {
    return [{ type: "HISTORY_UNAVAILABLE", reason: mapUnavailableReason(context) }];
  }

  const signals: CustomerHistoryCommercialSignal[] = [];
  const hasHistory = (context.summary?.validatedOrderCount ?? 0) > 0 || context.purchasedProducts.length > 0;

  signals.push(
    hasHistory
      ? { type: "CUSTOMER_HAS_PURCHASE_HISTORY", evidence: { validatedOrderCount: context.summary?.validatedOrderCount ?? 0, lastPurchaseAt: context.summary?.lastPurchaseAt ?? null } }
      : { type: "CUSTOMER_HAS_NO_PURCHASE_HISTORY" }
  );

  signals.push(...deriveMatchSignals({ context, referenceTime: input.referenceTime, recentPurchaseWindowDays }));
  signals.push(...deriveRepeatedPurchaseSignals(context.purchasedProducts));
  signals.push(...derivePossibleComplementSignals({ purchasedProducts: context.purchasedProducts, catalogRelationshipEvidence: input.catalogRelationshipEvidence ?? [] }));

  return signals;
}
