/**
 * CP-R1-T10B8A: contracts for resolving a `masterCustomerId` (master_customer.id,
 * BIGINT UNSIGNED AUTO_INCREMENT) from evidence the runtime has already
 * produced this turn. Never calls Customer Profile or Catalog Service, never
 * resolves identity by email/phone/DNI/wa_id - see
 * docs/releases/CP-R1-T10B8A-master-customer-identity-resolution.md.
 */
import type { CustomerMasterProjectionReader } from "@/lib/domains/customer-service";
import type { NativeCustomerSessionExecutionContext } from "../../native-cycle/customer-session/types";

/**
 * `customer_service_verified`: a raw `customerMasterId` candidate (e.g. from
 * a future direct Customer Service call site) confirmed against the local
 * `master_customer` projection by this resolver itself.
 * `native_session_verified_projection`: `NativeCustomerSessionExecutionContext.identity.customerId`
 * with `identity.source === "customer_service"` - already projection-verified
 * upstream by `resolveNativeCustomerSession`/`completeOnboardingWithVerifiedCustomer`
 * before this resolver ever sees it (see "Verified sources" in the docs) -
 * never re-verified a second time against the same projection this turn.
 */
export const MASTER_CUSTOMER_IDENTITY_SOURCES = ["customer_service_verified", "native_session_verified_projection"] as const;
export type MasterCustomerIdentitySource = (typeof MASTER_CUSTOMER_IDENTITY_SOURCES)[number];

export const MASTER_CUSTOMER_IDENTITY_UNRESOLVED_REASONS = [
  "identity_absent",
  "identity_not_verified",
  "identity_source_unsupported",
  "projection_not_confirmed",
  "identity_conflict",
  "identity_temporarily_unavailable",
  "invalid_master_customer_id"
] as const;
export type MasterCustomerIdentityUnresolvedReason = (typeof MASTER_CUSTOMER_IDENTITY_UNRESOLVED_REASONS)[number];

export type MasterCustomerIdentityResolution =
  | { status: "resolved"; masterCustomerId: string; source: MasterCustomerIdentitySource }
  | { status: "identity_unresolved"; reason: MasterCustomerIdentityUnresolvedReason };

/**
 * A raw candidate from Customer Service, not yet known to be
 * projection-verified. `verifiedAgainstProjection: true` lets a caller that
 * already checked the projection this turn (e.g. to avoid a second query)
 * assert that fact instead of forcing this resolver to re-query - the
 * resolver still independently re-validates the string format either way.
 */
export type CustomerServiceIdentityCandidate = {
  customerMasterId?: string | null;
  verifiedAgainstProjection?: boolean;
};

/**
 * `nativeCustomerSession` only needs `identity` - typed as a structural
 * subset (not the full execution context) so this input can be built before
 * `NativeCustomerSessionExecutionContext` itself finishes constructing (see
 * resolveNativeCustomerSession.ts, which computes `masterCustomerIdentity`
 * as one of that same context's own fields) and so callers never have to
 * fabricate unrelated fields (trustedInbound, onboarding, consent...) just
 * to call this resolver.
 */
export type ResolveMasterCustomerIdentityInput = {
  nativeCustomerSession?: Pick<NativeCustomerSessionExecutionContext, "identity"> | null;
  customerServiceIdentity?: CustomerServiceIdentityCandidate | null;
};

export type ResolveMasterCustomerIdentityDependencies = {
  /** Test-only injection seam; production callers default to the shared, real projection reader reused from onboardingTransitions.ts. */
  projectionReader?: CustomerMasterProjectionReader;
};
