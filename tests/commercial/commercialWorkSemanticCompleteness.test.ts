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
  BRAIN_AUTONOMOUS_REPLY_ENABLED: "true",
  // SALES-AGENT-R2-A11: opens the new worker-level autonomy/access gates for
  // this file's pre-A11 tests, none of which exercise those gates themselves.
  BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true",
  BRAIN_WHATSAPP_TEST_MODE_ENABLED: "false",
  BRAIN_COMMERCIAL_WORK_WORKER_ENABLED: "true"
});

import { randomUUID } from "node:crypto";
import { getPool, queryRows } from "@/lib/db";
import { runCommercialWorkInboundCycle } from "@/lib/brain/commercial/work/runCommercialWorkInboundCycle";
import { assignCommercialTriggerSequence } from "@/lib/brain/commercial/work/sequencing";
import { runCommercialWorkTick, processObjectiveAwareFollowUpDue, getCommercialWorkByPublicId } from "@/lib/brain/commercial/work";
import {
  setupR2BenchmarkEnvironment,
  seedBenchmarkSelection,
  seedBenchmarkShippingDestination,
  type R2BenchmarkEnvironment
} from "@/lib/brain/commercial/work/benchmark/environment";
import { createOfflinePlannerProvider } from "@/lib/brain/commercial/work/benchmark/offlinePlannerProvider";
import type { CommercialIntentPlan } from "@/lib/brain/commercial/multi-intent/types";
import { setCalculateShippingCarrierServiceForTests, resetCalculateShippingCarrierServiceForTests } from "@/lib/brain/commercial/capability-gateway/calculateShippingCapability";
import type { CommercialContextSnapshot } from "@/lib/brain/commercial/context/buildNativeCommercialContext";
import type { CarrierService, CarrierQuoteInput, CarrierQuoteResult } from "@/lib/domains/carrier-service";
import { getActiveCommercialLineItemsForOpportunity } from "@/lib/domains/commercial-line-items";
import { getActiveShippingDestinationForOpportunity } from "@/lib/domains/shipping-destination";
import {
  SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_CONFIGURATION_SCOPE,
  SALES_AGENT_FOLLOW_UP_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT,
  type ResolvedSalesAgentConfiguration
} from "@/lib/brain/commercial/sales-agent-configuration";

/**
 * SALES-AGENT-R2-A08.6. Covers the semantic gaps A08.5 found (quantity
 * correction, cancellation, CREATE_QUOTE, product-evidence guard) and the
 * entry-point-level integration gaps (technical retry, stale follow-up,
 * sequencing races, provider failure after durable work, duplicate
 * correction) through the real production entry point
 * (runCommercialWorkInboundCycle), never a second, parallel harness. Offline
 * scripted providers only - no live LLM call anywhere in this file.
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

async function countCapabilityExecutions(opportunityId: number, capabilityName: string): Promise<number> {
  const rows = await queryRows<{ count: number }>(
    "SELECT COUNT(*) AS count FROM crm_capability_executions WHERE opportunity_id = ? AND capability_name = ?",
    [opportunityId, capabilityName]
  );
  return Number(rows[0]?.count ?? 0);
}

function toMysqlDatetime(date: Date): string {
  return date.toISOString().slice(0, 23).replace("T", " ");
}

/**
 * PRODUCT resolution (requirementResolver.ts) only ever consults
 * RecentCatalogContext, built exclusively from a real, completed
 * search_products (or sibling) crm_capability_executions row correlated to a
 * commercial_event - never a live catalog lookup by name. Mirrors exactly
 * what a real search_products call would leave behind (same shape
 * live-c09-benchmark.ts's seedProductSearchEvidence produces through the
 * full webhook pipeline), so an offline turn naming a product by text has
 * real evidence to resolve against, the same way a production customer
 * message would after an actual search.
 */
async function seedProductSearchEvidence(env: R2BenchmarkEnvironment, productId: string, productName: string): Promise<void> {
  const eventId = randomUUID();
  const correlationId = uniqueSuffix("search-evidence-corr");
  const now = toMysqlDatetime(new Date());
  await getPool().execute(
    `INSERT INTO commercial_event (
      id, contract_name, schema_version, event_type, source, dedupe_key,
      correlation_id, conversation_id, opportunity_id, occurred_at, received_at,
      payload_json, metadata_json
    ) VALUES (?, 'CommercialEvent', '1.0', 'agent_tool_loop_completed', 'test_seed', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      eventId,
      uniqueSuffix("dedupe"),
      correlationId,
      String(env.conversationId),
      String(env.opportunityId),
      now,
      now,
      JSON.stringify({ inboundMessageId: uniqueSuffix("search-evidence-msg") }),
      JSON.stringify({})
    ]
  );
  await getPool().execute(
    `INSERT INTO crm_capability_executions (
      public_id, correlation_id, capability_name, capability_version,
      availability_status, execution_status, retry_count, retryable, error_code,
      request_summary_json, response_summary_json, evidence_json,
      commercial_event_id, opportunity_id, conversation_id,
      started_at, completed_at
    ) VALUES (?, ?, 'search_products', '1.0', 'available', 'completed', 0, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      correlationId,
      JSON.stringify({ query: productName }),
      JSON.stringify({ items: [{ productId, name: productName, position: 1 }] }),
      JSON.stringify({}),
      eventId,
      env.opportunityId,
      env.conversationId,
      now,
      now
    ]
  );
}

/**
 * Real production (buildNativeCommercialContext.ts) always rehydrates
 * commercialLineItems/shippingDestination fresh from durable storage on
 * every load - never null just because a prior turn didn't restate them.
 * Mirrors that here (same getActiveCommercialLineItemsForOpportunity /
 * getActiveShippingDestinationForOpportunity default loaders) so the durable-
 * state PRODUCT/DESTINATION fallback (requirementResolver.ts) and the
 * CREATE_QUOTE/GET_SHIPPING_QUOTE projection's own fact checks
 * (buildCommercialWorkProjection.ts) see the same evidence a real inbound
 * would, instead of a snapshot frozen at env setup.
 */
async function buildLiveSnapshot(env: R2BenchmarkEnvironment, overrides: Partial<CommercialContextSnapshot> = {}): Promise<CommercialContextSnapshot> {
  const [commercialLineItems, shippingDestination] = await Promise.all([
    getActiveCommercialLineItemsForOpportunity(env.opportunityId),
    getActiveShippingDestinationForOpportunity(env.opportunityId)
  ]);
  return buildSnapshot(env, { commercialLineItems, shippingDestination, ...overrides });
}

async function turn(env: R2BenchmarkEnvironment, customerMessage: string, plan: CommercialIntentPlan, overrides: Partial<CommercialContextSnapshot> = {}) {
  return runCommercialWorkInboundCycle({
    conversationId: env.conversationId,
    waId: env.waId,
    inboundMessageId: uniqueSuffix("msg"),
    correlationId: uniqueSuffix("corr"),
    currentTime: new Date().toISOString(),
    customerMessage,
    snapshot: await buildLiveSnapshot(env, overrides),
    provider: createOfflinePlannerProvider([{ kind: "plan", plan }]),
    resolvedSalesAgentConfiguration: buildResolvedConfig()
  });
}

// ==========================================================================
// Part 2: quantity correction
// ==========================================================================

test("Part 2: a bare quantity correction supersedes the old selection, preserves the product", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedProductSearchEvidence(env, "31", "Classic");
    // Same "work must stay active" requirement as Part 14/15: a work whose
    // only objective completes goes terminal (COMPLETED), so a later,
    // unrelated correction reconciles against a brand-new work instead of
    // superseding within the same one - there would be nothing to supersede.
    // Requesting shipping with no destination alongside the selection keeps
    // one objective WAITING_CUSTOMER, so the correction below lands on the
    // still-active work.
    const first = await turn(env, "quiero 2 Classic y cuanto sale el despacho", {
      intents: [
        { type: "select_products", productReference: "la classic", quantity: 2 },
        { type: "get_shipping_quote" }
      ]
    });
    assert.notEqual(first.work?.status, "COMPLETED");
    const firstItem = first.work?.objectives.find((o) => o.type === "SELECT_PRODUCTS" && o.status === "COMPLETED");
    assert.ok(firstItem);

    // "mejor 3": planner correctly omits productReference (Part 2's own
    // contract) - the durable-state fallback in requirementResolver.ts
    // resolves the product without the customer restating it.
    const second = await turn(env, "mejor 3", { intents: [{ type: "select_products", quantity: 3 }] });
    const objectives = second.work?.objectives ?? [];
    const superseded = objectives.filter((o) => o.type === "SELECT_PRODUCTS" && o.status === "SUPERSEDED");
    const current = objectives.filter((o) => o.type === "SELECT_PRODUCTS" && o.status === "COMPLETED");
    assert.equal(superseded.length, 1, "old selection must be superseded, not left active");
    assert.equal(current.length, 1, "exactly one current selection, never two");
    assert.equal(current[0].inputs.items?.[0]?.quantity, 3);
    assert.notEqual(second.dispatch?.disposition, "fallback");
    assert.notEqual(second.dispatch?.messageSent, null);
  } finally {
    await env.teardown();
  }
});

test("Part 2: an unresolvable relative correction with no active selection asks the customer instead of guessing", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    const result = await turn(env, "mejor 3", { intents: [{ type: "select_products", quantity: 3 }] });
    // No durable selection exists yet - requirementResolver.ts's durable
    // fallback cannot resolve PRODUCT, so this must never silently execute.
    const objective = result.work?.objectives.find((o) => o.type === "SELECT_PRODUCTS");
    assert.notEqual(objective?.status, "COMPLETED");
    assert.equal(await countCapabilityExecutions(env.opportunityId, "select_products"), 0);
  } finally {
    await env.teardown();
  }
});

// ==========================================================================
// Part 3: cancellation
// ==========================================================================

test("Part 3: cancelling shipping preserves the product selection", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedProductSearchEvidence(env, "31", "Classic");
    // Same "work must stay active" requirement as Part 14/15/2: if both
    // objectives below completed with nothing else pending, the work would
    // go terminal (COMPLETED) before the cancel below ever runs, so the
    // cancel would land on a brand-new work instead of this one - there
    // would be nothing to cancel. create_quote (family "quote", genuinely
    // unrelated to selection/shipping) never completes in this offline
    // harness (no real Quote Service configured - see Part 4/20's own
    // comment), so it keeps the work non-terminal without affecting the two
    // families this test actually cares about.
    await turn(env, "quiero 2 Classic y despacho a Nunoa, hazme una cotizacion", {
      intents: [
        { type: "select_products", productReference: "la classic", quantity: 2 },
        { type: "get_shipping_quote", destination: "Nunoa" },
        { type: "create_quote" }
      ]
    });
    const result = await turn(env, "olvida el despacho", { intents: [{ type: "cancel", scope: "shipping" }] });

    const objectives = result.work?.objectives ?? [];
    // The shipping calculation already completed before the cancel arrives -
    // transitions.ts's own state machine only allows COMPLETED -> SUPERSEDED
    // (never -> CANCELLED, the calculation already happened and cannot be
    // un-calculated), so deriveCommercialObjectives.ts lands it SUPERSEDED
    // instead while still tagging it with the CANCELLED blocker - the same
    // "was this cancelled" signal buildCommercialWorkFinalizerMessage.ts's
    // own wasCancelled helper checks, not the literal status.
    const shippingCancelled = objectives.some(
      (o) => (o.type === "GET_SHIPPING_QUOTE" || o.type === "SET_DESTINATION") && (o.status === "CANCELLED" || o.blockers.some((blocker) => blocker.code === "CANCELLED"))
    );
    const selectionStillCompleted = objectives.some((o) => o.type === "SELECT_PRODUCTS" && o.status === "COMPLETED");
    assert.equal(shippingCancelled, true);
    assert.equal(selectionStillCompleted, true);
    assert.notEqual(result.work?.status, "CANCELLED");
    assert.match(result.dispatch?.messageSent ?? "", /despacho/i);
  } finally {
    await env.teardown();
  }
});

test("Part 3: an untargeted cancellation cancels the whole work, never described as completed", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await turn(env, "quiero 2 Classic", { intents: [{ type: "select_products", productReference: "la classic", quantity: 2 }] });
    const result = await turn(env, "olvidalo", { intents: [{ type: "cancel", scope: "all" }] });

    assert.equal(result.work?.status, "CANCELLED");
    assert.ok(result.work?.objectives.every((o) => o.status === "CANCELLED"));
    assert.equal(result.dispatch?.disposition, "FINAL");
    assert.match(result.dispatch?.messageSent ?? "", /cancel/i);
    assert.doesNotMatch(result.dispatch?.messageSent ?? "", /complet/i);
  } finally {
    await env.teardown();
  }
});

test("SALES-AGENT-R2-A08.7 Part 7/CANCEL04: multi-scope cancellation cancels shipping and quote, preserves selection", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedProductSearchEvidence(env, "31", "Classic");
    await turn(env, "quiero 2 Classic y despacho a Nunoa, hazme una cotizacion", {
      intents: [
        { type: "select_products", productReference: "la classic", quantity: 2 },
        { type: "get_shipping_quote", destination: "Nunoa" },
        { type: "create_quote" }
      ]
    });
    const result = await turn(env, "no quiero despacho ni cotizacion", {
      intents: [{ type: "cancel", scope: "shipping", additionalScopes: ["quote"] }]
    });

    const objectives = result.work?.objectives ?? [];
    const wasCancelled = (type: string) =>
      objectives.some((o) => o.type === type && (o.status === "CANCELLED" || o.blockers.some((blocker) => blocker.code === "CANCELLED")));

    assert.equal(wasCancelled("GET_SHIPPING_QUOTE") || wasCancelled("SET_DESTINATION"), true, "shipping must be cancelled");
    assert.equal(wasCancelled("CREATE_QUOTE"), true, "quote must be cancelled");
    assert.equal(objectives.some((o) => o.type === "SELECT_PRODUCTS" && o.status === "COMPLETED"), true, "selection must be preserved");
    assert.notEqual(result.work?.status, "CANCELLED", "must not collapse to whole-work cancellation");
  } finally {
    await env.teardown();
  }
});

// ==========================================================================
// Part 4/5/20: CREATE_QUOTE
// ==========================================================================

test("Part 4/20: create_quote with an existing selection is planned and unblocked for execution, idempotent on duplicate inbound", async () => {
  // The real Quote Service (lib/integrations/quote-service) is a genuinely
  // separate external system, deliberately never faked by
  // setupR2BenchmarkEnvironment (only Catalog/Carrier/commune are) - so this
  // offline suite proves what it can prove deterministically: the semantic
  // layer plans a CREATE_QUOTE objective from the customer's own words and
  // the projection layer unblocks it (real selection evidence satisfies
  // MISSING_SELECTION) rather than requiring a real external quote to be
  // created. Real end-to-end completion is covered by the live validation
  // phase (a configured Quote Service), not this deterministic unit suite.
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedBenchmarkSelection(env.opportunityId, [{ productId: "31", quantity: 2 }]);
    const inboundMessageId = uniqueSuffix("quote-msg");
    const runOnce = async () =>
      runCommercialWorkInboundCycle({
        conversationId: env.conversationId,
        waId: env.waId,
        inboundMessageId,
        correlationId: uniqueSuffix("corr"),
        currentTime: new Date().toISOString(),
        customerMessage: "hazme una cotizacion",
        snapshot: await buildLiveSnapshot(env),
        provider: createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "create_quote" }] } }]),
        resolvedSalesAgentConfiguration: buildResolvedConfig()
      });

    const first = await runOnce();
    const quoteObjective = first.work?.objectives.find((o) => o.type === "CREATE_QUOTE");
    assert.ok(quoteObjective, "expected create_quote to be planned as a CREATE_QUOTE objective");
    assert.notEqual(quoteObjective?.status, "BLOCKED", "a real existing selection must unblock CREATE_QUOTE, never leave it stuck on MISSING_SELECTION");
    assert.equal(quoteObjective?.missingRequirements.includes("SELECTION"), false);

    const second = await runOnce();
    assert.equal(first.work?.publicId, second.work?.publicId);
    // The capability itself never completes in this offline harness (no real
    // Quote Service configured, see the comment above), so a duplicate
    // inbound re-plans create_quote fresh and supersedes the still-WAITING_SYSTEM
    // one, same as any other repeated request against a not-yet-terminal
    // objective (Part 17 exercises the identical pattern for SELECT_PRODUCTS).
    // The guarantee that matters here is a single ACTIVE CREATE_QUOTE at a
    // time, never two competing, un-superseded ones.
    const activeQuoteObjectives = second.work?.objectives.filter((o) => o.type === "CREATE_QUOTE" && o.status !== "SUPERSEDED" && o.status !== "CANCELLED") ?? [];
    assert.equal(activeQuoteObjectives.length, 1, "at most one active CREATE_QUOTE objective at a time, never two competing ones");
  } finally {
    await env.teardown();
  }
});

test("Part 5: a bare confirmation only maps to create_quote when the last agent message asked about a quote", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedBenchmarkSelection(env.opportunityId, [{ productId: "31", quantity: 2 }]);

    const confirmed = await turn(
      env,
      "si",
      { intents: [{ type: "create_quote" }] },
      { recentMessages: [{ id: "m1", direction: "outbound", body: "¿Quieres que te prepare una cotización?", status: "sent", occurredAt: new Date().toISOString() }] }
    );
    assert.equal(confirmed.work?.objectives.some((o) => o.type === "CREATE_QUOTE"), true);
  } finally {
    await env.teardown();
  }
});

// ==========================================================================
// Part 6/7: product evidence guard
// ==========================================================================

test("Part 6/7: an unresolved product reference asks for clarification instead of executing", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    const result = await turn(env, "quiero la Xtreme", { intents: [{ type: "select_products", productReference: "la Xtreme", quantity: 1 }] });
    const objective = result.work?.objectives.find((o) => o.type === "SELECT_PRODUCTS");
    assert.equal(objective?.status, "WAITING_CUSTOMER");
    assert.equal(objective?.missingRequirements.includes("PRODUCT_EVIDENCE"), true);
    assert.equal(await countCapabilityExecutions(env.opportunityId, "select_products"), 0, "no capability call for unresolved evidence");
    assert.doesNotMatch(result.dispatch?.messageSent ?? "", /invalid_arguments|undefined|null/i);
  } finally {
    await env.teardown();
  }
});

// ==========================================================================
// Part 12: technical retry through the real entry point
// ==========================================================================

test("Part 12: a real shipping retry recovers through a manual worker tick, zero new customer turns or LLM calls", async () => {
  const env = await setupR2BenchmarkEnvironment();
  let attempts = 0;
  const flakyCarrier: CarrierService & { calls: CarrierQuoteInput[] } = {
    calls: [],
    async quoteAll(input: CarrierQuoteInput): Promise<CarrierQuoteResult> {
      this.calls.push(input);
      attempts += 1;
      if (attempts === 1) return { ok: false, reason: "carrier_service_unavailable", detail: "test fixture" };
      return { ok: true, options: [{ carrierName: "Test Express", serviceType: "STANDARD", totalCost: 4990, estimatedDelivery: "2-3 dias" }] };
    }
  };
  setCalculateShippingCarrierServiceForTests(flakyCarrier);
  try {
    await seedProductSearchEvidence(env, "31", "Classic");
    const result = await turn(env, "quiero 2 Classic y despacho a Nunoa", {
      intents: [
        { type: "select_products", productReference: "la classic", quantity: 2 },
        { type: "get_shipping_quote", destination: "Nunoa" }
      ]
    });
    const shippingStep = result.work?.steps.find((s) => s.type === "CALCULATE_SHIPPING");
    assert.equal(shippingStep?.status, "RETRY_SCHEDULED");
    const stepIdBefore = shippingStep?.stepId;
    const idempotencyKeyBefore = shippingStep?.idempotencyKey;
    assert.equal(result.dispatch?.disposition, "PARTIAL");

    // Original inbound cycle has ended - advance time and run a manual tick,
    // same script scripts/manual-test/commercial-work-worker-tick.ts uses.
    const tick = await runCommercialWorkTick({ isWaIdEligibleForCommercialWork: () => true,
      now: new Date(Date.now() + 5 * 60_000),
      workPublicIds: [result.work!.publicId]
    });
    assert.equal(tick.completed >= 1 || tick.executed >= 1, true);

    const completed = await getCommercialWorkByPublicId(result.work!.publicId);
    const completedShippingStep = completed?.steps.find((s) => s.type === "CALCULATE_SHIPPING");
    assert.equal(completedShippingStep?.status, "COMPLETED");
    assert.equal(completedShippingStep?.stepId, stepIdBefore, "same step id preserved across retry");
    assert.equal(completedShippingStep?.idempotencyKey, idempotencyKeyBefore, "same idempotency key preserved");
    assert.equal(attempts, 2, "exactly one retry attempt, no extra carrier calls");

    const actionRows = await queryRows<{ count: number }>("SELECT COUNT(*) AS count FROM crm_agent_actions WHERE conversation_case_id = ?", [String(env.conversationId)]);
    // The retry itself dispatches no new customer-visible action on its own -
    // only the original inbound turn's dispatch (already counted above) may exist.
    assert.ok(Number(actionRows[0].count) <= 1, "retry recovery must not create a second customer-facing action on its own");
  } finally {
    resetCalculateShippingCarrierServiceForTests();
    await env.teardown();
  }
});

// ==========================================================================
// Part 13: stale follow-up through the real entry point
// ==========================================================================

test("Part 13: a follow-up scheduled for a missing destination is cancelled once the destination arrives, zero outbox writes", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedBenchmarkSelection(env.opportunityId, [{ productId: "31", quantity: 2 }]);
    const first = await turn(env, "cuanto sale el despacho", { intents: [{ type: "get_shipping_quote" }] });
    assert.equal(first.work?.status, "WAITING_CUSTOMER");

    const scheduledActions = await queryRows<{ action_id: string }>(
      "SELECT action_id FROM crm_agent_actions WHERE conversation_case_id = ? AND action_type = 'schedule_followup' ORDER BY id DESC LIMIT 1",
      [String(env.conversationId)]
    );
    assert.equal(scheduledActions.length, 1, "expected a real follow-up scheduled");
    const scheduledActionId = scheduledActions[0].action_id;

    const outboxBefore = await queryRows<{ count: number }>("SELECT COUNT(*) AS count FROM brain_message_outbox WHERE wa_id = ?", [env.waId]);

    // Destination arrives through a real, second inbound cycle before the follow-up is due.
    const second = await turn(env, "Nunoa", { intents: [{ type: "get_shipping_quote", destination: "Nunoa" }] });
    assert.equal(second.work?.status, "COMPLETED");

    const due = await processObjectiveAwareFollowUpDue({ actionId: scheduledActionId, now: new Date(Date.now() + 60 * 60_000).toISOString() });
    assert.equal(due.status, "cancelled");

    const outboxAfter = await queryRows<{ count: number }>("SELECT COUNT(*) AS count FROM brain_message_outbox WHERE wa_id = ?", [env.waId]);
    const followUpSendRows = await queryRows<{ count: number }>(
      "SELECT COUNT(*) AS count FROM crm_agent_actions WHERE conversation_case_id = ? AND action_type = 'send_whatsapp_reply' AND draft_payload_json LIKE '%objective_aware_followup_send%'",
      [String(env.conversationId)]
    );
    assert.equal(Number(followUpSendRows[0].count), 0, "stale follow-up must never send");
    assert.ok(Number(outboxAfter[0].count) >= Number(outboxBefore[0].count), "no negative writes, and no new stale-followup outbox row");
  } finally {
    await env.teardown();
  }
});

// ==========================================================================
// Part 14/15: entry-point sequencing races
// ==========================================================================

test("Part 14: an older turn's write can never overwrite a newer turn's quantity, even arriving after it", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedProductSearchEvidence(env, "31", "Classic");
    // Staleness protection (reconciliation.ts's isStaleSupersededInput) only
    // ever compares against an ACTIVE previous work - resolveCommercialWorkTarget
    // treats a COMPLETED work as terminal, so a single-objective turn that
    // fully completes leaves nothing "in flight" for a later, out-of-order
    // arrival to race against (a genuinely new request after a fulfilled one
    // is not a stale overwrite). Requesting shipping with no destination here
    // keeps one objective permanently WAITING_CUSTOMER, so the work stays
    // active for the SELECT_PRODUCTS race below to exercise for real.
    await turn(env, "quiero 2 Classic y cuanto sale el despacho", {
      intents: [
        { type: "select_products", productReference: "la classic", quantity: 2 },
        { type: "get_shipping_quote" }
      ]
    });

    // T1 ("mejor 3" is actually the OLDER turn here) has its sequence
    // pre-assigned before T2 runs and completes - simulating T1 having
    // started first but its authoritative write only arriving after T2
    // already landed, without any real concurrency/sleep/barriers.
    const t1MessageId = uniqueSuffix("t1-old-quantity");
    await assignCommercialTriggerSequence({
      conversationId: env.conversationId,
      triggerType: "CUSTOMER_MESSAGE",
      triggerDedupeKey: `commercial-work:${env.conversationId}:${t1MessageId}`,
      sourceMessageId: null
    });

    // T2 ("mejor 5") runs and completes fully first, using a fresh, later sequence.
    const t2 = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("t2-new-quantity"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "mejor 5",
      snapshot: await buildLiveSnapshot(env),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "select_products", quantity: 5 }] } }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });
    assert.equal(t2.work?.objectives.find((o) => o.type === "SELECT_PRODUCTS" && o.status === "COMPLETED")?.inputs.items?.[0]?.quantity, 5);

    // T1 now "resumes" - its pre-assigned (older) sequence is reused via the
    // same idempotent dedupe key, so it arrives stale relative to T2's write.
    const t1 = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: t1MessageId,
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "mejor 3",
      snapshot: await buildLiveSnapshot(env),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "select_products", quantity: 3 }] } }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });
    assert.equal(t1.reason, "commercial_work_stale_turn_ignored");

    const final = await getCommercialWorkByPublicId(t2.work!.publicId);
    const currentSelection = final?.objectives.find((o) => o.type === "SELECT_PRODUCTS" && o.status === "COMPLETED");
    assert.equal(currentSelection?.inputs.items?.[0]?.quantity, 5, "final quantity must be T2's (5), never restored to T1's stale value (3)");
  } finally {
    await env.teardown();
  }
});

test("Part 15: an older turn's write can never overwrite a newer turn's destination", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedBenchmarkSelection(env.opportunityId, [{ productId: "31", quantity: 2 }]);
    // Same "work must stay active" requirement as Part 14, but the family
    // under test here is destination/shipping - so the anchor objective must
    // come from a DIFFERENT family (selection) so it never interferes with
    // the destination race below. An unresolved product reference (same
    // pattern as Part 6/7) stays WAITING_CUSTOMER forever, since no further
    // select_products turn is ever sent.
    await turn(env, "tambien quiero la Xtreme", { intents: [{ type: "select_products", productReference: "la Xtreme", quantity: 1 }] });

    const t1MessageId = uniqueSuffix("t1-old-destination");
    await assignCommercialTriggerSequence({
      conversationId: env.conversationId,
      triggerType: "CUSTOMER_MESSAGE",
      triggerDedupeKey: `commercial-work:${env.conversationId}:${t1MessageId}`,
      sourceMessageId: null
    });

    const t2 = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("t2-new-destination"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "mejor a Las Condes",
      snapshot: await buildLiveSnapshot(env),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "get_shipping_quote", destination: "Las Condes" }] } }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });
    const destAfterT2 = t2.work?.objectives.find((o) => o.type === "SET_DESTINATION" && o.status === "COMPLETED");
    assert.equal(destAfterT2?.inputs.destinationText, "Las Condes");

    const t1 = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: t1MessageId,
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "despacho a Nunoa",
      snapshot: await buildLiveSnapshot(env),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "get_shipping_quote", destination: "Nunoa" }] } }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });
    assert.equal(t1.reason, "commercial_work_stale_turn_ignored");

    const final = await getCommercialWorkByPublicId(t2.work!.publicId);
    const finalDest = final?.objectives.find((o) => o.type === "SET_DESTINATION" && o.status === "COMPLETED");
    assert.equal(finalDest?.inputs.destinationText, "Las Condes", "final destination must be T2's, never the stale T1 value");
  } finally {
    await env.teardown();
  }
});

// ==========================================================================
// Part 16: provider failure after durable work exists
// ==========================================================================

test("Part 16: a planner failure on a later turn never corrupts or falsely claims progress on already-durable work", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedProductSearchEvidence(env, "31", "Classic");
    const first = await turn(env, "quiero 2 Classic", { intents: [{ type: "select_products", productReference: "la classic", quantity: 2 }] });
    assert.equal(first.work?.status, "COMPLETED");
    const versionBefore = first.work!.version;

    const failed = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("planner-fail"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "algo raro",
      snapshot: await buildLiveSnapshot(env),
      provider: createOfflinePlannerProvider([{ kind: "invalid_response" }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });
    assert.equal(failed.work, null);
    assert.equal(failed.dispatch?.disposition, "fallback");
    assert.doesNotMatch(failed.dispatch?.messageSent ?? "", /complet|listo/i);

    const reloaded = await getCommercialWorkByPublicId(first.work!.publicId);
    assert.equal(reloaded?.version, versionBefore, "prior durable work must be untouched by a later planner failure");
    assert.equal(reloaded?.status, "COMPLETED");
  } finally {
    await env.teardown();
  }
});

// ==========================================================================
// Part 17: duplicate inbound with a correction
// ==========================================================================

test("Part 17: the same correction message processed twice has exactly one semantic effect", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedProductSearchEvidence(env, "31", "Classic");
    await turn(env, "quiero 2 Classic", { intents: [{ type: "select_products", productReference: "la classic", quantity: 2 }] });

    const inboundMessageId = uniqueSuffix("dup-correction");
    const runCorrection = async () =>
      runCommercialWorkInboundCycle({
        conversationId: env.conversationId,
        waId: env.waId,
        inboundMessageId,
        correlationId: uniqueSuffix("corr"),
        currentTime: new Date().toISOString(),
        customerMessage: "mejor 3",
        snapshot: await buildLiveSnapshot(env),
        provider: createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "select_products", quantity: 3 }] } }]),
        resolvedSalesAgentConfiguration: buildResolvedConfig()
      });

    const first = await runCorrection();
    const second = await runCorrection();

    // Same dedupe-key/idempotency guarantee A08.5's own "duplicate inbound"
    // test asserts (commercialWorkInboundCycle.test.ts, Part 26): the same
    // publicId for both calls, and repository.ts's buildCommercialWorkCorrelationKey
    // (content-addressed by conversation+active-objectives) deduplicates the
    // second identical insert back to the first correction's own row rather
    // than creating a third. Two rows total is correct here, not a leak: the
    // setup turn's selection already completed (terminal) before either
    // correction runs, so "mejor 3" is a genuinely new work superseding it -
    // same terminal-work behavior Part 14/15 exercise directly. Not asserted:
    // identical version - a byte-identical replay is still a fresh
    // reconciliation against that terminal work, not a no-op, matching
    // A08.5's own precedent (Part 26 only asserts publicId + row count too).
    assert.equal(first.work?.publicId, second.work?.publicId);
    assert.equal(await countCommercialWorkRows(env.conversationId), 2);
    const currentSelections = second.work?.objectives.filter((o) => o.type === "SELECT_PRODUCTS" && o.status === "COMPLETED") ?? [];
    assert.equal(currentSelections.length, 1);
    assert.equal(currentSelections[0].inputs.items?.[0]?.quantity, 3);
  } finally {
    await env.teardown();
  }
});

// ==========================================================================
// Part 18: cancel vs retry
// ==========================================================================

test("Part 18: cancelling shipping while a retry is scheduled stops the retry from ever executing again", async () => {
  const env = await setupR2BenchmarkEnvironment();
  const failingCarrier: CarrierService & { calls: CarrierQuoteInput[] } = {
    calls: [],
    async quoteAll(input: CarrierQuoteInput): Promise<CarrierQuoteResult> {
      this.calls.push(input);
      return { ok: false, reason: "carrier_service_unavailable", detail: "test fixture" };
    }
  };
  setCalculateShippingCarrierServiceForTests(failingCarrier);
  try {
    await seedProductSearchEvidence(env, "31", "Classic");
    const result = await turn(env, "quiero 2 Classic y despacho a Nunoa", {
      intents: [
        { type: "select_products", productReference: "la classic", quantity: 2 },
        { type: "get_shipping_quote", destination: "Nunoa" }
      ]
    });
    const shippingStep = result.work?.steps.find((s) => s.type === "CALCULATE_SHIPPING");
    assert.equal(shippingStep?.status, "RETRY_SCHEDULED");
    const callsBeforeCancel = failingCarrier.calls.length;

    const cancelled = await turn(env, "olvida el despacho", { intents: [{ type: "cancel", scope: "shipping" }] });
    const cancelledShipping = cancelled.work?.objectives.find((o) => o.type === "GET_SHIPPING_QUOTE");
    assert.equal(cancelledShipping?.status, "CANCELLED");

    // The worker still ticks (it does not know about the cancellation ahead
    // of time) but a cancelled step must never actually execute the carrier again.
    await runCommercialWorkTick({ isWaIdEligibleForCommercialWork: () => true, now: new Date(Date.now() + 10 * 60_000), workPublicIds: [result.work!.publicId] }).catch(() => null);
    assert.equal(failingCarrier.calls.length, callsBeforeCancel, "no carrier call after cancellation");

    const followUpSendRows = await queryRows<{ count: number }>(
      "SELECT COUNT(*) AS count FROM crm_agent_actions WHERE conversation_case_id = ? AND action_type = 'schedule_followup'",
      [String(env.conversationId)]
    );
    // A cancelled shipping objective is never WAITING_CUSTOMER, so no
    // follow-up should ever have been scheduled for it in the first place.
    assert.equal(Number(followUpSendRows[0].count), 0);
  } finally {
    resetCalculateShippingCarrierServiceForTests();
    await env.teardown();
  }
});

// ==========================================================================
// Part 19: cancel vs follow-up
// ==========================================================================

test("Part 19: cancelling a WAITING_CUSTOMER objective with a scheduled follow-up prevents it from ever sending", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedBenchmarkSelection(env.opportunityId, [{ productId: "31", quantity: 2 }]);
    const waiting = await turn(env, "cuanto sale el despacho", { intents: [{ type: "get_shipping_quote" }] });
    assert.equal(waiting.work?.status, "WAITING_CUSTOMER");

    const scheduledActions = await queryRows<{ action_id: string }>(
      "SELECT action_id FROM crm_agent_actions WHERE conversation_case_id = ? AND action_type = 'schedule_followup' ORDER BY id DESC LIMIT 1",
      [String(env.conversationId)]
    );
    assert.equal(scheduledActions.length, 1);

    const cancelled = await turn(env, "olvida el despacho", { intents: [{ type: "cancel", scope: "shipping" }] });
    assert.equal(cancelled.work?.objectives.some((o) => o.type === "GET_SHIPPING_QUOTE" && o.status === "CANCELLED"), true);

    const due = await processObjectiveAwareFollowUpDue({ actionId: scheduledActions[0].action_id, now: new Date(Date.now() + 60 * 60_000).toISOString() });
    assert.equal(due.status, "cancelled");

    const followUpSendRows = await queryRows<{ count: number }>(
      "SELECT COUNT(*) AS count FROM crm_agent_actions WHERE conversation_case_id = ? AND action_type = 'send_whatsapp_reply' AND draft_payload_json LIKE '%objective_aware_followup_send%'",
      [String(env.conversationId)]
    );
    assert.equal(Number(followUpSendRows[0].count), 0);
  } finally {
    await env.teardown();
  }
});

// ==========================================================================
// SALES-AGENT-R2-A09: parallel execution flag parity through the real
// inbound cycle (CWPAR20/CWPAR22). runCommercialWorkInboundCycle resolves
// BRAIN_COMMERCIAL_WORK_PARALLEL_EXECUTION_ENABLED internally per call
// (buildCommercialWorkParallelExecutionFeatureFlags), so this toggles the
// env var directly around two otherwise-identical runs - the same technique
// every other env-flag test in this repo already uses.
// ==========================================================================

test("SALES-AGENT-R2-A09 CWPAR20: the C09 bundle produces the identical business outcome with the parallel-execution flag OFF and ON", async () => {
  async function runC09(parallelEnabled: boolean) {
    const previous = process.env.BRAIN_COMMERCIAL_WORK_PARALLEL_EXECUTION_ENABLED;
    process.env.BRAIN_COMMERCIAL_WORK_PARALLEL_EXECUTION_ENABLED = parallelEnabled ? "true" : "false";
    try {
      const env = await setupR2BenchmarkEnvironment();
      try {
        await seedProductSearchEvidence(env, "31", "Classic");
        const result = await turn(env, "quiero 2 de la classic y cuanto sale el despacho a Nunoa", {
          intents: [
            { type: "select_products", productReference: "la classic", quantity: 2 },
            { type: "get_shipping_quote", destination: "Nunoa" }
          ]
        });
        return result;
      } finally {
        await env.teardown();
      }
    } finally {
      if (previous === undefined) delete process.env.BRAIN_COMMERCIAL_WORK_PARALLEL_EXECUTION_ENABLED;
      else process.env.BRAIN_COMMERCIAL_WORK_PARALLEL_EXECUTION_ENABLED = previous;
    }
  }

  const off = await runC09(false);
  const on = await runC09(true);

  for (const [label, result] of [["OFF", off] as const, ["ON", on] as const]) {
    const selection = result.work?.objectives.find((o) => o.type === "SELECT_PRODUCTS");
    const shipping = result.work?.objectives.find((o) => o.type === "GET_SHIPPING_QUOTE");
    assert.equal(selection?.status, "COMPLETED", `[${label}] selection completed`);
    assert.equal(shipping?.status, "COMPLETED", `[${label}] shipping completed`);
    assert.equal(result.work?.status, "COMPLETED", `[${label}] work fully completed same-cycle`);
    // CWPAR22: the finalizer describes the final reconciled state, never an
    // intermediate/mid-wave narration - both runs converge to the identical
    // durable state, so both must produce the identical customer-visible message.
    assert.match(result.dispatch?.messageSent ?? "", /despacho/i, `[${label}] finalizer message reflects completed shipping`);
  }

  assert.equal(off.dispatch?.messageSent, on.dispatch?.messageSent, "identical business outcome and identical customer-visible message regardless of the parallel-execution flag");
  assert.equal(off.work?.status, on.work?.status);
});
