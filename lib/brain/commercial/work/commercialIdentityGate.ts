import { evaluateCommercialIdentityRequirement } from "../identity/commercial-identity-requirement";
import type { CommercialOperation } from "../identity/commercial-identity-requirement";
import type { RuntimeIdentityContext } from "../native-cycle/customer-session/runtimeIdentityContext";
import type { CommercialObjectiveType } from "./objectiveTypes";
import type { CommercialObjectiveStatus } from "./statuses";
import type { CommercialMissingRequirement, CommercialObjective } from "./types";

// SALES-AGENT-R2-ID-R2-A07. PARTE 1/2: the single, explicit translation from
// CommercialWork's own vocabulary (objective type) to A06's CommercialOperation
// vocabulary - the mapping only translates names, it never redefines a
// requirement value (that stays exclusively in
// lib/brain/commercial/identity/commercial-identity-requirement/operations.ts).
//
// Gated at the OBJECTIVE level (not inside a capability, not inside the
// executor) so an identity-sensitive operation never reaches
// commercialWorkExecutor.ts's READY-step selection in the first place -
// exactly the "step projection / readiness derivation" placement PARTE 1
// asks for. deriveCommercialWorkSteps.ts already copies a BLOCKED/
// WAITING_CUSTOMER/WAITING_SYSTEM objective's status/blockers onto its
// step(s) unchanged, so no second gate is needed there.
//
// COMPARE_PRODUCTS and RECOMMEND_PRODUCTS share one step/capability
// (recommend_catalog_products) in deriveCommercialWorkSteps.ts, so they share
// one operation here too. CHANGE_QUANTITY shares SELECT_PRODUCTS's step/
// capability the same way. WAIT_FOR_QUOTE_APPROVAL has no
// deriveCommercialWorkSteps.ts case at all (no capability exists for it) and
// is deliberately left unmapped - gating an operation that cannot execute
// would not be "no colapsar", it would be meaningless.
export const COMMERCIAL_OBJECTIVE_TYPE_TO_OPERATION: Partial<Record<CommercialObjectiveType, CommercialOperation>> = {
  DISCOVER_PRODUCTS: "search_products",
  COMPARE_PRODUCTS: "recommend_catalog_products",
  RECOMMEND_PRODUCTS: "recommend_catalog_products",
  SELECT_PRODUCTS: "select_products",
  CHANGE_QUANTITY: "select_products",
  SET_DESTINATION: "set_shipping_destination",
  GET_SHIPPING_QUOTE: "calculate_shipping",
  SELECT_SHIPPING_OPTION: "select_shipping_option",
  CREATE_QUOTE: "create_quote",
  // SALES-AGENT-R2-ID-R2-A11. The first real CommercialWork objective to
  // reach A06's LEVEL_3 (customer_profile_history) requirement - see
  // ID-R2-A09/A10's own release docs, which named this exact gap. Below
  // LEVEL_3, a READY REPEAT_PURCHASE objective is gated exactly like any
  // other objective here: never a second, hand-rolled identity check inside
  // applyObjectiveState's REPEAT_PURCHASE case.
  REPEAT_PURCHASE: "customer_profile_history",
  // PARTE 7: mapped for completeness/testability, but structurally never
  // gated in practice - applyObjectiveState's own HANDOFF case sets
  // objective.status = "COMPLETED" unconditionally, so this gate (which only
  // ever intervenes on a READY objective) never runs against it. That is the
  // correct behavior, not a gap: assisted_sale_handoff must never require
  // onboarding just because checkout does not exist yet.
  HANDOFF: "assisted_sale_handoff"
};

// PARTE 3/4/16/17. Maps each non-SUFFICIENT CommercialIdentityRequirementDecision
// status onto the existing CommercialWork status/missingRequirement
// vocabulary - never a new status literal (statuses.ts/transitions.ts stay
// untouched, so does the DB CHECK constraint - see A07 release doc).
//
// ONBOARDING_REQUIRED/AMBIGUITY_RESOLUTION_REQUIRED are customer-owned (the
// customer must supply evidence or disambiguate) -> WAITING_CUSTOMER, the
// same status every other "needs a customer answer" gap in this file already
// uses (reuses the existing follow-up scheduling + finalizer wiring for free).
// READY_TO_LINK/IDENTITY_CONFLICT/ENTITY_VERIFICATION_REQUIRED are not
// customer-answerable by a plain message (a link mutation, a human
// conflict resolution, and a verification the mechanism has no consumer for
// yet, respectively) -> BLOCKED. SYSTEM_WAIT is system-owned (PARTE 16) ->
// WAITING_SYSTEM, never WAITING_CUSTOMER.
// Exported (like A06's own IDENTITY_LEVELS_IN_COMPARISON_ORDER) purely so a
// test can prove this mapping distinguishes every decision status even
// though, today, only ONBOARDING_REQUIRED/AMBIGUITY_RESOLUTION_REQUIRED/
// IDENTITY_CONFLICT/SYSTEM_WAIT are reachable through a REAL CommercialWork
// objective (create_quote's LEVEL_2 requirement never produces READY_TO_LINK,
// which A06 only ever emits for a LEVEL_3 requirement - see evaluate.ts step
// 6 - and no CommercialWork objective type maps to a LEVEL_3/ENTITY_VERIFICATION
// operation yet, section 1 of the A06 doc: customer_profile_history and
// order_status_entity_verification are Agent Tool Loop-only today). Both
// branches are still correct-by-construction (the exhaustive Record type
// below fails to compile if a future A06 status is left unhandled) and ready
// for the day a LEVEL_3/entity-verification CommercialWork objective exists.
export const IDENTITY_DECISION_STATUS_TO_OBJECTIVE_STATUS: Record<Exclude<ReturnType<typeof evaluateCommercialIdentityRequirement>["status"], "SUFFICIENT">, CommercialObjectiveStatus> = {
  ONBOARDING_REQUIRED: "WAITING_CUSTOMER",
  AMBIGUITY_RESOLUTION_REQUIRED: "WAITING_CUSTOMER",
  READY_TO_LINK: "BLOCKED",
  IDENTITY_CONFLICT: "BLOCKED",
  ENTITY_VERIFICATION_REQUIRED: "BLOCKED",
  SYSTEM_WAIT: "WAITING_SYSTEM"
};

export const IDENTITY_DECISION_STATUS_TO_MISSING_REQUIREMENT: Partial<Record<string, CommercialMissingRequirement>> = {
  ONBOARDING_REQUIRED: "IDENTITY_EVIDENCE",
  AMBIGUITY_RESOLUTION_REQUIRED: "IDENTITY_AMBIGUOUS",
  READY_TO_LINK: "IDENTITY_LINK_PENDING",
  IDENTITY_CONFLICT: "IDENTITY_CONFLICT",
  ENTITY_VERIFICATION_REQUIRED: "IDENTITY_VERIFICATION"
  // SYSTEM_WAIT intentionally absent - see the CommercialMissingRequirement comment in types.ts.
};

/**
 * PARTE 1/4/5. Runs once, after applyObjectiveState's per-type switch has
 * already decided each objective's structural readiness - only ever
 * intervenes on an objective that is currently READY (every other status -
 * COMPLETED/CANCELLED/SUPERSEDED/already WAITING_CUSTOMER/BLOCKED/FAILED for
 * an unrelated reason - is left completely untouched, so an operation that
 * was never going to run this turn anyway is never re-labeled as identity-
 * blocked). Without a runtimeIdentity (PARTE 5: no existing caller ever
 * supplied one before A07) this is a no-op for every objective, byte-for-byte
 * preserving current behavior.
 */
export function applyCommercialIdentityGate(objectives: readonly CommercialObjective[], runtimeIdentity: RuntimeIdentityContext | undefined): void {
  if (!runtimeIdentity) return;

  for (const objective of objectives) {
    if (objective.status !== "READY") continue;
    const operation = COMMERCIAL_OBJECTIVE_TYPE_TO_OPERATION[objective.type];
    if (!operation) continue;

    const decision = evaluateCommercialIdentityRequirement(operation, runtimeIdentity);
    if (decision.status === "SUFFICIENT") continue;

    objective.status = IDENTITY_DECISION_STATUS_TO_OBJECTIVE_STATUS[decision.status];
    const missingRequirement = IDENTITY_DECISION_STATUS_TO_MISSING_REQUIREMENT[decision.status];
    if (missingRequirement) objective.missingRequirements.push(missingRequirement);
    objective.blockers.push({ code: "IDENTITY_REQUIREMENT", source: "objective", objectiveId: objective.objectiveId, identityDecision: decision });
  }
}
