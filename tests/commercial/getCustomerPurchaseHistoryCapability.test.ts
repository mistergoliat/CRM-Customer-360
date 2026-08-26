import assert from "node:assert/strict";
import test from "node:test";
import { getCustomerPurchaseHistoryCapability } from "@/lib/brain/commercial/capability-gateway/getCustomerPurchaseHistoryCapability";
import { resolveCapabilityGatewayDefinition } from "@/lib/brain/commercial/capability-gateway/registry";
import { resolveSalesAgentToolForCapabilityName } from "@/lib/brain/commercial/capability-gateway/toolAliases";
import type { CapabilityGatewayContext } from "@/lib/brain/commercial/capability-gateway/types";
import type { LoadCommercialCustomerContextInput } from "@/lib/brain/commercial/commercial-customer-context";
import type { CommercialCustomerContextResult } from "@/lib/brain/commercial/commercial-customer-context";
import type { RuntimeIdentityContext } from "@/lib/brain/commercial/native-cycle/customer-session/runtimeIdentityContext";
import type { NativeCustomerSessionExecutionContext } from "@/lib/brain/commercial/native-cycle/customer-session/types";

// SALES-AGENT-R2-ID-R2-A11. Capability-level test matrix (RPH05/06/25 and
// the failure-mapping subset) - injects a fake loadCommercialCustomerContext
// (same dependency-injection pattern search_products' own getPort() takes),
// never a live Customer Profile HTTP call.

function level3RuntimeIdentity(overrides: Partial<RuntimeIdentityContext> = {}): RuntimeIdentityContext {
  return {
    status: "PRESTASHOP_LINKED",
    identityLevel: "LEVEL_3_PRESTASHOP_LINKED",
    masterCustomerId: "100",
    prestashopCustomerId: "7421",
    verificationRequired: false,
    requiredEvidence: [],
    readyToLink: false,
    conflictCode: null,
    policyCode: "PRESTASHOP_IDENTITY_SUFFICIENT",
    evidenceRefs: [],
    ...overrides
  };
}

function trustedSessionWithIdentity(runtimeIdentity: RuntimeIdentityContext | null): NativeCustomerSessionExecutionContext {
  return {
    conversationId: "1",
    opportunityId: null,
    trustedInbound: { channel: "whatsapp", externalId: "56900000000", normalizedPhone: "56900000000", messageId: "msg-1", receivedAt: "2026-08-25T12:00:00.000Z" },
    identity: { status: "identified", customerId: "100", source: "external_identity", localResolutionOutcome: "identified", externalResolutionOutcome: null },
    masterCustomerIdentity: { status: "resolved", masterCustomerId: "100", source: "native_session_verified_projection" },
    runtimeIdentity: runtimeIdentity ?? level3RuntimeIdentity({ status: "ANONYMOUS", identityLevel: "LEVEL_0_ANONYMOUS", masterCustomerId: null, prestashopCustomerId: null }),
    onboarding: null,
    contextAccess: "commercial_history",
    currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: null },
    freshExternalResolutionEvidence: null
  };
}

function fakeLoadContext(result: CommercialCustomerContextResult): { fn: (input: LoadCommercialCustomerContextInput) => Promise<CommercialCustomerContextResult>; calls: LoadCommercialCustomerContextInput[] } {
  const calls: LoadCommercialCustomerContextInput[] = [];
  return {
    calls,
    fn: async (input: LoadCommercialCustomerContextInput) => {
      calls.push(input);
      return result;
    }
  };
}

test("registered in the Capability Gateway, never aliased as an LLM-callable tool", () => {
  const def = resolveCapabilityGatewayDefinition("get_customer_purchase_history");
  assert.ok(def, "get_customer_purchase_history must be registered in the Capability Gateway");
  assert.equal(def!.governance.sideEffect, "read_only");
  assert.equal(def!.governance.authority, "autonomous");
  assert.equal(resolveSalesAgentToolForCapabilityName("get_customer_purchase_history"), null);
});

test("RPH05/06: forwards prestashopCustomerId via runtimeIdentity, never a bare number/master id - the boundary receives the whole RuntimeIdentityContext object", async () => {
  const fake = fakeLoadContext({ status: "AVAILABLE", prestashopCustomerId: "7421", commercialHistory: { status: "AVAILABLE", customerId: 7421, summary: null, recentOrders: [], purchasedProducts: [], purchaseBehavior: null, customerRfm: null, provenance: null, recommendationHistoryMatches: [], constraints: { rfmAvailable: false, monetarySegmentAvailable: false, mayAlterCatalogRanking: false, mayAutoExcludePurchasedProducts: false }, observations: [] } });
  const capability = getCustomerPurchaseHistoryCapability(fake.fn);
  const context: CapabilityGatewayContext = {
    correlationId: "corr-1",
    // Numeric-collision fixture: master_customer.id=100, prestashopCustomerId=7421.
    trustedCustomerSession: trustedSessionWithIdentity(level3RuntimeIdentity({ masterCustomerId: "100", prestashopCustomerId: "7421" }))
  };

  await capability.execute({}, context);

  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].runtimeIdentity?.prestashopCustomerId, "7421");
  assert.equal(fake.calls[0].runtimeIdentity?.masterCustomerId, "100");
});

test("no trustedCustomerSession at all is passed through as null runtimeIdentity - never a guessed identity", async () => {
  const fake = fakeLoadContext({ status: "IDENTITY_INSUFFICIENT", requiredLevel: "LEVEL_3_PRESTASHOP_LINKED" });
  const capability = getCustomerPurchaseHistoryCapability(fake.fn);
  const outcome = await capability.execute({}, { correlationId: "corr-1" });

  assert.equal(fake.calls[0].runtimeIdentity, null);
  assert.equal(outcome.status, "denied");
  assert.equal(outcome.errorCode, "identity_insufficient");
});

test("AVAILABLE with products maps to completed, minimized previousProducts only - RPH25: raw commercialHistory never reaches outcome.data", async () => {
  const fake = fakeLoadContext({
    status: "AVAILABLE",
    prestashopCustomerId: "7421",
    commercialHistory: {
      status: "AVAILABLE",
      customerId: 7421,
      summary: { validatedOrderCount: 4, firstPurchaseAt: null, lastPurchaseAt: null, historicalPurchaseValueTaxIncl: "1000.00", currencyIsoCode: "CLP", monetaryInterpretation: "INFORMATIONAL_ONLY" },
      recentOrders: [],
      purchasedProducts: [
        { productId: 731, productAttributeId: null, name: "Disco Olimpico 20kg", totalQuantity: 2, orderCount: 2, firstPurchasedAt: "2026-01-01T00:00:00.000Z", lastPurchasedAt: "2026-07-20T00:00:00.000Z", historicalSpentTaxIncl: "59980.00", catalogStatus: "linked" }
      ],
      purchaseBehavior: null,
      customerRfm: null,
      provenance: { source: "PRESTASHOP", identityStatus: "DIRECT_SOURCE", contractVersion: "customer-profile-prestashop-direct-v1", generatedAt: "2026-08-05T10:00:00.000Z" },
      recommendationHistoryMatches: [],
      constraints: { rfmAvailable: false, monetarySegmentAvailable: false, mayAlterCatalogRanking: false, mayAutoExcludePurchasedProducts: false },
      observations: []
    }
  });
  const capability = getCustomerPurchaseHistoryCapability(fake.fn);
  const outcome = await capability.execute({}, { correlationId: "corr-1", trustedCustomerSession: trustedSessionWithIdentity(level3RuntimeIdentity()) });

  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.data, {
    status: "AVAILABLE",
    previousProducts: [{ historicalProductId: "731", historicalName: "Disco Olimpico 20kg", quantity: 2, lastPurchasedAt: "2026-07-20T00:00:00.000Z" }]
  });
  // Never a raw summary/orders/provenance/RFM field anywhere on the outcome.
  assert.equal(JSON.stringify(outcome.data).includes("PRESTASHOP"), false);
  assert.equal(JSON.stringify(outcome.data).includes("customerRfm"), false);
});

test("PROFILE_NOT_FOUND maps to completed NO_PURCHASE_HISTORY - a business outcome, never a technical failure", async () => {
  const fake = fakeLoadContext({ status: "PROFILE_NOT_FOUND", prestashopCustomerId: "7421" });
  const capability = getCustomerPurchaseHistoryCapability(fake.fn);
  const outcome = await capability.execute({}, { correlationId: "corr-1", trustedCustomerSession: trustedSessionWithIdentity(level3RuntimeIdentity()) });

  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.data, { status: "NO_PURCHASE_HISTORY", previousProducts: [] });
});

test("SYSTEM_UNAVAILABLE(retryable) maps to temporarily_blocked; SYSTEM_UNAVAILABLE(non-retryable) maps to failed", async () => {
  const retryableFake = fakeLoadContext({ status: "SYSTEM_UNAVAILABLE", retryable: true, prestashopCustomerId: "7421" });
  const retryableOutcome = await getCustomerPurchaseHistoryCapability(retryableFake.fn).execute({}, { correlationId: "corr-1", trustedCustomerSession: trustedSessionWithIdentity(level3RuntimeIdentity()) });
  assert.equal(retryableOutcome.status, "temporarily_blocked");
  assert.equal(retryableOutcome.retryable, true);

  const failedFake = fakeLoadContext({ status: "SYSTEM_UNAVAILABLE", retryable: false, prestashopCustomerId: "7421" });
  const failedOutcome = await getCustomerPurchaseHistoryCapability(failedFake.fn).execute({}, { correlationId: "corr-1", trustedCustomerSession: trustedSessionWithIdentity(level3RuntimeIdentity()) });
  assert.equal(failedOutcome.status, "failed");
  assert.equal(failedOutcome.retryable, false);
});
