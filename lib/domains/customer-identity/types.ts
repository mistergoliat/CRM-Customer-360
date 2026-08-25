// Read-only identity boundary for ACS-R1-04-T02.
// Canonical contract: docs/data/customer-onboarding-identity-contract.md (sections 4-6).
// This module only classifies an inbound WhatsApp identity signal against
// customer_external_identity. It never creates customers, never links
// identities, and never touches Customer 360 or order data.

export type ResolveCustomerIdentityInput = {
  channel: "whatsapp";
  externalId: string;
  phoneNumber: string | null;
  // ID-R2-A02: optional candidate-discovery signals. Backward compatible -
  // every existing caller omits these and gets byte-identical behavior to
  // the wa_id/phone-only resolver (see evidence.ts, applyIdentityEvidence).
  email?: string | null;
  orderReference?: string | null;
};

export type CustomerIdentityMatchedBy = "external_identity" | "phone" | null;

export type CustomerIdentityConfidence = "verified" | "strong" | "insufficient";

export type CustomerIdentityResolutionStatus =
  | "identified"
  | "identification_required"
  | "conflict"
  | "temporarily_unavailable"
  | "invalid_input";

export type CustomerIdentityConflictType =
  | "external_identity_vs_phone"
  | "phone_ambiguous"
  | "prestashop_link_vs_wa_phone"
  | "prestashop_id_multi_master"
  | "email_vs_order_prestashop_id";

// Internal-only: candidateCustomerIds are opaque backend ids for audit.
// Never forward this shape to the LLM or the end customer (contract section 12).
export type CustomerIdentityConflict = {
  type: CustomerIdentityConflictType;
  candidateCustomerIds: string[];
};

export type ResolveCustomerIdentityResult = {
  status: CustomerIdentityResolutionStatus;
  customerId: string | null;
  matchedBy: CustomerIdentityMatchedBy;
  confidence: CustomerIdentityConfidence;
  conflicts: CustomerIdentityConflict[];
  warnings: string[];
  // ID-R2-A02: additive and optional so pre-existing fixtures/fakes across
  // the test suite keep compiling untouched - the real service always
  // populates it. Maps the wa_id/phone-only path onto the richer
  // vocabulary too, so a consumer never has to branch on whether
  // email/orderReference were supplied. Never widens `status` above:
  // PrestaShop/email/order evidence can only escalate `status` to
  // "conflict" (see evidence.ts, Rule 2), never to "identified" - identity
  // adjudication for a *new* master stays with Customer Service.
  detail?: IdentityResolutionDetail;
};

export type CustomerIdentityLookupResult =
  | { ok: true; candidateCustomerIds: string[] }
  | { ok: false; error: string };

export type PrestashopCandidateLookupResult =
  | { ok: true; candidatePrestashopCustomerIds: string[] }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// ID-R2-A02: Identity Evidence Contract (in-memory only, PARTE 3/21 of the
// task spec - not persisted, no new table). One entry per signal considered
// during a single resolveIdentity() call. Never carries raw PII: email/phone
// values themselves are never placed on an evidence entry, only the derived
// ids the signal resolved to.
// ---------------------------------------------------------------------------

export type IdentitySignalType = "wa_id" | "phone" | "email" | "prestashop_customer_id" | "order_reference";

export type IdentityEvidenceSource = "customer_external_identity" | "prestashop" | "order";

// observed: signal seen, not yet resolved to any candidate.
// candidate: resolved to exactly one candidate, ownership not proven.
// strong: phone/wa_id-class signal, proven at the channel-link level.
// verified: two independent signals converged on the same id.
// conflict: this signal contradicts another signal in the same call.
export type IdentityEvidenceStrength = "observed" | "candidate" | "strong" | "verified" | "conflict";

export type IdentityEvidence = {
  signalType: IdentitySignalType;
  source: IdentityEvidenceSource;
  strength: IdentityEvidenceStrength;
  masterCustomerId?: string;
  prestashopCustomerId?: string;
  verified: boolean;
  observedAt: string;
};

// PARTE 2: richer internal vocabulary. Never surfaced as the top-level
// `status` - see the ResolveCustomerIdentityResult comment above.
export type IdentityResolutionDetailStatus =
  | "RESOLVED"
  | "CANDIDATE"
  | "NEEDS_VERIFICATION"
  | "AMBIGUOUS"
  | "IDENTITY_CONFLICT"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "SYSTEM_FAILURE";

export type IdentityResolutionDetail = {
  status: IdentityResolutionDetailStatus;
  // The master this signal set converged on, if any - independent of
  // whether the top-level `customerId` was allowed to reflect it (a
  // PrestaShop-linked candidate never elevates the top-level result, see
  // Rule 3 in evidence.ts).
  masterCustomerId: string | null;
  prestashopCustomerId: string | null;
  evidence: IdentityEvidence[];
  conflictCode: CustomerIdentityConflictType | null;
};

// Boundary the service depends on. The local adapter is one implementation;
// a future Customer Service could implement this same port over HTTP.
//
// findCustomerByExternalIdentity is scoped to a single provider (contract
// section 5, step 1: "provider + wa_id" exact match).
// findCustomersByNormalizedPhone is provider-agnostic on purpose (contract
// section 5, step 2: "telefono normalizado" - a historical customer may have
// their phone on file through a different channel than the one they are
// messaging from now). It may combine more than one read-only source, but
// must return candidates deduplicated by customerId.
export interface CustomerIdentityPort {
  findCustomerByExternalIdentity(input: { provider: string; externalId: string }): Promise<CustomerIdentityLookupResult>;
  findCustomersByNormalizedPhone(input: { normalizedPhone: string }): Promise<CustomerIdentityLookupResult>;
  // ID-R2-A02. PrestaShop candidate discovery - never proof of ownership.
  // The PrestaShop -> master bridge itself reuses
  // findCustomerByExternalIdentity({ provider: "prestashop", externalId })
  // above, which is already provider-agnostic (contract PARTE 6).
  findPrestashopCustomerIdsByEmail(input: { normalizedEmail: string }): Promise<PrestashopCandidateLookupResult>;
  findPrestashopCustomerIdsByOrderReference(input: { orderReference: string }): Promise<PrestashopCandidateLookupResult>;
}

export type CustomerIdentityResolutionService = {
  resolveIdentity(input: ResolveCustomerIdentityInput): Promise<ResolveCustomerIdentityResult>;
};

export type CustomerIdentityResolutionServiceDependencies = {
  port?: CustomerIdentityPort;
  now?: () => Date;
};
