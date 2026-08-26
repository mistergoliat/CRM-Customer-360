import type { IdentityEvidenceRecord } from "@/lib/domains/customer-identity-evidence";
import type { IdentityEntityVerificationDecision, IdentityVerificationDecision, IdentityVerificationEntityType } from "./types";

// SALES-AGENT-R2-ID-R2-A04, PARTE 7/9/14. LEVEL_4 is never a standing
// level - this is the only function in the domain that can produce a
// "verified" outcome scoped to one specific entity, one specific reference,
// one specific instant. It never writes anything and never implies the
// interlocutor is verified for any OTHER order, operation or channel.

/**
 * Pure decision half. `baseDecision` must already be the conversation's
 * current IdentityVerificationDecision (from decideIdentityVerification);
 * `matchingOrderEvidence` is whatever current, non-stale, non-conflicted
 * order_reference evidence the caller found whose signalHash equals the
 * hash of the entityRef being checked (see service.ts - hashing the raw
 * value happens once, at the I/O boundary, using the same
 * hashSignalValue ID-R2-A03 already uses, never a second raw-value store).
 */
export function decideEntityVerification(input: {
  entityType: IdentityVerificationEntityType;
  baseDecision: IdentityVerificationDecision;
  matchingOrderEvidence: IdentityEvidenceRecord | null;
  now: string;
}): IdentityEntityVerificationDecision {
  const { entityType, baseDecision, matchingOrderEvidence, now } = input;

  if (baseDecision.status === "SYSTEM_FAILURE") {
    return { status: "SYSTEM_FAILURE", retryable: baseDecision.retryable, policyCode: baseDecision.policyCode };
  }

  // A "VERIFIED" decision is only ever LEVEL_3 when its prestashopCustomerId
  // is non-null (evaluate.ts only reaches that branch via a canonical
  // bridge row) - the explicit null check keeps that invariant enforced
  // here too, rather than trusting it silently across module boundaries.
  if (
    baseDecision.status !== "VERIFIED" ||
    baseDecision.identityLevel !== "LEVEL_3_PRESTASHOP_LINKED" ||
    !baseDecision.prestashopCustomerId
  ) {
    return {
      status: "NOT_VERIFIED_FOR_ENTITY",
      entityType,
      reason: "identity_not_prestashop_linked",
      evidenceIds: baseDecision.evidenceIds,
      policyCode: "ORDER_ENTITY_IDENTITY_NOT_LINKED"
    };
  }

  if (!matchingOrderEvidence) {
    return {
      status: "NOT_VERIFIED_FOR_ENTITY",
      entityType,
      reason: "order_reference_not_evidenced",
      evidenceIds: baseDecision.evidenceIds,
      policyCode: "ORDER_ENTITY_NOT_EVIDENCED"
    };
  }

  if (matchingOrderEvidence.prestashopCustomerId !== baseDecision.prestashopCustomerId) {
    return {
      status: "NOT_VERIFIED_FOR_ENTITY",
      entityType,
      reason: "order_belongs_to_different_account",
      evidenceIds: [...baseDecision.evidenceIds, matchingOrderEvidence.evidenceId],
      policyCode: "ORDER_ENTITY_ACCOUNT_MISMATCH"
    };
  }

  return {
    status: "VERIFIED_FOR_ENTITY",
    entityType,
    masterCustomerId: baseDecision.masterCustomerId,
    prestashopCustomerId: baseDecision.prestashopCustomerId,
    verifiedAt: now,
    evidenceIds: [...baseDecision.evidenceIds, matchingOrderEvidence.evidenceId],
    policyCode: "ORDER_ENTITY_VERIFIED"
  };
}
