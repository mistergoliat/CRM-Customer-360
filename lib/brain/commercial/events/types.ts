export const COMMERCIAL_EVENT_CONTRACT_NAME = "CommercialEvent" as const;
export const COMMERCIAL_EVENT_SCHEMA_VERSION = "1.0" as const;

export type CommercialEventType =
  | "customer_message_received"
  | "outbound_message_queued"
  | "outbound_message_sent"
  | "outbound_message_delivered"
  | "outbound_message_read"
  | "outbound_message_failed"
  | "follow_up_due"
  | "human_takeover_started"
  | "human_takeover_released"
  | "internal_command_completed"
  | "internal_command_failed"
  // ACS-R1-04-T07. Identity/onboarding audit trail - descriptive evidence
  // only, never authoritative (docs/releases/ACS-R1-04-customer-identity-onboarding.md T07).
  | "customer_identity_resolution_recorded"
  | "customer_onboarding_transition_recorded"
  | "customer_identity_capability_outcome_recorded"
  | "customer_session_warning_recorded";

export type CommercialEventSource = "meta_whatsapp" | "system_timer" | "internal_command" | "human_operator";

// ACS-R1-04-T07 payload shapes. Deliberately local literal unions (not
// imported from lib/domains/* or capability-gateway/*) so this leaf module
// never depends on the identity/onboarding domain layer - mirrors the
// existing pattern in this file (e.g. the inline "sent"|"delivered"|...
// status union above), and avoids a possible import cycle back from events/
// into native-cycle/customer-session (which already imports from events/).

export type CustomerIdentityResolutionPhase = "pre_plan" | "post_plan";
export type CustomerIdentityResolver = "local" | "customer_service";
export type CustomerIdentityResolutionOutcome = "identified" | "no_match" | "conflict" | "invalid_input" | "temporarily_unavailable";
export type CustomerIdentityResolutionMatchedBy = "external_identity" | "normalized_phone" | "customer_service" | "onboarding_state" | "none";

export type CustomerIdentityResolutionRecordedPayload = {
  phase: CustomerIdentityResolutionPhase;
  resolver: CustomerIdentityResolver;
  outcome: CustomerIdentityResolutionOutcome;
  matchedBy: CustomerIdentityResolutionMatchedBy;
  hasResolvedCustomer: boolean;
};

export const CUSTOMER_ONBOARDING_TRANSITION_OPERATIONS = [
  "start",
  "collect_fields",
  "mark_resolving",
  "complete",
  "mark_conflict",
  "mark_temporarily_unavailable",
  "retry_resolution",
  "record_verification_failure"
] as const;
export type CustomerOnboardingTransitionOperation = (typeof CUSTOMER_ONBOARDING_TRANSITION_OPERATIONS)[number];

export type CustomerOnboardingTransitionRecordedPayload = {
  operation: CustomerOnboardingTransitionOperation;
  purpose: string;
  previousStatus: string | null;
  nextStatus: string;
  previousVersion: number | null;
  nextVersion: number;
  pendingFields: string[];
  collectedAvailability: {
    firstName: boolean;
    lastName: boolean;
    email: boolean;
    orderReference: boolean;
  };
  hasResolvedCustomer: boolean;
};

export type CustomerIdentityCapabilityName = "resolve_customer" | "create_customer" | "link_external_identity";

export type CustomerIdentityCapabilityOutcomeRecordedPayload = {
  capability: CustomerIdentityCapabilityName;
  executionPublicId: string | null;
  gatewayStatus: string;
  businessOutcome: string;
  retryable: boolean;
  stableErrorCode: string | null;
};

export type CustomerSessionWarningRecordedPayload = {
  warningCode: string;
  phase: CustomerIdentityResolutionPhase;
  executionPublicId: string | null;
};

export interface CommercialEventV1 {
  contractName: typeof COMMERCIAL_EVENT_CONTRACT_NAME;
  schemaVersion: typeof COMMERCIAL_EVENT_SCHEMA_VERSION;

  id: string;
  eventType: CommercialEventType;
  source: CommercialEventSource;

  sourceEventId: string | null;
  dedupeKey: string;

  correlationId: string;
  causationId: string | null;

  customerId: string | null;
  conversationId: string | null;
  opportunityId: string | null;

  channel: string | null;
  provider: string | null;

  occurredAt: string;
  receivedAt: string;

  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export type CommercialEventPersistStatus = "created" | "duplicate";

export type CommercialEventPersistResult =
  | { ok: true; status: "created"; event: CommercialEventV1 }
  | { ok: true; status: "duplicate"; event: CommercialEventV1 }
  | { ok: false; status: "error"; event: null; warning: string };
