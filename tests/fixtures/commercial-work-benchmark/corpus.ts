import type { RecentCatalogContext } from "@/lib/brain/commercial/agent-loop/recentCatalogContext";
import type { R2ArchitectureScenario } from "@/lib/brain/commercial/work/benchmark/types";

/**
 * SALES-AGENT-R2-A07.5. R2-01..R2-12 - see the deliverable doc
 * (docs/releases/SALES-AGENT-R2-A07.5-controlled-architecture-validation.md)
 * for the full rationale per scenario. Reuses the legacy T08 benchmark's
 * fixture catalog identity (product 31 "Barra Olimpica Classic 20kg", commune
 * 99 "Nunoa") so the C09-equivalent case (R2-02) is comparable to T08's own
 * C09 - never the legacy scorer's tool-sequence requirements.
 */

export const CLASSIC_ONLY_CATALOG_CONTEXT: RecentCatalogContext = {
  interactions: [
    {
      inboundMessageId: "corpus-in-1",
      completedAt: "2026-08-17T12:00:00.000Z",
      sourceTool: "search_products",
      products: [{ productId: "31", name: "Barra Olimpica Classic 20kg" }]
    }
  ]
};

/** Two real, distinct candidates - R2-07's ambiguity fixture. */
export const AMBIGUOUS_BAR_CATALOG_CONTEXT: RecentCatalogContext = {
  interactions: [
    {
      inboundMessageId: "corpus-in-2",
      completedAt: "2026-08-17T12:00:00.000Z",
      sourceTool: "search_products",
      products: [
        { productId: "31", name: "Barra Olimpica Classic 20kg" },
        { productId: "32", name: "Barra Olimpica Pro 20kg" }
      ]
    }
  ]
};

const R2_01: R2ArchitectureScenario = {
  scenarioId: "R2-01",
  description: "Simple selection - equivalent to legacy C02/C04.",
  customerTurns: [{ customerMessage: "quiero 2 de la classic", recentCatalogContext: CLASSIC_ONLY_CATALOG_CONTEXT }],
  expected: {
    objectives: [{ type: "SELECT_PRODUCTS", status: "COMPLETED" }],
    workStatus: "COMPLETED",
    stepStatuses: [{ type: "SELECT_PRODUCTS", status: "COMPLETED" }],
    durableFacts: { commercialLineItems: [{ productId: "31", quantity: 2 }] },
    customerVisibleOutcome: "correct",
    retryExpected: false,
    followUpExpected: false,
    handoffExpected: false
  }
};

/**
 * R2-02, the decisive case (legacy C09 equivalent). T08E/T08F's own finding:
 * selection completes, then "Ahora calculo el despacho a Nunoa" with no
 * durable work backing it, because the tool budget was already spent. The
 * deterministic/offline stage here (real fake carrier, always succeeds) is
 * expected to land on Acceptable Result A (all three complete same cycle) -
 * Acceptable Result B (shipping WAITING_SYSTEM/RETRY_SCHEDULED but durable)
 * is exercised for real by R2-05's fault injection instead, so this
 * scenario's own gate is workStatus/stepStatuses accepting BOTH, matching
 * the task's own "Resultado aceptable A or B" framing.
 */
const R2_02: R2ArchitectureScenario = {
  scenarioId: "R2-02",
  description: "C09 equivalent: selection + shipping to Nunoa in one message - the decisive case.",
  customerTurns: [{ customerMessage: "quiero 2 de la classic y saber cuanto sale el despacho a Nunoa", recentCatalogContext: CLASSIC_ONLY_CATALOG_CONTEXT }],
  expected: {
    objectives: [
      { type: "SELECT_PRODUCTS", status: "COMPLETED" },
      { type: "SET_DESTINATION", status: "COMPLETED" },
      { type: "GET_SHIPPING_QUOTE", status: ["COMPLETED", "WAITING_SYSTEM"] }
    ],
    workStatus: ["COMPLETED", "WAITING_SYSTEM"],
    stepStatuses: [
      { type: "SELECT_PRODUCTS", status: "COMPLETED" },
      { type: "SET_SHIPPING_DESTINATION", status: "COMPLETED" },
      { type: "CALCULATE_SHIPPING", status: ["COMPLETED", "WAITING_SYSTEM", "RETRY_SCHEDULED"] }
    ],
    durableFacts: { commercialLineItems: [{ productId: "31", quantity: 2 }] },
    customerVisibleOutcome: "correct",
    retryExpected: false,
    followUpExpected: false,
    handoffExpected: false
  }
};

const R2_03: R2ArchitectureScenario = {
  scenarioId: "R2-03",
  description: "Selection + shipping question with no destination given yet.",
  customerTurns: [{ customerMessage: "quiero 2 de la classic y dime cuanto sale el despacho", recentCatalogContext: CLASSIC_ONLY_CATALOG_CONTEXT }],
  expected: {
    objectives: [
      { type: "SELECT_PRODUCTS", status: "COMPLETED" },
      { type: "GET_SHIPPING_QUOTE", status: "WAITING_CUSTOMER", missingRequirements: ["DESTINATION"] }
    ],
    workStatus: "WAITING_CUSTOMER",
    stepStatuses: [
      { type: "SELECT_PRODUCTS", status: "COMPLETED" },
      { type: "CALCULATE_SHIPPING", status: "WAITING_CUSTOMER" }
    ],
    durableFacts: { commercialLineItems: [{ productId: "31", quantity: 2 }] },
    customerVisibleOutcome: "correct",
    retryExpected: false,
    followUpExpected: false,
    handoffExpected: false
  }
};

/** Continuation of R2-03: a second turn answers the missing destination. */
const R2_04: R2ArchitectureScenario = {
  scenarioId: "R2-04",
  description: "Continuation of R2-03 - a bare commune name resumes the same CommercialWork.",
  customerTurns: [
    { customerMessage: "quiero 2 de la classic y dime cuanto sale el despacho", recentCatalogContext: CLASSIC_ONLY_CATALOG_CONTEXT },
    { customerMessage: "Nunoa" }
  ],
  expected: {
    objectives: [
      { type: "SELECT_PRODUCTS", status: "COMPLETED" },
      { type: "SET_DESTINATION", status: "COMPLETED" },
      { type: "GET_SHIPPING_QUOTE", status: "COMPLETED" }
    ],
    workStatus: "COMPLETED",
    stepStatuses: [
      { type: "SELECT_PRODUCTS", status: "COMPLETED" },
      { type: "SET_SHIPPING_DESTINATION", status: "COMPLETED" },
      { type: "CALCULATE_SHIPPING", status: "COMPLETED" }
    ],
    durableFacts: { commercialLineItems: [{ productId: "31", quantity: 2 }] },
    customerVisibleOutcome: "correct",
    retryExpected: false,
    followUpExpected: false,
    handoffExpected: false
  }
};

/** R2-05: calculate_shipping temporarily blocked once, then a later worker tick retries and completes it - zero customer input, zero LLM calls during the retry itself. */
const R2_05: R2ArchitectureScenario = {
  scenarioId: "R2-05",
  description: "Technical retry: calculate_shipping temporarily blocked once, then recovered by the A06 worker.",
  preSeededDurableState: { selectionItems: [{ productId: "31", quantity: 2 }], destinationText: "Nunoa" },
  customerTurns: [{ customerMessage: "cuanto sale el despacho" }],
  faultPlan: { temporarilyBlockOnce: ["calculate_shipping"] },
  expected: {
    objectives: [{ type: "GET_SHIPPING_QUOTE", status: "COMPLETED" }],
    workStatus: "COMPLETED",
    stepStatuses: [{ type: "CALCULATE_SHIPPING", status: "COMPLETED" }],
    durableFacts: {},
    customerVisibleOutcome: "correct",
    retryExpected: true,
    followUpExpected: false,
    handoffExpected: false
  }
};

/**
 * R2-06: create_quote's real side effect completes, then a simulated crash
 * happens before the step is persisted COMPLETED - the step is left RUNNING
 * with an expired lease; a later worker tick reclaims it and A05's evidence
 * repair completes it WITHOUT calling create_quote again. No planner intent
 * exists for "create a quote" (LLM-R1-T09A's scope is select_products |
 * get_shipping_quote | unsupported only) - directObjectiveSeeds bypasses the
 * planner for this turn, matching that this scenario tests durability/
 * idempotency, not semantic interpretation coverage that does not exist yet.
 */
const R2_06: R2ArchitectureScenario = {
  scenarioId: "R2-06",
  description: "Crash recovery: create_quote's side effect completes, a simulated crash follows, the worker recovers via evidence repair.",
  preSeededDurableState: { selectionItems: [{ productId: "31", quantity: 2 }] },
  customerTurns: [{ customerMessage: "hazme la cotizacion", directObjectiveSeeds: [{ type: "CREATE_QUOTE", origin: "customer_requested", inputs: {} }] }],
  faultPlan: { crashAfterSideEffect: ["create_quote"] },
  expected: {
    objectives: [{ type: "CREATE_QUOTE", status: "COMPLETED" }],
    workStatus: "COMPLETED",
    stepStatuses: [{ type: "CREATE_QUOTE", status: "COMPLETED" }],
    durableFacts: { createdQuoteExists: true },
    customerVisibleOutcome: "correct",
    retryExpected: false,
    followUpExpected: false,
    handoffExpected: false
  }
};

const R2_07: R2ArchitectureScenario = {
  scenarioId: "R2-07",
  description: "Ambiguous product reference - two real candidates, zero guessed product.",
  customerTurns: [{ customerMessage: "dame la barra", recentCatalogContext: AMBIGUOUS_BAR_CATALOG_CONTEXT }],
  expected: {
    // SALES-AGENT-R2-A11.1, Part 6. PRODUCT_AMBIGUOUS replaces the old
    // generic PRODUCT_EVIDENCE code - buildCommercialWorkFinalizerMessage.ts
    // now distinguishes "ambiguous, here are the real options" from a
    // system-owned search-not-yet-attempted gap, which PRODUCT_EVIDENCE used
    // to conflate.
    objectives: [{ type: "SELECT_PRODUCTS", status: "WAITING_CUSTOMER", missingRequirements: ["PRODUCT_AMBIGUOUS"] }],
    workStatus: "WAITING_CUSTOMER",
    stepStatuses: [{ type: "SELECT_PRODUCTS", status: "WAITING_CUSTOMER" }],
    durableFacts: {},
    customerVisibleOutcome: "correct",
    retryExpected: false,
    followUpExpected: false,
    handoffExpected: false
  }
};

/** R2-08: turn 2 corrects the quantity and (per applyPendingMutationInvalidations) invalidates the already-completed shipping quote until it is recalculated against the new selection. */
const R2_08: R2ArchitectureScenario = {
  scenarioId: "R2-08",
  description: "Correction/supersession: qty 2 -> 3 invalidates downstream shipping evidence, no duplicate active selection.",
  customerTurns: [
    { customerMessage: "quiero 2 de la classic y saber cuanto sale el despacho a Nunoa", recentCatalogContext: CLASSIC_ONLY_CATALOG_CONTEXT },
    { customerMessage: "mejor 3", recentCatalogContext: CLASSIC_ONLY_CATALOG_CONTEXT }
  ],
  expected: {
    objectives: [
      { type: "SELECT_PRODUCTS", status: "COMPLETED" },
      { type: "GET_SHIPPING_QUOTE", status: ["COMPLETED", "BLOCKED"] }
    ],
    workStatus: ["COMPLETED", "ACTIVE"],
    stepStatuses: [{ type: "SELECT_PRODUCTS", status: "COMPLETED" }],
    durableFacts: { commercialLineItems: [{ productId: "31", quantity: 3 }] },
    customerVisibleOutcome: "correct",
    retryExpected: false,
    followUpExpected: false,
    handoffExpected: false
  }
};

const R2_09: R2ArchitectureScenario = {
  scenarioId: "R2-09",
  description: "Quote creation on top of a valid existing selection - idempotent under retry/reload.",
  preSeededDurableState: { selectionItems: [{ productId: "31", quantity: 2 }] },
  customerTurns: [{ customerMessage: "hazme la cotizacion", directObjectiveSeeds: [{ type: "CREATE_QUOTE", origin: "customer_requested", inputs: {} }] }],
  expected: {
    objectives: [{ type: "CREATE_QUOTE", status: "COMPLETED" }],
    workStatus: "COMPLETED",
    stepStatuses: [{ type: "CREATE_QUOTE", status: "COMPLETED" }],
    durableFacts: { createdQuoteExists: true },
    customerVisibleOutcome: "correct",
    retryExpected: false,
    followUpExpected: false,
    handoffExpected: false
  }
};

const R2_12: R2ArchitectureScenario = {
  scenarioId: "R2-12",
  description: "Human handoff mid-work: no further autonomous execution, no unbacked mutation claim.",
  customerTurns: [{ customerMessage: "quiero 2 de la classic y cuanto sale el despacho a Nunoa", recentCatalogContext: CLASSIC_ONLY_CATALOG_CONTEXT }],
  conversationControlBeforeExecution: { humanOwnerActive: true },
  expected: {
    objectives: [{ type: "SELECT_PRODUCTS", status: ["READY", "PENDING", "BLOCKED"] }],
    workStatus: "HANDOFF",
    stepStatuses: [{ type: "SELECT_PRODUCTS", status: ["READY", "PENDING", "BLOCKED"] }],
    durableFacts: {},
    customerVisibleOutcome: "correct",
    retryExpected: false,
    followUpExpected: false,
    handoffExpected: true
  }
};

export const R2_ARCHITECTURE_CORPUS: R2ArchitectureScenario[] = [R2_01, R2_02, R2_03, R2_04, R2_05, R2_06, R2_07, R2_08, R2_09, R2_12];
