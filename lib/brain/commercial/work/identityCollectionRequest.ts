import type { CustomerOnboardingPendingField, CustomerOnboardingPurpose, CustomerOnboardingStatus } from "@/lib/domains/customer-onboarding";
import { mapOperationToOnboardingPurpose, requiredOnboardingFieldsForPurpose } from "../native-cycle/customer-session/onboardingPurposeMapping";
import { COMMERCIAL_OBJECTIVE_TYPE_TO_OPERATION } from "./commercialIdentityGate";
import type { CommercialObjective } from "./types";

// SALES-AGENT-R2-ID-R2-A08, PARTE 2. The single conceptual boundary between
// "what CommercialWork/A06 decided is missing" (objective.blockers'
// identityDecision, ID-R2-A06/A07, never re-derived here) and "what to ask
// the customer" (buildCommercialWorkFinalizerMessage's wording). Carries
// semantics only - purpose/fields/consent-kind - never a question string.
// The LLM/wording layer never sees candidate ids, master ids, or raw
// collected values through this type; see release doc PARTE 20.

/**
 * Privacy-safe projection of this turn's CustomerOnboardingState (if any) -
 * the same discipline CustomerSessionOnboardingDecisionView already uses for
 * the planner/LLM (resolveNativeCustomerSession.ts): pendingFields and
 * purpose are enums, never a collected value. This is the ONLY onboarding
 * data deriveIdentityCollectionRequest is allowed to read.
 */
export type OnboardingCollectionSnapshot = {
  status: CustomerOnboardingStatus;
  purpose: CustomerOnboardingPurpose;
  pendingFields: readonly CustomerOnboardingPendingField[];
};

export type IdentityCollectionRequest =
  | { kind: "ASK_FIELDS"; purpose: CustomerOnboardingPurpose | null; fields: readonly CustomerOnboardingPendingField[] }
  | { kind: "ASK_CREATE_CONSENT"; purpose: CustomerOnboardingPurpose | null }
  | { kind: "ASK_LINK_CONSENT" }
  | { kind: "ASK_DISAMBIGUATION" }
  | { kind: "CONFLICT" }
  | { kind: "VERIFICATION_PENDING" }
  | { kind: "NONE" };

const TERMINAL_ONBOARDING_STATUSES: readonly CustomerOnboardingStatus[] = ["completed", "conflict", "temporarily_blocked", "temporarily_unavailable"];

/**
 * PARTE 3/4/10/11/21. Turns this objective's IDENTITY_REQUIREMENT blocker
 * (A06's decision, verbatim) plus this turn's onboarding snapshot (optional)
 * into one semantic request:
 *
 * - ONBOARDING_REQUIRED with fields still pending -> ASK_FIELDS. Prefers
 *   onboarding.pendingFields (already excludes what the customer already
 *   gave - PARTE 21/CIC02/CIC08) over A06's requiredEvidence, which can be
 *   empty on a brand-new conversation (release doc PARTE 1: A04 only
 *   populates it once at least one weak PrestaShop-track evidence row
 *   already exists) or generically verification-shaped rather than
 *   purpose-shaped (e.g. it can suggest order_reference for a "quote" that
 *   never needs it).
 * - ONBOARDING_REQUIRED with onboarding.pendingFields empty (minimum data
 *   collected, resolve/create never attempted without consent - see
 *   runCustomerOnboardingPostPlanStage step 3) -> ASK_CREATE_CONSENT. This
 *   is the conversational trigger PARTE 11 is missing today: without it, a
 *   customer who already gave every required field is never actually asked
 *   to authorize account creation.
 * - No onboarding row yet this turn (activation happens later, in the same
 *   turn's post-plan stage) -> ASK_FIELDS from the purpose's own required
 *   fields (never A06's possibly-empty requiredEvidence).
 * - READY_TO_LINK -> ASK_LINK_CONSENT, no fields (PARTE 10: never re-ask
 *   for information already in hand).
 * - AMBIGUITY_RESOLUTION_REQUIRED -> ASK_DISAMBIGUATION.
 * - IDENTITY_CONFLICT -> CONFLICT (PARTE 9: CommercialWork's own blocker
 *   never carries a conflictCode - see release doc PARTE 9 - so this can
 *   only ever be the safe, generic branch, never a CUSTOMER_RESOLVABLE one).
 * - ENTITY_VERIFICATION_REQUIRED -> VERIFICATION_PENDING (no real
 *   CommercialWork consumer today - A07 doc section 19 - kept exhaustive).
 * - SUFFICIENT/SYSTEM_WAIT never reach here (SYSTEM_WAIT is WAITING_SYSTEM,
 *   never surfaced to buildMissingInfoQuestion/this function's callers).
 */
export function deriveIdentityCollectionRequest(objective: CommercialObjective, onboarding: OnboardingCollectionSnapshot | null): IdentityCollectionRequest {
  const decision = objective.blockers.find((item) => item.code === "IDENTITY_REQUIREMENT")?.identityDecision;
  if (!decision) return { kind: "NONE" };

  if (decision.status === "READY_TO_LINK") return { kind: "ASK_LINK_CONSENT" };
  if (decision.status === "IDENTITY_CONFLICT") return { kind: "CONFLICT" };
  if (decision.status === "ENTITY_VERIFICATION_REQUIRED") return { kind: "VERIFICATION_PENDING" };
  if (decision.status === "AMBIGUITY_RESOLUTION_REQUIRED") return { kind: "ASK_DISAMBIGUATION" };
  if (decision.status !== "ONBOARDING_REQUIRED") return { kind: "NONE" };

  if (onboarding && !TERMINAL_ONBOARDING_STATUSES.includes(onboarding.status)) {
    if (onboarding.pendingFields.length === 0) return { kind: "ASK_CREATE_CONSENT", purpose: onboarding.purpose };
    return { kind: "ASK_FIELDS", purpose: onboarding.purpose, fields: onboarding.pendingFields };
  }

  const operation = COMMERCIAL_OBJECTIVE_TYPE_TO_OPERATION[objective.type];
  const purpose = operation ? mapOperationToOnboardingPurpose(operation) : null;
  if (purpose) return { kind: "ASK_FIELDS", purpose, fields: requiredOnboardingFieldsForPurpose(purpose) };
  return { kind: "NONE" };
}
