import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool } from "@/lib/db";
import { runNativeAgentToolLoopCycle } from "@/lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle";
import { createFakeAgentLoopProvider } from "@/lib/brain/commercial/agent-loop/providers/fakeAgentLoopProvider";
import type { CommercialContextSnapshot } from "@/lib/brain/commercial/context/buildNativeCommercialContext";
import {
  SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_CONFIGURATION_SCOPE,
  SALES_AGENT_FOLLOW_UP_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT,
  type ResolvedSalesAgentConfiguration
} from "@/lib/brain/commercial/sales-agent-configuration";

/**
 * LLM-R1-T09B, Part 1/8. Proves the real wiring inside runNativeAgentToolLoopCycle.ts
 * (not just the pure shouldRouteToMultiIntentPlanner function - see
 * shouldRouteToMultiIntentPlanner.test.ts for that) - input.waId genuinely
 * reaches the routing decision. Differentiator: the same raw provider output
 * ({intents:[...]}) is a valid multi-intent PLANNER response, but is
 * structurally invalid as a legacy AgentStep (no `type` field) - the two
 * paths' own llmCalls phase sequence diverges observably as a result:
 * multi-intent = ["gathering" (planner), "finalization" (finalizer)];
 * legacy = ["gathering", "gathering"] (schema-invalid retry, same phase,
 * before ever reaching finalization).
 */

const DB_ENV = {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "main_management",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "main_management",
  DATABASE_USER: "crm_app",
  DATABASE_PASSWORD: "una_clave_local",
  DATABASE_URL: ""
};
Object.assign(process.env, DB_ENV);

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

async function withEnv<T>(overrides: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const previous = { ...process.env };
  Object.assign(process.env, overrides);
  try {
    return await fn();
  } finally {
    process.env = previous;
  }
}

function buildSnapshot(): CommercialContextSnapshot {
  return {
    contractName: "CommercialContext",
    schemaVersion: "1.0",
    status: "success",
    completeness: "minimal",
    customer: null,
    conversation: null,
    recentMessages: [],
    opportunity: null,
    needProfile: null,
    actions: [],
    signals: {
      hasCustomer: false,
      hasOpportunity: false,
      hasNeedProfile: false,
      hasRecentMessages: false,
      humanOwnerActive: false,
      aiBlocked: false,
      staleContext: false,
      identityConflict: false
    },
    identityConflict: null,
    shippingDestination: null,
    commercialLineItems: null,
    availableCapabilities: [],
    warnings: [],
    customer360: null,
    customer360State: "not_requested",
    customerSession: null,
    metadata: { source: "native_mariadb", conversationPublicId: "test-conv-routing", currentTime: "2026-08-14T15:00:00.000Z" }
  };
}

function buildResolvedConfig(): ResolvedSalesAgentConfiguration {
  return {
    source: "safe_default",
    scopeKey: SALES_AGENT_CONFIGURATION_SCOPE,
    recordId: null,
    version: null,
    configurationHash: null,
    configuration: SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
    effectiveModelConfiguration: SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT,
    effectiveLoopConfiguration: SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT,
    effectiveFollowUpConfiguration: SALES_AGENT_FOLLOW_UP_CONFIGURATION_SAFE_DEFAULT
  };
}

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function buildInput(waId: string) {
  const suffix = uniqueSuffix("route");
  return {
    conversationId: Math.floor(Date.now() % 1_000_000) + Math.floor(Math.random() * 1000),
    waId,
    inboundMessageId: `msg-${suffix}`,
    correlationId: `corr-${suffix}`,
    currentTime: "2026-08-14T15:00:00.000Z",
    customerMessage: "quiero 2 de la classic",
    abortSignal: null,
    snapshot: buildSnapshot(),
    resolvedSalesAgentConfiguration: buildResolvedConfig()
  };
}

/** {intents:[...]} - a valid multi-intent planner response, but has no `.type`, so validateAgentStep rejects it as a legacy AgentStep. */
const AMBIGUOUS_RAW_OUTPUT = { intents: [{ type: "unsupported", description: "test" }] };
const FALLBACK_RESPOND = { type: "respond", message: "ok" };

test("[MI-RouteIntegration-1] an allowlisted waId with the flag on routes through the multi-intent planner (planner then finalizer phases)", async () => {
  await withEnv({ BRAIN_MULTI_INTENT_PLANNER_ENABLED: "true", BRAIN_AUTONOMOUS_TEST_WA_IDS: "56911112222" }, async () => {
    const provider = createFakeAgentLoopProvider({ script: [AMBIGUOUS_RAW_OUTPUT, FALLBACK_RESPOND] });
    const result = await runNativeAgentToolLoopCycle({ ...buildInput("56911112222"), provider });
    assert.deepEqual(
      result.loop.llmCalls.map((call) => call.phase),
      ["gathering", "finalization"],
      "the planner call is tagged gathering, the finalizer call is tagged finalization - only the multi-intent loop produces this sequence for an {intents:...} first response"
    );
  });
});

test("[MI-RouteIntegration-2] a non-allowlisted waId with the flag on stays on the legacy path (two gathering-phase calls, schema-invalid retry)", async () => {
  await withEnv({ BRAIN_MULTI_INTENT_PLANNER_ENABLED: "true", BRAIN_AUTONOMOUS_TEST_WA_IDS: "56911112222" }, async () => {
    const provider = createFakeAgentLoopProvider({ script: [AMBIGUOUS_RAW_OUTPUT, FALLBACK_RESPOND] });
    const result = await runNativeAgentToolLoopCycle({ ...buildInput("56900009999"), provider });
    assert.deepEqual(
      result.loop.llmCalls.map((call) => call.phase),
      ["gathering", "gathering"],
      "the legacy loop rejects {intents:...} as a malformed AgentStep and retries within the SAME gathering phase - it never reaches finalization for this script"
    );
  });
});

test("[MI-RouteIntegration-3] the flag off routes an otherwise-allowlisted waId to the legacy path too", async () => {
  await withEnv({ BRAIN_MULTI_INTENT_PLANNER_ENABLED: "false", BRAIN_AUTONOMOUS_TEST_WA_IDS: "56911112222" }, async () => {
    const provider = createFakeAgentLoopProvider({ script: [AMBIGUOUS_RAW_OUTPUT, FALLBACK_RESPOND] });
    const result = await runNativeAgentToolLoopCycle({ ...buildInput("56911112222"), provider });
    assert.deepEqual(result.loop.llmCalls.map((call) => call.phase), ["gathering", "gathering"]);
  });
});
