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

// SALES-AGENT-R2-ID-R2-A11. Projection-layer test matrix (RPH03-04/07-16/18/21/26-27
// subset - the pure, DB-free half; see repeatPurchaseE2E.test.ts for the
// DB-backed onboarding->LEVEL_3->history->catalog resume proof).

const NOW = "2026-08-25T12:00:00.000Z";

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

function purchaseHistoryExecution(input: {
  previousProducts?: Array<{ historicalProductId?: string; historicalName: string; quantity?: number; lastPurchasedAt?: string | null }>;
  status?: "AVAILABLE" | "NO_PURCHASE_HISTORY";
  executionStatus?: CommercialCapabilityExecutionProjection["executionStatus"];
  retryable?: boolean;
  errorCode?: string | null;
}): CommercialCapabilityExecutionProjection {
  const executionStatus = input.executionStatus ?? "completed";
  const products = input.previousProducts ?? [];
  const status = input.status ?? (products.length > 0 ? "AVAILABLE" : "NO_PURCHASE_HISTORY");
  return {
    publicId: "history-exec-1",
    capabilityName: "get_customer_purchase_history",
    executionStatus,
    retryable: input.retryable ?? false,
    errorCode: input.errorCode ?? null,
    completedAt: NOW,
    responseSummaryJson: executionStatus === "completed" ? { status, previousProducts: products } : null
  };
}

function searchProductsExecution(input: {
  query: string;
  items?: Array<{ productId: string; combinationId?: string | null; name: string }>;
}): CommercialCapabilityExecutionProjection {
  const items = input.items ?? [];
  const resolution =
    items.length === 1
      ? { status: "resolved", confidence: 0.9, sourceProduct: { productId: items[0].productId, ...(items[0].combinationId ? { combinationId: items[0].combinationId } : {}) } }
      : items.length > 1
        ? { status: "clarification_required", confidence: 0.5 }
        : { status: "no_match", confidence: 0 };
  const candidates = items.map((item, index) => ({
    product: { productId: item.productId, ...(item.combinationId ? { combinationId: item.combinationId } : {}), name: item.name, price: null, stock: { status: "unknown", available: true } },
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

// ---------------------------------------------------------------------------
// RPH18/03/04: identity gate reuse (A06/A07, unmodified) - never a second,
// hand-rolled check inside the REPEAT_PURCHASE case.
// ---------------------------------------------------------------------------

test("RPH03/18: REPEAT_PURCHASE below LEVEL_3 never becomes READY, never calls get_customer_purchase_history (no LOAD_PURCHASE_HISTORY step reaches READY)", () => {
  for (const identity of [
    atLevel("LEVEL_0_ANONYMOUS", "ANONYMOUS"),
    atLevel("LEVEL_1_CHANNEL_OBSERVED", "CHANNEL_OBSERVED"),
    atLevel("LEVEL_2_MASTER_RESOLVED", "MASTER_RESOLVED")
  ]) {
    const work = project({ objectiveSeeds: [objectiveSeed("REPEAT_PURCHASE")], runtimeIdentity: identity });
    const obj = objective(work, "REPEAT_PURCHASE");
    assert.notEqual(obj.status, "READY");
    assert.equal(obj.blockers.some((item) => item.code === "IDENTITY_REQUIREMENT"), true);
    const historyStep = step(work, "LOAD_PURCHASE_HISTORY");
    assert.notEqual(historyStep.status, "READY");
  }
});

test("RPH04: REPEAT_PURCHASE at LEVEL_3 is READY and derives a READY LOAD_PURCHASE_HISTORY step, no identity blocker", () => {
  const work = project({ objectiveSeeds: [objectiveSeed("REPEAT_PURCHASE")], runtimeIdentity: LEVEL_3_SUFFICIENT });
  const obj = objective(work, "REPEAT_PURCHASE");
  assert.equal(obj.status, "READY");
  assert.equal(obj.blockers.some((item) => item.code === "IDENTITY_REQUIREMENT"), false);
  const historyStep = step(work, "LOAD_PURCHASE_HISTORY");
  assert.equal(historyStep.status, "READY");
  assert.equal(historyStep.capabilityName, "get_customer_purchase_history");
});

// ---------------------------------------------------------------------------
// RPH13: no purchase history is a terminal, successful outcome - never
// WAITING_CUSTOMER, never re-triggers onboarding.
// ---------------------------------------------------------------------------

test("RPH13: no purchase history at all completes the objective (no fabricated selection, no onboarding re-trigger)", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("REPEAT_PURCHASE")],
    runtimeIdentity: LEVEL_3_SUFFICIENT,
    recentCapabilityExecutions: [purchaseHistoryExecution({ previousProducts: [] })]
  });
  const obj = objective(work, "REPEAT_PURCHASE");
  assert.equal(obj.status, "COMPLETED");
  assert.equal(obj.inputs.items, undefined);
  assert.equal(obj.inputs.productReference, undefined);
});

// ---------------------------------------------------------------------------
// RPH07/26/27: a single historical product resolves via the exact same
// catalog-resolution chain SELECT_PRODUCTS already uses - never trusts the
// historical id directly.
// ---------------------------------------------------------------------------

test("RPH07/26/27: a single previous product derives a real SEARCH_PRODUCTS step (never trusts the historical productId as still sellable)", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("REPEAT_PURCHASE")],
    runtimeIdentity: LEVEL_3_SUFFICIENT,
    recentCapabilityExecutions: [purchaseHistoryExecution({ previousProducts: [{ historicalProductId: "555", historicalName: "Disco Olimpico 20kg", quantity: 2 }] })]
  });
  const obj = objective(work, "REPEAT_PURCHASE");
  assert.equal(obj.inputs.productReference, "Disco Olimpico 20kg");
  assert.equal(obj.inputs.quantity, 2);
  assert.equal(obj.status, "READY");
  const searchStep = step(work, "SEARCH_PRODUCTS");
  assert.equal(searchStep.status, "READY");
  assert.equal(searchStep.capabilityName, "search_products");
  // The catalog search is keyed by the historical NAME, never the historical
  // productId (a different id space per A10's own audit) - RPH26/27.
  assert.equal(searchStep.input.productReference, "Disco Olimpico 20kg");
  assert.notEqual(searchStep.input.productReference, "555");
});

test("RPH07 continued: once Catalog resolves the same historical name to a real current product, SELECT_PRODUCTS proceeds READY with real items", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("REPEAT_PURCHASE")],
    runtimeIdentity: LEVEL_3_SUFFICIENT,
    recentCapabilityExecutions: [
      purchaseHistoryExecution({ previousProducts: [{ historicalProductId: "555", historicalName: "Disco Olimpico 20kg", quantity: 2 }] }),
      searchProductsExecution({ query: "Disco Olimpico 20kg", items: [{ productId: "731", name: "Disco Olimpico 20kg" }] })
    ]
  });
  const obj = objective(work, "REPEAT_PURCHASE");
  assert.equal(obj.status, "READY");
  assert.deepEqual(obj.inputs.items, [{ productId: "731", combinationId: null, quantity: 2 }]);
  const selectStep = step(work, "SELECT_PRODUCTS");
  assert.equal(selectStep.status, "READY");
  // RPH21: only one LOAD_PURCHASE_HISTORY step ever, never re-derived once resolved.
  assert.equal(work.steps.filter((item) => item.type === "LOAD_PURCHASE_HISTORY").length, 0);
});

// ---------------------------------------------------------------------------
// RPH08: 2+ distinct previous products never choose arbitrarily.
// ---------------------------------------------------------------------------

test("RPH08: 2+ distinct previous products wait for the customer, never auto-selecting one", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("REPEAT_PURCHASE")],
    runtimeIdentity: LEVEL_3_SUFFICIENT,
    recentCapabilityExecutions: [
      purchaseHistoryExecution({
        previousProducts: [
          { historicalProductId: "555", historicalName: "Disco Olimpico 20kg", quantity: 2 },
          { historicalProductId: "556", historicalName: "Barra Olimpica Classic 20kg", quantity: 1 }
        ]
      })
    ]
  });
  const obj = objective(work, "REPEAT_PURCHASE");
  assert.equal(obj.status, "WAITING_CUSTOMER");
  assert.equal(obj.missingRequirements.includes("REPEAT_PURCHASE_AMBIGUOUS"), true);
  assert.equal(obj.inputs.historicalPurchaseCandidates?.length, 2);
  assert.equal(obj.inputs.productReference, undefined);
});

test("RPH08 continued: a productHint that narrows to exactly one candidate resolves without asking", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("REPEAT_PURCHASE", { productHint: "barra" })],
    runtimeIdentity: LEVEL_3_SUFFICIENT,
    recentCapabilityExecutions: [
      purchaseHistoryExecution({
        previousProducts: [
          { historicalProductId: "555", historicalName: "Disco Olimpico 20kg", quantity: 2 },
          { historicalProductId: "556", historicalName: "Barra Olimpica Classic 20kg", quantity: 1 }
        ]
      })
    ]
  });
  const obj = objective(work, "REPEAT_PURCHASE");
  assert.equal(obj.inputs.productReference, "Barra Olimpica Classic 20kg");
  assert.equal(obj.status, "READY");
  assert.equal(obj.missingRequirements.includes("REPEAT_PURCHASE_AMBIGUOUS"), false);
});

// ---------------------------------------------------------------------------
// RPH10: a discontinued/not-found historical product never becomes a fake
// selection - reuses the exact same PRODUCT_NOT_FOUND path SELECT_PRODUCTS has.
// ---------------------------------------------------------------------------

test("RPH10: a historical product Catalog no longer resolves (no_match) waits for the customer, never a fabricated selection", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("REPEAT_PURCHASE")],
    runtimeIdentity: LEVEL_3_SUFFICIENT,
    recentCapabilityExecutions: [
      purchaseHistoryExecution({ previousProducts: [{ historicalProductId: "999", historicalName: "Producto Descontinuado XYZ", quantity: 1 }] }),
      searchProductsExecution({ query: "Producto Descontinuado XYZ", items: [] })
    ]
  });
  const obj = objective(work, "REPEAT_PURCHASE");
  assert.equal(obj.status, "WAITING_CUSTOMER");
  assert.equal(obj.missingRequirements.includes("PRODUCT_NOT_FOUND"), true);
  assert.equal(obj.inputs.items, undefined);
});

// ---------------------------------------------------------------------------
// RPH12: current-turn quantity overrides historical quantity.
// ---------------------------------------------------------------------------

test("RPH12: an explicit current-turn quantity overrides the historical quantity", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("REPEAT_PURCHASE", { quantity: 5 })],
    runtimeIdentity: LEVEL_3_SUFFICIENT,
    recentCapabilityExecutions: [purchaseHistoryExecution({ previousProducts: [{ historicalProductId: "555", historicalName: "Disco Olimpico 20kg", quantity: 2 }] })]
  });
  const obj = objective(work, "REPEAT_PURCHASE");
  assert.equal(obj.inputs.quantity, 5);
});

test("RPH12 continued: with no current-turn quantity, the historical quantity is used", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("REPEAT_PURCHASE")],
    runtimeIdentity: LEVEL_3_SUFFICIENT,
    recentCapabilityExecutions: [purchaseHistoryExecution({ previousProducts: [{ historicalProductId: "555", historicalName: "Disco Olimpico 20kg", quantity: 2 }] })]
  });
  const obj = objective(work, "REPEAT_PURCHASE");
  assert.equal(obj.inputs.quantity, 2);
});

// ---------------------------------------------------------------------------
// RPH14/15/16: Customer Profile failure semantics - identity is never
// touched, and an unrelated objective in the same work is never affected.
// ---------------------------------------------------------------------------

test("RPH15: a retryable Customer Profile failure is WAITING_SYSTEM, never WAITING_CUSTOMER, and never touches an unrelated objective", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("REPEAT_PURCHASE"), objectiveSeed("SET_DESTINATION", { destinationText: "Nunoa" })],
    runtimeIdentity: LEVEL_3_SUFFICIENT,
    recentCapabilityExecutions: [purchaseHistoryExecution({ executionStatus: "temporarily_blocked", retryable: true, errorCode: "customer_profile_unavailable" })]
  });
  const obj = objective(work, "REPEAT_PURCHASE");
  assert.equal(obj.status, "WAITING_SYSTEM");
  // RPH16: an unrelated objective in the same work is completely unaffected.
  assert.equal(objective(work, "SET_DESTINATION").status, "READY");
});

test("RPH14: a non-retryable Customer Profile failure is FAILED (system-owned), never re-opens onboarding", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("REPEAT_PURCHASE")],
    runtimeIdentity: LEVEL_3_SUFFICIENT,
    recentCapabilityExecutions: [purchaseHistoryExecution({ executionStatus: "failed", retryable: false, errorCode: "customer_profile_unavailable" })]
  });
  const obj = objective(work, "REPEAT_PURCHASE");
  assert.equal(obj.status, "FAILED");
});

// ---------------------------------------------------------------------------
// Supersession (PARTE 9/19): a disambiguating select_products reply
// supersedes the WAITING_CUSTOMER REPEAT_PURCHASE, never leaving two
// competing "selection" objectives alive.
// ---------------------------------------------------------------------------

test("a later select_products seed supersedes a still-pending REPEAT_PURCHASE (shared 'selection' supersession family)", () => {
  const work = project({
    objectiveSeeds: [
      objectiveSeed("REPEAT_PURCHASE"),
      objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "731", combinationId: null, quantity: 1 }] })
    ],
    runtimeIdentity: LEVEL_3_SUFFICIENT
  });
  const repeatObjective = objective(work, "REPEAT_PURCHASE");
  assert.equal(repeatObjective.status, "SUPERSEDED");
  assert.equal(objective(work, "SELECT_PRODUCTS").status, "READY");
});
