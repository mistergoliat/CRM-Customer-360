import assert from "node:assert/strict";
import test from "node:test";
import { createCatalogRecommendationCapability } from "../../lib/brain/commercial/capabilities/catalog-recommendation/catalogRecommendationCapability";
import type { CatalogRecommendationCapabilityInput } from "../../lib/brain/commercial/capabilities/catalog-recommendation/types";
import { SEARCH_PRODUCTS_V2_CLIENT_ERROR_CODES } from "../../lib/catalog/search-products-v2/types";
import type {
  CatalogSearchProductsV2Client,
  SearchProductsV2ClientCallContext,
  SearchProductsV2ClientError,
  SearchProductsV2ClientErrorCode,
  SearchProductsV2ClientRequest,
  SearchProductsV2ClientResponse,
  SearchProductsV2ClientResult
} from "../../lib/catalog/search-products-v2/types";
import type { CustomerRecommendationContext, ProductReference } from "../../lib/brain/commercial/recommendation-context/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function productSummary(overrides: Record<string, unknown> = {}) {
  return {
    productId: "173",
    name: "Banca ajustable",
    active: true,
    price: { amount: 89990, currency: "CLP" },
    stock: { status: "in_stock", available: true },
    ...overrides
  };
}

function recommendation(overrides: Record<string, unknown> = {}) {
  return {
    product: productSummary({ productId: "200", name: "Mancuernas 5kg" }),
    rank: 1,
    score: 0.87,
    commercialScore: 0.9,
    affinityScore: 0.5,
    affinityConfidence: "medium",
    ranking: { rank: 1, score: 0.87 },
    relationship: { type: "frequently_bought_together", reliability: 0.7, evidence: { jointCount: 12, support: 0.2, confidence: 0.6, lift: 1.4 } },
    commercialReason: { code: "FREQUENTLY_BOUGHT_TOGETHER", label: "Comprado frecuentemente junto al producto consultado" },
    reasons: [{ code: "STRONG_COMMERCIAL_RELEVANCE", source: "commercial" }],
    warnings: [],
    ...overrides
  };
}

function baseResponse(overrides: Record<string, unknown> = {}): SearchProductsV2ClientResponse {
  return {
    query: null,
    sourceProduct: productSummary(),
    recommendations: [recommendation()],
    excluded: [],
    personalization: { applied: false, reason: "customer_not_provided" },
    snapshot: { id: "snap-1", modelVersion: "v1" },
    warnings: [],
    statistics: { commercialCandidates: 1, affinityCandidates: 0, personalizedRecommendations: 0, excludedRecommendations: 0, customerAffinityCalls: 0, personalizationCalls: 0, degradedStages: 0, warningsGenerated: 0 },
    execution: { correlationId: "corr", degraded: false, degradationReasons: [], stages: { commercialRecommendation: "completed", customerAffinity: "skipped", personalization: "completed" } },
    ...overrides
  } as SearchProductsV2ClientResponse;
}

function contextFixture(overrides: Partial<{ masterCustomerId: string; explicitExcludedProducts: readonly ProductReference[]; explicitRepurchaseRequested: boolean; sourceProduct: ProductReference | null }> = {}): CustomerRecommendationContext {
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
    purchaseHistory: { products: [], repeatedProducts: [] },
    sourceProductHistory: { productPreviouslyPurchased: false, exactVariantPreviouslyPurchased: false, matchingPurchases: [] },
    explicitExclusionHistory: { matches: [] },
    capabilities: { canAssessProductHistory: true, canAssessRepeatBehavior: true, canGenerateGenericRecommendationLater: true },
    warnings: []
  };
}

// ---------------------------------------------------------------------------
// Fake CatalogSearchProductsV2Client - records every call, never shares
// object references across calls or across test cases (fresh JSON round
// trip per call, exactly like the real HTTP client's own parser would).
// ---------------------------------------------------------------------------

type RecordedCall = { request: SearchProductsV2ClientRequest; context: SearchProductsV2ClientCallContext };

function createFakeClient(next: () => SearchProductsV2ClientResult) {
  const calls: RecordedCall[] = [];
  const client: CatalogSearchProductsV2Client = {
    async searchProducts(request, context = {}) {
      calls.push({ request: JSON.parse(JSON.stringify(request)), context });
      return JSON.parse(JSON.stringify(next()));
    }
  };
  return { client, calls };
}

function okResult(response: SearchProductsV2ClientResponse): SearchProductsV2ClientResult {
  return { ok: true, value: response };
}

function errResult(error: SearchProductsV2ClientError): SearchProductsV2ClientResult {
  return { ok: false, error };
}

// ---------------------------------------------------------------------------
// Mapper skipped
// ---------------------------------------------------------------------------

const SKIPPED_CASES: Array<{ name: string; input: CatalogRecommendationCapabilityInput; reason: string }> = [
  { name: "source_product_missing", input: {}, reason: "source_product_missing" },
  { name: "source_product_invalid", input: { sourceProduct: { productId: -1 } }, reason: "source_product_invalid" },
  {
    name: "source_product_mismatch",
    input: { sourceProduct: { productId: 999 }, recommendationContext: contextFixture({ sourceProduct: { productId: 100 } }) },
    reason: "source_product_mismatch"
  },
  { name: "invalid_customer_identity", input: { sourceProduct: { productId: 100 }, masterCustomerId: "not-a-number" }, reason: "invalid_customer_identity" },
  {
    name: "customer_identity_mismatch",
    input: { sourceProduct: { productId: 100 }, masterCustomerId: "1", recommendationContext: contextFixture({ masterCustomerId: "2" }) },
    reason: "customer_identity_mismatch"
  },
  { name: "invalid_query", input: { sourceProduct: { productId: 100 }, query: "x".repeat(241) }, reason: "invalid_query" },
  { name: "invalid_correlation_id", input: { sourceProduct: { productId: 100 }, correlationId: "bad id with spaces" }, reason: "invalid_correlation_id" },
  { name: "invalid_excluded_product", input: { sourceProduct: { productId: 100 }, explicitExcludedProducts: [{ productId: -5 }] }, reason: "invalid_excluded_product" },
  { name: "invalid_limit", input: { sourceProduct: { productId: 100 }, limit: 21 }, reason: "invalid_limit" },
  {
    name: "contradictory_product_context",
    input: { recommendationContext: contextFixture({ sourceProduct: { productId: 100 }, explicitRepurchaseRequested: true, explicitExcludedProducts: [{ productId: 100 }] }) },
    reason: "contradictory_product_context"
  }
];

for (const testCase of SKIPPED_CASES) {
  test(`skipped: ${testCase.name} - no client call, no fallback`, async () => {
    const { client, calls } = createFakeClient(() => okResult(baseResponse()));
    const capability = createCatalogRecommendationCapability({ catalogSearchProductsV2Client: client });
    const frozenInput = Object.freeze({ ...testCase.input });
    const result = await capability.execute(frozenInput);
    assert.equal(result.status, "skipped");
    if (result.status === "skipped") assert.equal(result.reason, testCase.reason);
    assert.equal(calls.length, 0);
  });
}

// ---------------------------------------------------------------------------
// Completed - normal, generic, identified
// ---------------------------------------------------------------------------

test("completed: generic mode - no masterCustomerId, request has no customer/context.customerId", async () => {
  const response = baseResponse();
  const { client, calls } = createFakeClient(() => okResult(response));
  const capability = createCatalogRecommendationCapability({ catalogSearchProductsV2Client: client });

  const result = await capability.execute({ sourceProduct: { productId: 100 }, query: "banca ajustable", correlationId: "corr-1" });

  assert.equal(calls.length, 1);
  assert.equal("customer" in calls[0].request, false);
  assert.equal("context" in calls[0].request, false);
  assert.equal(calls[0].context.correlationId, "corr-1");

  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.customerMode, "generic");
  assert.deepEqual(result.recommendations, response.recommendations);
  assert.deepEqual(result.excluded, response.excluded);
  assert.deepEqual(result.warnings, response.warnings);
  assert.deepEqual(result.personalization, response.personalization);
  assert.deepEqual(result.execution, response.execution);
  assert.deepEqual(result.statistics, response.statistics);
  assert.deepEqual(result.snapshot, response.snapshot);
  assert.deepEqual(result.metadata, { explicitRepurchaseApplied: false, excludedProductCount: 0, recommendationCount: 1, degraded: false });
});

test("completed: identified mode - masterCustomerId present, request carries customer + context.customerId", async () => {
  const response = baseResponse({ customer: { customerId: "555" }, personalization: { applied: false, reason: "no_customer_history", customerId: "555" } });
  const { client, calls } = createFakeClient(() => okResult(response));
  const capability = createCatalogRecommendationCapability({ catalogSearchProductsV2Client: client });

  const result = await capability.execute({ recommendationContext: contextFixture({ masterCustomerId: "555" }) });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].request.customer, { customerId: "555" });
  assert.equal(calls[0].request.context?.customerId, "555");

  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.customerMode, "identified");
  // personalization.applied may legitimately be false even in identified mode - never forced consistent.
  assert.equal(result.personalization.applied, false);
  assert.equal(result.personalization.reason, "no_customer_history");
});

test("completed: exact T10B6 request is sent, signal forwarded, call context carries correlationId only", async () => {
  const response = baseResponse();
  const { client, calls } = createFakeClient(() => okResult(response));
  const capability = createCatalogRecommendationCapability({ catalogSearchProductsV2Client: client });
  const controller = new AbortController();

  await capability.execute({ sourceProduct: { productId: 100, combinationId: 3 }, correlationId: "corr-exact", signal: controller.signal });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].request.sourceProduct, { productId: "100", combinationId: "3" });
  assert.deepEqual(calls[0].context, { correlationId: "corr-exact", signal: controller.signal });
});

test("completed: recommendation order and ownership are preserved exactly as returned", async () => {
  const withOwnership = recommendation({
    product: productSummary({ productId: "10" }),
    rank: 1,
    ownership: { previouslyPurchased: true, exactVariantPreviouslyPurchased: false, totalOrderCount: 3 }
  });
  const withoutOwnership = recommendation({ product: productSummary({ productId: "20" }), rank: 2 });
  const response = baseResponse({ recommendations: [withOwnership, withoutOwnership] });
  const { client } = createFakeClient(() => okResult(response));
  const capability = createCatalogRecommendationCapability({ catalogSearchProductsV2Client: client });

  const result = await capability.execute({ sourceProduct: { productId: 100 } });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.recommendations.length, 2);
  assert.equal(result.recommendations[0].product.productId, "10");
  assert.deepEqual(result.recommendations[0].ownership, { previouslyPurchased: true, exactVariantPreviouslyPurchased: false, totalOrderCount: 3 });
  assert.equal(result.recommendations[1].product.productId, "20");
  assert.equal("ownership" in result.recommendations[1], false);
});

// ---------------------------------------------------------------------------
// Empty result
// ---------------------------------------------------------------------------

test("completed: empty recommendations is success, never skipped/failed", async () => {
  const response = baseResponse({ recommendations: [], warnings: [{ code: "NO_COMMERCIAL_CANDIDATES" }] });
  const { client } = createFakeClient(() => okResult(response));
  const capability = createCatalogRecommendationCapability({ catalogSearchProductsV2Client: client });

  const result = await capability.execute({ sourceProduct: { productId: 100 } });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.deepEqual(result.recommendations, []);
  assert.equal(result.metadata.recommendationCount, 0);
  assert.deepEqual(result.warnings, [{ code: "NO_COMMERCIAL_CANDIDATES" }]);
});

// ---------------------------------------------------------------------------
// Degraded result
// ---------------------------------------------------------------------------

test("completed: HTTP 200 degraded=true stays completed, metadata.degraded=true, recommendations preserved", async () => {
  const response = baseResponse({
    execution: {
      correlationId: "corr",
      degraded: true,
      degradationReasons: ["CUSTOMER_AFFINITY_RETRYABLE_FAILURE"],
      stages: { commercialRecommendation: "completed", customerAffinity: "degraded", personalization: "skipped" }
    }
  });
  const { client } = createFakeClient(() => okResult(response));
  const capability = createCatalogRecommendationCapability({ catalogSearchProductsV2Client: client });

  const result = await capability.execute({ sourceProduct: { productId: 100 } });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.metadata.degraded, true);
  assert.deepEqual(result.execution.degradationReasons, ["CUSTOMER_AFFINITY_RETRYABLE_FAILURE"]);
  assert.equal(result.recommendations.length, 1);
});

// ---------------------------------------------------------------------------
// Errors - every T10B5 client error code
// ---------------------------------------------------------------------------

for (const code of SEARCH_PRODUCTS_V2_CLIENT_ERROR_CODES) {
  test(`failed: ${code} preserves code/retryable/httpStatus, no invented recommendations`, async () => {
    const error: SearchProductsV2ClientError = { code: code as SearchProductsV2ClientErrorCode, message: "safe message", retryable: code === "timeout" || code === "network_error" || code === "rate_limited", httpStatus: code === "unexpected_http_status" ? 418 : undefined };
    const { client, calls } = createFakeClient(() => errResult(error));
    const capability = createCatalogRecommendationCapability({ catalogSearchProductsV2Client: client });

    const result = await capability.execute({ sourceProduct: { productId: 100 } });
    assert.equal(calls.length, 1);
    assert.equal(result.status, "failed");
    if (result.status !== "failed") return;
    assert.equal(result.error.code, error.code);
    assert.equal(result.error.retryable, error.retryable);
    assert.equal(result.error.httpStatus, error.httpStatus);
    assert.equal(result.error.message, "safe message");
  });
}

test("failed: source_product_not_found (404) preserves remote providerErrorCode under catalog_service_error", async () => {
  const error: SearchProductsV2ClientError = { code: "catalog_service_error", message: "Producto fuente no encontrado.", retryable: false, httpStatus: 404, providerErrorCode: "SOURCE_PRODUCT_NOT_FOUND" };
  const { client } = createFakeClient(() => errResult(error));
  const capability = createCatalogRecommendationCapability({ catalogSearchProductsV2Client: client });

  const result = await capability.execute({ sourceProduct: { productId: 100 } });
  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.error.code, "catalog_service_error");
  assert.equal(result.error.httpStatus, 404);
  assert.equal(result.error.providerErrorCode, "SOURCE_PRODUCT_NOT_FOUND");
});

test("failed: source_product_inactive (409) preserves remote providerErrorCode under catalog_service_error", async () => {
  const error: SearchProductsV2ClientError = { code: "catalog_service_error", message: "Producto fuente inactivo.", retryable: false, httpStatus: 409, providerErrorCode: "SOURCE_PRODUCT_INACTIVE" };
  const { client } = createFakeClient(() => errResult(error));
  const capability = createCatalogRecommendationCapability({ catalogSearchProductsV2Client: client });

  const result = await capability.execute({ sourceProduct: { productId: 100 } });
  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.error.code, "catalog_service_error");
  assert.equal(result.error.httpStatus, 409);
  assert.equal(result.error.providerErrorCode, "SOURCE_PRODUCT_INACTIVE");
});

test("no fallback: a failed client result never yields recommendations", async () => {
  const { client } = createFakeClient(() => errResult({ code: "catalog_service_error", message: "boom", retryable: false }));
  const capability = createCatalogRecommendationCapability({ catalogSearchProductsV2Client: client });
  const result = await capability.execute({ sourceProduct: { productId: 100 } });
  assert.equal(result.status, "failed");
  assert.equal("recommendations" in result, false);
});

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

test("cancellation: aborted signal is forwarded to the client call context", async () => {
  const controller = new AbortController();
  controller.abort();
  const { client, calls } = createFakeClient(() => errResult({ code: "aborted", message: "Request was cancelled before it started.", retryable: false }));
  const capability = createCatalogRecommendationCapability({ catalogSearchProductsV2Client: client });

  const result = await capability.execute({ sourceProduct: { productId: 100 }, signal: controller.signal });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].context.signal?.aborted, true);
  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.error.code, "aborted");
});

test("cancellation: timeout is never reclassified as aborted", async () => {
  const { client, calls } = createFakeClient(() => errResult({ code: "timeout", message: "Catalog service request timed out.", retryable: true }));
  const capability = createCatalogRecommendationCapability({ catalogSearchProductsV2Client: client });

  const result = await capability.execute({ sourceProduct: { productId: 100 } });
  assert.equal(calls.length, 1);
  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.error.code, "timeout");
});

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

test("concurrency: two concurrent calls with distinct correlation ids yield distinct, uncontaminated results", async () => {
  let callIndex = 0;
  const responses = [baseResponse({ recommendations: [recommendation({ product: productSummary({ productId: "A" }) })] }), baseResponse({ recommendations: [recommendation({ product: productSummary({ productId: "B" }) })] })];
  const calls: RecordedCall[] = [];
  const client: CatalogSearchProductsV2Client = {
    async searchProducts(request, context = {}) {
      calls.push({ request: JSON.parse(JSON.stringify(request)), context });
      const index = callIndex;
      callIndex += 1;
      await new Promise((resolve) => setTimeout(resolve, index === 0 ? 20 : 0));
      return { ok: true, value: JSON.parse(JSON.stringify(responses[index])) };
    }
  };
  const capability = createCatalogRecommendationCapability({ catalogSearchProductsV2Client: client });

  const [first, second] = await Promise.all([
    capability.execute({ sourceProduct: { productId: 1 }, correlationId: "corr-a" }),
    capability.execute({ sourceProduct: { productId: 2 }, correlationId: "corr-b" })
  ]);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].context.correlationId, "corr-a");
  assert.equal(calls[1].context.correlationId, "corr-b");
  assert.equal(first.status, "completed");
  assert.equal(second.status, "completed");
  if (first.status !== "completed" || second.status !== "completed") return;
  assert.equal(first.recommendations[0].product.productId, "A");
  assert.equal(second.recommendations[0].product.productId, "B");
});

test("concurrency: two concurrent calls with distinct AbortSignals each receive only their own signal", async () => {
  const controllerA = new AbortController();
  const controllerB = new AbortController();
  const responses = [baseResponse({ recommendations: [recommendation({ product: productSummary({ productId: "A" }) })] }), baseResponse({ recommendations: [recommendation({ product: productSummary({ productId: "B" }) })] })];
  const calls: RecordedCall[] = [];
  let callIndex = 0;
  const client: CatalogSearchProductsV2Client = {
    async searchProducts(request, context = {}) {
      const index = callIndex;
      callIndex += 1;
      calls.push({ request: JSON.parse(JSON.stringify(request)), context });
      return { ok: true, value: JSON.parse(JSON.stringify(responses[index])) };
    }
  };
  const capability = createCatalogRecommendationCapability({ catalogSearchProductsV2Client: client });

  const [first, second] = await Promise.all([
    capability.execute({ sourceProduct: { productId: 1 }, correlationId: "corr-signal-a", signal: controllerA.signal }),
    capability.execute({ sourceProduct: { productId: 2 }, correlationId: "corr-signal-b", signal: controllerB.signal })
  ]);

  assert.equal(calls.length, 2);
  const callA = calls.find((call) => call.context.correlationId === "corr-signal-a");
  const callB = calls.find((call) => call.context.correlationId === "corr-signal-b");
  assert.ok(callA);
  assert.ok(callB);
  assert.equal(callA.context.signal, controllerA.signal);
  assert.equal(callB.context.signal, controllerB.signal);
  assert.notEqual(callA.context.signal, callB.context.signal);

  assert.equal(first.status, "completed");
  assert.equal(second.status, "completed");
  if (first.status !== "completed" || second.status !== "completed") return;
  assert.equal(first.recommendations[0].product.productId, "A");
  assert.equal(second.recommendations[0].product.productId, "B");
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

test("immutability: mutating the returned result does not affect a second call's response", async () => {
  const response = baseResponse();
  const { client } = createFakeClient(() => okResult(response));
  const capability = createCatalogRecommendationCapability({ catalogSearchProductsV2Client: client });

  const first = await capability.execute({ sourceProduct: { productId: 100 } });
  assert.equal(first.status, "completed");
  if (first.status !== "completed") return;
  (first.recommendations as unknown as unknown[]).push({ injected: true });

  const second = await capability.execute({ sourceProduct: { productId: 100 } });
  assert.equal(second.status, "completed");
  if (second.status !== "completed") return;
  assert.equal(second.recommendations.length, 1);
});

test("immutability: input is never mutated (frozen input does not throw)", async () => {
  const { client } = createFakeClient(() => okResult(baseResponse()));
  const capability = createCatalogRecommendationCapability({ catalogSearchProductsV2Client: client });
  const input = Object.freeze({ sourceProduct: Object.freeze({ productId: 100 }), explicitExcludedProducts: Object.freeze([]) });
  const result = await capability.execute(input);
  assert.equal(result.status, "completed");
});
