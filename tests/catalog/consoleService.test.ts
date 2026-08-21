import assert from "node:assert/strict";
import test from "node:test";
import {
  getCatalogConsoleProductContext,
  searchCatalogConsoleProducts,
  statusForCatalogConsoleError,
  type CatalogConsoleError
} from "../../lib/catalog/consoleService";
import type { CatalogPort, CatalogProduct, CatalogSearchResult } from "../../lib/catalog/types";
import type {
  CatalogSearchProductsV2Client,
  SearchProductsV2ClientCallContext,
  SearchProductsV2ClientRequest,
  SearchProductsV2ClientResult,
  SearchProductsV2ProductSummary,
  SearchProductsV2Recommendation
} from "../../lib/catalog/search-products-v2/types";

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    productId: "10",
    name: "Banda de Resistencia Medium 32mm 80Lbs Morado | HWM",
    sku: "HWM-10",
    shortDescription: "Banda medium",
    longDescription: "Banda de resistencia para entrenamiento funcional",
    active: true,
    selectedVariant: null,
    variants: [],
    price: { amount: 12990, currency: "CLP", taxIncluded: true, taxRate: 0.19, discountApplied: false },
    availability: "in_stock",
    stockQuantity: 12,
    weightKg: 0.4,
    publicLink: {
      canonicalUrl: "https://pesaschile.cl/banda-10.html",
      scope: "exact_product",
      available: true,
      requiresVariantSelection: false,
      variantAttributeLabels: []
    },
    provenance: { source: "catalog_service_http", retrievedAt: "2026-08-21T00:00:00.000Z", cached: false },
    ...overrides
  };
}

function productSummary(overrides: Partial<SearchProductsV2ProductSummary> = {}): SearchProductsV2ProductSummary {
  return {
    productId: "10",
    name: "Banda de Resistencia Medium 32mm 80Lbs Morado | HWM",
    reference: "HWM-10",
    description: "Banda medium",
    active: true,
    price: { amount: 12990, currency: "CLP" },
    stock: { status: "in_stock", quantity: 12, available: true },
    availability: {
      status: "available",
      purchasable: true,
      active: true,
      availableForOrder: true,
      stockQuantity: 12,
      stockKnown: true,
      evaluatedAt: "2026-08-21T00:00:00.000Z"
    },
    publicLink: {
      canonicalUrl: "https://pesaschile.cl/banda-10.html",
      scope: "exact_product",
      available: true,
      requiresVariantSelection: false,
      variantAttributeLabels: []
    },
    ...overrides
  };
}

function recommendation(overrides: Partial<SearchProductsV2Recommendation> = {}): SearchProductsV2Recommendation {
  return {
    product: productSummary({ productId: "9", name: "Banda de Resistencia Light 22mm 50Lbs" }),
    rank: 1,
    score: 0.91,
    commercialScore: 0.88,
    affinityScore: 0,
    affinityConfidence: "none",
    ranking: { rank: 1, score: 0.91 },
    relationship: {
      type: "frequently_bought_together",
      reliability: 0.74,
      evidence: { jointCount: 8, support: 0.12, confidence: 0.42, lift: 2.1 }
    },
    commercialReason: { code: "FREQUENTLY_BOUGHT_TOGETHER", label: "Comprado frecuentemente junto al producto consultado" },
    reasons: [{ code: "STRONG_COMMERCIAL_RELEVANCE", source: "commercial" }],
    warnings: [],
    ...overrides
  };
}

function recommendationsResponse(recommendations: SearchProductsV2Recommendation[] = [recommendation()]): SearchProductsV2ClientResult {
  return {
    ok: true,
    value: {
      query: null,
      sourceProduct: productSummary(),
      recommendations,
      excluded: [],
      personalization: { applied: false, reason: "customer_not_provided" },
      snapshot: { id: "snapshot-1", modelVersion: "v1" },
      warnings: [],
      statistics: {
        commercialCandidates: recommendations.length,
        affinityCandidates: 0,
        personalizedRecommendations: recommendations.length,
        excludedRecommendations: 0,
        customerAffinityCalls: 0,
        personalizationCalls: 0,
        degradedStages: 0,
        warningsGenerated: 0
      },
      execution: {
        correlationId: "corr-1",
        degraded: false,
        degradationReasons: [],
        stages: { commercialRecommendation: "completed", customerAffinity: "skipped", personalization: "skipped" }
      }
    }
  };
}

function fakeCatalogPort(overrides: Partial<CatalogPort> = {}): CatalogPort {
  return {
    async searchProducts(_input, _context) {
      const result: CatalogSearchResult = {
        query: "banda",
        items: [
          {
            productId: "10",
            combinationId: "0",
            sku: "HWM-10",
            name: "Banda de Resistencia Medium 32mm 80Lbs Morado | HWM",
            variantLabel: null,
            shortDescription: "Banda medium",
            stockQuantity: 12,
            availability: "in_stock",
            matchType: "partial_name"
          }
        ],
        provenance: { source: "catalog_service_http", retrievedAt: "2026-08-21T00:00:00.000Z", cached: false }
      };
      return { ok: true, value: result };
    },
    async getProductDetails(_input, _context) {
      return { ok: true, value: product() };
    },
    async batchGetProducts() {
      throw new Error("not used");
    },
    async exploreCatalog() {
      throw new Error("not used");
    },
    ...overrides
  };
}

function fakeRecommendationsClient(fn?: (request: SearchProductsV2ClientRequest, context?: SearchProductsV2ClientCallContext) => SearchProductsV2ClientResult | Promise<SearchProductsV2ClientResult>): CatalogSearchProductsV2Client {
  return {
    async searchProducts(request, context) {
      return fn ? fn(request, context) : recommendationsResponse();
    }
  };
}

test("search validates query before reaching Catalog Service", async () => {
  let calls = 0;
  const port = fakeCatalogPort({
    async searchProducts() {
      calls += 1;
      throw new Error("must not be called");
    }
  });

  const result = await searchCatalogConsoleProducts("   ", 10, { catalogPort: port });
  assert.equal(result.ok, false);
  assert.equal(calls, 0);
  if (!result.ok) assert.equal(result.error.code, "invalid_query");
});

test("search maps result rows without inventing price", async () => {
  const result = await searchCatalogConsoleProducts(" banda ", 10, { catalogPort: fakeCatalogPort() });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.query, "banda");
  assert.equal(result.items[0].productId, "10");
  assert.equal(result.items[0].price, null);
  assert.equal(result.items[0].stock.quantity, 12);
});

test("context calls recommendations V2 without customer and returns detail plus recommendations", async () => {
  let capturedRequest: SearchProductsV2ClientRequest | null = null;
  const result = await getCatalogConsoleProductContext("10", {
    catalogPort: fakeCatalogPort(),
    recommendationsClient: fakeRecommendationsClient((request) => {
      capturedRequest = request;
      return recommendationsResponse();
    }),
    correlationId: "corr-test"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(capturedRequest, { sourceProduct: { productId: "10" }, limit: 5 });
  if (!result.ok) return;
  assert.equal(result.product.name.includes("Banda de Resistencia Medium"), true);
  assert.equal(result.recommendations.status, "available");
  if (result.recommendations.status === "available") {
    assert.equal(result.recommendations.items[0].commercialReason, "Comprado frecuentemente junto al producto consultado");
    assert.equal(result.recommendations.items[0].relationship.evidence.jointCount, 8);
  }
});

test("empty recommendations are successful empty state, not an error", async () => {
  const result = await getCatalogConsoleProductContext("10", {
    catalogPort: fakeCatalogPort(),
    recommendationsClient: fakeRecommendationsClient(() => recommendationsResponse([]))
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.recommendations.status, "empty");
});

test("product detail still renders when recommendation engine fails", async () => {
  const result = await getCatalogConsoleProductContext("10", {
    catalogPort: fakeCatalogPort(),
    recommendationsClient: fakeRecommendationsClient(() => ({
      ok: false,
      error: { code: "timeout", message: "Catalog service request timed out.", retryable: true }
    }))
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.product.productId, "10");
  assert.equal(result.recommendations.status, "error");
  if (result.recommendations.status === "error") assert.equal(result.recommendations.error.code, "catalog_timeout");
});

test("invalid product id is rejected before server-side catalog clients are needed", async () => {
  const result = await getCatalogConsoleProductContext("../secret", {
    catalogPort: fakeCatalogPort(),
    recommendationsClient: fakeRecommendationsClient()
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "invalid_product_id");
    assert.equal(statusForCatalogConsoleError(result.error), 400);
  }
});

test("status mapping keeps upstream unauthorized distinct from browser auth", () => {
  const error: CatalogConsoleError = { code: "catalog_unauthorized", message: "bad key", retryable: false };
  assert.equal(statusForCatalogConsoleError(error), 502);
});
