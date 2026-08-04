import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { buildSearchProductsV2Request } from "../../lib/brain/commercial/recommendation-context/buildSearchProductsV2Request";
import type { CustomerRecommendationContext } from "../../lib/brain/commercial/recommendation-context/types";
import { createHttpCatalogSearchProductsV2Client } from "../../lib/catalog/search-products-v2/httpCatalogSearchProductsV2Client";

/**
 * CP-R1-T10B6 compatibility: the requests this mapper produces must never
 * be rejected by the real CP-R1-T10B5 client's own request validation. No
 * mocked fetch, no re-implementation of T10B5's parser - this exercises the
 * real client against a real local http server, exactly like T10B5's own
 * test suite.
 */

let server: http.Server;
let baseUrl: string;
let lastMethod = "";
let lastUrl = "";
let lastHeaders: http.IncomingHttpHeaders = {};
let lastBody = "";

before(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      lastMethod = req.method ?? "";
      lastUrl = req.url ?? "";
      lastHeaders = req.headers;
      lastBody = Buffer.concat(chunks).toString("utf8");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          query: null,
          sourceProduct: { productId: "100", name: "Producto", active: true, price: null, stock: { status: "unknown", available: false } },
          recommendations: [],
          excluded: [],
          personalization: { applied: false, reason: "customer_not_provided" },
          snapshot: { id: "snap-1", modelVersion: "v1" },
          warnings: [],
          statistics: { commercialCandidates: 0, affinityCandidates: 0, personalizedRecommendations: 0, excludedRecommendations: 0, customerAffinityCalls: 0, personalizationCalls: 0, degradedStages: 0, warningsGenerated: 0 },
          execution: { correlationId: "corr", degraded: false, degradationReasons: [], stages: { commercialRecommendation: "completed", customerAffinity: "skipped", personalization: "completed" } }
        })
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function makeClient() {
  return createHttpCatalogSearchProductsV2Client({ baseUrl, apiKey: "test-key", timeoutMs: 500 });
}

function contextFixture(overrides: Partial<{ masterCustomerId: string; explicitExcludedProducts: CustomerRecommendationContext["recommendationIntent"]["explicitExcludedProducts"]; explicitRepurchaseRequested: boolean }> = {}): CustomerRecommendationContext {
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

test("a generic (no identity) request produced by the mapper is accepted by the T10B5 client", async () => {
  const built = buildSearchProductsV2Request({ sourceProduct: { productId: 100 }, query: "banca ajustable" });
  if (built.status !== "ready") throw new Error("expected ready");
  const result = await makeClient().searchProducts(built.request, built.callContext);
  assert.equal(result.ok, true);
  assert.equal(lastMethod, "POST");
  assert.equal(lastUrl, "/api/v2/recommendations/search-products");
  const sentBody = JSON.parse(lastBody);
  assert.deepEqual(sentBody.sourceProduct, { productId: "100" });
  assert.equal(sentBody.query, "banca ajustable");
  assert.equal("customer" in sentBody, false);
  assert.equal("context" in sentBody, false);
});

test("an identified request (masterCustomerId present) produced by the mapper is accepted by the T10B5 client", async () => {
  const built = buildSearchProductsV2Request({ recommendationContext: contextFixture({ masterCustomerId: "555" }) });
  if (built.status !== "ready") throw new Error("expected ready");
  const result = await makeClient().searchProducts(built.request, built.callContext);
  assert.equal(result.ok, true);
  const sentBody = JSON.parse(lastBody);
  assert.deepEqual(sentBody.customer, { customerId: "555" });
  assert.equal(sentBody.context.customerId, "555");
});

test("a request with exclusions produced by the mapper is accepted by the T10B5 client", async () => {
  const built = buildSearchProductsV2Request({
    recommendationContext: contextFixture({ masterCustomerId: "555", explicitExcludedProducts: [{ productId: 20 }, { productId: 20, combinationId: 3 }] })
  });
  if (built.status !== "ready") throw new Error("expected ready");
  const result = await makeClient().searchProducts(built.request, built.callContext);
  assert.equal(result.ok, true);
  const sentBody = JSON.parse(lastBody);
  assert.deepEqual(sentBody.context.excludedProducts, [{ productId: "20" }, { productId: "20", combinationId: "3" }]);
});

test("a request with explicit repurchase produced by the mapper is accepted by the T10B5 client", async () => {
  const built = buildSearchProductsV2Request({ recommendationContext: contextFixture({ masterCustomerId: "555", explicitRepurchaseRequested: true }) });
  if (built.status !== "ready") throw new Error("expected ready");
  const result = await makeClient().searchProducts(built.request, built.callContext);
  assert.equal(result.ok, true);
  const sentBody = JSON.parse(lastBody);
  assert.deepEqual(sentBody.context.explicitRepurchaseProducts, [{ productId: "100" }]);
});

test("correlationId from callContext is delivered as the x-correlation-id header, never inside the body", async () => {
  const built = buildSearchProductsV2Request({ sourceProduct: { productId: 100 }, correlationId: "corr-compat-1" });
  if (built.status !== "ready") throw new Error("expected ready");
  const result = await makeClient().searchProducts(built.request, built.callContext);
  assert.equal(result.ok, true);
  assert.equal(lastHeaders["x-correlation-id"], "corr-compat-1");
  assert.equal(lastBody.includes("corr-compat-1"), false);
});
