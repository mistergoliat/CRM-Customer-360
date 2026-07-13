import type { CustomerOnboardingService, CustomerOnboardingState } from "@/lib/domains/customer-onboarding";
import { createCustomerMasterProjectionReader, type CustomerMasterProjectionReader } from "@/lib/domains/customer-service";
import { recordOnboardingTransitionIfChanged } from "./identityAuditEvents";

// Shared onboarding-state transition helpers (ACS-R1-04-T06, contract
// section 18). Deliberately dependency-free beyond the onboarding domain
// itself (plus the ACS-R1-04-T07 audit recorder, which only depends on the
// events family - never on the Capability Gateway) - resolveNativeCustomerSession
// and the create_customer/link_external_identity Gateway capabilities both
// call these, and neither may import the other (resolveNativeCustomerSession
// -> Capability Gateway -> registry -> the identity capabilities would
// otherwise cycle back here).

/** Moves onboarding into a terminal state (conflict/temporarily_unavailable), landing through "resolving" first if needed. Never reinitiates an already-terminal state. */
export async function landOnboardingInTerminalState(
  onboardingService: CustomerOnboardingService,
  onboarding: CustomerOnboardingState,
  target: "conflict" | "temporarily_unavailable",
  correlationId?: string | null
): Promise<{ state: CustomerOnboardingState; warning: string | null }> {
  let current = onboarding;
  if (current.status === "required" || current.status === "collecting") {
    const moved = await onboardingService.markResolving({ conversationId: current.conversationId, expectedVersion: current.version });
    if (!moved.ok) return { state: current, warning: moved.status === "onboarding_state_version_conflict" ? "customer_onboarding_version_conflict" : null };
    await recordOnboardingTransitionIfChanged({ operation: "mark_resolving", previous: current, result: moved, correlationId });
    current = moved.state;
  }
  // Never reinitiate an already-terminal state (conflict/temporarily_blocked/completed) - section 18.
  if (current.status !== "resolving") return { state: current, warning: null };

  const transition =
    target === "conflict"
      ? await onboardingService.markConflict({ conversationId: current.conversationId, expectedVersion: current.version })
      : await onboardingService.markTemporarilyUnavailable({ conversationId: current.conversationId, expectedVersion: current.version });
  if (!transition.ok) return { state: current, warning: transition.status === "onboarding_state_version_conflict" ? "customer_onboarding_version_conflict" : null };
  await recordOnboardingTransitionIfChanged({
    operation: target === "conflict" ? "mark_conflict" : "mark_temporarily_unavailable",
    previous: current,
    result: transition,
    correlationId
  });
  return { state: transition.state, warning: null };
}

/** Completes onboarding with a resolved customerId, landing through "resolving" first if needed. */
export async function completeOnboardingWithCustomer(
  onboardingService: CustomerOnboardingService,
  onboarding: CustomerOnboardingState,
  customerId: string,
  correlationId?: string | null
): Promise<{ state: CustomerOnboardingState; warning: string | null }> {
  let current = onboarding;
  if (current.status === "required" || current.status === "collecting") {
    const moved = await onboardingService.markResolving({ conversationId: current.conversationId, expectedVersion: current.version });
    if (!moved.ok) return { state: current, warning: moved.status === "onboarding_state_version_conflict" ? "customer_onboarding_version_conflict" : null };
    await recordOnboardingTransitionIfChanged({ operation: "mark_resolving", previous: current, result: moved, correlationId });
    current = moved.state;
  }
  if (current.status !== "resolving") return { state: current, warning: null };

  const completed = await onboardingService.completeOnboarding({ conversationId: current.conversationId, expectedVersion: current.version, customerId });
  if (!completed.ok) {
    if (completed.status === "customer_conflict") return { state: current, warning: "customer_identity_conflict" };
    return { state: current, warning: completed.status === "onboarding_state_version_conflict" ? "customer_onboarding_version_conflict" : null };
  }
  await recordOnboardingTransitionIfChanged({ operation: "complete", previous: current, result: completed, correlationId });
  return { state: completed.state, warning: null };
}

// ACS-R1-04-T08.1. Customer Service is the sole authority for
// create_customer/link_external_identity/resolve_customer, but nothing
// guarantees its returned customerMasterId already has a matching row in
// the local master_customer table (crm_customer_onboarding_state.customer_id
// carries a real FK, ON DELETE RESTRICT, to master_customer.id - migration
// 023). This module never inserts/updates master_customer (that authority
// stays with Customer Service) - it only reads the local projection before
// trusting an id, so a customer Customer Service just created but ACS has
// not projected locally yet never blows up as a raw FK violation.
// Centralized here (never copied per caller) because every successful path
// that introduces a customer FROM Customer Service - resolve_customer's
// "resolved", create_customer's "created"/"matched_existing",
// link_external_identity's "completed"/"already_linked" - must apply the
// identical rule.

let cachedProjectionReader: CustomerMasterProjectionReader | undefined;
function getSharedCustomerMasterProjectionReader(): CustomerMasterProjectionReader {
  if (!cachedProjectionReader) cachedProjectionReader = createCustomerMasterProjectionReader();
  return cachedProjectionReader;
}

/** Test-only: force the module to re-create the real, DB-backed projection reader. */
export function resetCustomerMasterProjectionReaderForTests() {
  cachedProjectionReader = undefined;
}

/** Test-only: inject a fake projection reader directly, bypassing the real DB-backed default. */
export function setCustomerMasterProjectionReaderForTests(reader: CustomerMasterProjectionReader) {
  cachedProjectionReader = reader;
}

// master_customer.id is BIGINT UNSIGNED AUTO_INCREMENT - the canonical
// customerMasterId form is a positive integer string. The HTTP adapter
// (lib/integrations/customer-service/http-adapter.ts) already enforces this
// shape on the wire; this is a second, independent check at the point of
// use (defense in depth - a directly-injected test double or a future
// second adapter must not bypass it).
const CUSTOMER_MASTER_ID_PATTERN = /^[1-9]\d*$/;

export type CustomerMasterProjectionCheckResult =
  | { status: "verified"; customerMasterId: string }
  | { status: "invalid" }
  | { status: "inconsistent" }
  | { status: "not_found" }
  | { status: "check_failed" };

export type VerifyCustomerMasterProjectionOptions = {
  /** A customerId already known locally this turn (e.g. session.identity.customerId for link_external_identity) - a disagreement is treated as inconsistent, never silently overwritten. */
  knownLocalCustomerId?: string | null;
  projectionReader?: CustomerMasterProjectionReader;
};

/**
 * Pure verification (no onboarding side effects): does customerMasterId
 * look well-formed, agree with any customer already known locally this
 * turn, and correspond to a real master_customer row? Never inserts,
 * updates, or falls back to PrestaShop/Customer 360 - read-only.
 */
export async function verifyCustomerMasterProjection(
  customerMasterId: string | null | undefined,
  options: VerifyCustomerMasterProjectionOptions = {}
): Promise<CustomerMasterProjectionCheckResult> {
  const trimmed = typeof customerMasterId === "string" ? customerMasterId.trim() : "";
  if (!trimmed || !CUSTOMER_MASTER_ID_PATTERN.test(trimmed)) {
    return { status: "invalid" };
  }
  if (options.knownLocalCustomerId && options.knownLocalCustomerId !== trimmed) {
    return { status: "inconsistent" };
  }

  const reader = options.projectionReader ?? getSharedCustomerMasterProjectionReader();
  let exists: boolean;
  try {
    exists = await reader.exists(trimmed);
  } catch {
    // Fail-closed: a query failure is never treated as no_match or as a
    // green light - see task section 9. No raw error/stack trace escapes.
    return { status: "check_failed" };
  }

  return exists ? { status: "verified", customerMasterId: trimmed } : { status: "not_found" };
}

export type CompleteOnboardingWithVerifiedCustomerResult = {
  state: CustomerOnboardingState;
  warning: string | null;
  /** null whenever the gate did not verify the id - completeOnboarding was never called. */
  verifiedCustomerId: string | null;
};

/**
 * The gate required before completing onboarding with a customerMasterId
 * that came from Customer Service (task section 7). Landing through
 * "resolving" first when needed, exactly like completeOnboardingWithCustomer.
 *
 * - verified -> completes onboarding for real (delegates to completeOnboardingWithCustomer).
 * - not_found / invalid / inconsistent -> onboarding lands in
 *   temporarily_unavailable (never completed, never a fabricated customer,
 *   never a customer_conversation/Customer 360 link to this id), warning
 *   customer_master_projection_unavailable. The capability's own business
 *   outcome (created/resolved/linked) is never changed by this - Customer
 *   Service really did succeed; only the local projection is pending.
 * - check_failed -> onboarding state is left untouched (a later turn may
 *   retry), warning customer_master_projection_check_failed. Never retries
 *   Customer Service itself within the same turn.
 */
export async function completeOnboardingWithVerifiedCustomer(
  onboardingService: CustomerOnboardingService,
  onboarding: CustomerOnboardingState,
  customerMasterId: string | null | undefined,
  correlationId?: string | null,
  options: VerifyCustomerMasterProjectionOptions = {}
): Promise<CompleteOnboardingWithVerifiedCustomerResult> {
  const check = await verifyCustomerMasterProjection(customerMasterId, options);

  if (check.status === "check_failed") {
    return { state: onboarding, warning: "customer_master_projection_check_failed", verifiedCustomerId: null };
  }

  if (check.status !== "verified") {
    const landed = await landOnboardingInTerminalState(onboardingService, onboarding, "temporarily_unavailable", correlationId);
    return { state: landed.state, warning: "customer_master_projection_unavailable", verifiedCustomerId: null };
  }

  const landed = await completeOnboardingWithCustomer(onboardingService, onboarding, check.customerMasterId, correlationId);
  return { state: landed.state, warning: landed.warning, verifiedCustomerId: check.customerMasterId };
}
