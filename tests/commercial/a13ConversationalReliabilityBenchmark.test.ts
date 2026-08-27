import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
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
  // Deterministic regardless of ambient .env: no live Customer Profile
  // service is reachable in this sandbox - same discipline as
  // repeatPurchaseE2E.test.ts/customerAwareRecommendationE2E.test.ts.
  CUSTOMER_PROFILE_ENABLED: "false"
});

import { getPool, queryRows } from "@/lib/db";
import { getActiveCommercialLineItemsForOpportunity } from "@/lib/domains/commercial-line-items";
import { getActiveShippingDestinationForOpportunity } from "@/lib/domains/shipping-destination";
import { runCommercialWorkInboundCycle } from "@/lib/brain/commercial/work/runCommercialWorkInboundCycle";
import { runCommercialWorkTick, getCommercialWorkByPublicId } from "@/lib/brain/commercial/work";
import { resetCapabilityGatewayCatalogPortForTests } from "@/lib/brain/commercial/capability-gateway/registry";
import { resetSharedCustomerProfileClientForTests } from "@/lib/integrations/customer-profile";
import { resolveObservedShippingOption } from "@/lib/brain/commercial/agent-loop/resolveObservedShippingOption";
import {
  setupR2BenchmarkEnvironment,
  seedBenchmarkSelection,
  seedBenchmarkShippingDestination,
  setConversationControl,
  type R2BenchmarkEnvironment
} from "@/lib/brain/commercial/work/benchmark/environment";
import { createOfflinePlannerProvider } from "@/lib/brain/commercial/work/benchmark/offlinePlannerProvider";
import type { CommercialContextSnapshot } from "@/lib/brain/commercial/context/buildNativeCommercialContext";
import type { CommercialIntentPlan } from "@/lib/brain/commercial/multi-intent/types";
import type { CustomerSessionDecisionContext, NativeCustomerSessionExecutionContext } from "@/lib/brain/commercial/native-cycle/customer-session/types";
import type { RuntimeIdentityContext } from "@/lib/brain/commercial/native-cycle/customer-session/runtimeIdentityContext";
import {
  SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_CONFIGURATION_SCOPE,
  SALES_AGENT_FOLLOW_UP_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT,
  type ResolvedSalesAgentConfiguration
} from "@/lib/brain/commercial/sales-agent-configuration";
import {
  buildRuntimeIdentity,
  runtimeIdentityAtLevel,
  PLAN_SELECT_CLASSIC_QTY2,
  PLAN_SELECT_PRO_QTY1,
  PLAN_SELECT_AMBIGUOUS_BARRA,
  PLAN_SELECT_NO_MATCH,
  PLAN_QUANTITY_CORRECTION,
  PLAN_SHIPPING_QUOTE_NUNOA,
  PLAN_SHIPPING_QUOTE_NO_DESTINATION,
  PLAN_SHIPPING_QUOTE_LAS_CONDES,
  PLAN_SELECT_SHIPPING_OPTION_FIRST,
  PLAN_CREATE_QUOTE,
  PLAN_CANCEL_SELECTION,
  PLAN_REPEAT_PURCHASE,
  PLAN_CUSTOMER_AWARE_RECOMMENDATION,
  PLAN_UNSUPPORTED,
  PLAN_MULTI_INTENT_SELECT_AND_SHIP
} from "./fixtures/a13-conversational-reliability-scenarios";

/**
 * SALES-AGENT-R2-A13. Conversational Reliability Benchmark.
 *
 * Drives the real, canonical CommercialWork inbound entry point
 * (runCommercialWorkInboundCycle - see docs/releases/
 * SALES-AGENT-R2-A13-conversational-reliability-benchmark.md Part 1 for the
 * full entry-point/pipeline audit) turn by turn, with an offline/deterministic
 * planner provider (never a live LLM call in this file) and the real
 * Capability Gateway/MariaDB crm_test backend - same discipline every existing
 * CommercialWork E2E test in this codebase already follows
 * (commercialWorkInboundCycle.test.ts, repeatPurchaseE2E.test.ts,
 * customerAwareRecommendationE2E.test.ts, readyToLinkE2E.test.ts).
 *
 * This file establishes a BASELINE against the current HEAD - it does not fix
 * any defect it finds. A finding is recorded as a comment tagged
 * `FINDING (P0|P1|P2|P3)` next to the assertion that exposes it; the release
 * doc groups every such finding by root cause.
 */

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

function uniqueSuffix(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
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

function customerSessionDecision(identity: RuntimeIdentityContext): CustomerSessionDecisionContext {
  return {
    schemaVersion: "1.0.0",
    identity: { status: "identified", hasResolvedCustomer: true, source: "customer_service" },
    runtimeIdentity: identity,
    onboarding: null,
    contextAccess: "commercial_history",
    operations: { canAttemptResolve: true, canProposeCreateCustomer: true, canProposeLinkExternalIdentity: true }
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

/** Same defense-in-depth duality repeatPurchaseE2E.test.ts documents: the projection gate reads snapshot.customerSession, the capability itself re-checks customerSessionExecution.runtimeIdentity - both must carry the SAME identity to reach a real dispatch. */
function buildTrustedSession(env: R2BenchmarkEnvironment, identity: RuntimeIdentityContext): NativeCustomerSessionExecutionContext {
  return {
    conversationId: String(env.conversationId),
    opportunityId: String(env.opportunityId),
    trustedInbound: { channel: "whatsapp", externalId: env.waId, normalizedPhone: env.waId, messageId: uniqueSuffix("msg"), receivedAt: new Date().toISOString() },
    identity: { status: "anonymous", customerId: null, source: "none", localResolutionOutcome: "anonymous", externalResolutionOutcome: null },
    masterCustomerIdentity: { status: "identity_unresolved", reason: "identity_absent" },
    runtimeIdentity: identity,
    onboarding: null,
    contextAccess: "none",
    currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: null },
    freshExternalResolutionEvidence: null
  };
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

async function countCompletedCapabilityExecutions(opportunityId: number, capabilityName: string): Promise<number> {
  const rows = await queryRows<{ count: number }>(
    "SELECT COUNT(*) AS count FROM crm_capability_executions WHERE opportunity_id = ? AND capability_name = ? AND execution_status = 'completed'",
    [opportunityId, capabilityName]
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * runCommercialWorkInboundCycle.ts's FIRST projection pass (inside
 * reconcileCommercialTrigger) AND the multi-intent semantic planner's own
 * requirement resolver (requirementResolver.ts's durable-state fallbacks)
 * both read input.snapshot.commercialLineItems/shippingDestination VERBATIM,
 * never a fresh DB read - only settleCommercialWorkProjection's own later
 * rounds refetch real durable facts directly. A snapshot that omits a
 * durable selection/destination seeded directly via seedBenchmarkSelection()/
 * a prior real turn (bypassing the snapshot entirely) is a test-harness
 * inconsistency real production never has (buildNativeCommercialContext
 * always builds the snapshot from the same durable state each turn).
 *
 * Left unsynced, this does not just affect readiness - it can make the
 * semantic planner treat an already-fully-resolved intent as still
 * "waiting_for_information" (its PRODUCT_SELECTION/DESTINATION requirement
 * reads a stale empty snapshot even though the real projection completed it
 * via its own independent DB reads), causing that intent to be persisted as
 * a "pending commercial intent" and RE-SURFACED as a spurious extra seed on
 * the very next turn (pendingIntentState.ts/mergeCommercialIntents) -
 * confirmed via a direct comparison of objectiveIds using numeric
 * (sourceMessageId-bearing) inboundMessageIds across two turns, which showed
 * "carried-looking" objectives actually stamped with the LATER turn's own
 * message id, not the earlier one's - i.e. freshly re-derived, not carried.
 * Call this before each turn that follows a real or seeded durable
 * selection/destination to keep the snapshot honest, exactly like a real
 * snapshot builder would.
 */
async function durableStateSnapshotOverride(opportunityId: number) {
  const [commercialLineItems, shippingDestination] = await Promise.all([
    getActiveCommercialLineItemsForOpportunity(opportunityId),
    getActiveShippingDestinationForOpportunity(opportunityId)
  ]);
  return { commercialLineItems, shippingDestination };
}

function findObjective(work: Awaited<ReturnType<typeof runCommercialWorkInboundCycle>>["work"], type: string) {
  return work?.objectives.filter((o) => o.type === type).slice(-1)[0] ?? null;
}

function liveObjectivesOfType(work: Awaited<ReturnType<typeof runCommercialWorkInboundCycle>>["work"], type: string) {
  return work?.objectives.filter((o) => o.type === type && o.status !== "SUPERSEDED" && o.status !== "CANCELLED") ?? [];
}

// ==========================================================================
// Custom Catalog Service fixture - a configurable superset of the shared
// benchmark's catalogRequestHandler (agent-loop/benchmark/environment.ts).
// That shared fixture's /api/v2/catalog/resolve-product-intent is
// deliberately query-agnostic (always both products, always
// clarification_required) - several A13 scenarios need a REAL
// resolved/no_match distinction by query text, which is not injectable
// through any existing seam (registry.ts's catalog port is env-var driven
// only, see resetCapabilityGatewayCatalogPortForTests). This local HTTP
// server is additive test-only infrastructure, never a change to production
// code, mirroring the exact same technique setupBenchmarkEnvironment already
// uses (real HTTP on 127.0.0.1, env var pointed at it, port cache reset).
// ==========================================================================

type FixtureProduct = { productId: string; name: string; shortDescription: string; price: number; stockQuantity: number; weightKg: number };

const A13_PRODUCTS: Record<string, FixtureProduct> = {
  "31": { productId: "31", name: "Barra Olimpica Classic 20kg", shortDescription: "Barra olimpica de acero, 20kg, uso general.", price: 89990, stockQuantity: 15, weightKg: 20 },
  "32": { productId: "32", name: "Barra Olimpica Pro 20kg", shortDescription: "Barra olimpica de competicion, 20kg, rodamientos de alta rotacion.", price: 149990, stockQuantity: 6, weightKg: 20 }
};

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function detailPayload(product: FixtureProduct) {
  return {
    product: { productId: Number(product.productId), name: product.name, sku: null, shortDescription: product.shortDescription, longDescription: null, active: true },
    variants: [],
    selectedVariant: null,
    pricing: { effectiveUnitPrice: product.price, currency: "CLP", taxIncluded: true, taxRate: 0.19, discountApplied: false },
    stock: { available: true, physicalQuantity: product.stockQuantity },
    weightKg: product.weightKg,
    freshness: { cached: false }
  };
}

function candidatePayload(product: FixtureProduct, rank: number) {
  return {
    product: {
      productId: product.productId,
      name: product.name,
      description: product.shortDescription,
      price: { amount: product.price, currency: "CLP" },
      stock: { status: "in_stock", available: true, quantity: product.stockQuantity }
    },
    match: { rank, score: 0.8, reasons: ["NAME_TOKEN_MATCH"] }
  };
}

/**
 * Query-text routing table, checked in order: "classic" -> product 31 alone
 * resolved; "pro" -> product 32 alone resolved; "inexistente" -> genuinely
 * zero matches (no_match); anything else -> both fixture products,
 * clarification_required (same ambiguous-by-default behavior the shared
 * fixture already has, so scenarios that want ambiguity need no special
 * query).
 */
function resolveIntentForQuery(query: string) {
  const normalized = query.toLowerCase();
  if (normalized.includes("inexistente")) {
    return { resolution: { status: "no_match" as const, confidence: 0 }, candidates: [], clarification: null };
  }
  if (normalized.includes("classic")) {
    return { resolution: { status: "resolved" as const, confidence: 0.95, sourceProduct: { productId: "31" } }, candidates: [candidatePayload(A13_PRODUCTS["31"], 1)], clarification: null };
  }
  if (normalized.includes("pro")) {
    return { resolution: { status: "resolved" as const, confidence: 0.95, sourceProduct: { productId: "32" } }, candidates: [candidatePayload(A13_PRODUCTS["32"], 1)], clarification: null };
  }
  return {
    resolution: { status: "clarification_required" as const, confidence: 0.5 },
    candidates: [candidatePayload(A13_PRODUCTS["31"], 1), candidatePayload(A13_PRODUCTS["32"], 2)],
    clarification: { dimension: "unspecified", options: [] }
  };
}

function a13CatalogRequestHandler(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = req.url ?? "";

  if (req.method === "POST" && url === "/api/v2/catalog/resolve-product-intent") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}") as { query?: string };
      const query = parsed.query ?? "";
      const resolved = resolveIntentForQuery(query);
      return sendJson(res, 200, {
        query: { original: query, normalized: query },
        ...resolved,
        statistics: { retrieved: resolved.candidates.length, eligible: resolved.candidates.length, returned: resolved.candidates.length },
        warnings: [],
        correlationId: "a13-benchmark"
      });
    });
    return;
  }

  if (req.method === "POST" && url === "/v1/products/batch") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}") as { items?: Array<{ productId: number }> };
      const items = (parsed.items ?? []).map((item) => {
        const product = A13_PRODUCTS[String(item.productId)];
        if (!product) return { ok: false, input: { productId: item.productId }, error: { code: "PRODUCT_NOT_FOUND", message: "not found" } };
        return { ok: true, input: { productId: item.productId }, product: detailPayload(product) };
      });
      sendJson(res, 200, { items });
    });
    return;
  }

  const detailMatch = url.match(/^\/v1\/products\/(\d+)/);
  if (req.method === "GET" && detailMatch) {
    const product = A13_PRODUCTS[detailMatch[1]];
    if (!product) return sendJson(res, 404, { error: { code: "PRODUCT_NOT_FOUND", message: "not found" } });
    return sendJson(res, 200, detailPayload(product));
  }

  return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "unmapped a13 fixture route" } });
}

/**
 * Points the Capability Gateway's catalog port at this local, query-aware
 * fixture server for the lifetime of one scenario. Always call `restore()`
 * (in a `finally`) - it puts CATALOG_SERVICE_BASE_URL/API_KEY back to
 * whatever setupR2BenchmarkEnvironment already configured and resets the
 * cached port again, so the NEXT test's environment is never contaminated.
 */
async function useA13CatalogFixture(): Promise<{ restore: () => Promise<void> }> {
  const server = http.createServer(a13CatalogRequestHandler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const previousBaseUrl = process.env.CATALOG_SERVICE_BASE_URL;
  const previousApiKey = process.env.CATALOG_SERVICE_API_KEY;
  process.env.CATALOG_SERVICE_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.CATALOG_SERVICE_API_KEY = "a13-benchmark-key";
  resetCapabilityGatewayCatalogPortForTests();

  return {
    restore: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (previousBaseUrl === undefined) delete process.env.CATALOG_SERVICE_BASE_URL;
      else process.env.CATALOG_SERVICE_BASE_URL = previousBaseUrl;
      if (previousApiKey === undefined) delete process.env.CATALOG_SERVICE_API_KEY;
      else process.env.CATALOG_SERVICE_API_KEY = previousApiKey;
      resetCapabilityGatewayCatalogPortForTests();
    }
  };
}

/** Simulates a Catalog outage: unsets the base URL so the Gateway's own catalogUnavailable() short-circuits to a deterministic, HTTP-free "catalog_service_not_configured" outcome - never a flaky real network timeout. */
async function useCatalogUnavailable(): Promise<{ restore: () => Promise<void> }> {
  const previousBaseUrl = process.env.CATALOG_SERVICE_BASE_URL;
  const previousApiKey = process.env.CATALOG_SERVICE_API_KEY;
  delete process.env.CATALOG_SERVICE_BASE_URL;
  delete process.env.CATALOG_SERVICE_API_KEY;
  resetCapabilityGatewayCatalogPortForTests();
  return {
    restore: async () => {
      if (previousBaseUrl === undefined) delete process.env.CATALOG_SERVICE_BASE_URL;
      else process.env.CATALOG_SERVICE_BASE_URL = previousBaseUrl;
      if (previousApiKey === undefined) delete process.env.CATALOG_SERVICE_API_KEY;
      else process.env.CATALOG_SERVICE_API_KEY = previousApiKey;
      resetCapabilityGatewayCatalogPortForTests();
    }
  };
}

const WORKER_GATES_OPEN = {
  workerEnabled: true,
  autonomousResponsesEnabled: true,
  whatsAppAccessGate: { testModeEnabled: false, testWaIds: [] as string[] },
  isWaIdEligibleForCommercialWork: () => true
};

// ==========================================================================
// A13-01: product search and selection
// ==========================================================================

test("A13-01 product_search_and_selection: a resolved product reference completes a real selection", async () => {
  const env = await setupR2BenchmarkEnvironment();
  const fixture = await useA13CatalogFixture();
  try {
    const result = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "quiero 2 de la classic",
      snapshot: buildSnapshot(env),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: PLAN_SELECT_CLASSIC_QTY2 }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });

    // INTENT_CORRECT / OBJECTIVE_CORRECT: a SELECT_PRODUCTS objective exists and completed for real.
    const objective = findObjective(result.work, "SELECT_PRODUCTS");
    assert.equal(objective?.status, "COMPLETED");
    assert.deepEqual(objective?.inputs.items, [{ productId: "31", combinationId: null, quantity: 2 }]);

    // CAPABILITY_CORRECT: exactly one search (to resolve the reference) and one select_products call, both real.
    assert.equal(await countCompletedCapabilityExecutions(env.opportunityId, "search_products"), 1);
    assert.equal(await countCompletedCapabilityExecutions(env.opportunityId, "select_products"), 1);

    // NO_FALSE_PRODUCT / NO_FALSE_PRICE: the finalizer never invents a catalog name/price beyond what it was given.
    assert.ok(result.dispatch?.messageSent);
    assert.equal(result.dispatch?.messageSent?.includes("149990"), false);
    assert.equal(result.dispatch?.messageSent?.includes("Pro"), false);

    // CORRECT_FINAL_RESPONSE
    assert.equal(result.dispatch?.disposition, "FINAL");
  } finally {
    await fixture.restore();
    await env.teardown();
  }
});

// ==========================================================================
// A13-02: ambiguity
// ==========================================================================

test("A13-02 ambiguity: a two-candidate reference fails closed and never guesses", async () => {
  const env = await setupR2BenchmarkEnvironment();
  const fixture = await useA13CatalogFixture();
  try {
    const result = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "quiero una barra olimpica",
      snapshot: buildSnapshot(env),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: PLAN_SELECT_AMBIGUOUS_BARRA }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });

    const objective = findObjective(result.work, "SELECT_PRODUCTS");
    // OBJECTIVE_CORRECT / CORRECT_DEGRADATION: WAITING_CUSTOMER, never a guessed single item.
    assert.equal(objective?.status, "WAITING_CUSTOMER");
    assert.equal(objective?.missingRequirements.includes("PRODUCT_AMBIGUOUS"), true);
    assert.equal(objective?.inputs.items, undefined);

    // NO_FALSE_PRODUCT: never silently picked one of the two candidates as a real commercial_line_items row.
    assert.equal(await countCompletedCapabilityExecutions(env.opportunityId, "select_products"), 0);

    // CORRECT_FINAL_RESPONSE
    assert.notEqual(result.dispatch?.disposition, "FINAL");
    assert.ok(result.dispatch?.messageSent);
  } finally {
    await fixture.restore();
    await env.teardown();
  }
});

// ==========================================================================
// A13-03: no results
// ==========================================================================

test("A13-03 no_results: a zero-candidate search reports not-found, never invents a product", async () => {
  const env = await setupR2BenchmarkEnvironment();
  const fixture = await useA13CatalogFixture();
  try {
    const result = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "quiero una mancuerna inexistente 999",
      snapshot: buildSnapshot(env),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: PLAN_SELECT_NO_MATCH }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });

    const objective = findObjective(result.work, "SELECT_PRODUCTS");
    assert.equal(objective?.status, "WAITING_CUSTOMER");
    assert.equal(objective?.missingRequirements.includes("PRODUCT_NOT_FOUND"), true);
    assert.equal(await countCompletedCapabilityExecutions(env.opportunityId, "select_products"), 0);
    assert.ok(result.dispatch?.messageSent);
    assert.notEqual(result.dispatch?.disposition, "FINAL");
  } finally {
    await fixture.restore();
    await env.teardown();
  }
});

// ==========================================================================
// A13-04: quantity changes
// ==========================================================================

test("A13-04 quantity_changes: a bare quantity correction supersedes without losing the product", async () => {
  const env = await setupR2BenchmarkEnvironment();
  const fixture = await useA13CatalogFixture();
  try {
    const first = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "quiero 2 de la classic",
      snapshot: buildSnapshot(env),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: PLAN_SELECT_CLASSIC_QTY2 }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });
    assert.equal(findObjective(first.work, "SELECT_PRODUCTS")?.status, "COMPLETED");

    const second = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "mejor 3",
      snapshot: buildSnapshot(env, await durableStateSnapshotOverride(env.opportunityId)),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: PLAN_QUANTITY_CORRECTION(3) }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });

    // STATE_CONTINUITY / NO_CONTEXT_LOSS: turn 1's single-objective work fully COMPLETED, which is a
    // TERMINAL CommercialWork status (transitions.ts). reconciliation.ts's resolveCommercialWorkTarget
    // looks up the conversation's current work via findActiveCommercialWorks, whose own status filter
    // (repository.ts's ACTIVE_WORK_STATUSES) excludes COMPLETED/CANCELLED/SUPERSEDED entirely - so a
    // later turn finds NO previous work at all (reason "no_work", not "terminal_work") and opens a
    // brand new, lineage-BLANK row (previousWorkPublicId/supersedesWorkPublicId both null - confirmed
    // directly, not assumed). Continuity for a correction like this one is carried entirely by DURABLE
    // FACTS (commercial_line_items), never by any CommercialWork-level lineage pointer.
    assert.notEqual(second.work?.publicId, first.work?.publicId, "a fully-completed work is terminal - a later turn opens a new, unrelated-at-the-work-level row");
    const liveSelections = liveObjectivesOfType(second.work, "SELECT_PRODUCTS");
    assert.equal(liveSelections.length, 1, "exactly one live SELECT_PRODUCTS objective, the old one superseded");
    assert.equal(liveSelections[0]?.status, "COMPLETED");
    assert.deepEqual(liveSelections[0]?.inputs.items, [{ productId: "31", combinationId: null, quantity: 3 }], "the product (31) is carried forward from durable state - only the quantity changed");

    // NO_DUPLICATE_EXECUTION: the correction is a genuinely different request (different quantity) so a second select_products call is correct, not a duplicate - but no THIRD, stray call happened.
    assert.equal(await countCompletedCapabilityExecutions(env.opportunityId, "select_products"), 2);
  } finally {
    await fixture.restore();
    await env.teardown();
  }
});

// ==========================================================================
// A13-05: product changes
// ==========================================================================

test("A13-05 product_changes: renaming the product supersedes the selection and invalidates stale shipping", async () => {
  const env = await setupR2BenchmarkEnvironment();
  const fixture = await useA13CatalogFixture();
  try {
    // Turn 1 also asks for a quote so the work stays ACTIVE/WAITING_SYSTEM (never terminal) across
    // turns - CREATE_QUOTE genuinely retries against no live Quote Service in this sandbox (see
    // A13-08/09), which is what keeps this work open for turn 2 to UPDATE the SAME row
    // (reconciliation.ts's resolveCommercialWorkTarget only opens a new row once the previous one
    // reaches a TERMINAL status - see A13-04's own finding). Without this, a product change always
    // lands in a brand-new, unrelated work (A13-04's case) and there is nothing in-work left to
    // invalidate - this scenario specifically targets the cross-turn, SAME-work invalidation path.
    const first = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "quiero 1 de la classic, cuanto cuesta el despacho a Nunoa, y hazme la cotizacion",
      snapshot: buildSnapshot(env),
      provider: createOfflinePlannerProvider([
        { kind: "plan", plan: { intents: [{ type: "select_products", productReference: "classic", quantity: 1 }, { type: "get_shipping_quote", destination: "Nunoa" }, { type: "create_quote" }] } }
      ]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });
    assert.equal(findObjective(first.work, "SELECT_PRODUCTS")?.status, "COMPLETED");
    assert.equal(findObjective(first.work, "GET_SHIPPING_QUOTE")?.status, "COMPLETED");
    assert.notEqual(first.work?.status, undefined);
    assert.ok(!["COMPLETED", "CANCELLED", "SUPERSEDED", "HANDOFF", "FAILED"].includes(first.work?.status ?? ""), `expected a non-terminal work status to keep this work open for turn 2, got: ${first.work?.status}`);

    const second = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "mejor quiero la pro",
      snapshot: buildSnapshot(env, await durableStateSnapshotOverride(env.opportunityId)),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: PLAN_SELECT_PRO_QTY1 }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });

    // STATE_CONTINUITY: the SAME work updates in place (never terminal after turn 1).
    assert.equal(second.work?.publicId, first.work?.publicId);

    const liveSelections = liveObjectivesOfType(second.work, "SELECT_PRODUCTS");
    assert.equal(liveSelections.length, 1, "the old Classic selection must be superseded by exactly one live selection, never two competing ones");
    assert.equal(liveSelections[0]?.status, "COMPLETED", "the product change to 'pro' should apply");
    assert.deepEqual(liveSelections[0]?.inputs.items, [{ productId: "32", combinationId: null, quantity: 1 }]);

    // OBJECTIVE_CORRECT / NO_FALSE_PRICE: the shipping quote computed against the OLD (Classic) cart
    // must not be presented as still valid for the NEW (Pro) cart - it must recalculate.
    const liveShipping = liveObjectivesOfType(second.work, "GET_SHIPPING_QUOTE");
    assert.equal(liveShipping.length, 1);
    assert.equal(liveShipping[0]?.status, "COMPLETED");
    assert.equal(await countCompletedCapabilityExecutions(env.opportunityId, "calculate_shipping"), 2, "expected a fresh recalculation after the product change, never a reused stale quote");
  } finally {
    await fixture.restore();
    await env.teardown();
  }
});

// ==========================================================================
// A13-06: repeat purchase
// ==========================================================================

test("A13-06 repeat_purchase: gated below LEVEL_3, dispatches once identity is upgraded", async () => {
  resetSharedCustomerProfileClientForTests();
  const env = await setupR2BenchmarkEnvironment();
  try {
    const level2Identity = runtimeIdentityAtLevel("LEVEL_2_MASTER_RESOLVED", "MASTER_RESOLVED", { masterCustomerId: String(env.masterCustomerId) });
    const first = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "quiero comprar lo mismo de la ultima vez",
      snapshot: buildSnapshot(env, { customerSession: customerSessionDecision(level2Identity) }),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: PLAN_REPEAT_PURCHASE }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig(),
      customerSessionExecution: buildTrustedSession(env, level2Identity)
    });

    // NO_UNAUTHORIZED_SIDE_EFFECT: below LEVEL_3, the objective is identity-blocked and the capability is never dispatched.
    assert.equal(findObjective(first.work, "REPEAT_PURCHASE")?.status, "WAITING_CUSTOMER");
    assert.equal(await countCapabilityExecutions(env.opportunityId, "get_customer_purchase_history"), 0);

    const level3Identity = runtimeIdentityAtLevel("LEVEL_3_PRESTASHOP_LINKED", "PRESTASHOP_LINKED", {
      masterCustomerId: String(env.masterCustomerId),
      prestashopCustomerId: "8801",
      policyCode: "PRESTASHOP_IDENTITY_SUFFICIENT"
    });
    const second = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "ya vincule mi cuenta, ahora si quiero lo mismo de la ultima vez",
      snapshot: buildSnapshot(env, { customerSession: customerSessionDecision(level3Identity) }),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: PLAN_REPEAT_PURCHASE }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig(),
      customerSessionExecution: buildTrustedSession(env, level3Identity)
    });

    // STATE_CONTINUITY: same work, unblocked once LEVEL_3 is genuinely reached.
    assert.equal(second.work?.publicId, first.work?.publicId);
    // CAPABILITY_CORRECT / CORRECT_DEGRADATION: the real Gateway is dispatched; Customer Profile is unreachable in this sandbox, so a real, observable failure is the correct (not silently swallowed, not fabricated) outcome.
    assert.equal(await countCapabilityExecutions(env.opportunityId, "get_customer_purchase_history"), 1);
    const executions = await queryRows<{ execution_status: string; error_code: string | null }>(
      "SELECT execution_status, error_code FROM crm_capability_executions WHERE opportunity_id = ? AND capability_name = 'get_customer_purchase_history'",
      [env.opportunityId]
    );
    assert.equal(executions[0]?.execution_status, "failed");
    assert.equal(executions[0]?.error_code, "customer_profile_unavailable");
  } finally {
    await env.teardown();
  }
});

// ==========================================================================
// A13-07: customer-aware recommendation
// ==========================================================================

test("A13-07 customer_aware_recommendation: degrades to a generic search when the signal is unavailable", async () => {
  resetSharedCustomerProfileClientForTests();
  const env = await setupR2BenchmarkEnvironment();
  const fixture = await useA13CatalogFixture();
  try {
    const level3Identity = runtimeIdentityAtLevel("LEVEL_3_PRESTASHOP_LINKED", "PRESTASHOP_LINKED", {
      masterCustomerId: String(env.masterCustomerId),
      prestashopCustomerId: "8802",
      policyCode: "PRESTASHOP_IDENTITY_SUFFICIENT"
    });
    const result = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "que me recomiendas segun lo que suelo comprar",
      snapshot: buildSnapshot(env, { customerSession: customerSessionDecision(level3Identity) }),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: PLAN_CUSTOMER_AWARE_RECOMMENDATION }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig(),
      customerSessionExecution: buildTrustedSession(env, level3Identity)
    });

    // CAPABILITY_CORRECT: the signal load is genuinely attempted (never skipped just because it will fail).
    assert.equal(await countCapabilityExecutions(env.opportunityId, "get_customer_recommendation_signal"), 1);
    // CORRECT_DEGRADATION: unlike REPEAT_PURCHASE, an unavailable signal is a NO_SIGNAL business outcome, never a failed/blocked objective - the objective must still make forward progress (a generic search), never get stuck.
    const objective = findObjective(result.work, "CUSTOMER_AWARE_RECOMMENDATION");
    assert.notEqual(objective?.status, "FAILED");
    assert.equal(result.ran, true);
    assert.ok(result.dispatch?.messageSent);
  } finally {
    await fixture.restore();
    await env.teardown();
  }
});

// ==========================================================================
// A13-08: identity L0/L2/L3
// ==========================================================================

test("A13-08 identity_l0_l2_l3: the gate blocks at L0 and allows at L2/L3 exactly per operation", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedBenchmarkSelection(env.opportunityId, [{ productId: "31", quantity: 1 }]);
    const lineItemsOverride = await durableStateSnapshotOverride(env.opportunityId);

    // L0: CREATE_QUOTE requires LEVEL_2 - anonymous must never reach the real Quote Service.
    const l0Identity = buildRuntimeIdentity();
    const l0Result = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "hazme la cotizacion",
      snapshot: buildSnapshot(env, { customerSession: customerSessionDecision(l0Identity), ...lineItemsOverride }),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: PLAN_CREATE_QUOTE }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig(),
      customerSessionExecution: buildTrustedSession(env, l0Identity)
    });
    const l0Objective = findObjective(l0Result.work, "CREATE_QUOTE");
    assert.equal(l0Objective?.status, "WAITING_CUSTOMER");
    assert.equal(l0Objective?.blockers.some((b) => b.code === "IDENTITY_REQUIREMENT"), true);
    assert.equal(await countCapabilityExecutions(env.opportunityId, "create_quote"), 0, "L0 must never reach create_quote");

    // L2: sufficient for CREATE_QUOTE - the gate must let it through (whatever the Quote Service itself then does).
    const l2Identity = runtimeIdentityAtLevel("LEVEL_2_MASTER_RESOLVED", "MASTER_RESOLVED", { masterCustomerId: String(env.masterCustomerId) });
    const l2Result = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "hazme la cotizacion",
      snapshot: buildSnapshot(env, { customerSession: customerSessionDecision(l2Identity), ...lineItemsOverride }),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: PLAN_CREATE_QUOTE }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig(),
      customerSessionExecution: buildTrustedSession(env, l2Identity)
    });
    const l2Objective = findObjective(l2Result.work, "CREATE_QUOTE");
    assert.equal(l2Objective?.blockers.some((b) => b.code === "IDENTITY_REQUIREMENT"), false);
    // No live Quote Service in this sandbox (capability-coverage-matrix.md: "real Quote Service E2E
    // NOT_AVAILABLE") - create_quote genuinely retries a few times within this turn's settle rounds
    // before landing WAITING_SYSTEM; the invariant here is "at least once", never zero.
    assert.ok((await countCapabilityExecutions(env.opportunityId, "create_quote")) >= 1, "L2 must genuinely reach create_quote at least once");
  } finally {
    await env.teardown();
  }
});

// ==========================================================================
// A13-09: onboarding/resume
// ==========================================================================

test("A13-09 onboarding_resume: an identity-blocked objective resumes the SAME work once identity upgrades", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedBenchmarkSelection(env.opportunityId, [{ productId: "31", quantity: 1 }]);
    const lineItemsOverride = await durableStateSnapshotOverride(env.opportunityId);
    const l0Identity = buildRuntimeIdentity();
    const first = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "hazme la cotizacion",
      snapshot: buildSnapshot(env, { customerSession: customerSessionDecision(l0Identity), ...lineItemsOverride }),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: PLAN_CREATE_QUOTE }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig(),
      customerSessionExecution: buildTrustedSession(env, l0Identity)
    });
    assert.equal(findObjective(first.work, "CREATE_QUOTE")?.status, "WAITING_CUSTOMER");
    assert.equal(await countCommercialWorkRows(env.conversationId), 1);

    const l2Identity = runtimeIdentityAtLevel("LEVEL_2_MASTER_RESOLVED", "MASTER_RESOLVED", { masterCustomerId: String(env.masterCustomerId) });
    // A bare confirmation with no new discrete commercial intent - parseCommercialIntentPlan.ts treats
    // an EMPTY intents array as a structurally invalid plan (never a valid "nothing new this turn"),
    // so a realistic planner output here is "unsupported" (never invented): commercialObjectiveSeedsFromResolvedIntents
    // filters unsupported intents out entirely, leaving reconcileCommercialObjectives to carry forward
    // the existing CREATE_QUOTE objective unchanged.
    const second = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "listo, ya me identifique",
      snapshot: buildSnapshot(env, { customerSession: customerSessionDecision(l2Identity), ...lineItemsOverride }),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "unsupported", description: "confirms identification, no new commercial intent" }] } }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig(),
      customerSessionExecution: buildTrustedSession(env, l2Identity)
    });

    // STATE_CONTINUITY / NO_CONTEXT_LOSS: the SAME work resumes, never a second row for the same conversation.
    assert.equal(second.work?.publicId, first.work?.publicId);
    assert.equal(await countCommercialWorkRows(env.conversationId), 1);
    const liveQuote = liveObjectivesOfType(second.work, "CREATE_QUOTE");
    assert.equal(liveQuote.length, 1);
    assert.equal(liveQuote[0]?.blockers.some((b) => b.code === "IDENTITY_REQUIREMENT"), false);

    // FINDING (P1/P2, confirmed reproducible): buildCommercialWorkProjection.ts's CREATE_QUOTE case
    // calls stillWaitingOnCustomer(carriedStatus) - a check designed for "the CAPABILITY itself already
    // asked the customer for more information last round, do not silently retry" (the same pattern
    // SELECT_PRODUCTS/SET_DESTINATION use) - but it cannot distinguish that case from a WAITING_CUSTOMER
    // imposed by the IDENTITY GATE (applyCommercialIdentityGate, which runs AFTER applyObjectiveState
    // and only ever reconsiders an objective currently READY). Once CREATE_QUOTE is carried forward
    // with carriedStatus "WAITING_CUSTOMER" from an identity block, this generic check re-applies
    // WAITING_CUSTOMER unconditionally BEFORE the identity gate gets a chance to run again - so the
    // objective never reaches READY at all, and the gate (which only inspects READY objectives) never
    // sees it. The objective is stuck at WAITING_CUSTOMER FOREVER once identity-blocked, UNLESS a later
    // turn's message happens to repeat the exact original intent verbatim (a fresh same-type seed
    // supersedes the carried one, getting a clean carriedStatus of undefined - this is why A13-06's
    // REPEAT_PURCHASE resume test passes: each turn re-states "repeat_purchase" explicitly). A bare
    // "I'm identified now" confirmation - the realistic, minimal thing a customer actually says after
    // completing identification - can never resume the stalled request. This directly breaks the
    // onboarding/resume category this scenario exists to validate.
    assert.ok((await countCapabilityExecutions(env.opportunityId, "create_quote")) >= 1, "expected CREATE_QUOTE to resume and genuinely attempt dispatch once identity was upgraded");
  } finally {
    await env.teardown();
  }
});

// ==========================================================================
// A13-10: shipping lookup / selection
// ==========================================================================

test("A13-10 shipping_lookup_selection: a shipping quote then an option selection completes durably", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedBenchmarkSelection(env.opportunityId, [{ productId: "31", quantity: 1 }]);
    const first = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "cuanto sale el despacho a Nunoa",
      snapshot: buildSnapshot(env, await durableStateSnapshotOverride(env.opportunityId)),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: PLAN_SHIPPING_QUOTE_NUNOA }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });
    assert.equal(findObjective(first.work, "GET_SHIPPING_QUOTE")?.status, "COMPLETED");

    const second = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "quiero la primera opcion",
      snapshot: buildSnapshot(env, await durableStateSnapshotOverride(env.opportunityId)),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: PLAN_SELECT_SHIPPING_OPTION_FIRST }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });

    // INTENT_CORRECT / OBJECTIVE_CORRECT / CAPABILITY_CORRECT - the clean two-turn path (nothing else
    // competing for this turn's settle rounds) resolves and dispatches within the SAME round it was
    // computed, in-memory, never round-tripping through a DB reload first. See the LATENT finding right
    // below this test - the same optionIndex resolution is NOT always this lucky.
    const selection = findObjective(second.work, "SELECT_SHIPPING_OPTION");
    assert.equal(selection?.status, "COMPLETED");
    assert.equal(await countCompletedCapabilityExecutions(env.opportunityId, "select_shipping_option"), 1);
    // NO_DUPLICATE_EXECUTION
    assert.equal(await countCompletedCapabilityExecutions(env.opportunityId, "calculate_shipping"), 1);
    assert.equal(second.dispatch?.disposition, "FINAL");
  } finally {
    await env.teardown();
  }
});

test("A13-10b shipping_lookup_selection (latent defect, direct repro): optionIndex reaches the capability as a string, not a number, after a persistence round-trip", async () => {
  // FINDING (P1, confirmed): discovered while building A13-10 - an earlier version of that same
  // two-turn scenario (before this benchmark's snapshot-sync fix removed an unrelated confound, see
  // durableStateSnapshotOverride's own note) needed an EXTRA settle round to converge, and
  // SELECT_SHIPPING_OPTION's dispatch ended up reading back a JUST-PERSISTED-then-reloaded step input
  // instead of using the in-memory value computed the same round - at that point,
  // resolveObservedShippingOption's strict `typeof input.optionIndex === "number"` check failed, and a
  // perfectly valid index (0, the only real option) was rejected as "shipping_option_index_out_of_range"
  // - a terminal FAILED work (stepRecordFromGateway explicitly assumes this "should never happen if the
  // projection layer did its job" and does not apply A11.4's self-healing "blocked" path to it). A13-10
  // itself no longer exercises the extra round that exposes this (its clean path resolves same-round),
  // so this direct, deterministic, self-contained repro of the underlying type mismatch is kept as its
  // own permanent regression check - it reproduces the exact failure mode independent of any
  // round-count timing, against a real calculate_shipping execution this test creates itself.
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedBenchmarkSelection(env.opportunityId, [{ productId: "31", quantity: 1 }]);
    await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "cuanto sale el despacho a Nunoa",
      snapshot: buildSnapshot(env, await durableStateSnapshotOverride(env.opportunityId)),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: PLAN_SHIPPING_QUOTE_NUNOA }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });

    const numeric = await resolveObservedShippingOption({ conversationId: env.conversationId, optionIndex: 0 });
    assert.equal(numeric.status, "resolved", "a real number index into the one real option must resolve");

    const stringified = await resolveObservedShippingOption({ conversationId: env.conversationId, optionIndex: "0" as unknown as number });
    assert.notEqual(stringified.status, "blocked", `FINDING confirmed: the identical index as a string is wrongly rejected (${stringified.status === "blocked" ? (stringified as { reason: string }).reason : ""}) - optionIndex must be normalized to a number before this check, wherever it is arriving as a string`);
  } finally {
    await env.teardown();
  }
});

// ==========================================================================
// A13-11: cancellation
// ==========================================================================

test("A13-11 cancellation: explicit cancellation invalidates the targeted family only", async () => {
  const env = await setupR2BenchmarkEnvironment();
  const fixture = await useA13CatalogFixture();
  try {
    // A REAL SELECT_PRODUCTS objective must exist in this work first (seedBenchmarkSelection alone
    // only writes durable state, never a CommercialObjective to cancel - see A13-08/09's own
    // durableStateSnapshotOverride note on why bypassing the projection this way is misleading).
    const first = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "quiero 1 de la classic",
      snapshot: buildSnapshot(env),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: PLAN_SELECT_CLASSIC_QTY2 }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });
    assert.equal(findObjective(first.work, "SELECT_PRODUCTS")?.status, "COMPLETED");

    const result = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "cancela mi seleccion",
      snapshot: buildSnapshot(env),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: PLAN_CANCEL_SELECTION }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });

    // FINDING (P2, confirmed reproducible): turn 1's SELECT_PRODUCTS objective fully COMPLETED, a
    // TERMINAL CommercialWork status (transitions.ts) - per A13-04's own finding, reconciliation.ts's
    // resolveCommercialWorkTarget cannot find a terminal prior work at all (repository.ts's
    // ACTIVE_WORK_STATUSES excludes it), so the "cancel" turn opens a brand new, empty work with
    // NOTHING carried into it to cancel. The cancel seed has no matching live objective in this new
    // work, so deriveCommercialObjectives produces zero objectives, and the finalizer falls through to
    // a generic "your request is complete" message - the customer is never told their cancellation had
    // no live request to act on. Whether the underlying DURABLE selection itself survives this "cancel"
    // (i.e., whether the customer's product is still selected afterward, silently, despite asking to
    // cancel it) is exactly what NO_UNAUTHORIZED_SIDE_EFFECT/CORRECT_FINAL_RESPONSE need verified here.
    const durableSelectionAfter = await getActiveCommercialLineItemsForOpportunity(env.opportunityId);
    assert.equal(durableSelectionAfter, null, "the customer asked to cancel their selection - it must not silently remain durably selected");
    assert.equal(await countCapabilityExecutions(env.opportunityId, "select_products"), 1, "cancellation is a local state change - only turn 1's real selection call, never a second one for the cancel itself");
    assert.ok(result.dispatch?.messageSent?.toLowerCase().includes("dej"), `expected an explicit cancellation acknowledgment, got: ${result.dispatch?.messageSent}`);
  } finally {
    await fixture.restore();
    await env.teardown();
  }
});

// ==========================================================================
// A13-12: supersession
// ==========================================================================

test("A13-12 supersession: a destination correction invalidates stale shipping evidence and recalculates", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedBenchmarkSelection(env.opportunityId, [{ productId: "31", quantity: 1 }]);
    // Same "keep the work open" technique as A13-05 (create_quote genuinely retries against no live
    // Quote Service in this sandbox, landing WAITING_SYSTEM - never terminal) so turn 2 UPDATES the SAME
    // work row instead of reconciliation.ts's resolveCommercialWorkTarget opening an unrelated new one
    // once the prior work is terminal (A13-04's own finding) - this scenario specifically targets
    // cross-turn, SAME-work invalidation of stale shipping evidence.
    const first = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "cuanto sale el despacho a Nunoa, y hazme la cotizacion",
      snapshot: buildSnapshot(env, await durableStateSnapshotOverride(env.opportunityId)),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "get_shipping_quote", destination: "Nunoa" }, { type: "create_quote" }] } }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });
    assert.equal(findObjective(first.work, "GET_SHIPPING_QUOTE")?.status, "COMPLETED");
    assert.ok(!["COMPLETED", "CANCELLED", "SUPERSEDED", "HANDOFF", "FAILED"].includes(first.work?.status ?? ""), `expected a non-terminal work status to keep this work open for turn 2, got: ${first.work?.status}`);

    const second = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "mejor mandalo a Las Condes",
      snapshot: buildSnapshot(env, await durableStateSnapshotOverride(env.opportunityId)),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: PLAN_SHIPPING_QUOTE_LAS_CONDES }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });

    // STATE_CONTINUITY: the SAME work updates in place.
    assert.equal(second.work?.publicId, first.work?.publicId);
    // NO_CONTEXT_LOSS: the product selection (durable state, untouched by either objective in this scenario).
    const selectionAfter = await getActiveCommercialLineItemsForOpportunity(env.opportunityId);
    assert.deepEqual(selectionAfter?.items, [{ productId: "31", combinationId: null, quantity: 1 }]);

    // OBJECTIVE_CORRECT / NO_FALSE_PRICE: a fresh recalculation happens against the NEW destination, the old quote is never presented as still current.
    const liveShipping = liveObjectivesOfType(second.work, "GET_SHIPPING_QUOTE");
    assert.equal(liveShipping.length, 1);
    assert.equal(liveShipping[0]?.status, "COMPLETED");
    assert.equal(await countCompletedCapabilityExecutions(env.opportunityId, "calculate_shipping"), 2);
  } finally {
    await env.teardown();
  }
});

// ==========================================================================
// A13-13: multi-intent
// ==========================================================================

test("A13-13 multi_intent: two intents in the same turn both progress correctly", async () => {
  const env = await setupR2BenchmarkEnvironment();
  const fixture = await useA13CatalogFixture();
  try {
    const result = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "quiero 1 de la classic y cuanto sale el despacho a Nunoa",
      snapshot: buildSnapshot(env),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: PLAN_MULTI_INTENT_SELECT_AND_SHIP }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });

    // INTENT_CORRECT / OBJECTIVE_CORRECT for BOTH intents in one turn.
    assert.equal(findObjective(result.work, "SELECT_PRODUCTS")?.status, "COMPLETED");
    assert.equal(findObjective(result.work, "GET_SHIPPING_QUOTE")?.status, "COMPLETED");
    // CAPABILITY_CORRECT
    assert.equal(await countCompletedCapabilityExecutions(env.opportunityId, "select_products"), 1);
    assert.equal(await countCompletedCapabilityExecutions(env.opportunityId, "calculate_shipping"), 1);
    assert.equal(result.dispatch?.disposition, "FINAL");
  } finally {
    await fixture.restore();
    await env.teardown();
  }
});

// ==========================================================================
// A13-14: long conversation continuity
// ==========================================================================

test("A13-14 long_conversation_continuity: a five-turn conversation never loses earlier facts", async () => {
  const env = await setupR2BenchmarkEnvironment();
  const fixture = await useA13CatalogFixture();
  try {
    // Each turn's snapshot is synced fresh against real durable state right before the call (see
    // durableStateSnapshotOverride's own note) - without this, the semantic planner's requirement
    // resolver can misjudge an already-resolved intent as still pending and re-surface it as a spurious
    // extra objective on the next turn (confirmed independently while building A13-05/10/12).
    const run = async (customerMessage: string, plan: CommercialIntentPlan) => {
      const result = await runCommercialWorkInboundCycle({
        conversationId: env.conversationId,
        waId: env.waId,
        inboundMessageId: uniqueSuffix("msg"),
        correlationId: uniqueSuffix("corr"),
        currentTime: new Date().toISOString(),
        customerMessage,
        snapshot: buildSnapshot(env, await durableStateSnapshotOverride(env.opportunityId)),
        provider: createOfflinePlannerProvider([{ kind: "plan", plan }]),
        resolvedSalesAgentConfiguration: buildResolvedConfig()
      });
      return result;
    };

    // Turn 1: select. Turn 2: destination. Turn 3: quantity correction. Turn 4: destination correction.
    // Each fully-resolved turn below completes its whole work (a terminal CommercialWork status per
    // transitions.ts) - per A13-04's own finding, a later turn then opens a brand new, lineage-BLANK
    // work row rather than reusing the same one (reconciliation.ts's resolveCommercialWorkTarget cannot
    // even find a terminal prior work). STATE_CONTINUITY across this conversation is therefore judged
    // against DURABLE FACTS (the real source of truth these objectives read/write), never a specific
    // work row's identity or lineage.
    const t1 = await run("quiero 1 de la classic", { intents: [{ type: "select_products", productReference: "classic", quantity: 1 }] });
    assert.equal(findObjective(t1.work, "SELECT_PRODUCTS")?.status, "COMPLETED");

    const t2 = await run("cuanto sale a Nunoa", PLAN_SHIPPING_QUOTE_NUNOA);
    assert.equal(findObjective(t2.work, "GET_SHIPPING_QUOTE")?.status, "COMPLETED");

    const t3 = await run("mejor 4", PLAN_QUANTITY_CORRECTION(4));
    assert.equal(liveObjectivesOfType(t3.work, "SELECT_PRODUCTS")[0]?.status, "COMPLETED");

    const t4 = await run("mejor a Las Condes", PLAN_SHIPPING_QUOTE_LAS_CONDES);
    assert.equal(liveObjectivesOfType(t4.work, "GET_SHIPPING_QUOTE")[0]?.status, "COMPLETED");

    // Turn 5: create_quote - no live Quote Service in this sandbox (see A13-08/09), so this only
    // needs to make forward progress without crashing or claiming a false completion.
    const t5 = await run("hazme la cotizacion", PLAN_CREATE_QUOTE);
    assert.equal(t5.ran, true);
    assert.equal(t5.warnings.some((w) => w.startsWith("commercial_work_inbound_cycle_unexpected_failure")), false);

    // NO_CONTEXT_LOSS: the durable selection quantity reflects turn 3's correction (4), never turn 1's
    // original (1) or a lost value; the durable destination reflects turn 4's correction (Las Condes),
    // never turn 2's original (Nunoa) - checked against durable state directly (source of truth).
    const finalSelection = await getActiveCommercialLineItemsForOpportunity(env.opportunityId);
    assert.deepEqual(finalSelection?.items, [{ productId: "31", combinationId: null, quantity: 4 }], "expected the corrected quantity (4) and original product (31) still intact after 4 turns");
    const finalDestination = await getActiveShippingDestinationForOpportunity(env.opportunityId);
    assert.equal(finalDestination?.canonicalName, "Las Condes");
    assert.equal(await countCompletedCapabilityExecutions(env.opportunityId, "select_products"), 2, "one real select_products call for the initial selection, one for the quantity correction");
    assert.equal(await countCompletedCapabilityExecutions(env.opportunityId, "calculate_shipping"), 2, "one real recalculation per genuine destination change (Nunoa, then Las Condes)");
  } finally {
    await fixture.restore();
    await env.teardown();
  }
});

// ==========================================================================
// A13-15: unsupported intent
// ==========================================================================

test("A13-15 unsupported_intent: an unrecognized intent never crashes and never claims false progress", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    const result = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "necesito factura electronica con giro comercial",
      snapshot: buildSnapshot(env),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: PLAN_UNSUPPORTED }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });

    // NO_UNAUTHORIZED_SIDE_EFFECT: no capability of any kind is ever invoked for an unsupported intent.
    assert.equal(await countCapabilityExecutions(env.opportunityId, "select_products"), 0);
    assert.equal(await countCapabilityExecutions(env.opportunityId, "create_quote"), 0);
    // CORRECT_DEGRADATION: the turn completes without throwing (never surfaces as commercial_work_internal_failure).
    assert.equal(result.ran, true);
    assert.equal(result.warnings.some((w) => w.startsWith("commercial_work_inbound_cycle_unexpected_failure")), false);
    // CORRECT_FINAL_RESPONSE: the customer still gets SOME reply, never silence.
    assert.ok(result.dispatch?.messageSent);
  } finally {
    await env.teardown();
  }
});

// ==========================================================================
// A13-16: Customer Profile failure
// ==========================================================================

test("A13-16 customer_profile_failure: REPEAT_PURCHASE and CUSTOMER_AWARE_RECOMMENDATION degrade differently, both honestly", async () => {
  resetSharedCustomerProfileClientForTests();
  const env = await setupR2BenchmarkEnvironment();
  try {
    const identity = runtimeIdentityAtLevel("LEVEL_3_PRESTASHOP_LINKED", "PRESTASHOP_LINKED", {
      masterCustomerId: String(env.masterCustomerId),
      prestashopCustomerId: "9001",
      policyCode: "PRESTASHOP_IDENTITY_SUFFICIENT"
    });

    const repeatPurchase = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "quiero lo mismo de siempre",
      snapshot: buildSnapshot(env, { customerSession: customerSessionDecision(identity) }),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: PLAN_REPEAT_PURCHASE }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig(),
      customerSessionExecution: buildTrustedSession(env, identity)
    });
    // REPEAT_PURCHASE: a Customer Profile failure is a REAL, observable failure - never silently treated as "nothing to repeat".
    const rphExecutions = await queryRows<{ execution_status: string; error_code: string | null }>(
      "SELECT execution_status, error_code FROM crm_capability_executions WHERE opportunity_id = ? AND capability_name = 'get_customer_purchase_history'",
      [env.opportunityId]
    );
    assert.equal(rphExecutions[0]?.execution_status, "failed");
    assert.notEqual(findObjective(repeatPurchase.work, "REPEAT_PURCHASE")?.status, "COMPLETED");

    const env2 = await setupR2BenchmarkEnvironment();
    try {
      const identity2 = runtimeIdentityAtLevel("LEVEL_3_PRESTASHOP_LINKED", "PRESTASHOP_LINKED", {
        masterCustomerId: String(env2.masterCustomerId),
        prestashopCustomerId: "9002",
        policyCode: "PRESTASHOP_IDENTITY_SUFFICIENT"
      });
      const recommendation = await runCommercialWorkInboundCycle({
        conversationId: env2.conversationId,
        waId: env2.waId,
        inboundMessageId: uniqueSuffix("msg"),
        correlationId: uniqueSuffix("corr"),
        currentTime: new Date().toISOString(),
        customerMessage: "que me recomiendas",
        snapshot: buildSnapshot(env2, { customerSession: customerSessionDecision(identity2) }),
        provider: createOfflinePlannerProvider([{ kind: "plan", plan: PLAN_CUSTOMER_AWARE_RECOMMENDATION }]),
        resolvedSalesAgentConfiguration: buildResolvedConfig(),
        customerSessionExecution: buildTrustedSession(env2, identity2)
      });
      // CUSTOMER_AWARE_RECOMMENDATION: the SAME underlying failure degrades to a real, persisted NO_SIGNAL completion by design (A12) - a genuinely different, deliberate degradation path, not an inconsistency.
      const recExecutions = await queryRows<{ execution_status: string }>(
        "SELECT execution_status FROM crm_capability_executions WHERE opportunity_id = ? AND capability_name = 'get_customer_recommendation_signal'",
        [env2.opportunityId]
      );
      assert.equal(recExecutions[0]?.execution_status, "completed");
      assert.notEqual(findObjective(recommendation.work, "CUSTOMER_AWARE_RECOMMENDATION")?.status, "FAILED");
    } finally {
      await env2.teardown();
    }
  } finally {
    await env.teardown();
  }
});

// ==========================================================================
// A13-17: Catalog failure
// ==========================================================================

test("A13-17 catalog_failure: an unavailable Catalog blocks system-owned, never asks the customer", async () => {
  const env = await setupR2BenchmarkEnvironment();
  const outage = await useCatalogUnavailable();
  try {
    const result = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "quiero 1 de la classic",
      snapshot: buildSnapshot(env),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "select_products", productReference: "classic", quantity: 1 }] } }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });

    const objective = findObjective(result.work, "SELECT_PRODUCTS");
    // OBJECTIVE_CORRECT / CORRECT_DEGRADATION: a catalog outage is system-owned - it must never turn into a customer-facing question, and must never silently invent a product.
    assert.notEqual(objective?.status, "WAITING_CUSTOMER");
    assert.equal(objective?.inputs.items, undefined);
    assert.equal(await countCompletedCapabilityExecutions(env.opportunityId, "select_products"), 0);
  } finally {
    await outage.restore();
    await env.teardown();
  }
});

// ==========================================================================
// A13-18: planner malformed output
// ==========================================================================

test("A13-18 planner_malformed_output: invalid provider output mutates nothing and dispatches a controlled fallback", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    const invalidResponse = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "quiero 2 classic",
      snapshot: buildSnapshot(env),
      provider: createOfflinePlannerProvider([{ kind: "invalid_response" }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });
    assert.equal(invalidResponse.work, null);
    assert.equal(invalidResponse.dispatch?.disposition, "fallback");
    assert.equal(await countCommercialWorkRows(env.conversationId), 0);

    const env2 = await setupR2BenchmarkEnvironment();
    try {
      const invalidShape = await runCommercialWorkInboundCycle({
        conversationId: env2.conversationId,
        waId: env2.waId,
        inboundMessageId: uniqueSuffix("msg"),
        correlationId: uniqueSuffix("corr"),
        currentTime: new Date().toISOString(),
        customerMessage: "quiero 2 classic",
        snapshot: buildSnapshot(env2),
        provider: createOfflinePlannerProvider([{ kind: "invalid_plan_shape", rawOutput: { notIntents: true } }]),
        resolvedSalesAgentConfiguration: buildResolvedConfig()
      });
      // NO_UNAUTHORIZED_SIDE_EFFECT
      assert.equal(invalidShape.work, null);
      assert.equal(invalidShape.dispatch?.disposition, "fallback");
      assert.equal(await countCommercialWorkRows(env2.conversationId), 0);
      // CORRECT_FINAL_RESPONSE: still a real reply, never silence.
      assert.ok(invalidShape.dispatch?.messageSent);
    } finally {
      await env2.teardown();
    }
  } finally {
    await env.teardown();
  }
});

// ==========================================================================
// A13-19: duplicate inbound
// ==========================================================================

test("A13-19 duplicate_inbound: the same inboundMessageId twice never re-executes a mutating capability", async () => {
  const env = await setupR2BenchmarkEnvironment();
  const fixture = await useA13CatalogFixture();
  try {
    const inboundMessageId = uniqueSuffix("msg");
    const buildProvider = () => createOfflinePlannerProvider([{ kind: "plan", plan: PLAN_SELECT_CLASSIC_QTY2 }]);

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

    // FINDING (P1, confirmed reproducible): reconciliation.ts's resolveCommercialWorkTarget only checks
    // whether the previous work is terminal (COMPLETED/CANCELLED/SUPERSEDED/HANDOFF/FAILED) to decide
    // "create new work" vs "update the same work" - it never consults assignCommercialTriggerSequence's
    // own dedupe key (commercial-work:{conversationId}:{inboundMessageId}), even though that sequencing
    // layer DOES correctly recognize this exact inboundMessageId as already-seen (returns the SAME
    // commercialSequence both times). Once the first turn's single-objective work reaches COMPLETED
    // (an everyday, fast outcome for a simple resolved request - not a rare edge case), an exact
    // webhook redelivery of the SAME inboundMessageId is treated identically to a brand-new customer
    // message: a SECOND CommercialWork row is created. The mutating capability itself is not
    // re-invoked (select_products' own durable-state "sameItems" shortcut catches that), but
    // dispatchCommercialWorkResponse's idempotency key is keyed on {conversationId, inboundMessageId,
    // work.publicId, work.version} - since the new work has a different publicId, that key never
    // matches turn 1's, and a SECOND real crm_agent_actions row + a SECOND outbox message get created
    // for the customer, resending the exact same confirmation. This is a genuine duplicate customer-
    // facing side effect from an ordinary WhatsApp webhook retry, not a synthetic scenario.
    assert.equal(first.work?.publicId, second.work?.publicId, "a redelivered inboundMessageId must resolve to the SAME work, never a new one");
    assert.equal(await countCommercialWorkRows(env.conversationId), 1);
    // NO_DUPLICATE_EXECUTION: the mutating capability itself only ran once, not just "the work row is the same".
    assert.equal(await countCompletedCapabilityExecutions(env.opportunityId, "select_products"), 1);
    const outboundActions = await queryRows<{ count: number }>(
      "SELECT COUNT(*) AS count FROM crm_agent_actions WHERE conversation_case_id = ? AND action_type = 'send_whatsapp_reply'",
      [env.conversationId]
    );
    assert.equal(Number(outboundActions[0]?.count ?? 0), 1, "exactly one dispatched customer-facing reply for one logical inbound message, however many times it was redelivered");
  } finally {
    await fixture.restore();
    await env.teardown();
  }
});

// ==========================================================================
// A13-20: WAITING_CUSTOMER continuation
// ==========================================================================

test("A13-20 waiting_customer_continuation: a follow-up answer resumes the same work without re-asking what is already known", async () => {
  const env = await setupR2BenchmarkEnvironment();
  try {
    await seedBenchmarkSelection(env.opportunityId, [{ productId: "31", quantity: 2 }]);
    const first = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "cuanto sale el despacho",
      snapshot: buildSnapshot(env),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: PLAN_SHIPPING_QUOTE_NO_DESTINATION }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });
    assert.equal(first.work?.status, "WAITING_CUSTOMER");
    const scheduled = await queryRows<{ count: number }>(
      "SELECT COUNT(*) AS count FROM crm_agent_actions WHERE action_type = 'schedule_followup' AND conversation_case_id = ?",
      [env.conversationId]
    );
    assert.ok(Number(scheduled[0]?.count ?? 0) >= 1);

    const second = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "a Nunoa por favor",
      snapshot: buildSnapshot(env),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: PLAN_SHIPPING_QUOTE_NUNOA }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });

    // STATE_CONTINUITY / NO_CONTEXT_LOSS: same work, the ALREADY-known selection (2x product 31, seeded before turn 1) is never re-asked.
    assert.equal(second.work?.publicId, first.work?.publicId);
    assert.equal(liveObjectivesOfType(second.work, "SELECT_PRODUCTS").length, 0, "no SELECT_PRODUCTS objective was ever created - the durable selection was reused, never re-requested");
    assert.equal(findObjective(second.work, "GET_SHIPPING_QUOTE")?.status, "COMPLETED");
    // CORRECT_FINAL_RESPONSE
    assert.equal(second.dispatch?.disposition, "FINAL");
  } finally {
    await env.teardown();
  }
});

// ==========================================================================
// A13-21: WAITING_SYSTEM recovery
// ==========================================================================

test("A13-21 waiting_system_recovery: a system-owned block recovers via the retry worker with zero customer input", async () => {
  const env = await setupR2BenchmarkEnvironment();
  const outage = await useCatalogUnavailable();
  try {
    const first = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage: "quiero 1 de la classic",
      snapshot: buildSnapshot(env),
      provider: createOfflinePlannerProvider([{ kind: "plan", plan: { intents: [{ type: "select_products", productReference: "classic", quantity: 1 }] } }]),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });
    const blockedStep = first.work?.steps.find((s) => s.type === "SEARCH_PRODUCTS");
    const preRecoveryStatus = blockedStep?.status;

    // Restore Catalog, then let the retry worker (never a new customer message, never a new LLM call) recover it.
    await outage.restore();
    const fixture = await useA13CatalogFixture();
    try {
      const dueAt = new Date(Date.now() + 5 * 60_000).toISOString();
      await runCommercialWorkTick({ now: dueAt, workPublicIds: first.work ? [first.work.publicId] : [], ...WORKER_GATES_OPEN });
      const reloaded = first.work ? await getCommercialWorkByPublicId(first.work.publicId) : null;

      // FINDING (P1, confirmed reproducible): the worker tick's own candidate-selection claimed and ran
      // the DEPENDENT step (SELECT_PRODUCTS, whose only dependency is STEP_COMPLETED on the
      // SEARCH_PRODUCTS step) instead of the step that was actually due for retry (SEARCH_PRODUCTS,
      // RETRY_SCHEDULED, nextAttemptAt in the past). The tick's own result reports the SEARCH_PRODUCTS
      // candidate as skipped with reason "already_claimed" - SELECT_PRODUCTS transitions to RUNNING
      // (attemptCount incremented) despite its real dependency never having been satisfied, and
      // tickResult.executed stays 0 (no capability was actually dispatched this tick either way).
      // SEARCH_PRODUCTS itself is left exactly as it was (still RETRY_SCHEDULED, same nextAttemptAt) -
      // the due retry never actually ran. This both breaks WAITING_SYSTEM recovery for a two-step
      // dependency chain AND risks a step permanently stuck in RUNNING with no forward-progress path.
      assert.notEqual(preRecoveryStatus, undefined);
      const recoveredSearchStep = reloaded?.steps.find((s) => s.type === "SEARCH_PRODUCTS");
      const recoveredSelectStep = reloaded?.steps.find((s) => s.type === "SELECT_PRODUCTS");
      assert.equal(recoveredSearchStep?.status === "RETRY_SCHEDULED" || recoveredSearchStep?.status === "BLOCKED" || recoveredSearchStep?.status === "WAITING_SYSTEM", false, "expected the retry worker to move the actually-due SEARCH_PRODUCTS step out of its system-owned wait once Catalog is back");
      assert.notEqual(recoveredSelectStep?.status, "RUNNING", "SELECT_PRODUCTS must never be left RUNNING when its own dependency (SEARCH_PRODUCTS) was never satisfied this tick");
      assert.equal(await countCompletedCapabilityExecutions(env.opportunityId, "search_products"), 1, "exactly one real successful search across the whole outage/recovery, never a duplicate");
    } finally {
      await fixture.restore();
    }
  } finally {
    await env.teardown();
  }
});
