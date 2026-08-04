/**
 * CP-R1-T10B8A. No fetch, no SQL of its own beyond the single reused
 * `verifyCustomerMasterProjection` port call (customer-service candidate
 * path only), no Customer Profile call, no Catalog Service call, no PII
 * resolution (email/phone/DNI/wa_id) - see
 * docs/releases/CP-R1-T10B8A-master-customer-identity-resolution.md.
 */
import { verifyCustomerMasterProjection } from "../../native-cycle/customer-session/onboardingTransitions";
import type {
  CustomerServiceIdentityCandidate,
  MasterCustomerIdentityResolution,
  MasterCustomerIdentityUnresolvedReason,
  ResolveMasterCustomerIdentityDependencies,
  ResolveMasterCustomerIdentityInput
} from "./types";

/**
 * master_customer.id is BIGINT UNSIGNED AUTO_INCREMENT (confirmed via
 * onboardingTransitions.ts's own `CUSTOMER_MASTER_ID_PATTERN`, `/^[1-9]\d*$/`
 * - the real, already-established convention in this repo). Never a leading
 * zero, never all-zero, never a decimal, never coerced through `Number`
 * (precision-losing for a 20-digit BIGINT UNSIGNED). Bounded to 20 digits to
 * match Customer Profile's own contractual bound (CP-R1-T10B1). This is a
 * deliberately stricter rule than T10B6's own `normalizeMasterCustomerId`
 * (`/^[0-9]{1,20}$/`, leading zeros preserved) - that decision predates this
 * task's own evidence of the real `master_customer.id` convention and is
 * left untouched (out of scope); this resolver applies the now-confirmed
 * stricter rule for its own, independent validation.
 */
const MASTER_CUSTOMER_ID_PATTERN = /^[1-9]\d{0,19}$/;

/** Exported so it can be tested directly (same precedent as T10B6's `toSearchProductsV2ProductIdentity`). Never converts to `Number` - string in, string out. */
export function validateMasterCustomerId(value: string): { ok: true; value: string } | { ok: false } {
  const trimmed = value.trim();
  return MASTER_CUSTOMER_ID_PATTERN.test(trimmed) ? { ok: true, value: trimmed } : { ok: false };
}

type SourceEvidence = { verified: true; masterCustomerId: string } | { verified: false; reason: MasterCustomerIdentityUnresolvedReason } | null;

/**
 * Pure core - no I/O. Exported so every combination of already-derived
 * evidence can be unit tested directly, without a fake projection reader.
 * Never mutates its input.
 */
export function computeMasterCustomerIdentityResolution(evidence: {
  nativeSession: SourceEvidence;
  customerService: SourceEvidence;
}): MasterCustomerIdentityResolution {
  const { nativeSession, customerService } = evidence;

  if (nativeSession?.verified && customerService?.verified) {
    return nativeSession.masterCustomerId === customerService.masterCustomerId
      ? { status: "resolved", masterCustomerId: nativeSession.masterCustomerId, source: "native_session_verified_projection" }
      : { status: "identity_unresolved", reason: "identity_conflict" };
  }
  if (nativeSession?.verified) {
    return { status: "resolved", masterCustomerId: nativeSession.masterCustomerId, source: "native_session_verified_projection" };
  }
  if (customerService?.verified) {
    return { status: "resolved", masterCustomerId: customerService.masterCustomerId, source: "customer_service_verified" };
  }

  // Neither source verified - prefer the native session's own reason (richer
  // session state) when present, otherwise the customer-service candidate's
  // own reason, otherwise there was no evidence at all.
  if (nativeSession && !nativeSession.verified) return { status: "identity_unresolved", reason: nativeSession.reason };
  if (customerService && !customerService.verified) return { status: "identity_unresolved", reason: customerService.reason };
  return { status: "identity_unresolved", reason: "identity_absent" };
}

/**
 * `identity.source === "customer_service"` is the only value in this repo
 * where `identity.customerId` is provably a projection-verified
 * `master_customer.id` by the time `resolveNativeCustomerSession` finishes -
 * see `completeOnboardingWithVerifiedCustomer`/`verifyCustomerMasterProjection`
 * in onboardingTransitions.ts. Every other source
 * (`none`/`external_identity`/`normalized_phone`/`customer_created`/
 * `onboarding_state`) has no demonstrated provenance to that id space in the
 * current types/runtime - `onboarding_state` in particular can also be
 * populated from an unverified local match (`completeOnboardingWithCustomer`,
 * called directly with the locally-resolved id), so it is never treated as
 * verified here even though it sometimes happens to carry a verified value.
 * No re-query against the projection reader happens for this source - it was
 * already checked once, this turn, upstream.
 */
function deriveNativeSessionEvidence(input: ResolveMasterCustomerIdentityInput["nativeCustomerSession"]): SourceEvidence {
  if (!input) return null;
  const { status, customerId, source } = input.identity;

  if (status === "identified") {
    if (customerId === null) return { verified: false, reason: "identity_absent" };
    if (source !== "customer_service") return { verified: false, reason: "identity_source_unsupported" };
    const validated = validateMasterCustomerId(customerId);
    return validated.ok ? { verified: true, masterCustomerId: validated.value } : { verified: false, reason: "invalid_master_customer_id" };
  }
  if (status === "anonymous") return { verified: false, reason: "identity_absent" };
  if (status === "identification_required") return { verified: false, reason: "identity_not_verified" };
  if (status === "conflict") return { verified: false, reason: "identity_conflict" };
  return { verified: false, reason: "identity_temporarily_unavailable" }; // status === "temporarily_unavailable"
}

/**
 * Unlike the native-session path, a raw `customerServiceIdentity` candidate
 * has no prior verification this turn (unless the caller already asserts
 * `verifiedAgainstProjection: true`), so this is the one path that may call
 * the reused projection port - at most once, and only when the caller has
 * not already done so.
 */
async function deriveCustomerServiceEvidence(
  candidate: CustomerServiceIdentityCandidate | null | undefined,
  deps: ResolveMasterCustomerIdentityDependencies
): Promise<SourceEvidence> {
  if (!candidate || candidate.customerMasterId === null || candidate.customerMasterId === undefined) return null;

  if (candidate.verifiedAgainstProjection === true) {
    const validated = validateMasterCustomerId(candidate.customerMasterId);
    return validated.ok ? { verified: true, masterCustomerId: validated.value } : { verified: false, reason: "invalid_master_customer_id" };
  }

  const check = await verifyCustomerMasterProjection(candidate.customerMasterId, { projectionReader: deps.projectionReader });
  if (check.status === "verified") return { verified: true, masterCustomerId: check.customerMasterId };
  if (check.status === "invalid") return { verified: false, reason: "invalid_master_customer_id" };
  if (check.status === "check_failed") return { verified: false, reason: "identity_temporarily_unavailable" };
  return { verified: false, reason: "projection_not_confirmed" }; // not_found / inconsistent
}

/**
 * Application resolver (CP-R1-T10B8A). Never calls Customer Profile, never
 * calls Catalog Service, never resolves identity by email/phone/DNI/wa_id,
 * never mutates its input. Performs at most one projection-port call per
 * invocation (customer-service candidate path only, and only when not
 * already asserted verified) - the native-session path never re-queries.
 */
export async function resolveMasterCustomerIdentity(
  input: ResolveMasterCustomerIdentityInput,
  deps: ResolveMasterCustomerIdentityDependencies = {}
): Promise<MasterCustomerIdentityResolution> {
  const nativeSession = deriveNativeSessionEvidence(input.nativeCustomerSession);
  const customerService = await deriveCustomerServiceEvidence(input.customerServiceIdentity, deps);
  return computeMasterCustomerIdentityResolution({ nativeSession, customerService });
}
