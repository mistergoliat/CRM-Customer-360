import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, queryRows } from "@/lib/db";
import { createMasterCustomer } from "@/lib/integrations/customer-master/customer-repository";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";
import { runNativeAutonomousCycle } from "@/lib/brain/commercial/native-cycle/runNativeAutonomousCycle";
import type { ResolveNativeCustomerSessionDependencies } from "@/lib/brain/commercial/native-cycle/customer-session";
import type { CustomerOnboardingService, CustomerOnboardingState } from "@/lib/domains/customer-onboarding";
import type { ResolveCustomerIdentityResult } from "@/lib/domains/customer-identity";
import type { Customer360LoadResult } from "@/lib/domains/customer-360";

// ACS-R1-04-T06, contract section 11: "identity identificada != acceso
// automatico a Customer 360". These tests exercise the gate end to end
// through runNativeAutonomousCycle (real DB conversation, DI'd identity/
// onboarding), counting actual Customer 360 loader invocations.

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
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true"
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

// ACS-R1-04-T06.2. The native WhatsApp inbound no longer resolves a
// provisional customer for an unknown sender (that authority moved to
// Customer Service). These tests need an already-identified customer, so
// seeding links a real master_customer to the waId directly before sending
// the inbound - mirroring tests/native/identity-conflict.test.ts.
async function seedConversation() {
  const waId = `5699${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  const phoneNumberId = `phone-${uniqueSuffix("pnid")}`;

  const customer = await createMasterCustomer({
    firstname: "Cliente",
    lastname: "Gate",
    email: `gate-${uniqueSuffix("seed")}@example.com`,
    platformOrigin: "whatsapp"
  });
  assert.ok(customer.ok, customer.ok ? "" : customer.error);
  const customerId = Number(customer.data.id);
  await queryRows(
    `
      INSERT INTO customer_external_identity (customer_id, provider, identity_type, external_id, normalized_value, is_verified, created_at, updated_at)
      VALUES (?, 'whatsapp', 'phone_number', ?, ?, 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
    `,
    [customerId, waId, waId]
  );

  const result = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix("gate")}`,
    phoneNumberId,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Gate",
    messageType: "text",
    text: "Hola",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });
  assert.ok(result.conversationId);
  assert.equal(result.customerId, customerId, "seeding must resolve the linked customerId");
  return { ...result, waId, phoneNumberId, customerId: result.customerId as number };
}

function countingLoader() {
  const calls: string[] = [];
  const NOT_FOUND: Customer360LoadResult = { status: "not_found", snapshot: null, warnings: [] };
  return {
    calls,
    async loadCustomer360(customerId: string): Promise<Customer360LoadResult> {
      calls.push(customerId);
      return NOT_FOUND;
    }
  };
}

function notUsedInTest(name: string) {
  return async () => {
    throw new Error(`${name} must not be called in this test`);
  };
}

function fakeOnboardingService(state: CustomerOnboardingState | null): CustomerOnboardingService {
  return {
    async getState() {
      return state;
    },
    startOnboarding: notUsedInTest("startOnboarding"),
    collectFields: notUsedInTest("collectFields"),
    markResolving: notUsedInTest("markResolving"),
    completeOnboarding: notUsedInTest("completeOnboarding"),
    markConflict: notUsedInTest("markConflict"),
    markTemporarilyUnavailable: notUsedInTest("markTemporarilyUnavailable"),
    retryResolution: notUsedInTest("retryResolution"),
    recordVerificationFailure: notUsedInTest("recordVerificationFailure")
  };
}

function onboardingRow(conversationId: string, customerId: string, overrides: Partial<CustomerOnboardingState> = {}): CustomerOnboardingState {
  return {
    id: 1,
    conversationId,
    opportunityId: null,
    status: "completed",
    purpose: "quote",
    collected: {},
    pendingFields: [],
    customerId,
    failedVerificationAttempts: 0,
    version: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    completedAt: new Date(0).toISOString(),
    ...overrides
  };
}

/** Minimal working fake - only markResolving/markConflict are real, everything else is unused in this file. */
function landableOnboardingService(state: CustomerOnboardingState): CustomerOnboardingService {
  let current = state;
  return {
    async getState() {
      return current;
    },
    startOnboarding: notUsedInTest("startOnboarding"),
    collectFields: notUsedInTest("collectFields"),
    async markResolving(input) {
      current = { ...current, status: "resolving", version: input.expectedVersion + 1 };
      return { ok: true, status: "updated", state: current };
    },
    completeOnboarding: notUsedInTest("completeOnboarding"),
    async markConflict(input) {
      current = { ...current, status: "conflict", version: input.expectedVersion + 1 };
      return { ok: true, status: "updated", state: current };
    },
    markTemporarilyUnavailable: notUsedInTest("markTemporarilyUnavailable"),
    retryResolution: notUsedInTest("retryResolution"),
    recordVerificationFailure: notUsedInTest("recordVerificationFailure")
  };
}

function identified(customerId: string): ResolveCustomerIdentityResult {
  return { status: "identified", customerId, matchedBy: "external_identity", confidence: "verified", conflicts: [], warnings: [] };
}
function conflict(): ResolveCustomerIdentityResult {
  return { status: "conflict", customerId: null, matchedBy: null, confidence: "insufficient", conflicts: [{ type: "phone_ambiguous", candidateCustomerIds: ["1", "2"] }], warnings: [] };
}
function unavailable(): ResolveCustomerIdentityResult {
  return { status: "temporarily_unavailable", customerId: null, matchedBy: null, confidence: "insufficient", conflicts: [], warnings: [] };
}

const LEGACY_ENV = {
  BRAIN_COMMERCIAL_SHADOW_ENABLED: "true",
  BRAIN_COMMERCIAL_RUNTIME_ENABLED: "true",
  BRAIN_COMMERCIAL_POLICY_ENABLED: "true",
  BRAIN_COMMERCIAL_SHADOW_ALLOW_REAL_PROVIDER: "false",
  BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED: "false",
  BRAIN_MULTI_REQUEST_RUNTIME_ENABLED: "false",
  BRAIN_SALES_AGENT_ENABLED: "false"
};

function withEnv<T>(overrides: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) previous[key] = process.env[key];
  Object.assign(process.env, overrides);
  return fn().finally(() => {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

async function runWithSession(
  seeded: { conversationId: number | null; conversationPublicId: string | null; waId: string; phoneNumberId: string; messageId: string | number | null },
  dependencies: ResolveNativeCustomerSessionDependencies
) {
  const loader = countingLoader();
  const result = await withEnv(LEGACY_ENV, () =>
    runNativeAutonomousCycle({
      conversationId: seeded.conversationId as number,
      conversationPublicId: seeded.conversationPublicId as string,
      customerMasterId: null,
      waId: seeded.waId,
      phoneNumberId: seeded.phoneNumberId,
      messageId: seeded.messageId,
      messageText: "Hola",
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      loadCustomer360: loader.loadCustomer360,
      customerSessionDependencies: dependencies
    })
  );
  return { result, calls: loader.calls };
}

// ---------------------------------------------------------------------------
// Group 5: Customer 360 gate (43-48)
// ---------------------------------------------------------------------------

test("43: exact customer identified with no active onboarding (public query) -> identified, zero Customer 360 calls", async () => {
  const seeded = await seedConversation();
  const { result, calls } = await runWithSession(seeded, { identityService: { async resolveIdentity() { return identified(String(seeded.customerId)); } }, onboardingService: fakeOnboardingService(null) });
  assert.equal(result.customerSession?.identity.status, "identified");
  assert.equal(result.customerSession?.contextAccess, "none");
  assert.equal(calls.length, 0);
});

test("44: exact customer identified with an active quote onboarding -> commercial_history, exactly one Customer 360 call", async () => {
  const seeded = await seedConversation();
  const conversationId = String(seeded.conversationId);
  const state = onboardingRow(conversationId, String(seeded.customerId), { status: "completed", purpose: "quote" });
  const { result, calls } = await runWithSession(seeded, { identityService: { async resolveIdentity() { return identified(String(seeded.customerId)); } }, onboardingService: fakeOnboardingService(state) });
  assert.equal(result.customerSession?.contextAccess, "commercial_history");
  assert.equal(calls.length, 1);
  assert.equal(calls[0], String(seeded.customerId));
});

test("45: an identity conflict never authorizes Customer 360, even with an onboarding row present", async () => {
  const seeded = await seedConversation();
  const conversationId = String(seeded.conversationId);
  const state = onboardingRow(conversationId, String(seeded.customerId), { status: "collecting", customerId: null, completedAt: null });
  const { result, calls } = await runWithSession(seeded, { identityService: { async resolveIdentity() { return conflict(); } }, onboardingService: landableOnboardingService(state) });
  assert.equal(result.customerSession?.identity.status, "conflict");
  assert.equal(result.customerSession?.contextAccess, "none");
  assert.equal(calls.length, 0);
});

test("46: a temporarily_unavailable identity resolution never authorizes Customer 360", async () => {
  const seeded = await seedConversation();
  const { result, calls } = await runWithSession(seeded, { identityService: { async resolveIdentity() { return unavailable(); } }, onboardingService: fakeOnboardingService(null) });
  assert.equal(result.customerSession?.identity.status, "temporarily_unavailable");
  assert.equal(result.customerSession?.contextAccess, "none");
  assert.equal(calls.length, 0);
});

test("47: an orderReference being present never grants validated_entity - entity ownership validation is not implemented in T06", async () => {
  const seeded = await seedConversation();
  const conversationId = String(seeded.conversationId);
  const state = onboardingRow(conversationId, String(seeded.customerId), { status: "completed", purpose: "order_inquiry", collected: { orderReference: "ORD-777" } });
  const { result, calls } = await runWithSession(seeded, { identityService: { async resolveIdentity() { return identified(String(seeded.customerId)); } }, onboardingService: fakeOnboardingService(state) });
  assert.notEqual(result.customerSession?.contextAccess, "validated_entity");
  assert.equal(result.customerSession?.contextAccess, "none");
  assert.equal(calls.length, 0);
});

test("48: historical purposes (order_inquiry/complaint/warranty) never grant commercial_history, only quote/purchase do", async () => {
  const seeded = await seedConversation();
  const conversationId = String(seeded.conversationId);
  for (const purpose of ["order_inquiry", "complaint", "warranty"] as const) {
    const state = onboardingRow(conversationId, String(seeded.customerId), { status: "completed", purpose });
    const { result, calls } = await runWithSession(seeded, { identityService: { async resolveIdentity() { return identified(String(seeded.customerId)); } }, onboardingService: fakeOnboardingService(state) });
    assert.equal(result.customerSession?.contextAccess, "none", purpose);
    assert.equal(calls.length, 0, purpose);
  }
});
