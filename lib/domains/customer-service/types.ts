// External Customer Service boundary for ACS-R1-04-T04.1.
// Canonical contract: docs/data/customer-creation-linking-authority-contract.md
// (schema version 1.0.2). This module only declares the data shapes for
// resolve_customer / create_customer / link_external_identity /
// record_customer_interest. It does not implement policy or transport - see
// authority-policy.ts and ../../integrations/customer-service/http-adapter.ts.
//
// resolve_customer here is intentionally a distinct model from
// lib/domains/customer-identity (T02/T02.1): that module resolves the local,
// provisional session identity (identified/identification_required/...)
// against customer_external_identity. This module models the external
// Customer Service boundary itself (resolved/no_match/...), per the
// contract's section 1. Neither replaces the other; T04.1 does not connect
// this port to the runtime (see index.ts header note).

export type CustomerServiceChannel = "whatsapp";

// -----------------------------------------------------------------------
// resolve_customer
// -----------------------------------------------------------------------

export type ResolveCustomerInput = {
  channel: CustomerServiceChannel;
  externalId: string;
  phoneNumber?: string | null;
  email?: string | null;
};

export type ResolveCustomerResult =
  | { status: "resolved"; customerId: string }
  | { status: "no_match" }
  | { status: "conflict"; conflictCode: string }
  | { status: "invalid_input"; fields: string[] }
  | { status: "temporarily_unavailable"; retryable: boolean };

// Internal-only evidence the create_customer policy trusts. Never built from
// a string/boolean the LLM asserts (e.g. "customerDoesNotExist: true") -
// only from an actual resolveCustomer call result (contract section 8).
export type CustomerResolutionEvidence = {
  source: "customer_service";
  requestId: string;
  checkedAt: string;
  result: ResolveCustomerResult;
};

// -----------------------------------------------------------------------
// create_customer
// -----------------------------------------------------------------------

export const CREATE_CUSTOMER_ALLOWED_PURPOSES = ["quote", "purchase", "checkout", "account_request"] as const;
export type CreateCustomerCommercialPurpose = (typeof CREATE_CUSTOMER_ALLOWED_PURPOSES)[number];

export type CreateCustomerInput = {
  firstName: string;
  lastName?: string | null;
  email: string;
  phoneNumber: string;

  origin: {
    channel: CustomerServiceChannel;
    externalId: string;
  };

  commercialPurpose: CreateCustomerCommercialPurpose;

  consent: {
    createCustomer: true;
    messageId: string;
    capturedAt: string;
  };

  idempotencyKey: string;
};

// Schema v1.0.2 adds invalid_input/failed (contract section 3) so Customer
// Service failures never get silently reinterpreted as one of the other
// outcomes.
export type CreateCustomerResult =
  | { status: "created"; customerId: string }
  | { status: "matched_existing"; customerId: string }
  | { status: "missing_information"; requiredFields: string[] }
  | { status: "conflict"; conflictCode: string }
  | { status: "denied"; reason: string }
  | { status: "invalid_input"; fields: string[] }
  | { status: "temporarily_unavailable"; retryable: boolean }
  | { status: "failed"; code: string; retryable: boolean };

// -----------------------------------------------------------------------
// link_external_identity
// -----------------------------------------------------------------------

export type LinkExternalIdentityInput = {
  customerId: string;

  externalIdentity: {
    provider: CustomerServiceChannel;
    externalId: string;
    normalizedPhone: string;
  };

  consent: {
    granted: true;
    messageId: string;
    capturedAt: string;
  };

  idempotencyKey: string;
};

// Schema v1.0.2 adds invalid_input/failed (contract section 3).
export type LinkExternalIdentityResult =
  | { status: "completed"; customerId: string; externalIdentityId: string }
  | { status: "already_linked"; customerId: string; externalIdentityId: string }
  | { status: "conflict"; conflictCode: string }
  | { status: "denied"; reason: string }
  | { status: "invalid_input"; fields: string[] }
  | { status: "temporarily_unavailable"; retryable: boolean }
  | { status: "failed"; code: string; retryable: boolean };

// -----------------------------------------------------------------------
// record_customer_interest (contract section 6). Policy and types only in
// T04.1 - no persistence, no scheduling. See authority-policy.ts.
// -----------------------------------------------------------------------

export type RecordCustomerInterestInput = {
  customerId: string | null;
  provisionalIdentityId: string | null;
  conversationId: string;
  opportunityId: string | null;

  subject: {
    productId?: string;
    category?: string;
    searchTerm?: string;
    need?: string;
  };

  consent: {
    storeInterest: boolean;
    allowFollowUp: boolean;
    messageId: string | null;
    capturedAt: string | null;
  };

  observedAt: string;
};
