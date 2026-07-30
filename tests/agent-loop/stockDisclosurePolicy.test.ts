import assert from "node:assert/strict";
import test from "node:test";
import { describeStockDisclosure } from "@/lib/brain/commercial/agent-loop/stockDisclosurePolicy";

test("ACS-R1-05.1-T02.6.2: stock=0 reports no stock available", () => {
  assert.equal(describeStockDisclosure(0), "Sin stock disponible.");
});

test("stock=1 uses the singular form", () => {
  assert.equal(describeStockDisclosure(1), "Queda 1 unidad disponible.");
});

test("stock=2 uses the plural form", () => {
  assert.equal(describeStockDisclosure(2), "Quedan 2 unidades disponibles.");
});

test("stock=19 (upper edge of the low bucket) discloses the exact count", () => {
  assert.equal(describeStockDisclosure(19), "Quedan 19 unidades disponibles.");
});

test("stock=20 (lower edge of the bounded bucket) never shows 20, shows the bounded phrase", () => {
  const result = describeStockDisclosure(20);
  assert.equal(result, "Hay más de 20 unidades disponibles.");
  assert.doesNotMatch(result, /\b20\b(?!.*disponibles)/);
});

test("stock=99 never shows 99, shows the bounded phrase", () => {
  const result = describeStockDisclosure(99);
  assert.equal(result, "Hay más de 20 unidades disponibles.");
  assert.doesNotMatch(result, /99/);
});

test("stock=100 (inclusive upper edge of the bounded bucket) never shows 100, shows the bounded phrase", () => {
  const result = describeStockDisclosure(100);
  assert.equal(result, "Hay más de 20 unidades disponibles.");
  assert.doesNotMatch(result, /100/);
});

test("stock=101 (just above the bounded bucket) never shows 101, shows the abundant phrase", () => {
  const result = describeStockDisclosure(101);
  assert.equal(result, "Hay stock disponible.");
  assert.doesNotMatch(result, /101/);
});

test("stock=47171 never exposes the raw internal number", () => {
  const result = describeStockDisclosure(47171);
  assert.equal(result, "Hay stock disponible.");
  assert.doesNotMatch(result, /47171/);
});

test("negative stock is treated the same as zero (no stock available)", () => {
  assert.equal(describeStockDisclosure(-1), "Sin stock disponible.");
});
