import assert from "node:assert/strict";
import test from "node:test";
import { buildCustomerRecommendationContext } from "../../lib/brain/commercial/recommendation-context/buildCustomerRecommendationContext";
import { CustomerRecommendationContextInputError } from "../../lib/brain/commercial/recommendation-context/types";
import type { CustomerProfileLookupResult, GetPurchaseBehaviorData, GetPurchasedProductsData, PurchaseBehaviorProduct, PurchasedProductItem } from "../../lib/customer-profile/types";
import type { BuildCustomerRecommendationContextInput, ProductReference } from "../../lib/brain/commercial/recommendation-context/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function purchasedItem(overrides: Partial<PurchasedProductItem> = {}): PurchasedProductItem {
  return {
    productId: 100,
    productAttributeId: 0,
    productName: "Disco olimpico 20kg",
    productReference: "DISC20",
    totalQuantityPurchased: 2,
    orderCount: 1,
    firstPurchasedAt: "2026-01-01T00:00:00.000Z",
    lastPurchasedAt: "2026-01-05T00:00:00.000Z",
    totalSpentTaxIncl: "50000.000000",
    catalogStatus: "linked",
    ...overrides
  };
}

function behaviorProduct(overrides: Partial<PurchaseBehaviorProduct> = {}): PurchaseBehaviorProduct {
  return {
    productId: 100,
    latestObservedProductName: "Disco olimpico 20kg",
    latestObservedProductReference: "DISC20",
    variantCountPurchased: 1,
    repeatedVariantCount: 1,
    orderCount: 2,
    totalQuantityPurchased: 4,
    totalSpentTaxIncl: "50000.000000",
    spendShare: "0.500000",
    orderShare: "0.500000",
    quantityShare: "0.500000",
    firstPurchasedAt: "2026-01-01T00:00:00.000Z",
    lastPurchasedAt: "2026-01-05T00:00:00.000Z",
    daysSinceLastPurchase: 10,
    isRepeated: true,
    ...overrides
  };
}

function purchasedProductsData(overrides: Partial<GetPurchasedProductsData> = {}): GetPurchasedProductsData {
  return {
    products: [purchasedItem()],
    pagination: { limit: 20, offset: 0, returned: 1, hasMore: false },
    ...overrides
  };
}

const CONCENTRATION = { top1Share: "1.000000", top3Share: "1.000000", hhi: "1.000000", effectiveDiversity: "1.000000" };

function purchaseBehaviorData(overrides: Partial<GetPurchaseBehaviorData> = {}): GetPurchaseBehaviorData {
  return {
    currencyIsoCode: "CLP",
    calculatedAt: "2026-01-10T00:00:00.000Z",
    summary: {
      validOrderCount: 2,
      distinctProductCount: 1,
      distinctVariantCount: 1,
      repeatedProductCount: 1,
      repeatedVariantCount: 1,
      repeatProductRate: "1.000000",
      repeatVariantRate: "1.000000",
      repeatedVariantSpendShare: "1.000000",
      productSpendConcentration: CONCENTRATION,
      variantSpendConcentration: CONCENTRATION
    },
    topProducts: [behaviorProduct()],
    topVariants: [],
    ...overrides
  };
}

function available<T>(data: T): CustomerProfileLookupResult<T> {
  return { status: "available", data };
}
const NOT_FOUND: CustomerProfileLookupResult<never> = { status: "customer_not_found" };
const NOT_LINKED: CustomerProfileLookupResult<never> = { status: "customer_not_linked" };
const DEGRADED: CustomerProfileLookupResult<never> = { status: "degraded", reason: "prestashop_unavailable", retryable: true };
const FAILED: CustomerProfileLookupResult<never> = { status: "failed", code: "upstream_error", retryable: true };

function baseInput(overrides: Partial<BuildCustomerRecommendationContextInput> = {}): BuildCustomerRecommendationContextInput {
  return {
    masterCustomerId: "1",
    purchasedProductsResult: available(purchasedProductsData()),
    purchaseBehaviorResult: available(purchaseBehaviorData()),
    recommendationIntent: {
      sourceProduct: null,
      explicitExcludedProducts: [],
      explicitRepurchaseRequested: false
    },
    ...overrides
  };
}

function assertInputError(fn: () => unknown, code: string) {
  assert.throws(fn, (error: unknown) => error instanceof CustomerRecommendationContextInputError && error.code === code);
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

test("both available -> profileStatus available, both capabilities true", () => {
  const result = buildCustomerRecommendationContext(baseInput());
  assert.equal(result.profileStatus, "available");
  assert.equal(result.capabilities.canAssessProductHistory, true);
  assert.equal(result.capabilities.canAssessRepeatBehavior, true);
  assert.deepEqual(result.warnings, []);
});

test("T08 available + T09 degraded -> partial, evidence from T08 kept", () => {
  const result = buildCustomerRecommendationContext(baseInput({ purchaseBehaviorResult: DEGRADED }));
  assert.equal(result.profileStatus, "partial");
  assert.equal(result.availability.purchasedProductsAvailable, true);
  assert.equal(result.availability.purchaseBehaviorAvailable, false);
  assert.equal(result.purchaseHistory.products.length, 1);
  assert.deepEqual(result.purchaseHistory.repeatedProducts, []);
  assert.ok(result.warnings.includes("purchase_behavior_degraded"));
  assert.ok(result.warnings.includes("partial_customer_profile"));
});

test("T08 degraded + T09 available -> partial, evidence from T09 kept", () => {
  const result = buildCustomerRecommendationContext(baseInput({ purchasedProductsResult: DEGRADED }));
  assert.equal(result.profileStatus, "partial");
  assert.deepEqual(result.purchaseHistory.products, []);
  assert.equal(result.purchaseHistory.repeatedProducts.length, 1);
  assert.ok(result.warnings.includes("purchased_products_degraded"));
  assert.ok(result.warnings.includes("partial_customer_profile"));
});

test("both customer_not_found -> profileStatus customer_not_found", () => {
  const result = buildCustomerRecommendationContext(baseInput({ purchasedProductsResult: NOT_FOUND, purchaseBehaviorResult: NOT_FOUND }));
  assert.equal(result.profileStatus, "customer_not_found");
  assert.deepEqual(result.warnings, ["customer_profile_not_found"]);
});

test("both customer_not_linked -> profileStatus customer_not_linked", () => {
  const result = buildCustomerRecommendationContext(baseInput({ purchasedProductsResult: NOT_LINKED, purchaseBehaviorResult: NOT_LINKED }));
  assert.equal(result.profileStatus, "customer_not_linked");
  assert.deepEqual(result.warnings, ["customer_profile_not_linked"]);
});

test("both degraded -> profileStatus degraded", () => {
  const result = buildCustomerRecommendationContext(baseInput({ purchasedProductsResult: DEGRADED, purchaseBehaviorResult: DEGRADED }));
  assert.equal(result.profileStatus, "degraded");
  assert.deepEqual(result.warnings, ["purchased_products_degraded", "purchase_behavior_degraded"]);
});

test("both failed -> profileStatus failed", () => {
  const result = buildCustomerRecommendationContext(baseInput({ purchasedProductsResult: FAILED, purchaseBehaviorResult: FAILED }));
  assert.equal(result.profileStatus, "failed");
  assert.deepEqual(result.warnings, ["purchased_products_failed", "purchase_behavior_failed"]);
});

test("incompatible non-available statuses resolve by precedence and flag inconsistency", () => {
  const result = buildCustomerRecommendationContext(baseInput({ purchasedProductsResult: DEGRADED, purchaseBehaviorResult: NOT_LINKED }));
  assert.equal(result.profileStatus, "customer_not_linked");
  assert.ok(result.warnings.includes("inconsistent_customer_profile_status"));
  assert.ok(result.warnings.includes("customer_profile_not_linked"));
  assert.ok(result.warnings.includes("purchased_products_degraded"));
});

test("precedence order: not_found beats not_linked, degraded and failed", () => {
  assert.equal(buildCustomerRecommendationContext(baseInput({ purchasedProductsResult: NOT_FOUND, purchaseBehaviorResult: FAILED })).profileStatus, "customer_not_found");
  assert.equal(buildCustomerRecommendationContext(baseInput({ purchasedProductsResult: NOT_LINKED, purchaseBehaviorResult: FAILED })).profileStatus, "customer_not_linked");
  assert.equal(buildCustomerRecommendationContext(baseInput({ purchasedProductsResult: DEGRADED, purchaseBehaviorResult: FAILED })).profileStatus, "degraded");
});

test("generic recommendation capability is always enabled regardless of profile state", () => {
  const scenarios = [baseInput(), baseInput({ purchasedProductsResult: FAILED, purchaseBehaviorResult: FAILED }), baseInput({ purchasedProductsResult: NOT_FOUND, purchaseBehaviorResult: DEGRADED })];
  for (const scenario of scenarios) {
    assert.equal(buildCustomerRecommendationContext(scenario).capabilities.canGenerateGenericRecommendationLater, true);
  }
});

// ---------------------------------------------------------------------------
// Historial
// ---------------------------------------------------------------------------

test("real empty purchase history adds no_purchase_history", () => {
  const result = buildCustomerRecommendationContext(
    baseInput({ purchasedProductsResult: available(purchasedProductsData({ products: [] })), purchaseBehaviorResult: available(purchaseBehaviorData({ topProducts: [] })) })
  );
  assert.deepEqual(result.purchaseHistory.products, []);
  assert.ok(result.warnings.includes("no_purchase_history"));
});

test("single product evidence excludes productName/productReference", () => {
  const result = buildCustomerRecommendationContext(baseInput());
  const [evidence] = result.purchaseHistory.products;
  assert.deepEqual(evidence, {
    productId: 100,
    productAttributeId: 0,
    totalQuantityPurchased: 2,
    orderCount: 1,
    firstPurchasedAt: "2026-01-01T00:00:00.000Z",
    lastPurchasedAt: "2026-01-05T00:00:00.000Z",
    totalSpentTaxIncl: "50000.000000",
    catalogStatus: "linked"
  });
  assert.equal("productName" in evidence, false);
  assert.equal("productReference" in evidence, false);
});

test("multiple distinct products are all preserved", () => {
  const result = buildCustomerRecommendationContext(
    baseInput({ purchasedProductsResult: available(purchasedProductsData({ products: [purchasedItem({ productId: 3 }), purchasedItem({ productId: 1 }), purchasedItem({ productId: 2 })] })) })
  );
  // all three share the same lastPurchasedAt, so the tie-break (productId asc) determines order
  assert.deepEqual(
    result.purchaseHistory.products.map((p) => p.productId),
    [1, 2, 3]
  );
});

test("multiple variants of the same product are all preserved", () => {
  const result = buildCustomerRecommendationContext(
    baseInput({
      purchasedProductsResult: available(purchasedProductsData({ products: [purchasedItem({ productAttributeId: 0 }), purchasedItem({ productAttributeId: 5 })] }))
    })
  );
  assert.deepEqual(
    result.purchaseHistory.products.map((p) => p.productAttributeId),
    [0, 5]
  );
});

test("decimal amount strings are preserved exactly, never coerced to number", () => {
  const result = buildCustomerRecommendationContext(
    baseInput({ purchasedProductsResult: available(purchasedProductsData({ products: [purchasedItem({ totalSpentTaxIncl: "99990.123456" })] })) })
  );
  assert.equal(result.purchaseHistory.products[0].totalSpentTaxIncl, "99990.123456");
  assert.equal(typeof result.purchaseHistory.products[0].totalSpentTaxIncl, "string");
});

test("a deleted_or_unavailable product is preserved and flagged with a warning", () => {
  const result = buildCustomerRecommendationContext(
    baseInput({ purchasedProductsResult: available(purchasedProductsData({ products: [purchasedItem({ catalogStatus: "deleted_or_unavailable" })] })) })
  );
  assert.equal(result.purchaseHistory.products[0].catalogStatus, "deleted_or_unavailable");
  assert.ok(result.warnings.includes("purchased_product_deleted_or_unavailable"));
});

test("purchase history is sorted by lastPurchasedAt desc, then productId asc, then productAttributeId asc", () => {
  const products = [
    purchasedItem({ productId: 2, productAttributeId: 0, lastPurchasedAt: "2026-01-01T00:00:00.000Z" }),
    purchasedItem({ productId: 1, productAttributeId: 1, lastPurchasedAt: "2026-01-10T00:00:00.000Z" }),
    purchasedItem({ productId: 1, productAttributeId: 0, lastPurchasedAt: "2026-01-10T00:00:00.000Z" })
  ];
  const result = buildCustomerRecommendationContext(baseInput({ purchasedProductsResult: available(purchasedProductsData({ products })) }));
  assert.deepEqual(
    result.purchaseHistory.products.map((p) => [p.productId, p.productAttributeId]),
    [
      [1, 0],
      [1, 1],
      [2, 0]
    ]
  );
});

test("input arrays are never mutated", () => {
  const products = Object.freeze([purchasedItem({ productId: 2 }), purchasedItem({ productId: 1 })]);
  const topProducts = Object.freeze([behaviorProduct({ productId: 2 }), behaviorProduct({ productId: 1 })]);
  const excluded = Object.freeze([{ productId: 5 }, { productId: 4 }]);
  assert.doesNotThrow(() =>
    buildCustomerRecommendationContext(
      baseInput({
        purchasedProductsResult: available(purchasedProductsData({ products: products as unknown as PurchasedProductItem[] })),
        purchaseBehaviorResult: available(purchaseBehaviorData({ topProducts: topProducts as unknown as PurchaseBehaviorProduct[] })),
        recommendationIntent: { sourceProduct: null, explicitExcludedProducts: excluded as unknown as ProductReference[], explicitRepurchaseRequested: false }
      })
    )
  );
  assert.equal(products[0].productId, 2);
  assert.equal(topProducts[0].productId, 2);
  assert.equal(excluded[0].productId, 5);
});

test("identical duplicate purchase rows are deduplicated", () => {
  const result = buildCustomerRecommendationContext(
    baseInput({ purchasedProductsResult: available(purchasedProductsData({ products: [purchasedItem(), purchasedItem()] })) })
  );
  assert.equal(result.purchaseHistory.products.length, 1);
});

test("conflicting duplicate purchase rows are rejected", () => {
  const products = [purchasedItem({ orderCount: 1 }), purchasedItem({ orderCount: 2 })];
  assertInputError(() => buildCustomerRecommendationContext(baseInput({ purchasedProductsResult: available(purchasedProductsData({ products })) })), "conflicting_purchase_evidence");
});

// ---------------------------------------------------------------------------
// Repeticion
// ---------------------------------------------------------------------------

test("isRepeated true products are included", () => {
  const result = buildCustomerRecommendationContext(baseInput());
  assert.equal(result.purchaseHistory.repeatedProducts.length, 1);
  assert.equal(result.purchaseHistory.repeatedProducts[0].isRepeated, true);
});

test("isRepeated false products are excluded", () => {
  const result = buildCustomerRecommendationContext(
    baseInput({ purchaseBehaviorResult: available(purchaseBehaviorData({ topProducts: [behaviorProduct({ isRepeated: false })] })) })
  );
  assert.deepEqual(result.purchaseHistory.repeatedProducts, []);
});

test("topVariants is never used as a substitute for topProducts", () => {
  const result = buildCustomerRecommendationContext(
    baseInput({
      purchaseBehaviorResult: available(
        purchaseBehaviorData({
          topProducts: [],
          topVariants: [
            {
              productId: 100,
              productAttributeId: 0,
              productName: "x",
              productReference: null,
              orderCount: 3,
              totalQuantityPurchased: 3,
              totalSpentTaxIncl: "1.000000",
              spendShare: "1.000000",
              orderShare: "1.000000",
              quantityShare: "1.000000",
              firstPurchasedAt: "2026-01-01T00:00:00.000Z",
              lastPurchasedAt: "2026-01-01T00:00:00.000Z",
              daysSinceLastPurchase: 1,
              isRepeated: true
            }
          ]
        })
      )
    })
  );
  assert.deepEqual(result.purchaseHistory.repeatedProducts, []);
});

test("repeated products are sorted by daysSinceLastPurchase asc, orderCount desc, productId asc", () => {
  const topProducts = [
    behaviorProduct({ productId: 3, daysSinceLastPurchase: 5, orderCount: 1 }),
    behaviorProduct({ productId: 1, daysSinceLastPurchase: 5, orderCount: 3 }),
    behaviorProduct({ productId: 2, daysSinceLastPurchase: 1, orderCount: 1 })
  ];
  const result = buildCustomerRecommendationContext(baseInput({ purchaseBehaviorResult: available(purchaseBehaviorData({ topProducts })) }));
  assert.deepEqual(
    result.purchaseHistory.repeatedProducts.map((p) => p.productId),
    [2, 1, 3]
  );
});

test("identical duplicate repeated-product rows are deduplicated", () => {
  const result = buildCustomerRecommendationContext(
    baseInput({ purchaseBehaviorResult: available(purchaseBehaviorData({ topProducts: [behaviorProduct(), behaviorProduct()] })) })
  );
  assert.equal(result.purchaseHistory.repeatedProducts.length, 1);
});

test("conflicting duplicate repeated-product rows are rejected", () => {
  const topProducts = [behaviorProduct({ orderCount: 1 }), behaviorProduct({ orderCount: 9 })];
  assertInputError(() => buildCustomerRecommendationContext(baseInput({ purchaseBehaviorResult: available(purchaseBehaviorData({ topProducts })) })), "invalid_repeated_product_evidence");
});

// ---------------------------------------------------------------------------
// Producto fuente
// ---------------------------------------------------------------------------

test("null sourceProduct yields no history match", () => {
  const result = buildCustomerRecommendationContext(baseInput());
  assert.deepEqual(result.sourceProductHistory, { productPreviouslyPurchased: false, exactVariantPreviouslyPurchased: false, matchingPurchases: [] });
});

test("a source product never purchased is reported as such", () => {
  const result = buildCustomerRecommendationContext(baseInput({ recommendationIntent: { sourceProduct: { productId: 999 }, explicitExcludedProducts: [], explicitRepurchaseRequested: false } }));
  assert.equal(result.sourceProductHistory.productPreviouslyPurchased, false);
  assert.equal(result.sourceProductHistory.exactVariantPreviouslyPurchased, false);
  assert.deepEqual(result.sourceProductHistory.matchingPurchases, []);
  assert.equal(result.warnings.includes("source_product_previously_purchased"), false);
});

test("a purchased source product without a combinationId is flagged, not as an exact variant", () => {
  const result = buildCustomerRecommendationContext(baseInput({ recommendationIntent: { sourceProduct: { productId: 100 }, explicitExcludedProducts: [], explicitRepurchaseRequested: false } }));
  assert.equal(result.sourceProductHistory.productPreviouslyPurchased, true);
  assert.equal(result.sourceProductHistory.exactVariantPreviouslyPurchased, false);
  assert.ok(result.warnings.includes("source_product_previously_purchased"));
  assert.equal(result.warnings.includes("source_variant_previously_purchased"), false);
});

test("an exact variant match sets both flags and returns the matching reference", () => {
  const result = buildCustomerRecommendationContext(
    baseInput({ recommendationIntent: { sourceProduct: { productId: 100, combinationId: 0 }, explicitExcludedProducts: [], explicitRepurchaseRequested: false } })
  );
  assert.equal(result.sourceProductHistory.productPreviouslyPurchased, true);
  assert.equal(result.sourceProductHistory.exactVariantPreviouslyPurchased, true);
  assert.deepEqual(result.sourceProductHistory.matchingPurchases, [{ productId: 100, combinationId: 0 }]);
  assert.ok(result.warnings.includes("source_variant_previously_purchased"));
});

test("same product, different variant: product flag true, exact variant flag false", () => {
  const result = buildCustomerRecommendationContext(
    baseInput({ recommendationIntent: { sourceProduct: { productId: 100, combinationId: 7 }, explicitExcludedProducts: [], explicitRepurchaseRequested: false } })
  );
  assert.equal(result.sourceProductHistory.productPreviouslyPurchased, true);
  assert.equal(result.sourceProductHistory.exactVariantPreviouslyPurchased, false);
});

test("multiple historical variants are all returned in matchingPurchases, deduplicated and sorted", () => {
  const products = [purchasedItem({ productAttributeId: 5 }), purchasedItem({ productAttributeId: 0 }), purchasedItem({ productAttributeId: 5 })];
  const result = buildCustomerRecommendationContext(
    baseInput({
      purchasedProductsResult: available(purchasedProductsData({ products })),
      recommendationIntent: { sourceProduct: { productId: 100 }, explicitExcludedProducts: [], explicitRepurchaseRequested: false }
    })
  );
  assert.deepEqual(result.sourceProductHistory.matchingPurchases, [
    { productId: 100, combinationId: 0 },
    { productId: 100, combinationId: 5 }
  ]);
});

// ---------------------------------------------------------------------------
// Exclusiones explicitas
// ---------------------------------------------------------------------------

test("empty exclusions produce empty output and no matches", () => {
  const result = buildCustomerRecommendationContext(baseInput());
  assert.deepEqual(result.recommendationIntent.explicitExcludedProducts, []);
  assert.deepEqual(result.explicitExclusionHistory.matches, []);
});

test("a product-only exclusion is preserved", () => {
  const result = buildCustomerRecommendationContext(baseInput({ recommendationIntent: { sourceProduct: null, explicitExcludedProducts: [{ productId: 55 }], explicitRepurchaseRequested: false } }));
  assert.deepEqual(result.recommendationIntent.explicitExcludedProducts, [{ productId: 55 }]);
});

test("a product+variant exclusion is preserved", () => {
  const result = buildCustomerRecommendationContext(
    baseInput({ recommendationIntent: { sourceProduct: null, explicitExcludedProducts: [{ productId: 55, combinationId: 3 }], explicitRepurchaseRequested: false } })
  );
  assert.deepEqual(result.recommendationIntent.explicitExcludedProducts, [{ productId: 55, combinationId: 3 }]);
});

test("duplicate exclusions are deduplicated", () => {
  const result = buildCustomerRecommendationContext(
    baseInput({ recommendationIntent: { sourceProduct: null, explicitExcludedProducts: [{ productId: 55 }, { productId: 55 }], explicitRepurchaseRequested: false } })
  );
  assert.deepEqual(result.recommendationIntent.explicitExcludedProducts, [{ productId: 55 }]);
});

test("exclusions are sorted by productId asc, then combinationId absent-first ascending", () => {
  const explicitExcludedProducts = [{ productId: 2, combinationId: 1 }, { productId: 1, combinationId: 9 }, { productId: 1 }, { productId: 2 }];
  const result = buildCustomerRecommendationContext(baseInput({ recommendationIntent: { sourceProduct: null, explicitExcludedProducts, explicitRepurchaseRequested: false } }));
  assert.deepEqual(result.recommendationIntent.explicitExcludedProducts, [{ productId: 1 }, { productId: 1, combinationId: 9 }, { productId: 2 }, { productId: 2, combinationId: 1 }]);
});

test("an exclusion matching purchase history is reported in explicitExclusionHistory.matches", () => {
  const result = buildCustomerRecommendationContext(
    baseInput({ recommendationIntent: { sourceProduct: null, explicitExcludedProducts: [{ productId: 100 }, { productId: 777 }], explicitRepurchaseRequested: false } })
  );
  assert.deepEqual(result.explicitExclusionHistory.matches, [{ productId: 100 }]);
});

test("matching history never adds a new entry to explicitExcludedProducts", () => {
  const result = buildCustomerRecommendationContext(baseInput({ recommendationIntent: { sourceProduct: null, explicitExcludedProducts: [], explicitRepurchaseRequested: false } }));
  assert.deepEqual(result.recommendationIntent.explicitExcludedProducts, []);
  assert.deepEqual(result.explicitExclusionHistory.matches, []);
});

test("an invalid exclusion reference is rejected without a network-shaped payload leak", () => {
  assertInputError(
    () => buildCustomerRecommendationContext(baseInput({ recommendationIntent: { sourceProduct: null, explicitExcludedProducts: [{ productId: 0 }], explicitRepurchaseRequested: false } })),
    "invalid_product_reference"
  );
  assertInputError(
    () =>
      buildCustomerRecommendationContext(
        baseInput({ recommendationIntent: { sourceProduct: null, explicitExcludedProducts: [{ productId: 1, combinationId: -1 } as ProductReference], explicitRepurchaseRequested: false } })
      ),
    "invalid_product_reference"
  );
});

// ---------------------------------------------------------------------------
// Recompra explicita
// ---------------------------------------------------------------------------

test("explicitRepurchaseRequested false is preserved as-is", () => {
  const result = buildCustomerRecommendationContext(baseInput());
  assert.equal(result.recommendationIntent.explicitRepurchaseRequested, false);
});

test("explicitRepurchaseRequested true is preserved as-is", () => {
  const result = buildCustomerRecommendationContext(baseInput({ recommendationIntent: { sourceProduct: null, explicitExcludedProducts: [], explicitRepurchaseRequested: true } }));
  assert.equal(result.recommendationIntent.explicitRepurchaseRequested, true);
});

test("explicitRepurchaseRequested never changes history, exclusions or warnings", () => {
  const withFalse = buildCustomerRecommendationContext(
    baseInput({ recommendationIntent: { sourceProduct: { productId: 100 }, explicitExcludedProducts: [{ productId: 100 }], explicitRepurchaseRequested: false } })
  );
  const withTrue = buildCustomerRecommendationContext(
    baseInput({ recommendationIntent: { sourceProduct: { productId: 100 }, explicitExcludedProducts: [{ productId: 100 }], explicitRepurchaseRequested: true } })
  );
  assert.deepEqual(withFalse.purchaseHistory, withTrue.purchaseHistory);
  assert.deepEqual(withFalse.sourceProductHistory, withTrue.sourceProductHistory);
  assert.deepEqual(withFalse.explicitExclusionHistory, withTrue.explicitExclusionHistory);
  assert.deepEqual(withFalse.recommendationIntent.explicitExcludedProducts, withTrue.recommendationIntent.explicitExcludedProducts);
  assert.deepEqual(withFalse.warnings, withTrue.warnings);
});

test("the output never contains a recommendations or ranking field", () => {
  const result = buildCustomerRecommendationContext(baseInput());
  assert.equal("recommendations" in result, false);
  assert.equal("ranking" in result, false);
  assert.equal("preferredProducts" in result, false);
});

// ---------------------------------------------------------------------------
// Degradacion
// ---------------------------------------------------------------------------

test("T08 degraded is never conflated with an empty purchase history", () => {
  const result = buildCustomerRecommendationContext(baseInput({ purchasedProductsResult: DEGRADED }));
  assert.deepEqual(result.purchaseHistory.products, []);
  assert.equal(result.warnings.includes("no_purchase_history"), false);
});

test("T09 failed is never conflated with an absence of repeat behavior", () => {
  const result = buildCustomerRecommendationContext(baseInput({ purchaseBehaviorResult: FAILED }));
  assert.deepEqual(result.purchaseHistory.repeatedProducts, []);
  assert.equal(result.capabilities.canAssessRepeatBehavior, false);
});

test("both failed still returns a valid context, not a throw", () => {
  const result = buildCustomerRecommendationContext(baseInput({ purchasedProductsResult: FAILED, purchaseBehaviorResult: FAILED }));
  assert.equal(result.profileStatus, "failed");
  assert.equal(result.capabilities.canGenerateGenericRecommendationLater, true);
});

// ---------------------------------------------------------------------------
// Historial vacio vs comportamiento inconsistente (section 13)
// ---------------------------------------------------------------------------

test("T08 empty but T09 has behavior: keeps T09, downgrades to partial, flags inconsistency", () => {
  const result = buildCustomerRecommendationContext(
    baseInput({ purchasedProductsResult: available(purchasedProductsData({ products: [] })), purchaseBehaviorResult: available(purchaseBehaviorData({ topProducts: [behaviorProduct()] })) })
  );
  assert.equal(result.profileStatus, "partial");
  assert.equal(result.purchaseHistory.repeatedProducts.length, 1);
  assert.ok(result.warnings.includes("no_purchase_history"));
  assert.ok(result.warnings.includes("inconsistent_purchase_history"));
});

test("T08 has purchases but T09 has no topProducts: no error, no special warning, canAssessRepeatBehavior still true", () => {
  const result = buildCustomerRecommendationContext(baseInput({ purchaseBehaviorResult: available(purchaseBehaviorData({ topProducts: [] })) }));
  assert.equal(result.profileStatus, "available");
  assert.equal(result.capabilities.canAssessRepeatBehavior, true);
  assert.deepEqual(result.purchaseHistory.repeatedProducts, []);
});

// ---------------------------------------------------------------------------
// Determinismo
// ---------------------------------------------------------------------------

test("warnings follow a fixed priority order regardless of trigger order", () => {
  const result = buildCustomerRecommendationContext(
    baseInput({
      purchasedProductsResult: available(purchasedProductsData({ products: [purchasedItem({ catalogStatus: "deleted_or_unavailable" })] })),
      recommendationIntent: { sourceProduct: { productId: 100, combinationId: 0 }, explicitExcludedProducts: [], explicitRepurchaseRequested: false }
    })
  );
  assert.deepEqual(result.warnings, ["source_product_previously_purchased", "source_variant_previously_purchased", "purchased_product_deleted_or_unavailable"]);
});

test("output does not depend on the input array order", () => {
  const productsA = [purchasedItem({ productId: 1, productAttributeId: 0 }), purchasedItem({ productId: 2, productAttributeId: 0 })];
  const productsB = [purchasedItem({ productId: 2, productAttributeId: 0 }), purchasedItem({ productId: 1, productAttributeId: 0 })];
  const resultA = buildCustomerRecommendationContext(baseInput({ purchasedProductsResult: available(purchasedProductsData({ products: productsA })) }));
  const resultB = buildCustomerRecommendationContext(baseInput({ purchasedProductsResult: available(purchasedProductsData({ products: productsB })) }));
  assert.deepEqual(resultA, resultB);
});

test("calling twice with the same input yields identical output", () => {
  const input = baseInput({ recommendationIntent: { sourceProduct: { productId: 100, combinationId: 0 }, explicitExcludedProducts: [{ productId: 200 }], explicitRepurchaseRequested: true } });
  assert.deepEqual(buildCustomerRecommendationContext(input), buildCustomerRecommendationContext(input));
});

// ---------------------------------------------------------------------------
// Validacion interna
// ---------------------------------------------------------------------------

test("an invalid masterCustomerId is rejected", () => {
  for (const masterCustomerId of ["", "abc", "1.5", "-1", " 1", "1 "]) {
    assertInputError(() => buildCustomerRecommendationContext(baseInput({ masterCustomerId })), "invalid_master_customer_id");
  }
});

test("malformed purchase evidence is rejected", () => {
  assertInputError(
    () =>
      buildCustomerRecommendationContext(
        baseInput({ purchasedProductsResult: available(purchasedProductsData({ products: [purchasedItem({ totalSpentTaxIncl: 123 as unknown as string })] })) })
      ),
    "invalid_purchase_evidence"
  );
});

test("malformed repeated-product evidence is rejected", () => {
  assertInputError(
    () =>
      buildCustomerRecommendationContext(
        baseInput({ purchaseBehaviorResult: available(purchaseBehaviorData({ topProducts: [behaviorProduct({ daysSinceLastPurchase: -1 })] })) })
      ),
    "invalid_repeated_product_evidence"
  );
});

// ---------------------------------------------------------------------------
// Seguridad
// ---------------------------------------------------------------------------

test("the serialized output never contains productName or productReference", () => {
  const result = buildCustomerRecommendationContext(
    baseInput({
      purchasedProductsResult: available(purchasedProductsData({ products: [purchasedItem({ productName: "Secret Product Name", productReference: "SECRET-REF" })] }))
    })
  );
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("Secret Product Name"), false);
  assert.equal(serialized.includes("SECRET-REF"), false);
});

test("the serialized output never contains PII-shaped keys", () => {
  const result = buildCustomerRecommendationContext(baseInput());
  const serialized = JSON.stringify(result);
  for (const key of ["email", "phone", "dni", "address", "apiKey", "stack"]) {
    assert.equal(serialized.toLowerCase().includes(key.toLowerCase()), false, `unexpected key-like substring: ${key}`);
  }
});

test("a typed input error never serializes the offending payload", () => {
  try {
    buildCustomerRecommendationContext(
      baseInput({
        purchasedProductsResult: available(purchasedProductsData({ products: [purchasedItem({ productName: "Leaked Secret Name", totalSpentTaxIncl: "not-a-decimal" })] }))
      })
    );
    assert.fail("expected buildCustomerRecommendationContext to throw");
  } catch (error) {
    assert.ok(error instanceof CustomerRecommendationContextInputError);
    const serialized = JSON.stringify({ message: error.message, name: error.name, code: error.code });
    assert.equal(serialized.includes("Leaked Secret Name"), false);
    assert.equal(error.message, "invalid_purchase_evidence");
  }
});
