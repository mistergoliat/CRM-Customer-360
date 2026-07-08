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

test("search_products executes over HTTP, persists the execution, and returns evidence", async () => {
  handler = (_req, res) =>
    sendJson(res, 200, {
      query: "jaula",
      items: [{ productId: 1, combinationId: 0, sku: "SKU-1", name: "Jaula de entrenamiento", variantLabel: null, shortDescription: null, physicalQuantity: 3, available: true, matchType: "partial_name" }],
      freshness: { cached: false, generatedAt: new Date().toISOString() }
    });
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

  const row = await loadExecutionRow(correlationId);
  assert.equal(row!.execution_status, "completed");
  assert.equal(row!.capability_name, "search_products");
  assert.equal(row!.conversation_id, 42);
  assert.equal(row!.opportunity_id, 7);
  assert.ok(row!.response_summary_json, "response summary should be persisted");
  assert.ok(row!.evidence_json, "evidence should be persisted");
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
    return sendJson(res, 200, { query: "q", items: [], freshness: { cached: false, generatedAt: new Date().toISOString() } });
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
