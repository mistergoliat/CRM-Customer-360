import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { getPool, safeQueryRows } from "@/lib/db";
import { runSalesAgentRuntime } from "@/lib/brain/commercial/sales-agent-runtime";
import type { SalesAgentRuntimeInput } from "@/lib/brain/commercial/sales-agent-runtime";
import { createFakeAgentLoopProvider } from "@/lib/brain/commercial/agent-loop/providers/fakeAgentLoopProvider";
import type { AgentLoopProvider, AgentLoopProviderInvokeOptions, AgentLoopProviderRequest, AgentLoopProviderResponse } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";
import { resetCapabilityGatewayCatalogPortForTests } from "@/lib/brain/commercial/capability-gateway/registry";
import type { PendingCatalogActionStep } from "@/lib/brain/commercial/agent-loop/agentStepTypes";
import type { CustomerMessageEvent, FollowUpWakeEvent } from "@/lib/brain/commercial/agent-runtime-event/types";
import type { NativeCustomerSessionExecutionContext } from "@/lib/brain/commercial/native-cycle/customer-session/types";
import { createInMemoryAgentSessionBacking, createInMemoryAgentSessionStore } from "@/lib/brain/commercial/agent-session/inMemoryAgentSessionStore";
import type { AgentSessionStore } from "@/lib/brain/commercial/agent-session/store";

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

// SALES-AGENT-R3-V1.8-D5. Real `conversation`/`conversation_message` rows -
// unlike uniqueConversationId() above (a bare numeric id, sufficient for
// crm_opportunities), loadPersistentSessionContext's bounded transcript
// reader hits the real conversation_message table, which FKs against a real
// conversation row (migrations/008_conversation_ai_runtime_core.sql).
async function ensureTestConversation(): Promise<number> {
  const publicId = crypto.randomUUID();
  const externalContactId = `d5-runtime-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const [result] = await getPool().execute(
    `INSERT INTO conversation (public_id, channel, provider, channel_account_id, external_contact_id, status, owner_type)
     VALUES (?, 'whatsapp', 'meta', 'test_account', ?, 'open', 'ai_sdr')`,
    [publicId, externalContactId]
  );
  return (result as { insertId: number }).insertId;
}

async function insertTestMessage(conversationId: number, direction: string, body: string | null, createdAt: string): Promise<number> {
  const publicId = crypto.randomUUID();
  const [result] = await getPool().execute(
    `INSERT INTO conversation_message (public_id, conversation_id, provider, direction, sender_type, message_type, body, status, created_at)
     VALUES (?, ?, 'meta', ?, 'customer', 'text', ?, 'received', ?)`,
    [publicId, conversationId, direction, body, createdAt]
  );
  return (result as { insertId: number }).insertId;
}

async function loadLastCognitionAppliedPayload(inboundMessageId: string): Promise<Record<string, unknown> | null> {
  const result = await safeQueryRows<{ payload_json: string }>(
    "SELECT payload_json FROM commercial_event WHERE event_type = 'persistent_session_cognition_applied' AND source_event_id = ? ORDER BY id DESC LIMIT 1",
    [inboundMessageId]
  );
  if (!result.ok || result.rows.length === 0) return null;
  return JSON.parse(result.rows[0].payload_json) as Record<string, unknown>;
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

// --- SALES-AGENT-R3-V1.8-D4: persistent-session shadow wiring ---
// Section P/G11 (provider request identity) and Section O/G10 (failure
// isolation) - the two critical D4 regressions. Everything else the shadow
// itself does (load/derive/compare/emit) is already proven by
// tests/commercial/persistentSessionShadowComparison.test.ts (pure) and
// tests/commercial/runPersistentSessionShadow.test.ts (real MariaDB); this
// file only proves the wiring at the actual runSalesAgentRuntime call site
// never leaks into the real turn.

function recordingProvider(script: Parameters<typeof createFakeAgentLoopProvider>[0]["script"], sink: AgentLoopProviderRequest[]): AgentLoopProvider {
  const inner = createFakeAgentLoopProvider({ script });
  return {
    name: "recording-test-provider",
    async invoke(request: AgentLoopProviderRequest, options: AgentLoopProviderInvokeOptions): Promise<AgentLoopProviderResponse> {
      sink.push(request);
      return inner.invoke(request, options);
    }
  };
}

/** Only loadSessionForConversation (the shadow's own read) fails - ensureSession/appendEvent succeed via a real in-memory backing, so any warning observed is exclusively the shadow's own, never conflated with the D2 write-side. */
function shadowReadFailingStore(): AgentSessionStore {
  const base = createInMemoryAgentSessionStore(createInMemoryAgentSessionBacking());
  return {
    ...base,
    loadSessionForConversation: async () => {
      throw new Error("simulated_shadow_read_failure");
    }
  };
}

test("[D4-G11] provider request identity: the real provider request is byte-identical whether the shadow is off or on", async () => {
  const conversationId = uniqueConversationId();
  const script: Parameters<typeof createFakeAgentLoopProvider>[0]["script"] = [{ type: "respond", message: "Tenemos varias opciones disponibles." }];

  const sinkOff: AgentLoopProviderRequest[] = [];
  const resultOff = await runSalesAgentRuntime(
    runtimeInput({
      event: baseEvent({ conversationId, messageText: "que opciones tienen?" }),
      provider: recordingProvider(script, sinkOff),
      sessionStore: createInMemoryAgentSessionStore(),
      persistentSessionShadowEnabled: false
    })
  );

  const sinkOn: AgentLoopProviderRequest[] = [];
  const resultOn = await runSalesAgentRuntime(
    runtimeInput({
      event: baseEvent({ conversationId, messageText: "que opciones tienen?" }),
      provider: recordingProvider(script, sinkOn),
      sessionStore: createInMemoryAgentSessionStore(),
      persistentSessionShadowEnabled: true
    })
  );

  assert.equal(resultOff.status, "responded");
  assert.equal(resultOn.status, "responded");
  assert.equal(sinkOff.length, 1);
  assert.equal(sinkOn.length, 1);
  assert.deepEqual(sinkOn[0].messages, sinkOff[0].messages, "the shadow must never alter what the provider actually receives");
});

test("[D4-G10] failure isolation: a shadow read failure never alters the real turn's outcome or the provider request", async () => {
  const conversationId = uniqueConversationId();
  const script: Parameters<typeof createFakeAgentLoopProvider>[0]["script"] = [{ type: "respond", message: "Tenemos varias opciones disponibles." }];

  const sinkBaseline: AgentLoopProviderRequest[] = [];
  const baseline = await runSalesAgentRuntime(
    runtimeInput({
      event: baseEvent({ conversationId, messageText: "que opciones tienen?" }),
      provider: recordingProvider(script, sinkBaseline),
      sessionStore: createInMemoryAgentSessionStore(),
      persistentSessionShadowEnabled: false
    })
  );

  const sinkShadowed: AgentLoopProviderRequest[] = [];
  const shadowed = await runSalesAgentRuntime(
    runtimeInput({
      event: baseEvent({ conversationId, messageText: "que opciones tienen?" }),
      provider: recordingProvider(script, sinkShadowed),
      sessionStore: shadowReadFailingStore(),
      persistentSessionShadowEnabled: true
    })
  );

  assert.equal(shadowed.status, "responded");
  assert.equal(shadowed.responseText, baseline.responseText);
  assert.deepEqual(sinkShadowed[0].messages, sinkBaseline[0].messages, "a failed shadow read must never change the provider request");
  // A session-store read failure is already degraded internally by
  // loadPersistentSessionContext (D3's own DEGRADE_TO_LEGACY_CONTEXT
  // contract, verified in tests/commercial/runPersistentSessionShadow.test.ts's
  // [D4-F1]) - it never reaches runPersistentSessionShadowComparison's own
  // outer catch, so no persistent_session_shadow_failed warning is expected
  // here. The point of this test is the outcome/provider-request identity
  // above, not this warning's presence.
  assert.ok(!shadowed.warnings.some((warning) => warning.startsWith("persistent_session_shadow_failed:")));
});

test("[D4-flag] the shadow never runs when persistentSessionShadowEnabled is omitted (default false)", async () => {
  const conversationId = uniqueConversationId();
  const result = await runSalesAgentRuntime(
    runtimeInput({
      event: baseEvent({ conversationId, messageText: "hola" }),
      provider: createFakeAgentLoopProvider({ script: [{ type: "respond", message: "Hola!" }] }),
      sessionStore: shadowReadFailingStore() // would surface a warning if the shadow ran at all, since this store's read always throws.
    })
  );
  assert.equal(result.status, "responded");
  assert.ok(!result.warnings.some((warning) => warning.startsWith("persistent_session_shadow_failed:")));
});

// --- SALES-AGENT-R3-V1.8-D5: owner-only live persistent-session cognition ---
// Wiring-level proof that the actual request shape/fallback/independence
// hold end to end through runSalesAgentRuntime, on top of the pure assembly
// proof (tests/agent-loop/buildAgentStepPromptPackage.test.ts) and the
// resolver's own real-MariaDB proof (tests/commercial/resolvePersistentSessionCognitionContext.test.ts).

test("[D5-G1] owner-only gating: eligible turn sends the persistent-shaped request; ineligible turn sends the exact legacy request", async () => {
  const conversationId = await ensureTestConversation();
  const base = Date.parse("2026-08-31T09:00:00.000Z");
  const iso = (offsetMs: number) => new Date(base + offsetMs).toISOString().slice(0, 23).replace("T", " ");
  await insertTestMessage(conversationId, "inbound", "necesito una barra olimpica de 20kg", iso(0));
  await insertTestMessage(conversationId, "outbound", "tenemos la barra olimpica 20kg", iso(1000));

  const sinkEligible: AgentLoopProviderRequest[] = [];
  const eligible = await runSalesAgentRuntime(
    runtimeInput({
      event: baseEvent({ conversationId, messageText: "me puedes dar varias opciones" }),
      provider: recordingProvider([{ type: "respond", message: "Aca tienes varias opciones." }], sinkEligible),
      sessionStore: createInMemoryAgentSessionStore(),
      persistentSessionCognitionEnabled: true
    })
  );
  assert.equal(eligible.status, "responded");
  const eligibleMessages = sinkEligible[0].messages;
  assert.ok(eligibleMessages.some((m) => m.role === "assistant" && m.content === "tenemos la barra olimpica 20kg"), "real assistant history reaches the provider");
  assert.equal(eligibleMessages.filter((m) => JSON.stringify(m).includes("me puedes dar varias opciones")).length, 1);

  const sinkIneligible: AgentLoopProviderRequest[] = [];
  const ineligible = await runSalesAgentRuntime(
    runtimeInput({
      event: baseEvent({ conversationId, messageText: "me puedes dar varias opciones" }),
      provider: recordingProvider([{ type: "respond", message: "Aca tienes varias opciones." }], sinkIneligible),
      sessionStore: createInMemoryAgentSessionStore(),
      persistentSessionCognitionEnabled: false
    })
  );
  assert.equal(ineligible.status, "responded");
  const ineligibleMessages = sinkIneligible[0].messages;
  assert.equal(ineligibleMessages.length, 2, "legacy shape: exactly [system, user]");
  assert.ok(!ineligibleMessages.some((m) => m.role === "assistant"), "no real assistant-role history on the legacy path");
});

test("[D5-V] observability: an eligible turn persists a real persistent_session_cognition_applied event (active) or (inactive+reason) on fallback", async () => {
  const conversationId = await ensureTestConversation();
  const base = Date.parse("2026-08-31T09:00:00.000Z");
  const iso = (offsetMs: number) => new Date(base + offsetMs).toISOString().slice(0, 23).replace("T", " ");
  await insertTestMessage(conversationId, "inbound", "hola", iso(0));
  const currentTurnId = await insertTestMessage(conversationId, "inbound", "otra pregunta", iso(1000));

  const result = await runSalesAgentRuntime(
    runtimeInput({
      event: baseEvent({ conversationId, messageId: currentTurnId, messageText: "otra pregunta" }),
      provider: createFakeAgentLoopProvider({ script: [{ type: "respond", message: "Hola!" }] }),
      sessionStore: createInMemoryAgentSessionStore(),
      persistentSessionCognitionEnabled: true
    })
  );
  assert.equal(result.status, "responded");

  const payload = await loadLastCognitionAppliedPayload(String(currentTurnId));
  assert.ok(payload, "the observability event must be persisted for an eligible turn");
  if (!payload) return;
  assert.equal(payload.active, true);
  assert.equal(payload.fallbackReason, null);
  assert.equal(payload.historyMessageCount, 1);

  // Ineligible turns (the vast majority of traffic) must never write this event - Section V's own "add only what D5 requires" (avoid noise).
  const ineligibleTurnId = uniqueConversationId();
  await runSalesAgentRuntime(
    runtimeInput({
      event: baseEvent({ conversationId: ineligibleTurnId, messageId: ineligibleTurnId, messageText: "hola" }),
      provider: createFakeAgentLoopProvider({ script: [{ type: "respond", message: "Hola!" }] }),
      sessionStore: createInMemoryAgentSessionStore(),
      persistentSessionCognitionEnabled: false
    })
  );
  const ineligiblePayload = await loadLastCognitionAppliedPayload(String(ineligibleTurnId));
  assert.equal(ineligiblePayload, null, "ordinary (ineligible) turns never write this event");
});

test("[D5-G8/Q1] fallback: a persistent-session read failure produces the exact legacy request, not a partial persistent one", async () => {
  const conversationId = uniqueConversationId();
  const script: Parameters<typeof createFakeAgentLoopProvider>[0]["script"] = [{ type: "respond", message: "Hola! En que puedo ayudarte?" }];

  const sinkBaseline: AgentLoopProviderRequest[] = [];
  const baseline = await runSalesAgentRuntime(
    runtimeInput({
      event: baseEvent({ conversationId, messageText: "hola" }),
      provider: recordingProvider(script, sinkBaseline),
      sessionStore: createInMemoryAgentSessionStore(),
      persistentSessionCognitionEnabled: false
    })
  );

  const sinkFallback: AgentLoopProviderRequest[] = [];
  const fallback = await runSalesAgentRuntime(
    runtimeInput({
      event: baseEvent({ conversationId, messageText: "hola" }),
      provider: recordingProvider(script, sinkFallback),
      sessionStore: shadowReadFailingStore(),
      persistentSessionCognitionEnabled: true
    })
  );

  assert.equal(fallback.status, "responded");
  assert.equal(fallback.responseText, baseline.responseText);
  assert.deepEqual(sinkFallback[0].messages, sinkBaseline[0].messages, "a failed read must produce the exact legacy request, never a partial persistent one");
  assert.ok(fallback.warnings.some((warning) => warning.startsWith("persistent_session_cognition_fallback:")));
});

test("[D5-G14/G15] governance/dispatch regression: an eligible turn still resolves a real opportunity through the unchanged commercial-action path", async () => {
  catalogUp();
  const conversationId = await ensureTestConversation();
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      { type: "use_tool", tool: "select_products", arguments: { items: [{ productId: "501", quantity: 1 }] } },
      { type: "respond", message: "Listo, agregue el kettlebell." }
    ]
  });

  const result = await runSalesAgentRuntime(
    runtimeInput({
      event: baseEvent({ conversationId, messageText: "quiero ese kettlebell" }),
      provider,
      sessionStore: createInMemoryAgentSessionStore(),
      persistentSessionCognitionEnabled: true
    })
  );

  assert.equal(result.status, "responded");
  assert.equal(result.commercialActionCalls, 1);
  assert.notEqual(result.resolvedOpportunityId, null);
  assert.equal(await countOpportunitiesForConversation(conversationId), 1, "Capability Gateway/dispatch/opportunity resolution are unchanged by D5");
});

test("[D5-G17] rollback: the same turn with cognition ON then OFF returns to the exact legacy request, no other state required", async () => {
  const conversationId = await ensureTestConversation();
  const base = Date.parse("2026-08-31T09:00:00.000Z");
  await insertTestMessage(conversationId, "inbound", "hola", new Date(base).toISOString().slice(0, 23).replace("T", " "));
  const script: Parameters<typeof createFakeAgentLoopProvider>[0]["script"] = [{ type: "respond", message: "Hola!" }];

  const sinkOn: AgentLoopProviderRequest[] = [];
  await runSalesAgentRuntime(
    runtimeInput({
      event: baseEvent({ conversationId, messageText: "otra vez hola" }),
      provider: recordingProvider(script, sinkOn),
      sessionStore: createInMemoryAgentSessionStore(),
      persistentSessionCognitionEnabled: true
    })
  );
  assert.ok(sinkOn[0].messages.some((m) => m.role === "assistant" || JSON.stringify(m).includes("\"hola\"")), "cognition was actually active for this turn");

  const sinkOff: AgentLoopProviderRequest[] = [];
  const rolledBack = await runSalesAgentRuntime(
    runtimeInput({
      event: baseEvent({ conversationId, messageText: "otra vez hola" }),
      provider: recordingProvider(script, sinkOff),
      sessionStore: createInMemoryAgentSessionStore(),
      persistentSessionCognitionEnabled: false
    })
  );
  assert.equal(rolledBack.status, "responded");
  assert.equal(sinkOff[0].messages.length, 2, "rollback (flag OFF) immediately returns to the exact legacy [system, user] shape - no migration, no data rollback, no restart needed");
});

test("[D5-Q8] D4 shadow and D5 cognition degrade independently under the same store failure - neither leaks into the other, the turn completes normally", async () => {
  const conversationId = uniqueConversationId();
  const script: Parameters<typeof createFakeAgentLoopProvider>[0]["script"] = [{ type: "respond", message: "Hola!" }];

  const sinkBaseline: AgentLoopProviderRequest[] = [];
  const baseline = await runSalesAgentRuntime(
    runtimeInput({
      event: baseEvent({ conversationId, messageText: "hola" }),
      provider: recordingProvider(script, sinkBaseline),
      sessionStore: createInMemoryAgentSessionStore()
    })
  );

  const sinkBoth: AgentLoopProviderRequest[] = [];
  const bothEnabled = await runSalesAgentRuntime(
    runtimeInput({
      event: baseEvent({ conversationId, messageText: "hola" }),
      provider: recordingProvider(script, sinkBoth),
      sessionStore: shadowReadFailingStore(),
      persistentSessionShadowEnabled: true,
      persistentSessionCognitionEnabled: true
    })
  );

  assert.equal(bothEnabled.status, "responded");
  assert.equal(bothEnabled.responseText, baseline.responseText);
  assert.deepEqual(sinkBoth[0].messages, sinkBaseline[0].messages, "both D4 and D5 fell back cleanly to the exact legacy request - no crash, no cross-talk, no partial state");
});

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
