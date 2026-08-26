import { evaluateCommercialIdentityRequirement } from "../identity/commercial-identity-requirement";
import type { RuntimeIdentityContext } from "../native-cycle/customer-session";
import {
  loadCustomerCommercialHistoryContext,
  type CustomerHistoryNeed,
  type CustomerProfileContextConfig
} from "../customer-profile-context";
import { createProductionCustomerProfileCapabilities, type CustomerProfileCapabilities } from "../capabilities/customer-profile";
import type { CommercialCustomerContextResult } from "./types";

export type LoadCommercialCustomerContextInput = {
  readonly runtimeIdentity: RuntimeIdentityContext | null;
  readonly historyNeeds: readonly CustomerHistoryNeed[];
  readonly requestId?: string;
  readonly customerProfileCapabilities?: CustomerProfileCapabilities;
  readonly config?: CustomerProfileContextConfig;
};

function parsePrestashopCustomerId(value: string | null): number | null {
  if (value === null) return null;
  if (!/^\d{1,15}$/.test(value) || /^0+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * SALES-AGENT-R2-ID-R2-A10. The single safe boundary through which R2
 * consumes Customer Profile. Input is always a RuntimeIdentityContext
 * (ID-R2-A05, live-confirmed by A05's own decideWithLiveLevel3Check) - never
 * a channel, never a bare id a caller could confuse with
 * masterCustomerId/prestashopCustomerId.
 *
 * Gate: reuses A06's evaluateCommercialIdentityRequirement("customer_profile_history", ...)
 * - never a second, hand-rolled `if (identityLevel === "LEVEL_3...")` check.
 * Only a SUFFICIENT decision proceeds; every other decision
 * (ONBOARDING_REQUIRED, READY_TO_LINK, AMBIGUITY_RESOLUTION_REQUIRED,
 * IDENTITY_CONFLICT, SYSTEM_WAIT) maps to IDENTITY_INSUFFICIENT here -
 * Customer Profile is never called, and this function never re-triggers
 * discovery or degrades to masterCustomerId.
 *
 * Once SUFFICIENT, the only id ever forwarded is
 * runtimeIdentity.prestashopCustomerId (ps_customer.id_customer) - the
 * master_customer.id space is not read from RuntimeIdentityContext at all
 * past the gate check.
 */
export async function loadCommercialCustomerContext(input: LoadCommercialCustomerContextInput): Promise<CommercialCustomerContextResult> {
  const runtimeIdentity = input.runtimeIdentity;

  if (!runtimeIdentity) {
    return { status: "IDENTITY_INSUFFICIENT", requiredLevel: "LEVEL_3_PRESTASHOP_LINKED" };
  }

  const decision = evaluateCommercialIdentityRequirement("customer_profile_history", runtimeIdentity);
  if (decision.status !== "SUFFICIENT") {
    return { status: "IDENTITY_INSUFFICIENT", requiredLevel: "LEVEL_3_PRESTASHOP_LINKED" };
  }

  const prestashopCustomerId = parsePrestashopCustomerId(runtimeIdentity.prestashopCustomerId);
  if (prestashopCustomerId === null) {
    // Defensive only - A05's live check guarantees a real prestashopCustomerId
    // whenever SUFFICIENT is reached at LEVEL_3. Never guessed, never
    // downgraded to masterCustomerId.
    return { status: "SYSTEM_UNAVAILABLE", retryable: false, prestashopCustomerId: null };
  }

  const commercialHistory = await loadCustomerCommercialHistoryContext({
    customerId: prestashopCustomerId,
    commercialIntent: true,
    historyNeeds: input.historyNeeds,
    requestId: input.requestId,
    config: input.config,
    customerProfileCapabilities: input.customerProfileCapabilities ?? createProductionCustomerProfileCapabilities()
  });

  const prestashopCustomerIdString = String(prestashopCustomerId);

  if (commercialHistory.status === "AVAILABLE" || commercialHistory.status === "PARTIAL") {
    return { status: "AVAILABLE", prestashopCustomerId: prestashopCustomerIdString, commercialHistory };
  }
  if (commercialHistory.status === "NOT_FOUND") {
    return { status: "PROFILE_NOT_FOUND", prestashopCustomerId: prestashopCustomerIdString };
  }
  if (commercialHistory.status === "UNAVAILABLE") {
    return { status: "SYSTEM_UNAVAILABLE", retryable: true, prestashopCustomerId: prestashopCustomerIdString };
  }
  // CONTRACT_ERROR / DISABLED / IDENTITY_UNAVAILABLE (defensive - identity
  // was already validated above by this function's own gate).
  return { status: "SYSTEM_UNAVAILABLE", retryable: false, prestashopCustomerId: prestashopCustomerIdString };
}
