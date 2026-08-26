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
  return decideIdentityVerification({ ...loaded.inputs, freshStatus: options?.freshStatus ?? null });
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

  const baseDecision = decideIdentityVerification({ ...loaded.inputs, freshStatus: null });
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
