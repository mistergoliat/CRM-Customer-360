import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { createCatalogRecommendationCapability } from "../../lib/brain/commercial/capabilities/catalog-recommendation/catalogRecommendationCapability";
import { createHttpCatalogSearchProductsV2Client } from "../../lib/catalog/search-products-v2/httpCatalogSearchProductsV2Client";
import type { CustomerRecommendationContext, ProductReference } from "../../lib/brain/commercial/recommendation-context/types";

/**
 * CP-R1-T10B7: exercises the real chain
 * CatalogRecommendationCapability -> buildSearchProductsV2Request (real) ->
 * HttpCatalogSearchProductsV2Client (real) -> local node:http server, same
 * precedent as
 * tests/recommendation-context/buildSearchProductsV2RequestT10B5Compatibility.test.ts
 * and T10B5's own suite. No mocked fetch, no productive Catalog Service call.
 */

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void;

let server: http.Server;
let baseUrl: string;
let handler: Handler = (_req, res) => res.writeHead(500).end();
let lastHeaders: http.IncomingHttpHeaders = {};
let lastBody = "";

before(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      lastHeaders = req.headers;
      lastBody = Buffer.concat(chunks).toString("utf8");
      handler(req, res, lastBody);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test.beforeEach(() => {
  lastHeaders = {};
  lastBody = "";
  handler = (_req, res) => res.writeHead(500).end();
});

// 2000ms default (vs. T10B5/T10B6's 500ms precedent): avoids a cold-start
// flake observed in this environment where the process's very first fetch()
// call lazily initializes undici and can exceed 500ms on its own, unrelated
// to server latency. The dedicated timeout scenario below overrides this
// explicitly with a short value.
function makeCapability(overrides: Partial<{ timeoutMs: number }> = {}) {
  const client = createHttpCatalogSearchProductsV2Client({ baseUrl, apiKey: "test-key", timeoutMs: overrides.timeoutMs ?? 2000 });
  return createCatalogRecommendationCapability({ catalogSearchProductsV2Client: client });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function productSummary(overrides: Record<string, unknown> = {}) {
  return {
    productId: "100",
    name: "Producto fuente",
    active: true,
    price: { amount: 10000, currency: "CLP" },
    stock: { status: "in_stock", available: true },
    ...overrides
  };
}

function baseResponse(overrides: Record<string, unknown> = {}) {
  return {
    query: null,
    sourceProduct: productSummary(),
    recommendations: [
      {
        product: productSummary({ productId: "200", name: "Recomendado" }),
        rank: 1,
        score: 0.8,
        commercialScore: 0.8,
        affinityScore: 0.5,
        affinityConfidence: "medium",
        ranking: { rank: 1, score: 0.8 },
        relationship: { type: "frequently_bought_together", reliability: 0.6, evidence: { jointCount: 4, support: 0.1, confidence: 0.5, lift: 1.2 } },
        commercialReason: { code: "FREQUENTLY_BOUGHT_TOGETHER", label: "Comprado frecuentemente junto al producto consultado" },
        reasons: [{ code: "STRONG_COMMERCIAL_RELEVANCE", source: "commercial" }],
        warnings: []
      }
    ],
    excluded: [],
    personalization: { applied: false, reason: "customer_not_provided" },
    snapshot: { id: "snap-1", modelVersion: "v1" },
    warnings: [],
    statistics: { commercialCandidates: 1, affinityCandidates: 0, personalizedRecommendations: 0, excludedRecommendations: 0, customerAffinityCalls: 0, personalizationCalls: 0, degradedStages: 0, warningsGenerated: 0 },
    execution: { correlationId: "corr", degraded: false, degradationReasons: [], stages: { commercialRecommendation: "completed", customerAffinity: "skipped", personalization: "completed" } },
    ...overrides
  };
}

function contextFixture(overrides: Partial<{ masterCustomerId: string; explicitExcludedProducts: readonly ProductReference[]; explicitRepurchaseRequested: boolean }> = {}): CustomerRecommendationContext {
  return {
    contextVersion: "customer-recommendation-context-v1",
    masterCustomerId: overrides.masterCustomerId ?? "555",
    profileStatus: "available",
    availability: { purchasedProductsAvailable: true, purchaseBehaviorAvailable: true },
    recommendationIntent: {
      sourceProduct: { productId: 100 },
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

// 1. Identified mode
test("integration: identified mode reaches the real server with customer + context.customerId", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const result = await makeCapability().execute({ recommendationContext: contextFixture({ masterCustomerId: "555" }) });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.customerMode, "identified");
  const sentBody = JSON.parse(lastBody);
  assert.deepEqual(sentBody.customer, { customerId: "555" });
  assert.equal(sentBody.context.customerId, "555");
});

// 2. Generic mode
test("integration: generic mode reaches the real server with no customer field", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const result = await makeCapability().execute({ sourceProduct: { productId: 100 }, query: "banca ajustable" });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.customerMode, "generic");
  const sentBody = JSON.parse(lastBody);
  assert.equal("customer" in sentBody, false);
});

// 3. Exclusions
test("integration: exclusions are serialized and accepted by the real client/server", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const result = await makeCapability().execute({
    recommendationContext: contextFixture({ masterCustomerId: "555", explicitExcludedProducts: [{ productId: 20 }, { productId: 20, combinationId: 3 }] })
  });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.metadata.excludedProductCount, 2);
  const sentBody = JSON.parse(lastBody);
  assert.deepEqual(sentBody.context.excludedProducts, [{ productId: "20" }, { productId: "20", combinationId: "3" }]);
});

// 4. Explicit repurchase
test("integration: explicit repurchase is serialized and accepted by the real client/server", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const result = await makeCapability().execute({ recommendationContext: contextFixture({ masterCustomerId: "555", explicitRepurchaseRequested: true }) });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.metadata.explicitRepurchaseApplied, true);
  const sentBody = JSON.parse(lastBody);
  assert.deepEqual(sentBody.context.explicitRepurchaseProducts, [{ productId: "100" }]);
});

// 5. Empty result
test("integration: empty recommendations from the real server stays completed", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse({ recommendations: [], warnings: [{ code: "NO_COMMERCIAL_CANDIDATES" }] }));
  const result = await makeCapability().execute({ sourceProduct: { productId: 100 } });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.deepEqual(result.recommendations, []);
  assert.equal(result.metadata.recommendationCount, 0);
});

// 6. HTTP 200 degraded
test("integration: HTTP 200 degraded=true from the real server stays completed with metadata.degraded=true", async () => {
  handler = (_req, res) =>
    sendJson(
      res,
      200,
      baseResponse({
        execution: { correlationId: "corr", degraded: true, degradationReasons: ["CUSTOMER_AFFINITY_RETRYABLE_FAILURE"], stages: { commercialRecommendation: "completed", customerAffinity: "degraded", personalization: "skipped" } }
      })
    );
  const result = await makeCapability().execute({ sourceProduct: { productId: 100 } });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.metadata.degraded, true);
  assert.equal(result.recommendations.length, 1);
});

// 7. HTTP 404 source not found
test("integration: HTTP 404 SOURCE_PRODUCT_NOT_FOUND from the real server yields failed with the remote code preserved", async () => {
  handler = (_req, res) => sendJson(res, 404, { error: { code: "SOURCE_PRODUCT_NOT_FOUND", message: "Producto fuente no encontrado.", retryable: false } });
  const result = await makeCapability().execute({ sourceProduct: { productId: 100 } });
  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.error.code, "catalog_service_error");
  assert.equal(result.error.httpStatus, 404);
  assert.equal(result.error.providerErrorCode, "SOURCE_PRODUCT_NOT_FOUND");
});

// 8. HTTP 503
test("integration: HTTP 503 from the real server yields a retryable failed result", async () => {
  handler = (_req, res) => sendJson(res, 503, { error: { code: "CATALOG_SERVICE_UNAVAILABLE", message: "Servicio no disponible.", retryable: true } });
  const result = await makeCapability().execute({ sourceProduct: { productId: 100 } });
  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.error.code, "catalog_service_error");
  assert.equal(result.error.httpStatus, 503);
  assert.equal(result.error.retryable, true);
});

// 9. Timeout
test("integration: a server that never responds yields a retryable timeout failed result", async () => {
  handler = () => {
    /* never responds - the real client's own internal timeout must fire */
  };
  const result = await makeCapability({ timeoutMs: 100 }).execute({ sourceProduct: { productId: 100 } });
  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.error.code, "timeout");
  assert.equal(result.error.retryable, true);
});

// 10. Correlation header
test("integration: correlationId is delivered as x-correlation-id header, never inside the body", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const result = await makeCapability().execute({ sourceProduct: { productId: 100 }, correlationId: "corr-integration-1" });
  assert.equal(result.status, "completed");
  assert.equal(lastHeaders["x-correlation-id"], "corr-integration-1");
  assert.equal(lastBody.includes("corr-integration-1"), false);
});

// Skipped: mapper never calls the real server
test("integration: a skipped mapper result never reaches the real server", async () => {
  let called = false;
  handler = (_req, res) => {
    called = true;
    sendJson(res, 200, baseResponse());
  };
  const result = await makeCapability().execute({});
  assert.equal(result.status, "skipped");
  if (result.status !== "skipped") return;
  assert.equal(result.reason, "source_product_missing");
  assert.equal(called, false);
});
