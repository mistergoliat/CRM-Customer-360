import type { CustomerOnboardingState } from "./types";

// Storage boundary the service depends on. It exposes only data-shaped
// primitives (read, insert-if-absent, compare-and-swap update) - it never
// decides which transitions are legal. That decision lives entirely in
// service.ts. A future Onboarding Service could implement this same port
// over HTTP instead of SQL.

export type NewOnboardingStateRow = {
  conversationId: string;
  opportunityId: string | null;
  status: CustomerOnboardingState["status"];
  purpose: CustomerOnboardingState["purpose"];
  collected: CustomerOnboardingState["collected"];
  pendingFields: CustomerOnboardingState["pendingFields"];
  customerId: string | null;
  failedVerificationAttempts: number;
};

export type OnboardingStateUpdatePatch = Partial<{
  status: CustomerOnboardingState["status"];
  collected: CustomerOnboardingState["collected"];
  pendingFields: CustomerOnboardingState["pendingFields"];
  customerId: string | null;
  failedVerificationAttempts: number;
  completedAt: string | null;
}>;

export type OnboardingFindResult =
  | { ok: true; row: CustomerOnboardingState | null }
  | { ok: false; error: string };

export type OnboardingInsertResult =
  | { ok: true; row: CustomerOnboardingState }
  | { ok: false; reason: "duplicate" | "error"; error: string };

export type OnboardingUpdateResult =
  | { ok: true; row: CustomerOnboardingState }
  | { ok: false; reason: "version_conflict" | "not_found" | "error"; error?: string };

export interface CustomerOnboardingStoragePort {
  findByConversationId(conversationId: string): Promise<OnboardingFindResult>;
  insert(row: NewOnboardingStateRow): Promise<OnboardingInsertResult>;
  updateWithVersion(conversationId: string, expectedVersion: number, patch: OnboardingStateUpdatePatch): Promise<OnboardingUpdateResult>;
}
