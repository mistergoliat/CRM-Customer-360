import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, queryRows } from "@/lib/db";
import { executeGovernedCapability } from "@/lib/brain/commercial/capability-gateway/executeCapability";
import { evaluateCapabilityIdentityGate } from "@/lib/brain/commercial/capability-gateway/identityGate";
import type { CapabilityGatewayContext, CapabilityGovernanceMetadata } from "@/lib/brain/commercial/capability-gateway/types";
import { decideCommercialIdentityRequirement, getCommercialIdentityRequirement, getCommercialOperationForCapability } from "@/lib/brain/commercial/identity/commercial-identity-requirement";
import type { CommercialOperation } from "@/lib/brain/commercial/identity/commercial-identity-requirement";
import type { NativeCustomerSessionExecutionContext } from "@/lib/brain/commercial/native-cycle/customer-session";
import type { IdentityLevel } from "@/lib/domains/customer-identity-verification";

/**
 * SALES-AGENT-R3-A02. Tests for the shared identity-requirement gate now
 * enforced inside executeGovernedCapability (identityGate.ts) - the single
 * choke point every caller (R2's commercialWorkExecutor, the native Agent
 * Tool Loop, the multi-intent action plan executor, and any future caller)
 * already goes through, so proving the gate here proves it for all of them.
 */

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "main_management",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_URL: ""
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

const MUTATING: CapabilityGovernanceMetadata = { sideEffect: "mutating", authority: "autonomous", riskClass: "medium" };
const READ_ONLY: CapabilityGovernanceMetadata = { sideEffect: "read_only", authority: "autonomous", riskClass: "low" };

function fakeSession(overrides: Partial<NativeCustomerSessionExecutionContext["runtimeIdentity"]> = {}): NativeCustomerSessionExecutionContext {
  return {
    conversationId: "conv-1",
    opportunityId: null,
    trustedInbound: { channel: "whatsapp", externalId: "56911112222", normalizedPhone: "56911112222", messageId: "wamid.1", receivedAt: "2026-08-30T12:00:00.000Z" },
    identity: { status: "anonymous", customerId: null, source: "none", localResolutionOutcome: "anonymous", externalResolutionOutcome: null },
    masterCustomerIdentity: { status: "identity_unresolved", reason: "identity_source_unsupported" },
    runtimeIdentity: {
      status: "ANONYMOUS",
      identityLevel: "LEVEL_0_ANONYMOUS",
      masterCustomerId: null,
      prestashopCustomerId: null,
      verificationRequired: false,
      requiredEvidence: [],
      readyToLink: false,
      conflictCode: null,
      policyCode: "NO_CHANNEL_EVIDENCE",
      evidenceRefs: [],
      ...overrides
    },
    onboarding: null,
    contextAccess: "none",
    currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: null },
    freshExternalResolutionEvidence: null
  };
}

function levelSession(level: IdentityLevel): NativeCustomerSessionExecutionContext {
  const byLevel: Record<IdentityLevel, Partial<NativeCustomerSessionExecutionContext["runtimeIdentity"]>> = {
    LEVEL_0_ANONYMOUS: { status: "ANONYMOUS", identityLevel: "LEVEL_0_ANONYMOUS" },
    LEVEL_1_CHANNEL_OBSERVED: { status: "CHANNEL_OBSERVED", identityLevel: "LEVEL_1_CHANNEL_OBSERVED" },
    LEVEL_2_MASTER_RESOLVED: { status: "MASTER_RESOLVED", identityLevel: "LEVEL_2_MASTER_RESOLVED", masterCustomerId: "700" },
    LEVEL_3_PRESTASHOP_LINKED: { status: "PRESTASHOP_LINKED", identityLevel: "LEVEL_3_PRESTASHOP_LINKED", masterCustomerId: "700", prestashopCustomerId: "900" }
  };
  return fakeSession(byLevel[level]);
}

function context(session: NativeCustomerSessionExecutionContext | null, opportunityId: number | null = 1): CapabilityGatewayContext {
  return { correlationId: `corr-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, opportunityId, conversationId: null, trustedCustomerSession: session };
}

async function loadExecutionRow(correlationId: string) {
  const rows = await queryRows<Record<string, unknown>>(
    "SELECT * FROM crm_capability_executions WHERE correlation_id = ? ORDER BY id DESC LIMIT 1",
    [correlationId]
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// [1] canonical capability -> operation mapping
// ---------------------------------------------------------------------------

test("capability -> operation mapping: real capabilities resolve, an unknown one does not", () => {
  assert.equal(getCommercialOperationForCapability("create_quote"), "create_quote");
  assert.equal(getCommercialOperationForCapability("select_products"), "select_products");
  assert.equal(getCommercialOperationForCapability("link_external_identity"), "link_external_identity");
  assert.equal(getCommercialOperationForCapability("get_customer_purchase_history"), "customer_profile_history");
  assert.equal(getCommercialOperationForCapability("get_customer_recommendation_signal"), "customer_profile_history");
  assert.equal(getCommercialOperationForCapability("some_future_capability"), null);
});

// ---------------------------------------------------------------------------
// [2] read-only capabilities are never gated
// ---------------------------------------------------------------------------

test("read-only capability unaffected: never gated regardless of identity", () => {
  const outcome = evaluateCapabilityIdentityGate("search_products", READ_ONLY, context(levelSession("LEVEL_0_ANONYMOUS")));
  assert.deepEqual(outcome, { allowed: true });
});

// ---------------------------------------------------------------------------
// [3][4][5] NONE-requirement mutating capabilities are never gated
// ---------------------------------------------------------------------------

for (const capability of ["select_products", "set_shipping_destination", "select_shipping_option"]) {
  test(`${capability} remains NONE: allowed at LEVEL_0 with no runtime identity at all`, () => {
    const outcome = evaluateCapabilityIdentityGate(capability, MUTATING, context(null));
    assert.deepEqual(outcome, { allowed: true });
  });
}

// ---------------------------------------------------------------------------
// [6][7][8][9] create_quote gating by identity level
// ---------------------------------------------------------------------------

test("create_quote: LEVEL_0 denied", () => {
  const outcome = evaluateCapabilityIdentityGate("create_quote", MUTATING, context(levelSession("LEVEL_0_ANONYMOUS")));
  assert.equal(outcome.allowed, false);
  if (!outcome.allowed) {
    assert.equal(outcome.status, "denied");
    assert.equal(outcome.errorCode, "master_identity_required");
  }
});

test("create_quote: LEVEL_1 denied", () => {
  const outcome = evaluateCapabilityIdentityGate("create_quote", MUTATING, context(levelSession("LEVEL_1_CHANNEL_OBSERVED")));
  assert.equal(outcome.allowed, false);
  if (!outcome.allowed) {
    assert.equal(outcome.status, "denied");
    assert.equal(outcome.errorCode, "master_identity_required");
  }
});

test("create_quote: LEVEL_2 allowed", () => {
  const outcome = evaluateCapabilityIdentityGate("create_quote", MUTATING, context(levelSession("LEVEL_2_MASTER_RESOLVED")));
  assert.deepEqual(outcome, { allowed: true });
});

test("create_quote: LEVEL_3 allowed", () => {
  const outcome = evaluateCapabilityIdentityGate("create_quote", MUTATING, context(levelSession("LEVEL_3_PRESTASHOP_LINKED")));
  assert.deepEqual(outcome, { allowed: true });
});

// ---------------------------------------------------------------------------
// [10] Quote Service is never reached on a denied request - proven through
// the real executeGovernedCapability entry point, not just the pure gate.
// ---------------------------------------------------------------------------

test("executeGovernedCapability: create_quote below LEVEL_2 is denied before Quote Service is ever consulted, and audited", async () => {
  const correlationId = `cap-test-identity-gate-denied-${Date.now()}`;
  const result = await executeGovernedCapability("create_quote", {}, { ...context(levelSession("LEVEL_0_ANONYMOUS"), 1), correlationId });
  assert.equal(result.status, "denied");
  assert.equal(result.errorCode, "master_identity_required");
  // Never the capability's own quote_service_not_configured/no_active_opportunity codes - proof the gate short-circuited before checkAvailability/execute ran.
  assert.notEqual(result.errorCode, "quote_service_not_configured");
  assert.notEqual(result.errorCode, "no_active_opportunity");

  const row = await loadExecutionRow(correlationId);
  assert.ok(row, "expected an audit row for the identity-denied capability");
  assert.equal(row!.execution_status, "denied");
  assert.equal(row!.error_code, "master_identity_required");

  // [15] No PII in the persisted audit summary - enum-valued facts only.
  const responseSummary = JSON.parse(String(row!.response_summary_json ?? "{}"));
  assert.deepEqual(responseSummary, {
    capability: "create_quote",
    operation: "create_quote",
    requiredLevel: "LEVEL_2_MASTER_RESOLVED",
    observedLevel: "LEVEL_0_ANONYMOUS",
    observedStatus: "ANONYMOUS",
    decisionStatus: "ONBOARDING_REQUIRED",
    policyCode: "MASTER_IDENTITY_REQUIRED"
  });
});

test("executeGovernedCapability: create_quote at LEVEL_2 passes the identity gate and reaches the real capability logic", async () => {
  delete process.env.QUOTE_SERVICE_BASE_URL;
  const correlationId = `cap-test-identity-gate-allowed-${Date.now()}`;
  const result = await executeGovernedCapability("create_quote", {}, { ...context(levelSession("LEVEL_2_MASTER_RESOLVED"), 1), correlationId });
  // The gate let it through - the capability's own checkAvailability now runs and reports its real, unrelated failure mode.
  assert.equal(result.availability, "unavailable");
  assert.equal(result.errorCode, "quote_service_not_configured");
});

// ---------------------------------------------------------------------------
// [11] unknown mutating operation fails closed
// ---------------------------------------------------------------------------

test("unmapped mutating capability fails closed regardless of identity level", () => {
  const outcome = evaluateCapabilityIdentityGate("some_future_mutating_capability", MUTATING, context(levelSession("LEVEL_3_PRESTASHOP_LINKED")));
  assert.equal(outcome.allowed, false);
  if (!outcome.allowed) {
    assert.equal(outcome.errorCode, "identity_requirement_unresolved");
  }
});

test("mutating capability with no runtime identity context at all fails closed", () => {
  const outcome = evaluateCapabilityIdentityGate("create_quote", MUTATING, context(null));
  assert.equal(outcome.allowed, false);
  if (!outcome.allowed) {
    assert.equal(outcome.errorCode, "identity_context_unavailable");
  }
});

// ---------------------------------------------------------------------------
// [12] R2/shared-gate parity: both consult the identical
// decideCommercialIdentityRequirement - proven for every mapped operation
// across every reachable identity level, not asserted by convention.
// ---------------------------------------------------------------------------

const LEVELS: IdentityLevel[] = ["LEVEL_0_ANONYMOUS", "LEVEL_1_CHANNEL_OBSERVED", "LEVEL_2_MASTER_RESOLVED", "LEVEL_3_PRESTASHOP_LINKED"];
const PARITY_CAPABILITIES: [string, CommercialOperation][] = [
  ["create_quote", "create_quote"],
  ["link_external_identity", "link_external_identity"],
  ["get_customer_purchase_history", "customer_profile_history"]
];

for (const [capability, operation] of PARITY_CAPABILITIES) {
  for (const level of LEVELS) {
    test(`parity: ${capability} at ${level} - shared gate agrees with the raw A06 decision`, () => {
      const session = levelSession(level);
      const requirement = getCommercialIdentityRequirement(operation);
      const rawDecision = decideCommercialIdentityRequirement(requirement, session.runtimeIdentity);
      const gateOutcome = evaluateCapabilityIdentityGate(capability, MUTATING, context(session));
      assert.equal(gateOutcome.allowed, rawDecision.status === "SUFFICIENT");
    });
  }
}
