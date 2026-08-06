import assert from "node:assert/strict";
import test from "node:test";
import { loadCustomerCommercialHistoryContext } from "@/lib/brain/commercial/customer-profile-context";
import type { CustomerProfileCapabilities } from "@/lib/brain/commercial/capabilities/customer-profile";
import type {
  CustomerCommercialSummaryResult,
  CustomerProfileResult,
  CustomerPurchasedProductsResult,
  CustomerPurchaseBehaviorResult
} from "@/lib/integrations/customer-profile";

function baseConfig(overrides: Partial<{ contextEnabled: boolean; purchasedProductsLimit: number; topProductsLimit: number; topVariantsLimit: number; recentPurchasesLimit: number }> = {}) {
  return {
    contextEnabled: true,
    purchasedProductsLimit: 20,
    topProductsLimit: 5,
    topVariantsLimit: 5,
    recentPurchasesLimit: 5,
    ...overrides
  };
}

function availableSummary(): CustomerCommercialSummaryResult {
  return {
    status: "AVAILABLE",
    metadata: {
      requestedCustomerId: 123,
      contractVersion: "customer-profile-prestashop-direct-v1",
      identitySource: "PRESTASHOP",
      generatedAt: "2026-08-05T10:00:00.000Z",
      durationMs: 12
    },
    data: {
      status: "available",
      customerId: 123,
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
        customerIdentity: {
          customerId: 123,
          source: "PRESTASHOP",
          externalCustomerId: "123",
          status: "DIRECT_SOURCE"
        },
        dataSources: [],
        generatedAt: "2026-08-05T10:00:00.000Z",
        contractVersion: "customer-profile-prestashop-direct-v1"
      }
    }
  };
}

function summaryProvenance() {
  const result = availableSummary();
  assert.equal(result.status, "AVAILABLE");
  return result.data.provenance;
}

function availablePurchasedProducts(): CustomerPurchasedProductsResult {
  return {
    status: "AVAILABLE",
    metadata: {
      requestedCustomerId: 123,
      contractVersion: "customer-profile-prestashop-direct-v1",
      identitySource: "PRESTASHOP",
      generatedAt: "2026-08-05T10:00:00.000Z",
      durationMs: 10
    },
    data: {
      status: "available",
      customerId: 123,
      products: [
        {
          productId: 501,
          productAttributeId: 7,
          productName: "Kettlebell 16kg",
          productReference: "KB-16",
          totalQuantityPurchased: 2,
          orderCount: 2,
          firstPurchasedAt: "2026-02-01T00:00:00.000Z",
          lastPurchasedAt: "2026-07-20T00:00:00.000Z",
          totalSpentTaxIncl: "59980.00",
          catalogStatus: "linked"
        }
      ],
      pagination: { limit: 20, offset: 0, returned: 1, hasMore: false },
      provenance: summaryProvenance()
    }
  };
}

function availablePurchaseBehavior(): CustomerPurchaseBehaviorResult {
  return {
    status: "AVAILABLE",
    metadata: {
      requestedCustomerId: 123,
      contractVersion: "customer-profile-prestashop-direct-v1",
      identitySource: "PRESTASHOP",
      generatedAt: "2026-08-05T10:00:00.000Z",
      durationMs: 11
    },
    data: {
      status: "available",
      customerId: 123,
      currencyIsoCode: "CLP",
      calculatedAt: "2026-08-05T10:00:00.000Z",
      summary: {
        validOrderCount: 4,
        distinctProductCount: 5,
        distinctVariantCount: 6,
        repeatedProductCount: 2,
        repeatedVariantCount: 1,
        repeatProductRate: "0.40",
        repeatVariantRate: "0.20",
        repeatedVariantSpendShare: "0.35",
        productSpendConcentration: { top1Share: "0.55", top3Share: "0.80", hhi: "0.44", effectiveDiversity: "2.27" },
        variantSpendConcentration: { top1Share: "0.50", top3Share: "0.78", hhi: "0.40", effectiveDiversity: "2.50" }
      },
      topProducts: [
        {
          productId: 501,
          latestObservedProductName: "Kettlebell 16kg",
          latestObservedProductReference: "KB-16",
          variantCountPurchased: 1,
          repeatedVariantCount: 1,
          orderCount: 2,
          totalQuantityPurchased: 2,
          totalSpentTaxIncl: "59980.00",
          spendShare: "0.50",
          orderShare: "0.50",
          quantityShare: "0.50",
          firstPurchasedAt: "2026-02-01T00:00:00.000Z",
          lastPurchasedAt: "2026-07-20T00:00:00.000Z",
          daysSinceLastPurchase: 16,
          isRepeated: true
        }
      ],
      topVariants: [
        {
          productId: 501,
          productAttributeId: 7,
          productName: "Kettlebell 16kg",
          productReference: "KB-16",
          orderCount: 2,
          totalQuantityPurchased: 2,
          totalSpentTaxIncl: "59980.00",
          spendShare: "0.50",
          orderShare: "0.50",
          quantityShare: "0.50",
          firstPurchasedAt: "2026-02-01T00:00:00.000Z",
          lastPurchasedAt: "2026-07-20T00:00:00.000Z",
          daysSinceLastPurchase: 16,
          isRepeated: true
        }
      ],
      provenance: summaryProvenance()
    }
  };
}

function availableProfile(): CustomerProfileResult {
  return {
    status: "AVAILABLE",
    metadata: {
      requestedCustomerId: 123,
      contractVersion: "customer-profile-prestashop-direct-v1",
      identitySource: "PRESTASHOP",
      generatedAt: "2026-08-05T10:00:00.000Z",
      durationMs: 9
    },
    data: {
      status: "available",
      customerId: 123,
      profile: {
        customerId: 123,
        generatedAt: "2026-08-05T10:00:00.000Z",
        customer: {
          firstname: "Ana",
          lastname: "Prueba",
          email: "ana@example.com",
          rut: null,
          platformOrigin: "prestashop"
        },
        prestashop: {
          customerId: 123,
          active: true,
          shopId: 1,
          createdAt: null,
          updatedAt: null
        },
        recentOrders: [
          {
            orderId: 901,
            reference: "ABC123",
            currentStateId: 5,
            currentState: { stateId: 5, name: "Entregado", resolution: "resolved" },
            valid: true,
            createdAt: "2026-07-20T00:00:00.000Z",
            updatedAt: "2026-07-21T00:00:00.000Z",
            totalPaidTaxIncl: "29990.00",
            totalProductsTaxIncl: "25000.00",
            currencyId: 1
          }
        ],
        warnings: []
      },
      provenance: summaryProvenance(),
      warnings: []
    }
  };
}

function buildCapabilities(overrides: Partial<CustomerProfileCapabilities> = {}): CustomerProfileCapabilities {
  return {
    async getCommercialSummary() {
      return availableSummary();
    },
    async getPurchasedProducts() {
      return availablePurchasedProducts();
    },
    async getPurchaseBehavior() {
      return availablePurchaseBehavior();
    },
    async getProfile() {
      return availableProfile();
    },
    async getOrderStatus() {
      throw new Error("not used in T12C loader tests");
    },
    async checkReadiness() {
      throw new Error("not used in T12C loader tests");
    },
    ...overrides
  };
}

test("loader returns IDENTITY_UNAVAILABLE when customerId is missing or invalid", async () => {
  const context = await loadCustomerCommercialHistoryContext({
    customerId: null,
    commercialIntent: true,
    historyNeeds: [],
    customerProfileCapabilities: buildCapabilities(),
    config: baseConfig()
  });

  assert.equal(context.status, "IDENTITY_UNAVAILABLE");
  assert.equal(context.customerId, null);
  assert.deepEqual(context.observations.map((observation) => observation.reasonCode), ["CUSTOMER_PROFILE_IDENTITY_UNAVAILABLE"]);
});

test("loader returns DISABLED when the wiring flag is off", async () => {
  const context = await loadCustomerCommercialHistoryContext({
    customerId: 123,
    commercialIntent: true,
    historyNeeds: [],
    customerProfileCapabilities: buildCapabilities(),
    config: baseConfig({ contextEnabled: false })
  });

  assert.equal(context.status, "DISABLED");
  assert.deepEqual(context.observations.map((observation) => observation.reasonCode), ["CUSTOMER_PROFILE_DISABLED"]);
});

test("loader uses commercial summary as base context without loading profile by default", async () => {
  let profileCalls = 0;
  const context = await loadCustomerCommercialHistoryContext({
    customerId: 123,
    commercialIntent: true,
    historyNeeds: [],
    customerProfileCapabilities: buildCapabilities({
      async getProfile() {
        profileCalls += 1;
        return availableProfile();
      }
    }),
    config: baseConfig()
  });

  assert.equal(context.status, "AVAILABLE");
  assert.equal(context.summary?.validatedOrderCount, 4);
  assert.equal(context.purchasedProducts.length, 0);
  assert.equal(context.purchaseBehavior, null);
  assert.equal(context.recentOrders.length, 0);
  assert.equal(profileCalls, 0);
});

test("loader loads purchased products and behavior selectively with the configured limits", async () => {
  const captured: Array<Record<string, unknown>> = [];
  const context = await loadCustomerCommercialHistoryContext({
    customerId: 123,
    commercialIntent: true,
    historyNeeds: ["PRODUCT_RECOMMENDATION"],
    customerProfileCapabilities: buildCapabilities({
      async getPurchasedProducts(input) {
        captured.push({ capability: "purchased-products", ...input });
        return availablePurchasedProducts();
      },
      async getPurchaseBehavior(input) {
        captured.push({ capability: "purchase-behavior", ...input });
        return availablePurchaseBehavior();
      }
    }),
    config: baseConfig({ purchasedProductsLimit: 12, topProductsLimit: 4, topVariantsLimit: 3 })
  });

  assert.equal(context.status, "AVAILABLE");
  assert.equal(context.purchasedProducts.length, 1);
  assert.equal(context.purchaseBehavior?.topProducts.length, 1);
  assert.deepEqual(
    captured,
    [
      { capability: "purchased-products", customerId: 123, limit: 12, offset: 0, requestId: undefined },
      { capability: "purchase-behavior", customerId: 123, topProducts: 4, topVariants: 3, requestId: undefined }
    ]
  );
});

test("loader becomes PARTIAL when a secondary capability fails but summary is available", async () => {
  const context = await loadCustomerCommercialHistoryContext({
    customerId: 123,
    commercialIntent: true,
    historyNeeds: ["PRODUCT_RECOMMENDATION"],
    customerProfileCapabilities: buildCapabilities({
      async getPurchaseBehavior() {
        return { status: "UNAVAILABLE", reason: "CUSTOMER_PROFILE_TIMEOUT", retryable: true };
      }
    }),
    config: baseConfig()
  });

  assert.equal(context.status, "PARTIAL");
  assert.equal(context.purchasedProducts.length, 1);
  assert.equal(context.purchaseBehavior, null);
  assert.ok(context.observations.some((observation) => observation.reasonCode === "CUSTOMER_PROFILE_PARTIAL"));
});

test("loader can load profile explicitly for recent orders context", async () => {
  const context = await loadCustomerCommercialHistoryContext({
    customerId: 123,
    commercialIntent: true,
    historyNeeds: ["RECENT_ORDERS_CONTEXT"],
    customerProfileCapabilities: buildCapabilities(),
    config: baseConfig({ recentPurchasesLimit: 1 })
  });

  assert.equal(context.status, "AVAILABLE");
  assert.equal(context.recentOrders.length, 1);
  assert.equal(context.recentOrders[0].orderId, 901);
});

test("loader returns NOT_FOUND when commercial summary says the customer does not exist", async () => {
  const context = await loadCustomerCommercialHistoryContext({
    customerId: 123,
    commercialIntent: true,
    historyNeeds: [],
    customerProfileCapabilities: buildCapabilities({
      async getCommercialSummary() {
        return { status: "NOT_FOUND", reason: "CUSTOMER_NOT_FOUND" };
      }
    }),
    config: baseConfig()
  });

  assert.equal(context.status, "NOT_FOUND");
  assert.ok(context.observations.some((observation) => observation.reasonCode === "CUSTOMER_PROFILE_CUSTOMER_NOT_FOUND"));
});

test("loader maps summary timeout to UNAVAILABLE and contract errors to CONTRACT_ERROR", async () => {
  const unavailable = await loadCustomerCommercialHistoryContext({
    customerId: 123,
    commercialIntent: true,
    historyNeeds: [],
    customerProfileCapabilities: buildCapabilities({
      async getCommercialSummary() {
        return { status: "UNAVAILABLE", reason: "CUSTOMER_PROFILE_TIMEOUT", retryable: true };
      }
    }),
    config: baseConfig()
  });
  assert.equal(unavailable.status, "UNAVAILABLE");
  assert.ok(unavailable.observations.some((observation) => observation.reasonCode === "CUSTOMER_PROFILE_TIMEOUT"));

  const contractError = await loadCustomerCommercialHistoryContext({
    customerId: 123,
    commercialIntent: true,
    historyNeeds: [],
    customerProfileCapabilities: buildCapabilities({
      async getCommercialSummary() {
        return { status: "CONTRACT_ERROR", reason: "PROVENANCE_MISMATCH" };
      }
    }),
    config: baseConfig()
  });
  assert.equal(contractError.status, "CONTRACT_ERROR");
  assert.ok(contractError.observations.some((observation) => observation.reasonCode === "CUSTOMER_PROFILE_PROVENANCE_MISMATCH"));
});
