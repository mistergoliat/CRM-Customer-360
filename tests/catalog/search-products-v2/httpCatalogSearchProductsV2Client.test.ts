import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import {
  CatalogSearchProductsV2ConfigurationError,
  createCatalogSearchProductsV2Client,
  createHttpCatalogSearchProductsV2Client,
  readHttpCatalogSearchProductsV2ClientConfig
} from "../../../lib/catalog/search-products-v2/httpCatalogSearchProductsV2Client";
import type { CatalogSearchProductsV2Client, SearchProductsV2ClientRequest } from "../../../lib/catalog/search-products-v2/types";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void;

let server: http.Server;
let baseUrl: string;
let handler: Handler = (_req, res) => res.writeHead(500).end();
let requestCount = 0;
let lastMethod = "";
let lastUrl = "";
let lastHeaders: http.IncomingHttpHeaders = {};
let lastBody = "";

before(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      requestCount += 1;
      lastMethod = req.method ?? "";
      lastUrl = req.url ?? "";
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
  requestCount = 0;
  lastMethod = "";
  lastUrl = "";
  lastHeaders = {};
  lastBody = "";
  handler = (_req, res) => res.writeHead(500).end();
});

function makeClient(overrides: Partial<{ apiKey: string; timeoutMs: number }> = {}): CatalogSearchProductsV2Client {
  return createHttpCatalogSearchProductsV2Client({ baseUrl, apiKey: overrides.apiKey ?? "test-key", timeoutMs: overrides.timeoutMs ?? 500 });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

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
    relationship: {
      type: "frequently_bought_together",
      reliability: 0.7,
      evidence: { jointCount: 12, support: 0.2, confidence: 0.6, lift: 1.4 }
    },
    commercialReason: { code: "FREQUENTLY_BOUGHT_TOGETHER", label: "Comprado frecuentemente junto al producto consultado" },
    reasons: [{ code: "STRONG_COMMERCIAL_RELEVANCE", source: "commercial" }],
    warnings: [],
    ...overrides
  };
}

function baseResponse(overrides: Record<string, unknown> = {}) {
  return {
    query: null,
    sourceProduct: productSummary(),
    recommendations: [recommendation()],
    excluded: [],
    personalization: { applied: false, reason: "customer_not_provided" },
    snapshot: { id: "snap-1", modelVersion: "v1" },
    warnings: [],
    statistics: {
      commercialCandidates: 1,
      affinityCandidates: 0,
      personalizedRecommendations: 1,
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
      stages: { commercialRecommendation: "completed", customerAffinity: "skipped", personalization: "completed" }
    },
    ...overrides
  };
}

function minimalRequest(overrides: Partial<SearchProductsV2ClientRequest> = {}): SearchProductsV2ClientRequest {
  return { sourceProduct: { productId: "173" }, ...overrides };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ENV_KEYS = ["CATALOG_SERVICE_BASE_URL", "CATALOG_SERVICE_API_KEY", "CATALOG_SEARCH_PRODUCTS_V2_TIMEOUT_MS"] as const;

async function withEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => void | Promise<void>): Promise<void> {
  const original: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) original[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
  try {
    await fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

test("readHttpCatalogSearchProductsV2ClientConfig returns null when base URL is absent", async () => {
  await withEnv({ CATALOG_SERVICE_API_KEY: "key" }, () => {
    assert.equal(readHttpCatalogSearchProductsV2ClientConfig(), null);
  });
});

test("readHttpCatalogSearchProductsV2ClientConfig returns null when api key is absent", async () => {
  await withEnv({ CATALOG_SERVICE_BASE_URL: baseUrl }, () => {
    assert.equal(readHttpCatalogSearchProductsV2ClientConfig(), null);
  });
});

test("readHttpCatalogSearchProductsV2ClientConfig returns null when both are absent", async () => {
  await withEnv({}, () => {
    assert.equal(readHttpCatalogSearchProductsV2ClientConfig(), null);
  });
});

test("readHttpCatalogSearchProductsV2ClientConfig normalizes a trailing-slash base URL and applies the default timeout", async () => {
  await withEnv({ CATALOG_SERVICE_BASE_URL: `${baseUrl}///`, CATALOG_SERVICE_API_KEY: "key" }, () => {
    const config = readHttpCatalogSearchProductsV2ClientConfig();
    assert.equal(config?.baseUrl, baseUrl);
    assert.equal(config?.timeoutMs, 3000);
  });
});

test("readHttpCatalogSearchProductsV2ClientConfig honors a configured integer timeout", async () => {
  await withEnv({ CATALOG_SERVICE_BASE_URL: baseUrl, CATALOG_SERVICE_API_KEY: "key", CATALOG_SEARCH_PRODUCTS_V2_TIMEOUT_MS: "1234" }, () => {
    assert.equal(readHttpCatalogSearchProductsV2ClientConfig()?.timeoutMs, 1234);
  });
});

test("readHttpCatalogSearchProductsV2ClientConfig throws on a relative base URL", async () => {
  await withEnv({ CATALOG_SERVICE_BASE_URL: "/not-absolute", CATALOG_SERVICE_API_KEY: "key" }, () => {
    assert.throws(() => readHttpCatalogSearchProductsV2ClientConfig(), CatalogSearchProductsV2ConfigurationError);
  });
});

test("readHttpCatalogSearchProductsV2ClientConfig throws on a non-http(s) protocol", async () => {
  await withEnv({ CATALOG_SERVICE_BASE_URL: "ftp://example.com", CATALOG_SERVICE_API_KEY: "key" }, () => {
    assert.throws(() => readHttpCatalogSearchProductsV2ClientConfig(), CatalogSearchProductsV2ConfigurationError);
  });
});

test("readHttpCatalogSearchProductsV2ClientConfig throws on embedded credentials", async () => {
  await withEnv({ CATALOG_SERVICE_BASE_URL: "http://user:pass@example.com", CATALOG_SERVICE_API_KEY: "key" }, () => {
    assert.throws(() => readHttpCatalogSearchProductsV2ClientConfig(), CatalogSearchProductsV2ConfigurationError);
  });
});

test("readHttpCatalogSearchProductsV2ClientConfig throws on a query string", async () => {
  await withEnv({ CATALOG_SERVICE_BASE_URL: "http://example.com?x=1", CATALOG_SERVICE_API_KEY: "key" }, () => {
    assert.throws(() => readHttpCatalogSearchProductsV2ClientConfig(), CatalogSearchProductsV2ConfigurationError);
  });
});

test("readHttpCatalogSearchProductsV2ClientConfig throws on a fragment", async () => {
  await withEnv({ CATALOG_SERVICE_BASE_URL: "http://example.com#frag", CATALOG_SERVICE_API_KEY: "key" }, () => {
    assert.throws(() => readHttpCatalogSearchProductsV2ClientConfig(), CatalogSearchProductsV2ConfigurationError);
  });
});

test("readHttpCatalogSearchProductsV2ClientConfig throws on a non-integer timeout", async () => {
  await withEnv({ CATALOG_SERVICE_BASE_URL: baseUrl, CATALOG_SERVICE_API_KEY: "key", CATALOG_SEARCH_PRODUCTS_V2_TIMEOUT_MS: "5000.5" }, () => {
    assert.throws(() => readHttpCatalogSearchProductsV2ClientConfig(), CatalogSearchProductsV2ConfigurationError);
  });
});

test("readHttpCatalogSearchProductsV2ClientConfig throws on a zero or negative timeout", async () => {
  await withEnv({ CATALOG_SERVICE_BASE_URL: baseUrl, CATALOG_SERVICE_API_KEY: "key", CATALOG_SEARCH_PRODUCTS_V2_TIMEOUT_MS: "0" }, () => {
    assert.throws(() => readHttpCatalogSearchProductsV2ClientConfig(), CatalogSearchProductsV2ConfigurationError);
  });
});

test("readHttpCatalogSearchProductsV2ClientConfig throws on a timeout beyond the maximum bound", async () => {
  await withEnv({ CATALOG_SERVICE_BASE_URL: baseUrl, CATALOG_SERVICE_API_KEY: "key", CATALOG_SEARCH_PRODUCTS_V2_TIMEOUT_MS: "999999" }, () => {
    assert.throws(() => readHttpCatalogSearchProductsV2ClientConfig(), CatalogSearchProductsV2ConfigurationError);
  });
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

test("createCatalogSearchProductsV2Client returns a fail-closed client when not configured, without ever calling fetch", async () => {
  await withEnv({}, async () => {
    const client = createCatalogSearchProductsV2Client();
    const result = await client.searchProducts(minimalRequest());
    assert.deepEqual(result, { ok: false, error: { code: "configuration_error", message: "Catalog service SearchProducts V2 client is not configured.", retryable: false } });
    assert.equal(requestCount, 0);
  });
});

test("createCatalogSearchProductsV2Client builds a real client when configured, and does not call fetch at construction time", async () => {
  await withEnv({ CATALOG_SERVICE_BASE_URL: baseUrl, CATALOG_SERVICE_API_KEY: "test-key" }, async () => {
    const client = createCatalogSearchProductsV2Client();
    assert.equal(requestCount, 0);
    handler = (_req, res) => sendJson(res, 200, baseResponse());
    const result = await client.searchProducts(minimalRequest());
    assert.equal(result.ok, true);
    assert.equal(requestCount, 1);
  });
});

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

test("sends a POST to the correct path with the correct headers and body", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const result = await makeClient().searchProducts(minimalRequest({ query: "banca" }), { correlationId: "corr-req-1" });
  assert.equal(result.ok, true);
  assert.equal(lastMethod, "POST");
  assert.equal(lastUrl, "/api/v2/recommendations/search-products");
  assert.equal(lastHeaders["content-type"], "application/json");
  assert.equal(lastHeaders.accept, "application/json");
  assert.equal(lastHeaders["x-api-key"], "test-key");
  assert.equal(lastHeaders["x-correlation-id"], "corr-req-1");
  assert.deepEqual(JSON.parse(lastBody), { sourceProduct: { productId: "173" }, query: "banca" });
});

test("omits the x-correlation-id header when no correlationId is given", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  await makeClient().searchProducts(minimalRequest());
  assert.equal("x-correlation-id" in lastHeaders, false);
});

test("preserves productId and combinationId as strings, never coerced to Number", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  await makeClient().searchProducts(minimalRequest({ sourceProduct: { productId: "00173", combinationId: "007" } }));
  const body = JSON.parse(lastBody);
  assert.equal(body.sourceProduct.productId, "00173");
  assert.equal(body.sourceProduct.combinationId, "007");
});

test("sends customer, context product arrays, filters and limit exactly as an explicit allowlist", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const request = minimalRequest({
    customer: { customerId: "555" },
    context: {
      customerId: "555",
      intent: "gift",
      useCase: "home_gym",
      budget: { amount: 50000, currency: "CLP" },
      preferredProducts: [{ productId: "10" }],
      excludedProducts: [{ productId: "11", combinationId: "2" }],
      explicitRepurchaseProducts: [{ productId: "12" }]
    },
    filters: { inStockOnly: true },
    limit: 8
  });
  await makeClient().searchProducts(request);
  assert.deepEqual(JSON.parse(lastBody), {
    sourceProduct: { productId: "173" },
    customer: { customerId: "555" },
    context: {
      customerId: "555",
      intent: "gift",
      useCase: "home_gym",
      budget: { amount: 50000, currency: "CLP" },
      preferredProducts: [{ productId: "10" }],
      excludedProducts: [{ productId: "11", combinationId: "2" }],
      explicitRepurchaseProducts: [{ productId: "12" }]
    },
    filters: { inStockOnly: true },
    limit: 8
  });
});

test("never sends filters.productIds even if a caller-shaped object smuggled one in", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const request = minimalRequest({ filters: { inStockOnly: true, productIds: ["1", "2"] } as unknown as SearchProductsV2ClientRequest["filters"] });
  await makeClient().searchProducts(request);
  assert.deepEqual(JSON.parse(lastBody).filters, { inStockOnly: true });
});

test("does not mutate the caller's request object or its arrays", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const preferredProducts = [{ productId: "10" }];
  const request = minimalRequest({ context: { preferredProducts } });
  const snapshot = JSON.stringify(request);
  await makeClient().searchProducts(request);
  assert.equal(JSON.stringify(request), snapshot);
  assert.equal(request.context?.preferredProducts, preferredProducts);
  assert.equal(preferredProducts.length, 1);
});

test("rejects an invalid request without making a physical network call", async () => {
  const client = makeClient();
  const cases: SearchProductsV2ClientRequest[] = [
    minimalRequest({ sourceProduct: { productId: "" } }),
    minimalRequest({ query: "" }),
    minimalRequest({ query: "x".repeat(241) }),
    minimalRequest({ limit: 0 }),
    minimalRequest({ limit: 21 }),
    minimalRequest({ limit: 1.5 }),
    minimalRequest({ customer: { customerId: "unknown" } }),
    minimalRequest({ customer: { customerId: "0" } }),
    minimalRequest({ customer: { customerId: "5" }, context: { customerId: "6" } }),
    minimalRequest({ context: { preferredProducts: [{ productId: "1" }, { productId: "1" }] } }),
    minimalRequest({ context: { excludedProducts: [{ productId: "1" }], explicitRepurchaseProducts: [{ productId: "1" }] } })
  ];
  for (const request of cases) {
    const result = await client.searchProducts(request);
    assert.equal(result.ok, false, `expected invalid_request for ${JSON.stringify(request)}`);
    if (!result.ok) assert.equal(result.error.code, "invalid_request");
  }
  assert.equal(requestCount, 0);
});

test("trims query before both validating and serializing it", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const result = await makeClient().searchProducts(minimalRequest({ query: "  barra olimpica  " }));
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(lastBody).query, "barra olimpica");
});

test("rejects a whitespace-only query without a physical network call", async () => {
  const result = await makeClient().searchProducts(minimalRequest({ query: "   " }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "invalid_request");
  assert.equal(requestCount, 0);
});

test("accepts a query whose raw length exceeds 240 but whose trimmed length does not", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const padded = `  ${"a".repeat(240)}  `;
  assert.equal(padded.length > 240, true);
  const result = await makeClient().searchProducts(minimalRequest({ query: padded }));
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(lastBody).query, "a".repeat(240));
});

test("rejects a query whose trimmed length exceeds 240", async () => {
  const padded = `  ${"a".repeat(241)}  `;
  const result = await makeClient().searchProducts(minimalRequest({ query: padded }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "invalid_request");
  assert.equal(requestCount, 0);
});

test("omits the query field entirely when the request does not set it", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  await makeClient().searchProducts(minimalRequest());
  assert.equal("query" in JSON.parse(lastBody), false);
});

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

test("maps a full valid 200 response into the local shape", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse({ query: "banca" }));
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.query, "banca");
  assert.equal(result.value.sourceProduct.productId, "173");
  assert.equal(result.value.recommendations.length, 1);
  assert.equal(result.value.recommendations[0].rank, 1);
  assert.equal(result.value.recommendations[0].score, 0.87);
  assert.equal(result.value.recommendations[0].ranking.rank, 1);
  assert.equal(result.value.snapshot.modelVersion, "v1");
});

test("preserves ownership when present, including exact-variant purchase", async () => {
  handler = (_req, res) =>
    sendJson(
      res,
      200,
      baseResponse({
        recommendations: [
          recommendation({
            ownership: { previouslyPurchased: true, exactVariantPreviouslyPurchased: true, totalOrderCount: 3, firstPurchasedAt: "2025-01-01T00:00:00.000Z", lastPurchasedAt: "2025-06-01T00:00:00.000Z" }
          })
        ]
      })
    );
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.recommendations[0].ownership, {
    previouslyPurchased: true,
    exactVariantPreviouslyPurchased: true,
    totalOrderCount: 3,
    firstPurchasedAt: "2025-01-01T00:00:00.000Z",
    lastPurchasedAt: "2025-06-01T00:00:00.000Z"
  });
});

test("never fabricates ownership when the field is absent", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal("ownership" in result.value.recommendations[0], false);
});

test("rejects ownership where exactVariantPreviouslyPurchased is true but previouslyPurchased is false", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse({ recommendations: [recommendation({ ownership: { previouslyPurchased: false, exactVariantPreviouslyPurchased: true } })] }));
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "invalid_response_schema");
});

test("rejects ownership where firstPurchasedAt is after lastPurchasedAt", async () => {
  handler = (_req, res) =>
    sendJson(res, 200, baseResponse({ recommendations: [recommendation({ ownership: { previouslyPurchased: true, exactVariantPreviouslyPurchased: false, firstPurchasedAt: "2025-06-01T00:00:00.000Z", lastPurchasedAt: "2025-01-01T00:00:00.000Z" } })] }));
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "invalid_response_schema");
});

test("preserves a global warning (no product) and a product-scoped warning separately", async () => {
  handler = (_req, res) =>
    sendJson(
      res,
      200,
      baseResponse({
        warnings: [{ code: "NO_COMMERCIAL_CANDIDATES" }],
        recommendations: [recommendation({ warnings: [{ code: "UPSTREAM_COMMERCIAL_WARNING", product: { productId: "200" } }] })]
      })
    );
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.warnings, [{ code: "NO_COMMERCIAL_CANDIDATES" }]);
  assert.deepEqual(result.value.recommendations[0].warnings, [{ code: "UPSTREAM_COMMERCIAL_WARNING", product: { productId: "200" } }]);
});

test("preserves personalization applied=true with no reason", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse({ personalization: { applied: true, customerId: "555" } }));
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.personalization, { applied: true, customerId: "555" });
});

for (const reason of ["customer_not_provided", "customer_affinity_unavailable", "customer_reference_not_found", "customer_history_not_linked", "no_customer_history"] as const) {
  test(`preserves personalization applied=false with reason ${reason}`, async () => {
    handler = (_req, res) => sendJson(res, 200, baseResponse({ personalization: { applied: false, reason, ...(reason === "customer_not_provided" ? {} : { customerId: "555" }) } }));
    const result = await makeClient().searchProducts(minimalRequest());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.personalization.applied, false);
    assert.equal(result.value.personalization.reason, reason);
  });
}

test("execution.degraded=false is returned as a normal success", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.execution.degraded, false);
});

test("execution.degraded=true from a valid HTTP 200 is returned as a success, never an error", async () => {
  handler = (_req, res) =>
    sendJson(
      res,
      200,
      baseResponse({
        execution: {
          correlationId: "corr-degraded",
          degraded: true,
          degradationReasons: ["CUSTOMER_AFFINITY_RETRYABLE_FAILURE"],
          stages: { commercialRecommendation: "completed", customerAffinity: "degraded", personalization: "skipped" }
        }
      })
    );
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.execution.degraded, true);
  assert.deepEqual(result.value.execution.degradationReasons, ["CUSTOMER_AFFINITY_RETRYABLE_FAILURE"]);
});

test("rejects a response with an unknown top-level field (strict schema)", async () => {
  handler = (_req, res) => sendJson(res, 200, { ...baseResponse(), unexpectedField: true });
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "invalid_response_schema");
});

test("rejects a response missing a required field", async () => {
  const payload = baseResponse() as Record<string, unknown>;
  delete payload.statistics;
  handler = (_req, res) => sendJson(res, 200, payload);
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "invalid_response_schema");
});

test("normalizes a response string with peripheral whitespace to reflect the contract's trim transform", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse({ sourceProduct: productSummary({ name: "  Banca ajustable  " }) }));
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.sourceProduct.name, "Banca ajustable");
});

test("rejects a whitespace-only top-level response string", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse({ sourceProduct: productSummary({ name: "   " }) }));
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "invalid_response_schema");
});

test("rejects a whitespace-only string nested inside a recommendation (relationship.type)", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse({ recommendations: [recommendation({ relationship: { type: "   ", reliability: 0.7, evidence: { jointCount: 1, support: 0.1, confidence: 0.5, lift: 1 } } })] }));
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "invalid_response_schema");
});

test("accepts a canonical ISO-8601 ownership timestamp", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse({ recommendations: [recommendation({ ownership: { previouslyPurchased: true, exactVariantPreviouslyPurchased: false, firstPurchasedAt: "2025-01-01T00:00:00.000Z" } })] }));
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.recommendations[0].ownership?.firstPurchasedAt, "2025-01-01T00:00:00.000Z");
});

for (const nonCanonical of ["2025-01-01", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00.000+00:00", "2025-01-01T03:00:00.000-03:00", "not-a-date", ""]) {
  test(`rejects a non-canonical ISO ownership timestamp: ${JSON.stringify(nonCanonical)}`, async () => {
    handler = (_req, res) => sendJson(res, 200, baseResponse({ recommendations: [recommendation({ ownership: { previouslyPurchased: true, exactVariantPreviouslyPurchased: false, firstPurchasedAt: nonCanonical } })] }));
    const result = await makeClient().searchProducts(minimalRequest());
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "invalid_response_schema");
  });
}

test("rejects a null ownership timestamp", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse({ recommendations: [recommendation({ ownership: { previouslyPurchased: true, exactVariantPreviouslyPurchased: false, firstPurchasedAt: null } })] }));
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "invalid_response_schema");
});

// ---------------------------------------------------------------------------
// HTTP errors
// ---------------------------------------------------------------------------

test("maps 400 to invalid_request", async () => {
  handler = (_req, res) => sendJson(res, 400, { error: { code: "INVALID_REQUEST", message: "Invalid SearchProducts V2 request", retryable: false, correlationId: "corr" } });
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "invalid_request");
  assert.equal(result.error.retryable, false);
  assert.equal(result.error.httpStatus, 400);
});

test("maps 401 to unauthorized, tolerating the app-level shape without retryable", async () => {
  handler = (_req, res) => sendJson(res, 401, { error: { code: "UNAUTHORIZED", message: "Invalid API key", correlationId: "corr" } });
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "unauthorized");
  assert.equal(result.error.retryable, false);
});

test("maps 403 to forbidden", async () => {
  handler = (_req, res) => sendJson(res, 403, { error: { code: "FORBIDDEN", message: "Forbidden", retryable: false, correlationId: "corr" } });
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "forbidden");
});

test("maps 404 (source product not found) to catalog_service_error, not an empty recommendation list", async () => {
  handler = (_req, res) => sendJson(res, 404, { error: { code: "SOURCE_PRODUCT_NOT_FOUND", message: "Source product not found", retryable: false, correlationId: "corr" } });
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "catalog_service_error");
  assert.equal(result.error.providerErrorCode, "SOURCE_PRODUCT_NOT_FOUND");
});

test("maps 409 (customer mismatch) to catalog_service_error", async () => {
  handler = (_req, res) => sendJson(res, 409, { error: { code: "CUSTOMER_MISMATCH", message: "Customer identity mismatch", retryable: false, correlationId: "corr" } });
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "catalog_service_error");
});

test("maps 422 (upstream contract mismatch) to catalog_service_error", async () => {
  handler = (_req, res) => sendJson(res, 422, { error: { code: "UPSTREAM_CONTRACT_MISMATCH", message: "Upstream contract mismatch", retryable: false, correlationId: "corr" } });
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "catalog_service_error");
});

test("maps 429 to rate_limited and retryable true, tolerating the app-level shape without retryable", async () => {
  handler = (_req, res) => sendJson(res, 429, { error: { code: "RATE_LIMITED", message: "Rate limit exceeded", correlationId: "corr" } });
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "rate_limited");
  assert.equal(result.error.retryable, true);
});

for (const status of [500, 502, 503, 504]) {
  test(`maps ${status} to catalog_service_error, retryable true`, async () => {
    handler = (_req, res) => sendJson(res, status, { error: { code: status === 500 ? "INTERNAL_ERROR" : "COMMERCIAL_RECOMMENDATION_UNAVAILABLE", message: "Internal server error", retryable: true, correlationId: "corr" } });
    const result = await makeClient().searchProducts(minimalRequest());
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "catalog_service_error");
    assert.equal(result.error.retryable, true);
    assert.equal(result.error.httpStatus, status);
  });
}

test("maps invalid JSON to invalid_response_body", async () => {
  handler = (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{not json");
  };
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "invalid_response_body");
});

test("rejects a followed redirect (redirect: error)", async () => {
  handler = (_req, res) => {
    res.writeHead(302, { location: "/elsewhere" });
    res.end();
  };
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.retryable, true);
  assert.equal(requestCount, 1);
});

test("no retry happens on a failing request", async () => {
  handler = (_req, res) => sendJson(res, 500, { error: { code: "INTERNAL_ERROR", message: "boom", retryable: true, correlationId: "corr" } });
  await makeClient().searchProducts(minimalRequest());
  assert.equal(requestCount, 1);
});

// ---------------------------------------------------------------------------
// Timeout and cancellation
// ---------------------------------------------------------------------------

test("a slow response beyond the configured timeout maps to timeout/retryable", async () => {
  handler = (_req, res) => {
    setTimeout(() => sendJson(res, 200, baseResponse()), 300);
  };
  const result = await makeClient({ timeoutMs: 50 }).searchProducts(minimalRequest());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "timeout");
  assert.equal(result.error.retryable, true);
});

test("a slow response beyond the timeout still fails cleanly, and a subsequent call still succeeds (no stuck timer/controller)", async () => {
  handler = (_req, res) => {
    setTimeout(() => sendJson(res, 200, baseResponse()), 300);
  };
  const client = makeClient({ timeoutMs: 50 });
  const first = await client.searchProducts(minimalRequest());
  assert.equal(first.ok, false);
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const second = await client.searchProducts(minimalRequest());
  assert.equal(second.ok, true);
});

test("an already-aborted external signal short-circuits before any network call", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await makeClient().searchProducts(minimalRequest(), { signal: controller.signal });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "aborted");
  assert.equal(requestCount, 0);
});

test("an external abort during the request maps to aborted, not timeout", async () => {
  handler = (_req, res) => {
    setTimeout(() => sendJson(res, 200, baseResponse()), 300);
  };
  const controller = new AbortController();
  const promise = makeClient({ timeoutMs: 5000 }).searchProducts(minimalRequest(), { signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  const result = await promise;
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "aborted");
});

test("aborts a stalled partial body read beyond the timeout - headers and part of the body arrive immediately, the rest never does in time", async () => {
  const fullBody = JSON.stringify(baseResponse());
  const splitAt = Math.floor(fullBody.length / 2);
  handler = (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.write(fullBody.slice(0, splitAt));
    // The remaining bytes are withheld well past timeoutMs - the client must
    // abort mid-body-read, not wait indefinitely for response.text() to resolve.
    setTimeout(() => res.end(fullBody.slice(splitAt)), 450);
  };
  const start = Date.now();
  const result = await makeClient({ timeoutMs: 100 }).searchProducts(minimalRequest());
  const elapsedMs = Date.now() - start;
  assert.equal(result.ok, false);
  if (result.ok) return;
  // Exactly "timeout" - never invalid_response_body/network_error/invalid_response_schema.
  assert.equal(result.error.code, "timeout");
  assert.equal(result.error.retryable, true);
  assert.equal(requestCount, 1);
  assert.equal(elapsedMs < 450, true, "must abort well before the withheld tail is flushed, not wait for it");
});

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

test("a 500 response body is never echoed back beyond the safe code/message fields", async () => {
  handler = (_req, res) =>
    sendJson(res, 500, {
      error: { code: "INTERNAL_ERROR", message: "Internal server error", retryable: true, correlationId: "corr" },
      stack: "at foo (bar.ts:1:1)",
      internalHost: "secret-internal-host"
    });
  const result = await makeClient({ apiKey: "super-secret-key" }).searchProducts(minimalRequest());
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("secret-internal-host"), false);
  assert.equal(serialized.includes("at foo"), false);
  assert.equal(serialized.includes("super-secret-key"), false);
});

test("customerId is never leaked into an error result", async () => {
  handler = (_req, res) => sendJson(res, 400, { error: { code: "INVALID_REQUEST", message: "Invalid request", retryable: false, correlationId: "corr" } });
  const result = await makeClient().searchProducts(minimalRequest({ customer: { customerId: "secret-customer-555" } }));
  assert.equal(JSON.stringify(result).includes("secret-customer-555"), false);
});

test("an x-api-key-shaped string embedded in an error message is redacted", async () => {
  handler = (_req, res) => sendJson(res, 500, { error: { code: "INTERNAL_ERROR", message: "upstream failed with x-api-key: abc123secret", retryable: true, correlationId: "corr" } });
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.message.includes("abc123secret"), false);
});

// ---------------------------------------------------------------------------
// Contractual fixtures (SearchProducts V2 real scenarios)
// ---------------------------------------------------------------------------

test("contractual: normal commercial recommendation with reasons, execution and personalization", async () => {
  handler = (_req, res) =>
    sendJson(
      res,
      200,
      baseResponse({
        recommendations: [recommendation({ reasons: [{ code: "STRONG_COMMERCIAL_RELEVANCE", source: "commercial" }, { code: "CUSTOMER_PRODUCT_AFFINITY", source: "affinity" }] })]
      })
    );
  const result = await makeClient().searchProducts(minimalRequest());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.recommendations[0].reasons.length, 2);
  assert.equal(result.value.execution.stages.commercialRecommendation, "completed");
});

test("contractual: no customer history (NO_CUSTOMER_HISTORY warning, personalization no_customer_history)", async () => {
  handler = (_req, res) =>
    sendJson(
      res,
      200,
      baseResponse({
        customer: { customerId: "555" },
        warnings: [{ code: "NO_CUSTOMER_HISTORY" }],
        personalization: { applied: false, reason: "no_customer_history", customerId: "555" },
        execution: {
          correlationId: "corr-nch",
          degraded: false,
          degradationReasons: [],
          stages: { commercialRecommendation: "completed", customerAffinity: "completed", personalization: "completed" }
        }
      })
    );
  const result = await makeClient().searchProducts(minimalRequest({ customer: { customerId: "555" } }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.personalization.reason, "no_customer_history");
  assert.equal(result.value.execution.degraded, false);
});

test("contractual: customer not linked (CUSTOMER_HISTORY_NOT_LINKED, never degraded)", async () => {
  handler = (_req, res) =>
    sendJson(
      res,
      200,
      baseResponse({
        customer: { customerId: "555" },
        warnings: [{ code: "CUSTOMER_HISTORY_NOT_LINKED" }],
        personalization: { applied: false, reason: "customer_history_not_linked", customerId: "555" },
        execution: {
          correlationId: "corr-nl",
          degraded: false,
          degradationReasons: [],
          stages: { commercialRecommendation: "completed", customerAffinity: "completed", personalization: "completed" }
        }
      })
    );
  const result = await makeClient().searchProducts(minimalRequest({ customer: { customerId: "555" } }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.personalization.reason, "customer_history_not_linked");
  assert.equal(result.value.execution.degraded, false);
  assert.equal(result.value.execution.stages.customerAffinity, "completed");
});

test("contractual: customer reference not found (CUSTOMER_REFERENCE_NOT_FOUND, never degraded, no ownership on any recommendation)", async () => {
  handler = (_req, res) =>
    sendJson(
      res,
      200,
      baseResponse({
        customer: { customerId: "555" },
        warnings: [{ code: "CUSTOMER_REFERENCE_NOT_FOUND" }],
        personalization: { applied: false, reason: "customer_reference_not_found", customerId: "555" },
        recommendations: [recommendation()],
        execution: {
          correlationId: "corr-nf",
          degraded: false,
          degradationReasons: [],
          stages: { commercialRecommendation: "completed", customerAffinity: "completed", personalization: "completed" }
        }
      })
    );
  const result = await makeClient().searchProducts(minimalRequest({ customer: { customerId: "555" } }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.personalization.reason, "customer_reference_not_found");
  assert.equal(result.value.execution.degraded, false);
  assert.equal("ownership" in result.value.recommendations[0], false);
});

test("contractual: upstream technical degradation (execution.degraded=true, CUSTOMER_AFFINITY_UNAVAILABLE warning) returns as success", async () => {
  handler = (_req, res) =>
    sendJson(
      res,
      200,
      baseResponse({
        customer: { customerId: "555" },
        warnings: [{ code: "CUSTOMER_AFFINITY_UNAVAILABLE" }],
        personalization: { applied: false, reason: "customer_affinity_unavailable", customerId: "555" },
        execution: {
          correlationId: "corr-degraded-2",
          degraded: true,
          degradationReasons: ["CUSTOMER_AFFINITY_RETRYABLE_FAILURE"],
          stages: { commercialRecommendation: "completed", customerAffinity: "degraded", personalization: "skipped" }
        }
      })
    );
  const result = await makeClient().searchProducts(minimalRequest({ customer: { customerId: "555" } }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.execution.degraded, true);
  assert.equal(result.value.execution.stages.customerAffinity, "degraded");
  assert.deepEqual(result.value.warnings, [{ code: "CUSTOMER_AFFINITY_UNAVAILABLE" }]);
});
