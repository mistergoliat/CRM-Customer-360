import assert from "node:assert/strict";
import test from "node:test";
import { loadCommercialCustomerContext } from "@/lib/brain/commercial/commercial-customer-context";
import type { RuntimeIdentityContext, RuntimeIdentityStatus } from "@/lib/brain/commercial/native-cycle/customer-session";
import type { IdentityLevel } from "@/lib/domains/customer-identity-verification";
import type { CustomerProfileCapabilities } from "@/lib/brain/commercial/capabilities/customer-profile";
import type { CustomerCommercialSummaryResult, CustomerRfmResult } from "@/lib/integrations/customer-profile";

// SALES-AGENT-R2-ID-R2-A10. Tests the single safe boundary between
// RuntimeIdentityContext and Customer Profile - the identity gate, the
// numeric-collision guarantee (master_customer.id never sent as
// ps_customer.id_customer), and fail-closed semantics (IDENTITY_INSUFFICIENT
// vs PROFILE_NOT_FOUND vs SYSTEM_UNAVAILABLE).

function runtimeIdentity(overrides: Partial<RuntimeIdentityContext> = {}): RuntimeIdentityContext {
  return {
    status: "ANONYMOUS",
    identityLevel: "LEVEL_0_ANONYMOUS",
    masterCustomerId: null,
    prestashopCustomerId: null,
    verificationRequired: false,
    requiredEvidence: [],
    readyToLink: false,
    conflictCode: null,
    policyCode: "TEST",
    evidenceRefs: [],
    ...overrides
  };
}

function level3Identity(input: { masterCustomerId: string; prestashopCustomerId: string }): RuntimeIdentityContext {
  return runtimeIdentity({
    status: "PRESTASHOP_LINKED",
    identityLevel: "LEVEL_3_PRESTASHOP_LINKED",
    masterCustomerId: input.masterCustomerId,
    prestashopCustomerId: input.prestashopCustomerId,
    policyCode: "PRESTASHOP_IDENTITY_SUFFICIENT"
  });
}

function neverCalledCapabilities(): CustomerProfileCapabilities {
  const fail = async (): Promise<never> => {
    throw new Error("Customer Profile must not be called for this identity state");
  };
  return {
    getProfile: fail,
    getCommercialSummary: fail,
    getPurchasedProducts: fail,
    getPurchaseBehavior: fail,
    getOrderStatus: fail,
    getRfm: fail,
    checkReadiness: fail
  };
}

function availableSummary(customerId: number): CustomerCommercialSummaryResult {
  return {
    status: "AVAILABLE",
    metadata: { requestedCustomerId: customerId, contractVersion: "customer-profile-prestashop-direct-v1", identitySource: "PRESTASHOP", generatedAt: "2026-08-05T10:00:00.000Z", durationMs: 5 },
    data: {
      status: "available",
      customerId,
      summary: {
        totalOrders: 4,
        totalSpentTaxIncl: "120000.00",
        averageOrderValueTaxIncl: "30000.00",
        firstOrderAt: "2026-01-01T00:00:00.000Z",
        lastOrderAt: "2026-07-20T00:00:00.000Z",
        daysSinceLastOrder: 16,
        purchaseFrequencyDays: 45,
        totalUnitsPurchased: 9,
        distinctProductsPurchased: 5,
        cancelledOrderCount: 0,
        refundedOrderCount: 0,
        currencyIsoCode: "CLP"
      },
      provenance: {
        customerIdentity: { customerId, source: "PRESTASHOP", externalCustomerId: String(customerId), status: "DIRECT_SOURCE" },
        dataSources: [],
        generatedAt: "2026-08-05T10:00:00.000Z",
        contractVersion: "customer-profile-prestashop-direct-v1"
      }
    }
  };
}

function availableRfm(customerId: number): CustomerRfmResult {
  return {
    status: "AVAILABLE",
    metadata: { requestedCustomerId: customerId, contractVersion: "customer-rfm-runtime-v1", segmentVersion: "rfm-commercial-v1", referenceTime: "2026-08-03T00:00:00.000Z", publishedAt: "2026-08-03T01:00:00.000Z", durationMs: 4 },
    data: {
      status: "available",
      customerId,
      snapshot: { snapshotId: "55", calculationVersion: "rfm-population-v1", referenceTime: "2026-08-03T00:00:00.000Z", publishedAt: "2026-08-03T01:00:00.000Z", currencyCode: "CLP" },
      rfm: { recencyDays: 2, frequencyOrders: 3, grossOrderValueTaxIncl: "123456.780000", averageOrderValueTaxIncl: "41152.260000", recencyScore: 5, frequencyScore: 3, monetaryScore: 4, rfmCode: "R5F3M4" },
      segment: { code: "LOYAL", version: "rfm-commercial-v1" },
      contractVersion: "customer-rfm-runtime-v1"
    }
  };
}

function baseCapabilities(overrides: Partial<CustomerProfileCapabilities> = {}): CustomerProfileCapabilities {
  const notUsed = async (): Promise<never> => {
    throw new Error("not used in this test (historyNeeds is empty)");
  };
  return {
    getProfile: notUsed,
    getPurchasedProducts: notUsed,
    getPurchaseBehavior: notUsed,
    getOrderStatus: notUsed,
    getCommercialSummary: async (input) => availableSummary(input.customerId),
    getRfm: async (input) => availableRfm(input.customerId),
    checkReadiness: notUsed,
    ...overrides
  };
}

const disabledConfig = { contextEnabled: false, purchasedProductsLimit: 20, topProductsLimit: 5, topVariantsLimit: 5, recentPurchasesLimit: 5 };
const enabledConfig = { contextEnabled: true, purchasedProductsLimit: 20, topProductsLimit: 5, topVariantsLimit: 5, recentPurchasesLimit: 5 };

const INSUFFICIENT_STATES: ReadonlyArray<{ label: string; status: RuntimeIdentityStatus; identityLevel: IdentityLevel }> = [
  { label: "CPC01 LEVEL_0 ANONYMOUS", status: "ANONYMOUS", identityLevel: "LEVEL_0_ANONYMOUS" },
  { label: "CPC02 LEVEL_1 CHANNEL_OBSERVED", status: "CHANNEL_OBSERVED", identityLevel: "LEVEL_1_CHANNEL_OBSERVED" },
  { label: "CPC03 LEVEL_2 MASTER_RESOLVED", status: "MASTER_RESOLVED", identityLevel: "LEVEL_2_MASTER_RESOLVED" },
  { label: "CPC04 READY_TO_LINK", status: "READY_TO_LINK", identityLevel: "LEVEL_2_MASTER_RESOLVED" },
  { label: "CPC05 CONFLICT", status: "CONFLICT", identityLevel: "LEVEL_0_ANONYMOUS" },
  { label: "CPC06 SYSTEM_UNAVAILABLE", status: "SYSTEM_UNAVAILABLE", identityLevel: "LEVEL_0_ANONYMOUS" },
  { label: "AMBIGUOUS", status: "AMBIGUOUS", identityLevel: "LEVEL_2_MASTER_RESOLVED" },
  { label: "NEEDS_VERIFICATION", status: "NEEDS_VERIFICATION", identityLevel: "LEVEL_1_CHANNEL_OBSERVED" }
];

for (const state of INSUFFICIENT_STATES) {
  test(`${state.label} -> IDENTITY_INSUFFICIENT, Customer Profile is never called`, async () => {
    const result = await loadCommercialCustomerContext({
      runtimeIdentity: runtimeIdentity({ status: state.status, identityLevel: state.identityLevel, masterCustomerId: "100" }),
      historyNeeds: [],
      customerProfileCapabilities: neverCalledCapabilities(),
      config: enabledConfig
    });
    assert.deepEqual(result, { status: "IDENTITY_INSUFFICIENT", requiredLevel: "LEVEL_3_PRESTASHOP_LINKED" });
  });
}

test("null trustedCustomerSession identity -> IDENTITY_INSUFFICIENT, never guessed", async () => {
  const result = await loadCommercialCustomerContext({
    runtimeIdentity: null,
    historyNeeds: [],
    customerProfileCapabilities: neverCalledCapabilities(),
    config: enabledConfig
  });
  assert.deepEqual(result, { status: "IDENTITY_INSUFFICIENT", requiredLevel: "LEVEL_3_PRESTASHOP_LINKED" });
});

test("CPC07/CPC08/CPC09/CPC17: LEVEL_3 + prestashopCustomerId numeric collision - master_customer.id=100 never reaches Customer Profile, only prestashopCustomerId=7421 does", async () => {
  const seenCustomerIds: number[] = [];
  const result = await loadCommercialCustomerContext({
    runtimeIdentity: level3Identity({ masterCustomerId: "100", prestashopCustomerId: "7421" }),
    historyNeeds: [],
    customerProfileCapabilities: baseCapabilities({
      getCommercialSummary: async (input) => {
        seenCustomerIds.push(input.customerId);
        return availableSummary(input.customerId);
      },
      getRfm: async (input) => {
        seenCustomerIds.push(input.customerId);
        return availableRfm(input.customerId);
      }
    }),
    config: enabledConfig
  });

  assert.equal(result.status, "AVAILABLE");
  if (result.status === "AVAILABLE") {
    assert.equal(result.prestashopCustomerId, "7421");
  }
  assert.ok(seenCustomerIds.length > 0);
  for (const seen of seenCustomerIds) {
    assert.equal(seen, 7421);
    assert.notEqual(seen, 100);
  }
});

test("CPC18: two different masterCustomerId values resolving to the same prestashopCustomerId send the identical customerId to Customer Profile (omnichannel, provider-neutral)", async () => {
  const seen: number[] = [];
  const capabilities = baseCapabilities({
    getCommercialSummary: async (input) => {
      seen.push(input.customerId);
      return availableSummary(input.customerId);
    }
  });

  await loadCommercialCustomerContext({
    runtimeIdentity: level3Identity({ masterCustomerId: "981", prestashopCustomerId: "7421" }),
    historyNeeds: [],
    customerProfileCapabilities: capabilities,
    config: enabledConfig
  });
  await loadCommercialCustomerContext({
    runtimeIdentity: level3Identity({ masterCustomerId: "982", prestashopCustomerId: "7421" }),
    historyNeeds: [],
    customerProfileCapabilities: capabilities,
    config: enabledConfig
  });

  assert.deepEqual(seen, [7421, 7421]);
});

test("CPC12: Customer Profile 404 on an already-sufficient identity -> PROFILE_NOT_FOUND, never IDENTITY_INSUFFICIENT", async () => {
  const result = await loadCommercialCustomerContext({
    runtimeIdentity: level3Identity({ masterCustomerId: "100", prestashopCustomerId: "7421" }),
    historyNeeds: [],
    customerProfileCapabilities: baseCapabilities({
      getCommercialSummary: async () => ({ status: "NOT_FOUND", reason: "CUSTOMER_NOT_FOUND" })
    }),
    config: enabledConfig
  });

  assert.deepEqual(result, { status: "PROFILE_NOT_FOUND", prestashopCustomerId: "7421" });
});

test("CPC13/CPC14: Customer Profile unavailable/timeout -> SYSTEM_UNAVAILABLE(retryable), identity unaffected", async () => {
  const result = await loadCommercialCustomerContext({
    runtimeIdentity: level3Identity({ masterCustomerId: "100", prestashopCustomerId: "7421" }),
    historyNeeds: [],
    customerProfileCapabilities: baseCapabilities({
      getCommercialSummary: async () => ({ status: "UNAVAILABLE", reason: "CUSTOMER_PROFILE_TIMEOUT", retryable: true })
    }),
    config: enabledConfig
  });

  assert.deepEqual(result, { status: "SYSTEM_UNAVAILABLE", retryable: true, prestashopCustomerId: "7421" });
});

test("Customer Profile disabled by flag -> SYSTEM_UNAVAILABLE(non-retryable), never treated as IDENTITY_INSUFFICIENT", async () => {
  const result = await loadCommercialCustomerContext({
    runtimeIdentity: level3Identity({ masterCustomerId: "100", prestashopCustomerId: "7421" }),
    historyNeeds: [],
    customerProfileCapabilities: neverCalledCapabilities(),
    config: disabledConfig
  });

  assert.deepEqual(result, { status: "SYSTEM_UNAVAILABLE", retryable: false, prestashopCustomerId: "7421" });
});

test("a malformed prestashopCustomerId on an otherwise SUFFICIENT decision fails closed, never guesses or falls back to masterCustomerId", async () => {
  const result = await loadCommercialCustomerContext({
    runtimeIdentity: level3Identity({ masterCustomerId: "100", prestashopCustomerId: "not-a-number" }),
    historyNeeds: [],
    customerProfileCapabilities: neverCalledCapabilities(),
    config: enabledConfig
  });

  assert.deepEqual(result, { status: "SYSTEM_UNAVAILABLE", retryable: false, prestashopCustomerId: null });
});
