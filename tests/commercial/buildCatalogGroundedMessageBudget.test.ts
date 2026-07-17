import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";

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
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true"
});

import { getPool } from "@/lib/db";
import { buildCatalogGroundedMessage } from "@/lib/brain/commercial/native-cycle/buildCatalogGroundedMessage";
import { resetCapabilityGatewayCatalogPortForTests } from "@/lib/brain/commercial/capability-gateway/registry";
import type { CapabilityExecutionStageExecution } from "@/lib/brain/commercial/native-cycle/runCapabilityExecutionStage";
import type { SalesAgentToolRequest } from "@/lib/brain/commercial/sales-agent/validationTypes";

/**
 * ACS-R1-05-T06.2 (C6/C7/C8): direct coverage of the search -> batch ->
 * budget-tier ranking -> grounded composer pipeline, independent of the
 * full native cycle. Reproduces the reported pilot incident scenario:
 * "jaula de potencia" with a $800.000 CLP budget must yield a grounded,
 * budget-aware recommendation instead of silence or an ungrounded reply.
 */

let server: http.Server;
let baseUrl: string;
let batchRequests: Array<{ productId: number }[]> = [];

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/v1/products/search") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          query: "jaula de potencia",
          items: [
            { productId: 10, combinationId: 0, sku: "JP-10", name: "Jaula de potencia economica", variantLabel: null, shortDescription: null, physicalQuantity: 3, available: true, matchType: "exact_name" },
            { productId: 11, combinationId: 0, sku: "JP-11", name: "Jaula de potencia estandar", variantLabel: null, shortDescription: null, physicalQuantity: 2, available: true, matchType: "partial_name" },
            { productId: 12, combinationId: 0, sku: "JP-12", name: "Jaula de potencia premium", variantLabel: null, shortDescription: null, physicalQuantity: 1, available: true, matchType: "partial_name" }
          ],
          freshness: { cached: false, generatedAt: new Date().toISOString() }
        })
      );
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/products/batch") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const parsed = JSON.parse(body) as { items: Array<{ productId: number }> };
        batchRequests.push(parsed.items);
        const prices: Record<number, number> = { 10: 349990, 11: 790000, 12: 950000 };
        const names: Record<number, string> = { 10: "Jaula de potencia economica", 11: "Jaula de potencia estandar", 12: "Jaula de potencia premium" };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            items: parsed.items.map((item) => ({
              ok: true,
              input: { productId: item.productId, combinationId: 0, quantity: 1 },
              product: {
                product: { productId: item.productId, name: names[item.productId], sku: `JP-${item.productId}`, shortDescription: null, longDescription: null, active: true },
                selectedVariant: null,
                attributes: [],
                variants: [],
                pricing: {
                  quantity: 1,
                  baseUnitPrice: prices[item.productId],
                  effectiveUnitPrice: prices[item.productId],
                  subtotal: prices[item.productId],
                  currency: "CLP",
                  taxIncluded: true,
                  taxMode: "configured_rate",
                  discountApplied: false,
                  discountType: null,
                  discountValue: null,
                  specificPriceId: null,
                  pricingMode: "sql_specific_price"
                },
                stock: { physicalQuantity: 2, available: true, shopId: 1 },
                freshness: { productCheckedAt: new Date().toISOString(), priceCalculatedAt: new Date().toISOString(), stockCheckedAt: new Date().toISOString(), cached: false }
              }
            }))
          })
        );
      });
      return;
    }
    res.writeHead(404).end();
  });
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

function makeSearchExecution(): CapabilityExecutionStageExecution[] {
  const toolRequest: SalesAgentToolRequest = {
    tool: "searchProducts",
    purpose: "Buscar jaulas de potencia reales en el catalogo.",
    status: "planned",
    requiredInputs: { query: "jaula de potencia" },
    optionalInputs: null,
    urgency: "high",
    blocking: false,
    reason: "test",
    expectedEvidence: ["product_tool"],
    fallbackDecision: "respond_now",
    confidence: "high",
    riskLevel: "low"
  };
  return [
    {
      toolRequest,
      capability: "search_products",
      result: {
        capability: "search_products",
        version: "capability-gateway.v1",
        availability: "available",
        status: "completed",
        data: {
          query: "jaula de potencia",
          items: [
            { productId: "10", combinationId: "0", sku: "JP-10", name: "Jaula de potencia economica", variantLabel: null, shortDescription: null, stockQuantity: 3, availability: "in_stock", matchType: "exact_name" },
            { productId: "11", combinationId: "0", sku: "JP-11", name: "Jaula de potencia estandar", variantLabel: null, shortDescription: null, stockQuantity: 2, availability: "in_stock", matchType: "partial_name" },
            { productId: "12", combinationId: "0", sku: "JP-12", name: "Jaula de potencia premium", variantLabel: null, shortDescription: null, stockQuantity: 1, availability: "in_stock", matchType: "partial_name" }
          ],
          provenance: { source: "catalog_service_http", retrievedAt: new Date().toISOString(), cached: false }
        },
        errorCode: null,
        retryable: false,
        evidence: [],
        warnings: [],
        retryCount: 0,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        executionPublicId: "test-exec-search"
      }
    }
  ];
}

test("ACS-R1-05-T06.2: budget of $800.000 grounds a reply with economy/near_budget/stretch picks - the reported pilot incident", async () => {
  batchRequests = [];
  const previousEnv = { ...process.env };
  Object.assign(process.env, { CATALOG_SERVICE_BASE_URL: baseUrl, CATALOG_SERVICE_API_KEY: "test-key" });
  resetCapabilityGatewayCatalogPortForTests();

  try {
    const result = await buildCatalogGroundedMessage(
      makeSearchExecution(),
      { correlationId: "corr-budget-1", conversationId: 1, opportunityId: null },
      { budgetMax: 800000, usage: "entrenar en casa" }
    );

    assert.equal(result.executed, true);
    assert.equal(batchRequests.length, 1, "batch should be called exactly once for all search candidates together");
    assert.equal(batchRequests[0].length, 3);
    assert.equal(result.ranking?.mode, "mixed");
    assert.ok(result.groundedMessage);
    assert.match(result.groundedMessage!, /Jaula de potencia economica/);
    assert.match(result.groundedMessage!, /Jaula de potencia estandar/);
    assert.match(result.groundedMessage!, /Opción económica/);
    assert.match(result.groundedMessage!, /Opción cercana a tu presupuesto/);
    assert.match(result.groundedMessage!, /entrenar en casa/);
    assert.equal(result.warnings.length, 0);
  } finally {
    process.env = previousEnv;
    resetCapabilityGatewayCatalogPortForTests();
  }
});

test("no budget known: composes a relevance-based grounded reply and asks for a budget", async () => {
  const previousEnv = { ...process.env };
  Object.assign(process.env, { CATALOG_SERVICE_BASE_URL: baseUrl, CATALOG_SERVICE_API_KEY: "test-key" });
  resetCapabilityGatewayCatalogPortForTests();

  try {
    const result = await buildCatalogGroundedMessage(
      makeSearchExecution(),
      { correlationId: "corr-budget-2", conversationId: 1, opportunityId: null },
      { budgetMax: null, usage: null }
    );

    assert.equal(result.ranking?.mode, "relevance");
    assert.ok(result.groundedMessage?.includes("¿Tienes un presupuesto"));
  } finally {
    process.env = previousEnv;
    resetCapabilityGatewayCatalogPortForTests();
  }
});

test("batch capability unavailable: fails safe with a contextual message, never invents a price", async () => {
  const previousEnv = { ...process.env };
  Object.assign(process.env, { CATALOG_SERVICE_BASE_URL: "http://127.0.0.1:1", CATALOG_SERVICE_API_KEY: "test-key", CATALOG_SERVICE_TIMEOUT_MS: "200" });
  resetCapabilityGatewayCatalogPortForTests();

  try {
    const result = await buildCatalogGroundedMessage(
      makeSearchExecution(),
      { correlationId: "corr-budget-3", conversationId: 1, opportunityId: null },
      { budgetMax: 800000, usage: null }
    );

    assert.equal(result.ranking, null);
    assert.ok(result.warnings.includes("catalog_batch_unavailable"));
    assert.doesNotMatch(result.groundedMessage ?? "", /Jaula de potencia/);
  } finally {
    process.env = previousEnv;
    resetCapabilityGatewayCatalogPortForTests();
  }
});
