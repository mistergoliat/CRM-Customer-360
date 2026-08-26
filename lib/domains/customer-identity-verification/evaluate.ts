import type { IdentityEvidenceRecord, IdentityEvidenceSignalType } from "@/lib/domains/customer-identity-evidence";
import type { IdentityLevel, IdentityVerificationDecision, IdentityVerificationInputs, IdentityVerificationPolicyCode } from "./types";

// SALES-AGENT-R2-ID-R2-A04, PARTE 2. Deterministic rules only - no
// aggregate confidence score anywhere in this file. Every branch below
// exists because a specific PARTE of the task spec asked for it; see the
// inline references.

// PARTE 19. A02's CustomerIdentityConflictType vocabulary (lib/domains/customer-identity/types.ts)
// mapped to A04's stable policy codes - never re-derived from prose.
const CONFLICT_CODE_TO_POLICY_CODE: Record<string, IdentityVerificationPolicyCode> = {
  external_identity_vs_phone: "CHANNEL_MASTER_CONFLICT",
  phone_ambiguous: "CHANNEL_MASTER_CONFLICT",
  prestashop_link_vs_wa_phone: "PRESTASHOP_MASTER_CONFLICT",
  prestashop_id_multi_master: "PRESTASHOP_MASTER_CONFLICT",
  email_vs_order_prestashop_id: "EMAIL_ORDER_CONFLICT"
};

export function mapConflictCodeToPolicyCode(conflictCode: string | null): IdentityVerificationPolicyCode {
  if (!conflictCode) return "IDENTITY_EVIDENCE_CONFLICT";
  return CONFLICT_CODE_TO_POLICY_CODE[conflictCode] ?? "IDENTITY_EVIDENCE_CONFLICT";
}

// PrestaShop-track signal types (PARTE 8/9) - the only ones that can ever
// produce NEEDS_VERIFICATION/READY_TO_LINK/LEVEL_3. wa_id/phone/manual_verification
// are channel-identity signals, evaluated separately (computeBaseLevel).
const PRESTASHOP_TRACK_SIGNALS: readonly IdentityEvidenceSignalType[] = ["email", "order_reference", "prestashop_customer_id"];

type BaseLevelResult = {
  level: IdentityLevel;
  masterCustomerId: string | null;
  evidenceIds: string[];
  policyCode: IdentityVerificationPolicyCode;
};

/**
 * PARTE 4/5. LEVEL_0 vs LEVEL_1 vs LEVEL_2, from the canonical channel link
 * (customer_external_identity, live) plus wa_id/phone-class durable
 * evidence. Never considers email/order/prestashop_customer_id evidence -
 * PARTE 5 is explicit that email alone never resolves LEVEL_2.
 */
function computeBaseLevel(inputs: IdentityVerificationInputs, usable: IdentityEvidenceRecord[]): BaseLevelResult {
  const channelIdentity = inputs.currentChannelIdentity;

  // Case A (PARTE 5): the current turn's wa_id is already canonically
  // linked - the strongest, cheapest signal, checked first.
  if (channelIdentity?.customerId) {
    const backing = usable.find(
      (row) => row.signalType === "wa_id" && row.masterCustomerId === channelIdentity.customerId
    );
    return {
      level: "LEVEL_2_MASTER_RESOLVED",
      masterCustomerId: channelIdentity.customerId,
      evidenceIds: backing ? [backing.evidenceId] : [],
      policyCode: "EXISTING_CHANNEL_LINK"
    };
  }

  // Case B (PARTE 5): phone evidence converged on a master via cross-provider
  // lookup, even though the CURRENT wa_id itself has no canonical link yet -
  // this is exactly what the resolver already calls "identified" (matchedBy
  // "phone", ID-R2-A02), so the policy trusts it the same way.
  const phoneMatch = usable.find((row) => row.signalType === "phone" && row.masterCustomerId);
  if (phoneMatch?.masterCustomerId) {
    return {
      level: "LEVEL_2_MASTER_RESOLVED",
      masterCustomerId: phoneMatch.masterCustomerId,
      evidenceIds: [phoneMatch.evidenceId],
      policyCode: "PHONE_EVIDENCE_MASTER_CONVERGED"
    };
  }

  // Case C (PARTE 5): a customer_service-sourced VERIFIED entry (projection
  // gate already confirmed master_customer locally). Not produced by any
  // caller today (ID-R2-A03's hooks only feed ID-R2-A02's local evidence) -
  // kept so the policy is provider/source-aware from day one rather than
  // hardcoding "only customer_external_identity counts" (PARTE 18).
  const customerServiceMatch = usable.find(
    (row) => row.source === "customer_service" && row.status === "VERIFIED" && row.masterCustomerId
  );
  if (customerServiceMatch?.masterCustomerId) {
    return {
      level: "LEVEL_2_MASTER_RESOLVED",
      masterCustomerId: customerServiceMatch.masterCustomerId,
      evidenceIds: [customerServiceMatch.evidenceId],
      policyCode: "MASTER_FROM_CUSTOMER_SERVICE"
    };
  }

  if (channelIdentity !== null) {
    // A customer_external_identity row exists (customer_id null) - channel
    // seen before, never linked (PARTE 4).
    return { level: "LEVEL_1_CHANNEL_OBSERVED", masterCustomerId: null, evidenceIds: [], policyCode: "CHANNEL_OBSERVED_UNLINKED" };
  }

  return { level: "LEVEL_0_ANONYMOUS", masterCustomerId: null, evidenceIds: [], policyCode: "NO_CHANNEL_EVIDENCE" };
}

/**
 * PARTE 8/14. Suggests which signal type would most usefully close the gap
 * - never a generic "give us more info", always the specific counterpart
 * signal a real onboarding question could ask for.
 */
function computeRequiredEvidence(usable: IdentityEvidenceRecord[]): IdentityEvidenceSignalType[] {
  const hasEmail = usable.some((row) => row.signalType === "email");
  const hasOrder = usable.some((row) => row.signalType === "order_reference");
  const required: IdentityEvidenceSignalType[] = [];
  if (!hasOrder) required.push("order_reference");
  if (!hasEmail) required.push("email");
  return required;
}

/**
 * SALES-AGENT-R2-ID-R2-A04 main entry point (pure half). Given already-loaded
 * inputs, returns the deterministic verification decision. No I/O - see
 * service.ts for the DB-backed wrapper that loads IdentityVerificationInputs
 * and calls this.
 */
export function decideIdentityVerification(inputs: IdentityVerificationInputs): IdentityVerificationDecision {
  const nonStale = inputs.evidence.filter((row) => row.status !== "STALE"); // PARTE 11
  const conflicted = nonStale.filter((row) => row.status === "CONFLICTED");
  const usable = nonStale.filter((row) => row.status !== "CONFLICTED"); // PARTE 11: conflicted evidence never elevates

  const base = computeBaseLevel(inputs, usable);

  // PARTE 12/23. Conflict has precedence over every convergent/candidate
  // signal, no matter how many weak signals agree - checked before any
  // fresh-turn override and before the PrestaShop-track evaluation below.
  if (conflicted.length > 0) {
    const primary = conflicted[0];
    return {
      status: "IDENTITY_CONFLICT",
      currentLevel: base.level,
      // Never a side of the conflict, even if the base wa_id/phone lookup
      // alone resolved a master - same discipline as ID-R2-A02's own
      // top-level result (evidence.ts: conflict always clears customerId).
      masterCustomerId: null,
      conflictCode: primary.conflictCode,
      evidenceIds: conflicted.map((row) => row.evidenceId),
      policyCode: mapConflictCodeToPolicyCode(primary.conflictCode)
    };
  }

  // PARTE 13. Same-turn signals durable evidence cannot reconstruct.
  if (inputs.freshStatus === "SYSTEM_FAILURE") {
    return { status: "SYSTEM_FAILURE", retryable: true, policyCode: "FRESH_RESOLUTION_SYSTEM_FAILURE" };
  }
  if (inputs.freshStatus === "AMBIGUOUS") {
    return {
      status: "AMBIGUOUS",
      currentLevel: base.level,
      masterCustomerId: base.masterCustomerId,
      evidenceIds: base.evidenceIds,
      policyCode: "AMBIGUOUS_PRESTASHOP_ACCOUNT"
    };
  }

  const prestashopTrack = usable.filter((row) => PRESTASHOP_TRACK_SIGNALS.includes(row.signalType));

  // PARTE 6. LEVEL_3 requires the CANONICAL bridge link - the evidence row
  // ID-R2-A02 only ever writes when findCustomerByExternalIdentity({provider:
  // "prestashop", ...}) actually found a linked master (evidence.ts,
  // source: "customer_external_identity"). A raw candidate (source:
  // "prestashop", from email/order alone) never reaches this branch.
  const canonicalPsLink = prestashopTrack.find(
    (row) =>
      row.signalType === "prestashop_customer_id" &&
      row.source === "customer_external_identity" &&
      row.status === "VERIFIED" &&
      row.masterCustomerId === base.masterCustomerId
  );
  if (canonicalPsLink && base.masterCustomerId) {
    return {
      status: "VERIFIED",
      identityLevel: "LEVEL_3_PRESTASHOP_LINKED",
      currentLevel: "LEVEL_3_PRESTASHOP_LINKED",
      masterCustomerId: base.masterCustomerId,
      prestashopCustomerId: canonicalPsLink.prestashopCustomerId,
      evidenceIds: [...base.evidenceIds, canonicalPsLink.evidenceId],
      policyCode: "PRESTASHOP_LINK_PRESENT"
    };
  }

  // PARTE 14. A strong, cross-source-converged PrestaShop candidate (Rule 5:
  // email + order agree) with no canonical link yet - policy signals it
  // COULD be authorized, never executes anything.
  const verifiedCandidate = prestashopTrack.find(
    (row) => row.signalType === "prestashop_customer_id" && row.source === "prestashop" && row.status === "VERIFIED"
  );
  if (verifiedCandidate?.prestashopCustomerId && base.masterCustomerId) {
    return {
      status: "READY_TO_LINK",
      currentLevel: base.level,
      masterCustomerId: base.masterCustomerId,
      prestashopCustomerId: verifiedCandidate.prestashopCustomerId,
      evidenceIds: [...base.evidenceIds, verifiedCandidate.evidenceId],
      policyCode: "READY_TO_LINK_PRESTASHOP_CANDIDATE"
    };
  }

  // PARTE 8. Any single-source, unconverged PrestaShop-track evidence
  // (email alone, order alone, or an unbridged candidate id) - real
  // evidence, never enough for VERIFIED/READY_TO_LINK by itself, at ANY
  // base level (this branch fires even below LEVEL_2 - PARTE 8's example is
  // "email exacto único" with no master resolved yet at all).
  const weakCandidate = prestashopTrack.find((row) => row.status === "OBSERVED" || row.status === "CANDIDATE");
  if (weakCandidate) {
    return {
      status: "NEEDS_VERIFICATION",
      currentLevel: base.level,
      masterCustomerId: base.masterCustomerId,
      requiredEvidence: computeRequiredEvidence(usable),
      evidenceIds: [...base.evidenceIds, weakCandidate.evidenceId],
      policyCode: "EMAIL_ONLY_REQUIRES_VERIFICATION"
    };
  }

  return {
    status: "NOT_LINKED",
    currentLevel: base.level,
    masterCustomerId: base.masterCustomerId,
    evidenceIds: base.evidenceIds,
    policyCode: base.policyCode
  };
}
