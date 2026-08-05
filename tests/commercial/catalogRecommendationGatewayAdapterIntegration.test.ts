import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { resolveCapabilityGatewayDefinition } from "@/lib/brain/commercial/capability-gateway/registry";
import { resetCatalogRecommendationCapabilityForTests } from "@/lib/brain/commercial/capability-gateway";
import type { CapabilityGatewayContext, CapabilityGatewayDefinition } from "@/lib/brain/commercial/capability-gateway";
import type { NativeCustomerSessionExecutionContext } from "@/lib/brain/commercial/native-cycle/customer-session";
import { closeTestHttpServer } from "../helpers/closeTestHttpServer";
import { AGENT_LOOP_TOOL_POOL } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";

/**
 * CP-R1-T10B8B: exercises the real chain
 * CapabilityGatewayDefinition (recommend_catalog_products) ->
 * CatalogRecommendationCapability (T10B7, real) ->
 * buildSearchProductsV2Request (T10B6, real) ->
 * HttpCatalogSearchProductsV2Client (T10B5, real) -> local node:http server.
 * No mocked fetch, no productive Catalog Service call, no MariaDB.
 *
 * Persistence isolation (review correction): the real
 * executeGovernedCapability (lib/brain/commercial/capability-gateway/executeCapability.ts)
 * always writes to crm_capability_executions via insertCapabilityExecution,
 * and the Capability Gateway has no dependency-injection seam for that write
 * today. Adding one to production code purely to satisfy a test is out of
 * scope for this task ("no modificar producción para acomodar el test").
 * Instead, `executeWithFakePersistence` below is a test-local, byte-for-byte
 * mirror of executeGovernedCapability's own orchestration (resolve the real
 * registered definition -> real checkAvailability -> real execute, retried
 * exactly as the real Gateway retries -> real buildRequestSummary/
 * buildResponseSummary fallback), with only the final DB write swapped for
 * an in-memory array. Every assertion below still exercises the REAL
 * CapabilityGatewayDefinition, the REAL T10B7/T10B6/T10B5 chain and the REAL
 * local HTTP server - only the persistence backend is a fake, exactly as
 * requested. executeGovernedCapability's own correctness (this exact same
 * orchestration logic) remains covered by tests/commercial/capabilityGateway.test.ts
 * against a real database - not duplicated here.
 */

type FakePersistedExecution = {
  publicId: string;
  correlationId: string;
  capabilityName: string;
  capabilityVersion: string;
  availabilityStatus: string;
  executionStatus: string;
  retryCount: number;
  retryable: boolean;
  errorCode: string | null;
  requestSummary: Record<string, unknown>;
  responseSummary: Record<string, unknown> | null;
  evidence: unknown[];
  opportunityId: number | null;
  conversationId: number | null;
  startedAt: string;
  completedAt: string;
};

type FakeGatewayResult = {
  capability: string;
  version: string;
  availability: string;
  status: string;
  data: Record<string, unknown> | null;
  errorCode: string | null;
  retryable: boolean;
  evidence: unknown[];
  retryCount: number;
  executionPublicId: string | null;
};

async function executeWithFakePersistence(
  capabilityName: string,
  input: Record<string, unknown>,
  context: CapabilityGatewayContext,
  persisted: FakePersistedExecution[]
): Promise<FakeGatewayResult> {
  const startedAt = new Date().toISOString();
  const definition = resolveCapabilityGatewayDefinition(capabilityName) as CapabilityGatewayDefinition | null;
  if (!definition) throw new Error(`test setup error: "${capabilityName}" is not registered`);

  const availability = await definition.checkAvailability(context);
  if (availability.status !== "available") {
    const completedAt = new Date().toISOString();
    const executionStatus = availability.status === "unavailable" ? "temporarily_blocked" : availability.status;
    const retryable = availability.status === "unavailable" || availability.status === "temporarily_blocked";
    const publicId = randomUUID();
    persisted.push({
      publicId,
      correlationId: context.correlationId,
      capabilityName: definition.capability,
      capabilityVersion: definition.version,
      availabilityStatus: availability.status,
      executionStatus,
      retryCount: 0,
      retryable,
      errorCode: availability.reason,
      requestSummary: input,
      responseSummary: null,
      evidence: [],
      opportunityId: context.opportunityId ?? null,
      conversationId: context.conversationId ?? null,
      startedAt,
      completedAt
    });
    return { capability: definition.capability, version: definition.version, availability: availability.status, status: executionStatus, data: null, errorCode: availability.reason, retryable, evidence: [], retryCount: 0, executionPublicId: publicId };
  }

  let retryCount = 0;
  let outcome = await definition.execute(input, context);
  while (outcome.retryable && retryCount < definition.maxRetries) {
    retryCount += 1;
    outcome = await definition.execute(input, context);
  }

  const completedAt = new Date().toISOString();
  const requestSummary = definition.buildRequestSummary ? definition.buildRequestSummary(input, context) : input;
  const responseSummary = definition.buildResponseSummary ? definition.buildResponseSummary(outcome, context) : (outcome.data as Record<string, unknown> | null);
  const publicId = randomUUID();

  persisted.push({
    publicId,
    correlationId: context.correlationId,
    capabilityName: definition.capability,
    capabilityVersion: definition.version,
    availabilityStatus: availability.status,
    executionStatus: outcome.status,
    retryCount,
    retryable: outcome.retryable,
    errorCode: outcome.errorCode,
    requestSummary,
    responseSummary,
    evidence: outcome.evidence,
    opportunityId: context.opportunityId ?? null,
    conversationId: context.conversationId ?? null,
    startedAt,
    completedAt
  });

  return {
    capability: definition.capability,
    version: definition.version,
    availability: availability.status,
    status: outcome.status,
    data: outcome.data,
    errorCode: outcome.errorCode,
    retryable: outcome.retryable,
    evidence: outcome.evidence,
    retryCount,
    executionPublicId: publicId
  };
}

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void;

let server: http.Server;
let baseUrl: string;
let handler: Handler = (_req, res) => res.writeHead(500).end();
let lastHeaders: http.IncomingHttpHeaders = {};
let lastBody = "";
let persistedExecutions: FakePersistedExecution[] = [];

before(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
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
  await closeTestHttpServer(server);
});

test.beforeEach(() => {
  lastHeaders = {};
  lastBody = "";
  persistedExecutions = [];
  handler = (_req, res) => res.writeHead(500).end();
  // 2000ms default (T10B7 integration suite's own precedent): avoids a
  // cold-start flake where the process's very first fetch() call lazily
  // initializes undici and can exceed a shorter timeout on its own, unrelated
  // to server latency.
  process.env.CATALOG_SERVICE_BASE_URL = baseUrl;
  process.env.CATALOG_SERVICE_API_KEY = "test-key";
  process.env.CATALOG_SEARCH_PRODUCTS_V2_TIMEOUT_MS = "2000";
  resetCatalogRecommendationCapabilityForTests();
});

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function productSummary(overrides: Record<string, unknown> = {}) {
  return {
    productId: "100",
    name: "Producto fuente",
    active: true,
    price: { amount: 10000, currency: "CLP" },
    stock: { status: "in_stock", available: true },
    ...overrides
  };
}

function baseResponse(overrides: Record<string, unknown> = {}) {
  return {
    query: null,
    sourceProduct: productSummary(),
    recommendations: [
      {
        product: productSummary({ productId: "200", name: "Recomendado" }),
        rank: 1,
        score: 0.8,
        commercialScore: 0.8,
        affinityScore: 0.5,
        affinityConfidence: "medium",
        ranking: { rank: 1, score: 0.8 },
        relationship: { type: "frequently_bought_together", reliability: 0.6, evidence: { jointCount: 4, support: 0.1, confidence: 0.5, lift: 1.2 } },
        commercialReason: { code: "FREQUENTLY_BOUGHT_TOGETHER", label: "Comprado frecuentemente junto al producto consultado" },
        reasons: [{ code: "STRONG_COMMERCIAL_RELEVANCE", source: "commercial" }],
        warnings: []
      }
    ],
    excluded: [],
    personalization: { applied: false, reason: "customer_not_provided" },
    snapshot: { id: "snap-1", modelVersion: "v1" },
    warnings: [],
    statistics: { commercialCandidates: 1, affinityCandidates: 0, personalizedRecommendations: 0, excludedRecommendations: 0, customerAffinityCalls: 0, personalizationCalls: 0, degradedStages: 0, warningsGenerated: 0 },
    execution: { correlationId: "corr", degraded: false, degradationReasons: [], stages: { commercialRecommendation: "completed", customerAffinity: "skipped", personalization: "completed" } },
    ...overrides
  };
}

function session(overrides: Partial<NativeCustomerSessionExecutionContext> = {}): NativeCustomerSessionExecutionContext {
  return {
    conversationId: "conv-1",
    opportunityId: null,
    trustedInbound: { channel: "whatsapp", externalId: "56911112222", normalizedPhone: "56911112222", messageId: "wamid.1", receivedAt: "2026-07-09T12:00:00.000Z" },
    identity: { status: "identification_required", customerId: null, source: "none", localResolutionOutcome: "identification_required", externalResolutionOutcome: "no_match" },
    masterCustomerIdentity: { status: "identity_unresolved", reason: "identity_not_verified" },
    onboarding: null,
    contextAccess: "none",
    currentTurnConsent: { createCustomer: null, linkExternalIdentity: null },
    freshExternalResolutionEvidence: null,
    ...overrides
  };
}

function gatewayContext(overrides: Partial<CapabilityGatewayContext> = {}): CapabilityGatewayContext {
  return { correlationId: `cap-t10b8b-${Date.now()}-${Math.random().toString(36).slice(2)}`, ...overrides };
}

function loadExecutionRow(correlationId: string): FakePersistedExecution | null {
  return persistedExecutions.find((row) => row.correlationId === correlationId) ?? null;
}

async function run(input: Record<string, unknown>, context: CapabilityGatewayContext) {
  return executeWithFakePersistence("recommend_catalog_products", input, context, persistedExecutions);
}

// 1. Identity resolved -> request with customerId
test("integration: identity resolved sends customer.customerId and context.customerId to the real server", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const ctx = gatewayContext({ trustedCustomerSession: session({ masterCustomerIdentity: { status: "resolved", masterCustomerId: "555", source: "native_session_verified_projection" } }) });
  const result = await run({ sourceProduct: { productId: 100 } }, ctx);
  assert.equal(result.status, "completed");
  const data = result.data as Record<string, unknown>;
  assert.equal(data.customerMode, "identified");
  const sentBody = JSON.parse(lastBody);
  assert.deepEqual(sentBody.customer, { customerId: "555" });
  assert.equal(sentBody.context.customerId, "555");
});

// 2. Identity unresolved -> request without customerId
test("integration: identity unresolved sends no customer field to the real server", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const ctx = gatewayContext({ trustedCustomerSession: session({ masterCustomerIdentity: { status: "identity_unresolved", reason: "identity_not_verified" } }) });
  const result = await run({ sourceProduct: { productId: 100 } }, ctx);
  assert.equal(result.status, "completed");
  const data = result.data as Record<string, unknown>;
  assert.equal(data.customerMode, "generic");
  const sentBody = JSON.parse(lastBody);
  assert.equal("customer" in sentBody, false);
});

// 3. Session absent -> generic mode
test("integration: an absent trustedCustomerSession runs generic mode, never blocked", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const result = await run({ sourceProduct: { productId: 100 } }, gatewayContext());
  assert.equal(result.status, "completed");
  const data = result.data as Record<string, unknown>;
  assert.equal(data.customerMode, "generic");
  const sentBody = JSON.parse(lastBody);
  assert.equal("customer" in sentBody, false);
});

// 4. Completed with recommendations
test("integration: completed preserves recommendations from the real server", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const result = await run({ sourceProduct: { productId: 100 } }, gatewayContext());
  assert.equal(result.status, "completed");
  const data = result.data as Record<string, unknown>;
  assert.equal((data.recommendations as unknown[]).length, 1);
  assert.equal((data.metadata as Record<string, unknown>).recommendationCount, 1);
});

// 5. Empty
test("integration: empty recommendations from the real server stays completed", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse({ recommendations: [] }));
  const result = await run({ sourceProduct: { productId: 100 } }, gatewayContext());
  assert.equal(result.status, "completed");
  const data = result.data as Record<string, unknown>;
  assert.deepEqual(data.recommendations, []);
});

// 6. HTTP 200 degraded
test("integration: HTTP 200 degraded=true from the real server stays completed with metadata.degraded=true", async () => {
  handler = (_req, res) =>
    sendJson(
      res,
      200,
      baseResponse({ execution: { correlationId: "corr", degraded: true, degradationReasons: ["CUSTOMER_AFFINITY_RETRYABLE_FAILURE"], stages: { commercialRecommendation: "completed", customerAffinity: "degraded", personalization: "skipped" } } })
    );
  const result = await run({ sourceProduct: { productId: 100 } }, gatewayContext());
  assert.equal(result.status, "completed");
  const data = result.data as Record<string, unknown>;
  assert.equal((data.metadata as Record<string, unknown>).degraded, true);
});

// 7. Skipped before any HTTP call (Gateway-level invalid_arguments)
test("integration: a skipped mapper result (missing sourceProduct) never reaches the real server", async () => {
  let called = false;
  handler = (_req, res) => {
    called = true;
    sendJson(res, 200, baseResponse());
  };
  const correlationId = `cap-t10b8b-skip-${Date.now()}`;
  const result = await run({}, gatewayContext({ correlationId }));
  assert.equal(result.status, "invalid_arguments");
  assert.equal(called, false);

  const row = loadExecutionRow(correlationId);
  assert.equal(row!.executionStatus, "invalid_arguments");
});

// 7b. Explicit repurchase contradiction (real T10B6) - skipped before any HTTP call
test("integration: explicit repurchase contradiction (sourceProduct also excluded) is skipped by the real T10B6 chain, zero HTTP calls", async () => {
  let called = false;
  handler = (_req, res) => {
    called = true;
    sendJson(res, 200, baseResponse());
  };
  const correlationId = `cap-t10b8b-repurchase-contradiction-${Date.now()}`;
  const result = await run({ sourceProduct: { productId: 100 }, excludedProducts: [{ productId: 100 }], explicitRepurchaseRequested: true }, gatewayContext({ correlationId }));
  assert.equal(result.status, "completed");
  assert.deepEqual(result.data, { status: "skipped", reason: "contradictory_product_context" });
  assert.equal(called, false);
});

// 7c. Explicit repurchase, generic mode, real chain end-to-end
test("integration: explicit repurchase in generic mode (no identity) reaches the real server with explicitRepurchaseProducts set, no customer field", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const result = await run({ sourceProduct: { productId: 100 }, explicitRepurchaseRequested: true }, gatewayContext());
  assert.equal(result.status, "completed");
  const data = result.data as Record<string, unknown>;
  assert.equal(data.customerMode, "generic");
  assert.equal((data.metadata as Record<string, unknown>).explicitRepurchaseApplied, true);
  const sentBody = JSON.parse(lastBody);
  assert.equal("customer" in sentBody, false);
  assert.deepEqual(sentBody.context.explicitRepurchaseProducts, [{ productId: "100" }]);
});

// 7d. Explicit repurchase, identified mode, real chain end-to-end
test("integration: explicit repurchase with identity resolved reaches the real server with both customerId and explicitRepurchaseProducts set", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const ctx = gatewayContext({ trustedCustomerSession: session({ masterCustomerIdentity: { status: "resolved", masterCustomerId: "555", source: "native_session_verified_projection" } }) });
  const result = await run({ sourceProduct: { productId: 100 }, explicitRepurchaseRequested: true }, ctx);
  assert.equal(result.status, "completed");
  const data = result.data as Record<string, unknown>;
  assert.equal(data.customerMode, "identified");
  assert.equal((data.metadata as Record<string, unknown>).explicitRepurchaseApplied, true);
  const sentBody = JSON.parse(lastBody);
  assert.deepEqual(sentBody.customer, { customerId: "555" });
  assert.deepEqual(sentBody.context.explicitRepurchaseProducts, [{ productId: "100" }]);
});

// 8. 404 SOURCE_PRODUCT_NOT_FOUND
test("integration: HTTP 404 SOURCE_PRODUCT_NOT_FOUND yields failed with the remote code preserved", async () => {
  handler = (_req, res) => sendJson(res, 404, { error: { code: "SOURCE_PRODUCT_NOT_FOUND", message: "Producto fuente no encontrado.", retryable: false } });
  const result = await run({ sourceProduct: { productId: 100 } }, gatewayContext());
  assert.equal(result.status, "failed");
  const data = result.data as Record<string, unknown>;
  assert.equal(data.code, "catalog_service_error");
  assert.equal(data.httpStatus, 404);
  assert.equal(data.providerErrorCode, "SOURCE_PRODUCT_NOT_FOUND");
});

// 9. 409 SOURCE_PRODUCT_INACTIVE
test("integration: HTTP 409 SOURCE_PRODUCT_INACTIVE yields failed with the remote code preserved", async () => {
  handler = (_req, res) => sendJson(res, 409, { error: { code: "SOURCE_PRODUCT_INACTIVE", message: "Producto fuente inactivo.", retryable: false } });
  const result = await run({ sourceProduct: { productId: 100 } }, gatewayContext());
  assert.equal(result.status, "failed");
  const data = result.data as Record<string, unknown>;
  assert.equal(data.code, "catalog_service_error");
  assert.equal(data.httpStatus, 409);
  assert.equal(data.providerErrorCode, "SOURCE_PRODUCT_INACTIVE");
});

// 10. 503
test("integration: HTTP 503 yields a retryable failed result, never retried by the adapter itself (maxRetries=0)", async () => {
  let requestCount = 0;
  handler = (_req, res) => {
    requestCount += 1;
    sendJson(res, 503, { error: { code: "CATALOG_SERVICE_UNAVAILABLE", message: "Servicio no disponible.", retryable: true } });
  };
  const result = await run({ sourceProduct: { productId: 100 } }, gatewayContext());
  assert.equal(result.status, "failed");
  assert.equal(result.retryable, true);
  assert.equal(result.retryCount, 0);
  assert.equal(requestCount, 1, "maxRetries=0 means the Gateway must not retry on its own");
});

// 11. Timeout
test("integration: a server that never responds yields a retryable timeout failed result", async () => {
  process.env.CATALOG_SEARCH_PRODUCTS_V2_TIMEOUT_MS = "100";
  resetCatalogRecommendationCapabilityForTests();
  handler = () => {
    /* never responds - the real client's own internal timeout must fire */
  };
  const result = await run({ sourceProduct: { productId: 100 } }, gatewayContext());
  assert.equal(result.status, "failed");
  const data = result.data as Record<string, unknown>;
  assert.equal(data.code, "timeout");
  assert.equal(result.retryable, true);
});

// 12. Correlation header
test("integration: correlationId is delivered as x-correlation-id header, never inside the body", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const correlationId = "corr-t10b8b-integration-1";
  await run({ sourceProduct: { productId: 100 } }, gatewayContext({ correlationId }));
  assert.equal(lastHeaders["x-correlation-id"], correlationId);
  assert.equal(lastBody.includes(correlationId), false);
});

// 13. Persistence via the fake Gateway executor - never leaks masterCustomerId/API key
test("integration: persisted execution audits the call and never leaks masterCustomerId or the API key", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const correlationId = `cap-t10b8b-persist-${Date.now()}`;
  const ctx = gatewayContext({ correlationId, conversationId: 42, opportunityId: 7, trustedCustomerSession: session({ masterCustomerIdentity: { status: "resolved", masterCustomerId: "90071234", source: "native_session_verified_projection" } }) });
  const result = await run({ sourceProduct: { productId: 100 } }, ctx);
  assert.equal(result.status, "completed");
  assert.equal(result.executionPublicId !== null, true);
  const data = result.data as Record<string, unknown>;
  assert.equal(data.customerMode, "identified");

  const row = loadExecutionRow(correlationId);
  assert.equal(row!.executionStatus, "completed");
  assert.equal(row!.capabilityName, "recommend_catalog_products");
  assert.equal(row!.conversationId, 42);
  assert.equal(row!.opportunityId, 7);
  assert.equal(row!.retryCount, 0);
  const serialized = JSON.stringify(row);
  assert.doesNotMatch(serialized, /90071234/);
  assert.doesNotMatch(serialized, /test-key/);
  assert.doesNotMatch(serialized, /x-api-key/i);
  // requestSummary is exactly the caller-facing Gateway input (never the
  // internal T10B7/T10B5 request body, which would carry customerId) -
  // identity.customerId is also never part of this input at all.
  assert.equal("masterCustomerId" in row!.requestSummary, false);
  assert.equal("customerId" in row!.requestSummary, false);
});

// 13b. Skipped persistence is distinguishable from a real completed/empty result
test("integration: a skipped result's persisted responseSummary is distinguishable from completed - status:'skipped', reason preserved, no fabricated recommendations", async () => {
  const correlationId = `cap-t10b8b-persist-skipped-${Date.now()}`;
  const result = await run({ sourceProduct: { productId: -1 } }, gatewayContext({ correlationId }));
  assert.equal(result.status, "completed");
  assert.deepEqual(result.data, { status: "skipped", reason: "source_product_invalid" });

  const row = loadExecutionRow(correlationId);
  assert.equal(row!.executionStatus, "completed");
  assert.equal(row!.retryable, false);
  assert.deepEqual(row!.responseSummary, { status: "skipped", reason: "source_product_invalid" });
  assert.equal("recommendations" in (row!.responseSummary as Record<string, unknown>), false, "a skipped payload must never fabricate a recommendations key");
});

// 14. Visible in the Agent Tool Loop as of CP-R1-T10B8C
test("integration: recommend_catalog_products is executable via the Gateway and is in AGENT_LOOP_TOOL_POOL (CP-R1-T10B8C)", () => {
  assert.equal((AGENT_LOOP_TOOL_POOL as readonly string[]).includes("recommend_catalog_products"), true);
});

// Availability: reflects real T10B5 configuration, no HTTP call
test("integration: reports unavailable (retryable temporarily_blocked) when the catalog service is not configured, no HTTP call made", async () => {
  delete process.env.CATALOG_SERVICE_BASE_URL;
  delete process.env.CATALOG_SERVICE_API_KEY;
  resetCatalogRecommendationCapabilityForTests();
  let called = false;
  handler = (_req, res) => {
    called = true;
    sendJson(res, 200, baseResponse());
  };
  const result = await run({ sourceProduct: { productId: 100 } }, gatewayContext());
  assert.equal(result.availability, "unavailable");
  assert.equal(result.status, "temporarily_blocked");
  assert.equal(result.retryable, true);
  assert.equal(called, false);
});

// Singleton: the registered definition never captures a stale capability
// reference - toggling from unconfigured to configured (with a reset in
// between, as any real runtime config change would require) is picked up
// immediately by the SAME resolved CapabilityGatewayDefinition object.
test("singleton: the registry-held definition never captures a stale capability instance across a reset", async () => {
  delete process.env.CATALOG_SERVICE_BASE_URL;
  delete process.env.CATALOG_SERVICE_API_KEY;
  resetCatalogRecommendationCapabilityForTests();
  const definition = resolveCapabilityGatewayDefinition("recommend_catalog_products") as CapabilityGatewayDefinition;

  const unconfiguredResult = await definition.execute({ sourceProduct: { productId: 100 } }, gatewayContext());
  assert.equal(unconfiguredResult.status, "failed");
  if (unconfiguredResult.status === "failed") assert.equal((unconfiguredResult.data as Record<string, unknown> | null)?.code, "configuration_error");

  handler = (_req, res) => sendJson(res, 200, baseResponse());
  process.env.CATALOG_SERVICE_BASE_URL = baseUrl;
  process.env.CATALOG_SERVICE_API_KEY = "test-key";
  resetCatalogRecommendationCapabilityForTests();

  const configuredResult = await definition.execute({ sourceProduct: { productId: 100 } }, gatewayContext());
  assert.equal(configuredResult.status, "completed", "the same registered definition object must reflect the post-reset singleton, never a stale reference captured at registry-build time");
});
