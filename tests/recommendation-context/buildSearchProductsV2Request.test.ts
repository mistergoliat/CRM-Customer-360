import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchProductsV2Request, toSearchProductsV2ProductIdentity } from "../../lib/brain/commercial/recommendation-context/buildSearchProductsV2Request";
import type { BuildSearchProductsV2RequestInput, BuildSearchProductsV2RequestSkipReason } from "../../lib/brain/commercial/recommendation-context/searchProductsV2RequestTypes";
import type { CustomerRecommendationContext, ProductReference } from "../../lib/brain/commercial/recommendation-context/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function contextFixture(
  overrides: {
    masterCustomerId?: string;
    sourceProduct?: ProductReference | null;
    explicitExcludedProducts?: readonly ProductReference[];
    explicitRepurchaseRequested?: boolean;
    matchingPurchases?: readonly ProductReference[];
    repeatedProducts?: CustomerRecommendationContext["purchaseHistory"]["repeatedProducts"];
  } = {}
): CustomerRecommendationContext {
  return {
    contextVersion: "customer-recommendation-context-v1",
    masterCustomerId: overrides.masterCustomerId ?? "555",
    profileStatus: "available",
    availability: { purchasedProductsAvailable: true, purchaseBehaviorAvailable: true },
    recommendationIntent: {
      sourceProduct: overrides.sourceProduct !== undefined ? overrides.sourceProduct : { productId: 100 },
      explicitExcludedProducts: overrides.explicitExcludedProducts ?? [],
      explicitRepurchaseRequested: overrides.explicitRepurchaseRequested ?? false
    },
    purchaseHistory: { products: [], repeatedProducts: overrides.repeatedProducts ?? [] },
    sourceProductHistory: { productPreviouslyPurchased: false, exactVariantPreviouslyPurchased: false, matchingPurchases: overrides.matchingPurchases ?? [] },
    explicitExclusionHistory: { matches: [] },
    capabilities: { canAssessProductHistory: true, canAssessRepeatBehavior: true, canGenerateGenericRecommendationLater: true },
    warnings: []
  };
}

function minimalInput(overrides: Partial<BuildSearchProductsV2RequestInput> = {}): BuildSearchProductsV2RequestInput {
  return { sourceProduct: { productId: 100 }, ...overrides };
}

function assertSkipped(result: ReturnType<typeof buildSearchProductsV2Request>, reason: BuildSearchProductsV2RequestSkipReason) {
  assert.equal(result.status, "skipped");
  if (result.status === "skipped") assert.equal(result.reason, reason);
}

function assertReady(result: ReturnType<typeof buildSearchProductsV2Request>) {
  assert.equal(result.status, "ready");
  if (result.status !== "ready") throw new Error("expected ready");
  return result;
}

// ---------------------------------------------------------------------------
// toSearchProductsV2ProductIdentity (product identity helper)
// ---------------------------------------------------------------------------

test("toSearchProductsV2ProductIdentity: base product (no combinationId)", () => {
  assert.deepEqual(toSearchProductsV2ProductIdentity({ productId: 10 }), { productId: "10" });
});

test("toSearchProductsV2ProductIdentity: valid variant", () => {
  assert.deepEqual(toSearchProductsV2ProductIdentity({ productId: 10, combinationId: 20 }), { productId: "10", combinationId: "20" });
});

test("toSearchProductsV2ProductIdentity: combinationId=0 is omitted (base product convention)", () => {
  assert.deepEqual(toSearchProductsV2ProductIdentity({ productId: 10, combinationId: 0 }), { productId: "10" });
});

test("toSearchProductsV2ProductIdentity: combinationId undefined is omitted", () => {
  assert.deepEqual(toSearchProductsV2ProductIdentity({ productId: 10, combinationId: undefined }), { productId: "10" });
});

for (const invalidProductId of [0, -1, -10, 1.5, NaN, Infinity, -Infinity]) {
  test(`toSearchProductsV2ProductIdentity: rejects productId ${invalidProductId}`, () => {
    assert.equal(toSearchProductsV2ProductIdentity({ productId: invalidProductId }), null);
  });
}

for (const invalidCombinationId of [-1, -10, 1.5, NaN, Infinity, -Infinity]) {
  test(`toSearchProductsV2ProductIdentity: rejects combinationId ${invalidCombinationId}`, () => {
    assert.equal(toSearchProductsV2ProductIdentity({ productId: 10, combinationId: invalidCombinationId }), null);
  });
}

test("toSearchProductsV2ProductIdentity: never mutates its input", () => {
  const ref = Object.freeze({ productId: 10, combinationId: 20 });
  toSearchProductsV2ProductIdentity(ref);
  assert.deepEqual(ref, { productId: 10, combinationId: 20 });
});

// ---------------------------------------------------------------------------
// Source product
// ---------------------------------------------------------------------------

test("source product: valid base product produces a ready request", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ sourceProduct: { productId: 100 } })));
  assert.deepEqual(result.request.sourceProduct, { productId: "100" });
});

test("source product: valid variant produces a ready request", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ sourceProduct: { productId: 100, combinationId: 5 } })));
  assert.deepEqual(result.request.sourceProduct, { productId: "100", combinationId: "5" });
});

test("source product: absent (both top-level and context) is skipped as source_product_missing", () => {
  assertSkipped(buildSearchProductsV2Request({}), "source_product_missing");
});

for (const invalidSourceProduct of [{ productId: 0 }, { productId: -1 }, { productId: 1.5 }, { productId: NaN }, { productId: 10, combinationId: -1 }, { productId: 10, combinationId: 1.5 }]) {
  test(`source product: invalid identity ${JSON.stringify(invalidSourceProduct)} is skipped as source_product_invalid`, () => {
    assertSkipped(buildSearchProductsV2Request(minimalInput({ sourceProduct: invalidSourceProduct })), "source_product_invalid");
  });
}

test("source product: does not mutate the input object", () => {
  const input = Object.freeze(minimalInput({ sourceProduct: Object.freeze({ productId: 100, combinationId: 5 }) }));
  buildSearchProductsV2Request(input);
  assert.deepEqual(input.sourceProduct, { productId: 100, combinationId: 5 });
});

test("source product: top-level and context agreeing on the same base product produces a ready request", () => {
  const result = assertReady(
    buildSearchProductsV2Request({ sourceProduct: { productId: 100 }, recommendationContext: contextFixture({ sourceProduct: { productId: 100 } }) })
  );
  assert.deepEqual(result.request.sourceProduct, { productId: "100" });
});

test("source product: top-level combinationId=0 and context base product agree (both normalize to the base) and produce a ready request", () => {
  const result = assertReady(
    buildSearchProductsV2Request({ sourceProduct: { productId: 100, combinationId: 0 }, recommendationContext: contextFixture({ sourceProduct: { productId: 100 } }) })
  );
  assert.deepEqual(result.request.sourceProduct, { productId: "100" });
});

test("source product: top-level and context agreeing on the same variant produces a ready request", () => {
  const result = assertReady(
    buildSearchProductsV2Request({ sourceProduct: { productId: 100, combinationId: 5 }, recommendationContext: contextFixture({ sourceProduct: { productId: 100, combinationId: 5 } }) })
  );
  assert.deepEqual(result.request.sourceProduct, { productId: "100", combinationId: "5" });
});

test("source product: different products between top-level and context is skipped as source_product_mismatch", () => {
  assertSkipped(
    buildSearchProductsV2Request({ sourceProduct: { productId: 999 }, recommendationContext: contextFixture({ sourceProduct: { productId: 100 } }) }),
    "source_product_mismatch"
  );
});

test("source product: base (top-level) vs. variant (context) of the same product is skipped as source_product_mismatch", () => {
  assertSkipped(
    buildSearchProductsV2Request({ sourceProduct: { productId: 100 }, recommendationContext: contextFixture({ sourceProduct: { productId: 100, combinationId: 5 } }) }),
    "source_product_mismatch"
  );
});

test("source product: different variants of the same product is skipped as source_product_mismatch", () => {
  assertSkipped(
    buildSearchProductsV2Request({ sourceProduct: { productId: 100, combinationId: 5 }, recommendationContext: contextFixture({ sourceProduct: { productId: 100, combinationId: 9 } }) }),
    "source_product_mismatch"
  );
});

test("source product: top-level invalid and context valid is skipped as source_product_invalid (never falls back to the valid one)", () => {
  assertSkipped(
    buildSearchProductsV2Request({ sourceProduct: { productId: -1 }, recommendationContext: contextFixture({ sourceProduct: { productId: 100 } }) }),
    "source_product_invalid"
  );
});

test("source product: top-level valid and context invalid is skipped as source_product_invalid", () => {
  assertSkipped(
    buildSearchProductsV2Request({ sourceProduct: { productId: 100 }, recommendationContext: contextFixture({ sourceProduct: { productId: -1 } }) }),
    "source_product_invalid"
  );
});

test("source product: a mismatch never builds a request and never mutates either input", () => {
  const topSourceProduct = Object.freeze({ productId: 999 });
  const ctx = contextFixture({ sourceProduct: { productId: 100 } });
  const result = buildSearchProductsV2Request({ sourceProduct: topSourceProduct, recommendationContext: ctx });
  assert.equal(result.status, "skipped");
  assert.equal("request" in result, false);
  assert.deepEqual(topSourceProduct, { productId: 999 });
  assert.deepEqual(ctx.recommendationIntent.sourceProduct, { productId: 100 });
});

// ---------------------------------------------------------------------------
// Customer identity
// ---------------------------------------------------------------------------

test("customer identity: a valid masterCustomerId sets customer.customerId and context.customerId identically", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ masterCustomerId: "555" })));
  assert.equal(result.request.customer?.customerId, "555");
  assert.equal(result.request.context?.customerId, "555");
  assert.equal(result.metadata.customerMode, "identified");
});

test("customer identity: absent masterCustomerId produces a generic request (customer and context.customerId omitted)", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput()));
  assert.equal("customer" in result.request, false);
  assert.equal(result.request.context, undefined);
  assert.equal(result.metadata.customerMode, "generic");
});

test("customer identity: surrounding whitespace is trimmed", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ masterCustomerId: "  555  " })));
  assert.equal(result.request.customer?.customerId, "555");
});

test("customer identity: leading zeros are preserved, never stripped or converted to Number", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ masterCustomerId: "0123" })));
  assert.equal(result.request.customer?.customerId, "0123");
});

for (const invalid of ["", "0", "00", "000", "unknown", "abc123", "a@b.com", "555-1234", "1".repeat(21)]) {
  test(`customer identity: rejects invalid masterCustomerId ${JSON.stringify(invalid)}`, () => {
    assertSkipped(buildSearchProductsV2Request(minimalInput({ masterCustomerId: invalid })), "invalid_customer_identity");
  });
}

test("customer identity: top-level and context agreeing on the same masterCustomerId produces a ready request", () => {
  const result = assertReady(buildSearchProductsV2Request({ sourceProduct: { productId: 100 }, masterCustomerId: "555", recommendationContext: contextFixture({ masterCustomerId: "555" }) }));
  assert.equal(result.request.customer?.customerId, "555");
  assert.equal(result.request.context?.customerId, "555");
});

test("customer identity: top-level and context agreeing after normalization (trim) still produces a ready request", () => {
  const result = assertReady(buildSearchProductsV2Request({ sourceProduct: { productId: 100 }, masterCustomerId: "  555  ", recommendationContext: contextFixture({ masterCustomerId: "555" }) }));
  assert.equal(result.request.customer?.customerId, "555");
});

test("customer identity: different masterCustomerId between top-level and context is skipped as customer_identity_mismatch", () => {
  assertSkipped(
    buildSearchProductsV2Request({ sourceProduct: { productId: 100 }, masterCustomerId: "999", recommendationContext: contextFixture({ masterCustomerId: "555" }) }),
    "customer_identity_mismatch"
  );
});

test("customer identity: top-level invalid and context valid is skipped as invalid_customer_identity (never falls back to the valid one)", () => {
  assertSkipped(
    buildSearchProductsV2Request({ sourceProduct: { productId: 100 }, masterCustomerId: "unknown", recommendationContext: contextFixture({ masterCustomerId: "555" }) }),
    "invalid_customer_identity"
  );
});

test("customer identity: top-level valid and context invalid is skipped as invalid_customer_identity", () => {
  assertSkipped(
    buildSearchProductsV2Request({ sourceProduct: { productId: 100 }, masterCustomerId: "555", recommendationContext: contextFixture({ masterCustomerId: "0" }) }),
    "invalid_customer_identity"
  );
});

test("customer identity: a mismatch never builds a request and never mutates either input", () => {
  const input = Object.freeze({ sourceProduct: { productId: 100 }, masterCustomerId: "999" });
  const ctx = contextFixture({ masterCustomerId: "555" });
  const result = buildSearchProductsV2Request({ ...input, recommendationContext: ctx });
  assert.equal(result.status, "skipped");
  assert.equal("request" in result, false);
  assert.equal(input.masterCustomerId, "999");
  assert.equal(ctx.masterCustomerId, "555");
});

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

test("query: is trimmed", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ query: "  barra olimpica  " })));
  assert.equal(result.request.query, "barra olimpica");
});

test("query: undefined is omitted", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput()));
  assert.equal("query" in result.request, false);
});

test("query: whitespace-only is omitted (not treated as an error)", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ query: "   " })));
  assert.equal("query" in result.request, false);
});

test("query: exactly 240 characters is accepted", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ query: "a".repeat(240) })));
  assert.equal(result.request.query, "a".repeat(240));
});

test("query: 241 characters is rejected", () => {
  assertSkipped(buildSearchProductsV2Request(minimalInput({ query: "a".repeat(241) })), "invalid_query");
});

test("query: internal whitespace is preserved verbatim", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ query: "barra  olimpica" })));
  assert.equal(result.request.query, "barra  olimpica");
});

test("query: never collapses units (e.g. '20 kg' stays '20 kg', never '20kg')", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ query: "20 kg" })));
  assert.equal(result.request.query, "20 kg");
});

test("query: does not mutate the input", () => {
  const input = Object.freeze(minimalInput({ query: "  banca  " }));
  buildSearchProductsV2Request(input);
  assert.equal(input.query, "  banca  ");
});

// ---------------------------------------------------------------------------
// Explicit repurchase
// ---------------------------------------------------------------------------

test("explicit repurchase: false omits explicitRepurchaseProducts", () => {
  const result = assertReady(buildSearchProductsV2Request({ sourceProduct: { productId: 100 }, recommendationContext: contextFixture({ explicitRepurchaseRequested: false }) }));
  assert.equal(result.request.context && "explicitRepurchaseProducts" in result.request.context, false);
  assert.equal(result.metadata.explicitRepurchaseApplied, false);
});

test("explicit repurchase: true with a base source product targets exactly the base product", () => {
  const result = assertReady(buildSearchProductsV2Request({ recommendationContext: contextFixture({ sourceProduct: { productId: 100 }, explicitRepurchaseRequested: true }) }));
  assert.deepEqual(result.request.context?.explicitRepurchaseProducts, [{ productId: "100" }]);
  assert.equal(result.metadata.explicitRepurchaseApplied, true);
});

test("explicit repurchase: true with a variant source product targets exactly that variant", () => {
  const result = assertReady(buildSearchProductsV2Request({ recommendationContext: contextFixture({ sourceProduct: { productId: 100, combinationId: 7 }, explicitRepurchaseRequested: true }) }));
  assert.deepEqual(result.request.context?.explicitRepurchaseProducts, [{ productId: "100", combinationId: "7" }]);
});

test("explicit repurchase: ownership/history signals on the context never activate repurchase by themselves", () => {
  const result = assertReady(
    buildSearchProductsV2Request({
      recommendationContext: contextFixture({
        sourceProduct: { productId: 100 },
        explicitRepurchaseRequested: false,
        matchingPurchases: [{ productId: 100 }],
        repeatedProducts: [{ productId: 100, orderCount: 5, totalQuantityPurchased: 5, daysSinceLastPurchase: 1, spendShare: "1.000000", isRepeated: true }]
      })
    })
  );
  assert.equal(result.request.context && "explicitRepurchaseProducts" in result.request.context, false);
  assert.equal(result.metadata.explicitRepurchaseApplied, false);
});

// ---------------------------------------------------------------------------
// Preferred products (always omitted in v1)
// ---------------------------------------------------------------------------

test("preferred products: never populated, even with rich matchingPurchases/repeated history on the context", () => {
  const result = assertReady(
    buildSearchProductsV2Request({
      masterCustomerId: "555",
      recommendationContext: contextFixture({
        sourceProduct: { productId: 100 },
        matchingPurchases: [{ productId: 100 }, { productId: 200 }],
        repeatedProducts: [{ productId: 300, orderCount: 3, totalQuantityPurchased: 3, daysSinceLastPurchase: 2, spendShare: "0.500000", isRepeated: true }]
      })
    })
  );
  assert.equal(result.request.context && "preferredProducts" in result.request.context, false);
});

// ---------------------------------------------------------------------------
// Exclusions
// ---------------------------------------------------------------------------

test("exclusions: a single base-product exclusion", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ explicitExcludedProducts: [{ productId: 20 }] })));
  assert.deepEqual(result.request.context?.excludedProducts, [{ productId: "20" }]);
  assert.equal(result.metadata.excludedProductCount, 1);
});

test("exclusions: a single variant exclusion", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ explicitExcludedProducts: [{ productId: 20, combinationId: 3 }] })));
  assert.deepEqual(result.request.context?.excludedProducts, [{ productId: "20", combinationId: "3" }]);
});

test("exclusions: exact duplicates are deduplicated", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ explicitExcludedProducts: [{ productId: 20 }, { productId: 20 }] })));
  assert.deepEqual(result.request.context?.excludedProducts, [{ productId: "20" }]);
  assert.equal(result.metadata.excludedProductCount, 1);
});

test("exclusions: base and variant of the same product are never deduplicated against each other", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ explicitExcludedProducts: [{ productId: 20 }, { productId: 20, combinationId: 3 }] })));
  assert.deepEqual(result.request.context?.excludedProducts, [{ productId: "20" }, { productId: "20", combinationId: "3" }]);
  assert.equal(result.metadata.excludedProductCount, 2);
});

test("exclusions: combinationId=0 is normalized to the base product identity before dedup", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ explicitExcludedProducts: [{ productId: 20, combinationId: 0 }, { productId: 20 }] })));
  assert.deepEqual(result.request.context?.excludedProducts, [{ productId: "20" }]);
  assert.equal(result.metadata.excludedProductCount, 1);
});

test("exclusions: an invalid identity fails the whole mapper closed (invalid_excluded_product)", () => {
  assertSkipped(buildSearchProductsV2Request(minimalInput({ explicitExcludedProducts: [{ productId: 20 }, { productId: -1 }] })), "invalid_excluded_product");
});

test("exclusions: first-appearance order is preserved", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ explicitExcludedProducts: [{ productId: 30 }, { productId: 10 }, { productId: 20 }] })));
  assert.deepEqual(result.request.context?.excludedProducts, [{ productId: "30" }, { productId: "10" }, { productId: "20" }]);
});

test("exclusions: merges the context's own list with the top-level list, context first", () => {
  const result = assertReady(
    buildSearchProductsV2Request({
      sourceProduct: { productId: 100 },
      explicitExcludedProducts: [{ productId: 30 }],
      recommendationContext: contextFixture({ sourceProduct: { productId: 100 }, explicitExcludedProducts: [{ productId: 10 }] })
    })
  );
  assert.deepEqual(result.request.context?.excludedProducts, [{ productId: "10" }, { productId: "30" }]);
});

test("exclusions: does not mutate the input array or the context's array", () => {
  const excluded = Object.freeze([Object.freeze({ productId: 20 })]);
  const ctx = contextFixture({ sourceProduct: { productId: 100 }, explicitExcludedProducts: Object.freeze([{ productId: 10 }]) });
  buildSearchProductsV2Request({ sourceProduct: { productId: 100 }, explicitExcludedProducts: excluded, recommendationContext: ctx });
  assert.deepEqual(excluded as unknown, [{ productId: 20 }]);
  assert.deepEqual(ctx.recommendationIntent.explicitExcludedProducts, [{ productId: 10 }]);
});

// ---------------------------------------------------------------------------
// Contradictions
// ---------------------------------------------------------------------------

test("contradictions: source product excluded + explicit repurchase requested is skipped", () => {
  const result = buildSearchProductsV2Request({
    recommendationContext: contextFixture({ sourceProduct: { productId: 100 }, explicitExcludedProducts: [{ productId: 100 }], explicitRepurchaseRequested: true })
  });
  assertSkipped(result, "contradictory_product_context");
});

test("contradictions: excluding the exact same variant being repurchased is skipped", () => {
  const result = buildSearchProductsV2Request({
    recommendationContext: contextFixture({ sourceProduct: { productId: 100, combinationId: 5 }, explicitExcludedProducts: [{ productId: 100, combinationId: 5 }], explicitRepurchaseRequested: true })
  });
  assertSkipped(result, "contradictory_product_context");
});

test("contradictions: excluding the base product while repurchasing a different variant is NOT a contradiction", () => {
  const result = assertReady(
    buildSearchProductsV2Request({
      recommendationContext: contextFixture({ sourceProduct: { productId: 100, combinationId: 5 }, explicitExcludedProducts: [{ productId: 100 }], explicitRepurchaseRequested: true })
    })
  );
  assert.deepEqual(result.request.context?.excludedProducts, [{ productId: "100" }]);
  assert.deepEqual(result.request.context?.explicitRepurchaseProducts, [{ productId: "100", combinationId: "5" }]);
});

test("contradictions: excluding a variant while repurchasing the base product is NOT a contradiction", () => {
  const result = assertReady(
    buildSearchProductsV2Request({
      recommendationContext: contextFixture({ sourceProduct: { productId: 100 }, explicitExcludedProducts: [{ productId: 100, combinationId: 5 }], explicitRepurchaseRequested: true })
    })
  );
  assert.deepEqual(result.request.context?.excludedProducts, [{ productId: "100", combinationId: "5" }]);
  assert.deepEqual(result.request.context?.explicitRepurchaseProducts, [{ productId: "100" }]);
});

test("contradictions: duplicate exclusions never produce an error after dedup", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ explicitExcludedProducts: [{ productId: 20 }, { productId: 20 }, { productId: 20 }] })));
  assert.equal(result.metadata.excludedProductCount, 1);
});

test("contradictions: a customer identity mismatch is caught before the exclusion-vs-repurchase contradiction check ever runs (validation order)", () => {
  // Both a customer mismatch (step 1-2) and, if reached, a product contradiction
  // (step 9) would apply here - the customer mismatch must win per the documented order.
  const result = buildSearchProductsV2Request({
    masterCustomerId: "111",
    recommendationContext: contextFixture({ masterCustomerId: "222", sourceProduct: { productId: 100 }, explicitExcludedProducts: [{ productId: 100 }], explicitRepurchaseRequested: true })
  });
  assertSkipped(result, "customer_identity_mismatch");
});

// ---------------------------------------------------------------------------
// Correlation
// ---------------------------------------------------------------------------

test("correlation: a valid id is placed in callContext, never in the request body", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ correlationId: "corr-abc.123:xyz" })));
  assert.equal(result.callContext.correlationId, "corr-abc.123:xyz");
  assert.equal(JSON.stringify(result.request).includes("corr-abc"), false);
});

test("correlation: is trimmed", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ correlationId: "  corr-1  " })));
  assert.equal(result.callContext.correlationId, "corr-1");
});

test("correlation: absent is omitted from callContext", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput()));
  assert.equal(result.callContext.correlationId, undefined);
});

test("correlation: empty string is rejected", () => {
  assertSkipped(buildSearchProductsV2Request(minimalInput({ correlationId: "   " })), "invalid_correlation_id");
});

test("correlation: longer than 128 characters is rejected", () => {
  assertSkipped(buildSearchProductsV2Request(minimalInput({ correlationId: "a".repeat(129) })), "invalid_correlation_id");
});

test("correlation: invalid characters are rejected", () => {
  assertSkipped(buildSearchProductsV2Request(minimalInput({ correlationId: "corr with spaces" })), "invalid_correlation_id");
});

// ---------------------------------------------------------------------------
// Limit and filters
// ---------------------------------------------------------------------------

test("limit: a valid value is preserved", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ limit: 8 })));
  assert.equal(result.request.limit, 8);
});

test("limit: 0 is rejected", () => {
  assertSkipped(buildSearchProductsV2Request(minimalInput({ limit: 0 })), "invalid_limit");
});

test("limit: 21 is rejected", () => {
  assertSkipped(buildSearchProductsV2Request(minimalInput({ limit: 21 })), "invalid_limit");
});

test("limit: a decimal is rejected", () => {
  assertSkipped(buildSearchProductsV2Request(minimalInput({ limit: 1.5 })), "invalid_limit");
});

test("limit: undefined is omitted, never defaulted", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput()));
  assert.equal("limit" in result.request, false);
});

test("filters: inStockOnly true is preserved", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ inStockOnly: true })));
  assert.deepEqual(result.request.filters, { inStockOnly: true });
});

test("filters: inStockOnly false is preserved", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ inStockOnly: false })));
  assert.deepEqual(result.request.filters, { inStockOnly: false });
});

test("filters: inStockOnly undefined omits filters entirely", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput()));
  assert.equal("filters" in result.request, false);
});

test("filters: never includes productIds", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ inStockOnly: true })));
  assert.equal(result.request.filters && "productIds" in result.request.filters, false);
});

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

test("result: status ready carries request, callContext and metadata", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ masterCustomerId: "555", correlationId: "corr-1" })));
  assert.equal(result.status, "ready");
  assert.ok(result.request);
  assert.ok(result.callContext);
  assert.ok(result.metadata);
});

const SKIP_CASES: ReadonlyArray<[string, BuildSearchProductsV2RequestInput, BuildSearchProductsV2RequestSkipReason]> = [
  ["source missing", {}, "source_product_missing"],
  ["source invalid", { sourceProduct: { productId: -1 } }, "source_product_invalid"],
  ["source mismatch", { sourceProduct: { productId: 1 }, recommendationContext: contextFixture({ sourceProduct: { productId: 2 } }) }, "source_product_mismatch"],
  ["identity invalid", minimalInput({ masterCustomerId: "0" }), "invalid_customer_identity"],
  ["identity mismatch", { sourceProduct: { productId: 100 }, masterCustomerId: "1", recommendationContext: contextFixture({ masterCustomerId: "2" }) }, "customer_identity_mismatch"],
  [
    "contradiction",
    { recommendationContext: contextFixture({ sourceProduct: { productId: 100 }, explicitExcludedProducts: [{ productId: 100 }], explicitRepurchaseRequested: true }) },
    "contradictory_product_context"
  ],
  ["excluded invalid", minimalInput({ explicitExcludedProducts: [{ productId: -1 }] }), "invalid_excluded_product"],
  ["query invalid", minimalInput({ query: "a".repeat(241) }), "invalid_query"],
  ["correlation invalid", minimalInput({ correlationId: "bad id" }), "invalid_correlation_id"],
  ["limit invalid", minimalInput({ limit: 0 }), "invalid_limit"]
];

for (const [label, input, reason] of SKIP_CASES) {
  test(`result: status skipped for ${label} (${reason})`, () => {
    assertSkipped(buildSearchProductsV2Request(input), reason);
  });
}

test("result: customerMode is identified when a valid identity is present", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ masterCustomerId: "555" })));
  assert.equal(result.metadata.customerMode, "identified");
});

test("result: customerMode is generic when no identity is present", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput()));
  assert.equal(result.metadata.customerMode, "generic");
});

test("result: excludedProductCount reflects the deduplicated count", () => {
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ explicitExcludedProducts: [{ productId: 1 }, { productId: 2 }, { productId: 1 }] })));
  assert.equal(result.metadata.excludedProductCount, 2);
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

test("immutability: mutating the input after the call never alters the already-returned result", () => {
  const excludedProducts = [{ productId: 20 }];
  const input: BuildSearchProductsV2RequestInput = { sourceProduct: { productId: 100 }, explicitExcludedProducts: excludedProducts, masterCustomerId: "555" };
  const result = assertReady(buildSearchProductsV2Request(input));
  excludedProducts.push({ productId: 999 });
  input.masterCustomerId = "999";
  assert.deepEqual(result.request.context?.excludedProducts, [{ productId: "20" }]);
  assert.equal(result.request.customer?.customerId, "555");
});

test("immutability: mutating the returned request never alters the input", () => {
  const input = minimalInput({ explicitExcludedProducts: [{ productId: 20 }] });
  const result = assertReady(buildSearchProductsV2Request(input));
  if (Array.isArray(result.request.context?.excludedProducts)) (result.request.context.excludedProducts as unknown[]).push({ productId: "999" });
  assert.deepEqual(input.explicitExcludedProducts, [{ productId: 20 }]);
});

test("immutability: the request's excludedProducts array is a fresh object, not a reference into the input array", () => {
  const excludedProducts = [{ productId: 20 }];
  const result = assertReady(buildSearchProductsV2Request(minimalInput({ explicitExcludedProducts: excludedProducts })));
  assert.notEqual(result.request.context?.excludedProducts, excludedProducts as unknown);
});
