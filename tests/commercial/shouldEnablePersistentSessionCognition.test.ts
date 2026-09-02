import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { shouldEnablePersistentSessionCognition } from "@/lib/brain/commercial/config/commercialCycleConfig";

// SALES-AGENT-R3-V1.8-D5. Same fail-closed, per-waId allowlist discipline
// and test shape as tests/commercial/shouldRouteToSalesAgentRuntime.test.ts
// (D5's own gate is a SECOND, independent allowlist - a waId allowlisted for
// SalesAgentRuntime is not automatically eligible for live cognition).
// Covers task brief Section Q, cases 5-7: flag ON + not allowlisted -> false;
// flag OFF + allowlisted -> false; both ON -> true.

const ENV_KEYS = ["BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED", "BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS"] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

test("[D5-Q7] both flag and allowlist ON: an allowlisted waId is eligible for live cognition", () => {
  process.env.BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED = "true";
  process.env.BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS = "56912345678,56987654321";
  assert.equal(shouldEnablePersistentSessionCognition("56912345678"), true);
  assert.equal(shouldEnablePersistentSessionCognition("+56 9 8765 4321"), true, "digit-normalized match");
});

test("[D5-Q5] flag ON but waId not allowlisted stays on the legacy path", () => {
  process.env.BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED = "true";
  process.env.BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS = "56912345678";
  assert.equal(shouldEnablePersistentSessionCognition("56900000000"), false);
});

test("[D5-Q6] flag OFF (default) stays on the legacy path even with a non-empty allowlist", () => {
  delete process.env.BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED;
  process.env.BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS = "56912345678";
  assert.equal(shouldEnablePersistentSessionCognition("56912345678"), false);

  process.env.BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED = "false";
  assert.equal(shouldEnablePersistentSessionCognition("56912345678"), false);
});

test("[D5-G17] rollback: flag ON then flipped OFF immediately returns everyone to legacy, no allowlist change needed", () => {
  process.env.BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED = "true";
  process.env.BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS = "56912345678";
  assert.equal(shouldEnablePersistentSessionCognition("56912345678"), true);

  process.env.BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED = "false";
  assert.equal(shouldEnablePersistentSessionCognition("56912345678"), false, "rollback is the flag flip alone - the allowlist is never touched");
});

test("an empty/missing allowlist with the flag on fails closed for everyone (ambiguous config, never \"everyone\")", () => {
  process.env.BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED = "true";
  delete process.env.BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS;
  assert.equal(shouldEnablePersistentSessionCognition("56912345678"), false);

  process.env.BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS = "   ,  ,";
  assert.equal(shouldEnablePersistentSessionCognition("56912345678"), false);
});

test("a missing/null waId fails closed, even with a non-empty allowlist", () => {
  process.env.BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED = "true";
  process.env.BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS = "56912345678";
  assert.equal(shouldEnablePersistentSessionCognition(null), false);
  assert.equal(shouldEnablePersistentSessionCognition(undefined), false);
  assert.equal(shouldEnablePersistentSessionCognition(""), false);
});

test("independent from BRAIN_SALES_AGENT_RUNTIME_WA_IDS - a waId allowlisted there is not automatically eligible for live cognition", () => {
  process.env.BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED = "true";
  delete process.env.BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS;
  const previousSalesAgentRuntimeWaIds = process.env.BRAIN_SALES_AGENT_RUNTIME_WA_IDS;
  process.env.BRAIN_SALES_AGENT_RUNTIME_WA_IDS = "56912345678";
  try {
    assert.equal(shouldEnablePersistentSessionCognition("56912345678"), false, "a waId allowlisted for SalesAgentRuntime routing must not be automatically eligible for live cognition");
  } finally {
    if (previousSalesAgentRuntimeWaIds === undefined) delete process.env.BRAIN_SALES_AGENT_RUNTIME_WA_IDS;
    else process.env.BRAIN_SALES_AGENT_RUNTIME_WA_IDS = previousSalesAgentRuntimeWaIds;
  }
});
