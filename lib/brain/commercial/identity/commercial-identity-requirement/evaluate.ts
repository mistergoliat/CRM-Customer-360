import type { IdentityLevel } from "@/lib/domains/customer-identity-verification";
import type { RuntimeIdentityContext } from "../../native-cycle/customer-session/runtimeIdentityContext";
import type { CommercialIdentityMinimumLevel, CommercialIdentityRequirement, CommercialIdentityRequirementDecision } from "./types";

// SALES-AGENT-R2-ID-R2-A06. Pure policy, no I/O, no LLM, no mutation, no
// checkout/provider/channel awareness (PARTE 6/15/16/20/21/22/23) - the only
// inputs are a requirement (operations.ts) and this turn's already-computed
// RuntimeIdentityContext (ID-R2-A05). Deterministic: same inputs always
// produce the identical decision (CIR24).

// PARTE 13. Explicit numeric ordering - never a lexicographic string
// comparison. LEVEL_4 (order/entity verification) is not a value of
// IdentityLevel at all (A04 design) and therefore structurally cannot appear
// here (CIR17).
const IDENTITY_LEVEL_ORDER: Record<IdentityLevel, number> = {
  LEVEL_0_ANONYMOUS: 0,
  LEVEL_1_CHANNEL_OBSERVED: 1,
  LEVEL_2_MASTER_RESOLVED: 2,
  LEVEL_3_PRESTASHOP_LINKED: 3
};

export function isIdentityLevelAtLeast(current: IdentityLevel, required: IdentityLevel): boolean {
  return IDENTITY_LEVEL_ORDER[current] >= IDENTITY_LEVEL_ORDER[required];
}

/** CIR17: runtime-checkable proof that only the four real IdentityLevel values exist here - LEVEL_4 (entity-scoped) is structurally absent. */
export const IDENTITY_LEVELS_IN_COMPARISON_ORDER = Object.keys(IDENTITY_LEVEL_ORDER) as IdentityLevel[];

const POLICY_CODE_FOR_MINIMUM_LEVEL: Record<CommercialIdentityMinimumLevel, { sufficient: "CHANNEL_IDENTITY_SUFFICIENT" | "MASTER_IDENTITY_SUFFICIENT" | "PRESTASHOP_IDENTITY_SUFFICIENT"; required: "CHANNEL_IDENTITY_REQUIRED" | "MASTER_IDENTITY_REQUIRED" | "PRESTASHOP_IDENTITY_REQUIRED" }> = {
  LEVEL_1_CHANNEL_OBSERVED: { sufficient: "CHANNEL_IDENTITY_SUFFICIENT", required: "CHANNEL_IDENTITY_REQUIRED" },
  LEVEL_2_MASTER_RESOLVED: { sufficient: "MASTER_IDENTITY_SUFFICIENT", required: "MASTER_IDENTITY_REQUIRED" },
  LEVEL_3_PRESTASHOP_LINKED: { sufficient: "PRESTASHOP_IDENTITY_SUFFICIENT", required: "PRESTASHOP_IDENTITY_REQUIRED" }
};

/**
 * SALES-AGENT-R2-ID-R2-A06 main entry point. PARTE 4 precedence, checked in
 * order - never let a weaker rule skip CONFLICT/SYSTEM_UNAVAILABLE:
 *
 *   1. operation requires identity AND runtimeIdentity.status === CONFLICT
 *      -> IDENTITY_CONFLICT
 *   2. operation requires identity AND runtimeIdentity.status === SYSTEM_UNAVAILABLE
 *      -> SYSTEM_WAIT
 *   3. requirement.kind === NONE -> SUFFICIENT (identity was never at stake)
 *   4. requirement.kind === ENTITY_VERIFICATION -> ENTITY_VERIFICATION_REQUIRED
 *      (LEVEL_4 is never a standing level - always re-evaluated fresh with a
 *      real entityRef by a future caller, never decided here)
 *   5. currentLevel >= requiredLevel -> SUFFICIENT
 *   6. requiredLevel === LEVEL_3 AND runtimeIdentity.status === READY_TO_LINK
 *      -> READY_TO_LINK (evidence already sufficient, only the canonical
 *      link mutation is missing - never conflated with a genuine information gap)
 *   7. runtimeIdentity.status === AMBIGUOUS -> AMBIGUITY_RESOLUTION_REQUIRED
 *      (never silently treated as either CONFLICT or a plain evidence gap)
 *   8. otherwise -> ONBOARDING_REQUIRED, requiredEvidence propagated as-is
 *      from RuntimeIdentityContext (never redacted, never redefined here)
 */
export function decideCommercialIdentityRequirement(
  requirement: CommercialIdentityRequirement,
  runtimeIdentity: RuntimeIdentityContext
): CommercialIdentityRequirementDecision {
  const currentLevel = runtimeIdentity.identityLevel;
  const requiresIdentity = requirement.kind !== "NONE";

  if (requiresIdentity && runtimeIdentity.status === "CONFLICT") {
    return { status: "IDENTITY_CONFLICT", policyCode: "IDENTITY_CONFLICT" };
  }
  if (requiresIdentity && runtimeIdentity.status === "SYSTEM_UNAVAILABLE") {
    return { status: "SYSTEM_WAIT", retryable: true, policyCode: "IDENTITY_SYSTEM_UNAVAILABLE" };
  }

  if (requirement.kind === "NONE") {
    return { status: "SUFFICIENT", currentLevel, requiredLevel: null, policyCode: "IDENTITY_NOT_REQUIRED" };
  }

  if (requirement.kind === "ENTITY_VERIFICATION") {
    return { status: "ENTITY_VERIFICATION_REQUIRED", currentLevel, entityType: requirement.entityType, policyCode: "ENTITY_VERIFICATION_REQUIRED" };
  }

  const requiredLevel = requirement.level;
  const codes = POLICY_CODE_FOR_MINIMUM_LEVEL[requiredLevel];

  if (isIdentityLevelAtLeast(currentLevel, requiredLevel)) {
    return { status: "SUFFICIENT", currentLevel, requiredLevel, policyCode: codes.sufficient };
  }

  if (requiredLevel === "LEVEL_3_PRESTASHOP_LINKED" && runtimeIdentity.status === "READY_TO_LINK") {
    return { status: "READY_TO_LINK", currentLevel, policyCode: "IDENTITY_READY_TO_LINK" };
  }

  if (runtimeIdentity.status === "AMBIGUOUS") {
    return { status: "AMBIGUITY_RESOLUTION_REQUIRED", currentLevel, policyCode: "IDENTITY_AMBIGUOUS" };
  }

  return {
    status: "ONBOARDING_REQUIRED",
    currentLevel,
    requiredLevel,
    requiredEvidence: runtimeIdentity.requiredEvidence,
    policyCode: runtimeIdentity.status === "NEEDS_VERIFICATION" ? "IDENTITY_INFORMATION_MISSING" : codes.required
  };
}
