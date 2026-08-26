import assert from "node:assert/strict";
import test from "node:test";
import { getCustomerRecommendationSignalCapability, selectRecommendationHistoricalSignal } from "@/lib/brain/commercial/capability-gateway/getCustomerRecommendationSignalCapability";
import { resolveCapabilityGatewayDefinition } from "@/lib/brain/commercial/capability-gateway/registry";
import { resolveSalesAgentToolForCapabilityName } from "@/lib/brain/commercial/capability-gateway/toolAliases";
import type { CapabilityGatewayContext } from "@/lib/brain/commercial/capability-gateway/types";
import type { LoadCommercialCustomerContextInput } from "@/lib/brain/commercial/commercial-customer-context";
import type { CommercialCustomerContextResult } from "@/lib/brain/commercial/commercial-customer-context";
import type { CustomerProfilePurchaseBehaviorTopProductContext, CustomerRfmContext } from "@/lib/brain/commercial/customer-profile-context";
import type { RuntimeIdentityContext } from "@/lib/brain/commercial/native-cycle/customer-session/runtimeIdentityContext";
import type { NativeCustomerSessionExecutionContext } from "@/lib/brain/commercial/native-cycle/customer-session/types";

// SALES-AGENT-R2-ID-R2-A12. Same dependency-injection pattern as
// getCustomerPurchaseHistoryCapability.test.ts - injects a fake
// loadCommercialCustomerContext, never a live Customer Profile HTTP call.

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

function topProduct(overrides: Partial<CustomerProfilePurchaseBehaviorTopProductContext>): CustomerProfilePurchaseBehaviorTopProductContext {
  return { productId: 1, name: "Producto", orderCount: 1, totalQuantityPurchased: 1, lastPurchasedAt: null, isRepeated: false, ...overrides };
}

function availableResult(topProducts: CustomerProfilePurchaseBehaviorTopProductContext[], rfm: CustomerRfmContext | null = null): CommercialCustomerContextResult {
  return {
    status: "AVAILABLE",
    prestashopCustomerId: "7421",
    commercialHistory: {
      status: "AVAILABLE",
      customerId: 7421,
      summary: null,
      recentOrders: [],
      purchasedProducts: [],
      purchaseBehavior: {
        distinctProductCount: null,
        distinctVariantCount: null,
        repeatedProductCount: null,
        diversityStatus: null,
        concentrationStatus: null,
        productSpendConcentration: null,
        variantSpendConcentration: null,
        topProducts,
        topVariants: []
      },
      customerRfm: rfm,
      provenance: null,
      recommendationHistoryMatches: [],
      constraints: { rfmAvailable: rfm !== null, monetarySegmentAvailable: false, mayAlterCatalogRanking: false, mayAutoExcludePurchasedProducts: false },
      observations: []
    }
  };
}

test("registered in the Capability Gateway, never aliased as an LLM-callable tool", () => {
  const def = resolveCapabilityGatewayDefinition("get_customer_recommendation_signal");
  assert.ok(def, "get_customer_recommendation_signal must be registered in the Capability Gateway");
  assert.equal(def!.governance.sideEffect, "read_only");
  assert.equal(def!.governance.authority, "autonomous");
  assert.equal(resolveSalesAgentToolForCapabilityName("get_customer_recommendation_signal"), null);
});

test("IDENTITY_INSUFFICIENT maps to denied (defensive only - the objective-level gate already prevents this)", async () => {
  const fake = fakeLoadContext({ status: "IDENTITY_INSUFFICIENT", requiredLevel: "LEVEL_3_PRESTASHOP_LINKED" });
  const outcome = await getCustomerRecommendationSignalCapability(fake.fn).execute({}, { correlationId: "corr-1" });
  assert.equal(outcome.status, "denied");
  assert.equal(outcome.errorCode, "identity_insufficient");
});

test("PROFILE_NOT_FOUND degrades to NO_SIGNAL/completed - never blocks the conversation", async () => {
  const fake = fakeLoadContext({ status: "PROFILE_NOT_FOUND", prestashopCustomerId: "7421" });
  const outcome = await getCustomerRecommendationSignalCapability(fake.fn).execute({}, { correlationId: "corr-1", trustedCustomerSession: trustedSessionWithIdentity(level3RuntimeIdentity()) });
  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.data, { status: "NO_SIGNAL" });
});

test("CAR29-supporting: SYSTEM_UNAVAILABLE retryable AND non-retryable both degrade to NO_SIGNAL/completed - never temporarily_blocked/failed like get_customer_purchase_history", async () => {
  const retryableFake = fakeLoadContext({ status: "SYSTEM_UNAVAILABLE", retryable: true, prestashopCustomerId: "7421" });
  const retryableOutcome = await getCustomerRecommendationSignalCapability(retryableFake.fn).execute({}, { correlationId: "corr-1", trustedCustomerSession: trustedSessionWithIdentity(level3RuntimeIdentity()) });
  assert.equal(retryableOutcome.status, "completed");
  assert.deepEqual(retryableOutcome.data, { status: "NO_SIGNAL" });

  const failedFake = fakeLoadContext({ status: "SYSTEM_UNAVAILABLE", retryable: false, prestashopCustomerId: "7421" });
  const failedOutcome = await getCustomerRecommendationSignalCapability(failedFake.fn).execute({}, { correlationId: "corr-1", trustedCustomerSession: trustedSessionWithIdentity(level3RuntimeIdentity()) });
  assert.equal(failedOutcome.status, "completed");
  assert.deepEqual(failedOutcome.data, { status: "NO_SIGNAL" });
});

test("AVAILABLE with empty topProducts degrades to NO_SIGNAL", async () => {
  const fake = fakeLoadContext(availableResult([]));
  const outcome = await getCustomerRecommendationSignalCapability(fake.fn).execute({}, { correlationId: "corr-1", trustedCustomerSession: trustedSessionWithIdentity(level3RuntimeIdentity()) });
  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.data, { status: "NO_SIGNAL" });
});

test("AVAILABLE with one topProduct maps to AVAILABLE with its name as queryText, no rfmSegmentLabel when RFM is unavailable", async () => {
  const fake = fakeLoadContext(availableResult([topProduct({ productId: 731, name: "Disco Olimpico 20kg" })]));
  const outcome = await getCustomerRecommendationSignalCapability(fake.fn).execute({}, { correlationId: "corr-1", trustedCustomerSession: trustedSessionWithIdentity(level3RuntimeIdentity()) });
  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.data, { status: "AVAILABLE", queryText: "Disco Olimpico 20kg" });
});

test("rfmSegmentLabel is populated only from customerRfm.segment.code when AVAILABLE - never raw recency/frequency/monetary numbers", async () => {
  const fake = fakeLoadContext(
    availableResult([topProduct({ name: "Barra Olimpica" })], {
      status: "AVAILABLE",
      customerId: "7421",
      snapshot: { referenceTime: "2026-08-01T00:00:00.000Z", publishedAt: "2026-08-01T00:00:00.000Z", calculationVersion: "v1" },
      rfm: { recencyDays: 10, frequencyOrders: 5, grossOrderValueTaxIncl: "500000.00", averageOrderValueTaxIncl: "100000.00", recencyScore: 5, frequencyScore: 4, monetaryScore: 3, rfmCode: "543" },
      segment: { code: "LEALES", version: "v1" },
      contractVersion: "rfm-v1"
    })
  );
  const outcome = await getCustomerRecommendationSignalCapability(fake.fn).execute({}, { correlationId: "corr-1", trustedCustomerSession: trustedSessionWithIdentity(level3RuntimeIdentity()) });
  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.data, { status: "AVAILABLE", queryText: "Barra Olimpica", rfmSegmentLabel: "LEALES" });
  // Never a raw RFM number anywhere on the outcome.
  assert.equal(JSON.stringify(outcome.data).includes("recencyDays"), false);
  assert.equal(JSON.stringify(outcome.data).includes("500000"), false);
});

test("CAR26: topProducts fixture deliberately out of order - the deterministic selection picks the explicit-max element by orderCount, never the array's literal first element", async () => {
  const scrambled = [
    topProduct({ productId: 1, name: "Producto A (menos comprado)", orderCount: 1, totalQuantityPurchased: 1 }),
    topProduct({ productId: 2, name: "Producto B (mas comprado)", orderCount: 5, totalQuantityPurchased: 3 }),
    topProduct({ productId: 3, name: "Producto C (intermedio)", orderCount: 3, totalQuantityPurchased: 10 })
  ];
  const fake = fakeLoadContext(availableResult(scrambled));
  const outcome = await getCustomerRecommendationSignalCapability(fake.fn).execute({}, { correlationId: "corr-1", trustedCustomerSession: trustedSessionWithIdentity(level3RuntimeIdentity()) });
  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.data, { status: "AVAILABLE", queryText: "Producto B (mas comprado)" });
});

test("CAR26 continued: selectRecommendationHistoricalSignal ties orderCount, breaks on totalQuantityPurchased, then lastPurchasedAt", () => {
  const sameOrderCount = [
    topProduct({ name: "Empatado, menos cantidad, mas antiguo", orderCount: 3, totalQuantityPurchased: 2, lastPurchasedAt: "2026-01-01T00:00:00.000Z" }),
    topProduct({ name: "Empatado, mas cantidad", orderCount: 3, totalQuantityPurchased: 9, lastPurchasedAt: "2026-01-01T00:00:00.000Z" })
  ];
  assert.equal(selectRecommendationHistoricalSignal(sameOrderCount)?.name, "Empatado, mas cantidad");

  const sameOrderAndQuantity = [
    topProduct({ name: "Mas antiguo", orderCount: 2, totalQuantityPurchased: 4, lastPurchasedAt: "2026-01-01T00:00:00.000Z" }),
    topProduct({ name: "Mas reciente", orderCount: 2, totalQuantityPurchased: 4, lastPurchasedAt: "2026-08-01T00:00:00.000Z" })
  ];
  assert.equal(selectRecommendationHistoricalSignal(sameOrderAndQuantity)?.name, "Mas reciente");

  assert.equal(selectRecommendationHistoricalSignal([]), null);
});

test("no PII-shaped key ever appears anywhere in a completed outcome's data", async () => {
  const fake = fakeLoadContext(availableResult([topProduct({ name: "Producto" })]));
  const outcome = await getCustomerRecommendationSignalCapability(fake.fn).execute({}, { correlationId: "corr-1", trustedCustomerSession: trustedSessionWithIdentity(level3RuntimeIdentity()) });
  const serialized = JSON.stringify(outcome.data).toLowerCase();
  for (const forbidden of ["email", "phone", "address", "order", "customerid", "wa_id", "prestashopcustomerid"]) {
    assert.equal(serialized.includes(forbidden), false, `outcome.data must never contain "${forbidden}"`);
  }
});
