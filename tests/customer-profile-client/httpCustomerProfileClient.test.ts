import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { closeTestHttpServer } from "../helpers/closeTestHttpServer";
import {
  createCustomerProfileClient,
  createHttpCustomerProfileClient,
  CUSTOMER_RFM_CONTRACT_VERSION,
  CustomerProfileClientConfigurationError,
  CUSTOMER_PROFILE_CONTRACT_VERSION,
  readCustomerProfileClientConfig
} from "../../lib/integrations/customer-profile";
import type { CustomerProfileClient, CustomerProfileClientConfig } from "../../lib/integrations/customer-profile";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void;

let server: http.Server;
let baseUrl: string;
let handler: Handler = (_req, res) => res.writeHead(500).end();
let requestCount = 0;
let lastMethod = "";
let lastUrl = "";
let lastHeaders: http.IncomingHttpHeaders = {};
let lastBody = "";
const originalConsoleInfo = console.info;

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
  console.info = originalConsoleInfo;
  await closeTestHttpServer(server);
});

test.beforeEach(() => {
  requestCount = 0;
  lastMethod = "";
  lastUrl = "";
  lastHeaders = {};
  lastBody = "";
  handler = (_req, res) => res.writeHead(500).end();
  console.info = (() => undefined) as typeof console.info;
});

function config(overrides: Partial<CustomerProfileClientConfig> = {}): CustomerProfileClientConfig {
  return {
    enabled: true,
    baseUrl,
    timeoutMs: 500,
    authToken: null,
    ...overrides
  };
}

function makeClient(overrides: Partial<CustomerProfileClientConfig> = {}): CustomerProfileClient {
  return createHttpCustomerProfileClient(config(overrides));
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function provenance(customerId: number, purpose: "customer_profile" | "commercial_summary" | "purchased_products" | "purchase_behavior" | "order_status") {
  const extra =
    purpose === "customer_profile"
      ? [{ source: "PRESTASHOP" as const, entity: "ps_customer" as const, purpose: "customer_profile" }, { source: "PRESTASHOP" as const, entity: "ps_orders" as const, purpose: "recent_orders" }]
      : purpose === "commercial_summary"
        ? [
            { source: "PRESTASHOP" as const, entity: "ps_orders" as const, purpose: "commercial_summary" },
            { source: "PRESTASHOP" as const, entity: "ps_order_detail" as const, purpose: "commercial_summary" }
          ]
        : purpose === "purchased_products"
          ? [
              { source: "PRESTASHOP" as const, entity: "ps_orders" as const, purpose: "purchased_products" },
              { source: "PRESTASHOP" as const, entity: "ps_order_detail" as const, purpose: "purchased_products" }
            ]
          : purpose === "purchase_behavior"
            ? [
                { source: "PRESTASHOP" as const, entity: "ps_orders" as const, purpose: "purchase_behavior" },
                { source: "PRESTASHOP" as const, entity: "ps_order_detail" as const, purpose: "purchase_behavior" },
                { source: "PRESTASHOP" as const, entity: "derived_purchase_behavior" as const, purpose: "purchase_behavior" }
              ]
            : [{ source: "PRESTASHOP" as const, entity: "ps_orders" as const, purpose: "order_status" }];

  return {
    customerIdentity: {
      customerId,
      source: "PRESTASHOP" as const,
      externalCustomerId: String(customerId),
      status: "DIRECT_SOURCE" as const
    },
    dataSources: [{ source: "PRESTASHOP" as const, entity: "ps_customer" as const, purpose: "customer_identity" }, ...extra],
    generatedAt: "2026-08-05T00:00:00.000Z",
    contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION
  };
}

function profilePayload(customerId = 1) {
  return {
    status: "available",
    customerId,
    profile: {
      customerId,
      generatedAt: "2026-08-05T00:00:00.000Z",
      customer: {
        firstname: "Synthetic",
        lastname: "Customer",
        email: "synthetic@example.com",
        rut: null,
        platformOrigin: "prestashop"
      },
      prestashop: { customerId, active: true, shopId: 1, createdAt: null, updatedAt: null },
      recentOrders: [
        {
          orderId: 100,
          reference: "REF100",
          currentStateId: 4,
          currentState: { stateId: 4, name: "Despachado", resolution: "resolved" },
          valid: true,
          createdAt: "2026-01-01 10:00:00",
          updatedAt: "2026-01-02 10:00:00",
          totalPaidTaxIncl: "10000.000000",
          totalProductsTaxIncl: "9500.000000",
          currencyId: 1
        }
      ],
      warnings: []
    },
    provenance: provenance(customerId, "customer_profile"),
    warnings: []
  };
}

function summaryPayload(customerId = 1) {
  return {
    status: "available",
    customerId,
    summary: {
      totalOrders: 2,
      totalSpentTaxIncl: "142177.121231",
      averageOrderValueTaxIncl: "71088.560616",
      firstOrderAt: "2026-01-02T10:00:00.000Z",
      lastOrderAt: "2026-01-05T10:00:00.000Z",
      daysSinceLastOrder: 205,
      purchaseFrequencyDays: 3,
      totalUnitsPurchased: 5,
      distinctProductsPurchased: 3,
      cancelledOrderCount: 0,
      refundedOrderCount: 0,
      currencyIsoCode: "CLP"
    },
    provenance: provenance(customerId, "commercial_summary")
  };
}

function purchasedProductsPayload(customerId = 1) {
  return {
    status: "available",
    customerId,
    products: [
      {
        productId: 123,
        productAttributeId: 0,
        productName: "Synthetic plate",
        productReference: "PLATE20",
        totalQuantityPurchased: 5,
        orderCount: 2,
        firstPurchasedAt: "2026-01-02T10:00:00.000Z",
        lastPurchasedAt: "2026-01-05T12:30:00.000Z",
        totalSpentTaxIncl: "99990.123456",
        catalogStatus: "linked"
      }
    ],
    pagination: { limit: 20, offset: 0, returned: 1, hasMore: false },
    provenance: provenance(customerId, "purchased_products")
  };
}

function purchaseBehaviorPayload(customerId = 1) {
  return {
    status: "available",
    customerId,
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
      productSpendConcentration: { top1Share: "1.000000", top3Share: "1.000000", hhi: "1.000000", effectiveDiversity: "1.000000" },
      variantSpendConcentration: { top1Share: "1.000000", top3Share: "1.000000", hhi: "1.000000", effectiveDiversity: "1.000000" }
    },
    topProducts: [
      {
        productId: 123,
        latestObservedProductName: "Synthetic plate",
        latestObservedProductReference: "PLATE20",
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
        productName: "Synthetic plate",
        productReference: "PLATE20",
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
    provenance: provenance(customerId, "purchase_behavior")
  };
}

function orderStatusPayload(customerId = 1) {
  return {
    status: "available",
    customerId,
    order: {
      orderId: 123,
      reference: "ABC123XYZ",
      currentStateId: 4,
      currentStateName: "Entregado a Transportista",
      deliveryMethod: "direct_dispatch",
      deliveryEstimate: {
        status: "applicable",
        minimumBusinessDays: 3,
        maximumBusinessDays: 5,
        startsFrom: "dispatch"
      },
      lastRecordedUpdateAt: "2026-01-02T10:00:00.000Z",
      source: "prestashop_current_state",
      isRealTimeTracking: false
    },
    provenance: provenance(customerId, "order_status"),
    warnings: []
  };
}

function rfmPayload(masterCustomerId = "9001") {
  return {
    status: "available",
    masterCustomerId,
    snapshot: {
      snapshotId: "55",
      calculationVersion: "rfm-population-v1",
      referenceTime: "2026-08-03T00:00:00.000Z",
      publishedAt: "2026-08-03T01:00:00.000Z",
      currencyCode: "CLP"
    },
    rfm: {
      recencyDays: 2,
      frequencyOrders: 3,
      grossOrderValueTaxIncl: "123456.780000",
      averageOrderValueTaxIncl: "41152.260000",
      recencyScore: 5,
      frequencyScore: 3,
      monetaryScore: 4,
      rfmCode: "R5F3M4"
    },
    segment: {
      code: "LOYAL",
      version: "rfm-commercial-v1"
    },
    contractVersion: CUSTOMER_RFM_CONTRACT_VERSION
  };
}

const ENV_KEYS = ["CUSTOMER_PROFILE_ENABLED", "CUSTOMER_PROFILE_BASE_URL", "CUSTOMER_PROFILE_TIMEOUT_MS", "CUSTOMER_PROFILE_AUTH_TOKEN"] as const;

async function withEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => void | Promise<void>) {
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

test("readCustomerProfileClientConfig is disabled by default and allows an empty auth token", async () => {
  await withEnv({}, () => {
    assert.deepEqual(readCustomerProfileClientConfig(), {
      enabled: false,
      baseUrl: null,
      timeoutMs: 3000,
      authToken: null
    });
  });
});

test("readCustomerProfileClientConfig requires a base URL only when enabled", async () => {
  await withEnv({ CUSTOMER_PROFILE_ENABLED: "true" }, () => {
    assert.throws(() => readCustomerProfileClientConfig(), CustomerProfileClientConfigurationError);
  });
});

test("readCustomerProfileClientConfig validates URL and timeout shape", async () => {
  await withEnv({ CUSTOMER_PROFILE_ENABLED: "true", CUSTOMER_PROFILE_BASE_URL: "ftp://example.com" }, () => {
    assert.throws(() => readCustomerProfileClientConfig(), CustomerProfileClientConfigurationError);
  });
  await withEnv({ CUSTOMER_PROFILE_ENABLED: "true", CUSTOMER_PROFILE_BASE_URL: baseUrl, CUSTOMER_PROFILE_TIMEOUT_MS: "0" }, () => {
    assert.throws(() => readCustomerProfileClientConfig(), CustomerProfileClientConfigurationError);
  });
});

test("createCustomerProfileClient returns disabled mode when CUSTOMER_PROFILE_ENABLED=false and never calls fetch", async () => {
  await withEnv({}, async () => {
    const client = createCustomerProfileClient();
    const result = await client.getProfile({ customerId: 1 });
    assert.deepEqual(result, { status: "UNAVAILABLE", reason: "CUSTOMER_PROFILE_DISABLED", retryable: false });
    assert.equal(requestCount, 0);
  });
});

test("profile request sends GET headers, no body, optional authorization and request id", async () => {
  handler = (_req, res) => sendJson(res, 200, profilePayload());
  const result = await makeClient({ authToken: "secret-token" }).getProfile({ customerId: 1, requestId: "req-1" });
  assert.equal(result.status, "AVAILABLE");
  assert.equal(lastMethod, "GET");
  assert.equal(lastUrl, "/v1/customers/1/profile");
  assert.equal(lastHeaders.accept, "application/json");
  assert.equal(lastHeaders["x-service-name"], "crm-customer-360");
  assert.equal(lastHeaders.authorization, "Bearer secret-token");
  assert.equal(lastHeaders["x-request-id"], "req-1");
  assert.equal(lastBody, "");
});

test("commercial summary and readiness parse available responses", async () => {
  const client = makeClient();

  handler = (_req, res) => sendJson(res, 200, summaryPayload());
  const summary = await client.getCommercialSummary({ customerId: 1 });
  assert.equal(summary.status, "AVAILABLE");
  if (summary.status === "AVAILABLE") {
    assert.equal(summary.data.summary.totalOrders, 2);
    assert.equal(summary.metadata.contractVersion, CUSTOMER_PROFILE_CONTRACT_VERSION);
  }

  handler = (_req, res) =>
    sendJson(res, 200, {
      status: "ready",
      prestashop: true,
      crm: false,
      customerIdentitySource: "PRESTASHOP",
      identityStatus: "DIRECT_SOURCE",
      contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION
    });
  const readiness = await client.checkReadiness({ requestId: "ready-1" });
  assert.equal(readiness.status, "AVAILABLE");
  if (readiness.status === "AVAILABLE") {
    assert.equal(readiness.data.status, "ready");
    assert.equal(readiness.metadata.identitySource, "PRESTASHOP");
  }
});

test("rfm request uses the ps_customer.id_customer-space customerId, preserves monetary precision, and allows historical null segment", async () => {
  handler = (_req, res) => sendJson(res, 200, rfmPayload("9001"));
  const available = await makeClient().getRfm({ customerId: 9001, requestId: "rfm-1" });
  assert.equal(available.status, "AVAILABLE");
  assert.equal(lastUrl, "/v1/customers/9001/rfm");
  if (available.status === "AVAILABLE") {
    assert.equal(available.data.rfm.grossOrderValueTaxIncl, "123456.780000");
    assert.equal(available.metadata.segmentVersion, "rfm-commercial-v1");
  }

  handler = (_req, res) => sendJson(res, 200, { ...rfmPayload("9001"), segment: { code: null, version: null } });
  const historical = await makeClient().getRfm({ customerId: 9001 });
  assert.equal(historical.status, "AVAILABLE");
  if (historical.status === "AVAILABLE") {
    assert.equal(historical.data.segment.code, null);
    assert.equal(historical.data.segment.version, null);
  }
});

test("purchased products uses limit/offset defaults and explicit params", async () => {
  handler = (_req, res) => sendJson(res, 200, purchasedProductsPayload());
  const client = makeClient();
  const defaults = await client.getPurchasedProducts({ customerId: 1 });
  assert.equal(defaults.status, "AVAILABLE");
  assert.equal(lastUrl, "/v1/customers/1/purchased-products?limit=20&offset=0");

  handler = (_req, res) => sendJson(res, 200, { ...purchasedProductsPayload(), pagination: { limit: 100, offset: 10, returned: 1, hasMore: true } });
  const explicit = await client.getPurchasedProducts({ customerId: 1, limit: 100, offset: 10 });
  assert.equal(explicit.status, "AVAILABLE");
  assert.equal(lastUrl, "/v1/customers/1/purchased-products?limit=100&offset=10");
});

test("purchase behavior uses topProducts/topVariants defaults and explicit params", async () => {
  handler = (_req, res) => sendJson(res, 200, purchaseBehaviorPayload());
  const client = makeClient();
  const defaults = await client.getPurchaseBehavior({ customerId: 1 });
  assert.equal(defaults.status, "AVAILABLE");
  assert.equal(lastUrl, "/v1/customers/1/purchase-behavior?topProducts=5&topVariants=5");

  handler = (_req, res) => sendJson(res, 200, purchaseBehaviorPayload());
  const explicit = await client.getPurchaseBehavior({ customerId: 1, topProducts: 10, topVariants: 1 });
  assert.equal(explicit.status, "AVAILABLE");
  assert.equal(lastUrl, "/v1/customers/1/purchase-behavior?topProducts=10&topVariants=1");
});

test("order status encodes the reference and never sends it in logs", async () => {
  const seen: unknown[] = [];
  const originalInfo = console.info;
  console.info = (...args: unknown[]) => {
    seen.push(args);
  };
  try {
    handler = (_req, res) => sendJson(res, 200, orderStatusPayload());
    const result = await makeClient().getOrderStatus({ customerId: 1, orderReference: "ABC123XYZ" });
    assert.equal(result.status, "AVAILABLE");
    assert.equal(lastUrl, "/v1/customers/1/orders/ABC123XYZ/status");
    assert.equal(JSON.stringify(seen).includes("ABC123XYZ"), false);
  } finally {
    console.info = originalInfo;
  }
});

test("invalid local input is rejected before any network call", async () => {
  const client = makeClient();
  assert.deepEqual(await client.getProfile({ customerId: 0 }), { status: "INVALID_REQUEST", reason: "INVALID_CUSTOMER_ID" });
  assert.deepEqual(await client.getRfm({ customerId: 0 }), { status: "INVALID_REQUEST", reason: "INVALID_CUSTOMER_ID" });
  assert.deepEqual(await client.getPurchasedProducts({ customerId: 1, limit: 101 }), { status: "INVALID_REQUEST", reason: "INVALID_LIMIT" });
  assert.deepEqual(await client.getPurchaseBehavior({ customerId: 1, topVariants: 11 }), { status: "INVALID_REQUEST", reason: "INVALID_TOP_VARIANTS" });
  assert.deepEqual(await client.getOrderStatus({ customerId: 1, orderReference: "bad ref" }), { status: "INVALID_REQUEST", reason: "INVALID_ORDER_REFERENCE" });
  assert.equal(requestCount, 0);
});

test("404 maps to CUSTOMER_NOT_FOUND and ORDER_NOT_FOUND using the response body contract", async () => {
  const client = makeClient();
  handler = (_req, res) => sendJson(res, 404, { status: "customer_not_found", customerId: 999 });
  assert.deepEqual(await client.getProfile({ customerId: 999 }), { status: "NOT_FOUND", reason: "CUSTOMER_NOT_FOUND" });

  handler = (_req, res) => sendJson(res, 404, { status: "order_not_found", customerId: 1 });
  assert.deepEqual(await client.getOrderStatus({ customerId: 1, orderReference: "NOPE1234" }), { status: "NOT_FOUND", reason: "ORDER_NOT_FOUND" });

  handler = (_req, res) => sendJson(res, 404, { status: "customer_not_found", masterCustomerId: "9001" });
  assert.deepEqual(await client.getRfm({ customerId: 9001 }), { status: "NOT_FOUND", reason: "CUSTOMER_NOT_FOUND" });

  handler = (_req, res) => sendJson(res, 404, { status: "rfm_not_available", masterCustomerId: "9001" });
  assert.deepEqual(await client.getRfm({ customerId: 9001 }), { status: "NOT_FOUND", reason: "RFM_NOT_AVAILABLE" });
});

test("400, 429, 500 and 503 reasons map to the canonical result taxonomy", async () => {
  const client = makeClient();

  handler = (_req, res) => sendJson(res, 400, { error: "invalid_customer_id" });
  assert.deepEqual(await client.getProfile({ customerId: 1 }), { status: "INVALID_REQUEST", reason: "INVALID_CUSTOMER_ID" });

  handler = (_req, res) => sendJson(res, 429, { error: "rate_limited" });
  assert.deepEqual(await client.getProfile({ customerId: 1 }), { status: "UNAVAILABLE", reason: "CUSTOMER_PROFILE_UNAVAILABLE", retryable: true });

  handler = (_req, res) => sendJson(res, 500, { error: "internal_error", stack: "at foo()" });
  assert.deepEqual(await client.getProfile({ customerId: 1 }), { status: "UNAVAILABLE", reason: "CUSTOMER_PROFILE_UNAVAILABLE", retryable: true });

  handler = (_req, res) => sendJson(res, 503, { status: "degraded", reason: "prestashop_unavailable" });
  assert.deepEqual(await client.getProfile({ customerId: 1 }), { status: "UNAVAILABLE", reason: "PRESTASHOP_UNAVAILABLE", retryable: true });

  handler = (_req, res) => sendJson(res, 503, { status: "degraded", reason: "prestashop_schema_incompatible" });
  assert.deepEqual(await client.getPurchaseBehavior({ customerId: 1 }), { status: "UNAVAILABLE", reason: "PRESTASHOP_SCHEMA_INCOMPATIBLE", retryable: true });

  handler = (_req, res) => sendJson(res, 503, { status: "degraded", reason: "customer_profile_unavailable" });
  assert.deepEqual(await client.getProfile({ customerId: 1 }), { status: "UNAVAILABLE", reason: "CUSTOMER_PROFILE_UNAVAILABLE", retryable: true });

  handler = (_req, res) => sendJson(res, 503, { status: "degraded", reason: "no_published_rfm_snapshot" });
  assert.deepEqual(await client.getRfm({ customerId: 9001 }), { status: "UNAVAILABLE", reason: "RFM_DEGRADED", retryable: true });
});

test("invalid JSON and invalid schema are separated into unavailable vs contract error", async () => {
  const client = makeClient();

  handler = (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{not json");
  };
  assert.deepEqual(await client.getProfile({ customerId: 1 }), { status: "UNAVAILABLE", reason: "CUSTOMER_PROFILE_UNAVAILABLE", retryable: true });

  handler = (_req, res) => sendJson(res, 200, { ...profilePayload(), profile: { ...profilePayload().profile, customer: { ...profilePayload().profile.customer, firstname: 123 } } });
  assert.deepEqual(await client.getProfile({ customerId: 1 }), { status: "CONTRACT_ERROR", reason: "INVALID_RESPONSE" });

  handler = (_req, res) => sendJson(res, 200, { ...rfmPayload("9001"), masterCustomerId: "9002" });
  assert.deepEqual(await client.getRfm({ customerId: 9001 }), { status: "CONTRACT_ERROR", reason: "PROVENANCE_MISMATCH" });
});

test("provenance mismatches become CONTRACT_ERROR and the payload is rejected", async () => {
  const client = makeClient();
  const payload = profilePayload();
  payload.provenance.customerIdentity.customerId = 999;
  handler = (_req, res) => sendJson(res, 200, payload);
  assert.deepEqual(await client.getProfile({ customerId: 1 }), { status: "CONTRACT_ERROR", reason: "PROVENANCE_MISMATCH" });
});

test("readiness 503 maps to PRESTASHOP-specific unavailable reasons", async () => {
  const client = makeClient();
  handler = (_req, res) =>
    sendJson(res, 503, {
      status: "not_ready",
      prestashop: false,
      crm: false,
      customerIdentitySource: "PRESTASHOP",
      identityStatus: "DIRECT_SOURCE",
      contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
      reason: "prestashop_schema_incompatible"
    });
  assert.deepEqual(await client.checkReadiness(), { status: "UNAVAILABLE", reason: "PRESTASHOP_SCHEMA_INCOMPATIBLE", retryable: true });
});

test("timeout and network failures are sanitized and retryable", async () => {
  handler = (_req, res) => {
    setTimeout(() => sendJson(res, 200, profilePayload()), 300);
  };
  const timeoutResult = await makeClient({ timeoutMs: 50 }).getProfile({ customerId: 1 });
  assert.deepEqual(timeoutResult, { status: "UNAVAILABLE", reason: "CUSTOMER_PROFILE_TIMEOUT", retryable: true });

  const networkResult = await createHttpCustomerProfileClient(config({ baseUrl: "http://127.0.0.1:1", timeoutMs: 100 })).getProfile({ customerId: 1 });
  assert.deepEqual(networkResult, { status: "UNAVAILABLE", reason: "CUSTOMER_PROFILE_UNAVAILABLE", retryable: true });

  const rfmNetworkResult = await createHttpCustomerProfileClient(config({ baseUrl: "http://127.0.0.1:1", timeoutMs: 100 })).getRfm({ customerId: 9001 });
  assert.deepEqual(rfmNetworkResult, { status: "UNAVAILABLE", reason: "CUSTOMER_PROFILE_UNAVAILABLE", retryable: true });
});

test("the client logs only safe observability fields and never leaks token, PII or raw provider details", async () => {
  const seen: unknown[] = [];
  const originalInfo = console.info;
  console.info = (...args: unknown[]) => {
    seen.push(args);
  };
  try {
    handler = (_req, res) => sendJson(res, 200, profilePayload());
    await makeClient({ authToken: "super-secret-token" }).getProfile({ customerId: 1, requestId: "req-safe" });
    const serialized = JSON.stringify(seen);
    assert.equal(serialized.includes("super-secret-token"), false);
    assert.equal(serialized.includes("synthetic@example.com"), false);
    assert.equal(serialized.includes("REF100"), false);
    assert.equal(serialized.includes("10000.000000"), false);
    assert.equal(serialized.includes("status\":\"AVAILABLE\""), true);
  } finally {
    console.info = originalInfo;
  }
});

test("rfm adapter logs normalized lookup observability without leaking raw provider payloads", async () => {
  const seen: unknown[] = [];
  const originalInfo = console.info;
  console.info = (...args: unknown[]) => {
    seen.push(args);
  };
  try {
    handler = (_req, res) => sendJson(res, 200, rfmPayload("9001"));
    await makeClient().getRfm({ customerId: 9001, requestId: "rfm-safe" });
    const serialized = JSON.stringify(seen);
    assert.equal(serialized.includes("\"event\":\"customer_rfm_lookup\""), true);
    assert.equal(serialized.includes("\"rfm_lookup_status\":\"AVAILABLE\""), true);
    assert.equal(serialized.includes("\"rfm_contract_version\":\"customer-rfm-runtime-v1\""), true);
    assert.equal(serialized.includes("\"rfm_segment_version\":\"rfm-commercial-v1\""), true);
    assert.equal(serialized.includes("prestashopCustomerId"), false);
  } finally {
    console.info = originalInfo;
  }
});

test("no internal retry is performed on upstream failure", async () => {
  handler = (_req, res) => sendJson(res, 503, { status: "degraded", reason: "prestashop_unavailable" });
  await makeClient().getProfile({ customerId: 1 });
  assert.equal(requestCount, 1);
});
