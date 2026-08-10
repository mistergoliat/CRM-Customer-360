import assert from "node:assert/strict";
import test from "node:test";
import type { PricedLineItem } from "@/lib/domains/shipping-calculation";
import { validateAndSumTotalBoleta } from "@/lib/domains/shipping-calculation";

function item(overrides: Partial<PricedLineItem> = {}): PricedLineItem {
  return { productId: "1", combinationId: null, quantity: 1, unitPrice: 1000, ...overrides };
}

test("prices: 50.000 x 2 + 20.000 x 3 -> 160.000", () => {
  const result = validateAndSumTotalBoleta([
    item({ productId: "1", unitPrice: 50000, quantity: 2 }),
    item({ productId: "2", unitPrice: 20000, quantity: 3 })
  ]);
  assert.deepEqual(result, { ok: true, totalBoleta: 160000 });
});

test("single product, single unit", () => {
  const result = validateAndSumTotalBoleta([item({ unitPrice: 89990, quantity: 1 })]);
  assert.deepEqual(result, { ok: true, totalBoleta: 89990 });
});

test("price of zero is preserved, never rejected", () => {
  const result = validateAndSumTotalBoleta([item({ unitPrice: 0, quantity: 3 })]);
  assert.deepEqual(result, { ok: true, totalBoleta: 0 });
});

test("unitPrice null fails closed as price_unavailable, never treated as zero", () => {
  const result = validateAndSumTotalBoleta([item({ unitPrice: null })]);
  assert.deepEqual(result, { ok: false, status: "price_unavailable", reason: "price_unavailable:1" });
});

test("negative unitPrice is a technical error (upstream data inconsistency), never silently clamped", () => {
  const result = validateAndSumTotalBoleta([item({ unitPrice: -1 })]);
  assert.deepEqual(result, { ok: false, status: "technical_error", reason: "invalid_upstream_price:1" });
});

test("non-finite unitPrice is a technical error", () => {
  const result = validateAndSumTotalBoleta([item({ unitPrice: Number.POSITIVE_INFINITY })]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, "technical_error");
});

test("quantity zero/negative/non-integer is invalid", () => {
  assert.equal(validateAndSumTotalBoleta([item({ quantity: 0 })]).ok, false);
  assert.equal(validateAndSumTotalBoleta([item({ quantity: -2 })]).ok, false);
  assert.equal(validateAndSumTotalBoleta([item({ quantity: 1.5 })]).ok, false);
});

test("empty items array is invalid", () => {
  const result = validateAndSumTotalBoleta([]);
  assert.deepEqual(result, { ok: false, status: "invalid_input", reason: "items_required" });
});

test("first invalid line fails closed even when a later line would also be valid (no partial totals)", () => {
  const result = validateAndSumTotalBoleta([item({ productId: "1", unitPrice: 10000 }), item({ productId: "2", unitPrice: null })]);
  assert.deepEqual(result, { ok: false, status: "price_unavailable", reason: "price_unavailable:2" });
});

test("fractional unitPrice is rounded per line (CLP has no subunit), integer summation throughout", () => {
  const result = validateAndSumTotalBoleta([item({ unitPrice: 999.6, quantity: 2 })]);
  assert.deepEqual(result, { ok: true, totalBoleta: 2000 });
});
