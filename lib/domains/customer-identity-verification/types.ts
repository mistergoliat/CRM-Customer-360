// SALES-AGENT-R2-ID-R2-A04: deterministic, auditable policy over the
// evidence ID-R2-A02 computes and ID-R2-A03 persists. Reads only - never
// writes master_customer/customer_external_identity, never calls
// create_customer/link_external_identity, never reachable from the LLM.
//
// Strict separation kept throughout (task PRINCIPIO CENTRAL):
//   EVIDENCE       -> what ID-R2-A03 already stores (IdentityEvidenceRecord)
//   VERIFICATION   -> IdentityVerificationDecision.status below
//   IDENTITY LEVEL -> IdentityLevel below
//   AUTHORIZATION  -> never granted here. A "VERIFIED" decision is a fact
//                     about evidence, never a standing permission - see
//                     IdentityEntityVerificationDecision for the only scoped
//                     exception (PARTE 7/14).

import type { IdentityEvidenceRecord, IdentityEvidenceSignalType } from "@/lib/domains/customer-identity-evidence";

export type IdentityLevel =
  | "LEVEL_0_ANONYMOUS"
  | "LEVEL_1_CHANNEL_OBSERVED"
  | "LEVEL_2_MASTER_RESOLVED"
  | "LEVEL_3_PRESTASHOP_LINKED";

// PARTE 19. Stable, deterministic codes - never used as prose, never a
// substitute for the status field, only an explanation of *why*.
export type IdentityVerificationPolicyCode =
  | "EXISTING_CHANNEL_LINK"
  | "PHONE_EVIDENCE_MASTER_CONVERGED"
  | "MASTER_FROM_CUSTOMER_SERVICE"
  | "CHANNEL_OBSERVED_UNLINKED"
  | "NO_CHANNEL_EVIDENCE"
  | "PRESTASHOP_LINK_PRESENT"
  | "READY_TO_LINK_PRESTASHOP_CANDIDATE"
  | "EMAIL_ONLY_REQUIRES_VERIFICATION"
  | "NO_PRESTASHOP_EVIDENCE"
  | "CHANNEL_MASTER_CONFLICT"
  | "PRESTASHOP_MASTER_CONFLICT"
  | "EMAIL_ORDER_CONFLICT"
  | "IDENTITY_EVIDENCE_CONFLICT"
  | "AMBIGUOUS_PRESTASHOP_ACCOUNT"
  | "FRESH_RESOLUTION_SYSTEM_FAILURE"
  | "EVIDENCE_REPOSITORY_FAILURE"
  // SALES-AGENT-R2-ID-R2-A05, PARTE 7. Durable evidence claimed a canonical
  // PrestaShop bridge, but the live customer_external_identity(provider=
  // "prestashop") read at decision time no longer confirms it (revoked,
  // repointed to a different master, or the row is gone) - fails closed to
  // LEVEL_2/NOT_LINKED rather than exposing a known-stale LEVEL_3.
  | "PRESTASHOP_LIVE_LINK_STALE"
  | "ORDER_ENTITY_VERIFIED"
  | "ORDER_ENTITY_NOT_EVIDENCED"
  | "ORDER_ENTITY_ACCOUNT_MISMATCH"
  | "ORDER_ENTITY_IDENTITY_NOT_LINKED";

type DecisionBase = {
  policyCode: IdentityVerificationPolicyCode;
  evidenceIds: string[];
  currentLevel: IdentityLevel;
  /** The master this conversation's evidence resolved to (if any) at currentLevel - independent of `status`, so a caller never has to re-derive "which master" from prose (PARTE 20 auditability). */
  masterCustomerId: string | null;
};

// PARTE 3. Deliberately not the literal sketch from the task (which omits
// currentLevel/masterCustomerId on several branches) - every branch except
// SYSTEM_FAILURE carries both, so a caller never has to re-derive "what
// level/master were we actually at" from a status alone.
export type IdentityVerificationDecision =
  | (DecisionBase & {
      status: "VERIFIED";
      identityLevel: IdentityLevel;
      masterCustomerId: string;
      prestashopCustomerId: string | null;
    })
  | (DecisionBase & {
      // PARTE 14. Never executes a link - only states the policy would
      // consider one authorizable by a future mutation workflow.
      status: "READY_TO_LINK";
      masterCustomerId: string;
      prestashopCustomerId: string;
    })
  | (DecisionBase & {
      status: "NEEDS_VERIFICATION";
      requiredEvidence: IdentityEvidenceSignalType[];
    })
  | (DecisionBase & { status: "AMBIGUOUS" })
  | (DecisionBase & {
      status: "IDENTITY_CONFLICT";
      conflictCode: string | null;
    })
  | (DecisionBase & { status: "NOT_LINKED" })
  | { status: "SYSTEM_FAILURE"; retryable: boolean; policyCode: IdentityVerificationPolicyCode };

// PARTE 7/14. LEVEL_4 is never a standing level - it only ever exists
// scoped to one entity, one operation, one verification instant.
export type IdentityVerificationEntityType = "order";

export type IdentityEntityVerificationDecision =
  | {
      status: "VERIFIED_FOR_ENTITY";
      entityType: IdentityVerificationEntityType;
      masterCustomerId: string;
      prestashopCustomerId: string;
      verifiedAt: string;
      evidenceIds: string[];
      policyCode: IdentityVerificationPolicyCode;
    }
  | {
      status: "NOT_VERIFIED_FOR_ENTITY";
      entityType: IdentityVerificationEntityType;
      reason: "identity_not_prestashop_linked" | "order_reference_not_evidenced" | "order_belongs_to_different_account";
      evidenceIds: string[];
      policyCode: IdentityVerificationPolicyCode;
    }
  | { status: "SYSTEM_FAILURE"; retryable: boolean; policyCode: IdentityVerificationPolicyCode };

// The pure decision function's input - already loaded, no I/O inside it
// (PARTE 22: "puro o mayoritariamente puro").
export type IdentityVerificationInputs = {
  /** null = customer_external_identity has no row at all for this wa_id (never observed). {customerId: null} = observed, unresolved. {customerId} = canonical link. */
  currentChannelIdentity: { customerId: string | null } | null;
  /** Current (non-SUPERSEDED/REVOKED) evidence for the conversation - the pure function itself excludes STALE/CONFLICTED where the policy requires it. */
  evidence: IdentityEvidenceRecord[];
  /**
   * Same-turn signal durable evidence cannot reconstruct on its own (ID-R2-A02's
   * detail.status AMBIGUOUS/SYSTEM_FAILURE never produces a persisted evidence
   * row - there is nothing to converge on, so nothing to store). Optional -
   * omitted entirely on a restart-only evaluation (IVP24), which relies on
   * durable evidence alone.
   */
  freshStatus?: "AMBIGUOUS" | "SYSTEM_FAILURE" | null;
};
