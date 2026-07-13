import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveNativeCustomerSession,
  mapOperationToOnboardingPurpose,
  operationRequiresIdentity,
  mapOnboardingPurposeToCommercialPurpose
} from "@/lib/brain/commercial/native-cycle/customer-session";
import type {
  ResolveCustomerExternalFn,
  ResolveNativeCustomerSessionDependencies,
  TrustedInboundIdentity
} from "@/lib/brain/commercial/native-cycle/customer-session";
import type { CustomerIdentityResolutionService, ResolveCustomerIdentityResult } from "@/lib/domains/customer-identity";
import type {
  CustomerOnboardingMutationResult,
  CustomerOnboardingPurpose,
  CustomerOnboardingService,
  CustomerOnboardingState
} from "@/lib/domains/customer-onboarding";
import type { CustomerResolutionEvidence } from "@/lib/domains/customer-service";

// ---------------------------------------------------------------------------
// Fakes - no DB, no HTTP. resolveNativeCustomerSession is exercised purely
// through its dependency-injection seams (task section 5's contract).
// ---------------------------------------------------------------------------

const TRUSTED_INBOUND: TrustedInboundIdentity = {
  channel: "whatsapp",
  externalId: "56911112222",
  normalizedPhone: "56911112222",
  messageId: "wamid.test-1",
  receivedAt: "2026-07-09T12:00:00.000Z"
};

function identifiedResult(customerId: string, matchedBy: "external_identity" | "phone" = "external_identity"): ResolveCustomerIdentityResult {
  return { status: "identified", customerId, matchedBy, confidence: "verified", conflicts: [], warnings: [] };
}

function noMatchResult(): ResolveCustomerIdentityResult {
  return { status: "identification_required", customerId: null, matchedBy: null, confidence: "insufficient", conflicts: [], warnings: [] };
}

function conflictResult(): ResolveCustomerIdentityResult {
  return {
    status: "conflict",
    customerId: null,
    matchedBy: null,
    confidence: "insufficient",
    conflicts: [{ type: "external_identity_vs_phone", candidateCustomerIds: ["1", "2"] }],
    warnings: []
  };
}

function unavailableResult(): ResolveCustomerIdentityResult {
  return { status: "temporarily_unavailable", customerId: null, matchedBy: null, confidence: "insufficient", conflicts: [], warnings: ["db_error"] };
}

function invalidInputResult(): ResolveCustomerIdentityResult {
  return { status: "invalid_input", customerId: null, matchedBy: null, confidence: "insufficient", conflicts: [], warnings: ["invalid_external_id"] };
}

function identityServiceReturning(result: ResolveCustomerIdentityResult): CustomerIdentityResolutionService & { calls: number } {
  const fake = {
    calls: 0,
    async resolveIdentity() {
      fake.calls += 1;
      return result;
    }
  };
  return fake;
}

/** Faithful in-memory onboarding fake - mirrors the real state machine (required/collecting/resolving/completed/conflict/temporarily_unavailable), CAS included. */
function makeOnboardingFake(initial: CustomerOnboardingState | null) {
  let state = initial;
  const calls: string[] = [];
  const COLLECT_FROM = ["required", "collecting", "conflict"];
  const RESOLVE_FROM = ["required", "collecting"];

  function checkVersion(expectedVersion: number): CustomerOnboardingMutationResult | null {
    if (!state) return { ok: false, status: "not_found", error: "no onboarding row" };
    if (state.version !== expectedVersion) return { ok: false, status: "onboarding_state_version_conflict", error: "version mismatch" };
    return null;
  }

  function bump(patch: Partial<CustomerOnboardingState>): CustomerOnboardingMutationResult {
    state = { ...(state as CustomerOnboardingState), ...patch, version: (state as CustomerOnboardingState).version + 1, updatedAt: new Date().toISOString() };
    return { ok: true, status: "updated", state };
  }

  const service: CustomerOnboardingService = {
    async getState() {
      calls.push("getState");
      return state;
    },
    startOnboarding: async () => {
      throw new Error("startOnboarding must not be called by resolveNativeCustomerSession");
    },
    async collectFields(input) {
      calls.push("collectFields");
      const conflict = checkVersion(input.expectedVersion);
      if (conflict) return conflict;
      if (!COLLECT_FROM.includes((state as CustomerOnboardingState).status)) return { ok: false, status: "invalid_transition", error: "bad transition" };
      return bump({ status: "collecting", pendingFields: input.pendingFields, collected: { ...(state as CustomerOnboardingState).collected, ...input.collectedPatch } });
    },
    async markResolving(input) {
      calls.push("markResolving");
      const conflict = checkVersion(input.expectedVersion);
      if (conflict) return conflict;
      if (!RESOLVE_FROM.includes((state as CustomerOnboardingState).status)) return { ok: false, status: "invalid_transition", error: "bad transition" };
      return bump({ status: "resolving" });
    },
    async completeOnboarding(input) {
      calls.push("completeOnboarding");
      const conflict = checkVersion(input.expectedVersion);
      if (conflict) return conflict;
      if ((state as CustomerOnboardingState).status !== "resolving") return { ok: false, status: "invalid_transition", error: "bad transition" };
      return bump({ status: "completed", customerId: input.customerId, completedAt: new Date().toISOString() });
    },
    async markConflict(input) {
      calls.push("markConflict");
      const conflict = checkVersion(input.expectedVersion);
      if (conflict) return conflict;
      if ((state as CustomerOnboardingState).status !== "resolving") return { ok: false, status: "invalid_transition", error: "bad transition" };
      return bump({ status: "conflict" });
    },
    async markTemporarilyUnavailable(input) {
      calls.push("markTemporarilyUnavailable");
      const conflict = checkVersion(input.expectedVersion);
      if (conflict) return conflict;
      if ((state as CustomerOnboardingState).status !== "resolving") return { ok: false, status: "invalid_transition", error: "bad transition" };
      return bump({ status: "temporarily_unavailable" });
    },
    retryResolution: async () => {
      throw new Error("retryResolution must not be called by resolveNativeCustomerSession");
    },
    recordVerificationFailure: async () => {
      throw new Error("recordVerificationFailure must not be called by resolveNativeCustomerSession");
    }
  };

  return { service, calls, getState: () => state };
}

function onboardingRow(overrides: Partial<CustomerOnboardingState> = {}): CustomerOnboardingState {
  return {
    id: 1,
    conversationId: "conv-1",
    opportunityId: null,
    status: "required",
    purpose: "quote",
    collected: {},
    pendingFields: ["firstName", "email"],
    customerId: null,
    failedVerificationAttempts: 0,
    version: 1,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    completedAt: null,
    ...overrides
  };
}

function resolvedEvidence(customerMasterId: string): CustomerResolutionEvidence {
  return { source: "customer_service", requestId: "req-1", checkedAt: "2026-07-09T12:00:01.000Z", result: { status: "resolved", customerMasterId } };
}
function noMatchEvidence(): CustomerResolutionEvidence {
  return { source: "customer_service", requestId: "req-2", checkedAt: "2026-07-09T12:00:01.000Z", result: { status: "no_match" } };
}
function conflictEvidence(): CustomerResolutionEvidence {
  return { source: "customer_service", requestId: "req-3", checkedAt: "2026-07-09T12:00:01.000Z", result: { status: "conflict", conflictCode: "multiple_candidates" } };
}
function unavailableEvidence(): CustomerResolutionEvidence {
  return { source: "customer_service", requestId: "req-4", checkedAt: "2026-07-09T12:00:01.000Z", result: { status: "temporarily_unavailable", retryable: true } };
}

// ACS-R1-04-T08.1: no DB in this file (see header comment) - default every
// call to a projection reader that reports every customerMasterId as
// locally projected, since this file's own concern is resolveNativeCustomerSession's
// resolution/reconciliation logic, not the projection gate itself. Individual
// tests may still override dependencies.projectionReader explicitly.
const ALWAYS_VERIFIED_PROJECTION_READER = { async exists() { return true; } };

function baseInput(overrides: {
  conversationId?: string;
  messageText?: string;
  priorConversationCustomerId?: string | null;
  dependencies?: ResolveNativeCustomerSessionDependencies;
} = {}) {
  return {
    conversationId: overrides.conversationId ?? "conv-1",
    opportunityId: null,
    trustedInbound: TRUSTED_INBOUND,
    messageText: overrides.messageText ?? "Hola, tengo una consulta",
    correlationId: "corr-1",
    priorConversationCustomerId: overrides.priorConversationCustomerId ?? null,
    dependencies: { projectionReader: ALWAYS_VERIFIED_PROJECTION_READER, ...overrides.dependencies }
  };
}

// ---------------------------------------------------------------------------
// Group 1: sesion e identidad local (1-10)
// ---------------------------------------------------------------------------

test("1: exact provider+externalId match identifies the customer with source external_identity", async () => {
  const onboarding = makeOnboardingFake(null);
  const result = await resolveNativeCustomerSession(
    baseInput({ dependencies: { identityService: identityServiceReturning(identifiedResult("100", "external_identity")), onboardingService: onboarding.service } })
  );
  assert.equal(result.execution.identity.status, "identified");
  assert.equal(result.execution.identity.customerId, "100");
  assert.equal(result.execution.identity.source, "external_identity");
});

test("2: a normalized-phone cross-provider match identifies the customer with source normalized_phone", async () => {
  const onboarding = makeOnboardingFake(null);
  const result = await resolveNativeCustomerSession(
    baseInput({ dependencies: { identityService: identityServiceReturning(identifiedResult("200", "phone")), onboardingService: onboarding.service } })
  );
  assert.equal(result.execution.identity.status, "identified");
  assert.equal(result.execution.identity.source, "normalized_phone");
});

test("3: local identity resolution runs at most once per inbound", async () => {
  const identity = identityServiceReturning(noMatchResult());
  await resolveNativeCustomerSession(baseInput({ dependencies: { identityService: identity, onboardingService: makeOnboardingFake(null).service } }));
  assert.equal(identity.calls, 1);
});

test("4: no local match and no active onboarding leaves identity anonymous - a public query never requires onboarding", async () => {
  const result = await resolveNativeCustomerSession(
    baseInput({ dependencies: { identityService: identityServiceReturning(noMatchResult()), onboardingService: makeOnboardingFake(null).service } })
  );
  assert.equal(result.execution.identity.status, "anonymous");
  assert.equal(result.decision.operations.canProposeCreateCustomer, false);
});

test("5: no local match with active onboarding requiring identity yields identification_required", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "required" }));
  const result = await resolveNativeCustomerSession(
    baseInput({ dependencies: { identityService: identityServiceReturning(noMatchResult()), onboardingService: onboarding.service, resolveCustomerExternal: async () => noMatchEvidence() } })
  );
  assert.equal(result.execution.identity.status, "identification_required");
});

test("6: a local conflict lands identity in conflict with no customerId and the structured warning", async () => {
  const onboarding = makeOnboardingFake(null);
  const result = await resolveNativeCustomerSession(
    baseInput({ dependencies: { identityService: identityServiceReturning(conflictResult()), onboardingService: onboarding.service } })
  );
  assert.equal(result.execution.identity.status, "conflict");
  assert.equal(result.execution.identity.customerId, null);
  assert.ok(result.warnings.includes("customer_identity_conflict"));
});

test("7: a local technical failure (temporarily_unavailable) never becomes a business state", async () => {
  const onboarding = makeOnboardingFake(null);
  const result = await resolveNativeCustomerSession(
    baseInput({ dependencies: { identityService: identityServiceReturning(unavailableResult()), onboardingService: onboarding.service } })
  );
  assert.equal(result.execution.identity.status, "temporarily_unavailable");
  assert.ok(result.warnings.includes("customer_identity_unavailable"));
});

test("8: invalid_input is distinct from unavailable but still maps to a technical (non-business) identity status", async () => {
  const onboarding = makeOnboardingFake(null);
  const result = await resolveNativeCustomerSession(
    baseInput({ dependencies: { identityService: identityServiceReturning(invalidInputResult()), onboardingService: onboarding.service } })
  );
  assert.equal(result.execution.identity.status, "temporarily_unavailable");
  assert.ok(result.warnings.includes("customer_identity_invalid_input"));
  assert.ok(!result.warnings.includes("customer_identity_unavailable"));
});

test("9: a fresh identification contradicting the prior conversation's customer never auto-selects a side - it becomes conflict", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "collecting" }));
  const result = await resolveNativeCustomerSession(
    baseInput({
      priorConversationCustomerId: "999",
      dependencies: { identityService: identityServiceReturning(identifiedResult("100")), onboardingService: onboarding.service }
    })
  );
  assert.equal(result.execution.identity.status, "conflict");
  assert.ok(result.warnings.includes("customer_identity_conflict"));
  assert.equal(onboarding.getState()?.status, "conflict");
});

test("10: onboarding already completed with a customerId that agrees with local resolution stays identified, never re-resolved", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "completed", customerId: "100", completedAt: "2026-07-01T00:00:00.000Z" }));
  const result = await resolveNativeCustomerSession(
    baseInput({ dependencies: { identityService: identityServiceReturning(identifiedResult("100")), onboardingService: onboarding.service } })
  );
  assert.equal(result.execution.identity.status, "identified");
  assert.equal(result.execution.identity.customerId, "100");
  // Already completed - no markResolving/completeOnboarding re-invocation.
  assert.ok(!onboarding.calls.includes("markResolving"));
  assert.ok(!onboarding.calls.includes("completeOnboarding"));
});

// ---------------------------------------------------------------------------
// Group 2: resolucion externa (11-20)
// ---------------------------------------------------------------------------

test("11: with no override injected, external resolution still goes through the Capability Gateway and fails closed (never fabricates resolved/no_match)", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "required" }));
  const result = await resolveNativeCustomerSession(
    baseInput({ dependencies: { identityService: identityServiceReturning(noMatchResult()), onboardingService: onboarding.service } })
  );
  assert.equal(result.execution.identity.externalResolutionOutcome, "temporarily_unavailable");
  assert.equal(result.execution.identity.status, "temporarily_unavailable");
});

test("12: external resolution fires when onboarding is required and local resolution found no match; no_match leaves it untouched", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "required" }));
  let externalCalls = 0;
  const resolveCustomerExternal: ResolveCustomerExternalFn = async () => {
    externalCalls += 1;
    return noMatchEvidence();
  };
  const result = await resolveNativeCustomerSession(
    baseInput({ dependencies: { identityService: identityServiceReturning(noMatchResult()), onboardingService: onboarding.service, resolveCustomerExternal } })
  );
  assert.equal(externalCalls, 1);
  assert.equal(result.execution.identity.status, "identification_required");
  assert.equal(onboarding.getState()?.status, "required", "no_match never mutates onboarding");
});

test("13: external resolution fires when onboarding is collecting", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "collecting" }));
  let externalCalls = 0;
  const result = await resolveNativeCustomerSession(
    baseInput({
      dependencies: {
        identityService: identityServiceReturning(noMatchResult()),
        onboardingService: onboarding.service,
        resolveCustomerExternal: async () => {
          externalCalls += 1;
          return noMatchEvidence();
        }
      }
    })
  );
  assert.equal(externalCalls, 1);
  assert.equal(result.execution.identity.status, "identification_required");
});

test("14: external resolution never fires for a public query without active onboarding", async () => {
  let externalCalls = 0;
  const result = await resolveNativeCustomerSession(
    baseInput({
      dependencies: {
        identityService: identityServiceReturning(noMatchResult()),
        onboardingService: makeOnboardingFake(null).service,
        resolveCustomerExternal: async () => {
          externalCalls += 1;
          return noMatchEvidence();
        }
      }
    })
  );
  assert.equal(externalCalls, 0);
  assert.equal(result.execution.identity.status, "anonymous");
});

test("15: external resolution never fires after a local conflict", async () => {
  let externalCalls = 0;
  const onboarding = makeOnboardingFake(onboardingRow({ status: "required" }));
  await resolveNativeCustomerSession(
    baseInput({
      dependencies: {
        identityService: identityServiceReturning(conflictResult()),
        onboardingService: onboarding.service,
        resolveCustomerExternal: async () => {
          externalCalls += 1;
          return noMatchEvidence();
        }
      }
    })
  );
  assert.equal(externalCalls, 0);
});

test("16: external resolution never fires as a fallback from a local technical failure", async () => {
  let externalCalls = 0;
  const onboarding = makeOnboardingFake(onboardingRow({ status: "required" }));
  await resolveNativeCustomerSession(
    baseInput({
      dependencies: {
        identityService: identityServiceReturning(unavailableResult()),
        onboardingService: onboarding.service,
        resolveCustomerExternal: async () => {
          externalCalls += 1;
          return noMatchEvidence();
        }
      }
    })
  );
  assert.equal(externalCalls, 0, "a technical failure never silently retries via the external boundary");
});

test("17: external resolution never fires when the customer is already identified locally", async () => {
  let externalCalls = 0;
  const onboarding = makeOnboardingFake(onboardingRow({ status: "required" }));
  await resolveNativeCustomerSession(
    baseInput({
      dependencies: {
        identityService: identityServiceReturning(identifiedResult("100")),
        onboardingService: onboarding.service,
        resolveCustomerExternal: async () => {
          externalCalls += 1;
          return noMatchEvidence();
        }
      }
    })
  );
  assert.equal(externalCalls, 0);
});

test("18: external resolved evidence identifies the customer (source customer_service) and completes onboarding with that customerId", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "required" }));
  const result = await resolveNativeCustomerSession(
    baseInput({
      dependencies: { identityService: identityServiceReturning(noMatchResult()), onboardingService: onboarding.service, resolveCustomerExternal: async () => resolvedEvidence("300") }
    })
  );
  assert.equal(result.execution.identity.status, "identified");
  assert.equal(result.execution.identity.customerId, "300");
  assert.equal(result.execution.identity.source, "customer_service");
  assert.equal(onboarding.getState()?.status, "completed");
  assert.equal(onboarding.getState()?.customerId, "300");
  assert.deepEqual(onboarding.calls.filter((c) => c === "markResolving" || c === "completeOnboarding"), ["markResolving", "completeOnboarding"]);
});

test("19: external conflict evidence lands identity and onboarding in conflict, never picking a candidate", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "required" }));
  const result = await resolveNativeCustomerSession(
    baseInput({
      dependencies: { identityService: identityServiceReturning(noMatchResult()), onboardingService: onboarding.service, resolveCustomerExternal: async () => conflictEvidence() }
    })
  );
  assert.equal(result.execution.identity.status, "conflict");
  assert.equal(result.execution.identity.customerId, null);
  assert.ok(result.warnings.includes("customer_identity_conflict"));
  assert.equal(onboarding.getState()?.status, "conflict");
});

test("20: external temporarily_unavailable evidence degrades identity and onboarding safely, never to no_match", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "required" }));
  const result = await resolveNativeCustomerSession(
    baseInput({
      dependencies: { identityService: identityServiceReturning(noMatchResult()), onboardingService: onboarding.service, resolveCustomerExternal: async () => unavailableEvidence() }
    })
  );
  assert.equal(result.execution.identity.status, "temporarily_unavailable");
  assert.ok(result.warnings.includes("customer_service_unavailable"));
  assert.equal(onboarding.getState()?.status, "temporarily_unavailable");
});

// ---------------------------------------------------------------------------
// Group 3: onboarding (21-31)
// ---------------------------------------------------------------------------

test("21: operations outside the allowlist never activate onboarding (general query, search, price, comparison)", () => {
  for (const operation of ["general_question", "product_information", "price_check", "product_comparison", "technical_explanation", "availability_check"]) {
    assert.equal(mapOperationToOnboardingPurpose(operation), null, operation);
    assert.equal(operationRequiresIdentity(operation), false, operation);
  }
});

test("22: the operation -> onboarding purpose mapping is centralized and covers every allowed purpose family", () => {
  assert.equal(mapOperationToOnboardingPurpose("product_quote"), "quote");
  assert.equal(mapOperationToOnboardingPurpose("maintenance_quote"), "quote");
  assert.equal(mapOperationToOnboardingPurpose("order_status"), "order_inquiry");
  assert.equal(mapOperationToOnboardingPurpose("complaint"), "complaint");
  assert.equal(mapOperationToOnboardingPurpose("warranty"), "warranty");
  assert.equal(mapOperationToOnboardingPurpose("create_customer"), "account_update");
  assert.equal(mapOperationToOnboardingPurpose("link_external_identity"), "account_update");
});

test("23: local resolution alone (no external call) also closes out an open onboarding - not only the external branch", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "collecting" }));
  const result = await resolveNativeCustomerSession(
    baseInput({ dependencies: { identityService: identityServiceReturning(identifiedResult("400")), onboardingService: onboarding.service } })
  );
  assert.equal(result.execution.onboarding?.status, "completed");
  assert.equal(result.execution.onboarding?.customerId, "400");
});

test("24: a still-unresolved onboarding stays in its own status untouched (never force-progressed) when identity can't be resolved", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "collecting", pendingFields: ["email"] }));
  const result = await resolveNativeCustomerSession(
    baseInput({
      dependencies: { identityService: identityServiceReturning(noMatchResult()), onboardingService: onboarding.service, resolveCustomerExternal: async () => noMatchEvidence() }
    })
  );
  assert.equal(result.execution.onboarding?.status, "collecting");
  assert.deepEqual(result.decision.onboarding?.pendingFields, ["email"]);
});

test("25: an already-conflict onboarding is never reinitiated by a fresh local conflict", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "conflict" }));
  await resolveNativeCustomerSession(baseInput({ dependencies: { identityService: identityServiceReturning(conflictResult()), onboardingService: onboarding.service } }));
  assert.ok(!onboarding.calls.includes("markResolving"), "an already-terminal state is never re-landed");
});

test("26: an already-temporarily_blocked onboarding surfaces its structured warning without being restarted", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "temporarily_blocked", failedVerificationAttempts: 3 }));
  const result = await resolveNativeCustomerSession(
    baseInput({ dependencies: { identityService: identityServiceReturning(noMatchResult()), onboardingService: onboarding.service } })
  );
  assert.ok(result.warnings.includes("customer_onboarding_temporarily_blocked"));
  assert.ok(!onboarding.calls.includes("markResolving"));
});

test("27: a version conflict while landing a terminal state surfaces the structured warning, never a raw error", async () => {
  const row = onboardingRow({ status: "collecting" });
  const onboarding = makeOnboardingFake(row);
  // Force a CAS mismatch: bump the fake's internal version out from under this call.
  const staleService: CustomerOnboardingService = {
    ...onboarding.service,
    async getState() {
      return row;
    }
  };
  await onboarding.service.collectFields({ conversationId: row.conversationId, expectedVersion: row.version, collectedPatch: {}, pendingFields: [] });
  const result = await resolveNativeCustomerSession(
    baseInput({ dependencies: { identityService: identityServiceReturning(conflictResult()), onboardingService: staleService } })
  );
  assert.ok(result.warnings.includes("customer_onboarding_version_conflict"));
});

test("28: onboarding purpose stays whatever was already active - resolveNativeCustomerSession never changes purpose itself", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "required", purpose: "warranty" }));
  const result = await resolveNativeCustomerSession(
    baseInput({ dependencies: { identityService: identityServiceReturning(noMatchResult()), onboardingService: onboarding.service, resolveCustomerExternal: async () => noMatchEvidence() } })
  );
  assert.equal(result.decision.onboarding?.purpose, "warranty");
});

test("29: onboarding is loaded exactly once per inbound (single getState call)", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "required" }));
  await resolveNativeCustomerSession(
    baseInput({ dependencies: { identityService: identityServiceReturning(noMatchResult()), onboardingService: onboarding.service, resolveCustomerExternal: async () => noMatchEvidence() } })
  );
  assert.equal(onboarding.calls.filter((c) => c === "getState").length, 1);
});

test("30: no onboarding row at all (null) never crashes and never fabricates one", async () => {
  const result = await resolveNativeCustomerSession(
    baseInput({ dependencies: { identityService: identityServiceReturning(identifiedResult("500")), onboardingService: makeOnboardingFake(null).service } })
  );
  assert.equal(result.execution.onboarding, null);
  assert.equal(result.decision.onboarding, null);
});

test("31: mapOnboardingPurposeToCommercialPurpose only maps quote/purchase/account_update - historical purposes map to null (create_customer must deny them)", () => {
  assert.equal(mapOnboardingPurposeToCommercialPurpose("quote"), "quote");
  assert.equal(mapOnboardingPurposeToCommercialPurpose("purchase"), "purchase");
  assert.equal(mapOnboardingPurposeToCommercialPurpose("account_update"), "account_request");
  for (const purpose of ["order_inquiry", "complaint", "warranty", "return"] as CustomerOnboardingPurpose[]) {
    assert.equal(mapOnboardingPurposeToCommercialPurpose(purpose), null, purpose);
  }
  assert.equal(mapOnboardingPurposeToCommercialPurpose(null), null);
});

// ---------------------------------------------------------------------------
// Group 4: contexto para el modelo (32-42)
// ---------------------------------------------------------------------------

test("32: the decision context carries the fixed schemaVersion", async () => {
  const result = await resolveNativeCustomerSession(
    baseInput({ dependencies: { identityService: identityServiceReturning(noMatchResult()), onboardingService: makeOnboardingFake(null).service } })
  );
  assert.equal(result.decision.schemaVersion, "1.0.0");
});

test("33: the decision context never carries a customerId field anywhere in its shape", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "required" }));
  const result = await resolveNativeCustomerSession(
    baseInput({ dependencies: { identityService: identityServiceReturning(identifiedResult("600")), onboardingService: onboarding.service } })
  );
  const serialized = JSON.stringify(result.decision);
  assert.doesNotMatch(serialized, /"customerId"/);
  assert.doesNotMatch(serialized, /\b600\b/);
});

test("34: the decision context never carries PII - no email/phone/waId/externalId/messageId/order reference", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "collecting", collected: { firstName: "Ana", email: "ana@example.com", orderReference: "ORD-1" } }));
  const result = await resolveNativeCustomerSession(
    baseInput({ dependencies: { identityService: identityServiceReturning(noMatchResult()), onboardingService: onboarding.service, resolveCustomerExternal: async () => noMatchEvidence() } })
  );
  const serialized = JSON.stringify(result.decision);
  assert.doesNotMatch(serialized, /ana@example\.com/);
  assert.doesNotMatch(serialized, /Ana/);
  assert.doesNotMatch(serialized, /ORD-1/);
  assert.doesNotMatch(serialized, /56911112222/);
  assert.doesNotMatch(serialized, /wamid\./);
});

test("35: the decision context's collected fields are booleans only, never the values themselves", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "collecting", collected: { firstName: "Ana", email: "ana@example.com" } }));
  const result = await resolveNativeCustomerSession(
    baseInput({ dependencies: { identityService: identityServiceReturning(noMatchResult()), onboardingService: onboarding.service, resolveCustomerExternal: async () => noMatchEvidence() } })
  );
  assert.equal(result.decision.onboarding?.collected.firstNameAvailable, true);
  assert.equal(result.decision.onboarding?.collected.emailAvailable, true);
  assert.equal(result.decision.onboarding?.collected.lastNameAvailable, false);
  assert.equal(result.decision.onboarding?.collected.orderReferenceAvailable, false);
});

test("36: hasResolvedCustomer reflects resolution without exposing which customer", async () => {
  const identified = await resolveNativeCustomerSession(
    baseInput({ dependencies: { identityService: identityServiceReturning(identifiedResult("700")), onboardingService: makeOnboardingFake(null).service } })
  );
  const anonymous = await resolveNativeCustomerSession(
    baseInput({ conversationId: "conv-2", dependencies: { identityService: identityServiceReturning(noMatchResult()), onboardingService: makeOnboardingFake(null).service } })
  );
  assert.equal(identified.decision.identity.hasResolvedCustomer, true);
  assert.equal(anonymous.decision.identity.hasResolvedCustomer, false);
});

test("37: operations.canAttemptResolve is true only while identification_required", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "required" }));
  const result = await resolveNativeCustomerSession(
    baseInput({ dependencies: { identityService: identityServiceReturning(noMatchResult()), onboardingService: onboarding.service, resolveCustomerExternal: async () => noMatchEvidence() } })
  );
  assert.equal(result.decision.operations.canAttemptResolve, true);
});

test("38: operations.canProposeCreateCustomer is false once identified - create_customer is only for identification_required", async () => {
  const result = await resolveNativeCustomerSession(
    baseInput({ dependencies: { identityService: identityServiceReturning(identifiedResult("800")), onboardingService: makeOnboardingFake(null).service } })
  );
  assert.equal(result.decision.operations.canProposeCreateCustomer, false);
});

test("39: operations.canProposeLinkExternalIdentity is true only once identified", async () => {
  const identified = await resolveNativeCustomerSession(
    baseInput({ dependencies: { identityService: identityServiceReturning(identifiedResult("900")), onboardingService: makeOnboardingFake(null).service } })
  );
  const anonymous = await resolveNativeCustomerSession(
    baseInput({ conversationId: "conv-3", dependencies: { identityService: identityServiceReturning(noMatchResult()), onboardingService: makeOnboardingFake(null).service } })
  );
  assert.equal(identified.decision.operations.canProposeLinkExternalIdentity, true);
  assert.equal(anonymous.decision.operations.canProposeLinkExternalIdentity, false);
});

test("40: the execution context (server-side only) does carry the customerId and trusted inbound - the two representations are genuinely different shapes", async () => {
  const result = await resolveNativeCustomerSession(
    baseInput({ dependencies: { identityService: identityServiceReturning(identifiedResult("1000")), onboardingService: makeOnboardingFake(null).service } })
  );
  assert.equal(result.execution.identity.customerId, "1000");
  assert.equal(result.execution.trustedInbound.externalId, TRUSTED_INBOUND.externalId);
  assert.ok(!("customerId" in result.decision.identity));
});

test("41: contextAccess is echoed identically on both the execution and decision contexts", async () => {
  const onboarding = makeOnboardingFake(onboardingRow({ status: "required", purpose: "quote" }));
  const result = await resolveNativeCustomerSession(
    baseInput({ dependencies: { identityService: identityServiceReturning(identifiedResult("1100")), onboardingService: onboarding.service } })
  );
  assert.equal(result.execution.contextAccess, result.decision.contextAccess);
});

test("42: consecutive calls with an unrelated message never leak consent across turns - decision context has no consent field at all", async () => {
  const result = await resolveNativeCustomerSession(
    baseInput({ messageText: "autorizo crear mi ficha de cliente", dependencies: { identityService: identityServiceReturning(noMatchResult()), onboardingService: makeOnboardingFake(null).service } })
  );
  assert.doesNotMatch(JSON.stringify(result.decision), /consent/i);
  assert.doesNotMatch(JSON.stringify(result.decision), /autorizo/i);
});
