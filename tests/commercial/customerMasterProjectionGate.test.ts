import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test, { after } from "node:test";
import { getPool, queryRows } from "@/lib/db";
import { createMasterCustomer } from "@/lib/integrations/customer-master/customer-repository";
import { createCustomerOnboardingService } from "@/lib/domains/customer-onboarding";
import type { CustomerMasterProjectionReader } from "@/lib/domains/customer-service";
import {
  completeOnboardingWithVerifiedCustomer,
  resetCustomerMasterProjectionReaderForTests,
  verifyCustomerMasterProjection
} from "@/lib/brain/commercial/native-cycle/customer-session";

// ACS-R1-04-T08.1. Directed coverage for the customer_master projection gate
// itself (lib/brain/commercial/native-cycle/customer-session/onboardingTransitions.ts:
// verifyCustomerMasterProjection / completeOnboardingWithVerifiedCustomer),
// independent of any one capability - resolve_customer/create_customer/
// link_external_identity in tests/commercial/*Capability.test.ts and
// tests/e2e/customerIdentityOnboarding.e2e.test.ts each apply this same gate
// to their own success path; this file is the single source of truth for
// the gate's own decision table against the real DB.

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
  resetCustomerMasterProjectionReaderForTests();
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function makeCustomer(label: string) {
  const result = await createMasterCustomer({ firstname: "Gate", lastname: label, email: `gate-${uniqueSuffix(label)}@example.com`, platformOrigin: "whatsapp" });
  assert.ok(result.ok, result.ok ? "" : result.error);
  return Number(result.data.id);
}

/** A conversation row is required - crm_customer_onboarding_state.conversation_id FKs to it. */
async function seedConversationId() {
  const publicId = `conv-gate-${uniqueSuffix("pub")}`;
  await queryRows(
    `
      INSERT INTO conversation (public_id, channel, provider, channel_account_id, external_contact_id, external_thread_id, customer_id, status, owner_type, owner_id, ai_enabled, human_owner_active, created_at, updated_at)
      VALUES (?, 'whatsapp', 'meta', ?, ?, ?, NULL, 'open', 'ai_sdr', 'native_whatsapp', 1, 0, NOW(3), NOW(3))
    `,
    [publicId, `phone-${uniqueSuffix("pnid")}`, uniqueSuffix("ext"), uniqueSuffix("thread")]
  );
  const rows = await queryRows<{ id: number }>("SELECT id FROM conversation WHERE public_id = ? LIMIT 1", [publicId]);
  return String(rows[0].id);
}

async function seedResolvingOnboarding() {
  const conversationId = await seedConversationId();
  const service = createCustomerOnboardingService();
  const started = await service.startOnboarding({ conversationId, purpose: "quote", pendingFields: [] });
  assert.ok(started.ok, started.ok ? "" : started.error);
  const startedState = (started as { state: { version: number } }).state;
  const resolving = await service.markResolving({ conversationId, expectedVersion: startedState.version });
  assert.ok(resolving.ok, resolving.ok ? "" : (resolving as { error: string }).error);
  return { service, state: (resolving as { state: import("@/lib/domains/customer-onboarding").CustomerOnboardingState }).state };
}

// ---------------------------------------------------------------------------
// verifyCustomerMasterProjection - pure decision table
// ---------------------------------------------------------------------------

test("verifyCustomerMasterProjection: a real master_customer row verifies", async () => {
  const customerId = await makeCustomer("Verified");
  const result = await verifyCustomerMasterProjection(String(customerId));
  assert.deepEqual(result, { status: "verified", customerMasterId: String(customerId) });
});

test("verifyCustomerMasterProjection: a well-formed but non-existent id is not_found, never a thrown error", async () => {
  const result = await verifyCustomerMasterProjection("900000999");
  assert.equal(result.status, "not_found");
});

test("verifyCustomerMasterProjection: empty/missing customerMasterId is invalid", async () => {
  assert.equal((await verifyCustomerMasterProjection(null)).status, "invalid");
  assert.equal((await verifyCustomerMasterProjection(undefined)).status, "invalid");
  assert.equal((await verifyCustomerMasterProjection("")).status, "invalid");
  assert.equal((await verifyCustomerMasterProjection("   ")).status, "invalid");
});

test("verifyCustomerMasterProjection: a non-numeric or zero/negative id is invalid - never queried as-is", async () => {
  assert.equal((await verifyCustomerMasterProjection("cust-1")).status, "invalid");
  assert.equal((await verifyCustomerMasterProjection("0")).status, "invalid");
  assert.equal((await verifyCustomerMasterProjection("-5")).status, "invalid");
  assert.equal((await verifyCustomerMasterProjection("1e10")).status, "invalid");
  assert.equal((await verifyCustomerMasterProjection("' OR '1'='1")).status, "invalid");
});

test("verifyCustomerMasterProjection: disagreement with a customer already known locally this turn is inconsistent, never silently overwritten", async () => {
  const customerId = await makeCustomer("Known");
  const result = await verifyCustomerMasterProjection(String(customerId + 1), { knownLocalCustomerId: String(customerId) });
  assert.equal(result.status, "inconsistent");
});

test("verifyCustomerMasterProjection: agreement with the known local customer verifies", async () => {
  const customerId = await makeCustomer("Agrees");
  const result = await verifyCustomerMasterProjection(String(customerId), { knownLocalCustomerId: String(customerId) });
  assert.deepEqual(result, { status: "verified", customerMasterId: String(customerId) });
});

test("verifyCustomerMasterProjection: a failing reader is fail-closed (check_failed), never no_match, never throws", async () => {
  const throwingReader: CustomerMasterProjectionReader = { async exists() { throw new Error("ECONNREFUSED some.internal.host:3306 SELECT * FROM master_customer"); } };
  const result = await verifyCustomerMasterProjection("1", { projectionReader: throwingReader });
  assert.equal(result.status, "check_failed");
});

// ---------------------------------------------------------------------------
// completeOnboardingWithVerifiedCustomer - state transitions + warnings
// ---------------------------------------------------------------------------

test("completeOnboardingWithVerifiedCustomer: verified id completes onboarding for real", async () => {
  const customerId = await makeCustomer("Complete");
  const { service, state } = await seedResolvingOnboarding();
  const result = await completeOnboardingWithVerifiedCustomer(service, state, String(customerId), "corr-gate-1");
  assert.equal(result.verifiedCustomerId, String(customerId));
  assert.equal(result.warning, null);
  assert.equal(result.state.status, "completed");
  assert.equal(result.state.customerId, String(customerId));
});

test("completeOnboardingWithVerifiedCustomer: an unprojected id lands onboarding temporarily_unavailable, never completed, never an FK exception", async () => {
  const { service, state } = await seedResolvingOnboarding();
  await assert.doesNotReject(async () => {
    const result = await completeOnboardingWithVerifiedCustomer(service, state, "900000998", "corr-gate-2");
    assert.equal(result.verifiedCustomerId, null);
    assert.equal(result.warning, "customer_master_projection_unavailable");
    assert.equal(result.state.status, "temporarily_unavailable");
    assert.equal(result.state.customerId, null);
  });
});

test("completeOnboardingWithVerifiedCustomer: a malformed id also lands temporarily_unavailable, never completed with garbage", async () => {
  const { service, state } = await seedResolvingOnboarding();
  const result = await completeOnboardingWithVerifiedCustomer(service, state, "not-a-real-id", "corr-gate-3");
  assert.equal(result.verifiedCustomerId, null);
  assert.equal(result.warning, "customer_master_projection_unavailable");
  assert.equal(result.state.status, "temporarily_unavailable");
});

test("completeOnboardingWithVerifiedCustomer: a projection-check failure leaves onboarding state untouched, distinct warning, never retried automatically", async () => {
  const customerId = await makeCustomer("CheckFailed");
  const { service, state } = await seedResolvingOnboarding();
  const throwingReader: CustomerMasterProjectionReader = { async exists() { throw new Error("ETIMEDOUT"); } };
  const result = await completeOnboardingWithVerifiedCustomer(service, state, String(customerId), "corr-gate-4", { projectionReader: throwingReader });
  assert.equal(result.verifiedCustomerId, null);
  assert.equal(result.warning, "customer_master_projection_check_failed");
  assert.equal(result.state.status, "resolving", "state is untouched on a check failure - never transitioned");

  const reloaded = await service.getState(state.conversationId);
  assert.equal(reloaded?.status, "resolving", "no DB write happened either");
});

test("warnings never carry raw error text, SQL, or stack traces", async () => {
  const { service, state } = await seedResolvingOnboarding();
  const throwingReader: CustomerMasterProjectionReader = {
    async exists() {
      throw new Error("SELECT * FROM master_customer WHERE id = 'x' -- syntax error near line 42\n    at Object.query (mysql2/promise.js:88:11)");
    }
  };
  const result = await completeOnboardingWithVerifiedCustomer(service, state, "1", "corr-gate-5", { projectionReader: throwingReader });
  assert.equal(result.warning, "customer_master_projection_check_failed");
  assert.doesNotMatch(String(result.warning), /select|sql|syntax|at object|mysql2/i);
});

// ---------------------------------------------------------------------------
// Structural: ACS never writes master_customer from the identity/onboarding runtime
// ---------------------------------------------------------------------------

test("structural: the customer session / onboarding transitions / identity capability modules never INSERT or UPDATE master_customer", () => {
  const dir = join(__dirname, "..", "..", "lib", "brain", "commercial");
  const files = [
    join(dir, "native-cycle", "customer-session", "onboardingTransitions.ts"),
    join(dir, "native-cycle", "customer-session", "resolveNativeCustomerSession.ts"),
    join(dir, "native-cycle", "customer-session", "runCustomerOnboardingPostPlanStage.ts"),
    join(dir, "capability-gateway", "customerIdentityCapabilities.ts")
  ];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /INSERT\s+INTO\s+master_customer/i, file);
    assert.doesNotMatch(source, /UPDATE\s+master_customer/i, file);
    assert.doesNotMatch(source, /createMasterCustomer\s*\(/, file);
  }
});

test("structural: no new migration file was added by T08.1 - the projection reader only reads", () => {
  const migrationsDir = join(__dirname, "..", "..", "migrations");
  const files = readdirSync(migrationsDir);
  const versions = files.map((file) => Number(file.split("_")[0])).filter((value) => !Number.isNaN(value));
  assert.equal(Math.max(...versions), 24);
  const projectionSource = readFileSync(join(__dirname, "..", "..", "lib", "domains", "customer-service", "customerMasterProjection.ts"), "utf8");
  assert.doesNotMatch(projectionSource, /INSERT\s+INTO|UPDATE\s+master_customer|DELETE\s+FROM/i);
});
