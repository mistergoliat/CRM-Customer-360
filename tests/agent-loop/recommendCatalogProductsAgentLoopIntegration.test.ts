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

/**
 * CP-R1-T10B8D: recommend_catalog_products now validates sourceProduct
 * against observed evidence before calling the Gateway - every scripted
 * `sourceProduct: { productId: 100 }` call in this file needs productId
 * "100" to already be observed evidence, or the new gate blocks it before it
 * ever reaches the real HTTP chain this file exists to exercise. A one-item
 * recentCatalogContext (as if search_products had surfaced it) is the
 * minimal fixture that keeps every test's original intent intact.
 */
const OBSERVED_SOURCE_PRODUCT_CONTEXT = {
  interactions: [
    {
      inboundMessageId: "msg-prior-search",
      completedAt: "2026-08-05T14:59:00.000Z",
      sourceTool: "search_products" as const,
      products: [{ position: 1, productId: "100", name: "Producto fuente" }]
    }
  ]
};

const baseInput = {
  correlationId: "corr-t10b8c-1",
  conversationId: 1,
  opportunityId: null,
  currentTime: "2026-08-05T15:00:00.000Z",
  recentCatalogContext: OBSERVED_SOURCE_PRODUCT_CONTEXT
};

function session(overrides: Partial<NativeCustomerSessionExecutionContext> = {}): NativeCustomerSessionExecutionContext {
  return {
    conversationId: "conv-1",
    opportunityId: null,
    trustedInbound: { channel: "whatsapp", externalId: "56911112222", normalizedPhone: "56911112222", messageId: "wamid.1", receivedAt: "2026-08-05T12:00:00.000Z" },
    identity: { status: "identification_required", customerId: null, source: "none", localResolutionOutcome: "identification_required", externalResolutionOutcome: "no_match" },
    masterCustomerIdentity: { status: "identity_unresolved", reason: "identity_not_verified" },
    runtimeIdentity: { status: "ANONYMOUS", identityLevel: "LEVEL_0_ANONYMOUS", masterCustomerId: null, prestashopCustomerId: null, verificationRequired: false, requiredEvidence: [], readyToLink: false, conflictCode: null, policyCode: "NO_CHANNEL_EVIDENCE", evidenceRefs: [] },
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
// CP-R1-T10B8D: this test isolates the Gateway's own (T10B6) rejection of a
// syntactically-invalid sourceProduct - so productId -1 is given as evidence
// here (unrealistic in production - a real search never returns a negative
// id - but the only way to get an evidence-authorized call to still reach
// T10B6's own validation) rather than let T10B8D's own evidence gate block
// it first, which is covered separately by resolveObservedRecommendationSourceProduct.test.ts.
test("7. an invalid sourceProduct never reaches the real server and surfaces as skipped, never a fabricated empty completed", async () => {
  let called = false;
  handler = (_req, res) => {
    called = true;
    sendJson(res, 200, baseResponse());
  };
  const provider = createFakeAgentLoopProvider({ script: RECOMMEND_THEN_RESPOND("No pude generar una recomendacion en este momento.", { sourceProduct: { productId: -1 } }) });

  const result = await runAgentToolLoop({
    ...baseInput,
    recentCatalogContext: { interactions: [{ inboundMessageId: "msg-prior-search", completedAt: "2026-08-05T14:59:00.000Z", sourceTool: "search_products", products: [{ position: 1, productId: "-1", name: "Producto fuente invalido" }] }] },
    customerMessage: "algo mas?",
    commercialContextSummary: {},
    provider
  });

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

// 14. CP-R1-T10B8D: this test's original T10B8C assertion ("never
// introduces or mutates pendingCatalogAction") documented the exact gap
// T10B8D closes - updated to the now-intended behavior: a completed
// recommendation automatically becomes the active continuity window
// (candidateProducts), even though the model's own respond step never sets
// pendingCatalogAction itself. See tests 22+ below for the full
// creation/renewal/consumption suite.
test("14. a completed recommend_catalog_products result automatically becomes the active pendingCatalogAction continuity", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const provider = createFakeAgentLoopProvider({ script: RECOMMEND_THEN_RESPOND("Aqui tienes una recomendacion.") });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "algo mas?", commercialContextSummary: {}, provider });

  assert.deepEqual(result.finalPendingCatalogAction, {
    actionType: "send_product_link",
    candidateProductIds: ["200"],
    candidateProducts: [{ productId: "200" }]
  });
});

// --- CP-R1-T10B8D: source product evidence gating and recommendation continuity ---

// 15. Blocked: sourceProduct never observed anywhere -> zero HTTP calls
test("15. a sourceProduct never observed by this conversation is blocked before any HTTP call, and never consumes tool budget", async () => {
  let called = false;
  handler = (_req, res) => {
    called = true;
    sendJson(res, 200, baseResponse());
  };
  const provider = createFakeAgentLoopProvider({ script: RECOMMEND_THEN_RESPOND("No puedo recomendar sobre ese producto todavia.", { sourceProduct: { productId: 555 } }) });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "recomiendame algo parecido a otra cosa", commercialContextSummary: {}, provider });

  assert.equal(called, false, "the evidence gate must block before the Gateway/HTTP chain is ever reached");
  assert.equal(result.toolExecutionCount, 0);
  assert.equal(result.terminalReason, "responded");
  const observation = toolStepOf(result)!.observation!;
  assert.equal(observation.status, "blocked");
  assert.equal(observation.errorCode, "source_product_not_observed");
});

// 16. Blocked: productId observed, but this exact combinationId was not
test("16. a sourceProduct combinationId never observed is blocked even though the base productId was observed", async () => {
  let called = false;
  handler = (_req, res) => {
    called = true;
    sendJson(res, 200, baseResponse());
  };
  const provider = createFakeAgentLoopProvider({ script: RECOMMEND_THEN_RESPOND("No puedo confirmar esa variante todavia.", { sourceProduct: { productId: 100, combinationId: 999 } }) });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "algo mas de esa variante?", commercialContextSummary: {}, provider });

  assert.equal(called, false);
  const observation = toolStepOf(result)!.observation!;
  assert.equal(observation.status, "blocked");
  assert.equal(observation.errorCode, "source_product_variant_not_observed");
});

// 17. Authorized via this-turn live evidence (search_products), not recentCatalogContext
test("17. a sourceProduct observed by this same turn's own search_products call authorizes recommend_catalog_products, no recentCatalogContext needed", async () => {
  handler = (req, res) => {
    if (req.url === "/api/v2/catalog/resolve-product-intent" && req.method === "POST") {
      return sendJson(res, 200, productIntentResponse([{ productId: 100, name: "Producto fuente" }]));
    }
    return sendJson(res, 200, baseResponse());
  };
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell" } },
      { type: "use_tool", tool: "recommend_catalog_products", arguments: { sourceProduct: { productId: 100 } } },
      { type: "respond", message: "Aqui tienes una recomendacion basada en tu busqueda." }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, recentCatalogContext: null, customerMessage: "que me recomiendas?", commercialContextSummary: {}, provider });

  assert.equal(result.toolExecutionCount, 2);
  assert.equal(result.terminalReason, "responded");
  const recommendStep = result.steps.find((step) => step.step.type === "use_tool" && step.step.tool === "recommend_catalog_products");
  assert.equal(recommendStep?.observation?.status, "completed");
});

// 18. Anti-chaining: a recommend_catalog_products candidate never authorizes a second recommend_catalog_products call
test("18. a recommend_catalog_products candidate cannot be used as the sourceProduct for a second recommend_catalog_products call", async () => {
  let requestsToRecommendEndpoint = 0;
  handler = (req, res) => {
    if (req.url === "/api/v2/recommendations/search-products") requestsToRecommendEndpoint += 1;
    sendJson(res, 200, baseResponse());
  };
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "recommend_catalog_products", arguments: { sourceProduct: { productId: 100 } } },
      { type: "use_tool", tool: "recommend_catalog_products", arguments: { sourceProduct: { productId: 200 } } },
      { type: "respond", message: "Listo." }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "y algo relacionado con ese recomendado?", commercialContextSummary: {}, maxToolExecutions: 3, provider });

  assert.equal(requestsToRecommendEndpoint, 1, "the second (chained) recommend_catalog_products call must never reach the real service");
  const secondStep = result.steps.filter((step) => step.step.type === "use_tool" && step.step.tool === "recommend_catalog_products")[1];
  assert.equal(secondStep?.observation?.status, "blocked");
  assert.equal(secondStep?.observation?.errorCode, "source_product_not_observed");
});

// 19-20. End-to-end continuity: search_products -> recommend_catalog_products -> get_product_details,
// each id sourced from the previous observation, no id fabricated, no code-driven candidate selection.
test("19-20. search_products -> recommend_catalog_products -> get_product_details chains on real, observed identity within one turn, no new search required", async () => {
  handler = (req, res) => {
    if (req.url === "/api/v2/catalog/resolve-product-intent" && req.method === "POST") {
      return sendJson(res, 200, productIntentResponse([{ productId: 100, name: "Producto fuente" }]));
    }
    if (req.url === "/api/v2/recommendations/search-products") {
      return sendJson(res, 200, baseResponse());
    }
    if (req.url?.startsWith("/v1/products/200")) {
      return sendJson(res, 200, {
        product: { productId: 200, name: "Recomendado", sku: null, shortDescription: null, longDescription: null, active: true },
        variants: [],
        selectedVariant: null,
        pricing: { effectiveUnitPrice: 19990, currency: "CLP", taxIncluded: true, discountApplied: false },
        stock: { available: true, physicalQuantity: 3 },
        freshness: { cached: false }
      });
    }
    return sendJson(res, 404, { error: "not_found" });
  };
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell" } },
      { type: "use_tool", tool: "recommend_catalog_products", arguments: { sourceProduct: { productId: 100 } } },
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "200" } },
      { type: "respond", message: "Te recomiendo este producto adicional, aqui el detalle." }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, recentCatalogContext: null, customerMessage: "que me recomiendas junto a esto?", commercialContextSummary: {}, maxToolExecutions: 3, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.toolExecutionCount, 3);
  const [searchStep, recommendStep, detailStep] = result.steps.filter((step) => step.step.type === "use_tool");
  assert.equal(searchStep.observation?.status, "completed");
  assert.equal(recommendStep.observation?.status, "completed");
  const recommendData = recommendStep.observation?.data as { recommendations: Array<{ productId: string }> };
  assert.deepEqual(recommendData.recommendations.map((r) => r.productId), ["200"]);
  assert.equal(detailStep.observation?.status, "completed");
  assert.equal((detailStep.observation?.data as { productId: string }).productId, "200");
});

// 21. Concurrency: two conversations' evidence never cross
test("21. two conversations' evidence never cross - one conversation's observed product never authorizes another conversation's identical sourceProduct request", async () => {
  handler = (_req, res) => sendJson(res, 200, baseResponse());
  const providerA = createFakeAgentLoopProvider({ script: RECOMMEND_THEN_RESPOND("Recomendacion A.", { sourceProduct: { productId: 100 } }) });
  const providerB = createFakeAgentLoopProvider({ script: RECOMMEND_THEN_RESPOND("Recomendacion B.", { sourceProduct: { productId: 100 } }) });

  const contextB = {
    interactions: [{ inboundMessageId: "msg-b", completedAt: "2026-08-05T14:59:00.000Z", sourceTool: "search_products" as const, products: [{ position: 1, productId: "999", name: "Otro producto" }] }]
  };

  const [resultA, resultB] = await Promise.all([
    runAgentToolLoop({ ...baseInput, conversationId: 1, customerMessage: "a", commercialContextSummary: {}, provider: providerA }),
    runAgentToolLoop({ ...baseInput, conversationId: 2, recentCatalogContext: contextB, customerMessage: "b", commercialContextSummary: {}, provider: providerB })
  ]);

  assert.equal(toolStepOf(resultA)!.observation!.status, "completed", "conversation A observed productId 100, its own request must be authorized");
  assert.equal(toolStepOf(resultB)!.observation!.status, "blocked", "conversation B never observed productId 100 - conversation A's evidence must never leak in");
  assert.equal(toolStepOf(resultB)!.observation!.errorCode, "source_product_not_observed");
});

// --- CP-R1-T10B8D (correction pass): get_product_details continuity end-to-end, sourced from a real recommend_catalog_products result ---

/**
 * SALES-AGENT-R2-A11.2-C. search_products now resolves via T12 (POST
 * /api/v2/catalog/resolve-product-intent). resolveObservedRecommendationSourceProduct
 * only cares that a search_products observation's items[] carries the
 * productId (the evidence gate never reads resolution.status).
 */
function productIntentResponse(items: Array<{ productId: number; name: string }>) {
  return {
    query: { original: "x", normalized: "x" },
    resolution: items.length === 1 ? { status: "resolved", confidence: 0.9, sourceProduct: { productId: String(items[0].productId), combinationId: "1" } } : { status: "clarification_required", confidence: 0.5 },
    candidates: items.map((item, index) => ({
      product: { productId: String(item.productId), combinationId: "1", name: item.name, price: null, stock: { status: "in_stock", available: true, quantity: 5 } },
      match: { rank: index + 1, score: 0.9, reasons: ["EXACT_NAME_MATCH"] }
    })),
    ...(items.length > 1 ? { clarification: { dimension: "unspecified" as const, options: [] } } : {}),
    statistics: { retrieved: items.length, eligible: items.length, returned: items.length },
    warnings: [],
    correlationId: "corr-fixture"
  };
}

function productDetailsResponse(productId: number, name: string) {
  return {
    product: { productId, name, sku: null, shortDescription: null, longDescription: null, active: true },
    variants: [],
    selectedVariant: null,
    pricing: { effectiveUnitPrice: 19990, currency: "CLP", taxIncluded: true, discountApplied: false },
    stock: { available: true, physicalQuantity: 3 },
    freshness: { cached: false }
  };
}

// 22. E2E cross-turn continuity
test("22. E2E cross-turn: a real recommend_catalog_products result creates pendingCatalogAction, a later turn's get_product_details(B) is authorized and consumes it", async () => {
  handler = (req, res) => {
    if (req.url === "/api/v2/recommendations/search-products") return sendJson(res, 200, baseResponse());
    if (req.url?.startsWith("/v1/products/200")) return sendJson(res, 200, productDetailsResponse(200, "Recomendado"));
    return sendJson(res, 404, { error: "not_found" });
  };

  const turn1Provider = createFakeAgentLoopProvider({ script: RECOMMEND_THEN_RESPOND("Aqui una recomendacion.") });
  const turn1 = await runAgentToolLoop({ ...baseInput, customerMessage: "algo mas?", commercialContextSummary: {}, provider: turn1Provider });

  assert.deepEqual(turn1.finalPendingCatalogAction, { actionType: "send_product_link", candidateProductIds: ["200"], candidateProducts: [{ productId: "200" }] });

  const turn2Provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "200" } },
      { type: "respond", message: "Aqui el detalle." }
    ]
  });
  const turn2 = await runAgentToolLoop({
    ...baseInput,
    recentCatalogContext: null,
    pendingCatalogAction: turn1.finalPendingCatalogAction,
    customerMessage: "si, ese",
    commercialContextSummary: {},
    provider: turn2Provider
  });

  assert.equal(turn2.toolExecutionCount, 1);
  assert.equal(turn2.steps[0].observation?.status, "completed");
  assert.equal((turn2.steps[0].observation?.data as { productId: string }).productId, "200");
  assert.equal(turn2.finalPendingCatalogAction, null);
});

// 23. Blocked candidate: get_product_details(D) for a non-candidate product
test("23. after a recommendation, get_product_details for a non-candidate product is blocked, zero HTTP to the detail endpoint, pendingCatalogAction intact", async () => {
  let detailEndpointCalled = false;
  handler = (req, res) => {
    if (req.url === "/api/v2/recommendations/search-products") return sendJson(res, 200, baseResponse());
    if (req.url?.startsWith("/v1/products/")) {
      detailEndpointCalled = true;
      return sendJson(res, 200, { error: "must never be reached" });
    }
    return sendJson(res, 404, { error: "not_found" });
  };

  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "recommend_catalog_products", arguments: { sourceProduct: { productId: 100 } } },
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "555" } },
      { type: "respond", message: "No pude confirmar ese producto." }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "y el producto 555?", commercialContextSummary: {}, maxToolExecutions: 2, provider });

  assert.equal(detailEndpointCalled, false);
  const detailStep = result.steps.filter((step) => step.step.type === "use_tool")[1];
  assert.equal(detailStep.observation?.status, "blocked");
  assert.equal(detailStep.observation?.errorCode, "product_not_in_pending_catalog_candidates");
  assert.deepEqual(result.finalPendingCatalogAction, { actionType: "send_product_link", candidateProductIds: ["200"], candidateProducts: [{ productId: "200" }] });
});

// 24. Variant: candidate B/combinationId=10 -> request B/10 permitted, request B/11 blocked
test("24. a recommended candidate with combinationId only authorizes get_product_details for that exact variant", async () => {
  const variantRecommendation = baseResponse({
    recommendations: [
      {
        product: productSummary({ productId: "200", name: "Recomendado", combinationId: "10" }),
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
    ]
  });

  // 24a. B/10 permitted
  handler = (req, res) => {
    if (req.url === "/api/v2/recommendations/search-products") return sendJson(res, 200, variantRecommendation);
    if (req.url?.startsWith("/v1/products/200")) return sendJson(res, 200, productDetailsResponse(200, "Recomendado"));
    return sendJson(res, 404, { error: "not_found" });
  };
  const allowedProvider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "recommend_catalog_products", arguments: { sourceProduct: { productId: 100 } } },
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "200", combinationId: "10" } },
      { type: "respond", message: "Aqui esa variante." }
    ]
  });
  const allowedResult = await runAgentToolLoop({ ...baseInput, customerMessage: "esa variante", commercialContextSummary: {}, maxToolExecutions: 2, provider: allowedProvider });
  const allowedDetailStep = allowedResult.steps.filter((step) => step.step.type === "use_tool")[1];
  assert.equal(allowedDetailStep.observation?.status, "completed");
  assert.equal(allowedResult.finalPendingCatalogAction, null);

  // 24b. B/11 blocked
  let detailEndpointCalled = false;
  handler = (req, res) => {
    if (req.url === "/api/v2/recommendations/search-products") return sendJson(res, 200, variantRecommendation);
    if (req.url?.startsWith("/v1/products/")) {
      detailEndpointCalled = true;
      return sendJson(res, 200, { error: "must never be reached" });
    }
    return sendJson(res, 404, { error: "not_found" });
  };
  const blockedProvider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "recommend_catalog_products", arguments: { sourceProduct: { productId: 100 } } },
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "200", combinationId: "11" } },
      { type: "respond", message: "..." }
    ]
  });
  const blockedResult = await runAgentToolLoop({ ...baseInput, customerMessage: "otra variante", commercialContextSummary: {}, maxToolExecutions: 2, provider: blockedProvider });
  assert.equal(detailEndpointCalled, false);
  const blockedDetailStep = blockedResult.steps.filter((step) => step.step.type === "use_tool")[1];
  assert.equal(blockedDetailStep.observation?.status, "blocked");
  assert.equal(blockedDetailStep.observation?.errorCode, "product_not_in_pending_catalog_candidates");
});

// 25. identity_unresolved -> same continuity flow, generic mode
test("25. an unresolved trustedCustomerSession still gets full recommendation continuity, generic mode, never blocked or handed off", async () => {
  handler = (req, res) => {
    if (req.url === "/api/v2/recommendations/search-products") return sendJson(res, 200, baseResponse());
    if (req.url?.startsWith("/v1/products/200")) return sendJson(res, 200, productDetailsResponse(200, "Recomendado"));
    return sendJson(res, 404, { error: "not_found" });
  };
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "recommend_catalog_products", arguments: { sourceProduct: { productId: 100 } } },
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "200" } },
      { type: "respond", message: "Aqui el detalle." }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "algo mas?",
    commercialContextSummary: {},
    trustedCustomerSession: session({ masterCustomerIdentity: { status: "identity_unresolved", reason: "identity_not_verified" } }),
    maxToolExecutions: 2,
    provider
  });

  assert.equal(result.terminalReason, "responded");
  const [recommendStep, detailStep] = result.steps.filter((step) => step.step.type === "use_tool");
  assert.equal((recommendStep.observation?.data as { customerMode: string }).customerMode, "generic");
  assert.equal(detailStep.observation?.status, "completed");
  assert.equal(result.finalPendingCatalogAction, null);
});

// 26. Empty invalidates a prior active recommendation pendingCatalogAction
test("26. a completed recommendation with empty candidates invalidates a prior active recommendation pendingCatalogAction", async () => {
  handler = (req, res) => {
    if (req.url === "/api/v2/catalog/resolve-product-intent" && req.method === "POST") return sendJson(res, 200, productIntentResponse([{ productId: 100, name: "Producto A" }, { productId: 300, name: "Producto C" }]));
    if (req.url === "/api/v2/recommendations/search-products") {
      const parsed = JSON.parse(lastBody) as { sourceProduct?: { productId?: string } };
      if (parsed.sourceProduct?.productId === "300") return sendJson(res, 200, baseResponse({ recommendations: [] }));
      return sendJson(res, 200, baseResponse());
    }
    return sendJson(res, 404, { error: "not_found" });
  };

  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "x" } },
      { type: "use_tool", tool: "recommend_catalog_products", arguments: { sourceProduct: { productId: 100 } } },
      { type: "use_tool", tool: "recommend_catalog_products", arguments: { sourceProduct: { productId: 300 } } },
      { type: "respond", message: "No encontre una recomendacion clara para eso." }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, recentCatalogContext: null, customerMessage: "y para el producto C?", commercialContextSummary: {}, maxDecisions: 5, maxToolExecutions: 4, provider });

  assert.equal(result.finalPendingCatalogAction, null);
  assert.ok(result.warnings.includes("recommendation_pending_catalog_action_invalidated_empty"));
});

// 27. Renewal: latest successful recommendation replaces prior candidates entirely, no merging
test("27. the latest successful recommendation replaces prior candidates entirely, never merges across recommendations", async () => {
  handler = (req, res) => {
    if (req.url === "/api/v2/catalog/resolve-product-intent" && req.method === "POST") return sendJson(res, 200, productIntentResponse([{ productId: 100, name: "Producto A" }, { productId: 300, name: "Producto C" }]));
    if (req.url === "/api/v2/recommendations/search-products") {
      const parsed = JSON.parse(lastBody) as { sourceProduct?: { productId?: string } };
      if (parsed.sourceProduct?.productId === "300") {
        return sendJson(
          res,
          200,
          baseResponse({
            recommendations: [
              {
                product: productSummary({ productId: "400", name: "Otro recomendado" }),
                rank: 1,
                score: 0.7,
                commercialScore: 0.7,
                affinityScore: 0.4,
                affinityConfidence: "low",
                ranking: { rank: 1, score: 0.7 },
                relationship: { type: "frequently_bought_together", reliability: 0.5, evidence: { jointCount: 1, support: 0.1, confidence: 0.4, lift: 1 } },
                commercialReason: { code: "FREQUENTLY_BOUGHT_TOGETHER", label: "Comprado frecuentemente junto al producto consultado" },
                reasons: [{ code: "STRONG_COMMERCIAL_RELEVANCE", source: "commercial" }],
                warnings: []
              }
            ]
          })
        );
      }
      return sendJson(res, 200, baseResponse());
    }
    return sendJson(res, 404, { error: "not_found" });
  };

  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "x" } },
      { type: "use_tool", tool: "recommend_catalog_products", arguments: { sourceProduct: { productId: 100 } } },
      { type: "use_tool", tool: "recommend_catalog_products", arguments: { sourceProduct: { productId: 300 } } },
      { type: "respond", message: "Aqui una mejor recomendacion." }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, recentCatalogContext: null, customerMessage: "y para el producto C?", commercialContextSummary: {}, maxDecisions: 5, maxToolExecutions: 4, provider });

  assert.deepEqual(result.finalPendingCatalogAction, { actionType: "send_product_link", candidateProductIds: ["400"], candidateProducts: [{ productId: "400" }] });
});
