import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { runAgentToolLoop } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";
import { createFakeAgentLoopProvider } from "@/lib/brain/commercial/agent-loop/providers/fakeAgentLoopProvider";
import type { AgentLoopProvider } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";
import { resetCatalogRecommendationCapabilityForTests } from "@/lib/brain/commercial/capability-gateway";
import type { NativeCustomerSessionExecutionContext } from "@/lib/brain/commercial/native-cycle/customer-session";
import { closeTestHttpServer } from "../helpers/closeTestHttpServer";

/**
 * CP-R1-T10B8C: exercises the real chain
 * Agent Tool Loop -> recommend_catalog_products (public tool) ->
 * executeGovernedCapability -> Gateway Adapter (T10B8B, real) ->
 * CatalogRecommendationCapability (T10B7, real) -> buildSearchProductsV2Request
 * (T10B6, real) -> HttpCatalogSearchProductsV2Client (T10B5, real) -> local
 * node:http server -> buildToolObservation (T10B8C). No mocked fetch, no
 * productive Catalog Service call, no MariaDB (crm_capability_executions
 * writes go through the real executeGovernedCapability/safeExecute path,
 * same as every other tool already covered by runAgentToolLoop.test.ts - a
 * failed write there is swallowed, never thrown, so no DB is required here).
 */

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void;

let server: http.Server;
let baseUrl: string;
let handler: Handler = (_req, res) => res.writeHead(500).end();
let lastBody = "";
let requestCount = 0;

before(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      requestCount += 1;
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
  requestCount = 0;
  lastBody = "";
  handler = (_req, res) => res.writeHead(500).end();
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
  return { productId: "100", name: "Producto fuente", active: true, price: { amount: 10000, currency: "CLP" }, stock: { status: "in_stock", available: true }, ...overrides };
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

const baseInput = {
  correlationId: "corr-t10b8c-1",
  conversationId: 1,
  opportunityId: null,
  currentTime: "2026-08-05T15:00:00.000Z"
};

function session(overrides: Partial<NativeCustomerSessionExecutionContext> = {}): NativeCustomerSessionExecutionContext {
  return {
    conversationId: "conv-1",
    opportunityId: null,
    trustedInbound: { channel: "whatsapp", externalId: "56911112222", normalizedPhone: "56911112222", messageId: "wamid.1", receivedAt: "2026-08-05T12:00:00.000Z" },
    identity: { status: "identification_required", customerId: null, source: "none", localResolutionOutcome: "identification_required", externalResolutionOutcome: "no_match" },
    masterCustomerIdentity: { status: "identity_unresolved", reason: "identity_not_verified" },
    onboarding: null,
    contextAccess: "none",
    currentTurnConsent: { createCustomer: null, linkExternalIdentity: null },
    freshExternalResolutionEvidence: null,
    ...overrides
  };
}

function toolStepOf(result: Awaited<ReturnType<typeof runAgentToolLoop>>) {
  return result.steps.find((step) => step.step.type === "use_tool");
}

const RECOMMEND_THEN_RESPOND = (message: string, args: Record<string, unknown> = { sourceProduct: { productId: 100 } }) => [
  { type: "use_tool", tool: "recommend_catalog_products", arguments: args },
  { type: "respond", message }
];

// 1. Description/schema reach the model
test("1. recommend_catalog_products description and schema are sent to the model in the gathering phase", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const systemMessages: string[] = [];
  let callIndex = 0;
  const script = RECOMMEND_THEN_RESPOND("Aqui tienes algunas recomendaciones.");
  const provider: AgentLoopProvider = {
    name: "capturing-provider",
    async invoke(request) {
      const system = request.messages.find((message) => message.role === "system");
      if (system) systemMessages.push(system.content);
      const rawOutput = script[Math.min(callIndex, script.length - 1)];
      callIndex += 1;
      return { rawOutput };
    }
  };

  await runAgentToolLoop({ ...baseInput, customerMessage: "que me recomiendas junto a esto?", commercialContextSummary: {}, provider });

  assert.ok(systemMessages[0].includes("recommend_catalog_products"));
  assert.ok(systemMessages[0].includes("sourceProduct"));
});

// 2-4. Model requests the tool, input reaches the real chain, completed observation
test("2-4. the model's use_tool request reaches the real Gateway/T10B7/T10B5 chain and returns a completed observation", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const provider = createFakeAgentLoopProvider({ script: RECOMMEND_THEN_RESPOND("Te recomiendo este producto adicional.", { sourceProduct: { productId: 100 }, limit: 3 }) });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "algo mas para combinar?", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.toolExecutionCount, 1);
  const observation = toolStepOf(result)!.observation!;
  assert.equal(observation.status, "completed");
  const data = observation.data as Record<string, unknown>;
  assert.equal((data.recommendations as unknown[]).length, 1);
  assert.equal(data.customerMode, "generic");

  const sentBody = JSON.parse(lastBody);
  assert.deepEqual(sentBody.sourceProduct, { productId: "100" });
  assert.equal(sentBody.limit, 3);
});

// 5. Empty
test("5. empty recommendations from the real server surface as a completed observation with an empty array", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse({ recommendations: [] }));
  const provider = createFakeAgentLoopProvider({ script: RECOMMEND_THEN_RESPOND("No encontre una recomendacion clara por ahora.") });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "algo mas?", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  const observation = toolStepOf(result)!.observation!;
  assert.equal(observation.status, "completed");
  const data = observation.data as { recommendations: unknown[]; recommendationCount: number };
  assert.deepEqual(data.recommendations, []);
  assert.equal(data.recommendationCount, 0);
});

// 6. Degraded
test("6. a degraded real execution stays completed with degraded=true", async () => {
  handler = (_req, res) =>
    sendJson(
      res,
      200,
      baseResponse({
        execution: { correlationId: "corr", degraded: true, degradationReasons: ["CUSTOMER_AFFINITY_RETRYABLE_FAILURE"], stages: { commercialRecommendation: "completed", customerAffinity: "degraded", personalization: "skipped" } }
      })
    );
  const provider = createFakeAgentLoopProvider({ script: RECOMMEND_THEN_RESPOND("Aqui tienes una recomendacion.") });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "algo mas?", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  const observation = toolStepOf(result)!.observation!;
  assert.equal(observation.status, "completed");
  assert.equal((observation.data as { degraded: boolean }).degraded, true);
});

// 7. Skipped
test("7. an invalid sourceProduct never reaches the real server and surfaces as skipped, never a fabricated empty completed", async () => {
  let called = false;
  handler = (_req, res) => {
    called = true;
    sendJson(res, 200, baseResponse());
  };
  const provider = createFakeAgentLoopProvider({ script: RECOMMEND_THEN_RESPOND("No pude generar una recomendacion en este momento.", { sourceProduct: { productId: -1 } }) });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "algo mas?", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  const observation = toolStepOf(result)!.observation!;
  assert.equal(observation.status, "skipped");
  assert.equal(observation.reason, "source_product_invalid");
  assert.equal(called, false);
});

// 8. Failed
test("8. a real HTTP failure from the server surfaces as a safe failed observation", async () => {
  handler = (_req, res) => sendJson(res, 404, { error: { code: "SOURCE_PRODUCT_NOT_FOUND", message: "Producto fuente no encontrado.", retryable: false } });
  const provider = createFakeAgentLoopProvider({ script: RECOMMEND_THEN_RESPOND("No pude verificar ese producto.") });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "algo mas?", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  const observation = toolStepOf(result)!.observation!;
  assert.equal(observation.status, "failed");
  assert.equal(observation.errorCode, "catalog_service_error");
  assert.equal(observation.providerErrorCode, "SOURCE_PRODUCT_NOT_FOUND");
  assert.equal(observation.retryable, false);
});

// 8b. Failed - SOURCE_PRODUCT_INACTIVE (real 409, real T10B5/T10B6/T10B7/T10B8B chain)
test("8b. a real HTTP 409 SOURCE_PRODUCT_INACTIVE from the server surfaces as a safe failed observation, exactly one call, no retry", async () => {
  handler = (_req, res) => sendJson(res, 409, { error: { code: "SOURCE_PRODUCT_INACTIVE", message: "Producto fuente inactivo.", retryable: false } });
  const provider = createFakeAgentLoopProvider({ script: RECOMMEND_THEN_RESPOND("No pude recomendar sobre ese producto.") });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "algo mas?", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(requestCount, 1, "maxRetries=0 means neither the Gateway nor the Agent Tool Loop may retry this call on its own");
  const observation = toolStepOf(result)!.observation!;
  assert.equal(observation.status, "failed");
  assert.equal(observation.errorCode, "catalog_service_error");
  assert.equal(observation.providerErrorCode, "SOURCE_PRODUCT_INACTIVE");
  assert.equal(observation.retryable, false);
});

// 9. Identity unresolved continues generic, never blocked
test("9. an unresolved trustedCustomerSession runs generic mode through the real loop, never a block or handoff", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const provider = createFakeAgentLoopProvider({ script: RECOMMEND_THEN_RESPOND("Aqui tienes una recomendacion.") });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "algo mas?",
    commercialContextSummary: {},
    trustedCustomerSession: session({ masterCustomerIdentity: { status: "identity_unresolved", reason: "identity_not_verified" } }),
    provider
  });

  assert.equal(result.terminalReason, "responded");
  const observation = toolStepOf(result)!.observation!;
  assert.equal(observation.status, "completed");
  assert.equal((observation.data as { customerMode: string }).customerMode, "generic");
  const sentBody = JSON.parse(lastBody);
  assert.equal("customer" in sentBody, false);
});

// 10. Second model decision receives this turn's own observation
test("10. the model's second decision receives this turn's own recommend_catalog_products observation", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const userPayloads: string[] = [];
  let callIndex = 0;
  const script = RECOMMEND_THEN_RESPOND("Listo.");
  const provider: AgentLoopProvider = {
    name: "second-turn-capture-provider",
    async invoke(request) {
      const user = request.messages.find((message) => message.role === "user");
      if (user) userPayloads.push(user.content);
      const rawOutput = script[Math.min(callIndex, script.length - 1)];
      callIndex += 1;
      return { rawOutput };
    }
  };

  await runAgentToolLoop({ ...baseInput, customerMessage: "algo mas?", commercialContextSummary: {}, provider });

  assert.equal(userPayloads.length, 2);
  const secondPayload = JSON.parse(userPayloads[1]) as { priorStepsThisTurn: Array<{ observation: { status: string; data: { recommendations: unknown[] } } }> };
  assert.equal(secondPayload.priorStepsThisTurn.length, 1);
  assert.equal(secondPayload.priorStepsThisTurn[0].observation.status, "completed");
  assert.equal(secondPayload.priorStepsThisTurn[0].observation.data.recommendations.length, 1);
});

// 12. No extra retry beyond the Gateway's own maxRetries=0
test("12. no extra retry is added on top of the Gateway's own maxRetries=0 - exactly one HTTP call even on a retryable failure", async () => {
  handler = (_req, res) => sendJson(res, 503, { error: { code: "CATALOG_SERVICE_UNAVAILABLE", message: "Servicio no disponible.", retryable: true } });
  const provider = createFakeAgentLoopProvider({ script: RECOMMEND_THEN_RESPOND("No pude generar una recomendacion en este momento.") });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "algo mas?", commercialContextSummary: {}, provider });

  assert.equal(requestCount, 1, "maxRetries=0 means neither the Gateway nor the Agent Tool Loop may retry this call on its own");
  const observation = toolStepOf(result)!.observation!;
  assert.equal(observation.status, "failed");
  assert.equal(observation.retryable, true);
});

// 13. Tool pool still carries every prior tool
test("13. the tool pool exposed for this run still carries every prior tool, nothing removed", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const systemMessages: string[] = [];
  let callIndex = 0;
  const script = RECOMMEND_THEN_RESPOND("Listo.");
  const provider: AgentLoopProvider = {
    name: "pool-capture-provider",
    async invoke(request) {
      const system = request.messages.find((message) => message.role === "system");
      if (system) systemMessages.push(system.content);
      const rawOutput = script[Math.min(callIndex, script.length - 1)];
      callIndex += 1;
      return { rawOutput };
    }
  };

  await runAgentToolLoop({ ...baseInput, customerMessage: "algo mas?", commercialContextSummary: {}, provider });

  for (const priorTool of ["search_products", "get_product_details", "search_company_knowledge", "explore_catalog"]) {
    assert.ok(systemMessages[0].includes(priorTool), `${priorTool} must still be advertised to the model`);
  }
});

// 14. pendingCatalogAction is never touched by this tool
test("14. recommend_catalog_products never introduces or mutates pendingCatalogAction continuity", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const provider = createFakeAgentLoopProvider({ script: RECOMMEND_THEN_RESPOND("Aqui tienes una recomendacion.") });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "algo mas?", commercialContextSummary: {}, provider });

  assert.equal(result.finalPendingCatalogAction, null);
});
