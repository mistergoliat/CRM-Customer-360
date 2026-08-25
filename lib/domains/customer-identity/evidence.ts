import type {
  CustomerIdentityConfidence,
  CustomerIdentityConflict,
  CustomerIdentityConflictType,
  CustomerIdentityMatchedBy,
  CustomerIdentityResolutionStatus,
  IdentityEvidence,
  IdentityResolutionDetail,
  IdentityResolutionDetailStatus
} from "./types";

// ID-R2-A02 conflict policy (contract PARTE 10). Deterministic hard rules,
// no aggregate score, no LLM input anywhere in this file. Two pure functions:
//
// 1. classifyPrestashopCandidates - folds the email/order candidate lookups
//    (each independently 0/1/N ids) into one outcome.
// 2. applyIdentityEvidence - combines that outcome with the existing
//    wa_id/phone result (untouched, PARTE 7) and the PrestaShop -> master
//    bridge lookup (PARTE 6) into the final detail + whatever the top-level
//    result is allowed to change (PARTE 11: only ever escalates to
//    "conflict" or "temporarily_unavailable" - never invents "identified").

export type PrestashopSignalOutcome =
  | { kind: "none" }
  | { kind: "invalid_email" }
  | { kind: "system_failure" }
  | { kind: "not_found" }
  | { kind: "ambiguous"; source: "email" | "order" }
  | { kind: "cross_source_conflict" }
  | { kind: "resolved"; prestashopCustomerId: string; strength: "candidate" | "verified" };

export function classifyPrestashopCandidates(input: {
  emailInvalid: boolean;
  emailQueryFailed: boolean;
  orderQueryFailed: boolean;
  emailCandidateIds: string[] | null;
  orderCandidateIds: string[] | null;
}): PrestashopSignalOutcome {
  const { emailInvalid, emailQueryFailed, orderQueryFailed, emailCandidateIds, orderCandidateIds } = input;

  // Same-source ambiguity (IDR05/IDR08 in PARTE 19's email/order variants) -
  // never arbitrarily pick one, checked before cross-source comparison.
  if (emailCandidateIds !== null && emailCandidateIds.length > 1) return { kind: "ambiguous", source: "email" };
  if (orderCandidateIds !== null && orderCandidateIds.length > 1) return { kind: "ambiguous", source: "order" };

  const emailId = emailCandidateIds && emailCandidateIds.length === 1 ? emailCandidateIds[0] : null;
  const orderId = orderCandidateIds && orderCandidateIds.length === 1 ? orderCandidateIds[0] : null;

  if (emailId && orderId) {
    // Rule 5 / Rule 6.
    return emailId === orderId
      ? { kind: "resolved", prestashopCustomerId: emailId, strength: "verified" }
      : { kind: "cross_source_conflict" };
  }
  if (emailId) return { kind: "resolved", prestashopCustomerId: emailId, strength: "candidate" };
  if (orderId) return { kind: "resolved", prestashopCustomerId: orderId, strength: "candidate" };

  // Nothing resolved - rank the remaining explanations, most specific first.
  // A query failure only becomes SYSTEM_FAILURE here if it left nothing
  // usable; a failed order lookup next to a resolved email id never reaches
  // this branch at all (handled above).
  if (emailQueryFailed || orderQueryFailed) return { kind: "system_failure" };
  if (emailInvalid) return { kind: "invalid_email" };
  if (emailCandidateIds === null && orderCandidateIds === null) return { kind: "none" };
  return { kind: "not_found" };
}

export type BaseResolution = {
  status: CustomerIdentityResolutionStatus;
  customerId: string | null;
  matchedBy: CustomerIdentityMatchedBy;
  confidence: CustomerIdentityConfidence;
  conflicts: CustomerIdentityConflict[];
};

// The PrestaShop -> master bridge lookup (PARTE 6), reusing
// findCustomerByExternalIdentity({ provider: "prestashop", externalId }) -
// only performed when classifyPrestashopCandidates produced a single id.
export type PrestashopBridgeLookup =
  | { checked: false }
  | { checked: true; ok: true; masterCustomerIds: string[] }
  | { checked: true; ok: false };

export type IdentityEvidenceOutcome = {
  detail: IdentityResolutionDetail;
  // The only two ways new signals may change the top-level, backward
  // compatible result (PARTE 11/16: no auto-link, no invented "identified").
  overrideToConflict: boolean;
  overrideToSystemFailure: boolean;
  conflictOverride: CustomerIdentityConflict | null;
  extraWarnings: string[];
};

function detailFor(
  status: IdentityResolutionDetailStatus,
  masterCustomerId: string | null,
  prestashopCustomerId: string | null,
  evidence: IdentityEvidence[],
  conflictCode: CustomerIdentityConflictType | null
): IdentityResolutionDetail {
  return { status, masterCustomerId, prestashopCustomerId, evidence, conflictCode };
}

export function applyIdentityEvidence(input: {
  base: BaseResolution;
  prestashop: PrestashopSignalOutcome;
  bridge: PrestashopBridgeLookup;
  observedAt: string;
}): IdentityEvidenceOutcome {
  const { base, prestashop, bridge, observedAt } = input;
  const evidence: IdentityEvidence[] = [];
  const extraWarnings: string[] = [];
  const baseMaster = base.status === "identified" ? base.customerId : null;
  const baseConflictCode = base.status === "conflict" ? (base.conflicts[0]?.type ?? null) : null;

  const noOverride = { overrideToConflict: false, overrideToSystemFailure: false, conflictOverride: null, extraWarnings };

  // wa_id/phone technical failure or invalid externalId short-circuits -
  // service.ts never even queries PrestaShop evidence in these cases.
  if (base.status === "temporarily_unavailable" || base.status === "invalid_input") {
    const status: IdentityResolutionDetailStatus = base.status === "temporarily_unavailable" ? "SYSTEM_FAILURE" : "INVALID_INPUT";
    return { detail: detailFor(status, null, null, evidence, null), ...noOverride };
  }

  if (base.matchedBy) {
    evidence.push({
      signalType: base.matchedBy === "external_identity" ? "wa_id" : "phone",
      source: "customer_external_identity",
      strength: base.confidence === "verified" ? "verified" : "strong",
      masterCustomerId: base.customerId ?? undefined,
      verified: base.confidence === "verified",
      observedAt
    });
  }

  if (prestashop.kind === "none") {
    const status: IdentityResolutionDetailStatus = baseMaster ? "RESOLVED" : base.status === "conflict" ? "IDENTITY_CONFLICT" : "NOT_FOUND";
    return { detail: detailFor(status, baseMaster, null, evidence, baseConflictCode), ...noOverride };
  }

  if (prestashop.kind === "invalid_email") {
    extraWarnings.push("email_invalid_input");
    const status: IdentityResolutionDetailStatus = baseMaster ? "RESOLVED" : base.status === "conflict" ? "IDENTITY_CONFLICT" : "INVALID_INPUT";
    return { detail: detailFor(status, baseMaster, null, evidence, baseConflictCode), ...noOverride, extraWarnings };
  }

  if (prestashop.kind === "system_failure") {
    extraWarnings.push("prestashop_evidence_unavailable");
    if (baseMaster) return { detail: detailFor("RESOLVED", baseMaster, null, evidence, null), ...noOverride, extraWarnings };
    return {
      detail: detailFor("SYSTEM_FAILURE", null, null, evidence, null),
      overrideToConflict: false,
      overrideToSystemFailure: base.status !== "conflict",
      conflictOverride: null,
      extraWarnings
    };
  }

  if (prestashop.kind === "not_found") {
    const status: IdentityResolutionDetailStatus = baseMaster ? "RESOLVED" : base.status === "conflict" ? "IDENTITY_CONFLICT" : "NOT_FOUND";
    return { detail: detailFor(status, baseMaster, null, evidence, baseConflictCode), ...noOverride };
  }

  if (prestashop.kind === "ambiguous") {
    extraWarnings.push(prestashop.source === "email" ? "email_ambiguous" : "order_reference_ambiguous");
    const status: IdentityResolutionDetailStatus = baseMaster ? "RESOLVED" : "AMBIGUOUS";
    return { detail: detailFor(status, baseMaster, null, evidence, null), ...noOverride, extraWarnings };
  }

  if (prestashop.kind === "cross_source_conflict") {
    // Rule 6 - contradictory PrestaShop-level evidence in the same call is
    // never swallowed, regardless of what wa_id/phone said.
    const conflict: CustomerIdentityConflict = { type: "email_vs_order_prestashop_id", candidateCustomerIds: [] };
    return {
      detail: detailFor("IDENTITY_CONFLICT", null, null, evidence, "email_vs_order_prestashop_id"),
      overrideToConflict: true,
      overrideToSystemFailure: false,
      conflictOverride: conflict,
      extraWarnings
    };
  }

  // prestashop.kind === "resolved": exactly one PrestaShop customer id
  // emerged from email and/or order evidence (PARTE 5/8). Whether it means
  // anything for the current master depends entirely on the bridge lookup
  // below (PARTE 6) - the id alone is only a candidate.
  const { prestashopCustomerId } = prestashop;
  evidence.push({
    signalType: "prestashop_customer_id",
    source: "prestashop",
    strength: prestashop.strength,
    prestashopCustomerId,
    verified: prestashop.strength === "verified",
    observedAt
  });

  if (!bridge.checked) {
    // service.ts always checks the bridge when prestashop.kind is
    // "resolved" - reaching here would be a caller bug. Fail closed.
    return {
      detail: detailFor("SYSTEM_FAILURE", null, prestashopCustomerId, evidence, null),
      overrideToConflict: false,
      overrideToSystemFailure: base.status !== "conflict",
      conflictOverride: null,
      extraWarnings: [...extraWarnings, "prestashop_bridge_not_checked"]
    };
  }

  if (!bridge.ok) {
    extraWarnings.push("prestashop_bridge_unavailable");
    if (baseMaster) return { detail: detailFor("RESOLVED", baseMaster, prestashopCustomerId, evidence, null), ...noOverride, extraWarnings };
    return {
      detail: detailFor("SYSTEM_FAILURE", null, prestashopCustomerId, evidence, null),
      overrideToConflict: false,
      overrideToSystemFailure: base.status !== "conflict",
      conflictOverride: null,
      extraWarnings
    };
  }

  if (bridge.masterCustomerIds.length > 1) {
    // Structurally prevented today by uq_customer_external_identity_provider_external_id
    // (one row per provider+external_id), but a port implementation could
    // still surface it - fail closed rather than pick one (IDR16).
    const conflict: CustomerIdentityConflict = { type: "prestashop_id_multi_master", candidateCustomerIds: [...bridge.masterCustomerIds] };
    return {
      detail: detailFor("IDENTITY_CONFLICT", null, prestashopCustomerId, evidence, "prestashop_id_multi_master"),
      overrideToConflict: true,
      overrideToSystemFailure: false,
      conflictOverride: conflict,
      extraWarnings
    };
  }

  const linkedMaster = bridge.masterCustomerIds[0] ?? null;

  if (linkedMaster === null) {
    // Case D: PrestaShop account discoverable, never linked to any master.
    const status: IdentityResolutionDetailStatus = baseMaster ? "RESOLVED" : "CANDIDATE";
    return { detail: detailFor(status, baseMaster, prestashopCustomerId, evidence, null), ...noOverride };
  }

  evidence.push({
    signalType: "prestashop_customer_id",
    source: "customer_external_identity",
    strength: "verified",
    masterCustomerId: linkedMaster,
    prestashopCustomerId,
    verified: true,
    observedAt
  });

  if (baseMaster === null) {
    // Case B: linked, but current wa_id/phone resolved nobody - a
    // candidate that needs verification, never auto-elevated (PARTE 11).
    return { detail: detailFor("NEEDS_VERIFICATION", linkedMaster, prestashopCustomerId, evidence, null), ...noOverride };
  }

  if (linkedMaster === baseMaster) {
    // Case A / Rule 1: converges with the already-resolved wa_id/phone master.
    return { detail: detailFor("RESOLVED", baseMaster, prestashopCustomerId, evidence, null), ...noOverride };
  }

  // Case C / Rule 2: wa_id/phone resolved master A, PrestaShop evidence
  // resolved to a linked, different master B. Escalate - never silently
  // prefer one side, even though the base wa/phone lookup alone said "identified".
  const conflict: CustomerIdentityConflict = { type: "prestashop_link_vs_wa_phone", candidateCustomerIds: [baseMaster, linkedMaster] };
  return {
    detail: detailFor("IDENTITY_CONFLICT", null, prestashopCustomerId, evidence, "prestashop_link_vs_wa_phone"),
    overrideToConflict: true,
    overrideToSystemFailure: false,
    conflictOverride: conflict,
    extraWarnings
  };
}
