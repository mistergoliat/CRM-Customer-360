import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { getPool, queryRows } from "@/lib/db";
import { executeGovernedCapability } from "@/lib/brain/commercial/capability-gateway/executeCapability";
import { resetCapabilityGatewayCatalogPortForTests } from "@/lib/brain/commercial/capability-gateway/registry";

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "main_management",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "main_management",
  DATABASE_USER: "crm_app",
  DATABASE_PASSWORD: "una_clave_local",
  DATABASE_URL: ""
});

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
let server: http.Server;
let baseUrl: string;
let handler: Handler = (_req, res) => res.writeHead(500).end();

before(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function clearCatalogEnv() {
  delete process.env.CATALOG_SERVICE_BASE_URL;
  delete process.env.CATALOG_SERVICE_API_KEY;
  resetCapabilityGatewayCatalogPortForTests();
}

function configureCatalogEnv() {
  process.env.CATALOG_SERVICE_BASE_URL = baseUrl;
  process.env.CATALOG_SERVICE_API_KEY = "test-key";
  resetCapabilityGatewayCatalogPortForTests();
}

async function loadExecutionRow(correlationId: string) {
  const rows = await queryRows<Record<string, unknown>>(
    "SELECT * FROM crm_capability_executions WHERE correlation_id = ? ORDER BY id DESC LIMIT 1",
    [correlationId]
  );
  return rows[0] ?? null;
}

test("an unregistered capability is denied and never executed, but is still audited", async () => {
  const correlationId = `cap-test-unregistered-${Date.now()}`;
  const result = await executeGovernedCapability("drop_database", {}, { correlationId });
  assert.equal(result.status, "denied");
  assert.equal(result.errorCode, "capability_not_registered");

  const row = await loadExecutionRow(correlationId);
  assert.ok(row, "expected an audit row for the denied capability");
  assert.equal(row!.execution_status, "denied");
});

test("search_products reports temporarily_blocked (retryable) when the catalog service is not configured", async () => {
  clearCatalogEnv();
  const correlationId = `cap-test-unconfigured-${Date.now()}`;
  const result = await executeGovernedCapability("search_products", { query: "banca" }, { correlationId });
  assert.equal(result.availability, "unavailable");
  assert.equal(result.status, "temporarily_blocked");
  assert.equal(result.retryable, true);
  assert.equal(result.data, null);

  const row = await loadExecutionRow(correlationId);
  assert.equal(row!.availability_status, "unavailable");
  assert.equal(row!.execution_status, "temporarily_blocked");
});

test("search_products executes over T12 (resolve-product-intent), persists the execution, and returns evidence", async () => {
  let requestPath: string | undefined;
  let requestMethod: string | undefined;
  handler = (req, res) => {
    requestPath = req.url;
    requestMethod = req.method;
    sendJson(res, 200, {
      query: { original: "jaula", normalized: "jaula" },
      resolution: { status: "resolved", confidence: 0.9, sourceProduct: { productId: "1" } },
      candidates: [
        {
          product: { productId: "1", name: "Jaula de entrenamiento", price: { amount: 199990, currency: "CLP" }, stock: { status: "in_stock", available: true, quantity: 3 } },
          match: { rank: 1, score: 0.9, reasons: ["EXACT_NAME_MATCH"] }
        }
      ],
      statistics: { retrieved: 1, eligible: 1, returned: 1 },
      warnings: [],
      correlationId: "c"
    });
  };
  configureCatalogEnv();

  const correlationId = `cap-test-search-${Date.now()}`;
  const result = await executeGovernedCapability(
    "search_products",
    { query: "jaula" },
    { correlationId, conversationId: 42, opportunityId: 7 }
  );

  assert.equal(result.status, "completed");
  assert.equal(result.availability, "available");
  assert.ok(result.evidence.length > 0);
  assert.equal(result.executionPublicId !== null, true);
  assert.equal(requestMethod, "POST");
  assert.equal(requestPath, "/api/v2/catalog/resolve-product-intent");

  const row = await loadExecutionRow(correlationId);
  assert.equal(row!.execution_status, "completed");
  assert.equal(row!.capability_name, "search_products");
  assert.equal(row!.conversation_id, 42);
  assert.equal(row!.opportunity_id, 7);
  assert.ok(row!.response_summary_json, "response summary should be persisted");
  assert.ok(row!.evidence_json, "evidence should be persisted");

  const raw = row!.response_summary_json;
  const responseSummary = typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, any>);
  assert.equal(responseSummary.productIntent.resolution.status, "resolved");
  assert.equal(responseSummary.items[0].productId, "1");
  assert.equal(responseSummary.items[0].availability, "in_stock");
});

test("get_product_details without a productId is rejected as invalid_arguments before any HTTP call", async () => {
  let calls = 0;
  handler = (_req, res) => {
    calls += 1;
    sendJson(res, 200, {});
  };
  configureCatalogEnv();

  const correlationId = `cap-test-invalid-args-${Date.now()}`;
  const result = await executeGovernedCapability("get_product_details", {}, { correlationId });
  assert.equal(result.status, "invalid_arguments");
  assert.equal(calls, 0);
});

function exploreResponsePayload(overrides: Record<string, unknown> = {}) {
  return {
    scope: { availability: "available" },
    sort: { by: "price", direction: "desc" },
    totalMatched: 833,
    exhaustiveForScope: true,
    products: [{ productId: "1532", name: "Camara Hiperbarica ST801", price: 8599990, currency: "CLP", stockQuantity: 4, stockScope: "product", availability: "available" }],
    ...overrides
  };
}

test("ACS-R1-05.1-T02.6: explore_catalog reports temporarily_blocked (retryable) when the catalog service is not configured", async () => {
  clearCatalogEnv();
  const correlationId = `cap-test-explore-unconfigured-${Date.now()}`;
  const result = await executeGovernedCapability("explore_catalog", { sort: { by: "price", direction: "desc" }, limit: 1 }, { correlationId });
  assert.equal(result.availability, "unavailable");
  assert.equal(result.status, "temporarily_blocked");
  assert.equal(result.retryable, true);

  const row = await loadExecutionRow(correlationId);
  assert.equal(row!.availability_status, "unavailable");
  assert.equal(row!.execution_status, "temporarily_blocked");
});

test("explore_catalog executes over HTTP, defaults availability to 'available', and persists evidence", async () => {
  let capturedBody: Record<string, unknown> = {};
  handler = (req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      capturedBody = JSON.parse(raw);
      sendJson(res, 200, exploreResponsePayload());
    });
  };
  configureCatalogEnv();

  const correlationId = `cap-test-explore-ok-${Date.now()}`;
  const result = await executeGovernedCapability(
    "explore_catalog",
    { sort: { by: "price", direction: "desc" }, limit: 1 },
    { correlationId, conversationId: 42, opportunityId: 7 }
  );

  assert.equal(result.status, "completed");
  assert.equal(result.availability, "available");
  assert.ok(result.evidence.length > 0);
  assert.equal(capturedBody.availability, "available", "the capability must default availability to 'available' when the model omits it");

  const row = await loadExecutionRow(correlationId);
  assert.equal(row!.execution_status, "completed");
  assert.equal(row!.capability_name, "explore_catalog");
  assert.equal(row!.conversation_id, 42);
  assert.ok(row!.response_summary_json, "response summary should be persisted");
  assert.ok(row!.evidence_json, "evidence should be persisted");
});

test("explore_catalog respects an explicit non-default availability from the model (e.g. 'all')", async () => {
  let capturedBody: Record<string, unknown> = {};
  handler = (req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      capturedBody = JSON.parse(raw);
      sendJson(res, 200, exploreResponsePayload({ scope: { availability: "all" } }));
    });
  };
  configureCatalogEnv();

  const result = await executeGovernedCapability(
    "explore_catalog",
    { sort: { by: "price", direction: "desc" }, limit: 1, availability: "all" },
    { correlationId: `cap-test-explore-all-${Date.now()}` }
  );
  assert.equal(result.status, "completed");
  assert.equal(capturedBody.availability, "all");
});

test("explore_catalog without sort/limit is rejected as invalid_arguments before any HTTP call", async () => {
  let calls = 0;
  handler = (_req, res) => {
    calls += 1;
    sendJson(res, 200, exploreResponsePayload());
  };
  configureCatalogEnv();

  const result = await executeGovernedCapability("explore_catalog", {}, { correlationId: `cap-test-explore-invalid-${Date.now()}` });
  assert.equal(result.status, "invalid_arguments");
  assert.equal(calls, 0);
});

test("explore_catalog rejects price.max < price.min client-side, before any HTTP call", async () => {
  let calls = 0;
  handler = (_req, res) => {
    calls += 1;
    sendJson(res, 200, exploreResponsePayload());
  };
  configureCatalogEnv();

  const result = await executeGovernedCapability(
    "explore_catalog",
    { sort: { by: "price", direction: "asc" }, limit: 1, price: { min: 100000, max: 1000 } },
    { correlationId: `cap-test-explore-price-range-${Date.now()}` }
  );
  assert.equal(result.status, "invalid_arguments");
  assert.equal(result.errorCode, "price_range_invalid");
  assert.equal(calls, 0, "an inverted price range must never reach the Catalog Service");
});

test("explore_catalog maps a Catalog Service rejection (invalid_sort) to invalid_arguments and audits it", async () => {
  handler = (_req, res) => sendJson(res, 400, { error: { code: "invalid_sort", message: "Invalid sort", correlationId: "c" } });
  configureCatalogEnv();

  const correlationId = `cap-test-explore-service-error-${Date.now()}`;
  const result = await executeGovernedCapability("explore_catalog", { sort: { by: "price", direction: "asc" }, limit: 1 }, { correlationId });
  assert.equal(result.status, "invalid_arguments");
  assert.equal(result.errorCode, "invalid_input");

  const row = await loadExecutionRow(correlationId);
  assert.equal(row!.execution_status, "invalid_arguments");
});

test("explore_catalog persisted evidence never leaks the configured API key or raw credentials", async () => {
  handler = (_req, res) => sendJson(res, 200, exploreResponsePayload());
  configureCatalogEnv();

  const correlationId = `cap-test-explore-no-secrets-${Date.now()}`;
  await executeGovernedCapability("explore_catalog", { sort: { by: "price", direction: "desc" }, limit: 1 }, { correlationId });

  const row = await loadExecutionRow(correlationId);
  const serialized = JSON.stringify(row);
  assert.doesNotMatch(serialized, /test-key/);
  assert.doesNotMatch(serialized, /x-api-key/i);
});

test("a retryable failure is retried exactly once at the capability level - the adapter never retries on its own", async () => {
  let requestCount = 0;
  handler = (_req, res) => {
    requestCount += 1;
    // The HTTP adapter makes exactly one physical call per invocation (no
    // adapter-level retry). Fail the first physical call so the Capability
    // Gateway sees one retryable outcome, then succeed on its own retry
    // (2nd physical request). If the adapter ever retried on its own this
    // would take 3+ requests instead of 2.
    if (requestCount === 1) return sendJson(res, 500, { error: { code: "DATABASE_UNAVAILABLE", message: "db down", correlationId: "c" } });
    return sendJson(res, 200, {
      query: { original: "q", normalized: "q" },
      resolution: { status: "no_match", confidence: 0 },
      candidates: [],
      statistics: { retrieved: 0, eligible: 0, returned: 0 },
      warnings: [],
      correlationId: "c"
    });
  };
  configureCatalogEnv();

  const correlationId = `cap-test-retry-${Date.now()}`;
  const result = await executeGovernedCapability("search_products", { query: "q" }, { correlationId });
  assert.equal(result.status, "completed");
  assert.equal(result.retryCount, 1);
  assert.equal(requestCount, 2, "exactly 2 physical HTTP calls: 1 failed + 1 gateway-owned retry - never a doubled retry");

  const row = await loadExecutionRow(correlationId);
  assert.equal(row!.retry_count, 1);
});
