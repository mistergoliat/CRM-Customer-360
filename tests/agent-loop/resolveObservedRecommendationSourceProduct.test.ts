import assert from "node:assert/strict";
import test from "node:test";
import { resolveObservedRecommendationSourceProduct } from "@/lib/brain/commercial/agent-loop/resolveObservedRecommendationSourceProduct";
import type { RecentCatalogContext } from "@/lib/brain/commercial/agent-loop/recentCatalogContext";
import type { ToolObservation } from "@/lib/brain/commercial/agent-loop/agentStepTypes";

function contextWith(products: Array<{ productId: string; combinationId?: string; name?: string }>, sourceTool: RecentCatalogContext["interactions"][number]["sourceTool"] = "search_products"): RecentCatalogContext {
  return {
    interactions: [
      {
        inboundMessageId: "msg-1",
        completedAt: "2026-08-05T14:00:00.000Z",
        sourceTool,
        products: products.map((product, index) => ({ position: index + 1, name: "Producto", ...product }))
      }
    ]
  };
}

test("resolves when the productId was observed via search_products (recentCatalogContext)", () => {
  const result = resolveObservedRecommendationSourceProduct({
    requestedSourceProduct: { productId: 100 },
    recentCatalogContext: contextWith([{ productId: "100" }])
  });
  assert.deepEqual(result, { status: "resolved", product: { productId: "100" } });
});

test("resolves when the productId was observed via get_product_details (live toolObservations)", () => {
  const observations: ToolObservation[] = [{ tool: "get_product_details", status: "completed", data: { productId: "200", name: "Detalle" } }];
  const result = resolveObservedRecommendationSourceProduct({
    requestedSourceProduct: { productId: 200 },
    recentCatalogContext: null,
    toolObservations: observations
  });
  assert.deepEqual(result, { status: "resolved", product: { productId: "200" } });
});

test("resolves when the productId was observed via explore_catalog (recentCatalogContext)", () => {
  const result = resolveObservedRecommendationSourceProduct({
    requestedSourceProduct: { productId: 501 },
    recentCatalogContext: contextWith([{ productId: "501" }], "explore_catalog")
  });
  assert.equal(result.status, "resolved");
});

test("blocks a product never observed anywhere", () => {
  const result = resolveObservedRecommendationSourceProduct({
    requestedSourceProduct: { productId: 999 },
    recentCatalogContext: contextWith([{ productId: "100" }])
  });
  assert.deepEqual(result, { status: "blocked", reason: "source_product_not_observed" });
});

test("blocks a different (unrelated) productId even when other evidence exists", () => {
  const observations: ToolObservation[] = [{ tool: "search_products", status: "completed", data: { items: [{ productId: "100", name: "A" }] } }];
  const result = resolveObservedRecommendationSourceProduct({
    requestedSourceProduct: { productId: 777 },
    recentCatalogContext: contextWith([{ productId: "555" }]),
    toolObservations: observations
  });
  assert.deepEqual(result, { status: "blocked", reason: "source_product_not_observed" });
});

test("resolves an exact variant match (productId + combinationId)", () => {
  const result = resolveObservedRecommendationSourceProduct({
    requestedSourceProduct: { productId: 100, combinationId: 201 },
    recentCatalogContext: contextWith([{ productId: "100", combinationId: "201" }])
  });
  assert.deepEqual(result, { status: "resolved", product: { productId: "100", combinationId: "201" } });
});

test("blocks a different variant of an otherwise-observed product", () => {
  const result = resolveObservedRecommendationSourceProduct({
    requestedSourceProduct: { productId: 100, combinationId: 999 },
    recentCatalogContext: contextWith([{ productId: "100", combinationId: "201" }])
  });
  assert.deepEqual(result, { status: "blocked", reason: "source_product_variant_not_observed" });
});

test("resolves when no combinationId is requested and the observed evidence has none either", () => {
  const result = resolveObservedRecommendationSourceProduct({
    requestedSourceProduct: { productId: 501 },
    recentCatalogContext: contextWith([{ productId: "501" }])
  });
  assert.deepEqual(result, { status: "resolved", product: { productId: "501" } });
});

test("blocks when the product was observed under multiple distinct variants and none was requested (ambiguous)", () => {
  const result = resolveObservedRecommendationSourceProduct({
    requestedSourceProduct: { productId: 100 },
    recentCatalogContext: contextWith([
      { productId: "100", combinationId: "201" },
      { productId: "100", combinationId: "202" }
    ])
  });
  assert.deepEqual(result, { status: "blocked", reason: "source_product_variant_not_observed" });
});

test("resolves when no combinationId is requested and every matching entry shares the same single variant", () => {
  const result = resolveObservedRecommendationSourceProduct({
    requestedSourceProduct: { productId: 100 },
    recentCatalogContext: contextWith([
      { productId: "100", combinationId: "201" },
      { productId: "100", combinationId: "201" }
    ])
  });
  assert.deepEqual(result, { status: "resolved", product: { productId: "100", combinationId: "201" } });
});

test("normalizes a numeric productId/combinationId against string evidence without loss", () => {
  const result = resolveObservedRecommendationSourceProduct({
    requestedSourceProduct: { productId: 2164, combinationId: 0 },
    recentCatalogContext: contextWith([{ productId: "2164", combinationId: "0" }])
  });
  assert.deepEqual(result, { status: "resolved", product: { productId: "2164", combinationId: "0" } });
});

test("rejects a non-finite or non-numeric productId as never observed - never parseFloat/Number coercion", () => {
  for (const productId of [Number.NaN, Number.POSITIVE_INFINITY, "100", null, undefined]) {
    const result = resolveObservedRecommendationSourceProduct({
      requestedSourceProduct: { productId },
      recentCatalogContext: contextWith([{ productId: "100" }])
    });
    assert.deepEqual(result, { status: "blocked", reason: "source_product_not_observed" }, `productId=${String(productId)} must be blocked`);
  }
});

test("blocks when requestedSourceProduct itself is missing", () => {
  const result = resolveObservedRecommendationSourceProduct({
    requestedSourceProduct: null,
    recentCatalogContext: contextWith([{ productId: "100" }])
  });
  assert.deepEqual(result, { status: "blocked", reason: "source_product_not_observed" });
});

test("an empty (but present) recentCatalogContext with no live observations is 'not observed', not 'unavailable'", () => {
  const result = resolveObservedRecommendationSourceProduct({
    requestedSourceProduct: { productId: 100 },
    recentCatalogContext: { interactions: [] },
    toolObservations: []
  });
  assert.deepEqual(result, { status: "blocked", reason: "source_product_not_observed" });
});

test("a null recentCatalogContext with no live observations at all is 'recent_catalog_context_unavailable'", () => {
  const result = resolveObservedRecommendationSourceProduct({
    requestedSourceProduct: { productId: 100 },
    recentCatalogContext: null,
    toolObservations: []
  });
  assert.deepEqual(result, { status: "blocked", reason: "recent_catalog_context_unavailable" });
});

test("a null recentCatalogContext still resolves when live toolObservations alone provide evidence", () => {
  const observations: ToolObservation[] = [{ tool: "search_products", status: "completed", data: { items: [{ productId: "100", name: "A" }] } }];
  const result = resolveObservedRecommendationSourceProduct({
    requestedSourceProduct: { productId: 100 },
    recentCatalogContext: null,
    toolObservations: observations
  });
  assert.deepEqual(result, { status: "resolved", product: { productId: "100" } });
});

test("a recommend_catalog_products interaction in recentCatalogContext never authorizes another recommend_catalog_products call (anti-chaining)", () => {
  const result = resolveObservedRecommendationSourceProduct({
    requestedSourceProduct: { productId: 300 },
    recentCatalogContext: contextWith([{ productId: "300" }], "recommend_catalog_products")
  });
  assert.deepEqual(result, { status: "blocked", reason: "source_product_not_observed" });
});

test("a live recommend_catalog_products observation never authorizes another recommend_catalog_products call (anti-chaining)", () => {
  const observations: ToolObservation[] = [
    { tool: "recommend_catalog_products", status: "completed", data: { recommendations: [{ productId: "300", name: "B", rank: 1, score: 0.5, reasons: [] }] } }
  ];
  const result = resolveObservedRecommendationSourceProduct({
    requestedSourceProduct: { productId: 300 },
    recentCatalogContext: null,
    toolObservations: observations
  });
  assert.deepEqual(result, { status: "blocked", reason: "source_product_not_observed" });
});

test("a non-completed live observation (failed/blocked/skipped) never contributes evidence", () => {
  const observations: ToolObservation[] = [
    { tool: "search_products", status: "failed", errorCode: "catalog_service_not_configured" },
    { tool: "get_product_details", status: "blocked", errorCode: "duplicate_tool_call" },
    { tool: "explore_catalog", status: "skipped" as ToolObservation["status"] }
  ];
  const result = resolveObservedRecommendationSourceProduct({
    requestedSourceProduct: { productId: 100 },
    recentCatalogContext: null,
    toolObservations: observations
  });
  assert.deepEqual(result, { status: "blocked", reason: "source_product_not_observed" });
});

test("does not mutate the recentCatalogContext or toolObservations inputs", () => {
  const context = contextWith([{ productId: "100" }]);
  const frozenContext = JSON.parse(JSON.stringify(context));
  const observations: ToolObservation[] = [{ tool: "search_products", status: "completed", data: { items: [{ productId: "200", name: "A" }] } }];
  const frozenObservations = JSON.parse(JSON.stringify(observations));

  resolveObservedRecommendationSourceProduct({ requestedSourceProduct: { productId: 100 }, recentCatalogContext: context, toolObservations: observations });

  assert.deepEqual(context, frozenContext);
  assert.deepEqual(observations, frozenObservations);
});
