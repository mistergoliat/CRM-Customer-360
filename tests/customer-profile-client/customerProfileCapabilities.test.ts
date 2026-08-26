import assert from "node:assert/strict";
import test from "node:test";
import { createCustomerProfileCapabilities } from "../../lib/brain/commercial/capabilities/customer-profile";
import type { CustomerProfileClient } from "../../lib/integrations/customer-profile";

function makeClient(): CustomerProfileClient {
  return {
    getProfile: async () => ({ status: "UNAVAILABLE", reason: "CUSTOMER_PROFILE_DISABLED", retryable: false }),
    getCommercialSummary: async () => ({ status: "UNAVAILABLE", reason: "CUSTOMER_PROFILE_DISABLED", retryable: false }),
    getPurchasedProducts: async () => ({ status: "UNAVAILABLE", reason: "CUSTOMER_PROFILE_DISABLED", retryable: false }),
    getPurchaseBehavior: async () => ({ status: "UNAVAILABLE", reason: "CUSTOMER_PROFILE_DISABLED", retryable: false }),
    getOrderStatus: async () => ({ status: "UNAVAILABLE", reason: "CUSTOMER_PROFILE_DISABLED", retryable: false }),
    getRfm: async () => ({ status: "UNAVAILABLE", reason: "CUSTOMER_PROFILE_UNAVAILABLE", retryable: false }),
    checkReadiness: async () => ({ status: "UNAVAILABLE", reason: "CUSTOMER_PROFILE_DISABLED", retryable: false })
  };
}

test("customer profile capabilities are a thin internal application wrapper over the client", async () => {
  const client = makeClient();
  const capabilities = createCustomerProfileCapabilities({ customerProfileClient: client });

  assert.deepEqual(await capabilities.getProfile({ customerId: 1 }), { status: "UNAVAILABLE", reason: "CUSTOMER_PROFILE_DISABLED", retryable: false });
  assert.deepEqual(await capabilities.getCommercialSummary({ customerId: 1 }), { status: "UNAVAILABLE", reason: "CUSTOMER_PROFILE_DISABLED", retryable: false });
  assert.deepEqual(await capabilities.getPurchasedProducts({ customerId: 1 }), { status: "UNAVAILABLE", reason: "CUSTOMER_PROFILE_DISABLED", retryable: false });
  assert.deepEqual(await capabilities.getPurchaseBehavior({ customerId: 1 }), { status: "UNAVAILABLE", reason: "CUSTOMER_PROFILE_DISABLED", retryable: false });
  assert.deepEqual(await capabilities.getOrderStatus({ customerId: 1, orderReference: "ABC123XYZ" }), {
    status: "UNAVAILABLE",
    reason: "CUSTOMER_PROFILE_DISABLED",
    retryable: false
  });
  assert.deepEqual(await capabilities.getRfm({ customerId: 9001 }), {
    status: "UNAVAILABLE",
    reason: "CUSTOMER_PROFILE_UNAVAILABLE",
    retryable: false
  });
  assert.deepEqual(await capabilities.checkReadiness(), { status: "UNAVAILABLE", reason: "CUSTOMER_PROFILE_DISABLED", retryable: false });
});
