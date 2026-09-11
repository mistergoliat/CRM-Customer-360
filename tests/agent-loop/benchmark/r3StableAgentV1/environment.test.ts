import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool } from "@/lib/db";
import { setupR3BenchmarkEnvironment } from "@/lib/brain/commercial/agent-loop/benchmark/r3StableAgentV1/environment";
import { seedBenchmarkSelection, seedBenchmarkShippingDestination, seedDurableBenchmarkConversation } from "@/lib/brain/commercial/agent-loop/benchmark/environment";
import { executeGovernedCapability } from "@/lib/brain/commercial/capability-gateway/executeCapability";

/**
 * R3 Stable Agent Acceptance Harness V1 FIX1. Proves setupR3BenchmarkEnvironment
 * actually fixes the fixture-setup failure the live baseline hit (TS-005:
 * "a tool call was rejected for structurally malformed arguments; required
 * tool(s) never completed: select_shipping_option" - root cause traced to
 * insertCapabilityExecution silently swallowing a foreign key violation
 * (crm_capability_executions.conversation_id/opportunity_id, migration 022)
 * because the legacy setupBenchmarkEnvironment's ids were never persisted).
 * Runs against crm_test only - the module under test itself refuses to run
 * anywhere else (see assertCrmTestDurableFixtureIsSafe in environment.ts).
 */
Object.assign(process.env, {
  NODE_ENV: "test",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "crm_test",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "crm_test",
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

test("[R3-FIX1-A/B] setupR3BenchmarkEnvironment returns an opportunityId and conversationId that exist durably in crm_test", async () => {
  const env = await setupR3BenchmarkEnvironment();
  try {
    const [oppRows] = await getPool().query("SELECT id FROM crm_opportunities WHERE id = ?", [env.opportunityId]);
    const [convRows] = await getPool().query("SELECT id FROM conversation WHERE id = ?", [env.conversationId]);
    assert.equal((oppRows as unknown[]).length, 1, "opportunityId must reference a real crm_opportunities row");
    assert.equal((convRows as unknown[]).length, 1, "conversationId must reference a real conversation row");
  } finally {
    await env.teardown();
  }
});

test("[R3-FIX1-C] seedBenchmarkSelection succeeds against a setupR3BenchmarkEnvironment opportunityId", async () => {
  const env = await setupR3BenchmarkEnvironment();
  try {
    await assert.doesNotReject(seedBenchmarkSelection(env.opportunityId, [{ productId: "31", quantity: 1 }]));
  } finally {
    await env.teardown();
  }
});

test("[R3-FIX1-D] seedBenchmarkShippingDestination succeeds against a setupR3BenchmarkEnvironment opportunityId", async () => {
  const env = await setupR3BenchmarkEnvironment();
  try {
    await assert.doesNotReject(seedBenchmarkShippingDestination(env.opportunityId, "Ñuñoa"));
  } finally {
    await env.teardown();
  }
});

test("[R3-FIX1-E] a crm_capability_executions row can legally reference the environment's conversationId/opportunityId (the TS-005 evidence path)", async () => {
  const env = await setupR3BenchmarkEnvironment();
  try {
    await seedBenchmarkSelection(env.opportunityId, [{ productId: "31", quantity: 1 }]);
    await seedBenchmarkShippingDestination(env.opportunityId, "Ñuñoa");

    const result = await executeGovernedCapability(
      "calculate_shipping",
      {},
      { correlationId: `r3-fix1-test-${env.opportunityId}`, opportunityId: env.opportunityId, conversationId: env.conversationId }
    );

    // Before the fix this silently returned status "completed" with
    // executionPublicId null - insertCapabilityExecution's FK insert failed
    // and safeExecute swallowed it rather than throwing. A non-null
    // executionPublicId is the proof the row actually landed.
    assert.equal(result.status, "completed");
    assert.ok(result.executionPublicId, "the capability execution must have actually persisted a public_id, not silently failed its FK insert");

    const [rows] = await getPool().query(
      "SELECT id FROM crm_capability_executions WHERE conversation_id = ? AND opportunity_id = ? AND capability_name = 'calculate_shipping'",
      [env.conversationId, env.opportunityId]
    );
    assert.equal((rows as unknown[]).length, 1, "exactly one durable crm_capability_executions row must reference this conversationId/opportunityId");
  } finally {
    await env.teardown();
  }
});

test("[R3-FIX1-F] teardown never touches rows outside this fixture's own ownership", async () => {
  const unrelated = await seedDurableBenchmarkConversation();

  const env = await setupR3BenchmarkEnvironment();
  await env.teardown();

  const [unrelatedRows] = await getPool().query("SELECT id FROM conversation WHERE id = ?", [unrelated.id]);
  assert.equal((unrelatedRows as unknown[]).length, 1, "teardown must never delete a conversation row it does not own");

  const [ownRows] = await getPool().query("SELECT id FROM conversation WHERE id = ?", [env.conversationId]);
  assert.equal((ownRows as unknown[]).length, 1, "documented convention: this fixture's own rows are also left in crm_test, uniquely marked, never force-deleted");
});

test("[R3-FIX1-SAFETY] refuses to run outside NODE_ENV=test", async () => {
  const previous = { ...process.env };
  try {
    Object.assign(process.env, { NODE_ENV: "development" });
    await assert.rejects(setupR3BenchmarkEnvironment(), /NODE_ENV must be "test"/);
  } finally {
    process.env = previous;
  }
});

test("[R3-FIX1-SAFETY] refuses to run outside database=crm_test (never falls back to main_management)", async () => {
  const previous = { ...process.env };
  try {
    process.env.DB_NAME = "main_management";
    process.env.DATABASE_NAME = "main_management";
    await assert.rejects(setupR3BenchmarkEnvironment(), /crm_test/);
  } finally {
    process.env = previous;
  }
});
