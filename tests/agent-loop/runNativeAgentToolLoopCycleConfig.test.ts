import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after } from "node:test";
import { getPool, safeQueryRows } from "@/lib/db";
import { loadPendingCatalogAction } from "@/lib/brain/commercial/agent-loop/pendingCatalogAction";
import { runNativeAgentToolLoopCycle } from "@/lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle";
import { createFakeAgentLoopProvider } from "@/lib/brain/commercial/agent-loop/providers/fakeAgentLoopProvider";
import { resetCapabilityGatewayCatalogPortForTests } from "@/lib/brain/commercial/capability-gateway/registry";
import type { AgentLoopProvider, AgentLoopProviderRequest } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";
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
 * ACS-R1-05.1-T02.3B wiring tests: prove runNativeAgentToolLoopCycle
 * actually forwards resolvedSalesAgentConfiguration into the real loop
 * (never a routing decision made by this test itself) - no DB and no
 * registered Capability Gateway tool needed, since these specifically
 * target the loop's own decision/tool BUDGET wiring (structural: how many
 * gathering steps happen, not whether an individual tool call succeeds -
 * that mechanism is already covered by tests/agent-loop/runAgentToolLoop.test.ts).
 */

function buildSnapshot(signalOverrides: Partial<CommercialContextSnapshot["signals"]> = {}): CommercialContextSnapshot {
  return {
    contractName: "CommercialContext",
    schemaVersion: "1.0",
    status: "success",
    completeness: "minimal",
    customer: null,
    conversation: null,
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
    availableCapabilities: [],
    warnings: [],
    customer360: null,
    customer360State: "not_requested",
    customerSession: null,
    metadata: {
      source: "native_mariadb",
      conversationPublicId: "test-conv",
      currentTime: "2026-07-22T15:00:00.000Z"
    }
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

const baseInput = {
  conversationId: 1,
  waId: "56900000000",
  inboundMessageId: "msg-1",
  correlationId: "corr-1",
  currentTime: "2026-07-22T15:00:00.000Z",
  customerMessage: "hola, busco una jaula",
  abortSignal: null
};

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function withEnv<T>(overrides: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const previous = { ...process.env };
  Object.assign(process.env, overrides);
  try {
    return await fn();
  } finally {
    process.env = previous;
  }
}

const DB_ENV = {
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
};

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

async function countAgentToolLoopDispatchEffects(input: { conversationId: number; inboundMessageId: string; terminalReason?: string }) {
  const idempotencyKey = `agent-tool-loop:${input.conversationId}:${input.inboundMessageId}:${input.terminalReason ?? "responded"}`;
  const rows = await safeQueryRows<{ count: number | string | bigint }>(
    "SELECT COUNT(*) AS count FROM crm_agent_actions WHERE idempotency_key = ? AND action_type = 'send_whatsapp_reply'",
    [idempotencyKey]
  );
  assert.ok(rows.ok, rows.ok ? "" : rows.error);
  return Number(rows.rows[0]?.count ?? 0);
}

async function withCatalogDetailsServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith("/v1/products/501")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          product: { productId: 501, name: "Kettlebell", sku: "KB-16", shortDescription: "Kettlebell", longDescription: null, active: true },
          variants: [],
          selectedVariant: null,
          pricing: { effectiveUnitPrice: 29990, currency: "CLP", taxIncluded: true, discountApplied: false },
          stock: { available: true, physicalQuantity: 4 },
          publicLink: {
            canonicalUrl: "https://pesaschile.cl/productos/501-kettlebell",
            scope: "exact_product",
            available: true,
            requiresVariantSelection: false,
            variantAttributeLabels: []
          },
          freshness: { cached: false }
        })
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as AddressInfo;
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("[W1] effectiveLoopConfiguration.maxToolCallsPerTurn=0 controls the real loop - gathering never starts", async () => {
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "jaula" } },
      { type: "respond", message: "no puedo buscar ahora" }
    ]
  });
  const result = await runNativeAgentToolLoopCycle({
    ...baseInput,
    snapshot: buildSnapshot(),
    provider,
    resolvedSalesAgentConfiguration: buildResolvedConfig({
      effectiveLoopConfiguration: { maxAgentStepsPerTurn: 3, maxToolCallsPerTurn: 0 }
    })
  });
  const gatheringSteps = result.loop.steps.filter((step) => step.phase === "gathering");
  assert.equal(gatheringSteps.length, 0, "a zero tool-call budget must skip gathering entirely, straight to finalization");
  assert.equal(result.loop.toolExecutionCount, 0);
  assert.ok(result.loop.warnings.includes("agent_loop_finalization_entered"));
});

test("[W2] effectiveLoopConfiguration.maxAgentStepsPerTurn=1 controls the real loop - exactly one gathering decision", async () => {
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "jaula" } },
      { type: "respond", message: "resultado final" }
    ]
  });
  const result = await runNativeAgentToolLoopCycle({
    ...baseInput,
    snapshot: buildSnapshot(),
    provider,
    resolvedSalesAgentConfiguration: buildResolvedConfig({
      effectiveLoopConfiguration: { maxAgentStepsPerTurn: 1, maxToolCallsPerTurn: 2 }
    })
  });
  const gatheringSteps = result.loop.steps.filter((step) => step.phase === "gathering");
  assert.equal(gatheringSteps.length, 1, "the decision budget must cap gathering at exactly 1 step");
  assert.equal(result.loop.terminalReason, "responded");
});

test("[W3] a human-owned/AI-blocked conversation never reaches the model, regardless of configuration", async () => {
  const provider = createFakeAgentLoopProvider({ script: [{ type: "respond", message: "should never be called" }] });
  const result = await runNativeAgentToolLoopCycle({
    ...baseInput,
    snapshot: buildSnapshot({ humanOwnerActive: true }),
    provider,
    resolvedSalesAgentConfiguration: buildResolvedConfig()
  });
  assert.equal(result.loop.ran, false);
});

test("[W4] identityConfiguration reaches the real system prompt sent to the provider", async () => {
  const capturedRequests: AgentLoopProviderRequest[] = [];
  const capturingProvider: AgentLoopProvider = {
    name: "capturing-test-provider",
    async invoke(request) {
      capturedRequests.push(request);
      return { rawOutput: { type: "respond", message: "hola" } };
    }
  };

  await runNativeAgentToolLoopCycle({
    ...baseInput,
    snapshot: buildSnapshot(),
    provider: capturingProvider,
    resolvedSalesAgentConfiguration: buildResolvedConfig({
      configuration: {
        agentName: "Camila",
        companyName: "Tienda de Prueba",
        role: "Vendedora",
        companyDescription: "Vendemos articulos de prueba.",
        customInstructions: "",
        prohibitedPhrases: []
      }
    })
  });

  assert.ok(capturedRequests.length > 0, "the provider must have been invoked at least once");
  const systemMessage = capturedRequests[0].messages.find((message) => message.role === "system");
  assert.ok(systemMessage?.content.includes("Camila"));
  assert.ok(systemMessage?.content.includes("Tienda de Prueba"));
});

test("[W5] RecentCatalogContext reaches the provider separately and current inbound is not duplicated in recentMessages", async () => {
  const capturedRequests: AgentLoopProviderRequest[] = [];
  const capturingProvider: AgentLoopProvider = {
    name: "capturing-test-provider",
    async invoke(request) {
      capturedRequests.push(request);
      return { rawOutput: { type: "respond", message: "hola" } };
    }
  };

  const snapshot = buildSnapshot();
  snapshot.recentMessages = [
    { id: "older-1", direction: "agent", body: "Tenemos barras y discos.", status: "sent", occurredAt: "2026-07-22T14:59:00.000Z" },
    { id: "msg-1", direction: "inbound", body: baseInput.customerMessage, status: "received", occurredAt: "2026-07-22T15:00:00.000Z" }
  ];

  await runNativeAgentToolLoopCycle({
    ...baseInput,
    snapshot,
    provider: capturingProvider,
    recentCatalogContext: {
      interactions: [
        {
          inboundMessageId: "older-1",
          completedAt: "2026-07-22T14:59:30.000Z",
          sourceTool: "search_products",
          products: [{ position: 1, productId: "501", name: "Barra olimpica" }]
        }
      ]
    },
    resolvedSalesAgentConfiguration: buildResolvedConfig()
  });

  const userMessage = capturedRequests[0].messages.find((message) => message.role === "user");
  const payload = JSON.parse(userMessage?.content ?? "{}") as {
    commercialContext: { recentMessages: Array<{ body: string | null }> };
    recentCatalogContext: { interactions: Array<{ products: Array<{ productId: string }> }> };
  };

  assert.deepEqual(payload.commercialContext.recentMessages, [{ direction: "agent", body: "Tenemos barras y discos." }]);
  assert.equal(payload.recentCatalogContext.interactions[0].products[0].productId, "501");
  assert.equal("recentCatalogContext" in payload.commercialContext, false);
});

test("[W6] pendingCatalogAction is omitted from the persisted event when dispatch does not write outbox", async () => {
  const inboundMessageId = `msg-${uniqueSuffix("pending-no-outbox")}`;
  const conversationId = 991101;
  const provider = createFakeAgentLoopProvider({
    script: [
      {
        type: "respond",
        message: "¿Quieres que te envie el link?",
        pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"] }
      }
    ]
  });

  await withEnv(
    {
      ...DB_ENV,
      BRAIN_AGENT_ACTION_QUEUE_ENABLED: "false",
      BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED: "false",
      BRAIN_EXECUTION_GATE_ENABLED: "false",
      BRAIN_OUTBOX_BRIDGE_ENABLED: "false"
    },
    async () => {
      const result = await runNativeAgentToolLoopCycle({
        ...baseInput,
        conversationId,
        inboundMessageId,
        correlationId: `corr-${inboundMessageId}`,
        snapshot: buildSnapshot(),
        provider,
        recentCatalogContext: {
          interactions: [
            {
              inboundMessageId: "catalog-msg",
              completedAt: "2026-07-22T14:59:00.000Z",
              sourceTool: "search_products",
              products: [{ position: 1, productId: "501", name: "Kettlebell" }]
            }
          ]
        },
        resolvedSalesAgentConfiguration: buildResolvedConfig()
      });

      assert.equal(result.dispatch.outboxWritten, false);
      assert.ok(result.loop.warnings.some((warning) => warning.startsWith("pending_catalog_action_dropped_no_outbox:send_product_link:")));
      const payload = await loadAgentToolLoopPayload(inboundMessageId);
      assert.equal("pendingCatalogAction" in payload, false);
      const loaded = await loadPendingCatalogAction({ conversationId });
      assert.equal(loaded.pendingCatalogAction, null);
    }
  );
});

test("[W7] pendingCatalogAction is persisted when dispatch writes outbox", async () => {
  const inboundMessageId = `msg-${uniqueSuffix("pending-with-outbox")}`;
  const conversationId = 991102;
  const waId = `5699${String(Date.now()).slice(-8)}`;
  const provider = createFakeAgentLoopProvider({
    script: [
      {
        type: "respond",
        message: "¿Quieres que te envie el link?",
        pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"] }
      }
    ]
  });

  await withEnv(
    {
      ...DB_ENV,
      BRAIN_AGENT_ACTION_QUEUE_ENABLED: "true",
      BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED: "true",
      BRAIN_EXECUTION_GATE_ENABLED: "true",
      BRAIN_OUTBOX_BRIDGE_ENABLED: "true",
      BRAIN_AUTONOMOUS_SANDBOX_ENABLED: "true",
      BRAIN_AUTONOMOUS_REPLY_ENABLED: "true",
      BRAIN_AUTONOMOUS_TEST_WA_IDS: waId
    },
    async () => {
      const result = await runNativeAgentToolLoopCycle({
        ...baseInput,
        conversationId,
        waId,
        inboundMessageId,
        correlationId: `corr-${inboundMessageId}`,
        snapshot: buildSnapshot(),
        provider,
        recentCatalogContext: {
          interactions: [
            {
              inboundMessageId: "catalog-msg",
              completedAt: "2026-07-22T14:59:00.000Z",
              sourceTool: "search_products",
              products: [{ position: 1, productId: "501", name: "Kettlebell" }]
            }
          ]
        },
        resolvedSalesAgentConfiguration: buildResolvedConfig()
      });

      assert.equal(result.dispatch.attempted, true);
      assert.equal(result.dispatch.outboxWritten, true);
      const payload = await loadAgentToolLoopPayload(inboundMessageId);
      assert.deepEqual(payload.pendingCatalogAction, { actionType: "send_product_link", candidateProductIds: ["501"] });
      const loaded = await loadPendingCatalogAction({ conversationId });
      assert.deepEqual(loaded.pendingCatalogAction, { actionType: "send_product_link", candidateProductIds: ["501"] });
    }
  );
});

test("[W8] consumed pendingCatalogAction is omitted from the persisted event even when the model tries to renew and dispatch writes outbox", async () => {
  const inboundMessageId = `msg-${uniqueSuffix("pending-consumed-with-outbox")}`;
  const conversationId = 991103;
  const waId = `5698${String(Date.now()).slice(-8)}`;
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      {
        type: "respond",
        message: "No puedo obtener el enlace en este momento.",
        pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"] }
      }
    ]
  });

  await withEnv(
    {
      ...DB_ENV,
      CATALOG_SERVICE_BASE_URL: "",
      CATALOG_SERVICE_API_KEY: "",
      BRAIN_AGENT_ACTION_QUEUE_ENABLED: "true",
      BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED: "true",
      BRAIN_EXECUTION_GATE_ENABLED: "true",
      BRAIN_OUTBOX_BRIDGE_ENABLED: "true",
      BRAIN_AUTONOMOUS_SANDBOX_ENABLED: "true",
      BRAIN_AUTONOMOUS_REPLY_ENABLED: "true",
      BRAIN_AUTONOMOUS_TEST_WA_IDS: waId
    },
    async () => {
      resetCapabilityGatewayCatalogPortForTests();
      const result = await runNativeAgentToolLoopCycle({
        ...baseInput,
        conversationId,
        waId,
        inboundMessageId,
        correlationId: `corr-${inboundMessageId}`,
        snapshot: buildSnapshot(),
        provider,
        recentCatalogContext: {
          interactions: [
            {
              inboundMessageId: "catalog-msg",
              completedAt: "2026-07-22T14:59:00.000Z",
              sourceTool: "search_products",
              products: [{ position: 1, productId: "501", name: "Kettlebell" }]
            }
          ]
        },
        pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"] },
        resolvedSalesAgentConfiguration: buildResolvedConfig()
      });

      assert.equal(result.dispatch.attempted, true);
      assert.equal(result.dispatch.outboxWritten, true);
      assert.equal(result.loop.finalPendingCatalogAction, null);
      assert.ok(result.loop.warnings.some((warning) => warning.startsWith("pendingCatalogAction_tool_failed_consumed:send_product_link:")));
      assert.ok(result.loop.warnings.some((warning) => warning.startsWith("pendingCatalogAction_model_renewal_suppressed:send_product_link:")));
      const payload = await loadAgentToolLoopPayload(inboundMessageId);
      assert.equal("pendingCatalogAction" in payload, false);
      assert.equal(await countAgentToolLoopDispatchEffects({ conversationId, inboundMessageId }), 1);
      assert.equal(await countAgentToolLoopCompletedEvents(inboundMessageId), 1);
      const loaded = await loadPendingCatalogAction({ conversationId });
      assert.equal(loaded.pendingCatalogAction, null);
    }
  );
  resetCapabilityGatewayCatalogPortForTests();
});

test("[W9] blocked consumed pendingCatalogAction is omitted from the persisted event even when the model tries to renew and dispatch writes outbox", async () => {
  const inboundMessageId = `msg-${uniqueSuffix("pending-blocked-with-outbox")}`;
  const conversationId = 991104;
  const waId = `5697${String(Date.now()).slice(-8)}`;
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      {
        type: "respond",
        message: "No puedo volver a obtener el enlace en este momento.",
        pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"] }
      }
    ]
  });

  await withCatalogDetailsServer(async (baseUrl) => {
    await withEnv(
      {
        ...DB_ENV,
        CATALOG_SERVICE_BASE_URL: baseUrl,
        CATALOG_SERVICE_API_KEY: "test-key",
        BRAIN_AGENT_ACTION_QUEUE_ENABLED: "true",
        BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED: "true",
        BRAIN_EXECUTION_GATE_ENABLED: "true",
        BRAIN_OUTBOX_BRIDGE_ENABLED: "true",
        BRAIN_AUTONOMOUS_SANDBOX_ENABLED: "true",
        BRAIN_AUTONOMOUS_REPLY_ENABLED: "true",
        BRAIN_AUTONOMOUS_TEST_WA_IDS: waId
      },
      async () => {
        resetCapabilityGatewayCatalogPortForTests();
        const result = await runNativeAgentToolLoopCycle({
          ...baseInput,
          conversationId,
          waId,
          inboundMessageId,
          correlationId: `corr-${inboundMessageId}`,
          snapshot: buildSnapshot(),
          provider,
          recentCatalogContext: {
            interactions: [
              {
                inboundMessageId: "catalog-msg",
                completedAt: "2026-07-22T14:59:00.000Z",
                sourceTool: "search_products",
                products: [{ position: 1, productId: "501", name: "Kettlebell" }]
              }
            ]
          },
          pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"] },
          resolvedSalesAgentConfiguration: buildResolvedConfig({
            effectiveLoopConfiguration: { maxAgentStepsPerTurn: 4, maxToolCallsPerTurn: 2 }
          })
        });

        assert.equal(result.dispatch.attempted, true);
        assert.equal(result.dispatch.outboxWritten, true);
        assert.equal(result.loop.finalPendingCatalogAction, null);
        assert.equal(
          result.loop.steps.filter((record) => record.step.type === "use_tool" && record.step.tool === "get_product_details" && record.observation?.status === "blocked").length,
          1
        );
        assert.ok(result.loop.warnings.some((warning) => warning.startsWith("pendingCatalogAction_tool_blocked_consumed:send_product_link:")));
        assert.ok(result.loop.warnings.some((warning) => warning.startsWith("pendingCatalogAction_model_renewal_suppressed:send_product_link:")));
        const payload = await loadAgentToolLoopPayload(inboundMessageId);
        assert.equal("pendingCatalogAction" in payload, false);
        assert.equal(await countAgentToolLoopDispatchEffects({ conversationId, inboundMessageId }), 1);
        assert.equal(await countAgentToolLoopCompletedEvents(inboundMessageId), 1);
        const loaded = await loadPendingCatalogAction({ conversationId });
        assert.equal(loaded.pendingCatalogAction, null);
      }
    );
  });
  resetCapabilityGatewayCatalogPortForTests();
});
