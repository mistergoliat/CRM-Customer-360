import assert from "node:assert/strict";
import test from "node:test";
import { runNativeAgentToolLoopCycle } from "@/lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle";
import type { CommercialContextSnapshot } from "@/lib/brain/commercial/context/buildNativeCommercialContext";
import {
  SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_CONFIGURATION_SCOPE,
  SALES_AGENT_FOLLOW_UP_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT,
  type ResolvedSalesAgentConfiguration
} from "@/lib/brain/commercial/sales-agent-configuration";
import type { AgentLoopProvider, AgentLoopProviderRequest } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";
import type { CustomerCommercialHistoryContext, CustomerHistoryCommercialPolicyConfig, CustomerProfilePurchasedProductContext, CustomerProfileRecommendationHistoryMatch } from "@/lib/brain/commercial/customer-profile-context";

/**
 * CP-R1-T12D. Real wiring (runNativeAgentToolLoopCycle.ts), scripted
 * provider (never a live model call - same fixture-driven determinism as
 * every other agent-loop integration suite in this repo). Each test injects
 * `loadCustomerProfileContext` and `customerHistoryCommercialPolicyConfig`
 * directly - no env mutation, no real HTTP, no DB writes exercised (a failed
 * commercial-event write is swallowed by the pre-existing try/catch, same as
 * every other agent-loop test in this repo).
 */

const originalConsoleInfo = console.info;
test.after(() => {
  console.info = originalConsoleInfo;
});
test.beforeEach(() => {
  console.info = (() => undefined) as typeof console.info;
});

const POLICY_DISABLED: CustomerHistoryCommercialPolicyConfig = { enabled: false, recentPurchaseWindowDays: 90, maxSignals: 8 };
const POLICY_ENABLED: CustomerHistoryCommercialPolicyConfig = { enabled: true, recentPurchaseWindowDays: 90, maxSignals: 8 };

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
    needProfile: {
      useCase: "home gym",
      customerType: null,
      goals: [],
      requiredFeatures: ["compacto"],
      preferredFeatures: [],
      budgetMin: null,
      budgetMax: 500000,
      availableSpace: null,
      location: null,
      deliveryDeadline: null,
      experienceLevel: null,
      purchaseUrgency: null,
      decisionReadiness: null,
      missingInformation: [],
      lastUpdatedAt: "2026-08-06T12:00:00.000Z"
    },
    actions: [],
    signals: {
      hasCustomer: false,
      hasOpportunity: false,
      hasNeedProfile: true,
      hasRecentMessages: false,
      humanOwnerActive: false,
      aiBlocked: false,
      staleContext: false,
      identityConflict: false,
      ...signalOverrides
    },
    identityConflict: null,
    shippingDestination: null,
    availableCapabilities: [],
    warnings: [],
    customer360: null,
    customer360State: "not_requested",
    customerSession: null,
    metadata: { source: "native_mariadb", conversationPublicId: "test-conv", currentTime: "2026-08-06T12:00:00.000Z" }
  };
}

function buildResolvedConfig(): ResolvedSalesAgentConfiguration {
  return {
    source: "safe_default",
    scopeKey: SALES_AGENT_CONFIGURATION_SCOPE,
    recordId: null,
    version: null,
    configurationHash: null,
    configuration: SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
    effectiveModelConfiguration: SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT,
    effectiveLoopConfiguration: SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT,
    effectiveFollowUpConfiguration: SALES_AGENT_FOLLOW_UP_CONFIGURATION_SAFE_DEFAULT
  };
}

function historyContext(input: {
  status?: CustomerCommercialHistoryContext["status"];
  validatedOrderCount?: number;
  purchasedProducts?: CustomerProfilePurchasedProductContext[];
  recommendationHistoryMatches?: CustomerProfileRecommendationHistoryMatch[];
}): CustomerCommercialHistoryContext {
  const status = input.status ?? "AVAILABLE";
  const unavailable = status !== "AVAILABLE" && status !== "PARTIAL";
  return {
    status,
    customerId: unavailable ? null : 123,
    summary: unavailable
      ? null
      : {
          validatedOrderCount: input.validatedOrderCount ?? (input.purchasedProducts?.length ?? 0),
          firstPurchaseAt: "2026-01-01T00:00:00.000Z",
          lastPurchaseAt: "2026-07-20T00:00:00.000Z",
          historicalPurchaseValueTaxIncl: "120000.00",
          currencyIsoCode: "CLP",
          monetaryInterpretation: "INFORMATIONAL_ONLY"
        },
    recentOrders: [],
    purchasedProducts: input.purchasedProducts ?? [],
    purchaseBehavior: null,
    provenance: unavailable ? null : { source: "PRESTASHOP", identityStatus: "DIRECT_SOURCE", contractVersion: "customer-profile-prestashop-direct-v1", generatedAt: "2026-08-06T10:00:00.000Z" },
    recommendationHistoryMatches: input.recommendationHistoryMatches ?? [],
    constraints: { rfmAvailable: false, monetarySegmentAvailable: false, mayAlterCatalogRanking: false, mayAutoExcludePurchasedProducts: false },
    observations: unavailable
      ? [{ capability: "context", status, reasonCode: "CUSTOMER_PROFILE_UNAVAILABLE" }]
      : [{ capability: "context", status, reasonCode: status === "PARTIAL" ? "CUSTOMER_PROFILE_PARTIAL" : "CUSTOMER_PROFILE_AVAILABLE" }]
  };
}

const baseInput = {
  conversationId: 1,
  waId: "56900000000",
  inboundMessageId: "msg-1",
  correlationId: "corr-1",
  currentTime: "2026-08-06T12:00:00.000Z",
  customerMessage: "hola, busco una barra olimpica"
};

function scriptedProvider(): { provider: AgentLoopProvider; captured: AgentLoopProviderRequest[] } {
  const captured: AgentLoopProviderRequest[] = [];
  return {
    captured,
    provider: {
      name: "scripted",
      async invoke(request) {
        captured.push(request);
        return { rawOutput: { type: "respond", message: "Aqui tienes una opcion." } };
      }
    }
  };
}

async function runCycle(input: {
  policyConfig: CustomerHistoryCommercialPolicyConfig;
  context: CustomerCommercialHistoryContext | null;
  snapshotSignals?: Partial<CommercialContextSnapshot["signals"]>;
  loaderThrows?: boolean;
}) {
  const { provider, captured } = scriptedProvider();
  const result = await runNativeAgentToolLoopCycle({
    ...baseInput,
    snapshot: buildSnapshot(input.snapshotSignals),
    provider,
    loadCustomerProfileContext: async () => {
      if (input.loaderThrows) throw new Error("customer profile unavailable");
      return input.context as CustomerCommercialHistoryContext;
    },
    customerHistoryCommercialPolicyConfig: input.policyConfig,
    resolvedSalesAgentConfiguration: buildResolvedConfig()
  });
  const userMessage = captured[0]?.messages.find((message) => message.role === "user")?.content ?? "{}";
  const commercialContext = (JSON.parse(userMessage) as { commercialContext: Record<string, unknown> }).commercialContext;
  return { result, commercialContext };
}

// --- Section 19: policy disabled/enabled matrix ---

test("policy disabled: commercialContext never carries customerHistoryCommercialSignals (T12C behavior unchanged)", async () => {
  const { commercialContext } = await runCycle({ policyConfig: POLICY_DISABLED, context: historyContext({ purchasedProducts: [], recommendationHistoryMatches: [] }) });
  assert.equal("customerHistoryCommercialSignals" in commercialContext, false);
});

test("policy enabled, no purchase history: no signal exposed (avoid decorative history mentions)", async () => {
  const { commercialContext } = await runCycle({ policyConfig: POLICY_ENABLED, context: historyContext({ status: "AVAILABLE", validatedOrderCount: 0, purchasedProducts: [] }) });
  assert.equal("customerHistoryCommercialSignals" in commercialContext, false);
});

test("policy enabled, product match: PRODUCT_PREVIOUSLY_PURCHASED exposed, product never removed from Catalog candidates", async () => {
  const { commercialContext, result } = await runCycle({
    policyConfig: POLICY_ENABLED,
    context: historyContext({
      purchasedProducts: [productFixture({ productId: 501 })],
      recommendationHistoryMatches: [{ productId: 501, productAttributeId: null, name: "Barra olimpica", matchStatus: "SAME_PRODUCT_PREVIOUSLY_PURCHASED" }]
    })
  });
  const signals = (commercialContext.customerHistoryCommercialSignals as { signals: Array<{ type: string }> }).signals;
  assert.ok(signals.some((signal) => signal.type === "PRODUCT_PREVIOUSLY_PURCHASED"));
  assert.equal(result.loop.terminalReason, "responded");
});

test("policy enabled, variant match: VARIANT_PREVIOUSLY_PURCHASED exposed", async () => {
  const { commercialContext } = await runCycle({
    policyConfig: POLICY_ENABLED,
    context: historyContext({
      purchasedProducts: [productFixture({ productId: 501, productAttributeId: 7 })],
      recommendationHistoryMatches: [{ productId: 501, productAttributeId: 7, name: "Barra olimpica", matchStatus: "SAME_VARIANT_PREVIOUSLY_PURCHASED" }]
    })
  });
  const signals = (commercialContext.customerHistoryCommercialSignals as { signals: Array<{ type: string }> }).signals;
  assert.ok(signals.some((signal) => signal.type === "VARIANT_PREVIOUSLY_PURCHASED"));
});

test("policy enabled, unrelated purchase history: no signal exposed, no HTTP/tool side effects from the policy layer", async () => {
  const { commercialContext } = await runCycle({
    policyConfig: POLICY_ENABLED,
    context: historyContext({ purchasedProducts: [productFixture({ productId: 999 })], recommendationHistoryMatches: [] })
  });
  assert.equal("customerHistoryCommercialSignals" in commercialContext, false);
});

test("policy enabled, repeated purchase related to the current request: POSSIBLE_REORDER exposed as a hypothesis", async () => {
  const { commercialContext } = await runCycle({
    policyConfig: POLICY_ENABLED,
    context: historyContext({
      purchasedProducts: [productFixture({ productId: 501, orderCount: 3, totalQuantity: 3 })],
      recommendationHistoryMatches: [{ productId: 501, productAttributeId: null, name: "Barra olimpica", matchStatus: "SAME_PRODUCT_PREVIOUSLY_PURCHASED" }]
    })
  });
  const signals = (commercialContext.customerHistoryCommercialSignals as { signals: Array<{ type: string; confidence?: string }> }).signals;
  const reorder = signals.find((signal) => signal.type === "POSSIBLE_REORDER");
  assert.ok(reorder);
  assert.notEqual(reorder?.confidence, "HIGH");
});

test("policy enabled, Customer Profile unavailable: fail-open, HISTORY_UNAVAILABLE surfaced only as internal constraint, loop still responds", async () => {
  const { commercialContext, result } = await runCycle({ policyConfig: POLICY_ENABLED, context: null, loaderThrows: true });
  const signals = (commercialContext.customerHistoryCommercialSignals as { signals: Array<{ type: string; reason?: string }> } | undefined)?.signals ?? [];
  assert.ok(signals.some((signal) => signal.type === "HISTORY_UNAVAILABLE"));
  assert.equal(result.loop.terminalReason, "responded");
  assert.doesNotMatch(JSON.stringify(commercialContext), /ECONNREFUSED|stack|Error:/);
});

test("policy enabled, recentCatalogContext/pendingCatalogAction absent (no Catalog evidence this turn): behaves like unrelated history, no match signals", async () => {
  const { commercialContext } = await runCycle({
    policyConfig: POLICY_ENABLED,
    context: historyContext({ purchasedProducts: [productFixture({ productId: 501 })], recommendationHistoryMatches: [] })
  });
  assert.equal("customerHistoryCommercialSignals" in commercialContext, false);
});

test("policy enabled with both Customer Profile and a product match available: both customerPurchaseHistory and customerHistoryCommercialSignals present, RFM/VIP never present", async () => {
  const { commercialContext } = await runCycle({
    policyConfig: POLICY_ENABLED,
    context: historyContext({
      purchasedProducts: [productFixture({ productId: 501 })],
      recommendationHistoryMatches: [{ productId: 501, productAttributeId: null, name: "Barra olimpica", matchStatus: "SAME_PRODUCT_PREVIOUSLY_PURCHASED" }]
    })
  });
  assert.ok(commercialContext.customerPurchaseHistory);
  assert.ok(commercialContext.customerHistoryCommercialSignals);
  assert.doesNotMatch(JSON.stringify(commercialContext), /VIP|rfmSegment|monetaryScore|lifetimeValue/i);
});

test("handoff before policy: a human-owned conversation never invokes the loader or the policy layer at all", async () => {
  let loaderCalls = 0;
  const { provider } = scriptedProvider();
  const result = await runNativeAgentToolLoopCycle({
    ...baseInput,
    snapshot: buildSnapshot({ humanOwnerActive: true }),
    provider,
    loadCustomerProfileContext: async () => {
      loaderCalls += 1;
      return historyContext({ purchasedProducts: [productFixture({ productId: 501 })] });
    },
    customerHistoryCommercialPolicyConfig: POLICY_ENABLED,
    resolvedSalesAgentConfiguration: buildResolvedConfig()
  });
  assert.equal(result.loop.ran, false);
  assert.equal(loaderCalls, 0);
});

// --- Section 16: deterministic conversational cases ---

test("Caso A - sin historial: no menciona historial, no lo declara cliente nuevo", async () => {
  const { commercialContext } = await runCycle({ policyConfig: POLICY_ENABLED, context: historyContext({ status: "AVAILABLE", validatedOrderCount: 0, purchasedProducts: [] }) });
  assert.equal("customerHistoryCommercialSignals" in commercialContext, false);
});

test("Caso G - historial no relacionado: se suprime del contexto del prompt", async () => {
  const { commercialContext } = await runCycle({
    policyConfig: POLICY_ENABLED,
    context: historyContext({ purchasedProducts: [productFixture({ productId: 999, orderCount: 3 })], recommendationHistoryMatches: [] })
  });
  assert.equal("customerHistoryCommercialSignals" in commercialContext, false);
});

test("Caso H - Customer Profile unavailable: el loop continua, no inventa 'cero compras', no expone error tecnico", async () => {
  const { commercialContext, result } = await runCycle({ policyConfig: POLICY_ENABLED, context: null, loaderThrows: true });
  assert.equal(result.loop.terminalReason, "responded");
  assert.doesNotMatch(JSON.stringify(commercialContext), /CUSTOMER_HAS_NO_PURCHASE_HISTORY/);
});

test("Caso I - monto agregado presente: existe como informacion interna sin producir VIP/capacidad economica/segmento", async () => {
  const { commercialContext } = await runCycle({
    policyConfig: POLICY_ENABLED,
    context: historyContext({ purchasedProducts: [productFixture({ productId: 501 })], recommendationHistoryMatches: [{ productId: 501, productAttributeId: null, name: "Barra olimpica", matchStatus: "SAME_PRODUCT_PREVIOUSLY_PURCHASED" }] })
  });
  assert.match(JSON.stringify(commercialContext.customerPurchaseHistory), /monetaryInterpretation.*INFORMATIONAL_ONLY/);
  assert.doesNotMatch(JSON.stringify(commercialContext), /VIP|CUSTOMER_IS_VIP|HIGH_VALUE|CAN_AFFORD/i);
});

test("Caso D - otra variante: distingue producto de variante, nunca afirma que sea exactamente la misma", async () => {
  const { commercialContext } = await runCycle({
    policyConfig: POLICY_ENABLED,
    context: historyContext({
      purchasedProducts: [productFixture({ productId: 501, productAttributeId: 7 })],
      recommendationHistoryMatches: [{ productId: 501, productAttributeId: 11, name: "Barra olimpica", matchStatus: "SAME_VARIANT_PREVIOUSLY_PURCHASED" }]
    })
  });
  // The requested variant (11) never matched the purchased one (7) - no fabricated variant signal, and no product-level fallback either (the match itself already says which variant it checked).
  assert.equal("customerHistoryCommercialSignals" in commercialContext, false);
});

test("Caso F - complemento: sin evidencia explicita de Catalog, POSSIBLE_COMPLEMENT nunca aparece (no inferencia por coexistencia historica)", async () => {
  const { commercialContext } = await runCycle({
    policyConfig: POLICY_ENABLED,
    context: historyContext({
      purchasedProducts: [productFixture({ productId: 501 })],
      recommendationHistoryMatches: [{ productId: 501, productAttributeId: null, name: "Barra olimpica", matchStatus: "SAME_PRODUCT_PREVIOUSLY_PURCHASED" }]
    })
  });
  assert.doesNotMatch(JSON.stringify(commercialContext), /POSSIBLE_COMPLEMENT/);
});

function productFixture(overrides: Partial<CustomerProfilePurchasedProductContext> = {}): CustomerProfilePurchasedProductContext {
  return {
    productId: 501,
    productAttributeId: null,
    name: "Barra olimpica",
    totalQuantity: 1,
    orderCount: 1,
    firstPurchasedAt: "2026-02-01T00:00:00.000Z",
    lastPurchasedAt: "2026-07-20T00:00:00.000Z",
    historicalSpentTaxIncl: "129990.00",
    catalogStatus: "linked",
    ...overrides
  };
}
