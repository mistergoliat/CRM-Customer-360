import assert from "node:assert/strict";
import test from "node:test";
import { deriveCustomerHistoryCommercialSignals } from "@/lib/brain/commercial/customer-profile-context/commercial-signals";
import type { CustomerCommercialHistoryContext, CustomerProfileContextObservation, CustomerProfilePurchasedProductContext, CustomerProfileRecommendationHistoryMatch } from "@/lib/brain/commercial/customer-profile-context/types";

const REFERENCE_TIME = "2026-08-06T12:00:00.000Z";

function purchasedProduct(overrides: Partial<CustomerProfilePurchasedProductContext> = {}): CustomerProfilePurchasedProductContext {
  return {
    productId: 100,
    productAttributeId: null,
    name: "Barra olimpica",
    totalQuantity: 1,
    orderCount: 1,
    firstPurchasedAt: "2026-01-01T00:00:00.000Z",
    lastPurchasedAt: "2026-01-01T00:00:00.000Z",
    historicalSpentTaxIncl: "129990",
    catalogStatus: "linked",
    ...overrides
  };
}

function match(overrides: Partial<CustomerProfileRecommendationHistoryMatch> = {}): CustomerProfileRecommendationHistoryMatch {
  return { productId: 100, productAttributeId: null, name: "Barra olimpica", matchStatus: "SAME_PRODUCT_PREVIOUSLY_PURCHASED", ...overrides };
}

function observation(overrides: Partial<CustomerProfileContextObservation> = {}): CustomerProfileContextObservation {
  return { capability: "context", status: "AVAILABLE", reasonCode: "CUSTOMER_PROFILE_AVAILABLE", ...overrides };
}

function baseContext(overrides: Partial<CustomerCommercialHistoryContext> = {}): CustomerCommercialHistoryContext {
  return {
    status: "AVAILABLE",
    customerId: 42,
    summary: { validatedOrderCount: 1, firstPurchaseAt: "2026-01-01T00:00:00.000Z", lastPurchaseAt: "2026-01-01T00:00:00.000Z", historicalPurchaseValueTaxIncl: "129990", currencyIsoCode: "CLP", monetaryInterpretation: "INFORMATIONAL_ONLY" },
    recentOrders: [],
    purchasedProducts: [purchasedProduct()],
    purchaseBehavior: null,
    provenance: { source: "PRESTASHOP", identityStatus: "DIRECT_SOURCE", contractVersion: "customer-profile-prestashop-direct-v1", generatedAt: "2026-08-06T11:00:00.000Z" },
    recommendationHistoryMatches: [],
    constraints: { rfmAvailable: false, monetarySegmentAvailable: false, mayAlterCatalogRanking: false, mayAutoExcludePurchasedProducts: false },
    observations: [observation()],
    ...overrides
  };
}

test("emits CUSTOMER_HAS_PURCHASE_HISTORY when validatedOrderCount > 0", () => {
  const signals = deriveCustomerHistoryCommercialSignals({ context: baseContext(), referenceTime: REFERENCE_TIME });
  assert.deepEqual(
    signals.find((signal) => signal.type === "CUSTOMER_HAS_PURCHASE_HISTORY"),
    { type: "CUSTOMER_HAS_PURCHASE_HISTORY", evidence: { validatedOrderCount: 1, lastPurchaseAt: "2026-01-01T00:00:00.000Z" } }
  );
});

test("emits CUSTOMER_HAS_NO_PURCHASE_HISTORY only when the service responded correctly with zero orders", () => {
  const signals = deriveCustomerHistoryCommercialSignals({
    context: baseContext({ summary: { validatedOrderCount: 0, firstPurchaseAt: null, lastPurchaseAt: null, historicalPurchaseValueTaxIncl: null, currencyIsoCode: null, monetaryInterpretation: "INFORMATIONAL_ONLY" }, purchasedProducts: [] }),
    referenceTime: REFERENCE_TIME
  });
  assert.deepEqual(signals, [{ type: "CUSTOMER_HAS_NO_PURCHASE_HISTORY" }]);
});

test("never emits CUSTOMER_HAS_NO_PURCHASE_HISTORY when the service is unavailable", () => {
  const signals = deriveCustomerHistoryCommercialSignals({
    context: baseContext({ status: "UNAVAILABLE", summary: null, purchasedProducts: [], observations: [observation({ status: "UNAVAILABLE", reasonCode: "CUSTOMER_PROFILE_UNAVAILABLE" })] }),
    referenceTime: REFERENCE_TIME
  });
  assert.equal(signals.some((signal) => signal.type === "CUSTOMER_HAS_NO_PURCHASE_HISTORY"), false);
  assert.deepEqual(signals, [{ type: "HISTORY_UNAVAILABLE", reason: "UNAVAILABLE" }]);
});

for (const [status, reasonCode, reason] of [
  ["DISABLED", "CUSTOMER_PROFILE_DISABLED", "DISABLED"],
  ["IDENTITY_UNAVAILABLE", "CUSTOMER_PROFILE_IDENTITY_UNAVAILABLE", "IDENTITY_UNAVAILABLE"],
  ["NOT_FOUND", "CUSTOMER_PROFILE_CUSTOMER_NOT_FOUND", "NOT_FOUND"],
  ["UNAVAILABLE", "CUSTOMER_PROFILE_TIMEOUT", "TIMEOUT"],
  ["CONTRACT_ERROR", "CUSTOMER_PROFILE_CONTRACT_ERROR", "CONTRACT_ERROR"],
  ["CONTRACT_ERROR", "CUSTOMER_PROFILE_PROVENANCE_MISMATCH", "CONTRACT_ERROR"]
] as const) {
  test(`maps context.status=${status} (${reasonCode}) to HISTORY_UNAVAILABLE reason=${reason}`, () => {
    const signals = deriveCustomerHistoryCommercialSignals({
      context: baseContext({ status, summary: null, purchasedProducts: [], observations: [observation({ status, reasonCode })] }),
      referenceTime: REFERENCE_TIME
    });
    assert.deepEqual(signals, [{ type: "HISTORY_UNAVAILABLE", reason }]);
  });
}

test("PARTIAL status still derives signals like AVAILABLE (summary itself succeeded)", () => {
  const signals = deriveCustomerHistoryCommercialSignals({ context: baseContext({ status: "PARTIAL" }), referenceTime: REFERENCE_TIME });
  assert.ok(signals.some((signal) => signal.type === "CUSTOMER_HAS_PURCHASE_HISTORY"));
});

test("PRODUCT_PREVIOUSLY_PURCHASED: same product match without variant information", () => {
  const signals = deriveCustomerHistoryCommercialSignals({
    context: baseContext({ recommendationHistoryMatches: [match({ matchStatus: "SAME_PRODUCT_PREVIOUSLY_PURCHASED" })] }),
    referenceTime: REFERENCE_TIME
  });
  assert.deepEqual(signals.find((signal) => signal.type === "PRODUCT_PREVIOUSLY_PURCHASED"), {
    type: "PRODUCT_PREVIOUSLY_PURCHASED",
    productId: 100,
    lastPurchasedAt: "2026-01-01T00:00:00.000Z",
    orderCount: 1,
    totalQuantity: 1
  });
});

test("PRODUCT_PREVIOUSLY_PURCHASED: PRODUCT_MATCH_VARIANT_UNKNOWN maps to the same product-level signal, never a variant one", () => {
  const signals = deriveCustomerHistoryCommercialSignals({
    context: baseContext({ recommendationHistoryMatches: [match({ matchStatus: "PRODUCT_MATCH_VARIANT_UNKNOWN" })] }),
    referenceTime: REFERENCE_TIME
  });
  assert.equal(signals.some((signal) => signal.type === "VARIANT_PREVIOUSLY_PURCHASED"), false);
  assert.ok(signals.some((signal) => signal.type === "PRODUCT_PREVIOUSLY_PURCHASED"));
});

test("VARIANT_PREVIOUSLY_PURCHASED: exact productId+productAttributeId match", () => {
  const signals = deriveCustomerHistoryCommercialSignals({
    context: baseContext({
      purchasedProducts: [purchasedProduct({ productAttributeId: 10 })],
      recommendationHistoryMatches: [match({ matchStatus: "SAME_VARIANT_PREVIOUSLY_PURCHASED", productAttributeId: 10 })]
    }),
    referenceTime: REFERENCE_TIME
  });
  assert.deepEqual(signals.find((signal) => signal.type === "VARIANT_PREVIOUSLY_PURCHASED"), {
    type: "VARIANT_PREVIOUSLY_PURCHASED",
    productId: 100,
    productAttributeId: 10,
    lastPurchasedAt: "2026-01-01T00:00:00.000Z",
    orderCount: 1,
    totalQuantity: 1
  });
});

test("a different variant of the same product never emits VARIANT_PREVIOUSLY_PURCHASED (no fabricated match)", () => {
  const signals = deriveCustomerHistoryCommercialSignals({
    context: baseContext({
      purchasedProducts: [purchasedProduct({ productAttributeId: 10 })],
      recommendationHistoryMatches: [match({ matchStatus: "SAME_VARIANT_PREVIOUSLY_PURCHASED", productAttributeId: 11 })]
    }),
    referenceTime: REFERENCE_TIME
  });
  assert.equal(signals.some((signal) => signal.type === "VARIANT_PREVIOUSLY_PURCHASED"), false);
});

test("NOT_PREVIOUSLY_PURCHASED and per-match HISTORY_UNAVAILABLE never emit a match signal", () => {
  const signals = deriveCustomerHistoryCommercialSignals({
    context: baseContext({ recommendationHistoryMatches: [match({ matchStatus: "NOT_PREVIOUSLY_PURCHASED" }), match({ matchStatus: "HISTORY_UNAVAILABLE", productId: 200 })] }),
    referenceTime: REFERENCE_TIME
  });
  assert.equal(signals.some((signal) => signal.type === "PRODUCT_PREVIOUSLY_PURCHASED" || signal.type === "VARIANT_PREVIOUSLY_PURCHASED"), false);
});

test("PRODUCT_PURCHASE_REPEATED requires orderCount >= 2, never fires from totalQuantity alone", () => {
  const singleOrderMultiUnit = deriveCustomerHistoryCommercialSignals({
    context: baseContext({ purchasedProducts: [purchasedProduct({ orderCount: 1, totalQuantity: 5 })] }),
    referenceTime: REFERENCE_TIME
  });
  assert.equal(singleOrderMultiUnit.some((signal) => signal.type === "PRODUCT_PURCHASE_REPEATED"), false);

  const twoOrders = deriveCustomerHistoryCommercialSignals({
    context: baseContext({ purchasedProducts: [purchasedProduct({ orderCount: 2, totalQuantity: 2 })] }),
    referenceTime: REFERENCE_TIME
  });
  assert.deepEqual(twoOrders.find((signal) => signal.type === "PRODUCT_PURCHASE_REPEATED"), {
    type: "PRODUCT_PURCHASE_REPEATED",
    productId: 100,
    productAttributeId: null,
    orderCount: 2,
    totalQuantity: 2
  });
});

test("POSSIBLE_REORDER: hypothesis only, confidence LOW at exactly 2 orders, MEDIUM at 3+, never HIGH", () => {
  const low = deriveCustomerHistoryCommercialSignals({
    context: baseContext({ purchasedProducts: [purchasedProduct({ orderCount: 2 })], recommendationHistoryMatches: [match()] }),
    referenceTime: REFERENCE_TIME
  });
  const lowSignal = low.find((signal) => signal.type === "POSSIBLE_REORDER");
  assert.equal(lowSignal?.type === "POSSIBLE_REORDER" ? lowSignal.confidence : undefined, "LOW");

  const medium = deriveCustomerHistoryCommercialSignals({
    context: baseContext({ purchasedProducts: [purchasedProduct({ orderCount: 3 })], recommendationHistoryMatches: [match()] }),
    referenceTime: REFERENCE_TIME
  });
  const mediumSignal = medium.find((signal) => signal.type === "POSSIBLE_REORDER");
  assert.equal(mediumSignal?.type === "POSSIBLE_REORDER" ? mediumSignal.confidence : undefined, "MEDIUM");

  const serialized = JSON.stringify([...low, ...medium]);
  assert.doesNotMatch(serialized, /HIGH/);
});

test("POSSIBLE_REORDER never emitted for a single-order product, even if it matches the current request", () => {
  const signals = deriveCustomerHistoryCommercialSignals({
    context: baseContext({ purchasedProducts: [purchasedProduct({ orderCount: 1 })], recommendationHistoryMatches: [match()] }),
    referenceTime: REFERENCE_TIME
  });
  assert.equal(signals.some((signal) => signal.type === "POSSIBLE_REORDER"), false);
});

test("RECENT_PURCHASE_RELEVANT: within the configured window (default 90 days)", () => {
  const signals = deriveCustomerHistoryCommercialSignals({
    context: baseContext({ purchasedProducts: [purchasedProduct({ lastPurchasedAt: "2026-06-01T00:00:00.000Z" })], recommendationHistoryMatches: [match()] }),
    referenceTime: REFERENCE_TIME
  });
  assert.deepEqual(signals.find((signal) => signal.type === "RECENT_PURCHASE_RELEVANT"), {
    type: "RECENT_PURCHASE_RELEVANT",
    productId: 100,
    productAttributeId: null,
    purchasedAt: "2026-06-01T00:00:00.000Z"
  });
});

test("RECENT_PURCHASE_RELEVANT: never emitted outside the window", () => {
  const signals = deriveCustomerHistoryCommercialSignals({
    context: baseContext({ purchasedProducts: [purchasedProduct({ lastPurchasedAt: "2025-01-01T00:00:00.000Z" })], recommendationHistoryMatches: [match()] }),
    referenceTime: REFERENCE_TIME
  });
  assert.equal(signals.some((signal) => signal.type === "RECENT_PURCHASE_RELEVANT"), false);
});

test("RECENT_PURCHASE_RELEVANT: window is configurable", () => {
  const signals = deriveCustomerHistoryCommercialSignals({
    context: baseContext({ purchasedProducts: [purchasedProduct({ lastPurchasedAt: "2026-05-01T00:00:00.000Z" })], recommendationHistoryMatches: [match()] }),
    referenceTime: REFERENCE_TIME,
    recentPurchaseWindowDays: 30
  });
  assert.equal(signals.some((signal) => signal.type === "RECENT_PURCHASE_RELEVANT"), false);
});

test("POSSIBLE_COMPLEMENT: only with explicit catalog relationship evidence whose source product was purchased", () => {
  const withEvidence = deriveCustomerHistoryCommercialSignals({
    context: baseContext(),
    referenceTime: REFERENCE_TIME,
    catalogRelationshipEvidence: [{ recommendedProductId: 200, sourceProductId: 100 }]
  });
  assert.deepEqual(withEvidence.find((signal) => signal.type === "POSSIBLE_COMPLEMENT"), {
    type: "POSSIBLE_COMPLEMENT",
    recommendedProductId: 200,
    relatedPurchasedProductIds: [100],
    confidence: "LOW",
    evidence: ["catalog_recommendation_source_product_previously_purchased"]
  });
});

test("POSSIBLE_COMPLEMENT: never emitted without catalog relationship evidence (no inference from historical coexistence alone)", () => {
  const signals = deriveCustomerHistoryCommercialSignals({ context: baseContext(), referenceTime: REFERENCE_TIME });
  assert.equal(signals.some((signal) => signal.type === "POSSIBLE_COMPLEMENT"), false);
});

test("POSSIBLE_COMPLEMENT: never emitted when the evidence's sourceProduct was not actually purchased", () => {
  const signals = deriveCustomerHistoryCommercialSignals({
    context: baseContext(),
    referenceTime: REFERENCE_TIME,
    catalogRelationshipEvidence: [{ recommendedProductId: 200, sourceProductId: 999 }]
  });
  assert.equal(signals.some((signal) => signal.type === "POSSIBLE_COMPLEMENT"), false);
});

test("never emits a forbidden signal type (RFM/VIP/segment/purchasing-power/lifetime-value/ranking)", () => {
  const signals = deriveCustomerHistoryCommercialSignals({
    context: baseContext({ purchasedProducts: [purchasedProduct({ orderCount: 5, totalQuantity: 20 })], recommendationHistoryMatches: [match()] }),
    referenceTime: REFERENCE_TIME
  });
  const serialized = JSON.stringify(signals);
  assert.doesNotMatch(serialized, /VIP|HIGH_VALUE|LOW_VALUE|AFFORD|PRICE_SENSITIVE|LOYAL|PREMIUM|CHURN|LIFETIME|EXCLUDED|BOOSTED|RFM/i);
});

test("does not mutate the input context or its nested arrays", () => {
  const context = baseContext({ purchasedProducts: [purchasedProduct({ orderCount: 3 })], recommendationHistoryMatches: [match()] });
  const snapshot = JSON.parse(JSON.stringify(context));
  deriveCustomerHistoryCommercialSignals({ context, referenceTime: REFERENCE_TIME });
  assert.deepEqual(context, snapshot);
});

test("returns a new array each call - never a shared/cached reference across calls", () => {
  const context = baseContext();
  const first = deriveCustomerHistoryCommercialSignals({ context, referenceTime: REFERENCE_TIME });
  const second = deriveCustomerHistoryCommercialSignals({ context, referenceTime: REFERENCE_TIME });
  assert.notEqual(first, second);
  assert.deepEqual(first, second);
});
