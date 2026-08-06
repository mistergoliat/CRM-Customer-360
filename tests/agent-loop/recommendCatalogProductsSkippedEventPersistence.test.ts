import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { runAgentToolLoop, buildStepsSummary } from "@/lib/brain/commercial/agent-loop";
import { createFakeAgentLoopProvider } from "@/lib/brain/commercial/agent-loop/providers/fakeAgentLoopProvider";
import { resetCatalogRecommendationCapabilityForTests } from "@/lib/brain/commercial/capability-gateway";
import { normalizeAgentToolLoopCompletedCommercialEvent } from "@/lib/brain/commercial/events";
import type { AgentLoopResult, AgentLoopStepRecord } from "@/lib/brain/commercial/agent-loop";
import { closeTestHttpServer } from "../helpers/closeTestHttpServer";

/**
 * CP-R1-T10B8C (minor fix, audit finding #3): the real "step summary ->
 * commercial_event payload" path (buildStepsSummary, exported for this test
 * only - runNativeAgentToolLoopCycle.ts - and normalizeAgentToolLoopCompletedCommercialEvent,
 * events/normalize.ts) must accept a recommend_catalog_products "skipped"
 * observation without throwing, without converting it to completed/failed,
 * and without breaking the pre-existing completed/failed/blocked statuses.
 * Both functions are pure (no DB, no fetch) - recordAgentToolLoopCompletedCommercialEvent
 * (the DB-writing wrapper) is never called here, matching this task's own
 * "sin DB real" requirement. The one real-chain step (test 1) still goes
 * through a real local HTTP server, exactly like recommendCatalogProductsAgentLoopIntegration.test.ts.
 */

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
let server: http.Server;
let handler: Handler = (_req, res) => res.writeHead(500).end();

before(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  process.env.CATALOG_SERVICE_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.CATALOG_SERVICE_API_KEY = "test-key";
  process.env.CATALOG_SEARCH_PRODUCTS_V2_TIMEOUT_MS = "2000";
  resetCatalogRecommendationCapabilityForTests();
});

after(async () => {
  await closeTestHttpServer(server);
});

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const eventBaseInput = {
  inboundMessageId: "msg-t10b8c-skipped-1",
  configurationSource: "safe_default" as const,
  configurationRecordId: null,
  configurationVersion: null,
  configurationHash: null,
  effectiveModel: "brain-agent-loop",
  effectiveTemperature: 0,
  effectiveMaxOutputSize: null,
  effectiveTimeoutMs: 20000,
  effectiveMaxAgentStepsPerTurn: 3,
  effectiveMaxToolCallsPerTurn: 2,
  correlationId: "corr-t10b8c-skipped-1",
  conversationId: 1,
  opportunityId: null
};

// 1. Real chain: recommend_catalog_products skipped -> buildToolObservation
// -> buildStepsSummary -> normalizeAgentToolLoopCompletedCommercialEvent.
test("real chain: a recommend_catalog_products skip survives buildStepsSummary and the commercial_event normalizer intact", async () => {
  let catalogServiceCalled = false;
  handler = (_req, res) => {
    catalogServiceCalled = true;
    sendJson(res, 200, { recommendations: [] });
  };
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "recommend_catalog_products", arguments: { sourceProduct: { productId: -1 } } },
      { type: "respond", message: "No pude generar una recomendacion en este momento." }
    ]
  });

  const loop = await runAgentToolLoop({
    correlationId: "corr-t10b8c-skipped-1",
    conversationId: 1,
    opportunityId: null,
    currentTime: "2026-08-05T15:00:00.000Z",
    customerMessage: "algo mas?",
    commercialContextSummary: {},
    // CP-R1-T10B8D: productId -1 must be "observed" for this call to even
    // reach T10B6's own syntactic rejection - see the sibling comment in
    // recommendCatalogProductsAgentLoopIntegration.test.ts test 7.
    recentCatalogContext: { interactions: [{ inboundMessageId: "msg-prior-search", completedAt: "2026-08-05T14:59:00.000Z", sourceTool: "search_products", products: [{ position: 1, productId: "-1", name: "Producto fuente invalido" }] }] },
    provider
  });

  assert.equal(catalogServiceCalled, false, "an invalid sourceProduct must be skipped before any HTTP call");
  const toolStep = loop.steps.find((step) => step.step.type === "use_tool");
  assert.equal(toolStep?.observation?.status, "skipped");
  assert.equal(toolStep?.observation?.reason, "source_product_invalid");

  // buildStepsSummary - the real function runNativeAgentToolLoopCycle.ts persists with.
  const stepsSummary = buildStepsSummary(loop);
  const summaryEntry = stepsSummary.find((entry) => entry.tool === "recommend_catalog_products");
  assert.ok(summaryEntry, "recommend_catalog_products must have a step summary entry");
  assert.equal(summaryEntry!.observationStatus, "skipped");
  // AgentToolLoopStepSummary is a bounded structural summary by design ("never
  // raw arguments or observation data" - its own doc comment) - it never
  // carries `reason`, only `observationStatus`. The exact skip reason stays
  // preserved one layer up, on the ToolObservation itself (asserted above),
  // never at this summary layer - nothing here silently drops it, the
  // contract simply never included it.
  assert.equal("reason" in summaryEntry!, false);

  // normalizeAgentToolLoopCompletedCommercialEvent - pure, no DB, no fetch.
  const event = normalizeAgentToolLoopCompletedCommercialEvent({
    ...eventBaseInput,
    terminalReason: loop.terminalReason,
    decisionCount: loop.steps.length,
    toolExecutionCount: loop.toolExecutionCount,
    toolsUsed: [...new Set(loop.steps.filter((step) => step.step.type === "use_tool").map((step) => (step.step as { tool: string }).tool))],
    finalMessagePresent: loop.finalMessage !== null,
    handoffReasonPresent: loop.handoffReason !== null,
    stepsSummary
  });

  const persistedStepsSummary = event.payload.stepsSummary as Array<{ tool?: string; observationStatus?: string }>;
  const persistedEntry = persistedStepsSummary.find((entry) => entry.tool === "recommend_catalog_products");
  assert.equal(persistedEntry?.observationStatus, "skipped", "skipped must survive normalization unchanged - never converted to completed or failed");
});

// 2. Regression: historical completed/failed/blocked statuses (and skipped,
// side by side) all still normalize without throwing, each preserved
// distinctly - no cross-contamination introduced by the new status.
test("regression: completed/failed/blocked/skipped all normalize side by side without throwing, each preserved distinctly", () => {
  const steps: AgentLoopStepRecord[] = [
    { stepIndex: 0, step: { type: "use_tool", tool: "search_products", arguments: { query: "barra" } }, governance: "authorized", observation: { tool: "search_products", status: "completed", data: { items: [] } }, phase: "gathering" },
    { stepIndex: 1, step: { type: "use_tool", tool: "get_product_details", arguments: { productId: "1" } }, governance: "authorized", observation: { tool: "get_product_details", status: "failed", errorCode: "catalog_service_not_configured" }, phase: "gathering" },
    { stepIndex: 2, step: { type: "use_tool", tool: "explore_catalog", arguments: { sort: { by: "price", direction: "desc" }, limit: 1 } }, governance: "authorized", observation: { tool: "explore_catalog", status: "blocked", errorCode: "sort_and_limit_required" }, phase: "gathering" },
    { stepIndex: 3, step: { type: "use_tool", tool: "recommend_catalog_products", arguments: { sourceProduct: { productId: -1 } } }, governance: "authorized", observation: { tool: "recommend_catalog_products", status: "skipped", reason: "source_product_invalid" }, phase: "gathering" }
  ];
  const loop: AgentLoopResult = {
    ran: true,
    terminalReason: "responded",
    steps,
    toolExecutionCount: 4,
    finalMessage: "listo",
    handoffReason: null,
    warnings: [],
    finalPendingCatalogAction: null
  };

  const stepsSummary = buildStepsSummary(loop);
  assert.deepEqual(
    stepsSummary.map((entry) => entry.observationStatus),
    ["completed", "failed", "blocked", "skipped"]
  );

  const event = normalizeAgentToolLoopCompletedCommercialEvent({
    ...eventBaseInput,
    inboundMessageId: "msg-t10b8c-regression-1",
    correlationId: "corr-t10b8c-regression-1",
    terminalReason: loop.terminalReason,
    decisionCount: loop.steps.length,
    toolExecutionCount: loop.toolExecutionCount,
    toolsUsed: ["search_products", "get_product_details", "explore_catalog", "recommend_catalog_products"],
    finalMessagePresent: true,
    handoffReasonPresent: false,
    stepsSummary
  });

  const persistedStepsSummary = event.payload.stepsSummary as Array<{ tool?: string; observationStatus?: string }>;
  assert.deepEqual(
    persistedStepsSummary.map((entry) => ({ tool: entry.tool, observationStatus: entry.observationStatus })),
    [
      { tool: "search_products", observationStatus: "completed" },
      { tool: "get_product_details", observationStatus: "failed" },
      { tool: "explore_catalog", observationStatus: "blocked" },
      { tool: "recommend_catalog_products", observationStatus: "skipped" }
    ]
  );
});
