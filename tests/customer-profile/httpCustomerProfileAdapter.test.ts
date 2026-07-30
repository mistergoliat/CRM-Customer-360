import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { createCustomerProfilePort, createHttpCustomerProfileAdapter, readHttpCustomerProfileAdapterConfig } from "../../lib/customer-profile/httpCustomerProfileAdapter";
import type { CustomerProfilePort } from "../../lib/customer-profile/types";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

let server: http.Server;
let baseUrl: string;
let handler: Handler = (_req, res) => res.writeHead(500).end();
let requestCount = 0;
let lastHeaders: http.IncomingHttpHeaders = {};
let lastUrl = "";

before(async () => {
  server = http.createServer((req, res) => {
    requestCount += 1;
    lastHeaders = req.headers;
    lastUrl = req.url ?? "";
    handler(req, res);
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
  lastHeaders = {};
  lastUrl = "";
  handler = (_req, res) => res.writeHead(500).end();
});

function makeAdapter(overrides: Partial<{ apiKey: string | null; timeoutMs: number }> = {}): CustomerProfilePort {
  return createHttpCustomerProfileAdapter({ baseUrl, apiKey: overrides.apiKey ?? null, timeoutMs: overrides.timeoutMs ?? 500 });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const ENV_KEYS = ["CUSTOMER_PROFILE_SERVICE_BASE_URL", "CUSTOMER_PROFILE_SERVICE_API_KEY", "CUSTOMER_PROFILE_SERVICE_TIMEOUT_MS"] as const;

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

function purchasedProductItem(overrides: Record<string, unknown> = {}) {
  return {
    productId: 123,
    productAttributeId: 0,
    productName: "Disco olimpico 20kg",
    productReference: "DISC20",
    totalQuantityPurchased: 5,
    orderCount: 2,
    firstPurchasedAt: "2026-01-02T10:00:00.000Z",
    lastPurchasedAt: "2026-01-05T12:30:00.000Z",
    totalSpentTaxIncl: "99990.123456",
    catalogStatus: "linked",
    ...overrides
  };
}

function purchasedProductsPayload(overrides: Record<string, unknown> = {}) {
  return {
    status: "available",
    products: [purchasedProductItem()],
    pagination: { limit: 20, offset: 0, returned: 1, hasMore: false },
    ...overrides
  };
}

function concentration() {
  return { top1Share: "1.000000", top3Share: "1.000000", hhi: "1.000000", effectiveDiversity: "1.000000" };
}

function purchaseBehaviorPayload(overrides: Record<string, unknown> = {}) {
  return {
    status: "available",
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
      productSpendConcentration: concentration(),
      variantSpendConcentration: concentration()
    },
    topProducts: [
      {
        productId: 123,
        latestObservedProductName: "Secret product",
        latestObservedProductReference: "SECRETREF",
        variantCountPurchased: 1,
        repeatedVariantCount: 1,
        orderCount: 2,
        totalQuantityPurchased: 5,
        totalSpentTaxIncl: "99990.123456",
        spendShare: "1.000000",
        orderShare: "1.000000",
        quantityShare: "1.000000",
        firstPurchasedAt: "2026-01-01T00:00:00.000Z",
        lastPurchasedAt: "2026-01-05T00:00:00.000Z",
        daysSinceLastPurchase: 5,
        isRepeated: true
      }
    ],
    topVariants: [
      {
        productId: 123,
        productAttributeId: 0,
        productName: "Secret product",
        productReference: "SECRETREF",
        orderCount: 2,
        totalQuantityPurchased: 5,
        totalSpentTaxIncl: "99990.123456",
        spendShare: "1.000000",
        orderShare: "1.000000",
        quantityShare: "1.000000",
        firstPurchasedAt: "2026-01-01T00:00:00.000Z",
        lastPurchasedAt: "2026-01-05T00:00:00.000Z",
        daysSinceLastPurchase: 5,
        isRepeated: true
      }
    ],
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

test("readHttpCustomerProfileAdapterConfig returns null when base URL is absent", async () => {
  await withEnv({}, () => {
    assert.equal(readHttpCustomerProfileAdapterConfig(), null);
  });
});

test("createCustomerProfilePort returns a fail-closed port when base URL is absent", async () => {
  await withEnv({}, async () => {
    const port = createCustomerProfilePort();
    const result = await port.getPurchasedProducts({ masterCustomerId: "1" }, { correlationId: "corr-cfg-1" });
    assert.deepEqual(result, { status: "failed", code: "unavailable", retryable: false });
    const behavior = await port.getPurchaseBehavior({ masterCustomerId: "1" }, { correlationId: "corr-cfg-2" });
    assert.deepEqual(behavior, { status: "failed", code: "unavailable", retryable: false });
    assert.equal(requestCount, 0);
  });
});

test("readHttpCustomerProfileAdapterConfig builds a config without an API key when it is absent", async () => {
  await withEnv({ CUSTOMER_PROFILE_SERVICE_BASE_URL: baseUrl }, () => {
    const config = readHttpCustomerProfileAdapterConfig();
    assert.ok(config);
    assert.equal(config?.apiKey, null);
    assert.equal(config?.timeoutMs, 5000);
  });
});

test("readHttpCustomerProfileAdapterConfig normalizes a base URL with trailing slashes", async () => {
  await withEnv({ CUSTOMER_PROFILE_SERVICE_BASE_URL: `${baseUrl}///` }, () => {
    const config = readHttpCustomerProfileAdapterConfig();
    assert.equal(config?.baseUrl, baseUrl);
  });
});

test("readHttpCustomerProfileAdapterConfig honors a configured timeout", async () => {
  await withEnv({ CUSTOMER_PROFILE_SERVICE_BASE_URL: baseUrl, CUSTOMER_PROFILE_SERVICE_TIMEOUT_MS: "1234" }, () => {
    const config = readHttpCustomerProfileAdapterConfig();
    assert.equal(config?.timeoutMs, 1234);
  });
});

test("a slow response beyond the configured timeout maps to failed/timeout", async () => {
  handler = (_req, res) => {
    setTimeout(() => sendJson(res, 200, purchasedProductsPayload()), 300);
  };
  const result = await makeAdapter({ timeoutMs: 50 }).getPurchasedProducts({ masterCustomerId: "1" }, { correlationId: "corr-timeout" });
  assert.deepEqual(result, { status: "failed", code: "timeout", retryable: true });
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

test("rejects an invalid masterCustomerId without making a physical request", async () => {
  const invalidIds = ["", "  ", "a@b.com", "abc123", " 123", "123 ", "1 2", "-1", "1.5", "0".repeat(21)];
  const adapter = makeAdapter();
  for (const masterCustomerId of invalidIds) {
    const result = await adapter.getPurchasedProducts({ masterCustomerId }, { correlationId: "corr-id" });
    assert.deepEqual(result, { status: "failed", code: "invalid_request", retryable: false }, `expected invalid_request for ${JSON.stringify(masterCustomerId)}`);
  }
  assert.equal(requestCount, 0);
});

test("accepts a valid numeric masterCustomerId and encodes it safely in the path", async () => {
  handler = (_req, res) => sendJson(res, 200, purchasedProductsPayload());
  const result = await makeAdapter().getPurchasedProducts({ masterCustomerId: "42" }, { correlationId: "corr-valid-id" });
  assert.equal(result.status, "available");
  assert.equal(lastUrl.startsWith("/v1/customers/42/purchased-products"), true);
});

// ---------------------------------------------------------------------------
// Purchased Products
// ---------------------------------------------------------------------------

test("getPurchasedProducts maps a 200 available response with items", async () => {
  handler = (req, res) => {
    assert.equal(req.headers["x-correlation-id"], "corr-pp-1");
    assert.equal(req.headers.accept, "application/json");
    sendJson(res, 200, purchasedProductsPayload());
  };
  const result = await makeAdapter().getPurchasedProducts({ masterCustomerId: "1" }, { correlationId: "corr-pp-1" });
  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  assert.equal(result.data.products.length, 1);
  assert.equal(result.data.products[0].productId, 123);
  assert.equal(result.data.products[0].catalogStatus, "linked");
  assert.equal(typeof result.data.products[0].totalSpentTaxIncl, "string");
  assert.equal(result.data.products[0].totalSpentTaxIncl, "99990.123456");
  assert.equal(result.data.pagination.hasMore, false);
  assert.equal(requestCount, 1);
});

test("getPurchasedProducts maps a 200 available response with an empty list", async () => {
  handler = (_req, res) => sendJson(res, 200, { status: "available", products: [], pagination: { limit: 20, offset: 0, returned: 0, hasMore: false } });
  const result = await makeAdapter().getPurchasedProducts({ masterCustomerId: "1" }, { correlationId: "corr-pp-empty" });
  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  assert.deepEqual(result.data.products, []);
});

test("getPurchasedProducts sends limit/offset and preserves pagination.hasMore", async () => {
  handler = (_req, res) => sendJson(res, 200, purchasedProductsPayload({ pagination: { limit: 100, offset: 10, returned: 1, hasMore: true } }));
  const result = await makeAdapter().getPurchasedProducts({ masterCustomerId: "1", limit: 100, offset: 10 }, { correlationId: "corr-pp-page" });
  assert.equal(lastUrl, "/v1/customers/1/purchased-products?limit=100&offset=10");
  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  assert.deepEqual(result.data.pagination, { limit: 100, offset: 10, returned: 1, hasMore: true });
});

test("getPurchasedProducts preserves a deleted_or_unavailable catalogStatus", async () => {
  handler = (_req, res) => sendJson(res, 200, purchasedProductsPayload({ products: [purchasedProductItem({ catalogStatus: "deleted_or_unavailable" })] }));
  const result = await makeAdapter().getPurchasedProducts({ masterCustomerId: "1" }, { correlationId: "corr-pp-deleted" });
  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  assert.equal(result.data.products[0].catalogStatus, "deleted_or_unavailable");
});

test("getPurchasedProducts maps 404 customer_not_found and customer_not_linked", async () => {
  handler = (_req, res) => sendJson(res, 404, { status: "customer_not_found" });
  assert.deepEqual(await makeAdapter().getPurchasedProducts({ masterCustomerId: "1" }, { correlationId: "corr-pp-404a" }), { status: "customer_not_found" });

  handler = (_req, res) => sendJson(res, 404, { status: "customer_not_linked" });
  assert.deepEqual(await makeAdapter().getPurchasedProducts({ masterCustomerId: "1" }, { correlationId: "corr-pp-404b" }), { status: "customer_not_linked" });
});

test("getPurchasedProducts maps 503 prestashop_unavailable and prestashop_timeout as degraded/retryable", async () => {
  handler = (_req, res) => sendJson(res, 503, { status: "degraded", reason: "prestashop_unavailable" });
  assert.deepEqual(await makeAdapter().getPurchasedProducts({ masterCustomerId: "1" }, { correlationId: "corr-pp-503a" }), {
    status: "degraded",
    reason: "prestashop_unavailable",
    retryable: true
  });

  handler = (_req, res) => sendJson(res, 503, { status: "degraded", reason: "prestashop_timeout" });
  assert.deepEqual(await makeAdapter().getPurchasedProducts({ masterCustomerId: "1" }, { correlationId: "corr-pp-503b" }), {
    status: "degraded",
    reason: "prestashop_timeout",
    retryable: true
  });
});

test("getPurchasedProducts maps 400/401/403/429/500", async () => {
  handler = (_req, res) => sendJson(res, 400, { error: "invalid_limit" });
  assert.deepEqual(await makeAdapter().getPurchasedProducts({ masterCustomerId: "1" }, { correlationId: "corr-pp-400" }), { status: "failed", code: "invalid_request", retryable: false });

  handler = (_req, res) => sendJson(res, 401, { error: "unauthorized" });
  assert.deepEqual(await makeAdapter().getPurchasedProducts({ masterCustomerId: "1" }, { correlationId: "corr-pp-401" }), { status: "failed", code: "authentication_error", retryable: false });

  handler = (_req, res) => sendJson(res, 403, { error: "forbidden" });
  assert.deepEqual(await makeAdapter().getPurchasedProducts({ masterCustomerId: "1" }, { correlationId: "corr-pp-403" }), { status: "failed", code: "authentication_error", retryable: false });

  handler = (_req, res) => sendJson(res, 429, { error: "rate_limited" });
  assert.deepEqual(await makeAdapter().getPurchasedProducts({ masterCustomerId: "1" }, { correlationId: "corr-pp-429" }), { status: "failed", code: "rate_limited", retryable: true });

  handler = (_req, res) => sendJson(res, 500, { error: "internal_error" });
  assert.deepEqual(await makeAdapter().getPurchasedProducts({ masterCustomerId: "1" }, { correlationId: "corr-pp-500" }), { status: "failed", code: "upstream_error", retryable: true });
});

test("getPurchasedProducts maps invalid JSON body and invalid schema to invalid_response", async () => {
  handler = (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{not json");
  };
  assert.deepEqual(await makeAdapter().getPurchasedProducts({ masterCustomerId: "1" }, { correlationId: "corr-pp-badjson" }), {
    status: "failed",
    code: "invalid_response",
    retryable: false
  });

  handler = (_req, res) => sendJson(res, 200, purchasedProductsPayload({ products: [purchasedProductItem({ totalSpentTaxIncl: 99990.12 })] }));
  assert.deepEqual(await makeAdapter().getPurchasedProducts({ masterCustomerId: "1" }, { correlationId: "corr-pp-badshape" }), {
    status: "failed",
    code: "invalid_response",
    retryable: false
  });
});

test("getPurchasedProducts sends the API key header only when configured", async () => {
  handler = (_req, res) => sendJson(res, 200, purchasedProductsPayload());
  await makeAdapter({ apiKey: "test-key" }).getPurchasedProducts({ masterCustomerId: "1" }, { correlationId: "corr-pp-key" });
  assert.equal(lastHeaders["x-api-key"], "test-key");

  await makeAdapter({ apiKey: null }).getPurchasedProducts({ masterCustomerId: "1" }, { correlationId: "corr-pp-nokey" });
  assert.equal(lastHeaders["x-api-key"], undefined);
});

test("getPurchasedProducts issues exactly one physical HTTP call per invocation, even on failure", async () => {
  handler = (_req, res) => sendJson(res, 500, { error: "internal_error" });
  await makeAdapter().getPurchasedProducts({ masterCustomerId: "1" }, { correlationId: "corr-pp-once" });
  assert.equal(requestCount, 1);
});

// ---------------------------------------------------------------------------
// Purchase Behavior
// ---------------------------------------------------------------------------

test("getPurchaseBehavior maps a full 200 available response", async () => {
  handler = (_req, res) => sendJson(res, 200, purchaseBehaviorPayload());
  const result = await makeAdapter().getPurchaseBehavior({ masterCustomerId: "1" }, { correlationId: "corr-pb-1" });
  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  assert.equal(result.data.currencyIsoCode, "CLP");
  assert.equal(result.data.summary.validOrderCount, 2);
  assert.equal(typeof result.data.summary.repeatProductRate, "string");
  assert.equal(result.data.topProducts.length, 1);
  assert.equal(result.data.topProducts[0].isRepeated, true);
  assert.equal(typeof result.data.topProducts[0].spendShare, "string");
  assert.equal(result.data.topVariants.length, 1);
  assert.equal(result.data.topVariants[0].daysSinceLastPurchase, 5);
});

test("getPurchaseBehavior maps empty topProducts/topVariants", async () => {
  handler = (_req, res) =>
    sendJson(
      res,
      200,
      purchaseBehaviorPayload({
        summary: {
          validOrderCount: 0,
          distinctProductCount: 0,
          distinctVariantCount: 0,
          repeatedProductCount: 0,
          repeatedVariantCount: 0,
          repeatProductRate: "0.000000",
          repeatVariantRate: "0.000000",
          repeatedVariantSpendShare: "0.000000",
          productSpendConcentration: { top1Share: "0.000000", top3Share: "0.000000", hhi: "0.000000", effectiveDiversity: "0.000000" },
          variantSpendConcentration: { top1Share: "0.000000", top3Share: "0.000000", hhi: "0.000000", effectiveDiversity: "0.000000" }
        },
        topProducts: [],
        topVariants: []
      })
    );
  const result = await makeAdapter().getPurchaseBehavior({ masterCustomerId: "1" }, { correlationId: "corr-pb-empty" });
  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  assert.deepEqual(result.data.topProducts, []);
  assert.deepEqual(result.data.topVariants, []);
});

test("getPurchaseBehavior sends topProducts/topVariants query params", async () => {
  handler = (_req, res) => sendJson(res, 200, purchaseBehaviorPayload());
  await makeAdapter().getPurchaseBehavior({ masterCustomerId: "1", topProducts: 1, topVariants: 5 }, { correlationId: "corr-pb-params" });
  assert.equal(lastUrl, "/v1/customers/1/purchase-behavior?topProducts=1&topVariants=5");
});

test("getPurchaseBehavior maps 404/503/500 the same way as purchased products", async () => {
  handler = (_req, res) => sendJson(res, 404, { status: "customer_not_found" });
  assert.deepEqual(await makeAdapter().getPurchaseBehavior({ masterCustomerId: "1" }, { correlationId: "corr-pb-404" }), { status: "customer_not_found" });

  handler = (_req, res) => sendJson(res, 404, { status: "customer_not_linked" });
  assert.deepEqual(await makeAdapter().getPurchaseBehavior({ masterCustomerId: "1" }, { correlationId: "corr-pb-404b" }), { status: "customer_not_linked" });

  handler = (_req, res) => sendJson(res, 503, { status: "degraded", reason: "prestashop_timeout" });
  assert.deepEqual(await makeAdapter().getPurchaseBehavior({ masterCustomerId: "1" }, { correlationId: "corr-pb-503" }), {
    status: "degraded",
    reason: "prestashop_timeout",
    retryable: true
  });

  handler = (_req, res) => sendJson(res, 500, { error: "internal_error" });
  assert.deepEqual(await makeAdapter().getPurchaseBehavior({ masterCustomerId: "1" }, { correlationId: "corr-pb-500" }), { status: "failed", code: "upstream_error", retryable: true });
});

test("getPurchaseBehavior maps invalid schema to invalid_response", async () => {
  handler = (_req, res) => sendJson(res, 200, purchaseBehaviorPayload({ currencyIsoCode: "USD" }));
  assert.deepEqual(await makeAdapter().getPurchaseBehavior({ masterCustomerId: "1" }, { correlationId: "corr-pb-badcurrency" }), {
    status: "failed",
    code: "invalid_response",
    retryable: false
  });
});

test("a slow purchase-behavior response beyond the timeout maps to failed/timeout", async () => {
  handler = (_req, res) => {
    setTimeout(() => sendJson(res, 200, purchaseBehaviorPayload()), 300);
  };
  const result = await makeAdapter({ timeoutMs: 50 }).getPurchaseBehavior({ masterCustomerId: "1" }, { correlationId: "corr-pb-timeout" });
  assert.deepEqual(result, { status: "failed", code: "timeout", retryable: true });
});

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

test("a 500 response body is never echoed back in the result", async () => {
  handler = (_req, res) => sendJson(res, 500, { error: "internal_error", message: "PrestaShop connection failed: host=secret-internal-host user=admin", stack: "at foo (bar.ts:1:1)" });
  const result = await makeAdapter({ apiKey: "super-secret-key" }).getPurchasedProducts({ masterCustomerId: "1" }, { correlationId: "corr-sec-1" });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("secret-internal-host"), false);
  assert.equal(serialized.includes("at foo"), false);
  assert.equal(serialized.includes("super-secret-key"), false);
  assert.deepEqual(result, { status: "failed", code: "upstream_error", retryable: true });
});

test("no internal retry happens on a failing request", async () => {
  handler = (_req, res) => sendJson(res, 503, { status: "degraded", reason: "prestashop_unavailable" });
  await makeAdapter().getPurchasedProducts({ masterCustomerId: "1" }, { correlationId: "corr-sec-2" });
  assert.equal(requestCount, 1);
});
