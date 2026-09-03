// SALES-AGENT-R3-V1.8.1b-A (Objetivo A - live turn assimilation). Deterministic,
// scripted-provider tests for the two safe boundaries inside runAgentToolLoop.ts
// (universal pre-action gate, post-tool gate) via the injected checkForNewInbound
// DI seam - no real DB, no real timing races, no real LLM. Mirrors the task
// brief's own lettered test list (A-G, M, P); real-MariaDB settlement
// reconciliation/crash-boundary tests live in tests/commercial/turnSettlementRepository.test.ts
// and tests/native/inboundTurnSettling.e2e.test.ts instead.

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

const baseInput = {
  correlationId: "corr-live-assimilation",
  conversationId: 42,
  opportunityId: null,
  currentTime: "2026-09-03T15:00:00.000Z",
  ensureOpportunity: neverEnsureOpportunity,
  liveTurnAssimilationEnabled: true,
  inboundMessageId: "100"
};

/** In-memory durable-inbound fake: tests push fragments into it to simulate new customer messages arriving mid-run. */
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

/** Scripted provider that also runs an optional side effect immediately before each call returns (e.g. pushing a fragment into the store) and records every request it received. */
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

function lastUserPayload(requests: AgentLoopProviderRequest[]) {
  const request = requests[requests.length - 1];
  const userMessage = [...request.messages].reverse().find((message) => message.role === "user");
  return JSON.parse((userMessage?.content as string) ?? "{}") as { customerMessage?: string };
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

/** Minimal search_products fixture - only what processUseToolStep/buildToolObservation need to accept it as "completed". */
function searchProductsUp(onRequested?: () => void) {
  handler = (req, res) => {
    if (req.url === "/api/v2/catalog/resolve-product-intent" && req.method === "POST") {
      onRequested?.();
      return sendJson(res, 200, {
        query: { original: "kettlebell", normalized: "kettlebell" },
        resolution: { status: "resolved", confidence: 0.9, sourceProduct: { productId: "501", combinationId: null } },
        candidates: [
          {
            product: {
              productId: "501",
              combinationId: null,
              name: "Kettlebell 16kg",
              reference: "KB-16",
              description: "Kettlebell de fundicion 16kg.",
              price: null,
              stock: { status: "in_stock", available: true, quantity: 4 }
            },
            match: { rank: 1, score: 0.9, reasons: ["EXACT_NAME_MATCH"] }
          }
        ],
        statistics: { retrieved: 1, eligible: 1, returned: 1 },
        warnings: [],
        correlationId: "c"
      });
    }
    return sendJson(res, 404, { error: "not_found" });
  };
}

test("A - new inbound during provider call: stale respond candidate is discarded, cognition continues", async () => {
  const store = createFragmentStore();
  const { provider, requests } = createScriptedProviderWithHooks([
    { step: { type: "respond", message: "stale reply" }, before: () => store.push(101, "espera, una cosa mas") },
    { step: { type: "respond", message: "fresh reply" } }
  ]);

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "hola",
    commercialContextSummary: {},
    provider,
    checkForNewInbound: store.checkForNewInbound
  });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.finalMessage, "fresh reply");
  assert.equal(result.assimilationCycleCount, 1);
  assert.equal(result.invalidatedCandidateCount, 1);
  assert.deepEqual(result.assimilatedInboundMessageIds, [101]);
  assert.equal(result.finalAssimilatedInboundMessageId, 101);
  // The discarded candidate never entered steps - only the accepted one did.
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].step.type, "respond");
  // The second (accepted) inference actually saw the assimilated text.
  assert.match(lastUserPayload(requests).customerMessage ?? "", /espera, una cosa mas/);
});

test("B - new inbound during tool execution: folded in via the post-tool boundary, no candidate invalidated", async () => {
  const store = createFragmentStore();
  searchProductsUp(() => store.push(101, "mejor una multifuncional"));
  const { provider, requests } = createScriptedProviderWithHooks([
    { step: { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell" } } },
    { step: { type: "respond", message: "grounded reply" } }
  ]);

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "busco una kettlebell",
    commercialContextSummary: {},
    provider,
    checkForNewInbound: store.checkForNewInbound
  });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.finalMessage, "grounded reply");
  assert.equal(result.toolExecutionCount, 1);
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[0].observation?.status, "completed");
  assert.equal(result.assimilationCycleCount, 1);
  assert.equal(result.invalidatedCandidateCount, 0);
  assert.deepEqual(result.assimilatedInboundMessageIds, [101]);
  assert.match(lastUserPayload(requests).customerMessage ?? "", /mejor una multifuncional/);
});

test("C/M - many assimilation cycles, no arbitrary round cap", async () => {
  const store = createFragmentStore();
  const ROUNDS = 6;
  const steps = Array.from({ length: ROUNDS }, (_unused, index) => ({
    step: { type: "respond", message: `stale-${index}` },
    before: () => store.push(101 + index, `fragmento ${index}`)
  }));
  steps.push({ step: { type: "respond", message: "final reply" }, before: () => {} });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "hola",
    commercialContextSummary: {},
    provider: createScriptedProviderWithHooks(steps).provider,
    checkForNewInbound: store.checkForNewInbound
  });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.finalMessage, "final reply");
  assert.equal(result.assimilationCycleCount, ROUNDS);
  assert.equal(result.invalidatedCandidateCount, ROUNDS);
  assert.equal(result.assimilatedInboundMessageIds?.length, ROUNDS);
  // Not one real decision was ever consumed by a staleness discard - the
  // default maxDecisions is 3, ROUNDS is 6, and this still succeeds.
  assert.equal(result.steps.length, 1);
});

test("D - candidate invalidation never contaminates warnings/steps as if dispatched", async () => {
  const store = createFragmentStore();
  const { provider } = createScriptedProviderWithHooks([
    { step: { type: "respond", message: "stale" }, before: () => store.push(101, "algo nuevo") },
    { step: { type: "respond", message: "final" } }
  ]);

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "hola",
    commercialContextSummary: {},
    provider,
    checkForNewInbound: store.checkForNewInbound
  });

  assert.ok(!result.steps.some((record) => record.step.type === "respond" && record.step.message === "stale"));
  assert.ok(!result.warnings.some((warning) => warning.includes("stale")));
});

test("E - finalization phase: same universal pre-action gate applies (forced via maxDecisions:0)", async () => {
  const store = createFragmentStore();
  const { provider, requests } = createScriptedProviderWithHooks([
    { step: { type: "respond", message: "stale finalization reply" }, before: () => store.push(101, "un momento") },
    { step: { type: "respond", message: "fresh finalization reply" } }
  ]);

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "hola",
    commercialContextSummary: {},
    provider,
    checkForNewInbound: store.checkForNewInbound,
    maxDecisions: 0
  });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.finalMessage, "fresh finalization reply");
  assert.equal(result.assimilationCycleCount, 1);
  assert.equal(result.invalidatedCandidateCount, 1);
  assert.match(lastUserPayload(requests).customerMessage ?? "", /un momento/);
});

test("F - handoff is freshness-sensitive: a stale handoff candidate is discarded too", async () => {
  const store = createFragmentStore();
  const { provider } = createScriptedProviderWithHooks([
    { step: { type: "handoff", reason: "policy_requires_human" }, before: () => store.push(101, "en realidad ya no necesito ayuda") },
    { step: { type: "respond", message: "resolved without a human" } }
  ]);

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "necesito hablar con alguien",
    commercialContextSummary: {},
    provider,
    checkForNewInbound: store.checkForNewInbound
  });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.finalMessage, "resolved without a human");
  assert.equal(result.handoffReason, null);
  assert.equal(result.invalidatedCandidateCount, 1);
});

test("G - a stale use_tool candidate is discarded BEFORE execution, never calls the tool at all", async () => {
  const store = createFragmentStore();
  let toolWasCalled = false;
  searchProductsUp(() => {
    toolWasCalled = true;
  });
  const { provider, requests } = createScriptedProviderWithHooks([
    { step: { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell" } }, before: () => store.push(101, "pero quiero una multifuncional") },
    { step: { type: "respond", message: "final grounded reply" } }
  ]);

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "busco una kettlebell",
    commercialContextSummary: {},
    provider,
    checkForNewInbound: store.checkForNewInbound
  });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.finalMessage, "final grounded reply");
  // The tool decision itself was based on stale intent (the fragment arrived
  // before this exact step was ever accepted) - Boundary 1 must discard it
  // BEFORE processUseToolStep runs, so the tool is never actually called.
  assert.equal(toolWasCalled, false, "a mutating/read tool call must never execute on a stale candidate");
  assert.equal(result.toolExecutionCount, 0);
  assert.ok(!result.steps.some((record) => record.step.type === "use_tool"));
  assert.equal(result.invalidatedCandidateCount, 1);
  assert.match(lastUserPayload(requests).customerMessage ?? "", /pero quiero una multifuncional/);
});

test("P - flag off is byte-identical: a stale candidate is never checked, never discarded", async () => {
  const store = createFragmentStore();
  const { provider } = createScriptedProviderWithHooks([
    { step: { type: "respond", message: "first reply" }, before: () => store.push(101, "mensaje que nunca deberia verse") },
    { step: { type: "respond", message: "second reply (never reached)" } }
  ]);

  const result = await runAgentToolLoop({
    ...baseInput,
    liveTurnAssimilationEnabled: false,
    customerMessage: "hola",
    commercialContextSummary: {},
    provider,
    checkForNewInbound: store.checkForNewInbound
  });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.finalMessage, "first reply");
  assert.equal(result.assimilationCycleCount, 0);
  assert.equal(result.invalidatedCandidateCount, 0);
  assert.deepEqual(result.assimilatedInboundMessageIds, []);
  assert.equal(result.finalAssimilatedInboundMessageId, 100);
});
