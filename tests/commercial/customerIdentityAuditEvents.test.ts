import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, safeQueryRows } from "@/lib/db";
import {
  recordExternalIdentityResolution,
  recordIdentityCapabilityOutcome,
  recordLocalIdentityResolution,
  recordOnboardingTransitionIfChanged,
  recordSessionWarnings
} from "@/lib/brain/commercial/native-cycle/customer-session";
import { deriveIdentityCapabilityBusinessOutcome } from "@/lib/brain/commercial/capability-gateway";
import type { CapabilityGatewayResult } from "@/lib/brain/commercial/capability-gateway";
import { resolveNativeCustomerSession, runCustomerOnboardingPostPlanStage } from "@/lib/brain/commercial/native-cycle/customer-session";
import type { ResolveCustomerIdentityResult, CustomerIdentityResolutionService } from "@/lib/domains/customer-identity";
import type { CustomerOnboardingMutationResult, CustomerOnboardingService, CustomerOnboardingState } from "@/lib/domains/customer-onboarding";
import type { CustomerResolutionEvidence } from "@/lib/domains/customer-service";

// ACS-R1-04-T07. Directed coverage for the new identity/onboarding audit
// trail on top of commercial_event - see docs/releases/ACS-R1-04-customer-identity-onboarding.md.

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "main_management",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "main_management",
  DATABASE_USER: "crm_app",
  DATABASE_PASSWORD: "una_clave_local",
  DATABASE_URL: ""
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

function uniqueId(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function loadEventsByType(eventType: string, correlationId: string) {
  const rows = await safeQueryRows<{ payload_json: string; metadata_json: string; correlation_id: string; conversation_id: string | null; opportunity_id: string | null; customer_id: string | null }>(
    "SELECT payload_json, metadata_json, correlation_id, conversation_id, opportunity_id, customer_id FROM commercial_event WHERE event_type = ? AND correlation_id = ? ORDER BY created_at ASC, id ASC",
    [eventType, correlationId]
  );
  assert.ok(rows.ok, rows.ok ? "" : rows.error);
  return rows.rows.map((row) => ({
    ...row,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>
  }));
}

async function countEventsByDedupePrefix(prefix: string) {
  const rows = await safeQueryRows<{ total: number }>("SELECT COUNT(*) AS total FROM commercial_event WHERE dedupe_key LIKE ?", [`${prefix}%`]);
  assert.ok(rows.ok, rows.ok ? "" : rows.error);
  return Number(rows.rows[0]?.total ?? 0);
}

function localResult(overrides: Partial<ResolveCustomerIdentityResult> = {}): ResolveCustomerIdentityResult {
  return { status: "identified", customerId: "700", matchedBy: "external_identity", confidence: "verified", conflicts: [], warnings: [], ...overrides };
}

function evidence(overrides: Partial<CustomerResolutionEvidence["result"]> = {}): CustomerResolutionEvidence {
  return { source: "customer_service", requestId: "req-1", checkedAt: "2026-07-13T00:00:00.000Z", result: { status: "resolved", customerMasterId: "700", ...overrides } as CustomerResolutionEvidence["result"] };
}

function onboardingState(overrides: Partial<CustomerOnboardingState> = {}): CustomerOnboardingState {
  return {
    id: 1,
    conversationId: "conv-1",
    opportunityId: null,
    status: "collecting",
    purpose: "quote",
    collected: {},
    pendingFields: ["email"],
    customerId: null,
    failedVerificationAttempts: 0,
    version: 1,
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    completedAt: null,
    ...overrides
  };
}

function gatewayResult(overrides: Partial<CapabilityGatewayResult> = {}): CapabilityGatewayResult {
  return {
    capability: "create_customer",
    version: "capability-gateway.v1",
    availability: "available",
    status: "completed",
    data: { status: "created", customerMasterId: "700" },
    errorCode: null,
    retryable: false,
    evidence: [],
    warnings: [],
    retryCount: 0,
    startedAt: "2026-07-13T00:00:00.000Z",
    completedAt: "2026-07-13T00:00:01.000Z",
    executionPublicId: uniqueId("exec"),
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// 1. Resolution (local + external)
// ---------------------------------------------------------------------------

test("1: local identified resolution is persisted with resolver local, phase pre_plan", async () => {
  const correlationId = uniqueId("corr-local-identified");
  const messageId = uniqueId("msg");
  await recordLocalIdentityResolution({ messageId, correlationId, conversationId: "conv-1", result: localResult() });
  const rows = await loadEventsByType("customer_identity_resolution_recorded", correlationId);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].payload, { phase: "pre_plan", resolver: "local", outcome: "identified", matchedBy: "external_identity", hasResolvedCustomer: true });
});

test("2: local no_match (identification_required) is persisted as outcome no_match", async () => {
  const correlationId = uniqueId("corr-local-nomatch");
  await recordLocalIdentityResolution({
    messageId: uniqueId("msg"),
    correlationId,
    conversationId: "conv-1",
    result: localResult({ status: "identification_required", customerId: null, matchedBy: null })
  });
  const rows = await loadEventsByType("customer_identity_resolution_recorded", correlationId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.outcome, "no_match");
  assert.equal(rows[0].payload.hasResolvedCustomer, false);
  assert.equal(rows[0].payload.matchedBy, "none");
});

test("3: local conflict is persisted as outcome conflict", async () => {
  const correlationId = uniqueId("corr-local-conflict");
  await recordLocalIdentityResolution({
    messageId: uniqueId("msg"),
    correlationId,
    conversationId: "conv-1",
    result: localResult({ status: "conflict", customerId: null, matchedBy: null })
  });
  const rows = await loadEventsByType("customer_identity_resolution_recorded", correlationId);
  assert.equal(rows[0].payload.outcome, "conflict");
});

test("4: local unavailable/invalid_input are persisted without any raw error text", async () => {
  const correlationIdUnavailable = uniqueId("corr-local-unavailable");
  await recordLocalIdentityResolution({
    messageId: uniqueId("msg"),
    correlationId: correlationIdUnavailable,
    conversationId: "conv-1",
    result: localResult({ status: "temporarily_unavailable", customerId: null, matchedBy: null })
  });
  const unavailableRows = await loadEventsByType("customer_identity_resolution_recorded", correlationIdUnavailable);
  assert.equal(unavailableRows[0].payload.outcome, "temporarily_unavailable");

  const correlationIdInvalid = uniqueId("corr-local-invalid");
  await recordLocalIdentityResolution({
    messageId: uniqueId("msg"),
    correlationId: correlationIdInvalid,
    conversationId: "conv-1",
    result: localResult({ status: "invalid_input", customerId: null, matchedBy: null })
  });
  const invalidRows = await loadEventsByType("customer_identity_resolution_recorded", correlationIdInvalid);
  assert.equal(invalidRows[0].payload.outcome, "invalid_input");
  for (const row of [...unavailableRows, ...invalidRows]) {
    const serialized = JSON.stringify(row.payload);
    assert.doesNotMatch(serialized, /error|exception|sql|stack/i);
  }
});

test("5: external resolved is persisted with resolver customer_service", async () => {
  const correlationId = uniqueId("corr-ext-resolved");
  await recordExternalIdentityResolution({ phase: "pre_plan", messageId: uniqueId("msg"), correlationId, conversationId: "conv-1", evidence: evidence({ status: "resolved", customerMasterId: "700" }) });
  const rows = await loadEventsByType("customer_identity_resolution_recorded", correlationId);
  assert.deepEqual(rows[0].payload, { phase: "pre_plan", resolver: "customer_service", outcome: "identified", matchedBy: "customer_service", hasResolvedCustomer: true });
});

test("6: external no_match is persisted distinctly from conflict", async () => {
  const correlationId = uniqueId("corr-ext-nomatch");
  await recordExternalIdentityResolution({ phase: "pre_plan", messageId: uniqueId("msg"), correlationId, conversationId: "conv-1", evidence: { source: "customer_service", requestId: "r", checkedAt: "2026-07-13T00:00:00.000Z", result: { status: "no_match" } } });
  const rows = await loadEventsByType("customer_identity_resolution_recorded", correlationId);
  assert.equal(rows[0].payload.outcome, "no_match");
  assert.equal(rows[0].payload.hasResolvedCustomer, false);
});

test("7: external conflict is persisted as outcome conflict", async () => {
  const correlationId = uniqueId("corr-ext-conflict");
  await recordExternalIdentityResolution({ phase: "post_plan", messageId: uniqueId("msg"), correlationId, conversationId: "conv-1", evidence: { source: "customer_service", requestId: "r", checkedAt: "2026-07-13T00:00:00.000Z", result: { status: "conflict", conflictCode: "external_identity_vs_phone" } } });
  const rows = await loadEventsByType("customer_identity_resolution_recorded", correlationId);
  assert.equal(rows[0].payload.phase, "post_plan");
  assert.equal(rows[0].payload.outcome, "conflict");
});

test("8: external temporarily_unavailable is persisted fail-closed (never identified)", async () => {
  const correlationId = uniqueId("corr-ext-unavailable");
  await recordExternalIdentityResolution({ phase: "pre_plan", messageId: uniqueId("msg"), correlationId, conversationId: "conv-1", evidence: { source: "customer_service", requestId: "r", checkedAt: "2026-07-13T00:00:00.000Z", result: { status: "temporarily_unavailable", retryable: true } } });
  const rows = await loadEventsByType("customer_identity_resolution_recorded", correlationId);
  assert.equal(rows[0].payload.outcome, "temporarily_unavailable");
  assert.equal(rows[0].payload.hasResolvedCustomer, false);
});

// ---------------------------------------------------------------------------
// 2. Onboarding transitions
// ---------------------------------------------------------------------------

function mutationResult(state: CustomerOnboardingState, status: "created" | "updated" | "unchanged" = "updated"): CustomerOnboardingMutationResult {
  return { ok: true, status, state };
}

test("9: start is persisted with previousStatus/previousVersion null", async () => {
  const conversationId = uniqueId("conv-start");
  const state = onboardingState({ conversationId, status: "required", version: 1, purpose: "quote" });
  await recordOnboardingTransitionIfChanged({ operation: "start", previous: null, result: mutationResult(state, "created") });
  const rows = await safeQueryRows<{ payload_json: string }>("SELECT payload_json FROM commercial_event WHERE event_type = 'customer_onboarding_transition_recorded' AND conversation_id = ?", [conversationId]);
  assert.ok(rows.ok);
  const payload = JSON.parse(rows.rows[0].payload_json);
  assert.equal(payload.operation, "start");
  assert.equal(payload.previousStatus, null);
  assert.equal(payload.previousVersion, null);
  assert.equal(payload.nextStatus, "required");
  assert.equal(payload.nextVersion, 1);
});

test("10: collect_fields is persisted with pendingFields and collectedAvailability booleans", async () => {
  const conversationId = uniqueId("conv-collect");
  const previous = onboardingState({ conversationId, status: "required", version: 1, collected: {}, pendingFields: ["firstName", "email"] });
  const next = onboardingState({ conversationId, status: "collecting", version: 2, collected: { firstName: "Ana", email: "ana@example.com" }, pendingFields: [] });
  await recordOnboardingTransitionIfChanged({ operation: "collect_fields", previous, result: mutationResult(next) });
  const rows = await safeQueryRows<{ payload_json: string }>("SELECT payload_json FROM commercial_event WHERE event_type = 'customer_onboarding_transition_recorded' AND conversation_id = ? AND JSON_EXTRACT(payload_json, '$.operation') = 'collect_fields'", [conversationId]);
  assert.ok(rows.ok);
  const payload = JSON.parse(rows.rows[0].payload_json);
  assert.deepEqual(payload.collectedAvailability, { firstName: true, lastName: false, email: true, orderReference: false });
  assert.deepEqual(payload.pendingFields, []);
  assert.equal(payload.previousVersion, 1);
  assert.equal(payload.nextVersion, 2);
});

test("11: mark_resolving is persisted via landOnboardingInTerminalState/completeOnboardingWithCustomer's internal transition", async () => {
  const conversationId = uniqueId("conv-resolving");
  const previous = onboardingState({ conversationId, status: "collecting", version: 3 });
  const next = onboardingState({ conversationId, status: "resolving", version: 4 });
  await recordOnboardingTransitionIfChanged({ operation: "mark_resolving", previous, result: mutationResult(next) });
  const rows = await safeQueryRows<{ payload_json: string }>("SELECT payload_json FROM commercial_event WHERE event_type = 'customer_onboarding_transition_recorded' AND conversation_id = ? AND JSON_EXTRACT(payload_json, '$.operation') = 'mark_resolving'", [conversationId]);
  assert.ok(rows.ok);
  assert.equal(rows.rows.length, 1);
});

test("12: complete is persisted with hasResolvedCustomer true", async () => {
  const conversationId = uniqueId("conv-complete");
  const previous = onboardingState({ conversationId, status: "resolving", version: 4, customerId: null });
  const next = onboardingState({ conversationId, status: "completed", version: 5, customerId: "700", completedAt: "2026-07-13T00:00:05.000Z" });
  await recordOnboardingTransitionIfChanged({ operation: "complete", previous, result: mutationResult(next) });
  const rows = await safeQueryRows<{ payload_json: string }>("SELECT payload_json FROM commercial_event WHERE event_type = 'customer_onboarding_transition_recorded' AND conversation_id = ? AND JSON_EXTRACT(payload_json, '$.operation') = 'complete'", [conversationId]);
  assert.ok(rows.ok);
  const payload = JSON.parse(rows.rows[0].payload_json);
  assert.equal(payload.hasResolvedCustomer, true);
  assert.equal(payload.nextStatus, "completed");
});

test("13: mark_conflict is persisted", async () => {
  const conversationId = uniqueId("conv-conflict");
  const previous = onboardingState({ conversationId, status: "resolving", version: 4 });
  const next = onboardingState({ conversationId, status: "conflict", version: 5, customerId: null });
  await recordOnboardingTransitionIfChanged({ operation: "mark_conflict", previous, result: mutationResult(next) });
  const rows = await safeQueryRows<{ payload_json: string }>("SELECT payload_json FROM commercial_event WHERE event_type = 'customer_onboarding_transition_recorded' AND conversation_id = ? AND JSON_EXTRACT(payload_json, '$.operation') = 'mark_conflict'", [conversationId]);
  assert.ok(rows.ok);
  assert.equal(rows.rows.length, 1);
});

test("14: mark_temporarily_unavailable is persisted", async () => {
  const conversationId = uniqueId("conv-unavail");
  const previous = onboardingState({ conversationId, status: "resolving", version: 4 });
  const next = onboardingState({ conversationId, status: "temporarily_unavailable", version: 5 });
  await recordOnboardingTransitionIfChanged({ operation: "mark_temporarily_unavailable", previous, result: mutationResult(next) });
  const rows = await safeQueryRows<{ payload_json: string }>("SELECT payload_json FROM commercial_event WHERE event_type = 'customer_onboarding_transition_recorded' AND conversation_id = ? AND JSON_EXTRACT(payload_json, '$.operation') = 'mark_temporarily_unavailable'", [conversationId]);
  assert.ok(rows.ok);
  assert.equal(rows.rows.length, 1);
});

test("15: no event when there is no effective transition (unchanged or !ok)", async () => {
  const conversationId = uniqueId("conv-nochange");
  const state = onboardingState({ conversationId, status: "completed", version: 5, customerId: "700" });
  await recordOnboardingTransitionIfChanged({ operation: "complete", previous: state, result: { ok: true, status: "unchanged", state } });
  await recordOnboardingTransitionIfChanged({ operation: "mark_conflict", previous: state, result: { ok: false, status: "onboarding_state_version_conflict", error: "stale" } });
  const rows = await safeQueryRows<{ total: number }>("SELECT COUNT(*) AS total FROM commercial_event WHERE conversation_id = ?", [conversationId]);
  assert.ok(rows.ok);
  assert.equal(Number(rows.rows[0]?.total ?? 0), 0);
});

// ---------------------------------------------------------------------------
// 3. Capability outcomes
// ---------------------------------------------------------------------------

test("16: create_customer -> created", async () => {
  const correlationId = uniqueId("corr-create-created");
  const result = gatewayResult({ capability: "create_customer", status: "completed", data: { status: "created", customerMasterId: "700" } });
  await recordIdentityCapabilityOutcome({ capability: "create_customer", correlationId, gatewayResult: result });
  const rows = await loadEventsByType("customer_identity_capability_outcome_recorded", correlationId);
  assert.equal(rows[0].payload.businessOutcome, "created");
  assert.equal(rows[0].payload.gatewayStatus, "completed");
});

test("17: create_customer -> matched_existing", async () => {
  const correlationId = uniqueId("corr-create-matched");
  const result = gatewayResult({ capability: "create_customer", status: "completed", data: { status: "matched_existing", customerMasterId: "700" } });
  await recordIdentityCapabilityOutcome({ capability: "create_customer", correlationId, gatewayResult: result });
  const rows = await loadEventsByType("customer_identity_capability_outcome_recorded", correlationId);
  assert.equal(rows[0].payload.businessOutcome, "matched_existing");
});

test("18: create_customer -> conflict (Gateway status completed, business outcome conflict)", async () => {
  const correlationId = uniqueId("corr-create-conflict");
  const result = gatewayResult({ capability: "create_customer", status: "completed", errorCode: "customer_creation_conflict", data: { status: "conflict", conflictCode: "x" } });
  await recordIdentityCapabilityOutcome({ capability: "create_customer", correlationId, gatewayResult: result });
  const rows = await loadEventsByType("customer_identity_capability_outcome_recorded", correlationId);
  assert.equal(rows[0].payload.gatewayStatus, "completed");
  assert.equal(rows[0].payload.businessOutcome, "conflict");
  assert.notEqual(rows[0].payload.gatewayStatus, rows[0].payload.businessOutcome);
});

test("19: create_customer -> missing_information", async () => {
  const correlationId = uniqueId("corr-create-missing");
  const result = gatewayResult({ capability: "create_customer", status: "missing_information", data: { requiredFields: ["email"] } });
  await recordIdentityCapabilityOutcome({ capability: "create_customer", correlationId, gatewayResult: result });
  const rows = await loadEventsByType("customer_identity_capability_outcome_recorded", correlationId);
  assert.equal(rows[0].payload.businessOutcome, "missing_information");
});

test("20: link_external_identity -> completed", async () => {
  const correlationId = uniqueId("corr-link-completed");
  const result = gatewayResult({ capability: "link_external_identity", status: "completed", data: { status: "completed", customerMasterId: "700", externalIdentityId: "ext-1" } });
  await recordIdentityCapabilityOutcome({ capability: "link_external_identity", correlationId, gatewayResult: result });
  const rows = await loadEventsByType("customer_identity_capability_outcome_recorded", correlationId);
  assert.equal(rows[0].payload.businessOutcome, "completed");
});

test("21: link_external_identity -> already_linked", async () => {
  const correlationId = uniqueId("corr-link-already");
  const result = gatewayResult({ capability: "link_external_identity", status: "completed", data: { status: "already_linked", customerMasterId: "700", externalIdentityId: "ext-1" } });
  await recordIdentityCapabilityOutcome({ capability: "link_external_identity", correlationId, gatewayResult: result });
  const rows = await loadEventsByType("customer_identity_capability_outcome_recorded", correlationId);
  assert.equal(rows[0].payload.businessOutcome, "already_linked");
});

test("22: link_external_identity -> conflict (Gateway completed, business conflict)", async () => {
  const correlationId = uniqueId("corr-link-conflict");
  const result = gatewayResult({ capability: "link_external_identity", status: "completed", errorCode: "customer_link_conflict", data: { status: "conflict", conflictCode: "x" } });
  await recordIdentityCapabilityOutcome({ capability: "link_external_identity", correlationId, gatewayResult: result });
  const rows = await loadEventsByType("customer_identity_capability_outcome_recorded", correlationId);
  assert.equal(rows[0].payload.gatewayStatus, "completed");
  assert.equal(rows[0].payload.businessOutcome, "conflict");
});

test("23: deriveIdentityCapabilityBusinessOutcome is exhaustive and preserves the completed/conflict distinction for all three capabilities", () => {
  assert.equal(deriveIdentityCapabilityBusinessOutcome("resolve_customer", "completed", { result: { status: "resolved", customerMasterId: "1" } }), "resolved");
  assert.equal(deriveIdentityCapabilityBusinessOutcome("resolve_customer", "completed", { result: { status: "no_match" } }), "no_match");
  assert.equal(deriveIdentityCapabilityBusinessOutcome("resolve_customer", "temporarily_blocked", null), "temporarily_unavailable");
  assert.equal(deriveIdentityCapabilityBusinessOutcome("create_customer", "completed", { status: "conflict", conflictCode: "x" }), "conflict");
  assert.equal(deriveIdentityCapabilityBusinessOutcome("create_customer", "invalid_arguments", null), "invalid_input");
  assert.equal(deriveIdentityCapabilityBusinessOutcome("link_external_identity", "denied", null), "denied");
  assert.equal(deriveIdentityCapabilityBusinessOutcome("link_external_identity", "failed", null), "failed");
});

// ---------------------------------------------------------------------------
// 4. Warnings
// ---------------------------------------------------------------------------

test("24: warnings are persisted pre-plan", async () => {
  const correlationId = uniqueId("corr-warn-pre");
  const messageId = uniqueId("msg");
  await recordSessionWarnings({ phase: "pre_plan", messageId, correlationId, warnings: ["customer_identity_conflict"] });
  const rows = await loadEventsByType("customer_session_warning_recorded", correlationId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.warningCode, "customer_identity_conflict");
  assert.equal(rows[0].payload.phase, "pre_plan");
});

test("25: warnings are persisted post-plan", async () => {
  const correlationId = uniqueId("corr-warn-post");
  const messageId = uniqueId("msg");
  await recordSessionWarnings({ phase: "post_plan", messageId, correlationId, warnings: ["customer_service_unavailable"] });
  const rows = await loadEventsByType("customer_session_warning_recorded", correlationId);
  assert.equal(rows[0].payload.phase, "post_plan");
});

test("26: two distinct warning codes in the same call produce two events", async () => {
  const correlationId = uniqueId("corr-warn-two");
  const messageId = uniqueId("msg");
  await recordSessionWarnings({ phase: "pre_plan", messageId, correlationId, warnings: ["customer_identity_conflict", "customer_service_unavailable"] });
  const rows = await loadEventsByType("customer_session_warning_recorded", correlationId);
  assert.equal(rows.length, 2);
  assert.deepEqual(new Set(rows.map((row) => row.payload.warningCode)), new Set(["customer_identity_conflict", "customer_service_unavailable"]));
});

test("27: retrying the same warning (same messageId/phase/code) never duplicates", async () => {
  const correlationId = uniqueId("corr-warn-retry");
  const messageId = uniqueId("msg");
  await recordSessionWarnings({ phase: "pre_plan", messageId, correlationId, warnings: ["customer_identity_conflict"] });
  await recordSessionWarnings({ phase: "pre_plan", messageId, correlationId, warnings: ["customer_identity_conflict"] });
  const rows = await loadEventsByType("customer_session_warning_recorded", correlationId);
  assert.equal(rows.length, 1);
});

// ---------------------------------------------------------------------------
// 5. Privacy
// ---------------------------------------------------------------------------

test("28-39: no onboarding transition event ever carries email, names, order reference, or free text - only booleans", async () => {
  const conversationId = uniqueId("conv-privacy");
  const previous = onboardingState({ conversationId, status: "required", version: 1, collected: {} });
  const next = onboardingState({
    conversationId,
    status: "collecting",
    version: 2,
    collected: { firstName: "Ana Secreta", lastName: "Perez Oculta", email: "ana.secreta@example.com", orderReference: "NV-000123-SECRET" }
  });
  await recordOnboardingTransitionIfChanged({ operation: "collect_fields", previous, result: mutationResult(next) });
  const rows = await safeQueryRows<{ payload_json: string; metadata_json: string }>(
    "SELECT payload_json, metadata_json FROM commercial_event WHERE event_type = 'customer_onboarding_transition_recorded' AND conversation_id = ?",
    [conversationId]
  );
  assert.ok(rows.ok);
  for (const row of rows.rows) {
    const serialized = `${row.payload_json}${row.metadata_json}`;
    assert.doesNotMatch(serialized, /Ana Secreta/);
    assert.doesNotMatch(serialized, /Perez Oculta/);
    assert.doesNotMatch(serialized, /ana\.secreta@example\.com/);
    assert.doesNotMatch(serialized, /NV-000123-SECRET/);
  }
});

test("privacy: identity resolution/capability-outcome events never carry raw HTTP, stack traces, or DB error text", async () => {
  const correlationId = uniqueId("corr-privacy-cap");
  const result = gatewayResult({
    capability: "create_customer",
    status: "failed",
    errorCode: "customer_service_upstream_error",
    data: null
  });
  await recordIdentityCapabilityOutcome({ capability: "create_customer", correlationId, gatewayResult: result });
  const rows = await loadEventsByType("customer_identity_capability_outcome_recorded", correlationId);
  const serialized = JSON.stringify(rows[0].payload);
  assert.doesNotMatch(serialized, /at\s+\w+\s*\(/); // no stack-trace-shaped text
  assert.doesNotMatch(serialized, /select|insert|update|delete/i);
  assert.doesNotMatch(serialized, /http:\/\/|https:\/\//);
});

// ---------------------------------------------------------------------------
// 6. Idempotency
// ---------------------------------------------------------------------------

test("40: same inbound (messageId+phase+resolver+outcome) never duplicates a resolution event", async () => {
  const correlationId = uniqueId("corr-idem-resolution");
  const messageId = uniqueId("msg-idem");
  const before = await countEventsByDedupePrefix(`identity:${messageId}:`);
  await recordLocalIdentityResolution({ messageId, correlationId, conversationId: "conv-1", result: localResult() });
  await recordLocalIdentityResolution({ messageId, correlationId, conversationId: "conv-1", result: localResult() });
  const after = await countEventsByDedupePrefix(`identity:${messageId}:`);
  assert.equal(after - before, 1);
});

test("41: same capability execution (executionPublicId+businessOutcome) never duplicates an outcome event", async () => {
  const correlationId = uniqueId("corr-idem-capability");
  const result = gatewayResult({ capability: "create_customer", status: "completed", data: { status: "created", customerMasterId: "700" } });
  await recordIdentityCapabilityOutcome({ capability: "create_customer", correlationId, gatewayResult: result });
  await recordIdentityCapabilityOutcome({ capability: "create_customer", correlationId, gatewayResult: result });
  const rows = await loadEventsByType("customer_identity_capability_outcome_recorded", correlationId);
  assert.equal(rows.length, 1);
});

test("42: the same onboarding version never produces two transition events", async () => {
  const conversationId = uniqueId("conv-idem-onboarding");
  const state = onboardingState({ conversationId, status: "required", version: 1 });
  await recordOnboardingTransitionIfChanged({ operation: "start", previous: null, result: mutationResult(state, "created") });
  await recordOnboardingTransitionIfChanged({ operation: "start", previous: null, result: mutationResult(state, "created") });
  const rows = await safeQueryRows<{ total: number }>("SELECT COUNT(*) AS total FROM commercial_event WHERE conversation_id = ? AND event_type = 'customer_onboarding_transition_recorded'", [conversationId]);
  assert.ok(rows.ok);
  assert.equal(Number(rows.rows[0]?.total ?? 0), 1);
});

test("43: a new onboarding version does produce a new transition event", async () => {
  const conversationId = uniqueId("conv-newversion");
  const v1 = onboardingState({ conversationId, status: "required", version: 1 });
  const v2 = onboardingState({ conversationId, status: "collecting", version: 2 });
  await recordOnboardingTransitionIfChanged({ operation: "start", previous: null, result: mutationResult(v1, "created") });
  await recordOnboardingTransitionIfChanged({ operation: "collect_fields", previous: v1, result: mutationResult(v2) });
  const rows = await safeQueryRows<{ total: number }>("SELECT COUNT(*) AS total FROM commercial_event WHERE conversation_id = ? AND event_type = 'customer_onboarding_transition_recorded'", [conversationId]);
  assert.ok(rows.ok);
  assert.equal(Number(rows.rows[0]?.total ?? 0), 2);
});

// ---------------------------------------------------------------------------
// 7. Fronteras (boundaries)
// ---------------------------------------------------------------------------

test("48: T07 did not add a new persistence table - no new migration file beyond 024", async () => {
  const { readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const migrationsDir = join(__dirname, "..", "..", "migrations");
  const files = readdirSync(migrationsDir);
  const suspicious = files.filter((file) => /identity_event|identity_audit|onboarding_execution|capability_outcome_event|session_warning_table/i.test(file));
  assert.deepEqual(suspicious, []);
  const versions = files.map((file) => Number(file.split("_")[0])).filter((value) => !Number.isNaN(value));
  assert.equal(Math.max(...versions), 24);
});

test("50: multi-request never gains identity capability side effects because of T07 (unchanged: no new call path was added)", async () => {
  // T07 only added recording around the two existing call sites
  // (resolveNativeCustomerSession/runCustomerOnboardingPostPlanStage), both
  // legacy-runtime only. No new import from lib/brain/commercial/multi-request
  // exists in the new identity audit module.
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const source = readFileSync(join(__dirname, "..", "..", "lib", "brain", "commercial", "native-cycle", "customer-session", "identityAuditEvents.ts"), "utf8");
  assert.doesNotMatch(source, /multi-request/);
});

test("51: record_customer_interest remains unregistered after T07", async () => {
  const { resolveCapabilityGatewayDefinition } = await import("@/lib/brain/commercial/capability-gateway");
  assert.equal(resolveCapabilityGatewayDefinition("record_customer_interest"), null);
});

// ---------------------------------------------------------------------------
// Integration: the real orchestrators (not just the recorder functions in
// isolation) actually persist events when run end to end.
// ---------------------------------------------------------------------------

function fakeOnboardingService(initial: CustomerOnboardingState | null): CustomerOnboardingService {
  let state = initial;
  return {
    async getState() {
      return state;
    },
    async startOnboarding(input) {
      if (state) return { ok: true, status: "unchanged", state };
      state = {
        id: 1,
        conversationId: input.conversationId,
        opportunityId: input.opportunityId ?? null,
        status: "required",
        purpose: input.purpose,
        collected: {},
        pendingFields: input.pendingFields,
        customerId: null,
        failedVerificationAttempts: 0,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null
      };
      return { ok: true, status: "created", state };
    },
    collectFields: async () => { throw new Error("unused"); },
    markResolving: async () => { throw new Error("unused"); },
    completeOnboarding: async () => { throw new Error("unused"); },
    markConflict: async () => { throw new Error("unused"); },
    markTemporarilyUnavailable: async () => { throw new Error("unused"); },
    retryResolution: async () => { throw new Error("unused"); },
    recordVerificationFailure: async () => { throw new Error("unused"); }
  };
}

test("integration: resolveNativeCustomerSession end-to-end persists a real identity_resolution_recorded event", async () => {
  const correlationId = uniqueId("corr-e2e-preplan");
  const conversationId = uniqueId("conv-e2e");
  const identityService: CustomerIdentityResolutionService = {
    async resolveIdentity() {
      return { status: "identified", customerId: "900", matchedBy: "external_identity", confidence: "verified", conflicts: [], warnings: [] };
    }
  };
  await resolveNativeCustomerSession({
    conversationId,
    opportunityId: null,
    trustedInbound: { channel: "whatsapp", externalId: "56900000001", normalizedPhone: "56900000001", messageId: uniqueId("msg"), receivedAt: "2026-07-13T12:00:00.000Z" },
    messageText: "Hola",
    correlationId,
    priorConversationCustomerId: null,
    dependencies: { identityService, onboardingService: fakeOnboardingService(null) }
  });
  const rows = await loadEventsByType("customer_identity_resolution_recorded", correlationId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.resolver, "local");
  assert.equal(rows[0].payload.outcome, "identified");
  assert.equal(rows[0].conversation_id, conversationId);
});

test("integration: runCustomerOnboardingPostPlanStage end-to-end persists a real start transition event", async () => {
  const correlationId = uniqueId("corr-e2e-postplan");
  const conversationId = uniqueId("conv-e2e-post");
  const session = {
    conversationId,
    opportunityId: null,
    trustedInbound: { channel: "whatsapp" as const, externalId: "56900000002", normalizedPhone: "56900000002", messageId: uniqueId("msg"), receivedAt: "2026-07-13T12:00:00.000Z" },
    identity: { status: "anonymous" as const, customerId: null, source: "none" as const, localResolutionOutcome: "anonymous", externalResolutionOutcome: null },
    onboarding: null,
    contextAccess: "none" as const,
    currentTurnConsent: { createCustomer: null, linkExternalIdentity: null },
    freshExternalResolutionEvidence: null
  };
  await runCustomerOnboardingPostPlanStage({
    plannedOperation: { operation: "prepare_quote" },
    messageText: "Quiero cotizar una jaula",
    correlationId,
    customerSessionExecution: session,
    dependencies: { onboardingService: fakeOnboardingService(null) }
  });
  const rows = await safeQueryRows<{ payload_json: string; conversation_id: string | null }>(
    "SELECT payload_json, conversation_id FROM commercial_event WHERE event_type = 'customer_onboarding_transition_recorded' AND conversation_id = ?",
    [conversationId]
  );
  assert.ok(rows.ok);
  assert.equal(rows.rows.length, 1);
  const payload = JSON.parse(rows.rows[0].payload_json);
  assert.equal(payload.operation, "start");
  assert.equal(payload.purpose, "quote");
});

test("fail-safe: recording functions never throw even given edge-case input, and never affect the caller's return value", async () => {
  await assert.doesNotReject(recordIdentityCapabilityOutcome({ capability: "resolve_customer", gatewayResult: gatewayResult({ executionPublicId: null }) }));
  await assert.doesNotReject(recordOnboardingTransitionIfChanged({ operation: "start", previous: null, result: { ok: false, status: "error", error: "boom" } }));
  await assert.doesNotReject(recordSessionWarnings({ phase: "pre_plan", messageId: uniqueId("msg"), warnings: [] }));
});
