import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCommercialWorkProjection,
  type CommercialCapabilityExecutionProjection,
  type CommercialObjectiveSeed,
  type CommercialWork,
  type CommercialWorkProjectionInput
} from "@/lib/brain/commercial/work";
import type { RuntimeIdentityContext, RuntimeIdentityStatus } from "@/lib/brain/commercial/native-cycle/customer-session/runtimeIdentityContext";
import type { IdentityLevel } from "@/lib/domains/customer-identity-verification";

// SALES-AGENT-R2-ID-R2-A12. Projection-layer test matrix (CAR03/04/09/11-14/
// 19/25/27-30 subset - the pure, DB-free half; see
// customerAwareRecommendationE2E.test.ts for the DB-backed onboarding->
// LEVEL_3->signal->catalog->selection proof).

const NOW = "2026-08-26T12:00:00.000Z";

function runtimeIdentity(overrides: Partial<RuntimeIdentityContext> = {}): RuntimeIdentityContext {
  return {
    status: "ANONYMOUS",
    identityLevel: "LEVEL_0_ANONYMOUS",
    masterCustomerId: null,
    prestashopCustomerId: null,
    verificationRequired: false,
    requiredEvidence: [],
    readyToLink: false,
    conflictCode: null,
    policyCode: "NO_CHANNEL_EVIDENCE",
    evidenceRefs: [],
    ...overrides
  };
}

function atLevel(level: IdentityLevel, status: RuntimeIdentityStatus, overrides: Partial<RuntimeIdentityContext> = {}): RuntimeIdentityContext {
  return runtimeIdentity({ identityLevel: level, status, ...overrides });
}

const LEVEL_3_SUFFICIENT = atLevel("LEVEL_3_PRESTASHOP_LINKED", "PRESTASHOP_LINKED", {
  masterCustomerId: "100",
  prestashopCustomerId: "7421",
  policyCode: "PRESTASHOP_IDENTITY_SUFFICIENT"
});

function objectiveSeed(type: Exclude<CommercialObjectiveSeed, { kind: "cancel" }>["type"], inputs: Exclude<CommercialObjectiveSeed, { kind: "cancel" }>["inputs"] = {}): CommercialObjectiveSeed {
  return { type, origin: "customer_requested", inputs };
}

function project(overrides: Partial<CommercialWorkProjectionInput> = {}): CommercialWork {
  return buildCommercialWorkProjection({
    trigger: { type: "CUSTOMER_MESSAGE", conversationId: 1, opportunityId: 10, sourceMessageId: 100 },
    conversation: { id: 1, humanOwnerActive: false, aiEnabled: true },
    opportunity: { id: 10 },
    now: NOW,
    ...overrides
  });
}

function objective(work: CommercialWork, type: string) {
  const found = work.objectives.find((item) => item.type === type);
  assert.ok(found, `expected objective ${type}`);
  return found!;
}

function step(work: CommercialWork, type: string) {
  const found = work.steps.find((item) => item.type === type);
  assert.ok(found, `expected step ${type}`);
  return found!;
}

function recommendationSignalExecution(input: {
  status?: "AVAILABLE" | "NO_SIGNAL";
  queryText?: string;
  rfmSegmentLabel?: string;
  executionStatus?: CommercialCapabilityExecutionProjection["executionStatus"];
  retryable?: boolean;
  errorCode?: string | null;
}): CommercialCapabilityExecutionProjection {
  const executionStatus = input.executionStatus ?? "completed";
  const status = input.status ?? (input.queryText ? "AVAILABLE" : "NO_SIGNAL");
  const data = status === "AVAILABLE" ? { status, queryText: input.queryText, ...(input.rfmSegmentLabel ? { rfmSegmentLabel: input.rfmSegmentLabel } : {}) } : { status: "NO_SIGNAL" };
  return {
    publicId: "signal-exec-1",
    capabilityName: "get_customer_recommendation_signal",
    executionStatus,
    retryable: input.retryable ?? false,
    errorCode: input.errorCode ?? null,
    completedAt: NOW,
    responseSummaryJson: executionStatus === "completed" ? data : null
  };
}

function searchProductsExecution(input: {
  query: string;
  items?: Array<{ productId: string; combinationId?: string | null; name: string; price?: { amount: number; currency: string } | null }>;
}): CommercialCapabilityExecutionProjection {
  const items = input.items ?? [];
  const resolution =
    items.length === 1
      ? { status: "resolved", confidence: 0.9, sourceProduct: { productId: items[0].productId, ...(items[0].combinationId ? { combinationId: items[0].combinationId } : {}) } }
      : items.length > 1
        ? { status: "clarification_required", confidence: 0.5 }
        : { status: "no_match", confidence: 0 };
  const candidates = items.map((item, index) => ({
    product: { productId: item.productId, ...(item.combinationId ? { combinationId: item.combinationId } : {}), name: item.name, price: item.price ?? null, stock: { status: "unknown", available: true } },
    match: { rank: index + 1, score: 0.8, reasons: ["NAME_TOKEN_MATCH"] }
  }));
  return {
    publicId: "search-exec-1",
    capabilityName: "search_products",
    executionStatus: "completed",
    retryable: false,
    errorCode: null,
    completedAt: NOW,
    requestSummaryJson: { query: input.query, limit: 5 },
    responseSummaryJson: {
      query: input.query,
      productIntent: {
        query: { original: input.query, normalized: input.query },
        resolution,
        candidates,
        ...(resolution.status === "clarification_required" ? { clarification: { dimension: "unspecified", options: [] } } : {}),
        statistics: { retrieved: items.length, eligible: items.length, returned: items.length },
        warnings: []
      }
    }
  };
}

function failedSearchExecution(input: { query: string; retryable: boolean; errorCode?: string | null }): CommercialCapabilityExecutionProjection {
  return {
    publicId: "search-exec-failed",
    capabilityName: "search_products",
    executionStatus: input.retryable ? "temporarily_blocked" : "failed",
    retryable: input.retryable,
    errorCode: input.errorCode ?? "catalog_unavailable",
    completedAt: NOW,
    requestSummaryJson: { query: input.query, limit: 5 },
    responseSummaryJson: null
  };
}

// ---------------------------------------------------------------------------
// CAR03/04: identity gate reuse (A06/A07, unmodified) - never a second,
// hand-rolled check inside the CUSTOMER_AWARE_RECOMMENDATION case.
// ---------------------------------------------------------------------------

test("CAR03: CUSTOMER_AWARE_RECOMMENDATION below LEVEL_3 never becomes READY, never calls get_customer_recommendation_signal", () => {
  for (const identity of [
    atLevel("LEVEL_0_ANONYMOUS", "ANONYMOUS"),
    atLevel("LEVEL_1_CHANNEL_OBSERVED", "CHANNEL_OBSERVED"),
    atLevel("LEVEL_2_MASTER_RESOLVED", "MASTER_RESOLVED")
  ]) {
    const work = project({ objectiveSeeds: [objectiveSeed("CUSTOMER_AWARE_RECOMMENDATION")], runtimeIdentity: identity });
    const obj = objective(work, "CUSTOMER_AWARE_RECOMMENDATION");
    assert.notEqual(obj.status, "READY");
    assert.equal(obj.blockers.some((item) => item.code === "IDENTITY_REQUIREMENT"), true);
    const signalStep = step(work, "LOAD_RECOMMENDATION_SIGNAL");
    assert.notEqual(signalStep.status, "READY");
  }
});

test("CAR04: CUSTOMER_AWARE_RECOMMENDATION at LEVEL_3 is READY and derives a READY LOAD_RECOMMENDATION_SIGNAL step, even with a queryHint already present (Decision 4: signal always loads first)", () => {
  const work = project({ objectiveSeeds: [objectiveSeed("CUSTOMER_AWARE_RECOMMENDATION", { queryHint: "discos" })], runtimeIdentity: LEVEL_3_SUFFICIENT });
  const obj = objective(work, "CUSTOMER_AWARE_RECOMMENDATION");
  assert.equal(obj.status, "READY");
  assert.equal(obj.blockers.some((item) => item.code === "IDENTITY_REQUIREMENT"), false);
  const signalStep = step(work, "LOAD_RECOMMENDATION_SIGNAL");
  assert.equal(signalStep.status, "READY");
  assert.equal(signalStep.capabilityName, "get_customer_recommendation_signal");
});

// ---------------------------------------------------------------------------
// CAR09/12: a historical signal becomes the search query; no signal (and no
// queryHint) degrades to a plain clarifying question - never onboarding.
// ---------------------------------------------------------------------------

test("CAR09: signal AVAILABLE with no queryHint sets query from the signal, marks recommendationSignalSource, and derives a READY SEARCH_PRODUCTS step", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("CUSTOMER_AWARE_RECOMMENDATION")],
    runtimeIdentity: LEVEL_3_SUFFICIENT,
    recentCapabilityExecutions: [recommendationSignalExecution({ queryText: "Disco Olimpico 20kg" })]
  });
  const obj = objective(work, "CUSTOMER_AWARE_RECOMMENDATION");
  assert.equal(obj.inputs.query, "Disco Olimpico 20kg");
  assert.equal(obj.inputs.recommendationSignalSource, "purchase_history");
  assert.equal(obj.status, "READY");
  const searchStep = step(work, "SEARCH_PRODUCTS");
  assert.equal(searchStep.status, "READY");
  assert.equal(searchStep.capabilityName, "search_products");
});

test("CAR12: no signal and no queryHint asks a plain clarifying question - never re-opens onboarding, never invents a query", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("CUSTOMER_AWARE_RECOMMENDATION")],
    runtimeIdentity: LEVEL_3_SUFFICIENT,
    recentCapabilityExecutions: [recommendationSignalExecution({ status: "NO_SIGNAL" })]
  });
  const obj = objective(work, "CUSTOMER_AWARE_RECOMMENDATION");
  assert.equal(obj.status, "WAITING_CUSTOMER");
  assert.equal(obj.missingRequirements.includes("RECOMMENDATION_QUERY_HINT"), true);
  assert.equal(obj.blockers.some((item) => item.code === "IDENTITY_REQUIREMENT"), false);
  assert.equal(obj.inputs.query, undefined);
});

// ---------------------------------------------------------------------------
// CAR25/29: current explicit queryHint always wins the search query, both
// when a real signal is also available and when Customer Profile degraded
// to NO_SIGNAL - the most important degradation proof in A12.
// ---------------------------------------------------------------------------

test("CAR25: queryHint present AND a real available historical signal also loaded - the query is the queryHint verbatim, never the signal's product name; recommendationSignalSource stays absent", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("CUSTOMER_AWARE_RECOMMENDATION", { queryHint: "discos" })],
    runtimeIdentity: LEVEL_3_SUFFICIENT,
    recentCapabilityExecutions: [recommendationSignalExecution({ queryText: "Mancuernas 5kg" })]
  });
  const obj = objective(work, "CUSTOMER_AWARE_RECOMMENDATION");
  assert.equal(obj.inputs.query, "discos");
  assert.equal(obj.inputs.recommendationSignalSource, undefined);
  const searchStep = step(work, "SEARCH_PRODUCTS");
  assert.equal(searchStep.input.query, "discos");
});

test("CAR29: queryHint present AND the signal capability returned NO_SIGNAL (Customer Profile unavailable) - SEARCH_PRODUCTS still runs with the queryHint, objective never becomes WAITING_SYSTEM/FAILED", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("CUSTOMER_AWARE_RECOMMENDATION", { queryHint: "discos" })],
    runtimeIdentity: LEVEL_3_SUFFICIENT,
    recentCapabilityExecutions: [recommendationSignalExecution({ status: "NO_SIGNAL" })]
  });
  const obj = objective(work, "CUSTOMER_AWARE_RECOMMENDATION");
  assert.equal(obj.inputs.query, "discos");
  assert.notEqual(obj.status, "WAITING_SYSTEM");
  assert.notEqual(obj.status, "FAILED");
  const searchStep = step(work, "SEARCH_PRODUCTS");
  assert.equal(searchStep.status, "READY");
  assert.equal(searchStep.input.query, "discos");
});

// ---------------------------------------------------------------------------
// CAR11/19/27/28: bounded, Catalog-current candidates only - never
// auto-selected, never carrying a historical id.
// ---------------------------------------------------------------------------

test("CAR19/28: search completed with candidates always presents-and-waits, even for exactly one candidate - never auto-advances like REPEAT_PURCHASE", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("CUSTOMER_AWARE_RECOMMENDATION", { queryHint: "discos" })],
    runtimeIdentity: LEVEL_3_SUFFICIENT,
    recentCapabilityExecutions: [recommendationSignalExecution({ status: "NO_SIGNAL" }), searchProductsExecution({ query: "discos", items: [{ productId: "731", name: "Disco Olimpico 20kg" }] })]
  });
  const obj = objective(work, "CUSTOMER_AWARE_RECOMMENDATION");
  assert.equal(obj.status, "WAITING_CUSTOMER");
  assert.equal(obj.missingRequirements.includes("RECOMMENDATION_CANDIDATES"), true);
  assert.equal(obj.inputs.recommendationCandidates?.length, 1);
  // Never auto-selected into items/productReference like REPEAT_PURCHASE does.
  assert.equal(obj.inputs.items, undefined);
  assert.equal(obj.inputs.productReference, undefined);
});

test("CAR19: more than 5 candidates are bounded to 5", () => {
  const items = Array.from({ length: 8 }, (_, index) => ({ productId: String(index + 1), name: `Producto ${index + 1}` }));
  const work = project({
    objectiveSeeds: [objectiveSeed("CUSTOMER_AWARE_RECOMMENDATION", { queryHint: "pesas" })],
    runtimeIdentity: LEVEL_3_SUFFICIENT,
    recentCapabilityExecutions: [recommendationSignalExecution({ status: "NO_SIGNAL" }), searchProductsExecution({ query: "pesas", items })]
  });
  const obj = objective(work, "CUSTOMER_AWARE_RECOMMENDATION");
  assert.equal(obj.inputs.recommendationCandidates?.length, 5);
});

test("CAR27: recommendationCandidates are built exclusively from the SEARCH_PRODUCTS execution's own candidates, never from the historical signal - even when ids deliberately collide", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("CUSTOMER_AWARE_RECOMMENDATION")],
    runtimeIdentity: LEVEL_3_SUFFICIENT,
    recentCapabilityExecutions: [
      recommendationSignalExecution({ queryText: "Disco Olimpico 20kg" }),
      searchProductsExecution({ query: "Disco Olimpico 20kg", items: [{ productId: "731", name: "Disco Olimpico 20kg (catalogo actual)", price: { amount: 59980, currency: "CLP" } }] })
    ]
  });
  const obj = objective(work, "CUSTOMER_AWARE_RECOMMENDATION");
  assert.deepEqual(obj.inputs.recommendationCandidates, [{ productId: "731", name: "Disco Olimpico 20kg (catalogo actual)", price: { amount: 59980, currency: "CLP" } }]);
  // The signal capability's own result type never carries a productId field
  // at all (getCustomerRecommendationSignalCapability.ts) - nothing here
  // could have come from history even if it wanted to.
});

test("no candidates completes the objective - terminal, honest 'nothing current to recommend', never a fabricated option", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("CUSTOMER_AWARE_RECOMMENDATION", { queryHint: "producto inexistente xyz" })],
    runtimeIdentity: LEVEL_3_SUFFICIENT,
    recentCapabilityExecutions: [recommendationSignalExecution({ status: "NO_SIGNAL" }), searchProductsExecution({ query: "producto inexistente xyz", items: [] })]
  });
  const obj = objective(work, "CUSTOMER_AWARE_RECOMMENDATION");
  assert.equal(obj.status, "COMPLETED");
  assert.equal(obj.inputs.recommendationCandidates, undefined);
});

// ---------------------------------------------------------------------------
// CAR14: Catalog failure never surfaces a historical product as current.
// ---------------------------------------------------------------------------

test("CAR14: a Catalog/search_products technical failure is WAITING_SYSTEM/FAILED, never WAITING_CUSTOMER, and never presents historical data as current", () => {
  const retryableWork = project({
    objectiveSeeds: [objectiveSeed("CUSTOMER_AWARE_RECOMMENDATION", { queryHint: "discos" })],
    runtimeIdentity: LEVEL_3_SUFFICIENT,
    recentCapabilityExecutions: [recommendationSignalExecution({ status: "NO_SIGNAL" }), failedSearchExecution({ query: "discos", retryable: true })]
  });
  assert.equal(objective(retryableWork, "CUSTOMER_AWARE_RECOMMENDATION").status, "WAITING_SYSTEM");

  const failedWork = project({
    objectiveSeeds: [objectiveSeed("CUSTOMER_AWARE_RECOMMENDATION", { queryHint: "discos" })],
    runtimeIdentity: LEVEL_3_SUFFICIENT,
    recentCapabilityExecutions: [recommendationSignalExecution({ status: "NO_SIGNAL" }), failedSearchExecution({ query: "discos", retryable: false })]
  });
  const obj = objective(failedWork, "CUSTOMER_AWARE_RECOMMENDATION");
  assert.equal(obj.status, "FAILED");
  assert.equal(obj.inputs.recommendationCandidates, undefined);
});

// ---------------------------------------------------------------------------
// CAR30 (projection-layer half): once resolved, the signal step is never
// re-derived - the executor-level "exactly one dispatch across a restart"
// half lives in customerAwareRecommendationE2E.test.ts.
// ---------------------------------------------------------------------------

test("CAR30 (projection half): once the signal resolved a query, LOAD_RECOMMENDATION_SIGNAL is never re-derived", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("CUSTOMER_AWARE_RECOMMENDATION")],
    runtimeIdentity: LEVEL_3_SUFFICIENT,
    recentCapabilityExecutions: [recommendationSignalExecution({ queryText: "Disco Olimpico 20kg" })]
  });
  assert.equal(work.steps.filter((item) => item.type === "LOAD_RECOMMENDATION_SIGNAL").length, 0);
});

// ---------------------------------------------------------------------------
// Supersession: a disambiguating select_products reply supersedes the
// WAITING_CUSTOMER recommendation, never leaving two competing "selection"
// objectives alive.
// ---------------------------------------------------------------------------

test("a later select_products seed supersedes a still-pending CUSTOMER_AWARE_RECOMMENDATION (shared 'selection' supersession family)", () => {
  const work = project({
    objectiveSeeds: [
      objectiveSeed("CUSTOMER_AWARE_RECOMMENDATION", { queryHint: "discos" }),
      objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "731", combinationId: null, quantity: 1 }] })
    ],
    runtimeIdentity: LEVEL_3_SUFFICIENT
  });
  const recommendationObjective = objective(work, "CUSTOMER_AWARE_RECOMMENDATION");
  assert.equal(recommendationObjective.status, "SUPERSEDED");
  assert.equal(objective(work, "SELECT_PRODUCTS").status, "READY");
});
