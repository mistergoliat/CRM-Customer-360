import { resolveCapabilityGovernance } from "@/lib/brain/commercial/capability-gateway";
import type { CommercialWorkStep } from "./types";
import type { CommercialWorkStepType } from "./stepTypes";

/**
 * SALES-AGENT-R2-A09, Part 4/6. A small, typed conflict model - never a
 * generic database-transaction dependency engine (explicitly out of scope,
 * Part 6). Two facts:
 *
 * 1. Capability safety classification is never hand-maintained here - it
 *    reads the real Capability Gateway registry's own governance metadata
 *    (resolveCapabilityGovernance) so this file can never drift from what
 *    the gateway itself considers read-only vs mutating (Part 4).
 * 2. Fact read/write sets are hand-typed per CommercialWorkStepType (Part 6) -
 *    exhaustive by construction (a Record over the full step-type union), so
 *    adding a new step type without updating this table is a compile error,
 *    never a silent runtime "unknown conflict" gap.
 */

export type CommercialFactAnchor = "commercial_line_items" | "shipping_destination" | "selected_shipping_option" | "created_quote";

export type StepFactProfile = {
  reads: readonly CommercialFactAnchor[];
  writes: readonly CommercialFactAnchor[];
};

/**
 * Part 4. calculate_shipping is governance-tagged read_only in the real
 * registry (a Carrier MS price lookup) - it reads commercial_line_items and
 * shipping_destination but writes no commercial fact anchor of its own
 * (its CommercialWork step evidence is internal bookkeeping, never a
 * durable business fact another step could read - Part 4's explicit
 * "distinguish external side effect from internal evidence persistence").
 * search_products/get_product_details/recommend_catalog_products touch no
 * fact anchor at all - a discovery/comparison result is never written back
 * into a fact a later step depends on.
 */
export const STEP_FACT_PROFILE: Record<CommercialWorkStepType, StepFactProfile> = {
  SEARCH_PRODUCTS: { reads: [], writes: [] },
  GET_PRODUCT_DETAILS: { reads: [], writes: [] },
  RECOMMEND_PRODUCTS: { reads: [], writes: [] },
  SELECT_PRODUCTS: { reads: [], writes: ["commercial_line_items"] },
  SET_SHIPPING_DESTINATION: { reads: [], writes: ["shipping_destination"] },
  CALCULATE_SHIPPING: { reads: ["commercial_line_items", "shipping_destination"], writes: [] },
  SELECT_SHIPPING_OPTION: { reads: ["commercial_line_items", "shipping_destination"], writes: ["selected_shipping_option"] },
  CREATE_QUOTE: { reads: ["commercial_line_items", "shipping_destination", "selected_shipping_option"], writes: ["created_quote"] },
  HANDOFF: { reads: [], writes: [] },
  // SALES-AGENT-R2-ID-R2-A11. Read-only Customer Profile lookup, touches no
  // commercial fact anchor - same profile as SEARCH_PRODUCTS/GET_PRODUCT_DETAILS.
  LOAD_PURCHASE_HISTORY: { reads: [], writes: [] },
  // SALES-AGENT-R2-ID-R2-A12. Same profile as LOAD_PURCHASE_HISTORY - a
  // read-only Customer Profile lookup, touches no commercial fact anchor.
  LOAD_RECOMMENDATION_SIGNAL: { reads: [], writes: [] }
};

export type StepSafetyClassification = "read_only" | "mutating" | "unknown_governance";

/**
 * Part 3/4/5. Fail-closed, and Part 3 explicitly requires distinguishing
 * "the registry does not know this capability" from "the registry knows it
 * and it mutates" - both are excluded from parallel eligibility, but only
 * for the reason that is actually true, so buildSafeExecutionWave's own
 * deferral reasons stay honest instead of collapsing every non-read-only
 * step into one label. A step with no capabilityName (e.g. HANDOFF) has
 * nothing a governance registry could classify - "unknown_governance".
 */
export function classifyStepSafety(step: CommercialWorkStep): StepSafetyClassification {
  if (!step.capabilityName) return "unknown_governance";
  const governance = resolveCapabilityGovernance(step.capabilityName);
  if (!governance) return "unknown_governance";
  return governance.sideEffect === "read_only" ? "read_only" : "mutating";
}

/**
 * Part 5's only admission gate for a multi-step wave: explicitly read_only.
 * Unknown governance and explicit mutating are both excluded - see
 * classifyStepSafety for why they are kept distinguishable upstream.
 */
export function isReadOnlyStep(step: CommercialWorkStep): boolean {
  return classifyStepSafety(step) === "read_only";
}

/**
 * Part 7. Two steps cannot share a wave if: one writes what the other reads,
 * one writes what the other writes, or they both belong to the same
 * CommercialObjective (a defensive same-objective guard - two steps for one
 * objective are never expected to be independent, even if their nominal fact
 * profiles do not overlap). Read/read is always safe. This function is only
 * ever consulted for a pair that already both passed isReadOnlyStep (Part
 * 5's gate happens first) - it does not re-derive mutating-vs-read-only
 * itself.
 */
export function stepsConflict(a: CommercialWorkStep, b: CommercialWorkStep): boolean {
  if (a.objectiveIds.some((id) => b.objectiveIds.includes(id))) return true;
  const profileA = STEP_FACT_PROFILE[a.type];
  const profileB = STEP_FACT_PROFILE[b.type];
  const overlaps = (left: readonly CommercialFactAnchor[], right: readonly CommercialFactAnchor[]) => left.some((item) => right.includes(item));
  return overlaps(profileA.writes, profileB.writes) || overlaps(profileA.writes, profileB.reads) || overlaps(profileB.writes, profileA.reads);
}
