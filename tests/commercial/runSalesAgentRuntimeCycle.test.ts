import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import { getPool, safeQueryRows } from "@/lib/db";
import { runSalesAgentRuntimeCycle } from "@/lib/brain/commercial/sales-agent-runtime";
import { createFakeAgentLoopProvider } from "@/lib/brain/commercial/agent-loop/providers/fakeAgentLoopProvider";
import type { AgentLoopProvider } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";
import { resetCapabilityGatewayCatalogPortForTests } from "@/lib/brain/commercial/capability-gateway/registry";
import { loadRecentCatalogContext } from "@/lib/brain/commercial/agent-loop/recentCatalogContext";
import { loadPendingCatalogAction } from "@/lib/brain/commercial/agent-loop/pendingCatalogAction";
import type { CommercialContextSnapshot } from "@/lib/brain/commercial/context/buildNativeCommercialContext";
import {
  SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_CONFIGURATION_SCOPE,
  SALES_AGENT_FOLLOW_UP_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT,
  type ResolvedSalesAgentConfiguration
} from "@/lib/brain/commercial/sales-agent-configuration";

/**
 * SALES-AGENT-R3-V1.4. Covers the routing seam's own dispatch adapter
 * (runSalesAgentRuntimeCycle) - never re-proves what V1.3's own
 * tests/commercial/salesAgentRuntime.test.ts already covers at the
 * runtime-boundary level (dynamic tool sequencing, identity gate, budgets,
 * idempotency). Same local dev DB credentials that file already
 * establishes - node:test loads a batch of files into one process, so
 * whichever file sets these first wins for the batch.
 */
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

async function withEnv<T>(overrides: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const previous = { ...process.env };
  Object.assign(process.env, overrides);
  try {
    return await fn();
  } finally {
    process.env = previous;
  }
}

const DISPATCH_ENABLED_ENV = {
  BRAIN_AGENT_ACTION_QUEUE_ENABLED: "true",
  BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED: "true",
  BRAIN_EXECUTION_GATE_ENABLED: "true",
  BRAIN_OUTBOX_BRIDGE_ENABLED: "true",
  BRAIN_AUTONOMOUS_SANDBOX_ENABLED: "true",
  BRAIN_AUTONOMOUS_REPLY_ENABLED: "true"
};

/**
 * SALES-AGENT-R3-V1.5. A terminalReason "responded" turn no longer goes
 * through the R1 bridge flags above (dispatchSalesAgentResponse.ts's own
 * "no false dependency" contract) - only BRAIN_AUTONOMOUS_RESPONSES_ENABLED
 * (the R3 top-level autonomous-response killswitch) governs it. Kept as a
 * separate constant (not folded into DISPATCH_ENABLED_ENV) so a test that
 * asserts R1 flags are irrelevant to a "responded" turn can prove it by
 * omitting DISPATCH_ENABLED_ENV entirely.
 */
const RESPONSE_DISPATCH_ENABLED_ENV = { BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true" };

/**
 * crm_capability_executions.conversation_id carries a real FOREIGN KEY onto
 * conversation(id) (migration 022) - an arbitrary Date.now()-based fake id
 * (the pattern several sibling test files use for tables with no such FK)
 * makes every capability-execution insert fail silently (insertCapabilityExecution
 * uses safeExecute, never throws) while the tool call itself still succeeds,
 * which would make RecentCatalogContext continuity untestable. A minimal
 * real row, same INSERT shape work/benchmark/environment.ts#seedConversation
 * already establishes for the same reason.
 */
async function insertConversation(): Promise<number> {
  const [result] = await getPool().execute(
    `INSERT INTO conversation (public_id, channel, provider, channel_account_id, external_contact_id, status, owner_type, ai_enabled, human_owner_active)
     VALUES (?, 'whatsapp', 'meta', ?, ?, 'open', 'ai_sdr', 1, 0)`,
    [randomUUID(), `phone-${randomUUID()}`, "56900001111"]
  );
  return Number((result as { insertId: number }).insertId);
}

function buildSnapshot(overrides: Partial<CommercialContextSnapshot> = {}, signalOverrides: Partial<CommercialContextSnapshot["signals"]> = {}): CommercialContextSnapshot {
  return {
    contractName: "CommercialContext",
    schemaVersion: "1.0",
    status: "success",
    completeness: "minimal",
    customer: null,
    conversation: { id: "1", publicId: "conv-public-1", channel: "whatsapp", provider: "meta", externalContactId: "56900001111", status: "open", aiEnabled: true, humanOwnerActive: false, lastMessageAt: null },
    recentMessages: [],
    opportunity: null,
    needProfile: null,
    actions: [],
    signals: {
      hasCustomer: false,
      hasOpportunity: false,
      hasNeedProfile: false,
      hasRecentMessages: false,
      humanOwnerActive: false,
      aiBlocked: false,
      staleContext: false,
      identityConflict: false,
      ...signalOverrides
    },
    identityConflict: null,
    shippingDestination: null,
    commercialLineItems: null,
    availableCapabilities: [],
    warnings: [],
    customer360: null,
    customer360State: "not_requested",
    customerSession: null,
    metadata: { source: "native_mariadb", conversationPublicId: "conv-public-1", currentTime: "2026-08-31T15:00:00.000Z" },
    ...overrides
  };
}

function buildResolvedConfig(overrides: Partial<ResolvedSalesAgentConfiguration> = {}): ResolvedSalesAgentConfiguration {
  return {
    source: "safe_default",
    scopeKey: SALES_AGENT_CONFIGURATION_SCOPE,
    recordId: null,
    version: null,
    configurationHash: null,
    configuration: SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
    effectiveModelConfiguration: SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT,
    effectiveLoopConfiguration: SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT,
    effectiveFollowUpConfiguration: SALES_AGENT_FOLLOW_UP_CONFIGURATION_SAFE_DEFAULT,
    ...overrides
  };
}

function baseInput(conversationId: number) {
  return {
    conversationId,
    conversationPublicId: `conv-public-${conversationId}`,
    customerMasterId: null,
    waId: "56900001111",
    phoneNumberId: "phone-1",
    messageId: `wamid.test.${conversationId}`,
    inboundMessageId: `wamid.test.${conversationId}`,
    correlationId: `corr-${conversationId}`,
    currentTime: "2026-08-31T15:00:00.000Z",
    customerMessage: "que kettlebells tienen?",
    abortSignal: null,
    resolvedSalesAgentConfiguration: buildResolvedConfig()
  };
}

async function loadAgentToolLoopPayload(inboundMessageId: string) {
  const rows = await safeQueryRows<{ payload_json: string }>(
    "SELECT payload_json FROM commercial_event WHERE event_type = 'agent_tool_loop_completed' AND source_event_id = ? LIMIT 1",
    [inboundMessageId]
  );
  assert.ok(rows.ok, rows.ok ? "" : rows.error);
  return JSON.parse(rows.rows[0]?.payload_json ?? "{}") as Record<string, unknown>;
}

async function countAgentToolLoopCompletedEvents(inboundMessageId: string) {
  const rows = await safeQueryRows<{ count: number | string | bigint }>(
    "SELECT COUNT(*) AS count FROM commercial_event WHERE event_type = 'agent_tool_loop_completed' AND source_event_id = ?",
    [inboundMessageId]
  );
  assert.ok(rows.ok, rows.ok ? "" : rows.error);
  return Number(rows.rows[0]?.count ?? 0);
}

async function countOpportunitiesForConversation(conversationId: number) {
  const [rows] = await getPool().execute("SELECT id FROM crm_opportunities WHERE conversation_case_id = ?", [String(conversationId)]);
  return (rows as unknown[]).length;
}

/** SALES-AGENT-R3-V1.5. A "responded" turn no longer creates a crm_agent_actions row at all - see dispatchSalesAgentResponse.ts. */
async function countAgentActionsForConversation(conversationId: number) {
  const [rows] = await getPool().execute("SELECT id FROM crm_agent_actions WHERE conversation_case_id = ?", [String(conversationId)]);
  return (rows as unknown[]).length;
}

function salesAgentR3DedupeKey(conversationId: number, inboundMessageId: string) {
  return `sales-agent-r3:${conversationId}:${inboundMessageId}:responded`;
}

async function loadOutboxRowByDedupeKey(dedupeKey: string) {
  const [rows] = await getPool().execute("SELECT id, wa_id, conversation_case_id, message_text, status, meta_payload_json FROM brain_message_outbox WHERE dedupe_key = ? LIMIT 1", [dedupeKey]);
  const row = (rows as Record<string, unknown>[])[0];
  if (!row) return null;
  const rawMeta = row.meta_payload_json;
  const meta = typeof rawMeta === "string" ? JSON.parse(rawMeta) : (rawMeta as Record<string, unknown> | null);
  return { ...row, meta_payload_json: meta } as {
    id: number;
    wa_id: string | null;
    conversation_case_id: number | string | null;
    message_text: string | null;
    status: string;
    meta_payload_json: Record<string, unknown> | null;
  };
}

function unreachableProvider(): AgentLoopProvider {
  return {
    name: "unreachable-test-provider",
    async invoke() {
      throw new Error("provider must not be invoked for this scenario");
    }
  };
}

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
let server: http.Server;
let handler: Handler = (_req, res) => res.writeHead(500).end();

before(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address() as AddressInfo;
  process.env.CATALOG_SERVICE_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.CATALOG_SERVICE_API_KEY = "test-key";
  resetCapabilityGatewayCatalogPortForTests();
});

after(async () => {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
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

function catalogUp() {
  handler = (req, res) => {
    if (req.url === "/api/v2/catalog/resolve-product-intent" && req.method === "POST") {
      return sendJson(res, 200, {
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
      });
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

test("[RC1] responded: dispatches through the canonical outbox exactly once, event carries the real (non-fabricated) resolved configuration", async () => {
  catalogUp();
  const conversationId = await insertConversation();
  const input = baseInput(conversationId);
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell" } },
      { type: "respond", message: "Tenemos el Kettlebell 16kg disponible." }
    ]
  });

  await withEnv(RESPONSE_DISPATCH_ENABLED_ENV, async () => {
    const result = await runSalesAgentRuntimeCycle({ ...input, snapshot: buildSnapshot(), provider });

    assert.equal(result.runtime.status, "responded");
    assert.equal(result.dispatch.outboxWritten, true);
    assert.equal(result.dispatch.messageSent, "Tenemos el Kettlebell 16kg disponible.");

    // SALES-AGENT-R3-V1.5: a "responded" turn dispatches straight to the
    // canonical outbox via dispatchSalesAgentResponse.ts - no crm_agent_actions
    // row is ever created for it (requirement B of the V1.5 task).
    assert.equal(await countAgentActionsForConversation(conversationId), 0, "no crm_agent_actions row for a responded turn");
    const outboxRow = await loadOutboxRowByDedupeKey(salesAgentR3DedupeKey(conversationId, input.inboundMessageId));
    assert.ok(outboxRow, "exactly one canonical outbox row for this inbound message");
    assert.equal(outboxRow!.status, "planned");
    assert.equal(outboxRow!.message_text, "Tenemos el Kettlebell 16kg disponible.");

    const payload = await loadAgentToolLoopPayload(input.inboundMessageId);
    assert.equal(payload.configurationSource, "safe_default");
    assert.equal(payload.effectiveModel, SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT.model);
    assert.equal(payload.effectiveTemperature, SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT.temperature);
    assert.equal(payload.terminalReason, "responded");
    assert.equal(payload.toolExecutionCount, 1);
    // Honest, never guessed - see runSalesAgentRuntimeCycle.ts's own comment.
    assert.deepEqual(payload.toolsUsed, []);
    assert.deepEqual(payload.stepsSummary, []);
  });
});

test("[RC2] governance blocked (human owner active): zero dispatch, zero commercial_event, model never invoked", async () => {
  const conversationId = await insertConversation();
  const input = baseInput(conversationId);
  const provider = unreachableProvider();

  await withEnv(DISPATCH_ENABLED_ENV, async () => {
    const result = await runSalesAgentRuntimeCycle({
      ...input,
      snapshot: buildSnapshot({}, { humanOwnerActive: true }),
      provider
    });

    assert.equal(result.runtime.status, "blocked");
    assert.equal(result.dispatch.attempted, false);
    assert.equal(result.dispatch.outboxWritten, false);
    assert.equal(await countAgentToolLoopCompletedEvents(input.inboundMessageId), 0);
  });
});

test("[RC3] ambiguous handoff: routed to the R3-native fallback dispatcher, never a fabricated business response, ownership stays AI", async () => {
  // SALES-AGENT-R3-V1.6: this free-text reason ("needs_human_pricing_negotiation")
  // does not match the minimal hard-handoff eligible reason-code vocabulary
  // (dispatchSalesAgentHardHandoff.ts) - it is ordinary model-uncertainty
  // language, exactly the case this task requires to fail safe toward
  // NON-HANDOFF. No more R1 bridge flags for this path (see RESPONSE_DISPATCH_ENABLED_ENV).
  const conversationId = await insertConversation();
  const input = baseInput(conversationId);
  const provider = createFakeAgentLoopProvider({ script: [{ type: "handoff", reason: "needs_human_pricing_negotiation" }] });

  await withEnv(RESPONSE_DISPATCH_ENABLED_ENV, async () => {
    const result = await runSalesAgentRuntimeCycle({ ...input, snapshot: buildSnapshot(), provider });

    assert.equal(result.runtime.status, "handoff");
    assert.equal(result.runtime.responseText, null);
    assert.equal(result.dispatch.outboxWritten, true);
    assert.ok(result.dispatch.messageSent, "an ambiguous handoff still dispatches a neutral fallback, never silence");

    const conversationRow = (await getPool().execute("SELECT ai_enabled, human_owner_active FROM conversation WHERE id = ?", [conversationId]))[0] as Record<string, unknown>[];
    assert.equal(Number(conversationRow[0].ai_enabled), 1, "ambiguous handoff must never transfer ownership away from the AI");
    assert.equal(Number(conversationRow[0].human_owner_active), 0);

    const payload = await loadAgentToolLoopPayload(input.inboundMessageId);
    assert.equal(payload.terminalReason, "handoff");
    assert.equal(payload.handoffReasonPresent, true);
    assert.equal(payload.finalMessagePresent, false);
  });
});

test("[RC3b] eligible hard handoff: durable ownership transfer, exactly one acknowledgement, AI disabled afterward", async () => {
  const conversationId = await insertConversation();
  const input = baseInput(conversationId);
  const provider = createFakeAgentLoopProvider({ script: [{ type: "handoff", reason: "customer_requested_human" }] });

  await withEnv(RESPONSE_DISPATCH_ENABLED_ENV, async () => {
    const result = await runSalesAgentRuntimeCycle({ ...input, snapshot: buildSnapshot(), provider });

    assert.equal(result.runtime.status, "handoff");
    assert.equal(result.dispatch.outboxWritten, true);
    assert.ok(result.dispatch.messageSent);

    const conversationRow = (await getPool().execute("SELECT ai_enabled, human_owner_active FROM conversation WHERE id = ?", [conversationId]))[0] as Record<string, unknown>[];
    assert.equal(Number(conversationRow[0].ai_enabled), 0, "an eligible hard handoff must disable the AI");
    assert.equal(Number(conversationRow[0].human_owner_active), 1, "an eligible hard handoff must durably transfer ownership to a human");

    const outboxRows = (await getPool().execute("SELECT id FROM brain_message_outbox WHERE dedupe_key = ?", [`sales-agent-r3:${conversationId}:${input.inboundMessageId}:handoff`]))[0] as unknown[];
    assert.equal(outboxRows.length, 1, "exactly one acknowledgement row");

    assert.equal(await countAgentActionsForConversation(conversationId), 0, "no crm_agent_actions row for a hard handoff");
  });
});

test("[RC4] provider failure: a structured fallback is dispatched, never a fabricated business response, ownership stays AI", async () => {
  const conversationId = await insertConversation();
  const input = baseInput(conversationId);
  const provider: AgentLoopProvider = {
    name: "throwing-test-provider",
    async invoke() {
      throw new Error("simulated network failure");
    }
  };

  await withEnv(RESPONSE_DISPATCH_ENABLED_ENV, async () => {
    const result = await runSalesAgentRuntimeCycle({ ...input, snapshot: buildSnapshot(), provider });

    assert.equal(result.runtime.status, "failed");
    assert.equal(result.runtime.responseText, null);
    assert.equal(result.dispatch.outboxWritten, true, "a technical failure still owes the customer a neutral fallback message");
    assert.equal(await countAgentActionsForConversation(conversationId), 0, "no crm_agent_actions row for a technical-failure fallback");

    const conversationRow = (await getPool().execute("SELECT ai_enabled, human_owner_active FROM conversation WHERE id = ?", [conversationId]))[0] as Record<string, unknown>[];
    assert.equal(Number(conversationRow[0].ai_enabled), 1, "a technical failure must never transfer ownership away from the AI");

    const payload = await loadAgentToolLoopPayload(input.inboundMessageId);
    assert.equal(payload.terminalReason, "provider_unavailable");
  });
});

test("[RC9] all six R1 bridge flags false: every SalesAgentRuntime terminal outcome still dispatches on R3's own flags alone", async () => {
  const flagsFalse = {
    BRAIN_AGENT_ACTION_QUEUE_ENABLED: "false",
    BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED: "false",
    BRAIN_EXECUTION_GATE_ENABLED: "false",
    BRAIN_OUTBOX_BRIDGE_ENABLED: "false",
    BRAIN_AUTONOMOUS_SANDBOX_ENABLED: "false",
    BRAIN_AUTONOMOUS_REPLY_ENABLED: "false",
    ...RESPONSE_DISPATCH_ENABLED_ENV
  };

  const conversationIdFailure = await insertConversation();
  const inputFailure = baseInput(conversationIdFailure);
  const providerFailure: AgentLoopProvider = {
    name: "throwing-test-provider",
    async invoke() {
      throw new Error("simulated network failure");
    }
  };
  await withEnv(flagsFalse, async () => {
    const result = await runSalesAgentRuntimeCycle({ ...inputFailure, snapshot: buildSnapshot(), provider: providerFailure });
    assert.equal(result.runtime.status, "failed");
    assert.equal(result.dispatch.outboxWritten, true);
    assert.equal(await countAgentActionsForConversation(conversationIdFailure), 0);
  });

  const conversationIdHandoff = await insertConversation();
  const inputHandoff = baseInput(conversationIdHandoff);
  const providerHandoff = createFakeAgentLoopProvider({ script: [{ type: "handoff", reason: "policy_requires_human" }] });
  await withEnv(flagsFalse, async () => {
    const result = await runSalesAgentRuntimeCycle({ ...inputHandoff, snapshot: buildSnapshot(), provider: providerHandoff });
    assert.equal(result.dispatch.outboxWritten, true);
    const conversationRow = (await getPool().execute("SELECT ai_enabled FROM conversation WHERE id = ?", [conversationIdHandoff]))[0] as Record<string, unknown>[];
    assert.equal(Number(conversationRow[0].ai_enabled), 0, "hard handoff ownership transfer must not depend on any R1 bridge flag");
    assert.equal(await countAgentActionsForConversation(conversationIdHandoff), 0);
  });
});

test("[RC5] resolvedOpportunityId propagates to the dispatched action and to the recorded commercial_event", async () => {
  catalogUp();
  const conversationId = await insertConversation();
  const input = baseInput(conversationId);
  const provider = createFakeAgentLoopProvider({
    script: [
      // select_products requires this-turn evidence (get_product_details/
      // search_products) for the productId it selects - same evidence-gate
      // discipline pendingCatalogAction uses (see RC7's own comment) -
      // mirrors tests/commercial/salesAgentRuntime.test.ts's own working
      // "commercial action" scenario.
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      { type: "use_tool", tool: "select_products", arguments: { items: [{ productId: "501", quantity: 1 }] } },
      { type: "respond", message: "Listo, agregue el kettlebell." }
    ]
  });

  await withEnv({ ...RESPONSE_DISPATCH_ENABLED_ENV, BRAIN_AUTONOMOUS_TEST_WA_IDS: input.waId }, async () => {
    const result = await runSalesAgentRuntimeCycle({ ...input, snapshot: buildSnapshot(), provider });

    assert.equal(result.runtime.status, "responded");
    assert.notEqual(result.runtime.resolvedOpportunityId, null);
    assert.equal(await countOpportunitiesForConversation(conversationId), 1);

    const outboxRow = await loadOutboxRowByDedupeKey(salesAgentR3DedupeKey(conversationId, input.inboundMessageId));
    assert.ok(outboxRow, "exactly one canonical outbox row for this inbound message");
    assert.equal(Number(outboxRow!.meta_payload_json?.opportunity_id), result.runtime.resolvedOpportunityId);

    const payload = await loadAgentToolLoopPayload(input.inboundMessageId);
    const eventRow = await safeQueryRows<{ opportunity_id: number | string | null }>(
      "SELECT opportunity_id FROM commercial_event WHERE event_type = 'agent_tool_loop_completed' AND source_event_id = ? LIMIT 1",
      [input.inboundMessageId]
    );
    assert.ok(eventRow.ok);
    assert.equal(Number(eventRow.rows[0]?.opportunity_id), result.runtime.resolvedOpportunityId);
    assert.equal(payload.toolExecutionCount, 2);
  });
});

test("[RC6] RecentCatalogContext continuity: a search_products turn is durably visible for the SAME conversation's next turn (V1.3's documented gap, now closed)", async () => {
  catalogUp();
  const conversationId = await insertConversation();
  const input = baseInput(conversationId);
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell" } },
      { type: "respond", message: "Tenemos el Kettlebell 16kg disponible." }
    ]
  });

  await withEnv(DISPATCH_ENABLED_ENV, async () => {
    await runSalesAgentRuntimeCycle({ ...input, snapshot: buildSnapshot(), provider });

    // crm_capability_executions.completed_at is stamped with the real wall
    // clock (executeCapability.ts's own nowIso()), never the fixture
    // currentTime this test passes to the runtime for business logic - the
    // query window below must anchor on the real clock too, or a fixture
    // date far from "now" would exclude the row it just wrote.
    const loaded = await loadRecentCatalogContext({ conversationId, currentTime: new Date().toISOString() });
    assert.equal(loaded.context.interactions.length, 1, "the search_products execution must correlate back to this inboundMessageId via the same correlationId");
    assert.equal(loaded.context.interactions[0].sourceTool, "search_products");
    assert.equal(loaded.context.interactions[0].products[0].productId, "501");
  });
});

test("[RC7] pendingCatalogAction is persisted only when dispatch actually writes the outbox", async () => {
  // pendingCatalogAction only survives normalizePendingCatalogActionForEvidence's
  // evidence-gate (agent-loop/pendingCatalogAction.ts) when the offered
  // productId was actually observed this turn or via recentCatalogContext -
  // same real invariant RC5 hit for select_products.
  const catalogEvidence = {
    interactions: [{ inboundMessageId: "catalog-msg", completedAt: "2026-08-31T14:59:00.000Z", sourceTool: "search_products" as const, products: [{ position: 1, productId: "501", name: "Kettlebell" }] }]
  };

  const conversationIdNoOutbox = await insertConversation();
  const inputNoOutbox = baseInput(conversationIdNoOutbox);
  const providerNoOutbox = createFakeAgentLoopProvider({
    script: [{ type: "respond", message: "Te envio el link?", pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"] } }]
  });

  await withEnv(
    { BRAIN_AGENT_ACTION_QUEUE_ENABLED: "false", BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED: "false", BRAIN_EXECUTION_GATE_ENABLED: "false", BRAIN_OUTBOX_BRIDGE_ENABLED: "false" },
    async () => {
      const result = await runSalesAgentRuntimeCycle({ ...inputNoOutbox, snapshot: buildSnapshot(), provider: providerNoOutbox, recentCatalogContext: catalogEvidence });
      assert.equal(result.dispatch.outboxWritten, false);
      const loaded = await loadPendingCatalogAction({ conversationId: conversationIdNoOutbox });
      assert.equal(loaded.pendingCatalogAction, null);
    }
  );

  const conversationIdWithOutbox = await insertConversation();
  const inputWithOutbox = baseInput(conversationIdWithOutbox);
  const providerWithOutbox = createFakeAgentLoopProvider({
    script: [{ type: "respond", message: "Te envio el link?", pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"] } }]
  });

  await withEnv(RESPONSE_DISPATCH_ENABLED_ENV, async () => {
    const result = await runSalesAgentRuntimeCycle({ ...inputWithOutbox, snapshot: buildSnapshot(), provider: providerWithOutbox, recentCatalogContext: catalogEvidence });
    assert.equal(result.dispatch.outboxWritten, true);
    const loaded = await loadPendingCatalogAction({ conversationId: conversationIdWithOutbox });
    assert.deepEqual(loaded.pendingCatalogAction, { actionType: "send_product_link", candidateProductIds: ["501"] });
  });
});

test("[RC8] R3 pilot hotfix: an 8/8 effective loop configuration really reaches SalesAgentRuntime and is honored (not silently capped at the old 3/2 safe default)", async () => {
  catalogUp();
  const conversationId = await insertConversation();
  const input = baseInput(conversationId);
  const script: unknown[] = [];
  for (let index = 1; index <= 8; index += 1) {
    script.push({ type: "use_tool", tool: "search_products", arguments: { query: `kettlebell-${index}` } });
  }
  script.push({ type: "respond", message: "Listo, revise varias opciones." });
  const provider = createFakeAgentLoopProvider({ script });

  await withEnv(DISPATCH_ENABLED_ENV, async () => {
    const result = await runSalesAgentRuntimeCycle({
      ...input,
      snapshot: buildSnapshot(),
      provider,
      resolvedSalesAgentConfiguration: buildResolvedConfig({ effectiveLoopConfiguration: { maxAgentStepsPerTurn: 8, maxToolCallsPerTurn: 8 } })
    });

    assert.equal(result.runtime.status, "responded");
    assert.equal(result.runtime.toolCalls, 8, "all 8 distinct tool calls must complete within the 8/8 budget, never truncated at the old default of 2");
    assert.equal(result.runtime.modelSteps, 9, "8 gathering decisions + 1 finalization respond");
  });
});
