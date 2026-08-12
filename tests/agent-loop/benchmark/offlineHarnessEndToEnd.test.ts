import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool } from "@/lib/db";
import { runCorpus } from "@/lib/brain/commercial/agent-loop/benchmark/runCorpus";
import { BENCHMARK_CORPUS } from "@/tests/fixtures/agent-loop-benchmark/corpus";

/**
 * LLM-R1-T05, Part C (mandatory): run the full corpus with fake providers as
 * part of the automated suite, proving the harness/expected-results/zero
 * side effects pipeline actually works end to end - not just that its pieces
 * type-check in isolation. select_products/set_shipping_destination have no
 * DI seam for their own durable persistence, so (like every other test that
 * exercises them, e.g. tests/commercial/calculateShippingCapability.test.ts)
 * this hits the same local test MariaDB `npm test` already depends on -
 * never production (see AGENTS.md/CLAUDE.md's explicit provisional Customer
 * 360 rules this repo already operates under).
 */
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

test("[T05] offline benchmark: the full C01-C12 corpus runs end to end and every case's own scripted ground truth passes", async () => {
  const previousCatalogBaseUrl = process.env.CATALOG_SERVICE_BASE_URL;
  const summary = await runCorpus(BENCHMARK_CORPUS, { mode: "offline", runsPerCase: 1 });

  assert.equal(summary.mode, "offline");
  assert.equal(summary.results.length, 12);

  const failures = summary.results.filter((result) => !result.score.overallPass).map((result) => `${result.caseId}: ${result.score.notes.join("; ")}`);
  assert.deepEqual(failures, [], `every corpus case's own offlineScript must satisfy its own groundTruth:\n${failures.join("\n")}`);

  // LLM-R1-T05, Part A safety requirement: teardown must leave the process
  // env exactly as it found it - no benchmark environment can leak a stale
  // Catalog Service pointer into whatever runs after it.
  assert.equal(process.env.CATALOG_SERVICE_BASE_URL, previousCatalogBaseUrl);
});

test("[T05] C11: LLM-R1-T01 structured recovery is exercised and succeeds (bounded to one retry)", async () => {
  const c11 = BENCHMARK_CORPUS.find((testCase) => testCase.caseId === "C11")!;
  const summary = await runCorpus([c11], { mode: "offline", runsPerCase: 1 });
  const [result] = summary.results;

  assert.equal(result.loop.terminalReason, "responded");
  assert.equal(result.loop.llmCalls.length, 2);
  assert.equal(result.loop.llmCalls[0].outcome, "invalid_response");
  assert.equal(result.loop.llmCalls[1].outcome, "success");
  assert.ok(result.loop.warnings.some((warning) => warning.startsWith("agent_loop_structured_recovery_attempted")));
});

test("[T05] C12: persistent invalid_response fails closed after exactly the bounded recovery attempt (no third call)", async () => {
  const c12 = BENCHMARK_CORPUS.find((testCase) => testCase.caseId === "C12")!;
  const summary = await runCorpus([c12], { mode: "offline", runsPerCase: 1 });
  const [result] = summary.results;

  assert.equal(result.loop.terminalReason, "provider_unavailable");
  assert.equal(result.loop.llmCalls.length, 2);
  assert.ok(result.loop.llmCalls.every((call) => call.outcome === "invalid_response"));
  assert.equal(result.providerCalls.length, 2);
});
