import type { CustomerOnboardingState } from "@/lib/domains/customer-onboarding";
import type { CustomerResolutionEvidence } from "@/lib/domains/customer-service";

// ACS-R1-04-T06. Canonical contracts:
// docs/data/customer-onboarding-identity-contract.md
// docs/data/customer-creation-linking-authority-contract.md
//
// Two distinct representations on purpose (task section 4):
// - NativeCustomerSessionExecutionContext: server-side only. Carries every
//   trusted value the Gateway capability adapters need (trusted inbound,
//   fresh resolution evidence, per-turn consent). Never serialized whole to
//   a planner/LLM/response provider.
// - CustomerSessionDecisionContext: the minimized, allowlisted view handed
//   to both runtimes' planning inputs. No customerId, no PII, no timestamps,
//   no consent text, no candidate counts, no internal codes.

export type CustomerIdentityStatus = "anonymous" | "identification_required" | "identified" | "conflict" | "temporarily_unavailable";

export type CustomerIdentitySource = "none" | "external_identity" | "normalized_phone" | "customer_service" | "customer_created" | "onboarding_state";

export type CustomerSessionAccess = "none" | "commercial_history" | "validated_entity";

export type TrustedInboundIdentity = {
  channel: "whatsapp";
  externalId: string;
  normalizedPhone: string;
  messageId: string;
  receivedAt: string;
};

export type ConsentScope = "create_customer" | "link_external_identity";

export type ConsentEvidence = {
  scope: ConsentScope;
  messageId: string;
  capturedAt: string;
  source: "current_inbound";
};

// Server-side execution context. This is what Gateway capability adapters
// read (via CapabilityGatewayContext.trustedCustomerSession) to assemble
// create_customer/link_external_identity inputs - never the LLM's own
// arguments (task section 16).
export type NativeCustomerSessionExecutionContext = {
  conversationId: string;
  opportunityId: string | null;

  trustedInbound: TrustedInboundIdentity;

  identity: {
    status: CustomerIdentityStatus;
    customerId: string | null;
    source: CustomerIdentitySource;
    localResolutionOutcome: string;
    externalResolutionOutcome: string | null;
  };

  onboarding: CustomerOnboardingState | null;

  contextAccess: CustomerSessionAccess;

  currentTurnConsent: {
    createCustomer: ConsentEvidence | null;
    linkExternalIdentity: ConsentEvidence | null;
  };

  // Fresh resolve_customer evidence from THIS turn only (never persisted,
  // never reused across turns) - the only acceptable input to
  // evaluateCreateCustomerAuthority's resolutionEvidence (contract section 8:
  // absence or staleness never equals no_match).
  freshExternalResolutionEvidence: CustomerResolutionEvidence | null;
};

export const CUSTOMER_SESSION_DECISION_CONTEXT_SCHEMA_VERSION = "1.0.0" as const;

export type CustomerSessionOnboardingDecisionView = {
  status: CustomerOnboardingState["status"];
  purpose: CustomerOnboardingState["purpose"];
  pendingFields: string[];
  collected: {
    firstNameAvailable: boolean;
    lastNameAvailable: boolean;
    emailAvailable: boolean;
    orderReferenceAvailable: boolean;
  };
  failedVerificationAttempts: number;
};

// The only representation ever handed to a planner/LLM/response provider.
// Prohibited (task section 4): customerId, email, phone, wa_id, externalId,
// order reference, collected names, messageId, consent text, resolution
// timestamps, candidate ids/counts, internal customer codes, SQL errors,
// stack traces, raw HTTP responses, full onboarding state, payloads, free
// metadata.
export type CustomerSessionDecisionContext = {
  schemaVersion: typeof CUSTOMER_SESSION_DECISION_CONTEXT_SCHEMA_VERSION;

  identity: {
    status: CustomerIdentityStatus;
    hasResolvedCustomer: boolean;
    source: CustomerIdentitySource;
  };

  onboarding: CustomerSessionOnboardingDecisionView | null;

  contextAccess: CustomerSessionAccess;

  operations: {
    canAttemptResolve: boolean;
    canProposeCreateCustomer: boolean;
    canProposeLinkExternalIdentity: boolean;
  };
};

export type ResolvedNativeCustomerSession = {
  execution: NativeCustomerSessionExecutionContext;
  decision: CustomerSessionDecisionContext;
  warnings: string[];
};
