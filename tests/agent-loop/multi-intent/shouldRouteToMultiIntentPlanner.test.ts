import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { shouldRouteToMultiIntentPlanner } from "@/lib/brain/commercial/config/commercialCycleConfig";

/**
 * LLM-R1-T09B, Part 1/8. Routing must never be a global switch: only an
 * explicitly allowlisted waId, with the flag on, reaches the multi-intent
 * planner - every other combination (flag off, empty/missing allowlist,
 * non-matching waId, missing waId) fails closed to the legacy path.
 */

const ENV_KEYS = ["BRAIN_MULTI_INTENT_PLANNER_ENABLED", "BRAIN_AUTONOMOUS_TEST_WA_IDS"] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

test("[MI-Route-1] flag on + allowlisted waId routes to the multi-intent planner", () => {
  process.env.BRAIN_MULTI_INTENT_PLANNER_ENABLED = "true";
  process.env.BRAIN_AUTONOMOUS_TEST_WA_IDS = "56912345678,56987654321";
  assert.equal(shouldRouteToMultiIntentPlanner("56912345678"), true);
  assert.equal(shouldRouteToMultiIntentPlanner("+56 9 8765 4321"), true, "digit-normalized match (spaces/plus)");
});

test("[MI-Route-2] flag on + non-allowlisted waId stays on the legacy path", () => {
  process.env.BRAIN_MULTI_INTENT_PLANNER_ENABLED = "true";
  process.env.BRAIN_AUTONOMOUS_TEST_WA_IDS = "56912345678";
  assert.equal(shouldRouteToMultiIntentPlanner("56900000000"), false);
});

test("[MI-Route-3] flag on + missing/empty allowlist fails closed for everyone (ambiguous config, never \"everyone\")", () => {
  process.env.BRAIN_MULTI_INTENT_PLANNER_ENABLED = "true";
  delete process.env.BRAIN_AUTONOMOUS_TEST_WA_IDS;
  assert.equal(shouldRouteToMultiIntentPlanner("56912345678"), false);

  process.env.BRAIN_AUTONOMOUS_TEST_WA_IDS = "";
  assert.equal(shouldRouteToMultiIntentPlanner("56912345678"), false);

  process.env.BRAIN_AUTONOMOUS_TEST_WA_IDS = "   ,  ,";
  assert.equal(shouldRouteToMultiIntentPlanner("56912345678"), false, "an allowlist that normalizes to zero real entries is still empty");
});

test("[MI-Route-4] flag on + missing/null waId fails closed, even with a non-empty allowlist", () => {
  process.env.BRAIN_MULTI_INTENT_PLANNER_ENABLED = "true";
  process.env.BRAIN_AUTONOMOUS_TEST_WA_IDS = "56912345678";
  assert.equal(shouldRouteToMultiIntentPlanner(null), false);
  assert.equal(shouldRouteToMultiIntentPlanner(undefined), false);
  assert.equal(shouldRouteToMultiIntentPlanner(""), false);
});

test("[MI-Route-5] flag off routes everyone to legacy, regardless of allowlist", () => {
  process.env.BRAIN_MULTI_INTENT_PLANNER_ENABLED = "false";
  process.env.BRAIN_AUTONOMOUS_TEST_WA_IDS = "56912345678";
  assert.equal(shouldRouteToMultiIntentPlanner("56912345678"), false);

  delete process.env.BRAIN_MULTI_INTENT_PLANNER_ENABLED;
  assert.equal(shouldRouteToMultiIntentPlanner("56912345678"), false, "unset flag defaults to disabled, same as buildMultiIntentPlannerFeatureFlags");
});

test("[MI-Route-6] a malformed flag value fails closed (readEnvFlag's own fallback=false), never silently enabled", () => {
  process.env.BRAIN_MULTI_INTENT_PLANNER_ENABLED = "yes-please";
  process.env.BRAIN_AUTONOMOUS_TEST_WA_IDS = "56912345678";
  assert.equal(shouldRouteToMultiIntentPlanner("56912345678"), false);
});
