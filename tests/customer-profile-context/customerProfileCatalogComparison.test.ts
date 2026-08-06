import assert from "node:assert/strict";
import test from "node:test";
import { compareRecommendationsWithPurchaseHistory } from "@/lib/brain/commercial/customer-profile-context";

const purchasedProducts = [
  {
    productId: 501,
    productAttributeId: 7,
    name: "Kettlebell 16kg",
    totalQuantity: 2,
    orderCount: 2,
    firstPurchasedAt: "2026-02-01T00:00:00.000Z",
    lastPurchasedAt: "2026-07-20T00:00:00.000Z",
    historicalSpentTaxIncl: "59980.00",
    catalogStatus: "linked" as const
  }
];

test("comparison distinguishes exact variant, same product variant unknown, and same product different variant", () => {
  const matches = compareRecommendationsWithPurchaseHistory(
    [
      { productId: 501, productAttributeId: 7, name: "Kettlebell 16kg" },
      { productId: 501, productAttributeId: null, name: "Kettlebell 16kg" },
      { productId: 501, productAttributeId: 8, name: "Kettlebell 20kg" }
    ],
    purchasedProducts
  );

  assert.deepEqual(
    matches.map((match) => match.matchStatus),
    ["SAME_VARIANT_PREVIOUSLY_PURCHASED", "PRODUCT_MATCH_VARIANT_UNKNOWN", "SAME_PRODUCT_PREVIOUSLY_PURCHASED"]
  );
});

test("comparison marks products not seen in history and handles history unavailable", () => {
  const matches = compareRecommendationsWithPurchaseHistory([{ productId: 999, productAttributeId: null, name: "Rack" }], purchasedProducts);
  assert.equal(matches[0].matchStatus, "NOT_PREVIOUSLY_PURCHASED");

  const unavailable = compareRecommendationsWithPurchaseHistory([{ productId: 999, productAttributeId: null, name: "Rack" }], null);
  assert.equal(unavailable[0].matchStatus, "HISTORY_UNAVAILABLE");
});
