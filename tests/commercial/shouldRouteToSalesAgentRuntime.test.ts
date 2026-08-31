import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { shouldRouteToSalesAgentRuntime } from "@/lib/brain/commercial/config/commercialCycleConfig";

/**
 * SALES-AGENT-R3-V1.4, Phase 2/16. Same fail-closed, per-waId allowlist
 * discipline (and same test shape) as
 * tests/agent-loop/multi-intent/shouldRouteToMultiIntentPlanner.test.ts:
 * only an explicitly allowlisted waId, with the flag on, reaches
 * SalesAgentRuntime - every other combination (flag off, empty/missing
 * allowlist, non-matching waId, missing waId, malformed flag) fails closed
 * to the existing routing. Also the pilot kill switch: flipping the flag
 * off is the entire rollback - no allowlist change needed.
 */

const ENV_KEYS = ["BRAIN_SALES_AGENT_RUNTIME_ENABLED", "BRAIN_SALES_AGENT_RUNTIME_WA_IDS"] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

test("[R3-Route-1] flag on + allowlisted waId routes to SalesAgentRuntime", () => {
  process.env.BRAIN_SALES_AGENT_RUNTIME_ENABLED = "true";
  process.env.BRAIN_SALES_AGENT_RUNTIME_WA_IDS = "56912345678,56987654321";
  assert.equal(shouldRouteToSalesAgentRuntime("56912345678"), true);
  assert.equal(shouldRouteToSalesAgentRuntime("+56 9 8765 4321"), true, "digit-normalized match (spaces/plus)");
});

test("[R3-Route-2] flag on + non-allowlisted waId stays on existing routing", () => {
  process.env.BRAIN_SALES_AGENT_RUNTIME_ENABLED = "true";
  process.env.BRAIN_SALES_AGENT_RUNTIME_WA_IDS = "56912345678";
  assert.equal(shouldRouteToSalesAgentRuntime("56900000000"), false);
});

test("[R3-Route-3] flag on + missing/empty allowlist fails closed for everyone (ambiguous config, never \"everyone\")", () => {
  process.env.BRAIN_SALES_AGENT_RUNTIME_ENABLED = "true";
  delete process.env.BRAIN_SALES_AGENT_RUNTIME_WA_IDS;
  assert.equal(shouldRouteToSalesAgentRuntime("56912345678"), false);

  process.env.BRAIN_SALES_AGENT_RUNTIME_WA_IDS = "";
  assert.equal(shouldRouteToSalesAgentRuntime("56912345678"), false);

  process.env.BRAIN_SALES_AGENT_RUNTIME_WA_IDS = "   ,  ,";
  assert.equal(shouldRouteToSalesAgentRuntime("56912345678"), false, "an allowlist that normalizes to zero real entries is still empty");
});

test("[R3-Route-4] flag on + missing/null waId fails closed, even with a non-empty allowlist", () => {
  process.env.BRAIN_SALES_AGENT_RUNTIME_ENABLED = "true";
  process.env.BRAIN_SALES_AGENT_RUNTIME_WA_IDS = "56912345678";
  assert.equal(shouldRouteToSalesAgentRuntime(null), false);
  assert.equal(shouldRouteToSalesAgentRuntime(undefined), false);
  assert.equal(shouldRouteToSalesAgentRuntime(""), false);
});

test("[R3-Route-5] flag off (kill switch) routes everyone to existing runtime, regardless of allowlist", () => {
  process.env.BRAIN_SALES_AGENT_RUNTIME_ENABLED = "false";
  process.env.BRAIN_SALES_AGENT_RUNTIME_WA_IDS = "56912345678";
  assert.equal(shouldRouteToSalesAgentRuntime("56912345678"), false);

  delete process.env.BRAIN_SALES_AGENT_RUNTIME_ENABLED;
  assert.equal(shouldRouteToSalesAgentRuntime("56912345678"), false, "unset flag defaults to disabled");
});

test("[R3-Route-6] a malformed flag value fails closed (readEnvFlag's own fallback=false), never silently enabled", () => {
  process.env.BRAIN_SALES_AGENT_RUNTIME_ENABLED = "yes-please";
  process.env.BRAIN_SALES_AGENT_RUNTIME_WA_IDS = "56912345678";
  assert.equal(shouldRouteToSalesAgentRuntime("56912345678"), false);
});

test("[R3-Route-7] independent from every other pilot allowlist in the repo (BRAIN_AUTONOMOUS_TEST_WA_IDS / BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS)", () => {
  process.env.BRAIN_SALES_AGENT_RUNTIME_ENABLED = "true";
  delete process.env.BRAIN_SALES_AGENT_RUNTIME_WA_IDS;
  const previousAutonomousWaIds = process.env.BRAIN_AUTONOMOUS_TEST_WA_IDS;
  const previousCommercialWorkWaIds = process.env.BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS;
  process.env.BRAIN_AUTONOMOUS_TEST_WA_IDS = "56912345678";
  process.env.BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS = "56912345678";
  try {
    assert.equal(shouldRouteToSalesAgentRuntime("56912345678"), false, "a waId allowlisted for a DIFFERENT pilot must not route to SalesAgentRuntime");
  } finally {
    if (previousAutonomousWaIds === undefined) delete process.env.BRAIN_AUTONOMOUS_TEST_WA_IDS;
    else process.env.BRAIN_AUTONOMOUS_TEST_WA_IDS = previousAutonomousWaIds;
    if (previousCommercialWorkWaIds === undefined) delete process.env.BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS;
    else process.env.BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS = previousCommercialWorkWaIds;
  }
});
