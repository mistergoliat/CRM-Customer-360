import assert from "node:assert/strict";
import test from "node:test";
import type { ShippingCalculationLineItem } from "@/lib/domains/shipping-calculation";
import { validateAndSumWeightKg } from "@/lib/domains/shipping-calculation";

function item(overrides: Partial<ShippingCalculationLineItem> = {}): ShippingCalculationLineItem {
  return { productId: "1", combinationId: null, quantity: 1, unitWeightKg: 1, ...overrides };
}

test("single product: 10kg x 1 -> total 10", () => {
  const result = validateAndSumWeightKg([item({ unitWeightKg: 10, quantity: 1 })]);
  assert.deepEqual(result, { ok: true, totalWeightKg: 10 });
});

test("quantity: 10kg x 3 -> total 30", () => {
  const result = validateAndSumWeightKg([item({ unitWeightKg: 10, quantity: 3 })]);
  assert.deepEqual(result, { ok: true, totalWeightKg: 30 });
});

test("multiple lines: 10x2 + 2.5x4 -> 30", () => {
  const result = validateAndSumWeightKg([item({ productId: "1", unitWeightKg: 10, quantity: 2 }), item({ productId: "2", unitWeightKg: 2.5, quantity: 4 })]);
  assert.deepEqual(result, { ok: true, totalWeightKg: 30 });
});

test("3-decimal precision survives floating point summation across many lines", () => {
  const items = Array.from({ length: 7 }, (_, i) => item({ productId: String(i), unitWeightKg: 20.123, quantity: 1 }));
  const result = validateAndSumWeightKg(items);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // 20.123 * 7 = 140.861 exactly - naive float summation of 20.123 seven
  // times drifts (140.86099999999999 in IEEE754); the integer-scaled sum
  // must not.
  assert.equal(result.totalWeightKg, 140.861);
});

test("weightKg null fails closed as weight_unavailable, never treated as zero", () => {
  const result = validateAndSumWeightKg([item({ unitWeightKg: null })]);
  assert.deepEqual(result, { ok: false, status: "weight_unavailable", reason: "weight_unavailable:1" });
});

test("weightKg zero is preserved, never rejected or treated as unavailable", () => {
  const result = validateAndSumWeightKg([item({ unitWeightKg: 0, quantity: 3 })]);
  assert.deepEqual(result, { ok: true, totalWeightKg: 0 });
});

test("negative weightKg is a technical error (upstream data inconsistency), never silently clamped", () => {
  const result = validateAndSumWeightKg([item({ unitWeightKg: -1 })]);
  assert.deepEqual(result, { ok: false, status: "technical_error", reason: "invalid_upstream_weight:1" });
});

test("non-finite weightKg is a technical error", () => {
  const result = validateAndSumWeightKg([item({ unitWeightKg: Number.POSITIVE_INFINITY })]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, "technical_error");
});

test("quantity zero is invalid", () => {
  const result = validateAndSumWeightKg([item({ quantity: 0 })]);
  assert.deepEqual(result, { ok: false, status: "invalid_input", reason: "invalid_quantity:1" });
});

test("quantity negative is invalid", () => {
  const result = validateAndSumWeightKg([item({ quantity: -2 })]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, "invalid_input");
});

test("non-integer quantity is invalid", () => {
  const result = validateAndSumWeightKg([item({ quantity: 1.5 })]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, "invalid_input");
});

test("empty items array is invalid", () => {
  const result = validateAndSumWeightKg([]);
  assert.deepEqual(result, { ok: false, status: "invalid_input", reason: "items_required" });
});

test("first invalid line fails closed even when a later line would also fail (no partial totals)", () => {
  const result = validateAndSumWeightKg([item({ productId: "1", unitWeightKg: 10 }), item({ productId: "2", unitWeightKg: null })]);
  assert.deepEqual(result, { ok: false, status: "weight_unavailable", reason: "weight_unavailable:2" });
});
