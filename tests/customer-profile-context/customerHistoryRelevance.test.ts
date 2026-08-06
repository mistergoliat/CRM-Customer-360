import assert from "node:assert/strict";
import test from "node:test";
import { filterRelevantCustomerHistorySignals, shouldExposeCustomerHistorySignalToModel } from "@/lib/brain/commercial/customer-profile-context/relevance";
import type { CustomerHistoryCommercialSignal } from "@/lib/brain/commercial/customer-profile-context/commercial-signals";

const NO_MATCHES = { matchedProductIds: new Set<number>() };

test("shouldExposeCustomerHistorySignalToModel: bare history-presence facts are never exposed by default", () => {
  assert.equal(shouldExposeCustomerHistorySignalToModel({ type: "CUSTOMER_HAS_PURCHASE_HISTORY", evidence: { validatedOrderCount: 1, lastPurchaseAt: null } }, NO_MATCHES), false);
  assert.equal(shouldExposeCustomerHistorySignalToModel({ type: "CUSTOMER_HAS_NO_PURCHASE_HISTORY" }, NO_MATCHES), false);
});

test("shouldExposeCustomerHistorySignalToModel: HISTORY_UNAVAILABLE is always exposed as an internal constraint", () => {
  assert.equal(shouldExposeCustomerHistorySignalToModel({ type: "HISTORY_UNAVAILABLE", reason: "UNAVAILABLE" }, NO_MATCHES), true);
});

test("shouldExposeCustomerHistorySignalToModel: same product/variant match is always exposed", () => {
  assert.equal(shouldExposeCustomerHistorySignalToModel({ type: "PRODUCT_PREVIOUSLY_PURCHASED", productId: 1, lastPurchasedAt: null, orderCount: 1, totalQuantity: 1 }, NO_MATCHES), true);
  assert.equal(
    shouldExposeCustomerHistorySignalToModel({ type: "VARIANT_PREVIOUSLY_PURCHASED", productId: 1, productAttributeId: 10, lastPurchasedAt: null, orderCount: 1, totalQuantity: 1 }, NO_MATCHES),
    true
  );
});

test("shouldExposeCustomerHistorySignalToModel: repeated purchase related to current request is exposed", () => {
  const signal: CustomerHistoryCommercialSignal = { type: "PRODUCT_PURCHASE_REPEATED", productId: 1, productAttributeId: null, orderCount: 2, totalQuantity: 2 };
  assert.equal(shouldExposeCustomerHistorySignalToModel(signal, { matchedProductIds: new Set([1]) }), true);
});

test("shouldExposeCustomerHistorySignalToModel: unrelated repeated purchase is suppressed", () => {
  const signal: CustomerHistoryCommercialSignal = { type: "PRODUCT_PURCHASE_REPEATED", productId: 999, productAttributeId: null, orderCount: 2, totalQuantity: 2 };
  assert.equal(shouldExposeCustomerHistorySignalToModel(signal, { matchedProductIds: new Set([1]) }), false);
});

test("filterRelevantCustomerHistorySignals: exposes a matched signal and its related repeated-purchase signal", () => {
  const signals: CustomerHistoryCommercialSignal[] = [
    { type: "PRODUCT_PREVIOUSLY_PURCHASED", productId: 1, lastPurchasedAt: null, orderCount: 2, totalQuantity: 2 },
    { type: "PRODUCT_PURCHASE_REPEATED", productId: 1, productAttributeId: null, orderCount: 2, totalQuantity: 2 }
  ];
  const result = filterRelevantCustomerHistorySignals(signals, 8);
  assert.equal(result.length, 2);
});

test("filterRelevantCustomerHistorySignals: suppresses an unrelated repeated-purchase signal alongside an unrelated history-presence fact", () => {
  const signals: CustomerHistoryCommercialSignal[] = [
    { type: "CUSTOMER_HAS_PURCHASE_HISTORY", evidence: { validatedOrderCount: 3, lastPurchaseAt: null } },
    { type: "PRODUCT_PURCHASE_REPEATED", productId: 999, productAttributeId: null, orderCount: 4, totalQuantity: 4 }
  ];
  assert.deepEqual(filterRelevantCustomerHistorySignals(signals, 8), []);
});

test("filterRelevantCustomerHistorySignals: HISTORY_UNAVAILABLE used as internal constraint, still exposed even alone", () => {
  const result = filterRelevantCustomerHistorySignals([{ type: "HISTORY_UNAVAILABLE", reason: "UNAVAILABLE" }], 8);
  assert.deepEqual(result, [{ type: "HISTORY_UNAVAILABLE", reason: "UNAVAILABLE" }]);
});

test("filterRelevantCustomerHistorySignals: respects the maxSignals cap", () => {
  const signals: CustomerHistoryCommercialSignal[] = Array.from({ length: 12 }, (_, index) => ({
    type: "PRODUCT_PREVIOUSLY_PURCHASED" as const,
    productId: index + 1,
    lastPurchasedAt: null,
    orderCount: 1,
    totalQuantity: 1
  }));
  assert.equal(filterRelevantCustomerHistorySignals(signals, 5).length, 5);
});

test("filterRelevantCustomerHistorySignals: deterministic priority order (HISTORY_UNAVAILABLE first, variant before product, reorder before recent)", () => {
  const signals: CustomerHistoryCommercialSignal[] = [
    { type: "RECENT_PURCHASE_RELEVANT", productId: 3, productAttributeId: null, purchasedAt: "2026-01-01T00:00:00.000Z" },
    { type: "POSSIBLE_REORDER", productId: 2, productAttributeId: null, confidence: "LOW", evidence: [] },
    { type: "PRODUCT_PREVIOUSLY_PURCHASED", productId: 1, lastPurchasedAt: null, orderCount: 1, totalQuantity: 1 },
    { type: "VARIANT_PREVIOUSLY_PURCHASED", productId: 4, productAttributeId: 10, lastPurchasedAt: null, orderCount: 1, totalQuantity: 1 },
    { type: "HISTORY_UNAVAILABLE", reason: "UNAVAILABLE" }
  ];
  const result = filterRelevantCustomerHistorySignals(signals, 8);
  assert.deepEqual(
    result.map((signal) => signal.type),
    ["HISTORY_UNAVAILABLE", "VARIANT_PREVIOUSLY_PURCHASED", "PRODUCT_PREVIOUSLY_PURCHASED", "POSSIBLE_REORDER", "RECENT_PURCHASE_RELEVANT"]
  );
});

test("filterRelevantCustomerHistorySignals: never duplicates an identical signal", () => {
  const signal: CustomerHistoryCommercialSignal = { type: "PRODUCT_PREVIOUSLY_PURCHASED", productId: 1, lastPurchasedAt: null, orderCount: 1, totalQuantity: 1 };
  const result = filterRelevantCustomerHistorySignals([signal, { ...signal }], 8);
  assert.equal(result.length, 1);
});

test("filterRelevantCustomerHistorySignals: never mutates the input array", () => {
  const signals: CustomerHistoryCommercialSignal[] = [{ type: "PRODUCT_PREVIOUSLY_PURCHASED", productId: 1, lastPurchasedAt: null, orderCount: 1, totalQuantity: 1 }];
  const snapshot = JSON.parse(JSON.stringify(signals));
  filterRelevantCustomerHistorySignals(signals, 8);
  assert.deepEqual(signals, snapshot);
});
