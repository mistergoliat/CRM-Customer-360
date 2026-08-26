import type { IdentityLevel, IdentityVerificationEntityType } from "@/lib/domains/customer-identity-verification";
import type { IdentityEvidenceSignalType } from "@/lib/domains/customer-identity-evidence";

// SALES-AGENT-R2-ID-R2-A06. Strict separation (task PRINCIPIO CENTRAL):
//   IDENTITY FACT        -> RuntimeIdentityContext (ID-R2-A05)
//   IDENTITY REQUIREMENT -> CommercialIdentityRequirement/Decision (this module)
//   ONBOARDING ACTION    -> never decided here - a future slice (ID-R2-A07+)
//
// This module is a pure policy: no I/O, no LLM, no mutation, no
// CommercialWork/checkout/provider awareness. See evaluate.ts.

export type CommercialIdentityMinimumLevel = Exclude<IdentityLevel, "LEVEL_0_ANONYMOUS">;

// PARTE 2. LEVEL_4 (order/entity-scoped verification) never becomes a
// standing minimum level - it is always its own requirement kind, evaluated
// fresh per entityRef by a future caller via
// lib/domains/customer-identity-verification#evaluateEntityVerification.
export type CommercialIdentityRequirement =
  | { kind: "NONE" }
  | { kind: "MINIMUM_LEVEL"; level: CommercialIdentityMinimumLevel }
  | { kind: "ENTITY_VERIFICATION"; entityType: IdentityVerificationEntityType };

// PARTE 18. Stable, deterministic codes - never prose, never a substitute
// for `status`, only an explanation of *why*. Superset of the enunciado's
// example list: symmetric SUFFICIENT/REQUIRED pairs were added for
// LEVEL_1/LEVEL_2/LEVEL_3 so every MINIMUM_LEVEL branch has a matching code
// on both sides of the comparison.
export type CommercialIdentityRequirementPolicyCode =
  | "IDENTITY_NOT_REQUIRED"
  | "CHANNEL_IDENTITY_SUFFICIENT"
  | "CHANNEL_IDENTITY_REQUIRED"
  | "MASTER_IDENTITY_SUFFICIENT"
  | "MASTER_IDENTITY_REQUIRED"
  | "PRESTASHOP_IDENTITY_SUFFICIENT"
  | "PRESTASHOP_IDENTITY_REQUIRED"
  | "ENTITY_VERIFICATION_REQUIRED"
  | "IDENTITY_READY_TO_LINK"
  | "IDENTITY_INFORMATION_MISSING"
  | "IDENTITY_AMBIGUOUS"
  | "IDENTITY_CONFLICT"
  | "IDENTITY_SYSTEM_UNAVAILABLE";

type DecisionBase = { policyCode: CommercialIdentityRequirementPolicyCode };

// PARTE 3. Deliberately not the literal sketch from the task: it omits an
// explicit AMBIGUOUS-distinct status, which PARTE 10 asks to evaluate and
// this module adopts (AMBIGUITY_RESOLUTION_REQUIRED) - kept separate from
// both IDENTITY_CONFLICT and ONBOARDING_REQUIRED so a caller never has to
// re-derive "is this a hard conflict, a genuine evidence gap, or same-turn
// ambiguity" from a policyCode alone.
export type CommercialIdentityRequirementDecision =
  | (DecisionBase & { status: "SUFFICIENT"; currentLevel: IdentityLevel; requiredLevel: IdentityLevel | null })
  | (DecisionBase & {
      status: "ONBOARDING_REQUIRED";
      currentLevel: IdentityLevel;
      requiredLevel: IdentityLevel;
      requiredEvidence: readonly IdentityEvidenceSignalType[];
    })
  | (DecisionBase & { status: "ENTITY_VERIFICATION_REQUIRED"; currentLevel: IdentityLevel; entityType: IdentityVerificationEntityType })
  | (DecisionBase & { status: "READY_TO_LINK"; currentLevel: IdentityLevel })
  | (DecisionBase & { status: "AMBIGUITY_RESOLUTION_REQUIRED"; currentLevel: IdentityLevel })
  | (DecisionBase & { status: "IDENTITY_CONFLICT" })
  | (DecisionBase & { status: "SYSTEM_WAIT"; retryable: boolean });
