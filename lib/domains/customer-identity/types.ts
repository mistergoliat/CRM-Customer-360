// Read-only identity boundary for ACS-R1-04-T02.
// Canonical contract: docs/data/customer-onboarding-identity-contract.md (sections 4-6).
// This module only classifies an inbound WhatsApp identity signal against
// customer_external_identity. It never creates customers, never links
// identities, and never touches Customer 360 or order data.

export type ResolveCustomerIdentityInput = {
  channel: "whatsapp";
  externalId: string;
  phoneNumber: string | null;
};

export type CustomerIdentityMatchedBy = "external_identity" | "phone" | null;

export type CustomerIdentityConfidence = "verified" | "strong" | "insufficient";

export type CustomerIdentityResolutionStatus =
  | "identified"
  | "identification_required"
  | "conflict"
  | "temporarily_unavailable"
  | "invalid_input";

export type CustomerIdentityConflictType = "external_identity_vs_phone" | "phone_ambiguous";

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
};

export type CustomerIdentityLookupResult =
  | { ok: true; candidateCustomerIds: string[] }
  | { ok: false; error: string };

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
}

export type CustomerIdentityResolutionService = {
  resolveIdentity(input: ResolveCustomerIdentityInput): Promise<ResolveCustomerIdentityResult>;
};

export type CustomerIdentityResolutionServiceDependencies = {
  port?: CustomerIdentityPort;
};
