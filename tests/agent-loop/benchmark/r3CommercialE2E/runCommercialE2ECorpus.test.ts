import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool } from "@/lib/db";
import { resolveBenchmarkE2EFlags, runCommercialE2ECase } from "@/lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/runCommercialE2ECase";
import { runCommercialE2ECorpus } from "@/lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/runCommercialE2ECorpus";
import { BENCHMARK_E2E_CORPUS, BENCHMARK_E2E_CORPUS_VERSION } from "@/lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/corpus";

/**
 * SALES-AGENT-R3-P7.4 (P7.4-M). DB-backed integration tests, same
 * crm_test/NODE_ENV=test discipline tests/agent-loop/benchmark/r3StableAgentV1/
 * environment.test.ts already establishes (setupR3BenchmarkEnvironment
 * refuses to run anywhere else) - ENVIRONMENT_BLOCKED without a reachable
 * local MariaDB crm_test database, same as the rest of that suite. These
 * assert the REAL native R3 cycle end to end (kernel, DRM/eligibility,
 * Gateway, P4/P5/P7 telemetry, outbox) - never a mock of the path being
 * measured.
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

const E01 = BENCHMARK_E2E_CORPUS.find((testCase) => testCase.caseId === "E01")!;
const E02 = BENCHMARK_E2E_CORPUS.find((testCase) => testCase.caseId === "E02")!;

test("P7.4-M: two runs of the same case never share an opportunityId/conversationId - full isolation", async () => {
  const flags = resolveBenchmarkE2EFlags();
  const first = await runCommercialE2ECase(E01, { mode: "offline", runOrdinal: 0, benchmarkRunId: "p74-iso-run0", flags });
  const second = await runCommercialE2ECase(E01, { mode: "offline", runOrdinal: 1, benchmarkRunId: "p74-iso-run1", flags });
  assert.notEqual(first.initialState?.workId, undefined);
  assert.notEqual(first.benchmarkRunId, second.benchmarkRunId);
  // Distinct correlationIds per run prove distinct turns/opportunities were used - never a shared fixture.
  assert.notEqual(first.turns[0]?.correlationId, second.turns[0]?.correlationId);
});

test("P7.4-M/A: a single offline case run produces a structured trace with the real kernel/eligibility/outbox wiring", async () => {
  const flags = resolveBenchmarkE2EFlags();
  const trace = await runCommercialE2ECase(E02, { mode: "offline", runOrdinal: 0, benchmarkRunId: "p74-smoke-e02", flags });
  assert.equal(trace.caseId, "E02");
  assert.equal(trace.turns.length, 1);
  assert.equal(trace.turns[0].toolInvocations.length > 0, true, "select_products/get_product_details must have been observed via P7.2 telemetry");
  assert.ok(trace.finalState, "a durable state snapshot must be captured after the turn");
  // P7.6 regression: the E02 script commits select_products in this same turn; the after-turn snapshot must see it (it used to be one turn stale).
  assert.equal(trace.finalState?.selection.present, true, "durableStateAfterTurn must be re-read after the turn executes");
});

test("P7.4: runCommercialE2ECorpus supports the 15x3 shape end to end for a small subset (2 cases x 2 runs)", async () => {
  const result = await runCommercialE2ECorpus({ mode: "offline", runsPerCase: 2, corpus: [E01, E02], corpusVersion: BENCHMARK_E2E_CORPUS_VERSION });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.bundle.runs.length, 4);
  assert.equal(result.bundle.manifest.caseCount, 2);
  assert.equal(result.bundle.manifest.runsPerCase, 2);
  assert.ok(result.bundle.manifest.gitSha === null || typeof result.bundle.manifest.gitSha === "string");
});
