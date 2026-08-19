import assert from "node:assert/strict";
import test, { after } from "node:test";

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "crm_test",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "crm_test",
  DATABASE_USER: "crm_app",
  DATABASE_PASSWORD: "una_clave_local",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true",
  BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED: "true",
  BRAIN_AGENT_ACTION_QUEUE_ENABLED: "true",
  BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED: "true",
  BRAIN_EXECUTION_GATE_ENABLED: "true",
  BRAIN_OUTBOX_BRIDGE_ENABLED: "true",
  BRAIN_AUTONOMOUS_SANDBOX_ENABLED: "true",
  BRAIN_AUTONOMOUS_REPLY_ENABLED: "true"
});

import { getPool, queryRows } from "@/lib/db";
import { runCommercialWorkInboundCycle } from "@/lib/brain/commercial/work/runCommercialWorkInboundCycle";
import { shouldRouteToCommercialWork } from "@/lib/brain/commercial/config/commercialCycleConfig";
import { setupR2BenchmarkEnvironment, seedBenchmarkSelection, type R2BenchmarkEnvironment } from "@/lib/brain/commercial/work/benchmark/environment";
import { createOfflinePlannerProvider } from "@/lib/brain/commercial/work/benchmark/offlinePlannerProvider";
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
 * SALES-AGENT-R2-A08.5. Covers the NEW production inbound entry point
 * (routing gate + runCommercialWorkInboundCycle) - never re-proves what A08's
 * commercialWorkSequencing.test.ts (sequencing/reconciliation primitives) or
 * A07.5's r2ArchitectureScenarios.test.ts (CommercialWork module end-to-end,
 * R2-01..R2-12) already cover at the module level. Fixture/offline provider
 * only - no live LLM call anywhere in this file (Part 34 discipline).
 */

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

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

function buildSnapshot(env: R2BenchmarkEnvironment, overrides: Partial<CommercialContextSnapshot> = {}): CommercialContextSnapshot {
  return {
    contractName: "CommercialContext",
    schemaVersion: "1.0",
    status: "success",
    completeness: "minimal",
    customer: null,
    conversation: { id: env.conversationId, publicId: "test-conv", channel: "whatsapp", provider: "meta", externalContactId: env.waId, status: "open", aiEnabled: true, humanOwnerActive: false, lastMessageAt: null },
    recentMessages: [],
    opportunity: {
      id: env.opportunityId,
      opportunityKey: `opp-${env.opportunityId}`,
      status: "open",
      stage: null,
      primaryIntent: "sales",
      currentSummary: null,
      nextActionType: null,
      nextActionDueAt: null,
      waitingFor: null,
      humanOwnerActive: false,
      aiBlocked: false,
      customerCandidateId: null,
      customerMasterId: env.masterCustomerId,
      leadId: null,
      conversationCaseId: env.conversationId,
      waId: env.waId,
      requirements: [],
      missingRequirements: [],
      productInterests: [],
      objections: [],
      signals: [],
      version: 1,
      lastActivityAt: new Date().toISOString(),
      closedAt: null
    },
    needProfile: null,
    actions: [],
    signals: {
      hasCustomer: false,
      hasOpportunity: true,
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
    metadata: { source: "native_mariadb", conversationPublicId: "test-conv", currentTime: new Date().toISOString() },
    ...overrides
  } as CommercialContextSnapshot;
}

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function countCommercialWorkRows(conversationId: number): Promise<number> {
  const rows = await queryRows<{ count: number }>("SELECT COUNT(*) AS count FROM crm_commercial_work WHERE conversation_id = ?", [conversationId]);
  return Number(rows[0]?.count ?? 0);
}

// ==========================================================================
// shouldRouteToCommercialWork - pure routing gate (Part 13, non-allowlisted regression)
// ==========================================================================

test("shouldRouteToCommercialWork: fails closed when the runtime flag is off", () => {
  // buildCommercialWorkRuntimeFeatureFlags reads process.env directly for the
  // flag itself (same pattern as buildMultiIntentPlannerFeatureFlags) - only
  // the allowlist lookup honors a passed `env` override, so the flag must be
  // flipped on process.env directly here.
  const previous = process.env.BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED;
  process.env.BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED = "false";
  try {
    assert.equal(shouldRouteToCommercialWork("56912345678", { ...process.env, BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS: "56912345678" }), false);
  } finally {
    process.env.BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED = previous;
  }
});

test("shouldRouteToCommercialWork: fails closed when the allowlist is empty, even with the flag on", () => {
  const env = { ...process.env, BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED: "true", BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS: "" };
  assert.equal(shouldRouteToCommercialWork("56912345678", env), false);
});

test("shouldRouteToCommercialWork: false for a waId outside the allowlist, true for one inside it", () => {
  const env = { ...process.env, BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED: "true", BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS: "56912345678" };
  assert.equal(shouldRouteToCommercialWork("56999999999", env), false);
  assert.equal(shouldRouteToCommercialWork("56912345678", env), true);
});

test("shouldRouteToCommercialWork: independent of the multi-intent pilot's own allowlist", () => {
  const env = {
    ...process.env,
    BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED: "true",
    BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS: "",
    BRAIN_AUTONOMOUS_TEST_WA_IDS: "56912345678"
  };
  assert.equal(shouldRouteToCommercialWork("56912345678", env), false);
});

// ==========================================================================
// runCommercialWorkInboundCycle
// ==========================================================================

test("Part 21: human_owner_active blocks the turn before any LLM call or mutation", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    const snapshot = buildSnapshot(env, { signals: { ...buildSnapshot(env).signals, humanOwnerActive: true } });
    const provider = createOfflinePlannerProvider([{ kind: "invalid_response" }]); // would throw if ever invoked
    const result = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "quiero 2 classic",
      snapshot,
      provider,
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });
    assert.equal(result.ran, false);
    assert.equal(result.humanOwnerActive, true);
    assert.equal(result.work, null);
    assert.equal(await countCommercialWorkRows(env.conversationId), 0);
  } finally {
    await env.teardown();
  }
});

test("happy path: selection + shipping resolves to a durable CommercialWork and a dispatched reply", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    const provider = createOfflinePlannerProvider([
      { kind: "plan", plan: { intents: [{ type: "select_products", productReference: "la classic", quantity: 2 }, { type: "get_shipping_quote", destination: "Nunoa" }] } }
    ]);
    const result = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "quiero 2 de la classic y cuanto sale el despacho a Nunoa",
      snapshot: buildSnapshot(env),
      provider,
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });

    assert.equal(result.ran, true);
    assert.ok(result.work, "expected a persisted CommercialWork");
    assert.ok(result.dispatch, "expected a dispatch result");
    assert.notEqual(result.dispatch?.disposition, "fallback");
    assert.equal(await countCommercialWorkRows(env.conversationId), 1);
  } finally {
    await env.teardown();
  }
});

test("Part 25: a planner failure before planning mutates nothing and dispatches a controlled fallback", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    const provider = createOfflinePlannerProvider([{ kind: "invalid_response" }]);
    const result = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "quiero 2 classic",
      snapshot: buildSnapshot(env),
      provider,
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });

    assert.equal(result.ran, true);
    assert.equal(result.work, null);
    assert.equal(result.dispatch?.disposition, "fallback");
    assert.equal(await countCommercialWorkRows(env.conversationId), 0);
  } finally {
    await env.teardown();
  }
});

test("Part 26: duplicate inbound (same inboundMessageId twice) reuses the same commercial sequence, no duplicate work", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    const inboundMessageId = uniqueSuffix("msg");
    const buildProvider = () =>
      createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "select_products", productReference: "la classic", quantity: 2 }] } }]);

    const first = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId,
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "quiero 2 classic",
      snapshot: buildSnapshot(env),
      provider: buildProvider(),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });
    const second = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId,
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "quiero 2 classic",
      snapshot: buildSnapshot(env),
      provider: buildProvider(),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });

    assert.equal(first.work?.publicId, second.work?.publicId);
    assert.equal(await countCommercialWorkRows(env.conversationId), 1);
  } finally {
    await env.teardown();
  }
});

test("Part 19: an objective left WAITING_CUSTOMER schedules an objective-aware follow-up", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    // A durable selection already exists (CALCULATE_SHIPPING's line-items
    // dependency is satisfied) but no destination - the step becomes READY,
    // the capability gateway returns missing_information, and the step (and
    // objective) end WAITING_CUSTOMER, same setup as R2-03's own scenario.
    await seedBenchmarkSelection(env.opportunityId, [{ productId: "31", quantity: 2 }]);
    const provider = createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "get_shipping_quote" }] } }]);
    const result = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "cuanto sale el despacho",
      snapshot: buildSnapshot(env),
      provider,
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });

    assert.equal(result.ran, true);
    assert.equal(result.work?.status, "WAITING_CUSTOMER");
    const scheduled = await queryRows<{ count: number }>(
      "SELECT COUNT(*) AS count FROM crm_agent_actions WHERE action_type = 'schedule_followup' AND conversation_case_id = ?",
      [env.conversationId]
    );
    assert.ok(Number(scheduled[0]?.count ?? 0) >= 1, "expected an objective-aware follow-up to be scheduled");
  } finally {
    await env.teardown();
  }
});

test("no opportunity yet: controlled fallback, never a thrown error", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    const snapshot = buildSnapshot(env, { opportunity: null, signals: { ...buildSnapshot(env).signals, hasOpportunity: false } });
    const result = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "hola",
      snapshot,
      provider: createOfflinePlannerProvider([{ kind: "invalid_response" }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });
    assert.equal(result.ran, true);
    assert.equal(result.reason, "commercial_work_no_opportunity");
    assert.equal(result.work, null);
  } finally {
    await env.teardown();
  }
});
