import assert from "node:assert/strict";
import test from "node:test";
import { runNativeAutonomousCycle } from "@/lib/brain/commercial/native-cycle/runNativeAutonomousCycle";
import type { SalesAgentProvider } from "@/lib/brain/commercial/sales-agent/runtimeTypes";

// ACS-R1-05-T06.1 (P1-5 pilot isolation, layer 1). The Step 0 gate in
// runNativeAutonomousCycle.ts fires before resolveNativeCustomerSession (a
// real DB call) and before the shadow evaluation's LLM provider call - so an
// unauthorized wa_id never reaches the database or the network. These tests
// deliberately do NOT configure a DB connection or set the shadow/loop/
// bridge feature flags: if the gate ever regresses, the test fails loudly
// (a thrown "must not be called" from the injected provider/loader, or a DB
// connection error) instead of silently passing.
Object.assign(process.env, {
  BRAIN_AUTONOMOUS_TEST_WA_IDS: "56900000000" // never the waId used below
});

function notCalledProvider(): SalesAgentProvider {
  return {
    name: "must-not-be-called",
    invoke: async () => {
      throw new Error("sales agent provider (LLM) must not be called for an unauthorized wa_id");
    }
  };
}

function baseInput(waId: string) {
  return {
    conversationId: 999999,
    conversationPublicId: "conv-pilot-isolation-test",
    customerMasterId: null,
    waId,
    phoneNumberId: "phone-pilot-isolation-test",
    messageId: "msg-pilot-isolation-test",
    messageText: "Hola",
    correlationId: "correlation-pilot-isolation-test",
    currentTime: new Date().toISOString(),
    provider: notCalledProvider(),
    loadCustomer360: async () => {
      throw new Error("Customer 360 must not load for an unauthorized wa_id");
    },
    customerSessionDependencies: {
      resolveCustomerIdentity: async () => {
        throw new Error("customer identity resolution must not run for an unauthorized wa_id");
      }
    } as never
  };
}

test("[T06.1] an unauthorized wa_id short-circuits before any LLM call, DB session resolution or action/outbox side effect", async () => {
  const result = await runNativeAutonomousCycle(baseInput("56911111111"));

  assert.equal(result.ran, false);
  assert.equal(result.reason, "wa_id_not_authorized_for_pilot");
  assert.equal(result.shadow, null);
  assert.equal(result.loop, null);
  assert.equal(result.bridge, null);
  assert.equal(result.catalogCapability, null);
  assert.deepEqual(result.warnings, []);
});

test("[T06.1] a wa_id normalization mismatch (+/spaces/dashes) is still recognized as authorized", async () => {
  // The allowlist entry and the inbound waId must compare equal after
  // digit normalization - this only proves the gate does NOT block a
  // correctly-authorized number (it may still short-circuit later for
  // unrelated reasons, e.g. no autonomy flags enabled in this test's env).
  Object.assign(process.env, { BRAIN_AUTONOMOUS_TEST_WA_IDS: "+56 9 1111 1111" });
  try {
    const result = await runNativeAutonomousCycle(baseInput("56911111111"));
    assert.notEqual(result.reason, "wa_id_not_authorized_for_pilot");
  } finally {
    Object.assign(process.env, { BRAIN_AUTONOMOUS_TEST_WA_IDS: "56900000000" });
  }
});
