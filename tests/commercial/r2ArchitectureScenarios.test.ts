import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool } from "@/lib/db";
import { setupR2BenchmarkEnvironment } from "@/lib/brain/commercial/work/benchmark/environment";
import { runR2Scenario } from "@/lib/brain/commercial/work/benchmark/runR2Scenario";
import { scoreR2Scenario } from "@/lib/brain/commercial/work/benchmark/scoring";
import { computeR2AggregateMetrics } from "@/lib/brain/commercial/work/benchmark/metrics";
import { createOfflinePlannerProvider, type OfflinePlannerScriptStep } from "@/lib/brain/commercial/work/benchmark/offlinePlannerProvider";
import { R2_ARCHITECTURE_CORPUS } from "../fixtures/commercial-work-benchmark/corpus";
import type { R2ScenarioRunResult } from "@/lib/brain/commercial/work/benchmark/types";

/**
 * SALES-AGENT-R2-A07.5, stage 2. R2-01..R2-09/R2-12 against the real
 * CommercialWork pipeline (real crm_test DB, real fake catalog/carrier via
 * setupR2BenchmarkEnvironment, real executor/worker) with a deterministic
 * offline scripted planner - no live LLM dependency for this stage (the
 * live comparison is a separate, later stage). This file starts with
 * R2-01..R2-04 (checkpoint 4); later scenarios are added in subsequent
 * checkpoints of the same task.
 */

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "crm_test",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true"
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore teardown failures
  }
});

/** Deterministic stand-in for what the real planner LLM would emit for each scenario's own customer message, one script entry per turn. */
const OFFLINE_PLANS: Record<string, OfflinePlannerScriptStep[]> = {
  "R2-01": [{ kind: "plan", plan: { intents: [{ type: "select_products", productReference: "la classic", quantity: 2 }] } }],
  "R2-02": [{ kind: "plan", plan: { intents: [{ type: "select_products", productReference: "la classic", quantity: 2 }, { type: "get_shipping_quote", destination: "Nunoa" }] } }],
  "R2-03": [{ kind: "plan", plan: { intents: [{ type: "select_products", productReference: "la classic", quantity: 2 }, { type: "get_shipping_quote" }] } }],
  "R2-04": [
    { kind: "plan", plan: { intents: [{ type: "select_products", productReference: "la classic", quantity: 2 }, { type: "get_shipping_quote" }] } },
    { kind: "plan", plan: { intents: [{ type: "get_shipping_quote", destination: "Nunoa" }] } }
  ],
  "R2-05": [{ kind: "plan", plan: { intents: [{ type: "get_shipping_quote" }] } }],
  // R2-06/R2-09 use directObjectiveSeeds (no planner intent exists for create_quote) - no offline plan needed.
  "R2-07": [{ kind: "plan", plan: { intents: [{ type: "select_products", productReference: "la barra", quantity: 1 }] } }],
  "R2-08": [
    { kind: "plan", plan: { intents: [{ type: "select_products", productReference: "la classic", quantity: 2 }, { type: "get_shipping_quote", destination: "Nunoa" }] } },
    { kind: "plan", plan: { intents: [{ type: "select_products", productReference: "la classic", quantity: 3 }] } }
  ],
  "R2-12": [{ kind: "plan", plan: { intents: [{ type: "select_products", productReference: "la classic", quantity: 2 }, { type: "get_shipping_quote", destination: "Nunoa" }] } }]
};

const results: R2ScenarioRunResult[] = [];

for (const scenario of R2_ARCHITECTURE_CORPUS) {
  test(`${scenario.scenarioId} ${scenario.description}`, async () => {
    const env = await setupR2BenchmarkEnvironment();
    try {
      const needsPlanner = scenario.customerTurns.some((turn) => !turn.directObjectiveSeeds);
      const script = OFFLINE_PLANS[scenario.scenarioId];
      if (needsPlanner) assert.ok(script, `no offline plan script registered for ${scenario.scenarioId}`);
      const provider = createOfflinePlannerProvider(script ?? []);

      const outcome = await runR2Scenario({ scenario, env, provider, runIndex: 0 });
      const score = scoreR2Scenario(scenario, outcome);
      results.push({ scenario, outcome, score });

      assert.equal(score.lostObjectiveCount, 0, `${scenario.scenarioId}: lost commercial work (lostObjectiveCount=${score.lostObjectiveCount})`);
      assert.equal(score.duplicateSideEffect, false, `${scenario.scenarioId}: duplicate side effect detected`);
      assert.equal(score.unbackedMutationClaim, false, `${scenario.scenarioId}: unbacked commercial mutation claim detected`);
      assert.equal(score.staleEvidenceExecuted, false, `${scenario.scenarioId}: stale evidence was executed against`);
      assert.equal(score.objectiveDetectionCorrect, true, `${scenario.scenarioId}: objective detection mismatch`);
      assert.equal(score.requirementResolutionCorrect, true, `${scenario.scenarioId}: requirement resolution mismatch`);
      assert.equal(score.workGraphCorrect, true, `${scenario.scenarioId}: work graph mismatch (work=${JSON.stringify({ status: outcome.finalWork?.status, objectives: outcome.finalWork?.objectives.map((o) => ({ type: o.type, status: o.status })), steps: outcome.finalWork?.steps.map((s) => ({ type: s.type, status: s.status })) })})`);
      assert.equal(score.durableRemainingWorkCorrect, true, `${scenario.scenarioId}: durable facts mismatch`);
      assert.equal(score.overallPass, true, `${scenario.scenarioId}: overall pass expected`);
    } finally {
      await env.teardown();
    }
  });
}

test("R2-01..R2-04: the four critical architecture invariants hold in aggregate", () => {
  assert.equal(results.length, R2_ARCHITECTURE_CORPUS.length, "not every scenario test ran before the aggregate check");
  const metrics = computeR2AggregateMetrics(results);
  assert.equal(metrics.architecture.lostCommercialWorkRate, 0);
  assert.equal(metrics.architecture.unbackedCommercialMutationClaimRate, 0);
  assert.equal(metrics.architecture.duplicateSideEffectRate, 0);
  assert.equal(metrics.architecture.staleEvidenceExecutionRate, 0);
});
