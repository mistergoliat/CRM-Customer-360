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
  | "temporarily_unavailable";

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
export interface CustomerIdentityPort {
  findCustomerByExternalIdentity(input: { provider: string; externalId: string }): Promise<CustomerIdentityLookupResult>;
  findCustomersByNormalizedPhone(input: { provider: string; normalizedPhone: string }): Promise<CustomerIdentityLookupResult>;
}

export type CustomerIdentityResolutionService = {
  resolveIdentity(input: ResolveCustomerIdentityInput): Promise<ResolveCustomerIdentityResult>;
};

export type CustomerIdentityResolutionServiceDependencies = {
  port?: CustomerIdentityPort;
};
