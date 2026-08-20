import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCommercialWorkProjection,
  deriveCommercialObjectives,
  formatCommercialWorkProjection,
  type CommercialCapabilityExecutionProjection,
  type CommercialObjectiveSeed,
  type CommercialWorkProjectionInput
} from "@/lib/brain/commercial/work";
import type { CommercialLineItemSelection } from "@/lib/domains/commercial-line-items";
import type { CreatedQuote } from "@/lib/domains/created-quote";
import type { SelectedShippingOption } from "@/lib/domains/selected-shipping-option";
import type { ShippingDestination } from "@/lib/domains/shipping-destination";

const NOW = "2026-08-17T12:00:00.000Z";

function selection(factId = "selection-2-classic", quantity = 2): CommercialLineItemSelection {
  return {
    factId,
    updatedAt: NOW,
    items: [{ productId: "31", combinationId: null, quantity }]
  };
}

function destination(factId = "destination-nunoa", canonicalName = "Nunoa", communeId = 13120): ShippingDestination {
  return { factId, updatedAt: NOW, canonicalName, communeId, matchedVia: "direct" };
}

function shippingExecution(input: {
  selectionFactId: string;
  destinationFactId: string;
  executionStatus?: CommercialCapabilityExecutionProjection["executionStatus"];
  retryable?: boolean;
  publicId?: string;
  status?: string;
}): CommercialCapabilityExecutionProjection {
  return {
    publicId: input.publicId ?? "shipping-exec-1",
    capabilityName: "calculate_shipping",
    executionStatus: input.executionStatus ?? "completed",
    retryable: input.retryable ?? false,
    errorCode: input.executionStatus === "temporarily_blocked" ? "carrier_unavailable" : null,
    completedAt: NOW,
    responseSummaryJson: {
      status: input.status ?? "available",
      selectionFactId: input.selectionFactId,
      destinationFactId: input.destinationFactId,
      options: [{ index: 0, carrierName: "BlueExpress", serviceType: "standard", totalCost: 3990, estimatedDelivery: "2 dias" }]
    }
  };
}

function searchProductsExecution(input: {
  query: string;
  items?: Array<{ productId: string; combinationId?: string | null; name: string }>;
  executionStatus?: CommercialCapabilityExecutionProjection["executionStatus"];
  retryable?: boolean;
  errorCode?: string | null;
  publicId?: string;
}): CommercialCapabilityExecutionProjection {
  const executionStatus = input.executionStatus ?? "completed";
  return {
    publicId: input.publicId ?? "search-exec-1",
    capabilityName: "search_products",
    executionStatus,
    retryable: input.retryable ?? false,
    errorCode: input.errorCode ?? null,
    completedAt: NOW,
    requestSummaryJson: { query: input.query, limit: 5 },
    responseSummaryJson: executionStatus === "completed" ? { query: input.query, items: input.items ?? [] } : null
  };
}

function quote(selectionFactId = "selection-2-classic"): CreatedQuote {
  return {
    factId: "quote-fact-1",
    updatedAt: NOW,
    quoteId: "quote-1",
    quoteNumber: "Q-1",
    status: "draft",
    currency: "CLP",
    total: "179980",
    validUntil: "2026-08-24T00:00:00.000Z",
    selectionFactId,
    idempotencyKey: "quote-key",
    createdAt: NOW
  };
}

function selectedShippingOption(selectionFactId = "selection-2-classic", destinationFactId = "destination-nunoa"): SelectedShippingOption {
  return {
    factId: "selected-shipping-fact-1",
    updatedAt: NOW,
    carrierName: "BlueExpress",
    serviceType: "standard",
    totalCost: 3990,
    estimatedDelivery: "2 dias",
    optionIndex: 0,
    shippingQuoteExecutionId: "shipping-exec-1",
    shippingQuoteCorrelationId: null,
    selectionFactId,
    destinationFactId,
    calculatedAt: NOW,
    selectedAt: NOW
  };
}

function baseInput(overrides: Partial<CommercialWorkProjectionInput> = {}): CommercialWorkProjectionInput {
  return {
    trigger: { type: "CUSTOMER_MESSAGE", conversationId: 1, opportunityId: 10, sourceMessageId: 100 },
    conversation: { id: 1, humanOwnerActive: false, aiEnabled: true },
    opportunity: { id: 10 },
    now: NOW,
    ...overrides
  };
}

function project(overrides: Partial<CommercialWorkProjectionInput> = {}) {
  return buildCommercialWorkProjection(baseInput(overrides));
}

function objectiveSeed(type: Exclude<CommercialObjectiveSeed, { kind: "cancel" }>["type"], inputs: Exclude<CommercialObjectiveSeed, { kind: "cancel" }>["inputs"] = {}): CommercialObjectiveSeed {
  return { type, origin: "customer_requested", inputs };
}

function objective(work: ReturnType<typeof project>, type: string) {
  const found = work.objectives.find((item) => item.type === type);
  assert.ok(found, `expected objective ${type}`);
  return found;
}

function step(work: ReturnType<typeof project>, type: string) {
  const found = work.steps.find((item) => item.type === type);
  assert.ok(found, `expected step ${type}`);
  return found;
}

test("CW01 simple discovery creates a ready search step only when seeded", () => {
  const work = project({ objectiveSeeds: [objectiveSeed("DISCOVER_PRODUCTS", { query: "barra olimpica" })] });
  assert.equal(objective(work, "DISCOVER_PRODUCTS").status, "READY");
  assert.equal(step(work, "SEARCH_PRODUCTS").status, "READY");
});

test("CW02 selection ready when product items are seeded and no matching selection exists", () => {
  const work = project({ objectiveSeeds: [objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] })] });
  assert.equal(objective(work, "SELECT_PRODUCTS").status, "READY");
  assert.equal(step(work, "SELECT_PRODUCTS").status, "READY");
});

test("CW03 selection completed when active line-item fact matches seeded items", () => {
  const work = project({
    commercialLineItems: selection(),
    objectiveSeeds: [objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] })]
  });
  assert.equal(objective(work, "SELECT_PRODUCTS").status, "COMPLETED");
  assert.equal(step(work, "SELECT_PRODUCTS").status, "COMPLETED");
});

test("CW04 C09 no state: selection and destination can be ready, shipping remains blocked", () => {
  const work = project({
    objectiveSeeds: [
      objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] }),
      objectiveSeed("SET_DESTINATION", { destinationText: "Nunoa" }),
      objectiveSeed("GET_SHIPPING_QUOTE", { destinationText: "Nunoa" })
    ]
  });
  assert.equal(objective(work, "SELECT_PRODUCTS").status, "READY");
  assert.equal(objective(work, "SET_DESTINATION").status, "READY");
  assert.equal(objective(work, "GET_SHIPPING_QUOTE").status, "BLOCKED");
});

test("CW05 C09 selection only: destination is ready from input, calculate shipping is blocked", () => {
  const work = project({
    commercialLineItems: selection(),
    objectiveSeeds: [objectiveSeed("SET_DESTINATION", { destinationText: "Nunoa" }), objectiveSeed("GET_SHIPPING_QUOTE", { destinationText: "Nunoa" })]
  });
  assert.equal(objective(work, "SET_DESTINATION").status, "READY");
  assert.equal(objective(work, "GET_SHIPPING_QUOTE").status, "BLOCKED");
  assert.equal(step(work, "CALCULATE_SHIPPING").status, "BLOCKED");
});

test("CW06 C09 selection + destination with no shipping evidence projects calculate_shipping READY", () => {
  const work = project({
    commercialLineItems: selection(),
    shippingDestination: destination(),
    objectiveSeeds: [objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] }), objectiveSeed("GET_SHIPPING_QUOTE")]
  });
  assert.equal(objective(work, "SELECT_PRODUCTS").status, "COMPLETED");
  assert.equal(objective(work, "GET_SHIPPING_QUOTE").status, "READY");
  assert.equal(step(work, "CALCULATE_SHIPPING").status, "READY");
});

test("CW07 C09 shipping completed when evidence matches current facts", () => {
  const work = project({
    commercialLineItems: selection(),
    shippingDestination: destination(),
    recentCapabilityExecutions: [shippingExecution({ selectionFactId: "selection-2-classic", destinationFactId: "destination-nunoa" })],
    objectiveSeeds: [objectiveSeed("GET_SHIPPING_QUOTE")]
  });
  assert.equal(objective(work, "GET_SHIPPING_QUOTE").status, "COMPLETED");
  assert.equal(step(work, "CALCULATE_SHIPPING").status, "COMPLETED");
});

test("CW08 missing destination without destination input waits for customer", () => {
  const work = project({ commercialLineItems: selection(), objectiveSeeds: [objectiveSeed("GET_SHIPPING_QUOTE")] });
  assert.equal(objective(work, "GET_SHIPPING_QUOTE").status, "WAITING_CUSTOMER");
  assert.equal(work.blockers.some((item) => item.code === "MISSING_DESTINATION"), true);
});

test("CW09 shipping unavailable projects waiting system and retry candidate", () => {
  const work = project({
    commercialLineItems: selection(),
    shippingDestination: destination(),
    recentCapabilityExecutions: [shippingExecution({ selectionFactId: "selection-2-classic", destinationFactId: "destination-nunoa", executionStatus: "temporarily_blocked", retryable: true, status: "failed" })],
    objectiveSeeds: [objectiveSeed("GET_SHIPPING_QUOTE")]
  });
  assert.equal(objective(work, "GET_SHIPPING_QUOTE").status, "WAITING_SYSTEM");
  assert.equal(step(work, "CALCULATE_SHIPPING").status, "WAITING_SYSTEM");
  assert.equal(step(work, "CALCULATE_SHIPPING").retryCandidate, true);
});

test("CW09b1 (A11.1) an unresolved product reference with no search yet is READY, not WAITING_CUSTOMER - system must search first", () => {
  const work = project({ objectiveSeeds: [objectiveSeed("SELECT_PRODUCTS", { productReference: "la barra", quantity: 1 })] });
  assert.equal(objective(work, "SELECT_PRODUCTS").status, "READY");
  assert.equal(step(work, "SEARCH_PRODUCTS").status, "READY");
  assert.equal(step(work, "SEARCH_PRODUCTS").capabilityName, "search_products");
  const selectStep = work.steps.find((item) => item.type === "SELECT_PRODUCTS");
  assert.ok(selectStep);
  assert.equal(selectStep!.status, "BLOCKED");
  assert.equal(selectStep!.dependencies.some((dependency) => dependency.type === "STEP_COMPLETED"), true);
});

test("CW09b2 (A11.1) a completed search with exactly one candidate auto-selects and proceeds to READY select_products", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("SELECT_PRODUCTS", { productReference: "barra olimpica classic 20kg", quantity: 2 })],
    recentCapabilityExecutions: [
      searchProductsExecution({ query: "barra olimpica classic 20kg", items: [{ productId: "31", name: "Barra Olimpica Classic 20kg" }] })
    ]
  });
  assert.equal(objective(work, "SELECT_PRODUCTS").status, "READY");
  assert.deepEqual(objective(work, "SELECT_PRODUCTS").inputs.items, [{ productId: "31", combinationId: null, quantity: 2 }]);
  assert.equal(step(work, "SELECT_PRODUCTS").status, "READY");
  assert.equal(work.steps.some((item) => item.type === "SEARCH_PRODUCTS"), false);
});

test("CW09b3 (A11.1) a completed search with 2+ candidates waits for customer with real candidate names, never BLOCKED", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("SELECT_PRODUCTS", { productReference: "discos olimpicos de 20kg", quantity: 2 })],
    recentCapabilityExecutions: [
      searchProductsExecution({
        query: "discos olimpicos de 20kg",
        items: [
          { productId: "40", name: "Disco Olimpico Bumper 20kg" },
          { productId: "41", name: "Disco Olimpico Fundido 20kg" }
        ]
      })
    ]
  });
  const select = objective(work, "SELECT_PRODUCTS");
  assert.equal(select.status, "WAITING_CUSTOMER");
  assert.equal(select.missingRequirements.includes("PRODUCT_AMBIGUOUS"), true);
  assert.equal(select.inputs.productCandidates?.length, 2);
  assert.equal(step(work, "SELECT_PRODUCTS").status, "WAITING_CUSTOMER");
  assert.equal(work.status, "WAITING_CUSTOMER");
});

test("CW09b4 (A11.1) a completed search with zero candidates waits for customer as not-found, never invents a product", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("SELECT_PRODUCTS", { productReference: "producto inexistente", quantity: 1 })],
    recentCapabilityExecutions: [searchProductsExecution({ query: "producto inexistente", items: [] })]
  });
  const select = objective(work, "SELECT_PRODUCTS");
  assert.equal(select.status, "WAITING_CUSTOMER");
  assert.equal(select.missingRequirements.includes("PRODUCT_NOT_FOUND"), true);
  assert.equal(select.inputs.items, undefined);
});

test("CW09b5 (A11.1) a technically failed, retryable search never becomes WAITING_CUSTOMER - system-owned, WAITING_SYSTEM instead", () => {
  const work = project({
    objectiveSeeds: [objectiveSeed("SELECT_PRODUCTS", { productReference: "discos olimpicos de 20kg", quantity: 2 })],
    recentCapabilityExecutions: [
      searchProductsExecution({ query: "discos olimpicos de 20kg", executionStatus: "temporarily_blocked", retryable: true, errorCode: "catalog_service_not_configured" })
    ]
  });
  const select = objective(work, "SELECT_PRODUCTS");
  assert.equal(select.status, "WAITING_SYSTEM");
});

test("BLOCK01 (A11.1) work.blockers never duplicates an objective's blocker via its step's verbatim copy", () => {
  // deriveCommercialWorkSteps.ts copies blockers: [...objective.blockers]
  // onto the SELECT_PRODUCTS step by design (source: "objective", no
  // stepId - a step-level consumer should not have to cross-reference its
  // objective) - a missing-product objective is the simplest reproduction:
  // MISSING_PRODUCT ends up on both the objective and its step, and
  // collectCommercialWorkBlockers (evaluateCommercialWork.ts) must not
  // double-count it in the work-level aggregate.
  const work = project({ objectiveSeeds: [objectiveSeed("SELECT_PRODUCTS")] });
  const missingProductBlockers = work.blockers.filter((item) => item.code === "MISSING_PRODUCT");
  assert.equal(missingProductBlockers.length, 1, `expected exactly one MISSING_PRODUCT blocker, got ${missingProductBlockers.length}`);
});

test("CW10 quantity change invalidates dependent shipping evidence before the durable fact is updated", () => {
  const work = project({
    commercialLineItems: selection("selection-2-classic", 2),
    shippingDestination: destination(),
    recentCapabilityExecutions: [shippingExecution({ selectionFactId: "selection-2-classic", destinationFactId: "destination-nunoa" })],
    objectiveSeeds: [
      objectiveSeed("CHANGE_QUANTITY", { items: [{ productId: "31", combinationId: null, quantity: 3 }] }),
      objectiveSeed("GET_SHIPPING_QUOTE")
    ]
  });
  assert.equal(objective(work, "CHANGE_QUANTITY").status, "READY");
  assert.equal(objective(work, "GET_SHIPPING_QUOTE").status, "BLOCKED");
  assert.equal(work.blockers.some((item) => item.code === "STALE_EVIDENCE"), true);
});

test("CW10b quantity change becomes completed after the durable fact is updated", () => {
  const work = project({
    commercialLineItems: selection("selection-3-classic", 3),
    objectiveSeeds: [objectiveSeed("CHANGE_QUANTITY", { items: [{ productId: "31", combinationId: null, quantity: 3 }] })]
  });
  assert.equal(objective(work, "CHANGE_QUANTITY").status, "COMPLETED");
});

test("CW11 destination change invalidates shipping until destination update is durable", () => {
  const work = project({
    commercialLineItems: selection(),
    shippingDestination: destination("destination-nunoa", "Nunoa"),
    recentCapabilityExecutions: [shippingExecution({ selectionFactId: "selection-2-classic", destinationFactId: "destination-nunoa" })],
    objectiveSeeds: [objectiveSeed("SET_DESTINATION", { destinationText: "Las Condes" }), objectiveSeed("GET_SHIPPING_QUOTE", { destinationText: "Las Condes" })]
  });
  assert.equal(objective(work, "SET_DESTINATION").status, "READY");
  assert.equal(objective(work, "GET_SHIPPING_QUOTE").status, "BLOCKED");
});

test("CW11b after durable destination update calculate_shipping is ready", () => {
  const work = project({
    commercialLineItems: selection(),
    shippingDestination: destination("destination-las-condes", "Las Condes"),
    objectiveSeeds: [objectiveSeed("SET_DESTINATION", { destinationText: "Las Condes" }), objectiveSeed("GET_SHIPPING_QUOTE")]
  });
  assert.equal(objective(work, "SET_DESTINATION").status, "COMPLETED");
  assert.equal(step(work, "CALCULATE_SHIPPING").status, "READY");
});

test("CW12 create quote READY with current real dependency: selection only", () => {
  const work = project({ commercialLineItems: selection(), objectiveSeeds: [objectiveSeed("CREATE_QUOTE")] });
  assert.equal(objective(work, "CREATE_QUOTE").status, "READY");
  assert.equal(step(work, "CREATE_QUOTE").status, "READY");
});

test("CW13 create quote COMPLETED when created_quote matches current selectionFactId", () => {
  const work = project({ commercialLineItems: selection(), createdQuote: quote("selection-2-classic"), objectiveSeeds: [objectiveSeed("CREATE_QUOTE")] });
  assert.equal(objective(work, "CREATE_QUOTE").status, "COMPLETED");
  assert.equal(step(work, "CREATE_QUOTE").status, "COMPLETED");
});

test("CW14 stale quote is rejected after selection changes", () => {
  const work = project({ commercialLineItems: selection("selection-3-classic", 3), createdQuote: quote("selection-2-classic"), objectiveSeeds: [objectiveSeed("CREATE_QUOTE")] });
  assert.equal(objective(work, "CREATE_QUOTE").status, "READY");
  assert.equal(objective(work, "CREATE_QUOTE").evidence.some((item) => item.stale === true), true);
});

test("CW15 human handoff blocks autonomous steps", () => {
  const work = project({
    conversation: { id: 1, humanOwnerActive: true, aiEnabled: true },
    objectiveSeeds: [objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] })]
  });
  assert.equal(work.status, "HANDOFF");
  assert.equal(step(work, "SELECT_PRODUCTS").status, "BLOCKED");
  assert.equal(work.blockers.some((item) => item.code === "HUMAN_OWNER_ACTIVE"), true);
});

test("CW16 ai disabled blocks autonomous steps", () => {
  const work = project({
    conversation: { id: 1, humanOwnerActive: false, aiEnabled: false },
    objectiveSeeds: [objectiveSeed("SET_DESTINATION", { destinationText: "Nunoa" })]
  });
  assert.equal(work.status, "HANDOFF");
  assert.equal(step(work, "SET_SHIPPING_DESTINATION").status, "BLOCKED");
  assert.equal(work.blockers.some((item) => item.code === "AI_DISABLED"), true);
});

test("CW17 superseded objective keeps old objective visible and current objective active", () => {
  const objectives = deriveCommercialObjectives({
    seedIdPrefix: "projection:test",
    seeds: [objectiveSeed("SET_DESTINATION", { destinationText: "Nunoa" }), objectiveSeed("SET_DESTINATION", { destinationText: "Las Condes" })]
  });
  assert.equal(objectives[0].status, "SUPERSEDED");
  assert.equal(objectives[1].status, "PENDING");
  assert.deepEqual(objectives[1].supersedesObjectiveIds, [objectives[0].objectiveId]);
});

test("CW18 cancelled objective is represented without DB state", () => {
  const objectives = deriveCommercialObjectives({
    seedIdPrefix: "projection:test",
    seeds: [objectiveSeed("SELECT_PRODUCTS", { items: [{ productId: "31", combinationId: null, quantity: 2 }] }), { kind: "cancel", targetType: "selection" }]
  });
  assert.equal(objectives[0].status, "CANCELLED");
});

test("CW19 stale shipping evidence is rejected when fact ids do not match", () => {
  const work = project({
    commercialLineItems: selection("selection-current"),
    shippingDestination: destination("destination-current"),
    recentCapabilityExecutions: [shippingExecution({ selectionFactId: "selection-old", destinationFactId: "destination-current" })],
    objectiveSeeds: [objectiveSeed("GET_SHIPPING_QUOTE")]
  });
  assert.equal(objective(work, "GET_SHIPPING_QUOTE").status, "READY");
  assert.equal(objective(work, "GET_SHIPPING_QUOTE").evidence.some((item) => item.stale === true && item.reason === "selection_changed"), true);
  assert.equal(step(work, "CALCULATE_SHIPPING").status, "READY");
});

test("CW20 builder has no side effects and does not mutate input", () => {
  const input = baseInput({
    commercialLineItems: selection(),
    shippingDestination: destination(),
    objectiveSeeds: [objectiveSeed("GET_SHIPPING_QUOTE")]
  });
  const before = JSON.stringify(input);
  buildCommercialWorkProjection(input);
  assert.equal(JSON.stringify(input), before);
});

test("facts alone do not create shipping quote work", () => {
  const work = project({ commercialLineItems: selection(), shippingDestination: destination(), objectiveSeeds: [] });
  assert.equal(work.objectives.length, 0);
  assert.equal(work.steps.length, 0);
});

test("recent catalog context/evidence alone does not create discovery objective", () => {
  const work = project({
    recentCapabilityExecutions: [{ publicId: "search-1", capabilityName: "search_products", executionStatus: "completed", responseSummaryJson: { items: [{ productId: "31" }] }, completedAt: NOW }],
    objectiveSeeds: []
  });
  assert.equal(work.objectives.length, 0);
});

test("pending commercial intents seed semantic state, projection derives execution readiness from durable facts", () => {
  const work = project({
    commercialLineItems: selection(),
    shippingDestination: destination(),
    pendingCommercialIntents: [{ intent: { type: "get_shipping_quote", destination: "Nunoa" }, missingRequirements: [], savedAt: NOW }]
  });
  assert.equal(objective(work, "GET_SHIPPING_QUOTE").status, "READY");
  assert.equal(step(work, "CALCULATE_SHIPPING").status, "READY");
});

test("provider unavailable does not block deterministic shipping step when facts are ready and no provider state is part of input", () => {
  const work = project({
    commercialLineItems: selection(),
    shippingDestination: destination(),
    objectiveSeeds: [objectiveSeed("GET_SHIPPING_QUOTE")]
  });
  assert.equal(step(work, "CALCULATE_SHIPPING").status, "READY");
});

test("selected shipping option completes only when freshness anchors match current facts", () => {
  const work = project({
    commercialLineItems: selection(),
    shippingDestination: destination(),
    selectedShippingOption: selectedShippingOption(),
    objectiveSeeds: [objectiveSeed("SELECT_SHIPPING_OPTION", { optionIndex: 0 })]
  });
  assert.equal(objective(work, "SELECT_SHIPPING_OPTION").status, "COMPLETED");
});

test("projection is deterministic with injected now", () => {
  const input = baseInput({
    commercialLineItems: selection(),
    shippingDestination: destination(),
    objectiveSeeds: [objectiveSeed("GET_SHIPPING_QUOTE")]
  });
  const first = buildCommercialWorkProjection(input);
  const second = buildCommercialWorkProjection(input);
  assert.deepEqual(first, second);
});

test("formatter exposes a compact diagnostic view without raw customer payload", () => {
  const work = project({ commercialLineItems: selection(), shippingDestination: destination(), objectiveSeeds: [objectiveSeed("GET_SHIPPING_QUOTE")] });
  const formatted = formatCommercialWorkProjection(work);
  assert.match(formatted, /CommercialWork/);
  assert.match(formatted, /GET_SHIPPING_QUOTE READY/);
  assert.match(formatted, /CALCULATE_SHIPPING READY/);
});
