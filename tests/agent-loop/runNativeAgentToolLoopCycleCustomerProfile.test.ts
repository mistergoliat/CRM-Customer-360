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
import type { CustomerCommercialHistoryContext } from "@/lib/brain/commercial/customer-profile-context";

const originalConsoleInfo = console.info;

test.after(() => {
  console.info = originalConsoleInfo;
});

test.beforeEach(() => {
  console.info = (() => undefined) as typeof console.info;
});

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
      lastUpdatedAt: "2026-08-05T12:00:00.000Z"
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
    commercialLineItems: null,
    availableCapabilities: [],
    warnings: [],
    customer360: null,
    customer360State: "not_requested",
    customerSession: null,
    metadata: {
      source: "native_mariadb",
      conversationPublicId: "test-conv",
      currentTime: "2026-08-05T12:00:00.000Z"
    }
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

function availableHistoryContext(status: CustomerCommercialHistoryContext["status"] = "AVAILABLE"): CustomerCommercialHistoryContext {
  return {
    status,
    customerId: 123,
    summary: {
      validatedOrderCount: 4,
      firstPurchaseAt: "2026-01-01T00:00:00.000Z",
      lastPurchaseAt: "2026-07-20T00:00:00.000Z",
      historicalPurchaseValueTaxIncl: "120000.00",
      currencyIsoCode: "CLP",
      monetaryInterpretation: "INFORMATIONAL_ONLY"
    },
    recentOrders: [],
    purchasedProducts: [
      {
        productId: 501,
        productAttributeId: 7,
        name: "Kettlebell 16kg",
        totalQuantity: 2,
        orderCount: 2,
        firstPurchasedAt: "2026-02-01T00:00:00.000Z",
        lastPurchasedAt: "2026-07-20T00:00:00.000Z",
        historicalSpentTaxIncl: "59980.00",
        catalogStatus: "linked"
      }
    ],
    purchaseBehavior: null,
    customerRfm: null,
    provenance: {
      source: "PRESTASHOP",
      identityStatus: "DIRECT_SOURCE",
      contractVersion: "customer-profile-prestashop-direct-v1",
      generatedAt: "2026-08-05T10:00:00.000Z"
    },
    recommendationHistoryMatches: [
      { productId: 501, productAttributeId: 7, name: "Kettlebell 16kg", matchStatus: "SAME_VARIANT_PREVIOUSLY_PURCHASED" }
    ],
    constraints: {
      rfmAvailable: false,
      monetarySegmentAvailable: false,
      mayAlterCatalogRanking: false,
      mayAutoExcludePurchasedProducts: false
    },
    observations: [
      { capability: "context", status, reasonCode: status === "PARTIAL" ? "CUSTOMER_PROFILE_PARTIAL" : "CUSTOMER_PROFILE_AVAILABLE" },
      { capability: "context", status, reasonCode: "RFM_NOT_AVAILABLE" },
      { capability: "context", status, reasonCode: "MONETARY_INFORMATIONAL_ONLY" },
      { capability: "context", status, reasonCode: "CATALOG_RANKING_NOT_MODIFIED" },
      { capability: "commercial-summary", status: "AVAILABLE", reasonCode: "COMMERCIAL_SUMMARY_AVAILABLE" },
      { capability: "purchased-products", status: "AVAILABLE", reasonCode: "PURCHASED_PRODUCTS_AVAILABLE" }
    ]
  };
}

const baseInput = {
  conversationId: 1,
  waId: "56900000000",
  inboundMessageId: "msg-1",
  correlationId: "corr-1",
  currentTime: "2026-08-05T12:00:00.000Z",
  customerMessage: "hola, busco una kettlebell"
};

test("agent loop receives compact customer purchase history context before model invocation", async () => {
  const captured: AgentLoopProviderRequest[] = [];
  const provider: AgentLoopProvider = {
    name: "capturing-provider",
    async invoke(request) {
      captured.push(request);
      return { rawOutput: { type: "respond", message: "hola" } };
    }
  };

  await runNativeAgentToolLoopCycle({
    ...baseInput,
    snapshot: buildSnapshot(),
    provider,
    trustedCustomerSession: {
      conversationId: "1",
      opportunityId: null,
      trustedInbound: {
        channel: "whatsapp",
        externalId: baseInput.waId,
        normalizedPhone: baseInput.waId,
        messageId: baseInput.inboundMessageId,
        receivedAt: baseInput.currentTime
      },
      identity: {
        status: "identified",
        customerId: "123",
        source: "external_identity",
        localResolutionOutcome: "identified",
        externalResolutionOutcome: null
      },
      masterCustomerIdentity: { status: "identity_unresolved", reason: "identity_absent" },
      runtimeIdentity: { status: "MASTER_RESOLVED", identityLevel: "LEVEL_2_MASTER_RESOLVED", masterCustomerId: "123", prestashopCustomerId: null, verificationRequired: false, requiredEvidence: [], readyToLink: false, conflictCode: null, policyCode: "EXISTING_CHANNEL_LINK", evidenceRefs: [] },
      onboarding: null,
      contextAccess: "commercial_history",
      currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: null },
      freshExternalResolutionEvidence: null
    },
    loadCustomerProfileContext: async () => availableHistoryContext(),
    resolvedSalesAgentConfiguration: buildResolvedConfig()
  });

  const userPayload = JSON.parse(captured[0].messages.find((message) => message.role === "user")?.content ?? "{}") as {
    commercialContext: { customerPurchaseHistory?: Record<string, unknown> };
  };

  const history = userPayload.commercialContext.customerPurchaseHistory ?? {};
  assert.equal(history.status, "AVAILABLE");
  assert.equal(history.source, "PrestaShop direct customer profile");
  assert.deepEqual(history.reasonCodes, [
    "CUSTOMER_PROFILE_AVAILABLE",
    "RFM_NOT_AVAILABLE",
    "MONETARY_INFORMATIONAL_ONLY",
    "CATALOG_RANKING_NOT_MODIFIED",
    "COMMERCIAL_SUMMARY_AVAILABLE",
    "PURCHASED_PRODUCTS_AVAILABLE"
  ]);
  assert.match(JSON.stringify(history), /"monetaryInterpretation":"INFORMATIONAL_ONLY"/);
  assert.doesNotMatch(JSON.stringify(history), /VIP|lifetimeValue/i);
});

test("agent loop forwards RuntimeIdentityContext (never identity.customerId/masterCustomerIdentity) to the customer profile loader", async () => {
  const provider: AgentLoopProvider = {
    name: "capturing-provider",
    async invoke() {
      return { rawOutput: { type: "respond", message: "hola" } };
    }
  };
  let loaderRuntimeIdentity: unknown;

  // SALES-AGENT-R2-ID-R2-A10 numeric collision fixture: master_customer.id
  // (123, via identity.customerId/masterCustomerIdentity) and
  // prestashopCustomerId (7421, via runtimeIdentity) are deliberately
  // distinct - if the cycle ever again reached into identity.customerId or
  // masterCustomerIdentity for this, this test's loaderRuntimeIdentity
  // capture would show 123, not the runtimeIdentity object carrying 7421.
  await runNativeAgentToolLoopCycle({
    ...baseInput,
    snapshot: buildSnapshot(),
    provider,
    trustedCustomerSession: {
      conversationId: "1",
      opportunityId: null,
      trustedInbound: {
        channel: "whatsapp",
        externalId: baseInput.waId,
        normalizedPhone: baseInput.waId,
        messageId: baseInput.inboundMessageId,
        receivedAt: baseInput.currentTime
      },
      identity: {
        status: "identified",
        customerId: "123",
        source: "external_identity",
        localResolutionOutcome: "identified",
        externalResolutionOutcome: null
      },
      masterCustomerIdentity: { status: "resolved", masterCustomerId: "123", source: "native_session_verified_projection" },
      runtimeIdentity: {
        status: "PRESTASHOP_LINKED",
        identityLevel: "LEVEL_3_PRESTASHOP_LINKED",
        masterCustomerId: "123",
        prestashopCustomerId: "7421",
        verificationRequired: false,
        requiredEvidence: [],
        readyToLink: false,
        conflictCode: null,
        policyCode: "PRESTASHOP_IDENTITY_SUFFICIENT",
        evidenceRefs: []
      },
      onboarding: null,
      contextAccess: "commercial_history",
      currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: null },
      freshExternalResolutionEvidence: null
    },
    loadCustomerProfileContext: async (input) => {
      loaderRuntimeIdentity = input.runtimeIdentity;
      return availableHistoryContext();
    },
    resolvedSalesAgentConfiguration: buildResolvedConfig()
  });

  assert.deepEqual(loaderRuntimeIdentity, {
    status: "PRESTASHOP_LINKED",
    identityLevel: "LEVEL_3_PRESTASHOP_LINKED",
    masterCustomerId: "123",
    prestashopCustomerId: "7421",
    verificationRequired: false,
    requiredEvidence: [],
    readyToLink: false,
    conflictCode: null,
    policyCode: "PRESTASHOP_IDENTITY_SUFFICIENT",
    evidenceRefs: []
  });
});

test("agent loop passes a null runtimeIdentity through (never invents one) when there is no trusted session", async () => {
  const provider: AgentLoopProvider = {
    name: "capturing-provider",
    async invoke() {
      return { rawOutput: { type: "respond", message: "hola" } };
    }
  };
  let loaderRuntimeIdentity: unknown = "not-called";

  await runNativeAgentToolLoopCycle({
    ...baseInput,
    snapshot: buildSnapshot(),
    provider,
    trustedCustomerSession: null,
    loadCustomerProfileContext: async (input) => {
      loaderRuntimeIdentity = input.runtimeIdentity;
      return availableHistoryContext();
    },
    resolvedSalesAgentConfiguration: buildResolvedConfig()
  });

  assert.equal(loaderRuntimeIdentity, null);
});

test("agent loop does not call the customer profile loader when a human already owns the conversation", async () => {
  let calls = 0;
  const provider: AgentLoopProvider = {
    name: "never-called",
    async invoke() {
      throw new Error("provider must not be invoked");
    }
  };

  const result = await runNativeAgentToolLoopCycle({
    ...baseInput,
    snapshot: buildSnapshot({ humanOwnerActive: true }),
    provider,
    loadCustomerProfileContext: async () => {
      calls += 1;
      return availableHistoryContext();
    },
    resolvedSalesAgentConfiguration: buildResolvedConfig()
  });

  assert.equal(result.loop.ran, false);
  assert.equal(calls, 0);
});
