// SALES-AGENT-R3-V1.8.2-B (Open Turn Execution Core). Deterministic,
// scripted-provider tests for open-turn semantics
// (BRAIN_R3_OPEN_TURN_EXECUTION_ENABLED, threaded as
// input.openTurnExecutionEnabled) - no real DB except where a mutation tool's
// evidence gate needs one, no real LLM. Mirrors the fixture/mock-server
// conventions runAgentToolLoop.test.ts and runAgentToolLoopLiveAssimilation.test.ts
// already established. Item 18 of the task's required test list (crash
// recovery resumes responsibility, never an in-memory partial loop) is
// covered by the EXISTING tests/native/inboundTurnSettling.e2e.test.ts crash-
// boundary suite, unmodified by this task - open-turn mode introduces no new
// durable/resumable state, so no new e2e coverage was needed there.

import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { runAgentToolLoop, MUTATION_CLAIM_GUARD_FALLBACK_MESSAGE, OPEN_TURN_NO_PROGRESS_THRESHOLD } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";
import { resetCapabilityGatewayCatalogPortForTests } from "@/lib/brain/commercial/capability-gateway/registry";
import type { AgentLoopProvider, AgentLoopProviderRequest, AgentLoopProviderResponse } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";
import type { CheckForNewInboundResult } from "@/lib/brain/commercial/turn-settlement/checkForNewInbound";
import type { EnsureCommercialActionOpportunityInput, EnsureCommercialActionOpportunityResult } from "@/lib/brain/commercial/commercial-action-request/ensureCommercialActionOpportunity";

async function neverEnsureOpportunity(_input: EnsureCommercialActionOpportunityInput): Promise<EnsureCommercialActionOpportunityResult> {
  throw new Error("ensureOpportunity must never be called by a READ_TOOL-only script in this file");
}

/**
 * Deliberately returns `ok:false` (never a real opportunityId) so the
 * select_products mutation branch stops at the authorization/idempotency
 * seam (processUseToolStep's own ensureOpportunity call) without ever
 * reaching the Capability Gateway's real DB write - these tests are about
 * the LOOP's own exactly-once/steering orchestration, not select_products'
 * own persistence correctness (already covered by
 * tests/commercial/selectProductsCapability.test.ts). The call is still
 * `executed:true` at the loop level either way (a real resolution attempt
 * was made) - see runAgentToolLoop.ts's own comment on that branch.
 */
function countingEnsureOpportunity(onCall?: () => void): { fn: typeof neverEnsureOpportunity; callCount: () => number } {
  let calls = 0;
  return {
    fn: async (_input: EnsureCommercialActionOpportunityInput): Promise<EnsureCommercialActionOpportunityResult> => {
      calls += 1;
      onCall?.();
      return { ok: false, reason: "test_opportunity_unavailable" };
    },
    callCount: () => calls
  };
}

const baseInput = {
  correlationId: "corr-open-turn",
  conversationId: 4200,
  opportunityId: null,
  currentTime: "2026-09-09T15:00:00.000Z",
  ensureOpportunity: neverEnsureOpportunity,
  openTurnExecutionEnabled: true,
  inboundMessageId: "100"
};

/** Mirrors runAgentToolLoopLiveAssimilation.test.ts's own local helper - never a shared abstraction for two callers. */
function createFragmentStore(initial: { id: number; body: string }[] = []) {
  const fragments = [...initial];
  return {
    push: (id: number, body: string): void => {
      fragments.push({ id, body });
    },
    checkForNewInbound: async (input: { conversationId: number; afterMessageId: number }): Promise<CheckForNewInboundResult> => {
      const found = fragments.filter((fragment) => fragment.id > input.afterMessageId).sort((a, b) => a.id - b.id);
      return { fragments: found, latestMessageId: found.length > 0 ? found[found.length - 1].id : null };
    }
  };
}

function createScriptedProviderWithHooks(steps: Array<{ step: unknown; before?: () => void }>): { provider: AgentLoopProvider; requests: AgentLoopProviderRequest[] } {
  let callIndex = 0;
  const requests: AgentLoopProviderRequest[] = [];
  const provider: AgentLoopProvider = {
    name: "scripted-with-hooks",
    version: "test.v1",
    async invoke(request: AgentLoopProviderRequest): Promise<AgentLoopProviderResponse> {
      requests.push(request);
      const entry = steps[Math.min(callIndex, steps.length - 1)];
      entry.before?.();
      callIndex += 1;
      return { rawOutput: entry.step, model: "fake", inputTokens: 1, outputTokens: 1, providerRequestId: `call-${callIndex}`, finishReason: "stop" };
    }
  };
  return { provider, requests };
}

function lastUserPayload(requests: AgentLoopProviderRequest[]): Record<string, unknown> {
  const request = requests[requests.length - 1];
  const userMessage = [...request.messages].reverse().find((message) => message.role === "user");
  return JSON.parse((userMessage?.content as string) ?? "{}") as Record<string, unknown>;
}

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
let server: http.Server;
let handler: Handler = (_req, res) => res.writeHead(500).end();

before(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  process.env.CATALOG_SERVICE_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.CATALOG_SERVICE_API_KEY = "test-key";
  resetCapabilityGatewayCatalogPortForTests();
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** search_products (T12 resolve-product-intent) with `itemCount` distinct fake items - each distinct count fingerprints as materially different evidence. */
function searchProductsWithCount(itemCount: number) {
  handler = (req, res) => {
    if (req.url === "/api/v2/catalog/resolve-product-intent" && req.method === "POST") {
      const candidates = Array.from({ length: itemCount }, (_, index) => ({
        product: {
          productId: String(501 + index),
          combinationId: null,
          name: `Producto ${index}`,
          reference: `REF-${index}`,
          description: "desc",
          price: null,
          stock: { status: "in_stock", available: true, quantity: 4 }
        },
        match: { rank: index + 1, score: 0.9, reasons: ["EXACT_NAME_MATCH"] }
      }));
      return sendJson(res, 200, {
        query: { original: "mancuernas", normalized: "mancuernas" },
        resolution: itemCount > 0 ? { status: "resolved", confidence: 0.9, sourceProduct: { productId: "501", combinationId: null } } : { status: "no_match", confidence: 0, sourceProduct: null },
        candidates,
        statistics: { retrieved: itemCount, eligible: itemCount, returned: itemCount },
        warnings: [],
        correlationId: "c"
      });
    }
    if (req.url?.startsWith("/v1/products/") && req.method === "GET") {
      return sendJson(res, 200, {
        product: { productId: 501, name: "Mancuerna 10kg", sku: "MC-10", shortDescription: null, longDescription: null, active: true },
        selectedVariant: null,
        attributes: [],
        variants: [],
        pricing: {
          quantity: 1,
          baseUnitPrice: 20000,
          effectiveUnitPrice: 20000,
          subtotal: 20000,
          currency: "CLP",
          taxIncluded: true,
          taxRate: 0.19,
          taxMode: "configured_rate",
          discountApplied: false,
          discountType: null,
          discountValue: null,
          specificPriceId: null,
          pricingMode: "sql_specific_price"
        },
        stock: { physicalQuantity: 4, available: true, shopId: 1 },
        freshness: { productCheckedAt: new Date().toISOString(), priceCalculatedAt: new Date().toISOString(), stockCheckedAt: new Date().toISOString(), cached: false }
      });
    }
    return sendJson(res, 404, { error: "not_found" });
  };
}

function searchTool(query = "mancuernas") {
  return { type: "use_tool", tool: "search_products", arguments: { query } };
}
function detailsTool(productId = "501") {
  return { type: "use_tool", tool: "get_product_details", arguments: { productId } };
}
function respond(message: string) {
  return { type: "respond", message };
}

// ---- 1. A turn can execute >3 accepted cognitive steps ----
test("1 - open turn: >3 accepted cognitive steps complete in one turn", async () => {
  searchProductsWithCount(1);
  const { provider } = createScriptedProviderWithHooks([
    { step: searchTool("mancuernas 10kg") },
    { step: searchTool("mancuernas 15kg") },
    { step: searchTool("mancuernas 20kg") },
    { step: searchTool("mancuernas ajustables") },
    { step: respond("Aquí tienes las opciones.") }
  ]);

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "quiero mancuernas", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.openTurnExecutionEnabled, true);
  assert.ok((result.acceptedStepCount ?? 0) > 3, `expected acceptedStepCount>3, got ${result.acceptedStepCount}`);
});

// ---- 2. A turn can execute >2 READ tools ----
test("2 - open turn: >2 READ tool executions complete in one turn", async () => {
  searchProductsWithCount(1);
  const { provider } = createScriptedProviderWithHooks([
    { step: searchTool("mancuernas 10kg") },
    { step: detailsTool("501") },
    { step: searchTool("mancuernas 15kg") },
    { step: respond("Aquí tienes las opciones.") }
  ]);

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "quiero mancuernas", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.ok((result.readToolExecutionCount ?? 0) > 2, `expected readToolExecutionCount>2, got ${result.readToolExecutionCount}`);
  assert.equal(result.toolExecutionCount, 3);
});

// ---- 3. search -> details -> search(new evidence) -> details -> respond in ONE logical turn ----
test("3 - open turn: a 4-hop read-tool chain completes in one logical turn", async () => {
  // Two distinct products (501, 502) so the second get_product_details call
  // is a genuinely different request - an identical repeat would correctly
  // be blocked by the pre-existing exact-dedupe Set (executedCalls), which
  // is not what this test is about.
  handler = (req, res) => {
    if (req.url === "/api/v2/catalog/resolve-product-intent" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}") as { query?: string };
        const productId = parsed.query === "mancuernas fijas 15kg" ? "502" : "501";
        return sendJson(res, 200, {
          query: { original: parsed.query ?? "", normalized: parsed.query ?? "" },
          resolution: { status: "resolved", confidence: 0.9, sourceProduct: { productId, combinationId: null } },
          candidates: [{ product: { productId, combinationId: null, name: `Producto ${productId}`, reference: "r", description: "d", price: null, stock: { status: "in_stock", available: true, quantity: 4 } }, match: { rank: 1, score: 0.9, reasons: [] } }],
          statistics: { retrieved: 1, eligible: 1, returned: 1 },
          warnings: [],
          correlationId: "c"
        });
      });
      return;
    }
    if (req.url?.startsWith("/v1/products/") && req.method === "GET") {
      const productId = req.url.replace("/v1/products/", "");
      return sendJson(res, 200, {
        product: { productId: Number(productId), name: `Producto ${productId}`, sku: `SKU-${productId}`, shortDescription: null, longDescription: null, active: true },
        selectedVariant: null,
        attributes: [],
        variants: [],
        pricing: { quantity: 1, baseUnitPrice: 20000, effectiveUnitPrice: 20000, subtotal: 20000, currency: "CLP", taxIncluded: true, taxRate: 0.19, taxMode: "configured_rate", discountApplied: false, discountType: null, discountValue: null, specificPriceId: null, pricingMode: "sql_specific_price" },
        stock: { physicalQuantity: 4, available: true, shopId: 1 },
        freshness: { productCheckedAt: new Date().toISOString(), priceCalculatedAt: new Date().toISOString(), stockCheckedAt: new Date().toISOString(), cached: false }
      });
    }
    return sendJson(res, 404, { error: "not_found" });
  };
  const { provider } = createScriptedProviderWithHooks([
    { step: searchTool("mancuernas fijas 10kg") },
    { step: detailsTool("501") },
    { step: searchTool("mancuernas fijas 15kg") },
    { step: detailsTool("502") },
    { step: respond("Comparación lista.") }
  ]);

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "quiero mancuernas de caucho fijas de 10 y 15 kilos", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.finalMessage, "Comparación lista.");
  assert.equal(result.toolExecutionCount, 4);
  assert.equal(result.steps.filter((record) => record.step.type === "use_tool").length, 4);
});

// ---- 4. A tool result cannot be terminally responded to before a subsequent provider step consumed it ----
test("4 - open turn: the respond candidate's own inference call already saw the preceding tool observation", async () => {
  searchProductsWithCount(1);
  const { provider, requests } = createScriptedProviderWithHooks([{ step: searchTool() }, { step: respond("Listo.") }]);

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "quiero mancuernas", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  const payload = lastUserPayload(requests) as { priorStepsThisTurn?: Array<{ step: { type: string; tool?: string } }> };
  const priorSteps = payload.priorStepsThisTurn ?? [];
  assert.equal(priorSteps.length, 1);
  assert.equal(priorSteps[0].step.type, "use_tool");
  assert.equal(priorSteps[0].step.tool, "search_products");
});

// ---- 5. A genuine quiescent respond terminates immediately ----
test("5 - open turn: a quiescent respond with no unbacked claim terminates immediately, no checkpoint continuation", async () => {
  const { provider } = createScriptedProviderWithHooks([{ step: respond("Hola, ¿en qué te ayudo?") }]);

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "hola", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.finalMessage, "Hola, ¿en qué te ayudo?");
  assert.equal(result.terminalCheckpointContinueCount, 0);
});

// ---- 6. A respond rejected by the terminal checkpoint continues naturally ----
test("6 - open turn: an unbacked mutation-completion claim is rejected by the checkpoint and the turn continues", async () => {
  const { provider } = createScriptedProviderWithHooks([
    { step: respond("Perfecto, 2 unidades listas para ti.") },
    { step: respond("¿Prefieres que sigamos con otra opción?") }
  ]);

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "dame 2 mancuernas", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.finalMessage, "¿Prefieres que sigamos con otra opción?");
  assert.equal(result.terminalCheckpointContinueCount, 1);
  // The rejected candidate was never accepted as a step.
  assert.equal(result.steps.length, 1);
});

// ---- 7. No-progress guard terminates a pathological loop of checkpoint-declined candidates ----
test("7 - open turn: repeated checkpoint-declined unbacked claims eventually trigger no_progress", async () => {
  const steps = Array.from({ length: OPEN_TURN_NO_PROGRESS_THRESHOLD + 2 }, () => ({ step: respond("Perfecto, 2 unidades listas.") }));
  const { provider } = createScriptedProviderWithHooks(steps);

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "dame 2 mancuernas", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "no_progress");
  assert.equal(result.finalMessage, null);
  assert.ok((result.terminalCheckpointContinueCount ?? 0) >= OPEN_TURN_NO_PROGRESS_THRESHOLD);
});

// ---- 8. Materially different recovery attempts are allowed before no-progress fires ----
test("8 - open turn: a dead-end search followed by a materially different, productive search is never blocked", async () => {
  let callCount = 0;
  handler = (req, res) => {
    if (req.url === "/api/v2/catalog/resolve-product-intent" && req.method === "POST") {
      callCount += 1;
      const hasResults = callCount > 1; // first call: dead end, every later call: real results
      return sendJson(res, 200, {
        query: { original: "x", normalized: "x" },
        resolution: hasResults ? { status: "resolved", confidence: 0.9, sourceProduct: { productId: "501", combinationId: null } } : { status: "no_match", confidence: 0, sourceProduct: null },
        candidates: hasResults
          ? [{ product: { productId: "501", combinationId: null, name: "Mancuerna", reference: "R", description: "d", price: null, stock: { status: "in_stock", available: true, quantity: 4 } }, match: { rank: 1, score: 0.9, reasons: [] } }]
          : [],
        statistics: { retrieved: hasResults ? 1 : 0, eligible: hasResults ? 1 : 0, returned: hasResults ? 1 : 0 },
        warnings: [],
        correlationId: "c"
      });
    }
    return sendJson(res, 404, { error: "not_found" });
  };

  const { provider } = createScriptedProviderWithHooks([
    { step: searchTool("mancuernas caucho") },
    { step: searchTool("mancuernas goma") },
    { step: respond("Encontré una opción.") }
  ]);

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "quiero mancuernas", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.finalMessage, "Encontré una opción.");
});

// ---- 9. Equivalent repeated zero-evidence attempts eventually trigger no_progress ----
test("9 - open turn: repeated equivalent (zero-result) tool evidence eventually triggers no_progress", async () => {
  searchProductsWithCount(0);
  const steps = Array.from({ length: OPEN_TURN_NO_PROGRESS_THRESHOLD + 2 }, (_v, index) => ({ step: searchTool(`consulta ${index}`) }));
  const { provider } = createScriptedProviderWithHooks(steps);

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "quiero algo raro", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "no_progress");
  assert.equal(result.finalMessage, null);
});

// ---- 10. Deadline terminates productive-but-too-long execution safely ----
test("10 - open turn: deadline terminates an otherwise-productive, never-converging turn", async () => {
  searchProductsWithCount(1);
  // Deliberately slow (ignores the abort signal, like a real hung HTTP call
  // would from this loop's own perspective) and always a use_tool step - so
  // this never routes through the terminal checkpoint's own deadline grace
  // (which only applies to a respond/handoff candidate); it is the LOOP's
  // own top-of-iteration deadline check that must end this turn, not a
  // no-progress race (only one tool executes before the deadline fires).
  const provider: AgentLoopProvider = {
    name: "never-converging",
    version: "test.v1",
    async invoke(): Promise<AgentLoopProviderResponse> {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { rawOutput: searchTool("busca otra vez"), model: "fake", inputTokens: 1, outputTokens: 1, providerRequestId: "call", finishReason: "stop" };
    }
  };

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "quiero mancuernas", commercialContextSummary: {}, provider, timeoutMs: 20 });

  assert.equal(result.terminalReason, "timeout");
  assert.ok((result.toolExecutionCount ?? 0) <= 1);
});

// ---- 11. Live assimilation during a late step still works ----
test("11 - open turn: live assimilation fires correctly even many steps into an already-long turn", async () => {
  const store = createFragmentStore();
  searchProductsWithCount(1);
  const { provider, requests } = createScriptedProviderWithHooks([
    { step: searchTool("mancuernas 10kg") },
    { step: searchTool("mancuernas 15kg") },
    { step: searchTool("mancuernas 20kg") },
    { step: searchTool("mancuernas 25kg"), before: () => store.push(101, "mejor tambien quiero un banco ajustable") },
    { step: respond("Aquí tienes todo, incluido el banco.") }
  ]);

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "quiero mancuernas de varios pesos",
    commercialContextSummary: {},
    provider,
    checkForNewInbound: store.checkForNewInbound,
    liveTurnAssimilationEnabled: true
  });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.assimilationCycleCount, 1);
  assert.deepEqual(result.assimilatedInboundMessageIds, [101]);
  assert.match(lastUserPayload(requests).customerMessage as string, /banco ajustable/);
});

// ---- 12. A stale pre-action mutation remains unexecuted ----
test("12 - open turn: a mutation candidate invalidated by fresh inbound is never executed", async () => {
  const store = createFragmentStore();
  const opportunity = countingEnsureOpportunity();
  searchProductsWithCount(1);
  const { provider } = createScriptedProviderWithHooks([
    { step: searchTool("mancuernas 10kg") },
    {
      step: { type: "use_tool", tool: "select_products", arguments: { items: [{ productId: "501", quantity: 2 }] } },
      before: () => store.push(101, "espera, mejor cancela eso")
    },
    { step: respond("Entendido, no confirmo esa selección.") }
  ]);

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "dame 2 mancuernas de 10kg",
    commercialContextSummary: {},
    provider,
    ensureOpportunity: opportunity.fn,
    checkForNewInbound: store.checkForNewInbound,
    liveTurnAssimilationEnabled: true
  });

  assert.equal(result.terminalReason, "responded");
  assert.equal(opportunity.callCount(), 0, "a stale mutation candidate must never reach ensureOpportunity/the Gateway");
  assert.ok(!result.steps.some((record) => record.step.type === "use_tool" && record.step.tool === "select_products"));
});

// ---- 13. A mutation executed before later steering remains exactly-once and durable ----
test("13 - open turn: a committed mutation stays exactly-once even when steering arrives right after it", async () => {
  const store = createFragmentStore();
  // Pushed as a side effect of ensureOpportunity itself - the correct
  // simulation of "new inbound arrived WHILE the mutation's own resolution
  // was in flight" (after Boundary 1 already let the candidate through,
  // before Boundary 2 runs on the way back out).
  const opportunity = countingEnsureOpportunity(() => store.push(101, "y también agrega envío rápido por favor"));
  searchProductsWithCount(1);
  const { provider } = createScriptedProviderWithHooks([
    { step: searchTool("mancuernas 10kg") },
    { step: { type: "use_tool", tool: "select_products", arguments: { items: [{ productId: "501", quantity: 2 }] } } },
    { step: respond("Selección confirmada, reviso el envío.") }
  ]);

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "dame 2 mancuernas de 10kg",
    commercialContextSummary: {},
    provider,
    ensureOpportunity: opportunity.fn,
    checkForNewInbound: store.checkForNewInbound,
    liveTurnAssimilationEnabled: true
  });

  assert.equal(result.terminalReason, "responded");
  assert.equal(opportunity.callCount(), 1, "the committed mutation must execute exactly once");
  const mutationSteps = result.steps.filter((record) => record.step.type === "use_tool" && record.step.tool === "select_products");
  assert.equal(mutationSteps.length, 1);
  assert.equal(result.assimilationCycleCount, 1, "steering right after the mutation is still folded in via Boundary 2");
});

// ---- 14. Feature flag OFF preserves existing 3/2 behavior ----
test("14 - flag off: legacy 3/2 ceiling is preserved byte-for-byte even for a script that would need more", async () => {
  searchProductsWithCount(1);
  const { provider } = createScriptedProviderWithHooks([
    { step: searchTool("mancuernas 10kg") },
    { step: searchTool("mancuernas 15kg") },
    { step: searchTool("mancuernas 20kg") },
    { step: respond("Esto es lo que encontré.") }
  ]);

  const result = await runAgentToolLoop({ ...baseInput, openTurnExecutionEnabled: false, customerMessage: "quiero mancuernas", commercialContextSummary: {}, provider });

  // Legacy: maxToolExecutions=2 caps at 2 real tool calls, then finalization
  // (no tools offered) forces a respond - the 3rd scripted search_products
  // is never reached.
  assert.equal(result.toolExecutionCount, 2);
  assert.equal(result.terminalReason, "responded");
  assert.equal(result.openTurnExecutionEnabled, false);
});

// ---- 15. Finalization no longer acts as a hidden forced-answer ceiling when the feature is ON ----
test("15 - open turn: a 3-tool-call script is never forced into finalization by the legacy 2-tool ceiling", async () => {
  searchProductsWithCount(1);
  const { provider } = createScriptedProviderWithHooks([
    { step: searchTool("mancuernas 10kg") },
    { step: searchTool("mancuernas 15kg") },
    { step: searchTool("mancuernas 20kg") },
    { step: respond("Todo listo.") }
  ]);

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "quiero mancuernas", commercialContextSummary: {}, provider });

  assert.equal(result.toolExecutionCount, 3, "open-turn mode must allow the 3rd tool call the legacy ceiling would have blocked");
  assert.equal(result.terminalReason, "responded");
  assert.equal(result.warnings.includes("agent_loop_finalization_entered"), false);
});

// ---- 16. Existing structured-output repair still works under open-turn mode ----
test("16 - open turn: schema-invalid AgentStep repair still recovers exactly as before", async () => {
  const { provider } = createScriptedProviderWithHooks([{ step: { type: "not_a_real_type" } }, { step: respond("Recuperado correctamente.") }]);

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "hola", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.finalMessage, "Recuperado correctamente.");
  assert.ok(result.warnings.some((warning) => warning.startsWith("agent_step_invalid:")));
});

// ---- 17. Existing (flag-off) mutation claim guard remains compatible ----
test("17 - flag off: the pre-existing regex-based mutation claim guard still swaps the message and terminates", async () => {
  const { provider } = createScriptedProviderWithHooks([{ step: respond("Perfecto, 2 unidades listas para ti.") }]);

  const result = await runAgentToolLoop({ ...baseInput, openTurnExecutionEnabled: false, customerMessage: "dame 2 mancuernas", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.finalMessage, MUTATION_CLAIM_GUARD_FALLBACK_MESSAGE);
  assert.equal(result.warnings.some((warning) => warning.startsWith("agent_loop_mutation_claim_blocked:")), true);
});
