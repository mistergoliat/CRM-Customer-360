import { findExternalIdentityByProviderExternalId } from "@/lib/integrations/customer-external-identity";
import { getCurrentEvidenceForConversationOrFail, hashSignalValue, type IdentityEvidenceRecord } from "@/lib/domains/customer-identity-evidence";
import { decideIdentityVerification } from "./evaluate";
import { decideEntityVerification } from "./evaluateEntity";
import type {
  IdentityEntityVerificationDecision,
  IdentityVerificationDecision,
  IdentityVerificationInputs,
  IdentityVerificationPolicyCode,
  IdentityVerificationEntityType
} from "./types";

// SALES-AGENT-R2-ID-R2-A04, PARTE 22. The only I/O in this domain: two
// read-only lookups (canonical channel link + durable evidence), fed into
// the pure decision functions in evaluate.ts/evaluateEntity.ts. Never
// writes anything, never calls the Capability Gateway or Customer Service.

export type IdentityVerificationContext = {
  conversationId: string;
  /** customer_external_identity.provider for the CURRENT turn's channel identity, e.g. "whatsapp". */
  provider: string;
  /** The current turn's raw channel identity (e.g. wa_id) - used only for the customer_external_identity lookup, never persisted by this domain. */
  externalId: string;
};

/**
 * Injection seam for the two read-only lookups - same pattern already used
 * throughout this codebase (e.g. ResolveNativeCustomerSessionDependencies)
 * to let a test simulate a genuine repository failure (IVP19) without
 * mocking the real DB layer. Defaults to the real, DB-backed readers.
 */
export type IdentityVerificationDependencies = {
  findExternalIdentity?: typeof findExternalIdentityByProviderExternalId;
  getCurrentEvidence?: typeof getCurrentEvidenceForConversationOrFail;
};

type LoadResult =
  | { ok: true; inputs: Omit<IdentityVerificationInputs, "freshStatus"> }
  | { ok: false; policyCode: IdentityVerificationPolicyCode };

async function loadVerificationInputs(context: IdentityVerificationContext, dependencies?: IdentityVerificationDependencies): Promise<LoadResult> {
  const findExternalIdentity = dependencies?.findExternalIdentity ?? findExternalIdentityByProviderExternalId;
  const getCurrentEvidence = dependencies?.getCurrentEvidence ?? getCurrentEvidenceForConversationOrFail;

  const [identityLookup, evidenceResult] = await Promise.all([
    findExternalIdentity(context.provider, context.externalId),
    getCurrentEvidence(context.conversationId)
  ]);

  // PARTE 11/IVP19: fail closed - a repository failure is never
  // indistinguishable from "genuinely no evidence".
  if (!identityLookup.ok || !evidenceResult.ok) {
    return { ok: false, policyCode: "EVIDENCE_REPOSITORY_FAILURE" };
  }

  return {
    ok: true,
    inputs: {
      currentChannelIdentity: identityLookup.row
        ? { customerId: identityLookup.row.customer_id !== null ? String(identityLookup.row.customer_id) : null }
        : null,
      evidence: evidenceResult.records as IdentityEvidenceRecord[]
    }
  };
}

/**
 * SALES-AGENT-R2-ID-R2-A05, PARTE 7. A04 deliberately left LEVEL_3 freshness
 * dependent on durable evidence alone (the bridge row A02 wrote at the
 * moment it confirmed a link) - declared debt, not a silent omission (A04
 * doc, section 11/"Deudas"). A05 closes it: whenever a decision resolves to
 * VERIFIED/LEVEL_3, this does one more read-only lookup against the SAME
 * table A02 itself checked when it wrote that evidence
 * (customer_external_identity, provider="prestashop") to confirm the bridge
 * is still live right now. A repository failure here fails closed to
 * SYSTEM_FAILURE (never silently downgraded to a lower level); a bridge that
 * no longer confirms fails closed to NOT_LINKED at LEVEL_2 - this domain
 * never exposes a LEVEL_3 it cannot currently confirm live.
 */
async function decideWithLiveLevel3Check(
  inputs: IdentityVerificationInputs,
  dependencies?: IdentityVerificationDependencies
): Promise<IdentityVerificationDecision> {
  const decision = decideIdentityVerification(inputs);
  if (decision.status !== "VERIFIED" || decision.identityLevel !== "LEVEL_3_PRESTASHOP_LINKED" || !decision.prestashopCustomerId) {
    return decision;
  }

  const findExternalIdentity = dependencies?.findExternalIdentity ?? findExternalIdentityByProviderExternalId;
  const liveBridge = await findExternalIdentity("prestashop", decision.prestashopCustomerId);
  if (!liveBridge.ok) {
    return { status: "SYSTEM_FAILURE", retryable: true, policyCode: "EVIDENCE_REPOSITORY_FAILURE" };
  }
  const confirmed = liveBridge.row !== null && liveBridge.row.customer_id !== null && String(liveBridge.row.customer_id) === decision.masterCustomerId;
  if (confirmed) return decision;

  return {
    status: "NOT_LINKED",
    currentLevel: "LEVEL_2_MASTER_RESOLVED",
    masterCustomerId: decision.masterCustomerId,
    evidenceIds: decision.evidenceIds,
    policyCode: "PRESTASHOP_LIVE_LINK_STALE"
  };
}

/**
 * Main entry point (PARTE 22: "evaluateIdentityVerification(context)").
 * `freshStatus` is optional - pass ID-R2-A02's `detail.status` from the SAME
 * turn's resolveIdentity() call, translated to "AMBIGUOUS"/"SYSTEM_FAILURE"
 * when applicable, so the policy can surface those two same-turn-only
 * outcomes that durable evidence alone cannot reconstruct (PARTE 13).
 * Omitting it evaluates purely from durable evidence - always safe, always
 * restart-correct (IVP24).
 */
export async function evaluateIdentityVerification(
  context: IdentityVerificationContext,
  options?: { freshStatus?: "AMBIGUOUS" | "SYSTEM_FAILURE" | null; dependencies?: IdentityVerificationDependencies }
): Promise<IdentityVerificationDecision> {
  const loaded = await loadVerificationInputs(context, options?.dependencies);
  if (!loaded.ok) {
    return { status: "SYSTEM_FAILURE", retryable: true, policyCode: loaded.policyCode };
  }
  return decideWithLiveLevel3Check({ ...loaded.inputs, freshStatus: options?.freshStatus ?? null }, options?.dependencies);
}

export type IdentityEntityVerificationContext = IdentityVerificationContext & {
  entityType: IdentityVerificationEntityType;
  /** Raw order reference/invoice/id as declared by the customer - hashed here, never persisted or logged raw by this domain. */
  entityRef: string;
};

/**
 * PARTE 7/9/14: the only scoped LEVEL_4 check. Never grants a standing
 * level - the result only ever answers "is this master verified for THIS
 * entityRef, right now".
 */
export async function evaluateEntityVerification(
  context: IdentityEntityVerificationContext,
  options?: { dependencies?: IdentityVerificationDependencies }
): Promise<IdentityEntityVerificationDecision> {
  const loaded = await loadVerificationInputs(context, options?.dependencies);
  if (!loaded.ok) {
    return { status: "SYSTEM_FAILURE", retryable: true, policyCode: loaded.policyCode };
  }

  const baseDecision = await decideWithLiveLevel3Check({ ...loaded.inputs, freshStatus: null }, options?.dependencies);
  const entityHash = hashSignalValue(context.entityRef);
  const matchingOrderEvidence =
    entityHash === null
      ? null
      : (loaded.inputs.evidence.find(
          (row) => row.signalType === "order_reference" && row.status !== "STALE" && row.status !== "CONFLICTED" && row.signalHash === entityHash
        ) ?? null);

  return decideEntityVerification({
    entityType: context.entityType,
    baseDecision,
    matchingOrderEvidence,
    now: new Date().toISOString()
  });
}
