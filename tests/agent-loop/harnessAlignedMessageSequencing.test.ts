// SALES-AGENT-R3-V1.8.2-C1 (Harness-Aligned Message Sequencing). Deterministic,
// scripted-provider LOOP-LEVEL integration tests for
// BRAIN_R3_HARNESS_ALIGNED_MESSAGE_MODEL_ENABLED (input.harnessAlignedMessageModelEnabled) -
// no real DB, no real LLM. Pure message-shape/representation tests for
// buildAgentStepPromptPackage.ts's new projection live in
// buildAgentStepPromptPackage.test.ts instead (that function is pure and
// needs no loop machinery); this file only covers what genuinely requires a
// real runAgentToolLoop() run: fragment tracking across tryAssimilate()
// boundaries, causal ordering across real sequential iterations, and
// composition with Open Turn / mutation-exactly-once. Mirrors the fixture/
// mock-server conventions runAgentToolLoopLiveAssimilation.test.ts and
// openTurnExecution.test.ts already established (local helpers duplicated,
// never a shared abstraction for a handful of callers).

import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { runAgentToolLoop } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";
import { resetCapabilityGatewayCatalogPortForTests } from "@/lib/brain/commercial/capability-gateway/registry";
import type { AgentLoopProvider, AgentLoopProviderRequest, AgentLoopProviderResponse } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";
import type { CheckForNewInboundResult } from "@/lib/brain/commercial/turn-settlement/checkForNewInbound";
import type { EnsureCommercialActionOpportunityInput, EnsureCommercialActionOpportunityResult } from "@/lib/brain/commercial/commercial-action-request/ensureCommercialActionOpportunity";

async function neverEnsureOpportunity(_input: EnsureCommercialActionOpportunityInput): Promise<EnsureCommercialActionOpportunityResult> {
  throw new Error("ensureOpportunity must never be called by a READ_TOOL-only script in this file");
}

/** Mirrors runAgentToolLoopLiveAssimilation.test.ts/openTurnExecution.test.ts's own local helper - never a shared abstraction for a handful of callers. */
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
  correlationId: "corr-harness-aligned",
  conversationId: 4300,
  opportunityId: null,
  currentTime: "2026-09-09T15:00:00.000Z",
  ensureOpportunity: neverEnsureOpportunity,
  harnessAlignedMessageModelEnabled: true,
  inboundMessageId: "100"
};

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

function searchTool(query = "mancuernas") {
  return { type: "use_tool", tool: "search_products", arguments: { query } };
}
function detailsTool(productId = "501") {
  return { type: "use_tool", tool: "get_product_details", arguments: { productId } };
}
function respond(message: string) {
  return { type: "respond", message };
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

/** Minimal search_products/get_product_details fixture - only what processUseToolStep/buildToolObservation need to accept both as "completed". */
function catalogUp() {
  handler = (req, res) => {
    if (req.url === "/api/v2/catalog/resolve-product-intent" && req.method === "POST") {
      return sendJson(res, 200, {
        query: { original: "mancuernas", normalized: "mancuernas" },
        resolution: { status: "resolved", confidence: 0.9, sourceProduct: { productId: "501", combinationId: null } },
        candidates: [
          {
            product: { productId: "501", combinationId: null, name: "Mancuerna 10kg", reference: "MC-10", description: "desc", price: null, stock: { status: "in_stock", available: true, quantity: 4 } },
            match: { rank: 1, score: 0.9, reasons: ["EXACT_NAME_MATCH"] }
          }
        ],
        statistics: { retrieved: 1, eligible: 1, returned: 1 },
        warnings: [],
        correlationId: "c"
      });
    }
    if (req.url === "/api/v2/catalog/products/501" && req.method === "GET") {
      return sendJson(res, 200, { productId: "501", name: "Mancuerna 10kg", publicLink: { available: false } });
    }
    return sendJson(res, 404, { error: "not_found" });
  };
}

function lastRequestMessages(requests: AgentLoopProviderRequest[]) {
  return requests[requests.length - 1].messages;
}

test("[C1-L1] flag off: loop-level result defaults to legacy_envelope and the request keeps the legacy single-user-message shape", async () => {
  const { provider, requests } = createScriptedProviderWithHooks([{ step: respond("hola, en que te ayudo?") }]);
  const result = await runAgentToolLoop({ ...baseInput, harnessAlignedMessageModelEnabled: false, customerMessage: "hola", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.messageModelMode, "legacy_envelope");
  assert.equal(result.projectedToolObservationCount, 0);
  assert.equal(result.projectedAssimilatedUserMessageCount, 0);
  assert.deepEqual(lastRequestMessages(requests).map((m) => m.role), ["system", "user"]);
});

test("[C1-L2] flag on: two real sequential tool steps project the exact causal order - assistant/user alternating", async () => {
  catalogUp();
  const { provider, requests } = createScriptedProviderWithHooks([{ step: searchTool() }, { step: detailsTool() }, { step: respond("Aqui tienes el detalle.") }]);

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "busco una mancuerna y su detalle", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.messageModelMode, "harness_aligned");
  assert.equal(result.projectedToolObservationCount, 2, "the FINAL prompt build (finalization is never reached here) already saw both tool observations");
  const finalMessages = lastRequestMessages(requests);
  const roles = finalMessages.map((m) => m.role);
  // system(stable) + system(dynamic context) + user(customer) + assistant/user x2 (two tool steps)
  assert.deepEqual(roles, ["system", "system", "user", "assistant", "user", "assistant", "user"]);
  assert.match(finalMessages[4].content as string, /^\[TOOL RESULT: search_products\]/);
  assert.match(finalMessages[6].content as string, /^\[TOOL RESULT: get_product_details\]/);
});

test("[C1-L3] flag on: new inbound folded in mid-turn becomes its own discrete final user message, never merged text", async () => {
  const store = createFragmentStore();
  catalogUp();
  const { provider, requests } = createScriptedProviderWithHooks([{ step: searchTool(), before: () => store.push(101, "mejor una kettlebell") }, { step: respond("grounded reply") }]);

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "busco una mancuerna",
    commercialContextSummary: {},
    provider,
    checkForNewInbound: store.checkForNewInbound,
    liveTurnAssimilationEnabled: true
  });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.projectedAssimilatedUserMessageCount, 1);
  const finalMessages = lastRequestMessages(requests);
  const lastMessage = finalMessages[finalMessages.length - 1];
  assert.equal(lastMessage.role, "user");
  assert.equal(lastMessage.content, "mejor una kettlebell", "the assimilated fragment is its own message with raw text, never concatenated into the original customer message");
  const originalMessage = finalMessages.find((m) => m.content === "busco una mancuerna");
  assert.ok(originalMessage, "the original customer message must still be present, unmodified, as its own message");
});

test("[C1-L4] flag on: a Boundary-1 discarded (stale) candidate leaves no trace in the projection - no persisted reasoning", async () => {
  const store = createFragmentStore();
  const { provider, requests } = createScriptedProviderWithHooks([
    { step: respond("stale reply"), before: () => store.push(101, "espera, una cosa mas") },
    { step: respond("fresh reply") }
  ]);

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "hola",
    commercialContextSummary: {},
    provider,
    checkForNewInbound: store.checkForNewInbound,
    liveTurnAssimilationEnabled: true
  });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.finalMessage, "fresh reply");
  assert.equal(result.invalidatedCandidateCount, 1);
  const finalMessages = lastRequestMessages(requests);
  assert.ok(
    !finalMessages.some((m) => m.role === "assistant" && m.content.includes("stale reply")),
    "the discarded candidate's own AgentStep JSON must never appear in a later prompt build - it was never pushed to steps"
  );
  assert.equal(finalMessages[finalMessages.length - 1].content, "espera, una cosa mas");
});

test("[C1-L5] flag on: two inbound fragments assimilated in one cycle remain two discrete, correctly-ordered user messages", async () => {
  const store = createFragmentStore();
  catalogUp();
  const { provider, requests } = createScriptedProviderWithHooks([
    {
      step: searchTool(),
      before: () => {
        store.push(101, "mensaje A");
        store.push(102, "mensaje B");
      }
    },
    { step: respond("ok") }
  ]);

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "hola",
    commercialContextSummary: {},
    provider,
    checkForNewInbound: store.checkForNewInbound,
    liveTurnAssimilationEnabled: true
  });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.projectedAssimilatedUserMessageCount, 2);
  const finalMessages = lastRequestMessages(requests);
  const indexA = finalMessages.findIndex((m) => m.content === "mensaje A");
  const indexB = finalMessages.findIndex((m) => m.content === "mensaje B");
  assert.ok(indexA >= 0 && indexB >= 0, "both fragments must appear as their own discrete messages, never collapsed into one paragraph");
  assert.ok(indexA < indexB, "real arrival order must be preserved - the latest correction stays naturally latest by position");
});

test("[C1-L6] flag on + Open Turn: a 4-step turn still completes, message projection grows monotonically across iterations", async () => {
  catalogUp();
  const { provider, requests } = createScriptedProviderWithHooks([
    { step: searchTool("mancuernas 10kg") },
    { step: searchTool("mancuernas 15kg") },
    { step: searchTool("mancuernas 20kg") },
    { step: detailsTool() },
    { step: respond("Aqui tienes las opciones.") }
  ]);

  const result = await runAgentToolLoop({ ...baseInput, openTurnExecutionEnabled: true, customerMessage: "quiero mancuernas", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.acceptedStepCount, 5);
  assert.equal(result.messageModelMode, "harness_aligned");
  assert.equal(result.projectedToolObservationCount, 4);
  // Each successive real request must carry strictly more messages than the last (one assistant + one tool-observation message added per accepted tool step).
  const messageCounts = requests.map((request) => request.messages.length);
  for (let i = 1; i < messageCounts.length; i++) {
    assert.ok(messageCounts[i] > messageCounts[i - 1], `request ${i} must carry more messages than request ${i - 1}`);
  }
});

test("[C1-L7] flag on: a committed mutation stays exactly-once even when steering arrives right after it", async () => {
  const store = createFragmentStore();
  const opportunity = countingEnsureOpportunity(() => store.push(101, "y tambien agrega envio rapido por favor"));
  catalogUp();
  const { provider, requests } = createScriptedProviderWithHooks([
    { step: searchTool("mancuernas 10kg") },
    { step: { type: "use_tool", tool: "select_products", arguments: { items: [{ productId: "501", quantity: 2 }] } } },
    { step: respond("Seleccion confirmada, reviso el envio.") }
  ]);

  const result = await runAgentToolLoop({
    ...baseInput,
    openTurnExecutionEnabled: true,
    customerMessage: "dame 2 mancuernas de 10kg",
    commercialContextSummary: {},
    provider,
    ensureOpportunity: opportunity.fn,
    checkForNewInbound: store.checkForNewInbound,
    liveTurnAssimilationEnabled: true
  });

  assert.equal(result.terminalReason, "responded");
  assert.equal(opportunity.callCount(), 1, "the committed mutation must execute exactly once, same as under the legacy message model");
  const mutationSteps = result.steps.filter((record) => record.step.type === "use_tool" && record.step.tool === "select_products");
  assert.equal(mutationSteps.length, 1);
  const finalMessages = lastRequestMessages(requests);
  assert.equal(finalMessages[finalMessages.length - 1].content, "y tambien agrega envio rapido por favor");
});
