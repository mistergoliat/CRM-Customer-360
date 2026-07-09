import { createSqlCustomerOnboardingRepository } from "./repository";
import type { CustomerOnboardingStoragePort, OnboardingUpdateResult } from "./ports";
import type {
  CollectFieldsInput,
  CompleteOnboardingInput,
  CustomerOnboardingCollectedData,
  CustomerOnboardingMutationResult,
  CustomerOnboardingPendingField,
  CustomerOnboardingService,
  CustomerOnboardingState,
  MarkConflictInput,
  MarkResolvingInput,
  MarkTemporarilyUnavailableInput,
  RecordVerificationFailureInput,
  RetryResolutionInput,
  StartOnboardingInput
} from "./types";

// Owns every transition of CustomerOnboardingState (contract section 11).
// The repository only stores what it is told; every rule about which
// transition is legal, which fields are allowed, and how they are
// normalized lives here. There is no generic "saveAnyState" escape hatch -
// each exported operation corresponds to exactly one contract transition.

const CANONICAL_FIELD_ORDER: CustomerOnboardingPendingField[] = ["firstName", "lastName", "email", "orderReference"];
const ALLOWED_COLLECTED_KEYS = new Set<string>(CANONICAL_FIELD_ORDER);

const COLLECT_FROM: CustomerOnboardingState["status"][] = ["required", "collecting", "conflict"];
const RESOLVE_FROM: CustomerOnboardingState["status"][] = ["required", "collecting"];
const COMPLETE_FROM: CustomerOnboardingState["status"][] = ["resolving"];
const CONFLICT_FROM: CustomerOnboardingState["status"][] = ["resolving"];
const UNAVAILABLE_FROM: CustomerOnboardingState["status"][] = ["resolving"];
const RETRY_FROM: CustomerOnboardingState["status"][] = ["temporarily_unavailable"];
const VERIFICATION_FAILURE_FROM: CustomerOnboardingState["status"][] = ["resolving"];
const MAX_VERIFICATION_ATTEMPTS = 3;

function normalizeTextField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmailField(value: unknown): string | null {
  const trimmed = normalizeTextField(value);
  return trimmed ? trimmed.toLowerCase() : null;
}

function normalizeCollectedPatch(
  patch: Partial<Record<string, unknown>>
): { ok: true; data: CustomerOnboardingCollectedData } | { ok: false; error: string } {
  const keys = Object.keys(patch ?? {});
  for (const key of keys) {
    if (!ALLOWED_COLLECTED_KEYS.has(key)) {
      return { ok: false, error: `unknown_collected_field:${key}` };
    }
  }

  const data: CustomerOnboardingCollectedData = {};
  const firstName = normalizeTextField(patch.firstName);
  if (firstName) data.firstName = firstName;
  const lastName = normalizeTextField(patch.lastName);
  if (lastName) data.lastName = lastName;
  const email = normalizeEmailField(patch.email);
  if (email) data.email = email;
  const orderReference = normalizeTextField(patch.orderReference);
  if (orderReference) data.orderReference = orderReference;

  return { ok: true, data };
}

function mergeCollected(
  existing: CustomerOnboardingCollectedData,
  patch: CustomerOnboardingCollectedData
): CustomerOnboardingCollectedData {
  return { ...existing, ...patch };
}

function normalizePendingFields(fields: string[]): CustomerOnboardingPendingField[] {
  const allowed = new Set<string>(CANONICAL_FIELD_ORDER);
  const present = new Set(fields.filter((field) => allowed.has(field)));
  return CANONICAL_FIELD_ORDER.filter((field) => present.has(field));
}

function versionConflict(): CustomerOnboardingMutationResult {
  return { ok: false, status: "onboarding_state_version_conflict", error: "onboarding_state_version_conflict" };
}

function notFound(): CustomerOnboardingMutationResult {
  return { ok: false, status: "not_found", error: "onboarding_state_not_found" };
}

function invalidTransition(fromStatus: string, operation: string): CustomerOnboardingMutationResult {
  return { ok: false, status: "invalid_transition", error: `invalid_transition:${operation}:${fromStatus}` };
}

function toMutationResult(result: OnboardingUpdateResult): CustomerOnboardingMutationResult {
  if (result.ok) return { ok: true, status: "updated", state: result.row };
  if (result.reason === "version_conflict") return versionConflict();
  if (result.reason === "not_found") return notFound();
  return { ok: false, status: "error", error: result.error ?? "onboarding_state_update_failed" };
}

export function createCustomerOnboardingService(
  dependencies: { port?: CustomerOnboardingStoragePort } = {}
): CustomerOnboardingService {
  const port = dependencies.port ?? createSqlCustomerOnboardingRepository();

  async function loadForTransition(
    conversationId: string,
    expectedVersion: number
  ): Promise<{ ok: true; row: CustomerOnboardingState } | { ok: false; result: CustomerOnboardingMutationResult }> {
    const existing = await port.findByConversationId(conversationId);
    if (!existing.ok) return { ok: false, result: { ok: false, status: "error", error: existing.error } };
    if (!existing.row) return { ok: false, result: notFound() };
    if (existing.row.version !== expectedVersion) return { ok: false, result: versionConflict() };
    return { ok: true, row: existing.row };
  }

  return {
    async getState(conversationId: string): Promise<CustomerOnboardingState | null> {
      const existing = await port.findByConversationId(conversationId);
      if (!existing.ok) return null;
      return existing.row;
    },

    async startOnboarding(input: StartOnboardingInput): Promise<CustomerOnboardingMutationResult> {
      if (!input.conversationId) {
        return { ok: false, status: "invalid_input", error: "missing_conversation_id" };
      }

      const pendingFields = normalizePendingFields(input.pendingFields ?? []);
      const existing = await port.findByConversationId(input.conversationId);
      if (!existing.ok) return { ok: false, status: "error", error: existing.error };

      if (existing.row) {
        if (existing.row.purpose === input.purpose) {
          return { ok: true, status: "unchanged", state: existing.row };
        }
        return { ok: false, status: "purpose_conflict", error: "onboarding_state_purpose_conflict" };
      }

      const inserted = await port.insert({
        conversationId: input.conversationId,
        opportunityId: input.opportunityId ?? null,
        status: "required",
        purpose: input.purpose,
        collected: {},
        pendingFields,
        customerId: null,
        failedVerificationAttempts: 0
      });

      if (inserted.ok) {
        return { ok: true, status: "created", state: inserted.row };
      }

      if (inserted.reason === "duplicate") {
        const reloaded = await port.findByConversationId(input.conversationId);
        if (reloaded.ok && reloaded.row) {
          if (reloaded.row.purpose === input.purpose) {
            return { ok: true, status: "unchanged", state: reloaded.row };
          }
          return { ok: false, status: "purpose_conflict", error: "onboarding_state_purpose_conflict" };
        }
      }

      return { ok: false, status: "error", error: inserted.error };
    },

    async collectFields(input: CollectFieldsInput): Promise<CustomerOnboardingMutationResult> {
      const normalizedPatch = normalizeCollectedPatch(input.collectedPatch ?? {});
      if (!normalizedPatch.ok) {
        return { ok: false, status: "invalid_input", error: normalizedPatch.error };
      }

      const loaded = await loadForTransition(input.conversationId, input.expectedVersion);
      if (!loaded.ok) return loaded.result;
      if (!COLLECT_FROM.includes(loaded.row.status)) {
        return invalidTransition(loaded.row.status, "collectFields");
      }

      const mergedCollected = mergeCollected(loaded.row.collected, normalizedPatch.data);
      const pendingFields = normalizePendingFields(input.pendingFields ?? []);

      const updated = await port.updateWithVersion(input.conversationId, input.expectedVersion, {
        status: "collecting",
        collected: mergedCollected,
        pendingFields
      });
      return toMutationResult(updated);
    },

    async markResolving(input: MarkResolvingInput): Promise<CustomerOnboardingMutationResult> {
      const loaded = await loadForTransition(input.conversationId, input.expectedVersion);
      if (!loaded.ok) return loaded.result;
      if (!RESOLVE_FROM.includes(loaded.row.status)) {
        return invalidTransition(loaded.row.status, "markResolving");
      }

      const updated = await port.updateWithVersion(input.conversationId, input.expectedVersion, { status: "resolving" });
      return toMutationResult(updated);
    },

    async completeOnboarding(input: CompleteOnboardingInput): Promise<CustomerOnboardingMutationResult> {
      const customerId = normalizeTextField(input.customerId);
      if (!customerId) {
        return { ok: false, status: "invalid_input", error: "missing_customer_id" };
      }

      const existing = await port.findByConversationId(input.conversationId);
      if (!existing.ok) return { ok: false, status: "error", error: existing.error };
      if (!existing.row) return notFound();

      if (existing.row.status === "completed") {
        if (existing.row.customerId === customerId) {
          return { ok: true, status: "unchanged", state: existing.row };
        }
        return { ok: false, status: "customer_conflict", error: "onboarding_state_customer_conflict" };
      }

      if (existing.row.version !== input.expectedVersion) return versionConflict();
      if (!COMPLETE_FROM.includes(existing.row.status)) {
        return invalidTransition(existing.row.status, "completeOnboarding");
      }

      const updated = await port.updateWithVersion(input.conversationId, input.expectedVersion, {
        status: "completed",
        customerId,
        pendingFields: [],
        completedAt: new Date().toISOString()
      });
      return toMutationResult(updated);
    },

    async markConflict(input: MarkConflictInput): Promise<CustomerOnboardingMutationResult> {
      const loaded = await loadForTransition(input.conversationId, input.expectedVersion);
      if (!loaded.ok) return loaded.result;
      if (!CONFLICT_FROM.includes(loaded.row.status)) {
        return invalidTransition(loaded.row.status, "markConflict");
      }

      const updated = await port.updateWithVersion(input.conversationId, input.expectedVersion, {
        status: "conflict",
        customerId: null
      });
      return toMutationResult(updated);
    },

    async markTemporarilyUnavailable(input: MarkTemporarilyUnavailableInput): Promise<CustomerOnboardingMutationResult> {
      const loaded = await loadForTransition(input.conversationId, input.expectedVersion);
      if (!loaded.ok) return loaded.result;
      if (!UNAVAILABLE_FROM.includes(loaded.row.status)) {
        return invalidTransition(loaded.row.status, "markTemporarilyUnavailable");
      }

      const updated = await port.updateWithVersion(input.conversationId, input.expectedVersion, {
        status: "temporarily_unavailable"
      });
      return toMutationResult(updated);
    },

    async retryResolution(input: RetryResolutionInput): Promise<CustomerOnboardingMutationResult> {
      const loaded = await loadForTransition(input.conversationId, input.expectedVersion);
      if (!loaded.ok) return loaded.result;
      if (!RETRY_FROM.includes(loaded.row.status)) {
        return invalidTransition(loaded.row.status, "retryResolution");
      }

      const updated = await port.updateWithVersion(input.conversationId, input.expectedVersion, { status: "resolving" });
      return toMutationResult(updated);
    },

    async recordVerificationFailure(input: RecordVerificationFailureInput): Promise<CustomerOnboardingMutationResult> {
      const loaded = await loadForTransition(input.conversationId, input.expectedVersion);
      if (!loaded.ok) return loaded.result;
      if (!VERIFICATION_FAILURE_FROM.includes(loaded.row.status)) {
        return invalidTransition(loaded.row.status, "recordVerificationFailure");
      }

      const nextAttempts = loaded.row.failedVerificationAttempts + 1;
      const updated = await port.updateWithVersion(input.conversationId, input.expectedVersion, {
        failedVerificationAttempts: nextAttempts,
        ...(nextAttempts >= MAX_VERIFICATION_ATTEMPTS ? { status: "temporarily_blocked" as const } : {})
      });
      return toMutationResult(updated);
    }
  };
}

const defaultService = createCustomerOnboardingService();

export const getState = defaultService.getState;
export const startOnboarding = defaultService.startOnboarding;
export const collectFields = defaultService.collectFields;
export const markResolving = defaultService.markResolving;
export const completeOnboarding = defaultService.completeOnboarding;
export const markConflict = defaultService.markConflict;
export const markTemporarilyUnavailable = defaultService.markTemporarilyUnavailable;
export const retryResolution = defaultService.retryResolution;
export const recordVerificationFailure = defaultService.recordVerificationFailure;
