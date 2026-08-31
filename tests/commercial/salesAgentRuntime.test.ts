import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { getPool } from "@/lib/db";
import { runSalesAgentRuntime } from "@/lib/brain/commercial/sales-agent-runtime";
import type { SalesAgentRuntimeInput } from "@/lib/brain/commercial/sales-agent-runtime";
import { createFakeAgentLoopProvider } from "@/lib/brain/commercial/agent-loop/providers/fakeAgentLoopProvider";
import type { AgentLoopProvider, AgentLoopProviderInvokeOptions, AgentLoopProviderRequest, AgentLoopProviderResponse } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";
import { resetCapabilityGatewayCatalogPortForTests } from "@/lib/brain/commercial/capability-gateway/registry";
import type { PendingCatalogActionStep } from "@/lib/brain/commercial/agent-loop/agentStepTypes";
import type { CustomerMessageEvent, FollowUpWakeEvent } from "@/lib/brain/commercial/agent-runtime-event/types";
import type { NativeCustomerSessionExecutionContext } from "@/lib/brain/commercial/native-cycle/customer-session/types";

// SALES-AGENT-R3-V1.3. Same local dev DB credentials every other real-DB
// agent-loop/commercial-action test file already establishes (see
// tests/agent-loop/runAgentToolLoop.test.ts) - node:test loads every matched
// file into one process, so whichever sets these first wins for the run.
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

let conversationSeq = Date.now();
function uniqueConversationId() {
  conversationSeq += 1;
  return conversationSeq;
}

async function countOpportunitiesForConversation(conversationId: number) {
  const [rows] = await getPool().execute("SELECT id FROM crm_opportunities WHERE conversation_case_id = ?", [String(conversationId)]);
  return (rows as unknown[]).length;
}

function baseEvent(overrides: Partial<CustomerMessageEvent> = {}): CustomerMessageEvent {
  const conversationId = overrides.conversationId ?? uniqueConversationId();
  return {
    type: "CUSTOMER_MESSAGE",
    conversationId,
    conversationPublicId: `conv-public-${conversationId}`,
    customerMasterId: null,
    waId: "56900001111",
    phoneNumberId: "phone-1",
    messageId: `wamid.test.${conversationId}`,
    messageText: "hola",
    correlationId: `corr-${conversationId}`,
    currentTime: "2026-08-31T15:00:00.000Z",
    ...overrides
  };
}

function level0Session(): NativeCustomerSessionExecutionContext {
  return {
    conversationId: "conv-r3v13",
    opportunityId: null,
    trustedInbound: { channel: "whatsapp", externalId: "56900001111", normalizedPhone: "56900001111", messageId: "wamid.r3v13", receivedAt: "2026-08-31T12:00:00.000Z" },
    identity: { status: "anonymous", customerId: null, source: "none", localResolutionOutcome: "anonymous", externalResolutionOutcome: null },
    masterCustomerIdentity: { status: "identity_unresolved", reason: "identity_source_unsupported" },
    runtimeIdentity: {
      status: "ANONYMOUS",
      identityLevel: "LEVEL_0_ANONYMOUS",
      masterCustomerId: null,
      prestashopCustomerId: null,
      verificationRequired: false,
      requiredEvidence: [],
      readyToLink: false,
      conflictCode: null,
      policyCode: "NO_CHANNEL_EVIDENCE",
      evidenceRefs: []
    },
    onboarding: null,
    contextAccess: "none",
    currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: null },
    freshExternalResolutionEvidence: null
  };
}

/** Fails the test if the provider is ever invoked - proves a governance/contract block never reaches the model. */
function unreachableProvider(): AgentLoopProvider {
  return {
    name: "unreachable-test-provider",
    async invoke(): Promise<AgentLoopProviderResponse> {
      throw new Error("provider must not be invoked for this scenario");
    }
  };
}

/** Never resolves until aborted by the loop's own deadline - proves a real, structured timeout. */
function hangingProvider(): AgentLoopProvider {
  return {
    name: "hanging-test-provider",
    invoke(_request: AgentLoopProviderRequest, options: AgentLoopProviderInvokeOptions): Promise<AgentLoopProviderResponse> {
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    }
  };
}

function runtimeInput(overrides: Partial<SalesAgentRuntimeInput> = {}): SalesAgentRuntimeInput {
  return {
    event: baseEvent(),
    opportunityId: null,
    provider: null,
    ...overrides
  };
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
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures - test results already reported
  }
});

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function productIntentResolvedPayload() {
  return {
    query: { original: "kettlebell", normalized: "kettlebell" },
    resolution: { status: "resolved", confidence: 0.92, sourceProduct: { productId: "501", combinationId: "1" } },
    candidates: [
      {
        product: {
          productId: "501",
          combinationId: "1",
          name: "Kettlebell 16kg",
          reference: "KB-16",
          description: "Kettlebell de fundicion 16kg.",
          price: null,
          stock: { status: "in_stock", available: true, quantity: 4 }
        },
        match: { rank: 1, score: 0.92, reasons: ["EXACT_NAME_MATCH"] }
      }
    ],
    statistics: { retrieved: 1, eligible: 1, returned: 1 },
    warnings: [],
    correlationId: "c"
  };
}

function catalogUp() {
  handler = (req, res) => {
    if (req.url === "/api/v2/catalog/resolve-product-intent" && req.method === "POST") {
      return sendJson(res, 200, productIntentResolvedPayload());
    }
    if (req.url?.startsWith("/v1/products/501")) {
      return sendJson(res, 200, {
        product: { productId: 501, name: "Kettlebell 16kg", sku: "KB-16", shortDescription: "Kettlebell de fundicion 16kg.", longDescription: null, active: true },
        variants: [],
        selectedVariant: null,
        pricing: { effectiveUnitPrice: 29990, currency: "CLP", taxIncluded: true, discountApplied: false },
        stock: { available: true, physicalQuantity: 4 },
        freshness: { cached: false }
      });
    }
    return sendJson(res, 404, { error: "not_found" });
  };
}

function catalogDown() {
  handler = (_req, res) => sendJson(res, 503, { error: "unavailable" });
}

// --- Phase 19: runtime event ingestion / final-response path ---

test("CUSTOMER_MESSAGE with no tools needed: responds directly, no opportunity, structured metrics present", async () => {
  const provider = createFakeAgentLoopProvider({ script: [{ type: "respond", message: "Hola! En que puedo ayudarte hoy?" }] });
  const event = baseEvent();

  const result = await runSalesAgentRuntime(runtimeInput({ event, provider }));

  assert.equal(result.status, "responded");
  assert.equal(result.responseText, "Hola! En que puedo ayudarte hoy?");
  assert.equal(result.reason, null);
  assert.equal(result.modelSteps, 1);
  assert.equal(result.toolCalls, 0);
  assert.equal(result.readToolCalls, 0);
  assert.equal(result.commercialActionCalls, 0);
  assert.equal(result.resolvedOpportunityId, null);
  assert.equal(typeof result.durationMs, "number");
  assert.equal(result.inputTokens, 32);
  assert.equal(result.outputTokens, 64);
  assert.equal(await countOpportunitiesForConversation(event.conversationId), 0);
});

test("FOLLOWUP_WAKE is not this runtime's job - fails closed, the model is never invoked", async () => {
  const event: FollowUpWakeEvent = {
    type: "FOLLOWUP_WAKE",
    wakeId: "wake-1",
    actionPublicId: "action-1",
    attempt: 1,
    conversationId: uniqueConversationId(),
    opportunityId: null,
    correlationId: "corr-wake-1",
    causationId: null,
    scheduledFor: "2026-08-31T14:00:00.000Z",
    firedAt: "2026-08-31T14:05:00.000Z",
    reason: "scheduled_due"
  };

  const result = await runSalesAgentRuntime(runtimeInput({ event, provider: unreachableProvider() }));

  assert.equal(result.status, "failed");
  assert.equal(result.reason, "unsupported_event_type");
  assert.equal(result.modelSteps, 0);
});

test("a conversation a human already owns is blocked before the model is ever invoked", async () => {
  const result = await runSalesAgentRuntime(runtimeInput({ provider: unreachableProvider(), governance: { humanOwnerActive: true } }));
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "human_owner_active");
});

test("an AI-blocked conversation is blocked before the model is ever invoked", async () => {
  const result = await runSalesAgentRuntime(runtimeInput({ provider: unreachableProvider(), governance: { aiBlocked: true } }));
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "ai_blocked");
});

// --- Phase 16 scenario 1 / Phase 19: single + multiple sequential read tools ---

test("[scenario] pure product lookup: search_products grounds the answer, never creates an opportunity", async () => {
  catalogUp();
  const event = baseEvent({ messageText: "que kettlebells tienen?" });
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell" } },
      { type: "respond", message: "Tenemos el Kettlebell 16kg disponible." }
    ]
  });

  const result = await runSalesAgentRuntime(runtimeInput({ event, provider }));

  assert.equal(result.status, "responded");
  assert.equal(result.toolCalls, 1);
  assert.equal(result.readToolCalls, 1);
  assert.equal(result.commercialActionCalls, 0);
  assert.equal(result.resolvedOpportunityId, null);
  assert.equal(await countOpportunitiesForConversation(event.conversationId), 0);
});

test("multiple sequential read tools: search then inspect details before responding", async () => {
  catalogUp();
  const event = baseEvent({ messageText: "cuentame mas del kettlebell" });
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell" } },
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      { type: "respond", message: "El Kettlebell 16kg cuesta $29.990 y tiene 4 unidades disponibles." }
    ]
  });

  const result = await runSalesAgentRuntime(runtimeInput({ event, provider }));

  assert.equal(result.status, "responded");
  assert.equal(result.toolCalls, 2);
  assert.equal(result.readToolCalls, 2);
  assert.equal(result.commercialActionCalls, 0);
});

// --- Phase 19: commercial action + lazy opportunity integration ---

test("[scenario] commercial action: select_products resolves a durable opportunity lazily", async () => {
  catalogUp();
  const event = baseEvent({ messageText: "quiero ese kettlebell" });
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      { type: "use_tool", tool: "select_products", arguments: { items: [{ productId: "501", quantity: 1 }] } },
      { type: "respond", message: "Listo, agregue el kettlebell." }
    ]
  });

  const result = await runSalesAgentRuntime(runtimeInput({ event, provider }));

  assert.equal(result.status, "responded");
  assert.equal(result.commercialActionCalls, 1);
  assert.notEqual(result.resolvedOpportunityId, null);
  assert.equal(await countOpportunitiesForConversation(event.conversationId), 1);
});

// --- Phase 16 scenario 5 / Phase 19: identity-denied action ---

test("[scenario] quote identity block: opportunity still resolves, but the identity gate denies create_quote at LEVEL_0", async () => {
  const event = baseEvent({ messageText: "cotizame eso" });
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "create_quote", arguments: {} },
      { type: "respond", message: "Necesito verificar tu identidad antes de generar la cotizacion." }
    ]
  });

  const result = await runSalesAgentRuntime(runtimeInput({ event, provider, trustedCustomerSession: level0Session() }));

  assert.equal(result.status, "responded");
  assert.equal(result.commercialActionCalls, 1);
  // The opportunity resolution seam ran and succeeded independently of
  // identity (R3-V1.2 Phase 9) - creating an opportunity never implies
  // business authority.
  assert.notEqual(result.resolvedOpportunityId, null);
  assert.equal(await countOpportunitiesForConversation(event.conversationId), 1);
});

// --- Phase 19: session continuity ---

test("[scenario] session continuity: 'la segunda' resolves against turn 1's own finalPendingCatalogAction", async () => {
  catalogUp();
  const conversationId = uniqueConversationId();

  // Turn 1's own result is what a caller threads forward - never a second,
  // hand-built session store. candidateProducts (not just candidateProductIds)
  // is what makes this a runtime-managed continuity window (CP-R1-T10B8D),
  // the same shape a completed recommend_catalog_products call would produce.
  const turn1PendingCatalogAction: PendingCatalogActionStep = {
    actionType: "send_product_link",
    candidateProductIds: ["500", "501"],
    candidateProducts: [{ productId: "500" }, { productId: "501" }]
  };

  const turn2 = await runSalesAgentRuntime(
    runtimeInput({
      event: baseEvent({ conversationId, messageText: "la segunda" }),
      pendingCatalogAction: turn1PendingCatalogAction,
      provider: createFakeAgentLoopProvider({
        script: [
          { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
          { type: "respond", message: "El Kettlebell 16kg cuesta $29.990." }
        ]
      })
    })
  );

  assert.equal(turn2.status, "responded");
  assert.equal(turn2.readToolCalls, 1, "get_product_details for a candidate turn 1 offered is authorized purely from carried-forward continuity");
});

// --- Phase 16 scenario 7 / Phase 19: malformed/unknown tool call, tool recovery ---

test("[scenario] an unregistered/cognitive tool name is blocked and the model recovers within the same run", async () => {
  const event = baseEvent({ messageText: "compara estas dos barras" });
  // compare_products is explicitly NOT an available tool (Phase 4 forbids
  // cognitive tools) - proves an unregistered tool name never crashes the
  // run and the model gets a real chance to recover.
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "compare_products", arguments: {} },
      { type: "respond", message: "Puedo ayudarte a comparar si me dices los dos productos." }
    ]
  });

  const result = await runSalesAgentRuntime(runtimeInput({ event, provider }));

  assert.equal(result.status, "responded");
  assert.equal(result.toolCalls, 1);
  assert.equal(result.readToolCalls, 0);
  assert.equal(result.commercialActionCalls, 0);
  assert.ok(result.warnings.some((warning) => warning.startsWith("agent_loop_tool_blocked_unregistered:compare_products")));
});

test("tool failure recovery: the Catalog Service being down does not stop the turn", async () => {
  catalogDown();
  const event = baseEvent({ messageText: "cual es el horario de atencion?" });
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell" } },
      { type: "use_tool", tool: "search_company_knowledge", arguments: { query: "horario de atencion" } },
      { type: "respond", message: "Atendemos de lunes a viernes de 9 a 18 hrs." }
    ]
  });

  const result = await runSalesAgentRuntime(runtimeInput({ event, provider }));

  assert.equal(result.status, "responded");
  assert.equal(result.toolCalls, 2);
  assert.equal(result.readToolCalls, 2);
});

// --- Phase 19: provider timeout, max-step limit, max-tool limit ---

test("provider timeout produces a structured failure, never an infinite loop", async () => {
  const result = await runSalesAgentRuntime(runtimeInput({ provider: hangingProvider(), timeoutMs: 50 }));
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "timeout");
  assert.ok(result.durationMs < 5000);
});

test("max model decisions bounds the gathering phase and still reaches a response via finalization", async () => {
  catalogUp();
  const event = baseEvent({ messageText: "que tienen?" });
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell" } },
      { type: "respond", message: "Tenemos el Kettlebell 16kg." }
    ]
  });

  const result = await runSalesAgentRuntime(runtimeInput({ event, provider, maxDecisions: 1 }));

  assert.equal(result.status, "responded");
  assert.equal(result.toolCalls, 1);
});

test("max tool executions bounds tool calls - a second tool request during finalization is rejected, not executed", async () => {
  catalogUp();
  const event = baseEvent({ messageText: "que tienen?" });
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell" } },
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      { type: "respond", message: "Tenemos el Kettlebell 16kg." }
    ]
  });

  const result = await runSalesAgentRuntime(runtimeInput({ event, provider, maxToolExecutions: 1 }));

  assert.equal(result.status, "responded");
  assert.equal(result.toolCalls, 1, "the second tool request never executes once the budget is spent");
});

// --- Phase 19: repeated action idempotency ---

test("a repeated, identical commercial action request within one run is deduped, never a second mutation", async () => {
  catalogUp();
  const event = baseEvent({ messageText: "quiero 1 kettlebell" });
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      { type: "use_tool", tool: "select_products", arguments: { items: [{ productId: "501", quantity: 1 }] } },
      { type: "use_tool", tool: "select_products", arguments: { items: [{ productId: "501", quantity: 1 }] } },
      { type: "respond", message: "Listo, agregue el kettlebell." }
    ]
  });

  const result = await runSalesAgentRuntime(runtimeInput({ event, provider, maxDecisions: 4, maxToolExecutions: 3 }));

  assert.equal(result.status, "responded");
  assert.ok(result.warnings.some((warning) => warning.startsWith("agent_loop_tool_blocked_duplicate:select_products")));
  assert.equal(await countOpportunitiesForConversation(event.conversationId), 1, "exactly one opportunity, never a second, from the deduped repeat");
});

// --- Phase 19: no chain-of-thought persistence / structured result shape ---

test("the result exposes only structured, bounded fields - no chain-of-thought", async () => {
  const provider = createFakeAgentLoopProvider({ script: [{ type: "respond", message: "Hola!" }] });
  const result = await runSalesAgentRuntime(runtimeInput({ provider }));

  assert.deepEqual(
    Object.keys(result).sort(),
    [
      "commercialActionCalls",
      "durationMs",
      "finalPendingCatalogAction",
      "inputTokens",
      "modelSteps",
      "outputTokens",
      "reason",
      "resolvedOpportunityId",
      "responseText",
      "status",
      "toolCalls",
      "readToolCalls",
      "warnings"
    ].sort()
  );
});
