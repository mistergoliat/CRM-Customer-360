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

function productDetailPayload(overrides: Record<string, unknown> = {}) {
  return {
    product: { productId: 7, name: "Jaula X", sku: "SKU-7", shortDescription: null, longDescription: null, active: true },
    selectedVariant: null,
    attributes: [],
    variants: [],
    pricing: { quantity: 1, baseUnitPrice: 100000, effectiveUnitPrice: 89990, subtotal: 89990, currency: "CLP", taxIncluded: true, taxRate: 0.19, taxMode: "configured_rate", discountApplied: true, discountType: "amount", discountValue: 10010, specificPriceId: 3, pricingMode: "sql_specific_price" },
    stock: { physicalQuantity: 2, available: true, shopId: 1 },
    freshness: { productCheckedAt: new Date().toISOString(), priceCalculatedAt: new Date().toISOString(), stockCheckedAt: new Date().toISOString(), cached: false },
    ...overrides
  };
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
        {
          productId: 1,
          combinationId: 0,
          sku: "SKU-1",
          name: "Banca plana",
          variantLabel: null,
          shortDescription: "desc",
          physicalQuantity: 5,
          available: true,
          matchType: "exact_name",
          publicLink: {
            canonicalUrl: "https://pesaschile.cl/categories/1-banca-plana.html",
            scope: "exact_product",
            available: true,
            requiresVariantSelection: false,
            variantAttributeLabels: []
          }
        }
      ],
      freshness: { cached: false, generatedAt: new Date().toISOString() }
    });
  };

  const result = await makeAdapter().searchProducts({ query: "banca" }, { correlationId: "corr-1" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.items.length, 1);
  assert.equal(result.value.items[0].availability, "in_stock");
  assert.equal("publicLink" in result.value.items[0], false);
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
      pricing: { quantity: 1, baseUnitPrice: 100000, effectiveUnitPrice: 89990, subtotal: 89990, currency: "CLP", taxIncluded: true, taxRate: 0.19, taxMode: "configured_rate", discountApplied: true, discountType: "amount", discountValue: 10010, specificPriceId: 3, pricingMode: "sql_specific_price" },
      stock: { physicalQuantity: 2, available: true, shopId: 1 },
      freshness: { productCheckedAt: new Date().toISOString(), priceCalculatedAt: new Date().toISOString(), stockCheckedAt: new Date().toISOString(), cached: false }
    });
  };

  const result = await makeAdapter().getProductDetails({ productId: "7" }, { correlationId: "corr-2" });
  assert.equal(result.ok, true);
  if (!result.ok || !result.value) return assert.fail("expected a product");
  assert.equal(result.value.price?.amount, 89990);
  assert.equal(result.value.price?.currency, "CLP");
  // SALES-AGENT-R1-T1.1: taxRate is the exact rate Catalog already applied
  // to derive amount - passed through verbatim, never recomputed here.
  assert.equal(result.value.price?.taxRate, 0.19);
  assert.equal(result.value.availability, "in_stock");
  assert.equal(result.value.stockQuantity, 2);
});

test("SALES-AGENT-R1-T1.1: getProductDetails maps a missing pricing.taxRate to null, never a hardcoded default", async () => {
  handler = (_req, res) => {
    sendJson(res, 200, {
      product: { productId: 7, name: "Jaula X", sku: "SKU-7", shortDescription: null, longDescription: null, active: true },
      selectedVariant: null,
      attributes: [],
      variants: [],
      pricing: { quantity: 1, baseUnitPrice: 100000, effectiveUnitPrice: 89990, subtotal: 89990, currency: "CLP", taxIncluded: true, taxMode: "configured_rate", discountApplied: false, discountType: null, discountValue: null, specificPriceId: null, pricingMode: "sql_specific_price" },
      stock: { physicalQuantity: 2, available: true, shopId: 1 },
      freshness: { productCheckedAt: new Date().toISOString(), priceCalculatedAt: new Date().toISOString(), stockCheckedAt: new Date().toISOString(), cached: false }
    });
  };

  const result = await makeAdapter().getProductDetails({ productId: "7" }, { correlationId: "corr-2b" });
  assert.equal(result.ok, true);
  if (!result.ok || !result.value) return assert.fail("expected a product");
  assert.equal(result.value.price?.taxRate, null);
  assert.equal(result.value.price?.amount, 89990, "taxRate being unavailable never blocks parsing the rest of price");
});

test("CRM-R1-T13E: getProductDetails maps a numeric weightKg sibling of pricing/stock", async () => {
  handler = (_req, res) => sendJson(res, 200, productDetailPayload({ weightKg: 20.123 }));
  const result = await makeAdapter().getProductDetails({ productId: "7" }, { correlationId: "corr-w1" });
  assert.equal(result.ok, true);
  if (!result.ok || !result.value) return assert.fail("expected a product");
  assert.equal(result.value.weightKg, 20.123);
});

test("CRM-R1-T13E: getProductDetails preserves weightKg: 0 literally, never coerces to null", async () => {
  handler = (_req, res) => sendJson(res, 200, productDetailPayload({ weightKg: 0 }));
  const result = await makeAdapter().getProductDetails({ productId: "7" }, { correlationId: "corr-w2" });
  assert.equal(result.ok, true);
  if (!result.ok || !result.value) return assert.fail("expected a product");
  assert.equal(result.value.weightKg, 0);
});

test("CRM-R1-T13E: getProductDetails maps weightKg: null (unresolvable combination) to null, not zero", async () => {
  handler = (_req, res) => sendJson(res, 200, productDetailPayload({ weightKg: null }));
  const result = await makeAdapter().getProductDetails({ productId: "7" }, { correlationId: "corr-w3" });
  assert.equal(result.ok, true);
  if (!result.ok || !result.value) return assert.fail("expected a product");
  assert.equal(result.value.weightKg, null);
});

test("CRM-R1-T13E: getProductDetails maps a missing weightKg field to null (older/uncached upstream response), never throws", async () => {
  const payload = productDetailPayload();
  handler = (_req, res) => sendJson(res, 200, payload);
  const result = await makeAdapter().getProductDetails({ productId: "7" }, { correlationId: "corr-w4" });
  assert.equal(result.ok, true);
  if (!result.ok || !result.value) return assert.fail("expected a product");
  assert.equal(result.value.weightKg, null);
});

test("getProductDetails preserves a valid exact_product publicLink", async () => {
  const canonicalUrl = "https://pesaschile.cl/categories/7-pack-4-bandas-de-resistencia-hwm.html";
  handler = (_req, res) => {
    sendJson(res, 200, productDetailPayload({
      publicLink: {
        canonicalUrl,
        scope: "exact_product",
        available: true,
        requiresVariantSelection: false,
        variantAttributeLabels: []
      }
    }));
  };

  const result = await makeAdapter().getProductDetails({ productId: "7" }, { correlationId: "corr-link-1" });
  assert.equal(result.ok, true);
  if (!result.ok || !result.value) return assert.fail("expected a product");
  assert.deepEqual(result.value.publicLink, {
    canonicalUrl,
    scope: "exact_product",
    available: true,
    requiresVariantSelection: false,
    variantAttributeLabels: []
  });
});

test("getProductDetails preserves a parent_product publicLink with variant labels", async () => {
  const canonicalUrl = "https://pesaschile.cl/categories/13-vendaje-k-tape.html";
  handler = (_req, res) => {
    sendJson(res, 200, productDetailPayload({
      publicLink: {
        canonicalUrl,
        scope: "parent_product",
        available: true,
        requiresVariantSelection: true,
        variantAttributeLabels: ["Talla", "Color"]
      }
    }));
  };

  const result = await makeAdapter().getProductDetails({ productId: "13" }, { correlationId: "corr-link-2" });
  assert.equal(result.ok, true);
  if (!result.ok || !result.value) return assert.fail("expected a product");
  assert.equal(result.value.publicLink?.canonicalUrl, canonicalUrl);
  assert.equal(result.value.publicLink?.scope, "parent_product");
  assert.equal(result.value.publicLink?.requiresVariantSelection, true);
  assert.deepEqual(result.value.publicLink?.variantAttributeLabels, ["Talla", "Color"]);
});

test("getProductDetails preserves unavailable publicLink evidence with canonicalUrl null and a valid reason", async () => {
  handler = (_req, res) => {
    sendJson(res, 200, productDetailPayload({
      publicLink: {
        canonicalUrl: null,
        scope: "exact_product",
        available: false,
        unavailableReason: "missing_link_rewrite",
        requiresVariantSelection: false,
        variantAttributeLabels: []
      }
    }));
  };

  const result = await makeAdapter().getProductDetails({ productId: "7" }, { correlationId: "corr-link-3" });
  assert.equal(result.ok, true);
  if (!result.ok || !result.value) return assert.fail("expected a product");
  assert.deepEqual(result.value.publicLink, {
    canonicalUrl: null,
    scope: "exact_product",
    available: false,
    unavailableReason: "missing_link_rewrite",
    requiresVariantSelection: false,
    variantAttributeLabels: []
  });
});

test("getProductDetails remains backward-compatible when publicLink is absent", async () => {
  handler = (_req, res) => sendJson(res, 200, productDetailPayload());

  const result = await makeAdapter().getProductDetails({ productId: "7" }, { correlationId: "corr-link-4" });
  assert.equal(result.ok, true);
  if (!result.ok || !result.value) return assert.fail("expected a product");
  assert.equal(result.value.publicLink, undefined);
});

test("getProductDetails omits invalid publicLink objects but keeps the product", async () => {
  const invalidPublicLinks = [
    { canonicalUrl: 123, scope: "exact_product", available: true, requiresVariantSelection: false, variantAttributeLabels: [] },
    { canonicalUrl: "https://pesaschile.cl/categories/7.html", scope: "combination", available: true, requiresVariantSelection: false, variantAttributeLabels: [] },
    { canonicalUrl: "https://pesaschile.cl/categories/7.html", scope: "exact_product", available: "yes", requiresVariantSelection: false, variantAttributeLabels: [] },
    { canonicalUrl: "https://pesaschile.cl/categories/7.html", scope: "exact_product", available: true, requiresVariantSelection: false, variantAttributeLabels: ["Color", 1] },
    { canonicalUrl: null, scope: "exact_product", available: false, unavailableReason: "not_a_reason", requiresVariantSelection: false, variantAttributeLabels: [] },
    { canonicalUrl: null, scope: "exact_product", available: true, requiresVariantSelection: false, variantAttributeLabels: [] },
    { canonicalUrl: "", scope: "exact_product", available: true, requiresVariantSelection: false, variantAttributeLabels: [] },
    { canonicalUrl: "not a url", scope: "exact_product", available: true, requiresVariantSelection: false, variantAttributeLabels: [] },
    { canonicalUrl: "ftp://pesaschile.cl/categories/7.html", scope: "exact_product", available: true, requiresVariantSelection: false, variantAttributeLabels: [] }
  ];

  for (const publicLink of invalidPublicLinks) {
    handler = (_req, res) => sendJson(res, 200, productDetailPayload({ publicLink }));
    const result = await makeAdapter().getProductDetails({ productId: "7" }, { correlationId: "corr-link-invalid" });
    assert.equal(result.ok, true);
    if (!result.ok || !result.value) return assert.fail("expected a product");
    assert.equal(result.value.publicLink, undefined);
  }
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
            product: productDetailPayload({
              publicLink: {
                canonicalUrl: "https://pesaschile.cl/categories/7-jaula-x.html?utm=test",
                scope: "exact_product",
                available: true,
                requiresVariantSelection: false,
                variantAttributeLabels: []
              }
            })
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
    assert.equal(first.product.publicLink?.canonicalUrl, "https://pesaschile.cl/categories/7-jaula-x.html?utm=test");
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

function exploreResponsePayload(overrides: Record<string, unknown> = {}) {
  return {
    scope: { availability: "available" },
    sort: { by: "price", direction: "desc" },
    totalMatched: 833,
    exhaustiveForScope: true,
    products: [
      { productId: "1532", name: "Camara Hiperbarica ST801", price: 8599990, currency: "CLP", stockQuantity: 4, stockScope: "product", availability: "available" }
    ],
    ...overrides
  };
}

test("ACS-R1-05.1-T02.6: exploreCatalog POSTs to /v1/products/explore with an allowlisted body (nested price, no extra fields)", async () => {
  let capturedBody: unknown;
  handler = (req, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/v1/products/explore");
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      capturedBody = JSON.parse(raw);
      sendJson(res, 200, exploreResponsePayload());
    });
  };

  const result = await makeAdapter().exploreCatalog(
    {
      query: "jaula",
      categoryId: "12",
      categorySlug: "jaulas",
      productType: "machine",
      price: { min: 10000, max: 500000 },
      availability: "available",
      sort: { by: "price", direction: "desc" },
      limit: 5
    },
    { correlationId: "corr-explore-1" }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(capturedBody, {
    sort: { by: "price", direction: "desc" },
    limit: 5,
    query: "jaula",
    categoryId: "12",
    categorySlug: "jaulas",
    productType: "machine",
    availability: "available",
    price: { min: 10000, max: 500000 }
  });
  assert.equal(Object.keys(capturedBody as object).length, 8, "must never send a key beyond the closed, allowlisted schema");
});

test("exploreCatalog omits price/availability/query/category/productType entirely when not provided (never sends invented defaults)", async () => {
  let capturedBody: unknown;
  handler = (req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      capturedBody = JSON.parse(raw);
      sendJson(res, 200, exploreResponsePayload());
    });
  };

  await makeAdapter().exploreCatalog({ sort: { by: "name", direction: "asc" }, limit: 2 }, { correlationId: "corr-explore-2" });
  assert.deepEqual(capturedBody, { sort: { by: "name", direction: "asc" }, limit: 2 });
});

test("exploreCatalog maps a valid response including scope/sort/totalMatched/exhaustiveForScope/classificationSource", async () => {
  handler = (_req, res) => sendJson(res, 200, exploreResponsePayload({ classificationSource: "category" }));
  const result = await makeAdapter().exploreCatalog({ sort: { by: "price", direction: "desc" }, limit: 1 }, { correlationId: "corr-explore-3" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.totalMatched, 833);
  assert.equal(result.value.exhaustiveForScope, true);
  assert.equal(result.value.classificationSource, "category");
  assert.equal(result.value.scope.availability, "available");
  assert.equal(result.value.sort.by, "price");
  assert.equal(result.value.items.length, 1);
  assert.equal(result.value.items[0].stockScope, "product");
});

test("exploreCatalog omits classificationSource when absent or when the upstream sends an unrecognized value", async () => {
  handler = (_req, res) => sendJson(res, 200, exploreResponsePayload());
  const withoutIt = await makeAdapter().exploreCatalog({ sort: { by: "price", direction: "desc" }, limit: 1 }, { correlationId: "corr-explore-4a" });
  assert.equal(withoutIt.ok, true);
  if (withoutIt.ok) assert.equal("classificationSource" in withoutIt.value, false);

  handler = (_req, res) => sendJson(res, 200, exploreResponsePayload({ classificationSource: "not_a_real_source" }));
  const withInvalid = await makeAdapter().exploreCatalog({ sort: { by: "price", direction: "desc" }, limit: 1 }, { correlationId: "corr-explore-4b" });
  assert.equal(withInvalid.ok, true);
  if (withInvalid.ok) assert.equal("classificationSource" in withInvalid.value, false);
});

test("exploreCatalog preserves stockScope=product_aggregate distinctly from product", async () => {
  handler = (_req, res) =>
    sendJson(res, 200, exploreResponsePayload({
      products: [{ productId: "61", name: "Set combinado", price: 46990, currency: "CLP", stockQuantity: 12, stockScope: "product_aggregate", availability: "available" }]
    }));
  const result = await makeAdapter().exploreCatalog({ sort: { by: "stock", direction: "desc" }, limit: 1 }, { correlationId: "corr-explore-5" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.items[0].stockScope, "product_aggregate");
});

test("exploreCatalog preserves exhaustiveForScope=false (partial scan, no absolute ranking claim allowed downstream)", async () => {
  handler = (_req, res) => sendJson(res, 200, exploreResponsePayload({ exhaustiveForScope: false, totalMatched: 5000 }));
  const result = await makeAdapter().exploreCatalog({ sort: { by: "price", direction: "asc" }, limit: 10 }, { correlationId: "corr-explore-6" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.exhaustiveForScope, false);
    assert.equal(result.value.totalMatched, 5000);
  }
});

test("exploreCatalog preserves an item with price: null - never invented as zero", async () => {
  handler = (_req, res) =>
    sendJson(res, 200, exploreResponsePayload({
      products: [{ productId: "9", name: "Producto sin precio", price: null, currency: "CLP", stockQuantity: 0, stockScope: "product", availability: "unknown" }]
    }));
  const result = await makeAdapter().exploreCatalog({ sort: { by: "price", direction: "asc" }, limit: 1 }, { correlationId: "corr-explore-7" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.items[0].price, null);
});

test("exploreCatalog maps the explore-specific lower_snake error vocabulary (invalid_limit/invalid_sort/invalid_request) to invalid_input, not invalid_response", async () => {
  for (const providerCode of ["invalid_limit", "invalid_sort", "invalid_request"]) {
    handler = (_req, res) => sendJson(res, 400, { error: { code: providerCode, message: "Invalid request", correlationId: "c" } });
    const result = await makeAdapter().exploreCatalog({ sort: { by: "price", direction: "asc" }, limit: 1 }, { correlationId: `corr-explore-err-${providerCode}` });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "invalid_input", `${providerCode} must map to invalid_input`);
      assert.equal(result.error.retryable, false);
    }
  }
});

test("exploreCatalog with a malformed response (missing sort/scope, products not an array) maps to invalid_response", async () => {
  const malformedPayloads = [
    { scope: { availability: "available" }, totalMatched: 1, exhaustiveForScope: true, products: [] },
    { sort: { by: "price", direction: "asc" }, totalMatched: 1, exhaustiveForScope: true, products: [] },
    { scope: { availability: "available" }, sort: { by: "price", direction: "asc" }, totalMatched: 1, exhaustiveForScope: true, products: "not-an-array" }
  ];
  for (const payload of malformedPayloads) {
    handler = (_req, res) => sendJson(res, 200, payload);
    const result = await makeAdapter().exploreCatalog({ sort: { by: "price", direction: "asc" }, limit: 1 }, { correlationId: "corr-explore-malformed" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "invalid_response");
  }
});

test("exploreCatalog timeout/network failure is reported as retryable and never throws", async () => {
  handler = (_req, res) => {
    setTimeout(() => sendJson(res, 200, exploreResponsePayload()), 2000);
  };
  const result = await makeAdapter(50).exploreCatalog({ sort: { by: "price", direction: "asc" }, limit: 1 }, { correlationId: "corr-explore-timeout" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "timeout");
    assert.equal(result.error.retryable, true);
  }
});

test("exploreCatalog never retries at the adapter level - exactly one physical HTTP call per invocation", async () => {
  handler = (_req, res) => sendJson(res, 500, { error: { code: "CATALOG_QUERY_FAILED", message: "db down", correlationId: "c" } });
  const result = await makeAdapter().exploreCatalog({ sort: { by: "price", direction: "asc" }, limit: 1 }, { correlationId: "corr-explore-5xx" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "unavailable");
    assert.equal(result.error.retryable, true);
  }
  assert.equal(requestCount, 1);
});

test("error messages never leak the configured API key", async () => {
  handler = (_req, res) => sendJson(res, 500, { error: { code: "INTERNAL_ERROR", message: "x-api-key=super-secret-value leaked in message", correlationId: "c" } });
  const result = await makeAdapter().searchProducts({ query: "q" }, { correlationId: "corr-11" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.doesNotMatch(result.error.message, /super-secret-value/);
});

// SALES-AGENT-R2-A11.2-C - resolveProductIntent (T12: POST /api/v2/catalog/resolve-product-intent)

function productIntentPayload(overrides: Record<string, unknown> = {}) {
  return {
    query: { original: "disco olimpico 20kg", normalized: "disco olimpico 20 kg" },
    resolution: { status: "resolved", confidence: 0.9, sourceProduct: { productId: "1499" } },
    candidates: [
      {
        product: {
          productId: "1499",
          name: "Par Discos Olimpicos Grip Rubber 20kg | PROmachine",
          reference: "DISC-1499",
          price: { amount: 39990, currency: "CLP" },
          stock: { status: "in_stock", available: true, quantity: 6 },
          publicLink: { canonicalUrl: "https://pesaschile.cl/1499-p.html", scope: "exact_product", available: true, requiresVariantSelection: false, variantAttributeLabels: [] }
        },
        match: { rank: 1, score: 0.91, reasons: ["EXACT_NAME_MATCH", "EXPLICIT_WEIGHT_MATCH"] }
      }
    ],
    statistics: { retrieved: 1, eligible: 1, returned: 1 },
    warnings: [],
    correlationId: "corr-t12",
    ...overrides
  };
}

// CATC01
test("resolveProductIntent CATC01: 'resolved' maps sourceProduct, candidate price/stock/publicLink and score/reasons", async () => {
  let requestBody: Record<string, unknown> = {};
  handler = (req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      requestBody = JSON.parse(raw);
      sendJson(res, 200, productIntentPayload());
    });
  };

  const result = await makeAdapter().resolveProductIntent({ query: "disco olimpico 20kg", limit: 5 }, { correlationId: "corr-t12" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.resolution.status, "resolved");
  assert.equal(result.value.resolution.sourceProduct?.productId, "1499");
  const candidate = result.value.candidates[0];
  assert.equal(candidate.product.price?.amount, 39990);
  assert.equal(candidate.product.stock.quantity, 6);
  assert.equal(candidate.product.publicLink?.canonicalUrl, "https://pesaschile.cl/1499-p.html");
  assert.equal(candidate.score, 0.91);
  assert.deepEqual(candidate.reasons, ["EXACT_NAME_MATCH", "EXPLICIT_WEIGHT_MATCH"]);
  assert.deepEqual(requestBody, { query: "disco olimpico 20kg", limit: 5 });
});

// CATC02
test("resolveProductIntent CATC02: 'clarification_required' preserves dimension and grouped options", async () => {
  handler = (_req, res) =>
    sendJson(
      res,
      200,
      productIntentPayload({
        resolution: { status: "clarification_required", confidence: 0.5 },
        clarification: {
          dimension: "weight",
          options: [
            { value: "15kg", label: "15 kg", productIds: ["1171"] },
            { value: "20kg", label: "20 kg", productIds: ["31"] }
          ]
        }
      })
    );

  const result = await makeAdapter().resolveProductIntent({ query: "barra classic" }, { correlationId: "corr-t12" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.resolution.status, "clarification_required");
  assert.equal(result.value.clarification?.dimension, "weight");
  assert.equal(result.value.clarification?.options.length, 2);
});

// CATC03
test("resolveProductIntent CATC03: 'no_match' is a completed business outcome, not an error", async () => {
  handler = (_req, res) =>
    sendJson(res, 200, productIntentPayload({ resolution: { status: "no_match", confidence: 0 }, candidates: [], statistics: { retrieved: 0, eligible: 0, returned: 0 } }));

  const result = await makeAdapter().resolveProductIntent({ query: "producto inexistente xyz" }, { correlationId: "corr-t12" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.resolution.status, "no_match");
  assert.equal(result.value.candidates.length, 0);
});

// CATC04
test("resolveProductIntent CATC04: a 503 CATALOG_SEARCH_UNAVAILABLE is retryable", async () => {
  handler = (_req, res) => sendJson(res, 503, { error: { code: "CATALOG_SEARCH_UNAVAILABLE", message: "search unavailable", retryable: true, correlationId: "c" } });
  const result = await makeAdapter().resolveProductIntent({ query: "q" }, { correlationId: "corr-t12" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "unavailable");
  assert.equal(result.error.retryable, true);
});

// CATC05
test("resolveProductIntent CATC05: a 422 INVALID_CATALOG_RESULT is a non-retryable invalid_response", async () => {
  handler = (_req, res) => sendJson(res, 422, { error: { code: "INVALID_CATALOG_RESULT", message: "bad provider output", retryable: false, correlationId: "c" } });
  const result = await makeAdapter().resolveProductIntent({ query: "q" }, { correlationId: "corr-t12" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "invalid_response");
  assert.equal(result.error.retryable, false);
});

test("resolveProductIntent a 400 INVALID_REQUEST is a non-retryable invalid_input", async () => {
  handler = (_req, res) => sendJson(res, 400, { error: { code: "INVALID_REQUEST", message: "bad request", retryable: false, correlationId: "c" } });
  const result = await makeAdapter().resolveProductIntent({ query: "q" }, { correlationId: "corr-t12" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "invalid_input");
  assert.equal(result.error.retryable, false);
});

test("resolveProductIntent rejects a 'resolved' status with no sourceProduct as invalid_response, never guesses", async () => {
  handler = (_req, res) => sendJson(res, 200, productIntentPayload({ resolution: { status: "resolved", confidence: 0.9 } }));
  const result = await makeAdapter().resolveProductIntent({ query: "q" }, { correlationId: "corr-t12" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "invalid_response");
});

test("resolveProductIntent sends inStockOnly under filters and omits limit/filters when not provided", async () => {
  let requestBody: Record<string, unknown> = {};
  handler = (req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      requestBody = JSON.parse(raw);
      sendJson(res, 200, productIntentPayload());
    });
  };
  await makeAdapter().resolveProductIntent({ query: "disco olimpico 20kg", inStockOnly: true }, { correlationId: "corr-t12" });
  assert.deepEqual(requestBody, { query: "disco olimpico 20kg", filters: { inStockOnly: true } });
});
