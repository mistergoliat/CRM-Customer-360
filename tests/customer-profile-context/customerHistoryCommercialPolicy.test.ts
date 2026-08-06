import assert from "node:assert/strict";
import test from "node:test";
import { buildCustomerHistoryCommercialGuidance } from "@/lib/brain/commercial/customer-profile-context/commercial-policy";
import type { CustomerHistoryCommercialSignal } from "@/lib/brain/commercial/customer-profile-context/commercial-signals";

test("guidance is always closed against ranking/auto-exclusion/segment/purchasing-power regardless of signals", () => {
  const guidance = buildCustomerHistoryCommercialGuidance([]);
  assert.equal(guidance.preserveCatalogOrdering, true);
  assert.equal(guidance.autoExcludePurchasedProducts, false);
  assert.equal(guidance.inferCustomerSegment, false);
  assert.equal(guidance.inferPurchasingPower, false);
});

test("empty signals: no acknowledgement, no reason codes, avoids redundant recommendation", () => {
  const guidance = buildCustomerHistoryCommercialGuidance([]);
  assert.equal(guidance.acknowledgeHistory, false);
  assert.equal(guidance.mentionPreviousPurchase, false);
  assert.equal(guidance.askReorderClarification, false);
  assert.equal(guidance.explainComplementRelationship, false);
  assert.equal(guidance.avoidRedundantRecommendation, true);
  assert.deepEqual(guidance.reasonCodes, []);
});

test("PRODUCT_PREVIOUSLY_PURCHASED or VARIANT_PREVIOUSLY_PURCHASED enables mentionPreviousPurchase and acknowledgeHistory", () => {
  const guidance = buildCustomerHistoryCommercialGuidance([{ type: "PRODUCT_PREVIOUSLY_PURCHASED", productId: 1, lastPurchasedAt: null, orderCount: 1, totalQuantity: 1 }]);
  assert.equal(guidance.mentionPreviousPurchase, true);
  assert.equal(guidance.acknowledgeHistory, true);
  assert.equal(guidance.avoidRedundantRecommendation, false);
  assert.ok(guidance.reasonCodes.includes("PRODUCT_OR_VARIANT_MATCH"));
});

test("POSSIBLE_REORDER enables askReorderClarification with its own reason code", () => {
  const guidance = buildCustomerHistoryCommercialGuidance([{ type: "POSSIBLE_REORDER", productId: 1, productAttributeId: null, confidence: "LOW", evidence: [] }]);
  assert.equal(guidance.askReorderClarification, true);
  assert.ok(guidance.reasonCodes.includes("POSSIBLE_REORDER_HYPOTHESIS"));
});

test("POSSIBLE_COMPLEMENT enables explainComplementRelationship with its own reason code", () => {
  const guidance = buildCustomerHistoryCommercialGuidance([{ type: "POSSIBLE_COMPLEMENT", recommendedProductId: 1, relatedPurchasedProductIds: [2], confidence: "LOW", evidence: [] }]);
  assert.equal(guidance.explainComplementRelationship, true);
  assert.ok(guidance.reasonCodes.includes("CATALOG_BACKED_COMPLEMENT"));
});

test("HISTORY_UNAVAILABLE contributes its own reason code without enabling acknowledgement flags", () => {
  const guidance = buildCustomerHistoryCommercialGuidance([{ type: "HISTORY_UNAVAILABLE", reason: "UNAVAILABLE" }]);
  assert.ok(guidance.reasonCodes.includes("HISTORY_UNAVAILABLE_FAIL_OPEN"));
  assert.equal(guidance.acknowledgeHistory, false);
});

test("allowedStatements/prohibitedStatements never mention RFM/VIP/purchasing power in the affirmative, only as prohibitions", () => {
  const guidance = buildCustomerHistoryCommercialGuidance([]);
  assert.equal(guidance.allowedStatements.some((statement) => /RFM|VIP|purchasing power|lifetime value/i.test(statement)), false);
  assert.ok(guidance.prohibitedStatements.some((statement) => /RFM/i.test(statement)));
  assert.ok(guidance.prohibitedStatements.some((statement) => /VIP/i.test(statement)));
});

test("never produces final customer-facing text - only structured booleans/strings", () => {
  const guidance = buildCustomerHistoryCommercialGuidance([{ type: "PRODUCT_PREVIOUSLY_PURCHASED", productId: 1, lastPurchasedAt: null, orderCount: 1, totalQuantity: 1 }]);
  assert.equal(typeof guidance.acknowledgeHistory, "boolean");
  assert.ok(Array.isArray(guidance.allowedStatements));
  assert.ok(Array.isArray(guidance.prohibitedStatements));
});

test("does not mutate the input signals array", () => {
  const signals: CustomerHistoryCommercialSignal[] = [{ type: "PRODUCT_PREVIOUSLY_PURCHASED", productId: 1, lastPurchasedAt: null, orderCount: 1, totalQuantity: 1 }];
  const snapshot = JSON.parse(JSON.stringify(signals));
  buildCustomerHistoryCommercialGuidance(signals);
  assert.deepEqual(signals, snapshot);
});

test("running the policy again for a different signal set never alters an earlier call's returned guidance", () => {
  const first = buildCustomerHistoryCommercialGuidance([{ type: "PRODUCT_PREVIOUSLY_PURCHASED", productId: 1, lastPurchasedAt: null, orderCount: 1, totalQuantity: 1 }]);
  const firstSnapshot = JSON.parse(JSON.stringify(first));
  buildCustomerHistoryCommercialGuidance([{ type: "POSSIBLE_COMPLEMENT", recommendedProductId: 2, relatedPurchasedProductIds: [1], confidence: "LOW", evidence: [] }]);
  assert.deepEqual(first, firstSnapshot);
});
