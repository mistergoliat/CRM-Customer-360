// Pure authority policies for the Customer Service capabilities (ACS-R1-04-T04.1).
// Canonical contract: docs/data/customer-creation-linking-authority-contract.md,
// sections 4-6. No conversational text here - the AI drafts the reply from
// the outcome (contract "La IA decide"/"La IA no decide", top of file).
import { CREATE_CUSTOMER_ALLOWED_PURPOSES, type CustomerResolutionEvidence } from "./types";

export type AuthorityAllowed = { status: "allowed" };
export type AuthorityMissingInformation = { status: "missing_information"; requiredFields: string[] };
export type AuthorityDenied = { status: "denied"; reasonCode: string };
export type AuthorityRequiresConsent = { status: "requires_consent"; consentType: string };
export type AuthorityRequiresHuman = { status: "requires_human"; reasonCode: string };

export type AuthorityDecision =
  | AuthorityAllowed
  | AuthorityMissingInformation
  | AuthorityDenied
  | AuthorityRequiresConsent
  | AuthorityRequiresHuman;

export type AuthorityDecisionNotAllowed = Exclude<AuthorityDecision, AuthorityAllowed>;

// -----------------------------------------------------------------------
// create_customer (contract section 4)
// -----------------------------------------------------------------------

export type CreateCustomerAuthorityInput = {
  commercialPurpose: string;
  firstName: string | null;
  lastName?: string | null;
  email: string | null;
  phoneNumber: string | null;
  consent: { createCustomer: boolean; messageId: string | null; capturedAt: string | null } | null;
  // Must come from an actual resolveCustomer() call, never from an
  // LLM-asserted boolean/string (contract section 8).
  resolutionEvidence: CustomerResolutionEvidence | null;
};

function isAllowedCreatePurpose(purpose: string): boolean {
  return (CREATE_CUSTOMER_ALLOWED_PURPOSES as readonly string[]).includes(purpose);
}

export function evaluateCreateCustomerAuthority(input: CreateCustomerAuthorityInput): AuthorityDecision {
  if (!isAllowedCreatePurpose(input.commercialPurpose)) {
    return { status: "denied", reasonCode: "purpose_not_authorized_for_customer_creation" };
  }

  if (!input.resolutionEvidence) {
    // Absence of evidence never equals no_match (contract section 8).
    return { status: "denied", reasonCode: "resolution_evidence_missing" };
  }

  if (input.resolutionEvidence.result.status !== "no_match") {
    return { status: "denied", reasonCode: `resolution_status_${input.resolutionEvidence.result.status}` };
  }

  const requiredFields: string[] = [];
  if (!input.firstName) requiredFields.push("firstName");
  if (!input.email) requiredFields.push("email");
  if (!input.phoneNumber) requiredFields.push("phoneNumber");
  if (requiredFields.length > 0) {
    return { status: "missing_information", requiredFields };
  }

  if (!input.consent?.createCustomer) {
    return { status: "requires_consent", consentType: "create_customer" };
  }

  return { status: "allowed" };
}

// -----------------------------------------------------------------------
// link_external_identity (contract section 5)
// -----------------------------------------------------------------------

export type LinkExternalIdentityAuthorityInput = {
  customerId: string | null;
  // wa_id the operation wants to link vs. the wa_id the current inbound
  // message actually arrived on. Linking requires they match - never a
  // number typed inside the message text or chosen by the LLM.
  waId: string | null;
  inboundWaId: string | null;
  consent: { granted: boolean; messageId: string | null; capturedAt: string | null } | null;
  knownConflict: { conflictCode: string } | null;
};

export function evaluateLinkExternalIdentityAuthority(input: LinkExternalIdentityAuthorityInput): AuthorityDecision {
  if (!input.customerId) {
    return { status: "denied", reasonCode: "customer_id_required" };
  }

  if (!input.waId || !input.inboundWaId || input.waId !== input.inboundWaId) {
    return { status: "denied", reasonCode: "wa_id_not_controlled_by_channel" };
  }

  if (!input.consent?.granted) {
    return { status: "requires_consent", consentType: "link_external_identity" };
  }

  const requiredFields: string[] = [];
  if (!input.consent.messageId) requiredFields.push("messageId");
  if (!input.consent.capturedAt) requiredFields.push("capturedAt");
  if (requiredFields.length > 0) {
    return { status: "missing_information", requiredFields };
  }

  if (input.knownConflict) {
    return { status: "denied", reasonCode: "link_conflict" };
  }

  return { status: "allowed" };
}

// -----------------------------------------------------------------------
// record_customer_interest (contract section 6)
// -----------------------------------------------------------------------

export const CUSTOMER_INTEREST_TIERS = ["operational_context", "persistent_customer_interest", "proactive_followup"] as const;
export type CustomerInterestTier = (typeof CUSTOMER_INTEREST_TIERS)[number];

export type CustomerInterestAuthorityInput = {
  requestedTier: CustomerInterestTier;
  customerId: string | null;
  provisionalIdentityId: string | null;
  consent: { storeInterest: boolean; allowFollowUp: boolean };
  hasKnownConflict: boolean;
};

export function evaluateCustomerInterestAuthority(input: CustomerInterestAuthorityInput): AuthorityDecision {
  // operational_context never needs a customer or consent - it can live in
  // the conversation/opportunity (contract section 6).
  if (input.requestedTier === "operational_context") {
    return { status: "allowed" };
  }

  // persistent_customer_interest and proactive_followup both require an
  // actual resolved customer - a provisional identity is not enough to
  // persist beyond the conversation/opportunity.
  if (!input.customerId) {
    return { status: "denied", reasonCode: "customer_id_required_for_persistent_interest" };
  }

  // A known conflict never resolves via the persistent tiers - the interest
  // can only remain provisional (operational_context stays available).
  if (input.hasKnownConflict) {
    return { status: "denied", reasonCode: "resolution_conflict" };
  }

  if (!input.consent.storeInterest) {
    return { status: "requires_consent", consentType: "store_interest" };
  }

  if (input.requestedTier === "persistent_customer_interest") {
    return { status: "allowed" };
  }

  // proactive_followup: storage consent is not enough on its own - contacting
  // the customer proactively requires its own, separate authorization.
  if (!input.consent.allowFollowUp) {
    return { status: "requires_consent", consentType: "allow_follow_up" };
  }

  return { status: "allowed" };
}
