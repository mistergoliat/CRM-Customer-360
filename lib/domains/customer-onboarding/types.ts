// Canonical multi-turn customer onboarding state for ACS-R1-04-T03.
// Canonical contract: docs/data/customer-onboarding-identity-contract.md
// (section 11, CustomerOnboardingState). This module only persists and
// transitions that state. It does not read inbound messages, does not call
// the LLM, does not touch the Capability Gateway or Customer 360, and never
// creates or links customers itself.

export type CustomerOnboardingStatus =
  | "required"
  | "collecting"
  | "resolving"
  | "completed"
  | "conflict"
  | "temporarily_blocked"
  | "temporarily_unavailable";

// "not_required" from the contract's CustomerSessionIdentityStatus-adjacent
// status union is intentionally not part of this persisted set: the absence
// of a row already represents "no active or required onboarding".

export type CustomerOnboardingPurpose =
  | "quote"
  | "purchase"
  | "order_inquiry"
  | "complaint"
  | "warranty"
  | "return"
  | "account_update";

export type CustomerOnboardingPendingField = "firstName" | "lastName" | "email" | "orderReference";

export interface CustomerOnboardingCollectedData {
  firstName?: string;
  lastName?: string;
  email?: string;
  orderReference?: string;
}

export type CustomerOnboardingState = {
  id: number;
  conversationId: string;
  opportunityId: string | null;
  status: CustomerOnboardingStatus;
  purpose: CustomerOnboardingPurpose;
  collected: CustomerOnboardingCollectedData;
  pendingFields: CustomerOnboardingPendingField[];
  customerId: string | null;
  failedVerificationAttempts: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type StartOnboardingInput = {
  conversationId: string;
  opportunityId?: string | null;
  purpose: CustomerOnboardingPurpose;
  pendingFields: CustomerOnboardingPendingField[];
};

export type CollectFieldsInput = {
  conversationId: string;
  expectedVersion: number;
  collectedPatch: Partial<Record<string, unknown>>;
  pendingFields: CustomerOnboardingPendingField[];
};

export type MarkResolvingInput = {
  conversationId: string;
  expectedVersion: number;
};

export type CompleteOnboardingInput = {
  conversationId: string;
  expectedVersion: number;
  customerId: string;
};

export type MarkConflictInput = {
  conversationId: string;
  expectedVersion: number;
};

export type MarkTemporarilyUnavailableInput = {
  conversationId: string;
  expectedVersion: number;
};

export type RetryResolutionInput = {
  conversationId: string;
  expectedVersion: number;
};

export type RecordVerificationFailureInput = {
  conversationId: string;
  expectedVersion: number;
};

export type CustomerOnboardingErrorReason =
  | "invalid_input"
  | "purpose_conflict"
  | "customer_conflict"
  | "invalid_transition"
  | "onboarding_state_version_conflict"
  | "not_found"
  | "error";

export type CustomerOnboardingMutationResult =
  | { ok: true; status: "created" | "updated" | "unchanged"; state: CustomerOnboardingState }
  | { ok: false; status: CustomerOnboardingErrorReason; error: string };

export type CustomerOnboardingService = {
  getState(conversationId: string): Promise<CustomerOnboardingState | null>;
  startOnboarding(input: StartOnboardingInput): Promise<CustomerOnboardingMutationResult>;
  collectFields(input: CollectFieldsInput): Promise<CustomerOnboardingMutationResult>;
  markResolving(input: MarkResolvingInput): Promise<CustomerOnboardingMutationResult>;
  completeOnboarding(input: CompleteOnboardingInput): Promise<CustomerOnboardingMutationResult>;
  markConflict(input: MarkConflictInput): Promise<CustomerOnboardingMutationResult>;
  markTemporarilyUnavailable(input: MarkTemporarilyUnavailableInput): Promise<CustomerOnboardingMutationResult>;
  retryResolution(input: RetryResolutionInput): Promise<CustomerOnboardingMutationResult>;
  recordVerificationFailure(input: RecordVerificationFailureInput): Promise<CustomerOnboardingMutationResult>;
};
