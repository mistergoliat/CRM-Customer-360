import assert from "node:assert/strict";
import test from "node:test";
import {
  CUSTOMER_RFM_CONTRACT_VERSION,
  CUSTOMER_PROFILE_CONTRACT_VERSION,
  parseCustomerProfileReadinessResponse,
  parseCustomerProfileResponse,
  parseCustomerPurchasedProductsResponse,
  parseCustomerPurchaseBehaviorResponse,
  parseCustomerRfmResponse,
  validateCustomerId,
  validateMasterCustomerId,
  validateOrderReference,
  validatePurchaseBehaviorTopProducts,
  validatePurchaseBehaviorTopVariants,
  validatePurchasedProductsLimit,
  validatePurchasedProductsOffset
} from "@/lib/integrations/customer-profile";

function provenance(customerId: number) {
  return {
    customerIdentity: {
      customerId,
      source: "PRESTASHOP" as const,
      externalCustomerId: String(customerId),
      status: "DIRECT_SOURCE" as const
    },
    dataSources: [
      { source: "PRESTASHOP" as const, entity: "ps_customer" as const, purpose: "customer_identity" },
      { source: "PRESTASHOP" as const, entity: "ps_customer" as const, purpose: "customer_profile" },
      { source: "PRESTASHOP" as const, entity: "ps_orders" as const, purpose: "recent_orders" }
    ],
    generatedAt: "2026-08-05T00:00:00.000Z",
    contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION
  };
}

function profilePayload(customerId = 1) {
  return {
    status: "available" as const,
    customerId,
    profile: {
      customerId,
      generatedAt: "2026-08-05T00:00:00.000Z",
      customer: {
        firstname: "Test",
        lastname: "Customer",
        email: "synthetic@example.com",
        rut: null,
        platformOrigin: "prestashop"
      },
      prestashop: {
        customerId,
        active: true,
        shopId: 1,
        createdAt: null,
        updatedAt: null
      },
      recentOrders: [
        {
          orderId: 100,
          reference: "REF100",
          currentStateId: 4,
          currentState: { stateId: 4, name: "Despachado", resolution: "resolved" as const },
          valid: true,
          createdAt: "2026-01-01 10:00:00",
          updatedAt: "2026-01-02 10:00:00",
          totalPaidTaxIncl: "10000.000000",
          totalProductsTaxIncl: "9500.000000",
          currencyId: 1
        }
      ],
      warnings: []
    },
    provenance: provenance(customerId),
    warnings: []
  };
}

test("validators accept only the current customerId/order/query bounds", () => {
  assert.equal(validateCustomerId(1), true);
  assert.equal(validateCustomerId(0), false);
  assert.equal(validateCustomerId(1.5), false);
  assert.equal(validateCustomerId(Number.MAX_SAFE_INTEGER + 1), false);

  assert.equal(validatePurchasedProductsLimit(1), true);
  assert.equal(validatePurchasedProductsLimit(100), true);
  assert.equal(validatePurchasedProductsLimit(101), false);

  assert.equal(validatePurchasedProductsOffset(0), true);
  assert.equal(validatePurchasedProductsOffset(-1), false);

  assert.equal(validatePurchaseBehaviorTopProducts(1), true);
  assert.equal(validatePurchaseBehaviorTopProducts(10), true);
  assert.equal(validatePurchaseBehaviorTopProducts(11), false);

  assert.equal(validatePurchaseBehaviorTopVariants(1), true);
  assert.equal(validatePurchaseBehaviorTopVariants(10), true);
  assert.equal(validatePurchaseBehaviorTopVariants(0), false);

  assert.equal(validateOrderReference("ABC123XYZ"), true);
  assert.equal(validateOrderReference("A';DROP"), false);
  assert.equal(validateOrderReference("A".repeat(33)), false);

  assert.equal(validateMasterCustomerId("9001"), true);
  assert.equal(validateMasterCustomerId("0000"), false);
  assert.equal(validateMasterCustomerId("abc"), false);
});

test("parseCustomerProfileResponse accepts the current productive profile contract", () => {
  const parsed = parseCustomerProfileResponse(profilePayload(), 1);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.provenance.contractVersion, CUSTOMER_PROFILE_CONTRACT_VERSION);
  assert.equal(parsed.value.profile.recentOrders[0].currentState.resolution, "resolved");
});

test("parseCustomerProfileResponse rejects an unsupported contract version", () => {
  const payload = profilePayload();
  payload.provenance.contractVersion = "customer-profile-v2" as typeof CUSTOMER_PROFILE_CONTRACT_VERSION;
  const parsed = parseCustomerProfileResponse(payload, 1);
  assert.deepEqual(parsed, { ok: false, reason: "CONTRACT_VERSION_UNSUPPORTED" });
});

test("parseCustomerProfileResponse rejects provenance/customerId mismatches", () => {
  const payload = profilePayload();
  payload.provenance.customerIdentity.customerId = 999;
  const parsed = parseCustomerProfileResponse(payload, 1);
  assert.deepEqual(parsed, { ok: false, reason: "PROVENANCE_MISMATCH" });
});

test("parseCustomerProfileResponse is strict about unknown fields", () => {
  const payload = profilePayload() as Record<string, unknown>;
  payload.unexpected = true;
  const parsed = parseCustomerProfileResponse(payload, 1);
  assert.deepEqual(parsed, { ok: false, reason: "INVALID_RESPONSE" });
});

test("parseCustomerPurchasedProductsResponse preserves direct-prestashop purchased-products payload", () => {
  const parsed = parseCustomerPurchasedProductsResponse(
    {
      status: "available",
      customerId: 1,
      products: [
        {
          productId: 123,
          productAttributeId: 0,
          productName: "Synthetic plate",
          productReference: "PLATE20",
          totalQuantityPurchased: 5,
          orderCount: 2,
          firstPurchasedAt: "2026-01-02T10:00:00.000Z",
          lastPurchasedAt: "2026-01-05T12:30:00.000Z",
          totalSpentTaxIncl: "99990.123456",
          catalogStatus: "linked"
        }
      ],
      pagination: { limit: 20, offset: 0, returned: 1, hasMore: false },
      provenance: provenance(1)
    },
    1
  );
  assert.equal(parsed.ok, true);
});

test("parseCustomerPurchaseBehaviorResponse rejects a non-CLP response", () => {
  const parsed = parseCustomerPurchaseBehaviorResponse(
    {
      status: "available",
      customerId: 1,
      currencyIsoCode: "USD",
      calculatedAt: "2026-01-10T00:00:00.000Z",
      summary: {
        validOrderCount: 0,
        distinctProductCount: 0,
        distinctVariantCount: 0,
        repeatedProductCount: 0,
        repeatedVariantCount: 0,
        repeatProductRate: "0.000000",
        repeatVariantRate: "0.000000",
        repeatedVariantSpendShare: "0.000000",
        productSpendConcentration: { top1Share: "0.000000", top3Share: "0.000000", hhi: "0.000000", effectiveDiversity: "0.000000" },
        variantSpendConcentration: { top1Share: "0.000000", top3Share: "0.000000", hhi: "0.000000", effectiveDiversity: "0.000000" }
      },
      topProducts: [],
      topVariants: [],
      provenance: provenance(1)
    },
    1
  );
  assert.deepEqual(parsed, { ok: false, reason: "INVALID_RESPONSE" });
});

test("parseCustomerProfileReadinessResponse accepts ready and not_ready payloads", () => {
  const ready = parseCustomerProfileReadinessResponse({
    status: "ready",
    prestashop: true,
    crm: false,
    customerIdentitySource: "PRESTASHOP",
    identityStatus: "DIRECT_SOURCE",
    contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION
  });
  assert.equal(ready.ok, true);

  const notReady = parseCustomerProfileReadinessResponse({
    status: "not_ready",
    prestashop: false,
    crm: false,
    customerIdentitySource: "PRESTASHOP",
    identityStatus: "DIRECT_SOURCE",
    contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
    reason: "prestashop_unavailable"
  });
  assert.equal(notReady.ok, true);
});

test("parseCustomerRfmResponse accepts the current productive RFM contract, including historical null segment", () => {
  const parsed = parseCustomerRfmResponse(
    {
      status: "available",
      masterCustomerId: "9001",
      snapshot: {
        snapshotId: "55",
        calculationVersion: "rfm-population-v1",
        referenceTime: "2026-08-03T00:00:00.000Z",
        publishedAt: "2026-08-03T01:00:00.000Z",
        currencyCode: "CLP"
      },
      rfm: {
        recencyDays: 2,
        frequencyOrders: 3,
        grossOrderValueTaxIncl: "123456.780000",
        averageOrderValueTaxIncl: "41152.260000",
        recencyScore: 5,
        frequencyScore: 3,
        monetaryScore: 4,
        rfmCode: "R5F3M4"
      },
      segment: {
        code: null,
        version: null
      },
      contractVersion: CUSTOMER_RFM_CONTRACT_VERSION
    },
    "9001"
  );

  assert.equal(parsed.ok, true);
});

test("parseCustomerRfmResponse rejects masterCustomerId mismatches and unexpected fields", () => {
  const mismatch = parseCustomerRfmResponse(
    {
      status: "available",
      masterCustomerId: "9002",
      snapshot: {
        snapshotId: "55",
        calculationVersion: "rfm-population-v1",
        referenceTime: "2026-08-03T00:00:00.000Z",
        publishedAt: "2026-08-03T01:00:00.000Z",
        currencyCode: "CLP"
      },
      rfm: {
        recencyDays: 2,
        frequencyOrders: 3,
        grossOrderValueTaxIncl: "123456.780000",
        averageOrderValueTaxIncl: "41152.260000",
        recencyScore: 5,
        frequencyScore: 3,
        monetaryScore: 4,
        rfmCode: "R5F3M4"
      },
      segment: {
        code: "LOYAL",
        version: "rfm-commercial-v1"
      },
      contractVersion: CUSTOMER_RFM_CONTRACT_VERSION
    },
    "9001"
  );
  assert.deepEqual(mismatch, { ok: false, reason: "MASTER_CUSTOMER_ID_MISMATCH" });

  const unexpected = parseCustomerRfmResponse(
    {
      status: "available",
      masterCustomerId: "9001",
      snapshot: {
        snapshotId: "55",
        calculationVersion: "rfm-population-v1",
        referenceTime: "2026-08-03T00:00:00.000Z",
        publishedAt: "2026-08-03T01:00:00.000Z",
        currencyCode: "CLP"
      },
      rfm: {
        recencyDays: 2,
        frequencyOrders: 3,
        grossOrderValueTaxIncl: "123456.780000",
        averageOrderValueTaxIncl: "41152.260000",
        recencyScore: 5,
        frequencyScore: 3,
        monetaryScore: 4,
        rfmCode: "R5F3M4"
      },
      segment: {
        code: "LOYAL",
        version: "rfm-commercial-v1"
      },
      contractVersion: CUSTOMER_RFM_CONTRACT_VERSION,
      prestashopCustomerId: 123
    },
    "9001"
  );
  assert.deepEqual(unexpected, { ok: false, reason: "INVALID_RESPONSE" });
});
