import assert from "node:assert/strict";
import test from "node:test";
import { CATALOG_RELATED_MAX_DEPTH, createRelatedRecommendationsCache } from "../../components/catalog/relatedRecommendationsCache";
import type { CatalogProductContextResult } from "../../lib/catalog/consoleService";

function okContext(productId: string): CatalogProductContextResult {
  return {
    ok: true,
    product: {
      productId,
      name: `Producto ${productId}`,
      reference: null,
      description: null,
      price: null,
      stock: { quantity: null, status: "unknown", available: null },
      availability: "unknown",
      active: null,
      publicLink: null,
      source: "recommendations_v2"
    },
    recommendations: {
      status: "empty",
      requestedLimit: 5,
      shownCount: 0,
      truncatedByLimitCount: 0,
      excluded: [],
      statistics: {
        recommendationsReturned: 0,
        commercialCandidates: 0,
        affinityCandidates: 0,
        personalizedRecommendations: 0,
        excludedRecommendations: 0,
        warningsGenerated: 0
      },
      warnings: [],
      execution: { degraded: false, stages: { commercialRecommendation: "completed", customerAffinity: "skipped", personalization: "skipped" } },
      snapshot: { id: "snapshot-1", modelVersion: "v1" }
    },
    semantics: { status: "not_available" },
    warnings: []
  };
}

test("related recommendations cache does not prefetch before branch expansion", () => {
  let calls = 0;
  createRelatedRecommendationsCache(async () => {
    calls += 1;
    return okContext("437");
  });

  assert.equal(calls, 0);
});

test("related recommendations cache loads by productId and limit, then reuses success", async () => {
  const requests: Array<{ productId: string; limit: number }> = [];
  const cache = createRelatedRecommendationsCache(async (productId, limit) => {
    requests.push({ productId, limit });
    return okContext(productId);
  });

  const first = await cache.load("437", 5);
  const second = await cache.load("437", 5);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(requests, [{ productId: "437", limit: 5 }]);
  assert.equal(cache.size(), 1);
});

test("related recommendations cache keeps distinct limits isolated", async () => {
  const requests: Array<{ productId: string; limit: number }> = [];
  const cache = createRelatedRecommendationsCache(async (productId, limit) => {
    requests.push({ productId, limit });
    return okContext(productId);
  });

  await cache.load("437", 5);
  await cache.load("437", 10);

  assert.deepEqual(requests, [
    { productId: "437", limit: 5 },
    { productId: "437", limit: 10 }
  ]);
  assert.equal(cache.size(), 2);
});

test("related recommendations cache does not cache errors so retry can recover", async () => {
  let calls = 0;
  const cache = createRelatedRecommendationsCache(async () => {
    calls += 1;
    if (calls === 1) {
      return { ok: false, error: { code: "catalog_timeout", message: "timeout", retryable: true } };
    }
    return okContext("437");
  });

  const first = await cache.load("437", 5);
  const second = await cache.load("437", 5);

  assert.equal(first.ok, false);
  assert.equal(second.ok, true);
  assert.equal(calls, 2);
  assert.equal(cache.size(), 1);
});

test("relationship explorer max depth is fixed at two levels", () => {
  assert.equal(CATALOG_RELATED_MAX_DEPTH, 2);
});
