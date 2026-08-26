import { normalizeWaId } from "@/lib/customer-identity/normalize";
import { evaluateIdentityVerification } from "@/lib/domains/customer-identity-verification";
import type { IdentityLevel, IdentityVerificationDecision } from "@/lib/domains/customer-identity-verification";
import type { IdentityEvidenceSignalType } from "@/lib/domains/customer-identity-evidence";
import type { IdentityResolutionDetail } from "@/lib/domains/customer-identity";

// SALES-AGENT-R2-ID-R2-A05. RuntimeIdentityContext describes an IDENTITY
// FACT only ("what do we know about identity right now") - never a business
// requirement ("what must the agent do about it"). That decision belongs to
// a future Identity Requirement Policy (A06). This module never reads
// checkout/quote/handoff state, never imports catalog/shipping code, and
// never decides onboarding.

export type RuntimeIdentityStatus =
  | "ANONYMOUS"
  | "CHANNEL_OBSERVED"
  | "MASTER_RESOLVED"
  | "PRESTASHOP_LINKED"
  | "NEEDS_VERIFICATION"
  | "READY_TO_LINK"
  | "AMBIGUOUS"
  | "CONFLICT"
  | "SYSTEM_UNAVAILABLE";

// Reuses A04's IdentityLevel vocabulary directly - never a redefined,
// drifting copy of the same four levels.
export type RuntimeIdentityLevel = IdentityLevel;

export type RuntimeIdentityContext = {
  status: RuntimeIdentityStatus;
  identityLevel: RuntimeIdentityLevel;
  masterCustomerId: string | null;
  prestashopCustomerId: string | null;
  verificationRequired: boolean;
  requiredEvidence: readonly IdentityEvidenceSignalType[];
  readyToLink: boolean;
  conflictCode: string | null;
  policyCode: string;
  // Opaque evidence row ids only - never raw email/phone/wa_id/order values
  // (A04's IdentityVerificationDecision.evidenceIds already carries the same
  // guarantee; this type never widens it).
  evidenceRefs: readonly string[];
};

function mapNotLinkedLevelToStatus(level: IdentityLevel): RuntimeIdentityStatus {
  if (level === "LEVEL_0_ANONYMOUS") return "ANONYMOUS";
  if (level === "LEVEL_1_CHANNEL_OBSERVED") return "CHANNEL_OBSERVED";
  // LEVEL_2_MASTER_RESOLVED and the defensive LEVEL_3 case below (which
  // decideWithLiveLevel3Check's fail-closed downgrade never actually
  // produces at LEVEL_3 - it always forces currentLevel back to LEVEL_2)
  // both mean "a master is resolved, no confirmed PrestaShop progress".
  return "MASTER_RESOLVED";
}

/**
 * PARTE 3. Pure mapping, no I/O - deterministic per A04 decision, never
 * reinterpreting A04's own branches (PARTE 3: "No reinterpretar A04").
 */
export function mapIdentityVerificationDecisionToRuntimeIdentityContext(decision: IdentityVerificationDecision): RuntimeIdentityContext {
  if (decision.status === "SYSTEM_FAILURE") {
    // PARTE 12. "No pude verificar" != "no existe identidad" - identityLevel
    // is a non-authoritative floor value here; every consumer must gate on
    // `status` before ever reading identityLevel/masterCustomerId.
    return {
      status: "SYSTEM_UNAVAILABLE",
      identityLevel: "LEVEL_0_ANONYMOUS",
      masterCustomerId: null,
      prestashopCustomerId: null,
      verificationRequired: false,
      requiredEvidence: [],
      readyToLink: false,
      conflictCode: null,
      policyCode: decision.policyCode,
      evidenceRefs: []
    };
  }

  if (decision.status === "VERIFIED") {
    return {
      status: decision.identityLevel === "LEVEL_3_PRESTASHOP_LINKED" ? "PRESTASHOP_LINKED" : "MASTER_RESOLVED",
      identityLevel: decision.identityLevel,
      masterCustomerId: decision.masterCustomerId,
      prestashopCustomerId: decision.prestashopCustomerId,
      verificationRequired: false,
      requiredEvidence: [],
      readyToLink: false,
      conflictCode: null,
      policyCode: decision.policyCode,
      evidenceRefs: decision.evidenceIds
    };
  }

  if (decision.status === "READY_TO_LINK") {
    // PARTE 3 example: identityLevel stays LEVEL_2 - READY_TO_LINK is never LEVEL_3.
    return {
      status: "READY_TO_LINK",
      identityLevel: "LEVEL_2_MASTER_RESOLVED",
      masterCustomerId: decision.masterCustomerId,
      prestashopCustomerId: decision.prestashopCustomerId,
      verificationRequired: false,
      requiredEvidence: [],
      readyToLink: true,
      conflictCode: null,
      policyCode: decision.policyCode,
      evidenceRefs: decision.evidenceIds
    };
  }

  if (decision.status === "NEEDS_VERIFICATION") {
    return {
      status: "NEEDS_VERIFICATION",
      identityLevel: decision.currentLevel,
      masterCustomerId: decision.masterCustomerId,
      prestashopCustomerId: null,
      verificationRequired: true,
      requiredEvidence: decision.requiredEvidence,
      readyToLink: false,
      conflictCode: null,
      policyCode: decision.policyCode,
      evidenceRefs: decision.evidenceIds
    };
  }

  if (decision.status === "AMBIGUOUS") {
    return {
      status: "AMBIGUOUS",
      identityLevel: decision.currentLevel,
      masterCustomerId: decision.masterCustomerId,
      prestashopCustomerId: null,
      verificationRequired: false,
      requiredEvidence: [],
      readyToLink: false,
      conflictCode: null,
      policyCode: decision.policyCode,
      evidenceRefs: decision.evidenceIds
    };
  }

  if (decision.status === "IDENTITY_CONFLICT") {
    return {
      status: "CONFLICT",
      identityLevel: decision.currentLevel,
      // Never a side of the conflict - same discipline as A04 itself.
      masterCustomerId: null,
      prestashopCustomerId: null,
      verificationRequired: false,
      requiredEvidence: [],
      readyToLink: false,
      conflictCode: decision.conflictCode,
      policyCode: decision.policyCode,
      evidenceRefs: decision.evidenceIds
    };
  }

  // NOT_LINKED
  return {
    status: mapNotLinkedLevelToStatus(decision.currentLevel),
    identityLevel: decision.currentLevel,
    masterCustomerId: decision.masterCustomerId,
    prestashopCustomerId: null,
    verificationRequired: false,
    requiredEvidence: [],
    readyToLink: false,
    conflictCode: null,
    policyCode: decision.policyCode,
    evidenceRefs: decision.evidenceIds
  };
}

export type EvaluateIdentityVerificationFn = typeof evaluateIdentityVerification;

/**
 * PARTE 4/5/6. Call once per turn, immediately after the same turn's
 * durable evidence has already been persisted (see
 * resolveNativeCustomerSession.ts - this must run after
 * recordTurnIdentityEvidence, never before, or verification would see the
 * PREVIOUS turn's evidence). `detail` is ID-R2-A02's fresh
 * IdentityResolutionDetail from the SAME resolveIdentity() call this turn -
 * its AMBIGUOUS/SYSTEM_FAILURE outcome cannot be reconstructed from durable
 * evidence alone (A04 PARTE 13), so it is forwarded as `freshStatus`.
 *
 * Fails closed to SYSTEM_UNAVAILABLE on any unexpected error - A04's own
 * evaluateIdentityVerification already converts every DB failure it knows
 * about into a SYSTEM_FAILURE decision (never throws), but this call site
 * follows the same defensive discipline as every other fail-closed boundary
 * in this module rather than trusting that invariant silently.
 */
export async function resolveRuntimeIdentityContext(params: {
  conversationId: string;
  externalId: string;
  detail: IdentityResolutionDetail | undefined;
  dependencies?: { evaluateIdentityVerification?: EvaluateIdentityVerificationFn };
}): Promise<RuntimeIdentityContext> {
  const evaluate = params.dependencies?.evaluateIdentityVerification ?? evaluateIdentityVerification;
  const freshStatus = params.detail?.status === "AMBIGUOUS" || params.detail?.status === "SYSTEM_FAILURE" ? params.detail.status : null;
  const normalizedExternalId = normalizeWaId(params.externalId) ?? params.externalId;

  try {
    const decision = await evaluate({ conversationId: params.conversationId, provider: "whatsapp", externalId: normalizedExternalId }, { freshStatus });
    return mapIdentityVerificationDecisionToRuntimeIdentityContext(decision);
  } catch {
    return mapIdentityVerificationDecisionToRuntimeIdentityContext({
      status: "SYSTEM_FAILURE",
      retryable: true,
      policyCode: "EVIDENCE_REPOSITORY_FAILURE"
    });
  }
}
