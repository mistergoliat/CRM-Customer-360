import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_LOOP_TOOL_POOL, buildToolDescriptions } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";
import { buildToolObservation } from "@/lib/brain/commercial/agent-loop/buildToolObservation";
import { resolveSalesAgentToolForCapabilityName } from "@/lib/brain/commercial/capability-gateway/toolAliases";
import { RECOMMEND_CATALOG_PRODUCTS_INPUT_SCHEMA } from "@/lib/brain/commercial/capability-gateway/catalogRecommendationGatewayAdapter";
import type { CapabilityGatewayResult } from "@/lib/brain/commercial/capability-gateway/types";
import type { SearchProductsV2Recommendation, SearchProductsV2Warning } from "@/lib/catalog/search-products-v2/types";

/**
 * CP-R1-T10B8C: unit tests for exposing recommend_catalog_products to the
 * Agent Tool Loop (pool membership, model-visible schema/description) and
 * for buildToolObservation's projection of its four outcomes (completed,
 * empty, degraded, skipped, failed). Pure/in-memory - no HTTP, no DB. The
 * full end-to-end path through runAgentToolLoop is covered separately in
 * recommendCatalogProductsAgentLoopIntegration.test.ts.
 */

const FIXED_TIME = "2026-08-05T12:00:00.000Z";

// ---------------------------------------------------------------------------
// Tool pool / description / schema exposure
// ---------------------------------------------------------------------------

test("pool: recommend_catalog_products is visible, pool has exactly 9 tools (SALES-AGENT-R1-T2.1 added select_shipping_option), nothing prior removed", () => {
  assert.equal((AGENT_LOOP_TOOL_POOL as readonly string[]).includes("recommend_catalog_products"), true);
  assert.equal(AGENT_LOOP_TOOL_POOL.length, 9);
  for (const priorTool of ["search_products", "get_product_details", "search_company_knowledge", "explore_catalog"]) {
    assert.ok((AGENT_LOOP_TOOL_POOL as readonly string[]).includes(priorTool), `${priorTool} must still be in the pool`);
  }
});

test("pool: recommend_catalog_products appears exactly once", () => {
  const occurrences = (AGENT_LOOP_TOOL_POOL as readonly string[]).filter((name) => name === "recommend_catalog_products");
  assert.equal(occurrences.length, 1);
});

test("legacy pipeline: recommend_catalog_products has no legacy tool alias (camelCase Sales Agent vocabulary)", () => {
  assert.equal(resolveSalesAgentToolForCapabilityName("recommend_catalog_products"), null);
});

test("description: buildToolDescriptions() exposes recommend_catalog_products with a non-empty, model-safe description", () => {
  const description = buildToolDescriptions().find((d) => d.name === "recommend_catalog_products");
  assert.ok(description);
  assert.ok(description!.description.length > 0);
  const text = description!.description.toLowerCase();
  // Section 5: never leak identity/ownership/microservice/endpoint/API-key/Gateway/retry details.
  for (const forbidden of ["mastercustomerid", "customer profile", "endpoint", "api key", "retries", "gateway", "microservice"]) {
    assert.equal(text.includes(forbidden), false, `description must not mention "${forbidden}"`);
  }
});

test("schema: buildToolDescriptions() exposes the real, unmodified RECOMMEND_CATALOG_PRODUCTS_INPUT_SCHEMA (single canonical source)", () => {
  const description = buildToolDescriptions().find((d) => d.name === "recommend_catalog_products");
  assert.equal(description!.inputSchema, RECOMMEND_CATALOG_PRODUCTS_INPUT_SCHEMA);
});

test("schema: additionalProperties is false and sourceProduct is the only required top-level field", () => {
  const schema = RECOMMEND_CATALOG_PRODUCTS_INPUT_SCHEMA as Record<string, unknown>;
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["sourceProduct"]);
});

test("schema: declares exactly the model-visible fields, nothing internal (no masterCustomerId/customerId/customerMode/correlationId/signal)", () => {
  const schema = RECOMMEND_CATALOG_PRODUCTS_INPUT_SCHEMA as { properties: Record<string, unknown> };
  assert.deepEqual(Object.keys(schema.properties).sort(), ["excludedProducts", "explicitRepurchaseRequested", "inStockOnly", "limit", "query", "sourceProduct"]);
  for (const internal of ["masterCustomerId", "customerId", "customerMode", "recommendationContext", "correlationId", "signal"]) {
    assert.equal(internal in schema.properties, false);
  }
});

test("schema: sourceProduct is a strict object with productId (number) required and combinationId (number) optional", () => {
  const schema = RECOMMEND_CATALOG_PRODUCTS_INPUT_SCHEMA as { properties: { sourceProduct: Record<string, unknown> } };
  const sourceProduct = schema.properties.sourceProduct;
  assert.equal(sourceProduct.additionalProperties, false);
  assert.deepEqual(sourceProduct.required, ["productId"]);
  assert.deepEqual(Object.keys(sourceProduct.properties as Record<string, unknown>).sort(), ["combinationId", "productId"]);
});

test("schema: excludedProducts is an array of the same strict product-reference shape", () => {
  const schema = RECOMMEND_CATALOG_PRODUCTS_INPUT_SCHEMA as { properties: { excludedProducts: { items: Record<string, unknown> } } };
  const items = schema.properties.excludedProducts.items;
  assert.equal(items.additionalProperties, false);
  assert.deepEqual(items.required, ["productId"]);
});

// ---------------------------------------------------------------------------
// buildToolObservation fixtures
// ---------------------------------------------------------------------------

function recommendation(overrides: Partial<SearchProductsV2Recommendation> = {}): SearchProductsV2Recommendation {
  return {
    product: { productId: "200", name: "Mancuernas 5kg", active: true, price: { amount: 19990, currency: "CLP" }, stock: { status: "in_stock", available: true } },
    rank: 1,
    score: 0.8,
    commercialScore: 0.8,
    affinityScore: 0.4,
    affinityConfidence: "low",
    ranking: { rank: 1, score: 0.8 },
    relationship: { type: "frequently_bought_together", reliability: 0.6, evidence: { jointCount: 4, support: 0.1, confidence: 0.5, lift: 1.2 } },
    commercialReason: { code: "FREQUENTLY_BOUGHT_TOGETHER", label: "Comprado frecuentemente junto al producto consultado" },
    reasons: [{ code: "STRONG_COMMERCIAL_RELEVANCE", source: "commercial" }],
    warnings: [],
    ...overrides
  };
}

function completedData(overrides: Record<string, unknown> = {}) {
  const recommendations = (overrides.recommendations as SearchProductsV2Recommendation[] | undefined) ?? [recommendation()];
  return {
    status: "completed" as const,
    customerMode: "generic" as const,
    recommendations,
    excluded: [],
    warnings: [] as SearchProductsV2Warning[],
    personalization: { applied: false, reason: "customer_not_provided" },
    execution: { correlationId: "corr", degraded: false, degradationReasons: [], stages: { commercialRecommendation: "completed", customerAffinity: "skipped", personalization: "completed" } },
    statistics: { commercialCandidates: 1, affinityCandidates: 0, personalizedRecommendations: 0, excludedRecommendations: 0, customerAffinityCalls: 0, personalizationCalls: 0, degradedStages: 0, warningsGenerated: 0 },
    snapshot: { id: "snap-1", modelVersion: "v1" },
    metadata: { explicitRepurchaseApplied: false, excludedProductCount: 0, recommendationCount: recommendations.length, degraded: false },
    ...overrides
  };
}

function gatewayResult(overrides: Partial<CapabilityGatewayResult<Record<string, unknown>>> = {}): CapabilityGatewayResult<Record<string, unknown>> {
  return {
    capability: "recommend_catalog_products",
    version: "capability-gateway.v1",
    availability: "available",
    status: "completed",
    data: completedData(),
    errorCode: null,
    retryable: false,
    evidence: [],
    warnings: [],
    retryCount: 0,
    startedAt: FIXED_TIME,
    completedAt: FIXED_TIME,
    executionPublicId: "capability-exec-test",
    ...overrides
  };
}

function observe(result: CapabilityGatewayResult<Record<string, unknown>>) {
  return buildToolObservation("recommend_catalog_products", result);
}

// ---------------------------------------------------------------------------
// Completed
// ---------------------------------------------------------------------------

test("completed: single candidate is preserved with productId/name/rank/score/reasons", () => {
  const observation = observe(gatewayResult());
  assert.equal(observation.status, "completed");
  const data = observation.data as Record<string, unknown>;
  assert.equal(data.customerMode, "generic");
  assert.equal(data.recommendationCount, 1);
  const recommendations = data.recommendations as Array<Record<string, unknown>>;
  assert.equal(recommendations.length, 1);
  assert.deepEqual(recommendations[0], { productId: "200", name: "Mancuernas 5kg", rank: 1, score: 0.8, reasons: ["STRONG_COMMERCIAL_RELEVANCE"] });
});

test("completed: order is preserved across multiple candidates", () => {
  const recs = [recommendation({ product: { ...recommendation().product, productId: "1", name: "A" }, rank: 1 }), recommendation({ product: { ...recommendation().product, productId: "2", name: "B" }, rank: 2 }), recommendation({ product: { ...recommendation().product, productId: "3", name: "C" }, rank: 3 })];
  const observation = observe(gatewayResult({ data: completedData({ recommendations: recs }) }));
  const data = observation.data as { recommendations: Array<Record<string, unknown>> };
  assert.deepEqual(data.recommendations.map((r) => r.productId), ["1", "2", "3"]);
});

test("completed: limit is applied at 5 candidates, recommendationCount preserves the real total", () => {
  const recs = Array.from({ length: 7 }, (_unused, index) => recommendation({ product: { ...recommendation().product, productId: String(index + 1) }, rank: index + 1 }));
  const observation = observe(gatewayResult({ data: completedData({ recommendations: recs }) }));
  const data = observation.data as { recommendations: unknown[]; recommendationCount: number };
  assert.equal(data.recommendations.length, 5);
  assert.equal(data.recommendationCount, 7);
});

test("completed: reasons are capped at 5 per candidate", () => {
  const manyReasons = Array.from({ length: 8 }, () => ({ code: "STRONG_COMMERCIAL_RELEVANCE" as const, source: "commercial" as const }));
  const observation = observe(gatewayResult({ data: completedData({ recommendations: [recommendation({ reasons: manyReasons })] }) }));
  const data = observation.data as { recommendations: Array<{ reasons: string[] }> };
  assert.equal(data.recommendations[0].reasons.length, 5);
});

test("completed: top-level warnings are capped at 10", () => {
  const manyWarnings: SearchProductsV2Warning[] = Array.from({ length: 12 }, () => ({ code: "NO_COMMERCIAL_CANDIDATES" }));
  const observation = observe(gatewayResult({ data: completedData({ warnings: manyWarnings }) }));
  const data = observation.data as { warnings: unknown[] };
  assert.equal(data.warnings.length, 10);
});

test("completed: a warning scoped to a product preserves its productId/combinationId", () => {
  const observation = observe(gatewayResult({ data: completedData({ warnings: [{ code: "AFFINITY_MISSING_FOR_PRODUCT", product: { productId: "9", combinationId: "3" } }] as SearchProductsV2Warning[] }) }));
  const data = observation.data as { warnings: Array<Record<string, unknown>> };
  assert.deepEqual(data.warnings[0], { code: "AFFINITY_MISSING_FOR_PRODUCT", productId: "9", combinationId: "3" });
});

test("completed: ownership is preserved verbatim when present (previouslyPurchased, exactVariantPreviouslyPurchased, totalOrderCount, lastPurchasedAt)", () => {
  const observation = observe(
    gatewayResult({
      data: completedData({
        recommendations: [recommendation({ ownership: { previouslyPurchased: true, exactVariantPreviouslyPurchased: false, totalOrderCount: 3, lastPurchasedAt: "2026-05-01T00:00:00.000Z" } })]
      })
    })
  );
  const data = observation.data as { recommendations: Array<Record<string, unknown>> };
  assert.deepEqual(data.recommendations[0].ownership, { previouslyPurchased: true, exactVariantPreviouslyPurchased: false, totalOrderCount: 3, lastPurchasedAt: "2026-05-01T00:00:00.000Z" });
});

test("completed: ownership is absent (never fabricated) when the upstream result did not evaluate it", () => {
  const observation = observe(gatewayResult());
  const data = observation.data as { recommendations: Array<Record<string, unknown>> };
  assert.equal("ownership" in data.recommendations[0], false);
});

test("completed: personalization is preserved (applied + reason)", () => {
  const observation = observe(gatewayResult({ data: completedData({ personalization: { applied: true } }) }));
  const data = observation.data as { personalization: Record<string, unknown> };
  assert.deepEqual(data.personalization, { applied: true });
});

test("completed: personalization reason is preserved when applied is false", () => {
  const observation = observe(gatewayResult({ data: completedData({ personalization: { applied: false, reason: "no_customer_history" } }) }));
  const data = observation.data as { personalization: Record<string, unknown> };
  assert.deepEqual(data.personalization, { applied: false, reason: "no_customer_history" });
});

test("completed: customerMode identified is preserved", () => {
  const observation = observe(gatewayResult({ data: completedData({ customerMode: "identified" }) }));
  const data = observation.data as { customerMode: string };
  assert.equal(data.customerMode, "identified");
});

// ---------------------------------------------------------------------------
// Empty / degraded
// ---------------------------------------------------------------------------

test("empty: recommendations=[] stays completed with an empty array and count 0, never failed/skipped/unavailable", () => {
  const observation = observe(gatewayResult({ data: completedData({ recommendations: [], metadata: { explicitRepurchaseApplied: false, excludedProductCount: 0, recommendationCount: 0, degraded: false } }) }));
  assert.equal(observation.status, "completed");
  const data = observation.data as { recommendations: unknown[]; recommendationCount: number };
  assert.deepEqual(data.recommendations, []);
  assert.equal(data.recommendationCount, 0);
});

test("degraded: stays completed with degraded=true and real candidates preserved", () => {
  const observation = observe(gatewayResult({ data: completedData({ metadata: { explicitRepurchaseApplied: false, excludedProductCount: 0, recommendationCount: 1, degraded: true } }) }));
  assert.equal(observation.status, "completed");
  const data = observation.data as { degraded: boolean; recommendations: unknown[] };
  assert.equal(data.degraded, true);
  assert.equal(data.recommendations.length, 1);
});

// ---------------------------------------------------------------------------
// Skipped
// ---------------------------------------------------------------------------

test("skipped: status is skipped with the exact reason, never a fabricated completed/empty result", () => {
  const observation = observe(gatewayResult({ data: { status: "skipped", reason: "source_product_invalid" } }));
  assert.deepEqual(observation, { tool: "recommend_catalog_products", status: "skipped", reason: "source_product_invalid" });
});

test("skipped: every documented skip reason round-trips unchanged", () => {
  const reasons = [
    "source_product_missing",
    "source_product_invalid",
    "source_product_mismatch",
    "invalid_customer_identity",
    "customer_identity_mismatch",
    "contradictory_product_context",
    "invalid_excluded_product",
    "invalid_query",
    "invalid_correlation_id",
    "invalid_limit"
  ];
  for (const reason of reasons) {
    const observation = observe(gatewayResult({ data: { status: "skipped", reason } }));
    assert.equal(observation.status, "skipped");
    assert.equal(observation.reason, reason);
  }
});

// ---------------------------------------------------------------------------
// Failed
// ---------------------------------------------------------------------------

test("failed: preserves errorCode and retryable, no message/sourceProduct/query/exclusions", () => {
  const observation = observe(
    gatewayResult({
      status: "failed",
      errorCode: "timeout",
      retryable: true,
      data: { status: "failed", code: "timeout", retryable: true, message: "SENSITIVE: connection reset while calling internal endpoint" }
    })
  );
  assert.deepEqual(observation, { tool: "recommend_catalog_products", status: "failed", errorCode: "timeout", retryable: true });
  assert.doesNotMatch(JSON.stringify(observation), /SENSITIVE|internal endpoint/);
});

test("failed: providerErrorCode is preserved when the real service reported one (e.g. SOURCE_PRODUCT_NOT_FOUND)", () => {
  const observation = observe(
    gatewayResult({
      status: "failed",
      errorCode: "catalog_service_error",
      retryable: false,
      data: { status: "failed", code: "catalog_service_error", retryable: false, message: "not shown", httpStatus: 404, providerErrorCode: "SOURCE_PRODUCT_NOT_FOUND" }
    })
  );
  assert.equal(observation.errorCode, "catalog_service_error");
  assert.equal(observation.providerErrorCode, "SOURCE_PRODUCT_NOT_FOUND");
  assert.equal("httpStatus" in observation, false, "httpStatus has no precedent in any existing ToolObservation and must not be added");
});

test("failed: SOURCE_PRODUCT_INACTIVE (HTTP 409) is preserved as a safe failed observation, no message/request/response/URL/headers/stack/cause", () => {
  const observation = observe(
    gatewayResult({
      status: "failed",
      errorCode: "catalog_service_error",
      retryable: false,
      data: { status: "failed", code: "catalog_service_error", retryable: false, message: "Producto fuente inactivo.", httpStatus: 409, providerErrorCode: "SOURCE_PRODUCT_INACTIVE" }
    })
  );
  assert.deepEqual(observation, { tool: "recommend_catalog_products", status: "failed", errorCode: "catalog_service_error", retryable: false, providerErrorCode: "SOURCE_PRODUCT_INACTIVE" });
  assert.doesNotMatch(JSON.stringify(observation), /Producto fuente inactivo|409/);
});

test("failed: never leaks masterCustomerId, query, sourceProduct, or an API key even if present on the raw data payload", () => {
  const observation = observe(
    gatewayResult({
      status: "failed",
      errorCode: "network_error",
      retryable: true,
      data: { status: "failed", code: "network_error", retryable: true, message: "irrelevant", sourceProduct: { productId: 999 }, query: "leaked query", masterCustomerId: "leak-123" } as unknown as Record<string, unknown>
    })
  );
  const serialized = JSON.stringify(observation);
  assert.doesNotMatch(serialized, /leak-123|leaked query|999/);
});

// ---------------------------------------------------------------------------
// Generic mode
// ---------------------------------------------------------------------------

test("generic mode: customerMode=generic with no identity is a normal completed execution, never blocked", () => {
  const observation = observe(gatewayResult({ data: completedData({ customerMode: "generic" }) }));
  assert.equal(observation.status, "completed");
  const data = observation.data as { customerMode: string };
  assert.equal(data.customerMode, "generic");
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

test("immutability: buildToolObservation never mutates the source CapabilityGatewayResult or its nested recommendations/warnings", () => {
  const original = gatewayResult({
    data: completedData({
      recommendations: [recommendation()],
      warnings: [{ code: "AFFINITY_MISSING_FOR_PRODUCT", product: { productId: "9" } }]
    })
  });
  const snapshot = JSON.parse(JSON.stringify(original));
  const observation = observe(original);
  assert.deepEqual(original, snapshot);

  // Mutating the returned observation must never reach back into the fixture
  // (projectRecommendation copies primitives into a new object, never a
  // reference to the original recommendation.product).
  const data = observation.data as { recommendations: Array<Record<string, unknown>> };
  data.recommendations[0].name = "mutated";
  const originalRecommendations = (original.data as { recommendations: SearchProductsV2Recommendation[] }).recommendations;
  assert.equal(originalRecommendations[0].product.name, "Mancuernas 5kg");
});

// ---------------------------------------------------------------------------
// Concurrency (no shared mutable state inside buildToolObservation)
// ---------------------------------------------------------------------------

test("concurrency: two observations built back-to-back stay isolated (identified vs generic, distinct recommendations, distinct errors)", () => {
  const resultA = gatewayResult({ data: completedData({ customerMode: "identified", recommendations: [recommendation({ product: { ...recommendation().product, productId: "A" } })] }) });
  const resultB = gatewayResult({ status: "failed", errorCode: "unauthorized", retryable: false, data: { status: "failed", code: "unauthorized", retryable: false, message: "x" } });

  const observationA1 = observe(resultA);
  const observationB = observe(resultB);
  const observationA2 = observe(resultA);

  assert.equal((observationA1.data as { customerMode: string }).customerMode, "identified");
  assert.equal((observationA1.data as { recommendations: Array<{ productId: string }> }).recommendations[0].productId, "A");
  assert.equal(observationB.status, "failed");
  assert.equal(observationB.errorCode, "unauthorized");
  assert.deepEqual(observationA1, observationA2);
  assert.notEqual(observationA1.data, observationA2.data, "each call must build a fresh data object, never a shared reference");
});
