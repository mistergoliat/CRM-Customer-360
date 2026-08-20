import type { ToolObservation } from "../agent-loop/agentStepTypes";

/**
 * LLM-R1-T09A. Multi-Intent Planning + Requirement Resolution contract.
 *
 * Separates, explicitly, what the existing single-decision Agent Tool Loop
 * (runAgentToolLoop.ts) conflates into one LLM-driven step-by-step process:
 * INTENT (what the customer wants), REQUIREMENT (what is needed to resolve
 * it), ACTION (a real Capability Gateway capability), EXECUTION RESULT (what
 * actually happened - never what the model narrated). See
 * docs/architecture/commercial-multi-intent-planning.md for the full design
 * and docs/releases/LLM-R1-T09A-multi-intent-planning-and-requirement-resolution.md
 * for what this task actually shipped.
 *
 * Scope is deliberately narrow (task section "Alcance funcional inicial"):
 * only select_products and get_shipping_quote intents. The shapes below are
 * written so a future intent (e.g. create_quote) is a new union member and a
 * new IntentDefinition entry, never a rewrite of this contract.
 */

export const MAX_INTENTS_PER_PLAN = 6;
export const MAX_INTENT_TEXT_FIELD_LENGTH = 200;
export const MAX_QUANTITY = 9999;

export const COMMERCIAL_INTENT_TYPES = ["select_products", "get_shipping_quote", "create_quote", "cancel", "unsupported"] as const;
export type CommercialIntentType = (typeof COMMERCIAL_INTENT_TYPES)[number];

export type CommercialIntentSelectProducts = {
  type: "select_products";
  /**
   * Free text naming the product, in the customer's own words or resolved by
   * the planner LLM against recentCatalogContext (e.g. a pronoun like "esa"
   * resolved to a concrete product name) - never a productId, the planner
   * never sees catalog identity.
   *
   * SALES-AGENT-R2-A08.6, Part 2. Deliberately omitted (never invented) for a
   * bare quantity correction that does not rename the product ("mejor 3",
   * "deja 3", "quita una") - the requirement resolver's existing durable-state
   * fallback (requirementResolver.ts#resolveProductRequirement) already
   * carries the product forward from the active selection when this field is
   * absent, which is also what makes the corrected selection correctly
   * supersede the old one via the existing "selection" family instead of
   * needing a second, parallel correction mechanism.
   */
  productReference?: string;
  quantity?: number;
};

export type CommercialIntentGetShippingQuote = {
  type: "get_shipping_quote";
  /** Free text naming the destination commune, e.g. "Ñuñoa" - never a communeId. */
  destination?: string;
};

/**
 * SALES-AGENT-R2-A08.6, Part 4. Reuses the existing CREATE_QUOTE
 * objective/step/capability unchanged - createQuoteCapability.ts's own input
 * schema already takes no arguments (everything is assembled from durable
 * backend state), so this intent carries no fields either.
 */
export type CommercialIntentCreateQuote = {
  type: "create_quote";
};

/**
 * SALES-AGENT-R2-A08.6, Part 3. A closed, backend-owned scope vocabulary -
 * the model classifies into one of these five, never free text - matching
 * reconciliation.ts's own cancelTargetFamily accepted values exactly
 * (targetType "selection"|"destination"|"shipping"|"quote"|undefined, where
 * "all" here maps to undefined there).
 */
export const CANCEL_SCOPES = ["selection", "destination", "shipping", "quote", "all"] as const;
export type CommercialIntentCancelScope = (typeof CANCEL_SCOPES)[number];

export type CommercialIntentCancel = {
  type: "cancel";
  scope: CommercialIntentCancelScope;
  /**
   * SALES-AGENT-R2-A08.7, Part 7. Additional distinct scopes explicitly named
   * in the same message (e.g. "no quiero despacho ni cotizacion" -> scope
   * "shipping", additionalScopes ["quote"]). Only one cancel intent survives
   * per plan (parseCommercialIntentPlan.ts's dedupeByType), so a second
   * explicitly-named target has nowhere else to go - never inferred, never
   * includes "all", only ever narrows further. Absent/empty for the common
   * single-scope case.
   */
  additionalScopes?: Exclude<CommercialIntentCancelScope, "all">[];
};

/**
 * Part 3. A detected intent this system does not (yet) implement. Carries a
 * short, bounded description only for observability/clarification wording -
 * never a reason to invent a tool or map to the nearest known capability.
 */
export type CommercialIntentUnsupported = {
  type: "unsupported";
  description?: string;
};

export type CommercialIntent =
  | CommercialIntentSelectProducts
  | CommercialIntentGetShippingQuote
  | CommercialIntentCreateQuote
  | CommercialIntentCancel
  | CommercialIntentUnsupported;

export type CommercialIntentPlan = {
  intents: CommercialIntent[];
};

/**
 * Part 5/29. Requirement taxonomy. Only PRODUCT/QUANTITY/DESTINATION/
 * PRODUCT_SELECTION are resolved in T09A - CUSTOMER_IDENTITY/DELIVERY_ADDRESS/
 * EMAIL are declared for future intents (CREATE_QUOTE, CHECKOUT) but never
 * resolved or executed against here (task Parte 5: "dejar explicitamente
 * fuera de ejecucion").
 */
export const COMMERCIAL_REQUIREMENT_TYPES = [
  "PRODUCT",
  "QUANTITY",
  "DESTINATION",
  "PRODUCT_SELECTION",
  "CUSTOMER_IDENTITY",
  "DELIVERY_ADDRESS",
  "EMAIL"
] as const;
export type CommercialRequirementType = (typeof COMMERCIAL_REQUIREMENT_TYPES)[number];

/** Requirements T09A actually resolves/executes against - the rest of COMMERCIAL_REQUIREMENT_TYPES exists only as a documented future extension point. */
export const IMPLEMENTED_REQUIREMENT_TYPES: readonly CommercialRequirementType[] = ["PRODUCT", "QUANTITY", "DESTINATION", "PRODUCT_SELECTION"];

/**
 * Part 29 (IntentDefinition registry). Fixed, backend-owned - the model
 * supplies intent field VALUES only, never which requirements an intent has.
 * A future intent is a new registry entry, never a runtime-declared one.
 */
export type IntentDefinition = {
  type: CommercialIntentType;
  requirements: CommercialRequirementType[];
};

export const COMMERCIAL_INTENT_DEFINITIONS: Record<Exclude<CommercialIntentType, "unsupported">, IntentDefinition> = {
  select_products: { type: "select_products", requirements: ["PRODUCT", "QUANTITY"] },
  get_shipping_quote: { type: "get_shipping_quote", requirements: ["PRODUCT_SELECTION", "DESTINATION"] },
  create_quote: { type: "create_quote", requirements: ["PRODUCT_SELECTION"] },
  cancel: { type: "cancel", requirements: [] }
};

/** Part 5/6. Where a resolved requirement's value came from - never invented, always traceable to a real source. */
export const REQUIREMENT_SOURCES = ["explicit", "recent_catalog_context", "durable_state", "same_turn_intent"] as const;
export type RequirementSource = (typeof REQUIREMENT_SOURCES)[number];

export type ResolvedProductCandidate = { productId: string; combinationId?: string; name: string };

/**
 * Part 4/6. One requirement's resolution for one intent. "ambiguous" carries
 * `candidates` (structured evidence, e.g. 2+ RecentCatalogContext matches) so
 * the finalizer can ask a grounded clarifying question instead of guessing.
 */
export type RequirementResolution =
  | { type: CommercialRequirementType; status: "resolved"; source: RequirementSource; value: unknown }
  | { type: CommercialRequirementType; status: "missing" }
  | { type: CommercialRequirementType; status: "ambiguous"; candidates: ResolvedProductCandidate[] };

export const RESOLVED_INTENT_STATUSES = ["ready", "waiting_for_information", "needs_clarification"] as const;
export type ResolvedIntentStatus = (typeof RESOLVED_INTENT_STATUSES)[number];

/** Part 4. One intent plus its per-requirement resolution and overall readiness. */
export type ResolvedIntent = {
  intentIndex: number;
  intent: CommercialIntent;
  requirements: RequirementResolution[];
  status: ResolvedIntentStatus;
};

/** Part 7/26. Only capabilities that already exist in the Capability Gateway - never a new/duplicated one. */
export const MULTI_INTENT_PLANNED_CAPABILITIES = ["select_products", "set_shipping_destination", "calculate_shipping"] as const;
export type MultiIntentPlannedCapability = (typeof MULTI_INTENT_PLANNED_CAPABILITIES)[number];

/**
 * Part 7/8. One deterministic, backend-ordered execution step. `dependsOnIntentIndex`
 * names the intent (never a raw step index) whose successful execution this
 * step's own execution depends on for its evidence/durable-state precondition -
 * absent when the step has no same-turn dependency (its precondition is
 * already satisfied by durable state).
 */
export type PlannedActionStep = {
  capability: MultiIntentPlannedCapability;
  forIntentIndex: number;
  arguments: Record<string, unknown>;
  dependsOnIntentIndex?: number;
};

export const INTENT_EXECUTION_STATUSES = ["completed", "waiting_for_information", "needs_clarification", "failed", "unsupported"] as const;
export type IntentExecutionStatus = (typeof INTENT_EXECUTION_STATUSES)[number];

/** Part 10/13. One capability's real outcome for one intent - never a claim, always a real ToolObservation from executeGovernedCapability. */
export type IntentExecutionResult = {
  capability: MultiIntentPlannedCapability;
  observation: ToolObservation;
};

/** Part 10. Final, per-intent classification after planning + execution. */
export type IntentOutcome = {
  intentIndex: number;
  intent: CommercialIntent;
  status: IntentExecutionStatus;
  missingRequirements: CommercialRequirementType[];
  ambiguousRequirements: CommercialRequirementType[];
  executionResults: IntentExecutionResult[];
};

/**
 * Part 13. What the finalizer LLM is actually handed - never raw tool
 * observations for it to reconstruct meaning from scratch, never free text
 * summarizing state. Extends the task's own suggested shape with two buckets
 * the task's Part 3/6/17 explicitly require distinguishing: an intent with an
 * AMBIGUOUS requirement (e.g. two RecentCatalogContext product matches) needs
 * a different customer-facing question than one this system does not
 * implement at all - collapsing both into "pending" would make the finalizer
 * unable to tell "ask which of these two" from "ask what you actually mean".
 * `executionResults` is deliberately not duplicated as a separate top-level
 * array - it is already embedded per intent (IntentOutcome.executionResults),
 * traceable to the intent that produced it, never a second copy of the same
 * data.
 */
export type MultiIntentResponseContract = {
  completedIntents: IntentOutcome[];
  pendingIntents: IntentOutcome[];
  failedIntents: IntentOutcome[];
  needsClarificationIntents: IntentOutcome[];
  unsupportedIntents: IntentOutcome[];
  missingRequirements: CommercialRequirementType[];
};

/**
 * Part 11. Durable, versioned pending-intent state - persisted via the
 * existing crm_request_facts fact store (see pendingIntentState.ts), never a
 * new table. Deliberately minimal: only what Part 12's continuation case
 * needs to recognize a later short reply as satisfying a missing requirement.
 */
export type PendingCommercialIntentRecord = {
  intent: CommercialIntent;
  missingRequirements: CommercialRequirementType[];
  savedAt: string;
};
