import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool } from "@/lib/db";
import { runNativeAutonomousCycle } from "@/lib/brain/commercial/native-cycle/runNativeAutonomousCycle";
import { isCustomerOptedOut, recordCustomerOptOut } from "@/lib/brain/commercial/optOutStore";
import type { SalesAgentProvider } from "@/lib/brain/commercial/sales-agent/runtimeTypes";

// ACS-R1-05.1-T02.3D, decision 11 (native-cycle Step 0.5). Real MariaDB,
// real crm_test - isCustomerOptedOut/recordCustomerOptOut hit the database
// for real, unlike the pilot-isolation Step 0 tests (which never reach a DB
// call at all). No BRAIN_AUTONOMOUS_TEST_WA_IDS is set, so Step 0's pilot
// allowlist is unrestricted and every wa_id below reaches Step 0.5.
Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "crm_test",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true"
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

function uniqueWaId(label: string) {
  return `5699${label}${Date.now()}`.slice(0, 20);
}

function notCalledProvider(): SalesAgentProvider {
  return {
    name: "must-not-be-called",
    invoke: async () => {
      throw new Error("sales agent provider (LLM) must not be called for an opted-out customer");
    }
  };
}

function baseInput(waId: string, messageText = "Hola") {
  return {
    conversationId: 999999,
    conversationPublicId: "conv-opt-out-test",
    customerMasterId: null,
    waId,
    phoneNumberId: "phone-opt-out-test",
    messageId: "msg-opt-out-test",
    messageText,
    correlationId: `correlation-opt-out-test-${Date.now()}`,
    currentTime: new Date().toISOString(),
    provider: notCalledProvider(),
    loadCustomer360: async () => {
      throw new Error("Customer 360 must not load for an opted-out customer");
    },
    customerSessionDependencies: {
      resolveCustomerIdentity: async () => {
        throw new Error("customer identity resolution must not run for an opted-out customer");
      }
    } as never
  };
}

test("[OC1] a customer already opted out short-circuits before any LLM call, DB session resolution or Customer 360 load", async () => {
  const waId = uniqueWaId("oc1");
  await recordCustomerOptOut({ waId, reason: "explicit_customer_command" });

  const result = await runNativeAutonomousCycle(baseInput(waId, "Hola, sigo interesado"));

  assert.equal(result.ran, false);
  assert.equal(result.reason, "customer_opted_out");
  assert.equal(result.shadow, null);
  assert.equal(result.loop, null);
  assert.equal(result.bridge, null);
  assert.equal(result.catalogCapability, null);
  assert.deepEqual(result.warnings, []);
});

test("[OC2] an explicit opt-out command this turn is recorded and short-circuits the SAME turn, before any LLM call", async () => {
  const waId = uniqueWaId("oc2");
  assert.equal(await isCustomerOptedOut(waId), false);

  const result = await runNativeAutonomousCycle(baseInput(waId, "STOP"));

  assert.equal(result.ran, false);
  assert.equal(result.reason, "customer_opted_out");
  assert.equal(await isCustomerOptedOut(waId), true, "the explicit command must be recorded before this turn is gated");
});

test("[OC3] an ordinary message from a customer who never opted out is never blocked at the opt-out gate", async () => {
  const waId = uniqueWaId("oc3");
  const result = await runNativeAutonomousCycle({
    conversationId: 999999,
    conversationPublicId: "conv-opt-out-test",
    customerMasterId: null,
    waId,
    phoneNumberId: "phone-opt-out-test",
    messageId: "msg-opt-out-test",
    messageText: "Hola, quiero cotizar",
    correlationId: `correlation-opt-out-test-${Date.now()}`,
    currentTime: new Date().toISOString()
  });
  // Not configuring the full autonomy pipeline here - this only proves the
  // opt-out gate itself never fires for a customer who never opted out,
  // whatever the cycle decides to do afterward (e.g. autonomous_cycle_disabled
  // in this test's minimal env).
  assert.notEqual(result.reason, "customer_opted_out");
});
