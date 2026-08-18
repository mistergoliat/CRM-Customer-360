/**
 * SALES-AGENT-R2-A07.5, Part 5/9 stage 4. Focused C09-equivalent comparison:
 * legacy Agent Tool Loop (Harness A) vs the R2 CommercialWork path (Harness
 * B), same customer message/fixture catalog identity, both DETERMINISTIC/
 * offline (this sandboxed environment has no live LLM credentials/network -
 * BENCHMARK_LIVE_LLM_ENABLED/DEEPSEEK_API_KEY are both absent, confirmed).
 * This is real, executed, offline-scripted output, not fabricated - but it
 * is NOT the live-model comparison the full task asks for; that stage is
 * documented as blocked by this environment's missing credentials, same
 * limitation LLM-R1-T09A/T09B already recorded for their own live smokes.
 *
 * Usage: npx tsx@4.20.5 scripts/compare-legacy-vs-r2-c09.ts
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

import { runBenchmarkCase } from "@/lib/brain/commercial/agent-loop/benchmark/runCorpus";
import { BENCHMARK_CORPUS } from "../tests/fixtures/agent-loop-benchmark/corpus";
import { setupR2BenchmarkEnvironment } from "@/lib/brain/commercial/work/benchmark/environment";
import { runR2Scenario } from "@/lib/brain/commercial/work/benchmark/runR2Scenario";
import { scoreR2Scenario } from "@/lib/brain/commercial/work/benchmark/scoring";
import { createOfflinePlannerProvider } from "@/lib/brain/commercial/work/benchmark/offlinePlannerProvider";
import { R2_ARCHITECTURE_CORPUS } from "../tests/fixtures/commercial-work-benchmark/corpus";
import { getPool } from "@/lib/db";

async function runLegacyC09() {
  const c09 = BENCHMARK_CORPUS.find((c) => c.caseId === "C09");
  if (!c09) throw new Error("C09 not found in legacy corpus");
  const result = await runBenchmarkCase(c09, "offline", undefined, { maxDecisions: 3, maxToolExecutions: 3, timeoutMs: 20_000 }, 0);
  return {
    llmCalls: result.providerCalls.length,
    toolExecutions: result.loop.toolExecutionCount,
    selectionCompleted: result.loop.steps.some((record) => record.step.type === "use_tool" && record.step.tool === "select_products" && record.observation?.status === "completed"),
    destinationCompleted: result.loop.steps.some((record) => record.step.type === "use_tool" && record.step.tool === "set_shipping_destination" && record.observation?.status === "completed"),
    shippingCompleted: result.loop.steps.some((record) => record.step.type === "use_tool" && record.step.tool === "calculate_shipping" && record.observation?.status === "completed"),
    remainingWorkDurable: false, // the legacy loop has no CommercialWork/durable representation of unresolved intent - structurally always false
    terminalReason: result.loop.terminalReason,
    finalMessage: result.loop.finalMessage,
    turnLatencyMs: result.totalElapsedMs
  };
}

async function runR2C09() {
  const scenario = R2_ARCHITECTURE_CORPUS.find((s) => s.scenarioId === "R2-02");
  if (!scenario) throw new Error("R2-02 not found in R2 corpus");
  const env = await setupR2BenchmarkEnvironment();
  try {
    const provider = createOfflinePlannerProvider([
      { kind: "plan", plan: { intents: [{ type: "select_products", productReference: "la classic", quantity: 2 }, { type: "get_shipping_quote", destination: "Nunoa" }] } }
    ]);
    const outcome = await runR2Scenario({ scenario, env, provider, runIndex: 0 });
    const score = scoreR2Scenario(scenario, outcome);
    const work = outcome.finalWork;
    return {
      llmCalls: outcome.llmCallCount,
      capabilityExecutions: outcome.capabilityCalls.length,
      selectionCompleted: work?.objectives.some((o) => o.type === "SELECT_PRODUCTS" && o.status === "COMPLETED") ?? false,
      destinationCompleted: work?.objectives.some((o) => o.type === "SET_DESTINATION" && o.status === "COMPLETED") ?? false,
      shippingCompleted: work?.objectives.some((o) => o.type === "GET_SHIPPING_QUOTE" && o.status === "COMPLETED") ?? false,
      remainingWorkDurable: (score.lostObjectiveCount === 0),
      lostObjectiveCount: score.lostObjectiveCount,
      workStatus: work?.status ?? null,
      turnLatencyMs: outcome.turnLatencyMs,
      commercialCompletionLatencyMs: outcome.commercialCompletionLatencyMs
    };
  } finally {
    await env.teardown();
  }
}

async function main() {
  console.log("Running legacy C09 (Harness A, offline)...");
  const legacy = await runLegacyC09();
  console.log("Running R2-02/C09-equivalent (Harness B, offline)...");
  const r2 = await runR2C09();

  console.log(JSON.stringify({ legacy, r2 }, null, 2));
  await getPool().end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
