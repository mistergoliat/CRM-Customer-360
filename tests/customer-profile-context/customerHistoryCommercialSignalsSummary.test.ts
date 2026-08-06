import assert from "node:assert/strict";
import test from "node:test";
import { buildCustomerHistoryCommercialSignalsSummary } from "@/lib/brain/commercial/customer-profile-context/summary";
import { buildCustomerHistoryCommercialGuidance } from "@/lib/brain/commercial/customer-profile-context/commercial-policy";
import type { CustomerHistoryCommercialSignal } from "@/lib/brain/commercial/customer-profile-context/commercial-signals";

test("compact summary carries the signals verbatim and a closed guidance object", () => {
  const signals: CustomerHistoryCommercialSignal[] = [{ type: "PRODUCT_PREVIOUSLY_PURCHASED", productId: 100, lastPurchasedAt: "2026-01-01T00:00:00.000Z", orderCount: 1, totalQuantity: 1 }];
  const guidance = buildCustomerHistoryCommercialGuidance(signals);
  const summary = buildCustomerHistoryCommercialSignalsSummary({ signals, guidance });

  assert.deepEqual(summary.signals, signals);
  assert.deepEqual(summary.guidance, {
    acknowledgeHistory: true,
    mentionPreviousPurchase: true,
    askReorderClarification: false,
    explainComplementRelationship: false,
    avoidRedundantRecommendation: false,
    preserveCatalogOrdering: true,
    autoExcludePurchasedProducts: false,
    inferCustomerSegment: false,
    inferPurchasingPower: false,
    reasonCodes: ["PRODUCT_OR_VARIANT_MATCH"]
  });
});

test("never includes allowedStatements/prohibitedStatements (already covered by static prompt rule lines, never duplicated)", () => {
  const signals: CustomerHistoryCommercialSignal[] = [];
  const summary = buildCustomerHistoryCommercialSignalsSummary({ signals, guidance: buildCustomerHistoryCommercialGuidance(signals) });
  const guidance = summary.guidance as Record<string, unknown>;
  assert.equal("allowedStatements" in guidance, false);
  assert.equal("prohibitedStatements" in guidance, false);
});

test("never leaks product names, spend figures, HTTP status, or raw payload fields", () => {
  const signals: CustomerHistoryCommercialSignal[] = [
    { type: "PRODUCT_PURCHASE_REPEATED", productId: 100, productAttributeId: null, orderCount: 3, totalQuantity: 6 },
    { type: "POSSIBLE_COMPLEMENT", recommendedProductId: 200, relatedPurchasedProductIds: [100], confidence: "LOW", evidence: ["catalog_recommendation_source_product_previously_purchased"] }
  ];
  const summary = buildCustomerHistoryCommercialSignalsSummary({ signals, guidance: buildCustomerHistoryCommercialGuidance(signals) });
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /httpStatus|responseBody|rawBody|stack|Authorization|Barra|CLP|\$/i);
});

test("mutating the returned summary never alters the original signals fixture", () => {
  const signals: CustomerHistoryCommercialSignal[] = [{ type: "PRODUCT_PREVIOUSLY_PURCHASED", productId: 100, lastPurchasedAt: null, orderCount: 1, totalQuantity: 1 }];
  const snapshot = JSON.parse(JSON.stringify(signals));
  const summary = buildCustomerHistoryCommercialSignalsSummary({ signals, guidance: buildCustomerHistoryCommercialGuidance(signals) });
  (summary.signals as unknown[]).push({ type: "INJECTED" });
  assert.deepEqual(signals, snapshot);
});
