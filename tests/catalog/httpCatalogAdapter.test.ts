import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { createHttpCatalogAdapter } from "../../lib/catalog/httpCatalogAdapter";
import type { CatalogPort } from "../../lib/catalog/types";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

let server: http.Server;
let baseUrl: string;
let handler: Handler = (_req, res) => res.writeHead(500).end();
let requestCount = 0;

before(async () => {
  server = http.createServer((req, res) => {
    requestCount += 1;
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function makeAdapter(timeoutMs = 500): CatalogPort {
  return createHttpCatalogAdapter({ baseUrl, apiKey: "test-key", timeoutMs });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

test.beforeEach(() => {
  requestCount = 0;
  handler = (_req, res) => res.writeHead(500).end();
});

test("searchProducts maps a successful response into the domain shape", async () => {
  handler = (req, res) => {
    assert.equal(req.headers["x-api-key"], "test-key");
    assert.ok(req.headers["x-correlation-id"]);
    sendJson(res, 200, {
      query: "banca",
      items: [
        { productId: 1, combinationId: 0, sku: "SKU-1", name: "Banca plana", variantLabel: null, shortDescription: "desc", physicalQuantity: 5, available: true, matchType: "exact_name" }
      ],
      freshness: { cached: false, generatedAt: new Date().toISOString() }
    });
  };

  const result = await makeAdapter().searchProducts({ query: "banca" }, { correlationId: "corr-1" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.items.length, 1);
  assert.equal(result.value.items[0].availability, "in_stock");
  assert.equal(result.value.provenance.source, "catalog_service_http");
  assert.equal(requestCount, 1);
});

test("getProductDetails maps a successful response including price and stock", async () => {
  handler = (_req, res) => {
    sendJson(res, 200, {
      product: { productId: 7, name: "Jaula X", sku: "SKU-7", shortDescription: null, longDescription: null, active: true },
      selectedVariant: null,
      attributes: [],
      variants: [],
      pricing: { quantity: 1, baseUnitPrice: 100000, effectiveUnitPrice: 89990, subtotal: 89990, currency: "CLP", taxIncluded: true, taxMode: "configured_rate", discountApplied: true, discountType: "amount", discountValue: 10010, specificPriceId: 3, pricingMode: "sql_specific_price" },
      stock: { physicalQuantity: 2, available: true, shopId: 1 },
      freshness: { productCheckedAt: new Date().toISOString(), priceCalculatedAt: new Date().toISOString(), stockCheckedAt: new Date().toISOString(), cached: false }
    });
  };

  const result = await makeAdapter().getProductDetails({ productId: "7" }, { correlationId: "corr-2" });
  assert.equal(result.ok, true);
  if (!result.ok || !result.value) return assert.fail("expected a product");
  assert.equal(result.value.price?.amount, 89990);
  assert.equal(result.value.price?.currency, "CLP");
  assert.equal(result.value.availability, "in_stock");
  assert.equal(result.value.stockQuantity, 2);
});

test("401 unauthorized is not retried and maps to a denied-style error", async () => {
  handler = (_req, res) => sendJson(res, 401, { error: { code: "UNAUTHORIZED", message: "Invalid API key", correlationId: "c" } });
  const result = await makeAdapter().searchProducts({ query: "x" }, { correlationId: "corr-3" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "unauthorized");
  assert.equal(result.error.retryable, false);
  assert.equal(requestCount, 1);
});

test("403-shaped invalid input is not retried", async () => {
  handler = (_req, res) => sendJson(res, 400, { error: { code: "INVALID_INPUT", message: "Invalid search parameters", correlationId: "c" } });
  const result = await makeAdapter().searchProducts({ query: "x" }, { correlationId: "corr-3b" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "invalid_input");
  assert.equal(result.error.retryable, false);
  assert.equal(requestCount, 1);
});

test("404 product not found resolves as ok:true value:null, not an error", async () => {
  handler = (_req, res) => sendJson(res, 404, { error: { code: "PRODUCT_NOT_FOUND", message: "Product was not found", correlationId: "c" } });
  const result = await makeAdapter().getProductDetails({ productId: "999" }, { correlationId: "corr-4" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value, null);
  assert.equal(requestCount, 1);
});

test("a single 5xx never triggers an adapter-level retry - exactly one physical HTTP call, error is reported as retryable so the Capability Gateway can decide", async () => {
  handler = (_req, res) => sendJson(res, 500, { error: { code: "DATABASE_UNAVAILABLE", message: "db down", correlationId: "c" } });
  const result = await makeAdapter().searchProducts({ query: "q" }, { correlationId: "corr-5" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "unavailable");
  assert.equal(result.error.retryable, true);
  assert.equal(requestCount, 1, "the adapter itself must not retry - retry is the Capability Gateway's sole responsibility");
});

test("429 rate limited is a single call, reported as retryable for the caller to decide", async () => {
  handler = (_req, res) => sendJson(res, 429, { error: { code: "RATE_LIMITED", message: "slow down", correlationId: "c" } });
  const result = await makeAdapter().searchProducts({ query: "q" }, { correlationId: "corr-7" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "rate_limited");
  assert.equal(result.error.retryable, true);
  assert.equal(requestCount, 1, "the adapter itself must not retry - retry is the Capability Gateway's sole responsibility");
});

test("two consecutive calls to the port are two physical HTTP calls, never more (no hidden multiplier)", async () => {
  handler = (_req, res) => sendJson(res, 200, { query: "q", items: [], freshness: { cached: false, generatedAt: new Date().toISOString() } });
  const adapter = makeAdapter();
  await adapter.searchProducts({ query: "q" }, { correlationId: "corr-12a" });
  await adapter.searchProducts({ query: "q" }, { correlationId: "corr-12b" });
  assert.equal(requestCount, 2);
});

test("timeout is reported as a retryable error and never throws", async () => {
  handler = (_req, res) => {
    setTimeout(() => sendJson(res, 200, { query: "q", items: [], freshness: { cached: false, generatedAt: new Date().toISOString() } }), 2000);
  };
  const result = await makeAdapter(50).searchProducts({ query: "q" }, { correlationId: "corr-8" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "timeout");
  assert.equal(result.error.retryable, true);
});

test("invalid JSON payload on a 200 response maps to invalid_response, not a crash", async () => {
  handler = (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{not-json");
  };
  const result = await makeAdapter().searchProducts({ query: "q" }, { correlationId: "corr-9" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "invalid_response");
  assert.equal(result.error.retryable, false);
});

test("empty response body on 200 maps to invalid_response", async () => {
  handler = (_req, res) => res.writeHead(200).end();
  const result = await makeAdapter().searchProducts({ query: "q" }, { correlationId: "corr-10" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "invalid_response");
});

test("ACS-R1-05-T06.2: batchGetProducts POSTs to /v1/products/batch and maps mixed success/failure items", async () => {
  handler = (req, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/v1/products/batch");
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const parsed = JSON.parse(body) as { items: Array<{ productId: number; combinationId?: number; quantity?: number }> };
      assert.equal(parsed.items.length, 2);
      assert.equal(parsed.items[0].productId, 7);
      sendJson(res, 200, {
        items: [
          {
            ok: true,
            input: { productId: 7, combinationId: 0, quantity: 1 },
            product: {
              product: { productId: 7, name: "Jaula X", sku: "SKU-7", shortDescription: null, longDescription: null, active: true },
              selectedVariant: null,
              attributes: [],
              variants: [],
              pricing: { quantity: 1, baseUnitPrice: 100000, effectiveUnitPrice: 89990, subtotal: 89990, currency: "CLP", taxIncluded: true, taxMode: "configured_rate", discountApplied: true, discountType: "amount", discountValue: 10010, specificPriceId: 3, pricingMode: "sql_specific_price" },
              stock: { physicalQuantity: 2, available: true, shopId: 1 },
              freshness: { productCheckedAt: new Date().toISOString(), priceCalculatedAt: new Date().toISOString(), stockCheckedAt: new Date().toISOString(), cached: false }
            }
          },
          {
            ok: false,
            input: { productId: 999, combinationId: 0, quantity: 1 },
            error: { code: "PRODUCT_NOT_FOUND", message: "Product was not found", correlationId: "c" }
          }
        ]
      });
    });
  };

  const result = await makeAdapter().batchGetProducts(
    { items: [{ productId: "7" }, { productId: "999" }] },
    { correlationId: "corr-batch-1" }
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.items.length, 2);
  const [first, second] = result.value.items;
  assert.equal(first.ok, true);
  if (first.ok) {
    assert.equal(first.product.price?.amount, 89990);
    assert.equal(first.input.productId, "7");
  }
  assert.equal(second.ok, false);
  if (!second.ok) {
    assert.equal(second.error.code, "not_found");
    assert.equal(second.input.productId, "999");
  }
  assert.equal(requestCount, 1);
});

test("batchGetProducts caps at 20 items per real service contract", async () => {
  handler = (req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const parsed = JSON.parse(body) as { items: unknown[] };
      assert.equal(parsed.items.length, 20);
      sendJson(res, 200, { items: [] });
    });
  };

  const items = Array.from({ length: 25 }, (_, index) => ({ productId: String(index + 1) }));
  const result = await makeAdapter().batchGetProducts({ items }, { correlationId: "corr-batch-2" });
  assert.equal(result.ok, true);
});

test("batchGetProducts with an empty items array short-circuits without a network call", async () => {
  handler = () => assert.fail("should not perform a network call for an empty batch");
  const result = await makeAdapter().batchGetProducts({ items: [] }, { correlationId: "corr-batch-3" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.items.length, 0);
  assert.equal(requestCount, 0);
});

test("error messages never leak the configured API key", async () => {
  handler = (_req, res) => sendJson(res, 500, { error: { code: "INTERNAL_ERROR", message: "x-api-key=super-secret-value leaked in message", correlationId: "c" } });
  const result = await makeAdapter().searchProducts({ query: "q" }, { correlationId: "corr-11" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.doesNotMatch(result.error.message, /super-secret-value/);
});
