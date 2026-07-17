import assert from "node:assert/strict";
import test from "node:test";
import { rankCatalogCandidatesByBudget } from "../../lib/brain/commercial/native-cycle/rankCatalogCandidatesByBudget";
import type { CatalogProduct } from "../../lib/catalog";

function makeProduct(overrides: Partial<CatalogProduct> & { productId: string; amount: number | null; currency?: string | null }): CatalogProduct {
  return {
    productId: overrides.productId,
    name: overrides.name ?? `Producto ${overrides.productId}`,
    sku: null,
    shortDescription: null,
    longDescription: null,
    active: true,
    selectedVariant: overrides.selectedVariant ?? null,
    variants: [],
    price: overrides.amount === null ? null : { amount: overrides.amount, currency: overrides.currency ?? "CLP", taxIncluded: true, discountApplied: false },
    availability: overrides.availability ?? "in_stock",
    stockQuantity: overrides.stockQuantity ?? 5,
    provenance: { source: "catalog_service_http", retrievedAt: "2026-07-17T00:00:00.000Z", cached: false }
  };
}

test("ACS-R1-05-T06.2: no candidates with a usable price returns no_candidates", () => {
  const result = rankCatalogCandidatesByBudget([makeProduct({ productId: "1", amount: null })], 800000);
  assert.equal(result.mode, "no_candidates");
  assert.equal(result.picks.length, 0);
});

test("no budget known: ranks by availability only, up to 3 picks, tier 'relevant'", () => {
  const products = [
    makeProduct({ productId: "1", amount: 100000, availability: "out_of_stock" }),
    makeProduct({ productId: "2", amount: 200000, availability: "in_stock" }),
    makeProduct({ productId: "3", amount: 300000, availability: "in_stock" }),
    makeProduct({ productId: "4", amount: 400000, availability: "in_stock" })
  ];
  const result = rankCatalogCandidatesByBudget(products, null);
  assert.equal(result.mode, "relevance");
  assert.equal(result.picks.length, 3);
  assert.ok(result.picks.every((pick) => pick.tier === "relevant"));
  assert.ok(!result.picks.some((pick) => pick.product.productId === "1"), "out_of_stock item is deprioritized below the top-3 in_stock items");
});

test("all candidates under budget: economy + near_budget + a distinct alternative, no product repeated", () => {
  const products = [
    makeProduct({ productId: "econ", amount: 300000 }),
    makeProduct({ productId: "mid", amount: 700000 }),
    makeProduct({ productId: "near", amount: 780000 })
  ];
  const result = rankCatalogCandidatesByBudget(products, 800000);
  assert.equal(result.mode, "all_under_budget");
  assert.equal(result.picks.length, 3);
  assert.equal(result.picks.find((p) => p.tier === "economy")?.product.productId, "econ");
  assert.equal(result.picks.find((p) => p.tier === "near_budget")?.product.productId, "near");
  assert.equal(result.picks.find((p) => p.tier === "alternative")?.product.productId, "mid");
  const ids = result.picks.map((p) => p.product.productId);
  assert.equal(new Set(ids).size, ids.length, "no product should occupy two tiers");
});

test("mixed budget: economy + near_budget under budget, stretch is the cheapest over-budget option", () => {
  const products = [
    makeProduct({ productId: "econ", amount: 300000 }),
    makeProduct({ productId: "near", amount: 780000 }),
    makeProduct({ productId: "stretch-cheap", amount: 850000 }),
    makeProduct({ productId: "stretch-expensive", amount: 1200000 })
  ];
  const result = rankCatalogCandidatesByBudget(products, 800000);
  assert.equal(result.mode, "mixed");
  assert.equal(result.picks.find((p) => p.tier === "economy")?.product.productId, "econ");
  assert.equal(result.picks.find((p) => p.tier === "near_budget")?.product.productId, "near");
  assert.equal(result.picks.find((p) => p.tier === "stretch")?.product.productId, "stretch-cheap");
});

test("all candidates over budget: declares closest alternatives as stretch, never claims within range", () => {
  const products = [
    makeProduct({ productId: "far", amount: 2000000 }),
    makeProduct({ productId: "closest", amount: 900000 }),
    makeProduct({ productId: "mid", amount: 1200000 })
  ];
  const result = rankCatalogCandidatesByBudget(products, 800000);
  assert.equal(result.mode, "all_over_budget");
  assert.ok(result.picks.every((pick) => pick.tier === "stretch"));
  assert.equal(result.picks[0].product.productId, "closest", "cheapest over-budget option ranks first");
});

test("a single under-budget candidate yields economy only, no fabricated near_budget/alternative", () => {
  const result = rankCatalogCandidatesByBudget([makeProduct({ productId: "only", amount: 300000 })], 800000);
  assert.equal(result.mode, "all_under_budget");
  assert.equal(result.picks.length, 1);
  assert.equal(result.picks[0].tier, "economy");
});

test("excludes candidates without a usable price from budget comparisons", () => {
  const products = [
    makeProduct({ productId: "priced", amount: 500000 }),
    makeProduct({ productId: "unpriced", amount: null })
  ];
  const result = rankCatalogCandidatesByBudget(products, 800000);
  assert.equal(result.picks.every((pick) => pick.product.productId !== "unpriced"), true);
});

// ACS-R1-05-T06.2 (P2 correction): invalid-price exclusion. Only null,
// undefined, NaN, Infinity and negative amounts are invalid - price 0 is a
// legitimate priced-at-zero catalog item (ADR-005: unknown price is `null`,
// never `0`) and must stay usable.

function makeRawProduct(amount: unknown, productId = "raw"): CatalogProduct {
  const base = makeProduct({ productId, amount: 100000 });
  return { ...base, price: { ...base.price!, amount: amount as number } };
}

test("excludes a negative price", () => {
  const result = rankCatalogCandidatesByBudget([makeRawProduct(-500, "negative")], 800000);
  assert.equal(result.mode, "no_candidates");
  assert.equal(result.picks.some((pick) => pick.product.productId === "negative"), false);
});

test("excludes a NaN price", () => {
  const result = rankCatalogCandidatesByBudget([makeRawProduct(Number.NaN, "nan")], 800000);
  assert.equal(result.mode, "no_candidates");
});

test("excludes an Infinity price", () => {
  const result = rankCatalogCandidatesByBudget([makeRawProduct(Number.POSITIVE_INFINITY, "infinity")], 800000);
  assert.equal(result.mode, "no_candidates");
});

test("excludes a negative-Infinity price", () => {
  const result = rankCatalogCandidatesByBudget([makeRawProduct(Number.NEGATIVE_INFINITY, "neg-infinity")], 800000);
  assert.equal(result.mode, "no_candidates");
});

test("excludes an undefined price amount", () => {
  const result = rankCatalogCandidatesByBudget([makeRawProduct(undefined, "undefined-amount")], 800000);
  assert.equal(result.mode, "no_candidates");
});

test("excludes a null price amount (already covered structurally, kept for the required matrix)", () => {
  const result = rankCatalogCandidatesByBudget([makeProduct({ productId: "null-amount", amount: null })], 800000);
  assert.equal(result.mode, "no_candidates");
});

test("excludes a non-numeric string price amount", () => {
  const result = rankCatalogCandidatesByBudget([makeRawProduct("not-a-number", "string-amount")], 800000);
  assert.equal(result.mode, "no_candidates");
});

test("a zero price is a legitimate usable price, never excluded", () => {
  const result = rankCatalogCandidatesByBudget([makeProduct({ productId: "free", amount: 0 })], 800000);
  assert.equal(result.mode, "all_under_budget");
  assert.equal(result.picks.length, 1);
  assert.equal(result.picks[0].product.productId, "free");
  assert.equal(result.picks[0].effectiveUnitPrice, 0);
});

test("invalid candidates never appear alongside valid ones in any tier", () => {
  const products = [
    makeProduct({ productId: "valid-economy", amount: 300000 }),
    makeProduct({ productId: "valid-near", amount: 780000 }),
    makeRawProduct(-100, "invalid-negative"),
    makeRawProduct(Number.NaN, "invalid-nan"),
    makeRawProduct("garbage", "invalid-string")
  ];
  const result = rankCatalogCandidatesByBudget(products, 800000);
  const ids = result.picks.map((pick) => pick.product.productId);
  assert.ok(!ids.includes("invalid-negative"));
  assert.ok(!ids.includes("invalid-nan"));
  assert.ok(!ids.includes("invalid-string"));
});
