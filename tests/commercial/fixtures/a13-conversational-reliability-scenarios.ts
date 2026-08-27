import type { CommercialIntentPlan } from "@/lib/brain/commercial/multi-intent/types";
import type { RuntimeIdentityContext, RuntimeIdentityStatus } from "@/lib/brain/commercial/native-cycle/customer-session/runtimeIdentityContext";
import type { IdentityLevel } from "@/lib/domains/customer-identity-verification";

/**
 * SALES-AGENT-R2-A13. Pure data for the Conversational Reliability Benchmark
 * - no I/O, no DB, no HTTP. The runner/tests
 * (a13ConversationalReliabilityBenchmark.test.ts) drive
 * runCommercialWorkInboundCycle (the canonical CommercialWork inbound entry
 * point) turn by turn using these planner-script/identity fixtures, exactly
 * the same offline-planner discipline every other CommercialWork E2E test in
 * this codebase already uses (commercialWorkInboundCycle.test.ts,
 * repeatPurchaseE2E.test.ts, customerAwareRecommendationE2E.test.ts) - no
 * live LLM call anywhere in this benchmark's structural layer.
 */

// ==========================================================================
// Invariant / severity / category vocabulary (A13 task spec)
// ==========================================================================

export const A13_INVARIANTS = [
  "INTENT_CORRECT",
  "OBJECTIVE_CORRECT",
  "CAPABILITY_CORRECT",
  "NO_UNAUTHORIZED_SIDE_EFFECT",
  "NO_DUPLICATE_EXECUTION",
  "STATE_CONTINUITY",
  "NO_REPEATED_QUESTION",
  "NO_FALSE_PRODUCT",
  "NO_FALSE_PRICE",
  "NO_CONTEXT_LOSS",
  "CORRECT_DEGRADATION",
  "CORRECT_FINAL_RESPONSE"
] as const;
export type A13Invariant = (typeof A13_INVARIANTS)[number];

export const A13_FAILURE_SEVERITIES = ["P0", "P1", "P2", "P3"] as const;
export type A13FailureSeverity = (typeof A13_FAILURE_SEVERITIES)[number];

export const A13_CATEGORIES = [
  "product_search_and_selection",
  "ambiguity",
  "no_results",
  "quantity_changes",
  "product_changes",
  "repeat_purchase",
  "customer_aware_recommendation",
  "identity_l0_l2_l3",
  "onboarding_resume",
  "shipping_lookup_selection",
  "cancellation",
  "supersession",
  "multi_intent",
  "long_conversation_continuity",
  "unsupported_intent",
  "customer_profile_failure",
  "catalog_failure",
  "planner_malformed_output",
  "duplicate_inbound",
  "waiting_customer_continuation",
  "waiting_system_recovery"
] as const;
export type A13Category = (typeof A13_CATEGORIES)[number];

/**
 * Manifest: one row per scenario id, cross-referenced against the test file
 * (each `test()` block there names its scenario id in the title) and the
 * release doc's coverage table. Single source of truth for "which invariants
 * this scenario is responsible for" - kept here (data) rather than duplicated
 * in prose inside the test file or the doc.
 */
export type A13ScenarioManifestEntry = {
  id: string;
  category: A13Category;
  title: string;
  invariantsCovered: A13Invariant[];
};

export const A13_SCENARIO_MANIFEST: A13ScenarioManifestEntry[] = [
  { id: "A13-01", category: "product_search_and_selection", title: "Resolved product reference completes a real selection", invariantsCovered: ["INTENT_CORRECT", "OBJECTIVE_CORRECT", "CAPABILITY_CORRECT", "NO_FALSE_PRODUCT", "CORRECT_FINAL_RESPONSE"] },
  { id: "A13-02", category: "ambiguity", title: "Two-candidate reference fails closed, never guesses", invariantsCovered: ["OBJECTIVE_CORRECT", "NO_FALSE_PRODUCT", "CORRECT_DEGRADATION", "CORRECT_FINAL_RESPONSE"] },
  { id: "A13-03", category: "no_results", title: "Zero-candidate search reports not-found, never invents a product", invariantsCovered: ["OBJECTIVE_CORRECT", "NO_FALSE_PRODUCT", "CORRECT_DEGRADATION", "CORRECT_FINAL_RESPONSE"] },
  { id: "A13-04", category: "quantity_changes", title: "Bare quantity correction supersedes without losing the product", invariantsCovered: ["OBJECTIVE_CORRECT", "STATE_CONTINUITY", "NO_CONTEXT_LOSS", "NO_DUPLICATE_EXECUTION"] },
  { id: "A13-05", category: "product_changes", title: "Renaming the product supersedes the selection and invalidates stale shipping", invariantsCovered: ["OBJECTIVE_CORRECT", "STATE_CONTINUITY", "NO_CONTEXT_LOSS", "NO_FALSE_PRICE"] },
  { id: "A13-06", category: "repeat_purchase", title: "REPEAT_PURCHASE gated below LEVEL_3, dispatches once unlocked", invariantsCovered: ["OBJECTIVE_CORRECT", "CAPABILITY_CORRECT", "NO_UNAUTHORIZED_SIDE_EFFECT", "CORRECT_DEGRADATION"] },
  { id: "A13-07", category: "customer_aware_recommendation", title: "CUSTOMER_AWARE_RECOMMENDATION degrades to generic search on signal failure", invariantsCovered: ["OBJECTIVE_CORRECT", "CAPABILITY_CORRECT", "CORRECT_DEGRADATION", "CORRECT_FINAL_RESPONSE"] },
  { id: "A13-08", category: "identity_l0_l2_l3", title: "Identity gate blocks at L0, allows at L2/L3 as required per operation", invariantsCovered: ["OBJECTIVE_CORRECT", "NO_UNAUTHORIZED_SIDE_EFFECT", "CORRECT_DEGRADATION"] },
  { id: "A13-09", category: "onboarding_resume", title: "Identity-blocked objective resumes the SAME work once onboarding upgrades identity", invariantsCovered: ["STATE_CONTINUITY", "NO_CONTEXT_LOSS", "NO_DUPLICATE_EXECUTION", "CORRECT_FINAL_RESPONSE"] },
  { id: "A13-10", category: "shipping_lookup_selection", title: "Shipping quote then option selection completes durably", invariantsCovered: ["INTENT_CORRECT", "OBJECTIVE_CORRECT", "CAPABILITY_CORRECT", "NO_DUPLICATE_EXECUTION", "CORRECT_FINAL_RESPONSE"] },
  { id: "A13-11", category: "cancellation", title: "Explicit cancellation invalidates the targeted family only", invariantsCovered: ["OBJECTIVE_CORRECT", "NO_UNAUTHORIZED_SIDE_EFFECT", "CORRECT_FINAL_RESPONSE"] },
  { id: "A13-12", category: "supersession", title: "Destination correction invalidates stale shipping evidence and recalculates", invariantsCovered: ["OBJECTIVE_CORRECT", "STATE_CONTINUITY", "NO_CONTEXT_LOSS", "NO_FALSE_PRICE"] },
  { id: "A13-13", category: "multi_intent", title: "Two intents in one turn both progress correctly", invariantsCovered: ["INTENT_CORRECT", "OBJECTIVE_CORRECT", "CAPABILITY_CORRECT", "STATE_CONTINUITY"] },
  { id: "A13-14", category: "long_conversation_continuity", title: "Five-turn conversation never loses earlier facts", invariantsCovered: ["STATE_CONTINUITY", "NO_CONTEXT_LOSS", "NO_REPEATED_QUESTION", "CORRECT_FINAL_RESPONSE"] },
  { id: "A13-15", category: "unsupported_intent", title: "Unrecognized intent never crashes and never claims false progress", invariantsCovered: ["INTENT_CORRECT", "NO_UNAUTHORIZED_SIDE_EFFECT", "CORRECT_DEGRADATION", "CORRECT_FINAL_RESPONSE"] },
  { id: "A13-16", category: "customer_profile_failure", title: "Customer Profile unavailable degrades REPEAT_PURCHASE and CUSTOMER_AWARE_RECOMMENDATION differently, both honestly", invariantsCovered: ["CORRECT_DEGRADATION", "NO_FALSE_PRODUCT", "CORRECT_FINAL_RESPONSE"] },
  { id: "A13-17", category: "catalog_failure", title: "Catalog unavailable blocks system-owned, never asks the customer", invariantsCovered: ["OBJECTIVE_CORRECT", "NO_FALSE_PRODUCT", "CORRECT_DEGRADATION"] },
  { id: "A13-18", category: "planner_malformed_output", title: "Invalid/malformed planner output mutates nothing and dispatches a controlled fallback", invariantsCovered: ["NO_UNAUTHORIZED_SIDE_EFFECT", "CORRECT_DEGRADATION", "CORRECT_FINAL_RESPONSE"] },
  { id: "A13-19", category: "duplicate_inbound", title: "Same inboundMessageId twice never re-executes a mutating capability", invariantsCovered: ["NO_DUPLICATE_EXECUTION", "STATE_CONTINUITY"] },
  { id: "A13-20", category: "waiting_customer_continuation", title: "A follow-up answer resumes the same work without re-asking what is already known", invariantsCovered: ["STATE_CONTINUITY", "NO_REPEATED_QUESTION", "NO_CONTEXT_LOSS", "CORRECT_FINAL_RESPONSE"] },
  { id: "A13-21", category: "waiting_system_recovery", title: "A system-owned block recovers via the retry worker with zero customer input", invariantsCovered: ["CORRECT_DEGRADATION", "NO_DUPLICATE_EXECUTION", "STATE_CONTINUITY"] }
];

// ==========================================================================
// Reusable planner-script fixtures (raw CommercialIntentPlan payloads)
// ==========================================================================

export const PLAN_SELECT_CLASSIC_QTY2: CommercialIntentPlan = { intents: [{ type: "select_products", productReference: "classic", quantity: 2 }] };
export const PLAN_SELECT_PRO_QTY1: CommercialIntentPlan = { intents: [{ type: "select_products", productReference: "pro", quantity: 1 }] };
export const PLAN_SELECT_AMBIGUOUS_BARRA: CommercialIntentPlan = { intents: [{ type: "select_products", productReference: "barra olimpica", quantity: 1 }] };
export const PLAN_SELECT_NO_MATCH: CommercialIntentPlan = { intents: [{ type: "select_products", productReference: "mancuerna inexistente 999", quantity: 1 }] };
export const PLAN_QUANTITY_CORRECTION = (quantity: number): CommercialIntentPlan => ({ intents: [{ type: "select_products", quantity }] });
export const PLAN_SHIPPING_QUOTE_NUNOA: CommercialIntentPlan = { intents: [{ type: "get_shipping_quote", destination: "Nunoa" }] };
export const PLAN_SHIPPING_QUOTE_NO_DESTINATION: CommercialIntentPlan = { intents: [{ type: "get_shipping_quote" }] };
export const PLAN_SHIPPING_QUOTE_LAS_CONDES: CommercialIntentPlan = { intents: [{ type: "get_shipping_quote", destination: "Las Condes" }] };
export const PLAN_SELECT_SHIPPING_OPTION_FIRST: CommercialIntentPlan = { intents: [{ type: "select_shipping_option", optionReference: "la primera" }] };
export const PLAN_CREATE_QUOTE: CommercialIntentPlan = { intents: [{ type: "create_quote" }] };
export const PLAN_CANCEL_SELECTION: CommercialIntentPlan = { intents: [{ type: "cancel", scope: "selection" }] };
export const PLAN_REPEAT_PURCHASE: CommercialIntentPlan = { intents: [{ type: "repeat_purchase" }] };
export const PLAN_CUSTOMER_AWARE_RECOMMENDATION: CommercialIntentPlan = { intents: [{ type: "customer_aware_recommendation" }] };
export const PLAN_UNSUPPORTED: CommercialIntentPlan = { intents: [{ type: "unsupported", description: "solicita factura electronica con giro comercial" }] };
export const PLAN_MULTI_INTENT_SELECT_AND_SHIP: CommercialIntentPlan = {
  intents: [
    { type: "select_products", productReference: "classic", quantity: 1 },
    { type: "get_shipping_quote", destination: "Nunoa" }
  ]
};

// ==========================================================================
// Identity fixtures (pure - RuntimeIdentityContext construction only)
// ==========================================================================

export function buildRuntimeIdentity(overrides: Partial<RuntimeIdentityContext> = {}): RuntimeIdentityContext {
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

export function runtimeIdentityAtLevel(level: IdentityLevel, status: RuntimeIdentityStatus, overrides: Partial<RuntimeIdentityContext> = {}): RuntimeIdentityContext {
  return buildRuntimeIdentity({ identityLevel: level, status, ...overrides });
}
