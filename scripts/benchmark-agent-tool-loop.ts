/**
 * LLM-R1-T05. Reproducible Agent Tool Loop benchmark CLI.
 *
 * Offline (default, safe, no external calls beyond the local loopback
 * Catalog Service mock this process itself starts):
 *   npx tsx scripts/benchmark-agent-tool-loop.ts
 *   npx tsx scripts/benchmark-agent-tool-loop.ts --runs=10
 *
 * Live (the ONLY external call this script can ever make is to the LLM
 * provider - Catalog/Carrier/WhatsApp/outbox/production DB stay isolated
 * regardless of this flag; disabled unless BENCHMARK_LIVE_LLM_ENABLED=true
 * AND BRAIN_MODEL_API_URL/BRAIN_MODEL_API_KEY are set - see
 * lib/brain/commercial/agent-loop/benchmark/liveProvider.ts):
 *   BENCHMARK_LIVE_LLM_ENABLED=true npx tsx scripts/benchmark-agent-tool-loop.ts --live --runs=10
 *
 * --case=C01,C02   restrict to specific caseIds (default: full corpus)
 * --out=path.json  also write the full raw BenchmarkRunSummary as JSON
 */
import { writeFile } from "node:fs/promises";
import { loadLocalEnv } from "./db-utils";
import { BENCHMARK_CORPUS } from "../tests/fixtures/agent-loop-benchmark/corpus";
import { runCorpus } from "../lib/brain/commercial/agent-loop/benchmark/runCorpus";
import { computeAggregateMetrics, computeMetricsByCase } from "../lib/brain/commercial/agent-loop/benchmark/metrics";
import { isLiveBenchmarkEnabled, resolveLiveBenchmarkProviderConfig } from "../lib/brain/commercial/agent-loop/benchmark/liveProvider";
import { validateBenchmarkCorpus } from "../lib/brain/commercial/agent-loop/benchmark/validateCorpus";
import type { BenchmarkAggregateMetrics } from "../lib/brain/commercial/agent-loop/benchmark/metrics";

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  const raw = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : null;
}

function readFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function formatPercent(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function formatMs(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(0)}ms`;
}

function printMetrics(label: string, metrics: BenchmarkAggregateMetrics) {
  console.log(`\n--- ${label} (runs=${metrics.totalRuns}, provider calls=${metrics.totalProviderCalls}) ---`);
  console.log("Correctness:");
  console.log(`  requiredToolCompletionRate:  ${formatPercent(metrics.correctness.requiredToolCompletionRate)}`);
  console.log(`  forbiddenToolInvocationRate: ${formatPercent(metrics.correctness.forbiddenToolInvocationRate)}`);
  console.log(`  toolArgumentAccuracy:        ${formatPercent(metrics.correctness.toolArgumentAccuracy)}`);
  console.log(`  terminalReasonCorrectness:   ${formatPercent(metrics.correctness.terminalReasonCorrectness)}`);
  console.log(`  overallPassRate:             ${formatPercent(metrics.correctness.overallPassRate)}`);
  console.log("Structural robustness:");
  console.log(`  validAgentStepRate:              ${formatPercent(metrics.structuralRobustness.validAgentStepRate)}`);
  console.log(`  invalidResponseRate:             ${formatPercent(metrics.structuralRobustness.invalidResponseRate)}`);
  console.log(`  emptyResponseRate:               ${formatPercent(metrics.structuralRobustness.emptyResponseRate)}`);
  console.log(`  invalidModelJsonRate:            ${formatPercent(metrics.structuralRobustness.invalidModelJsonRate)}`);
  console.log(`  invalidJsonEnvelopeRate:         ${formatPercent(metrics.structuralRobustness.invalidJsonEnvelopeRate)}`);
  console.log(`  structuredRecoveryActivationRate:${formatPercent(metrics.structuralRobustness.structuredRecoveryActivationRate)}`);
  console.log(`  structuredRecoverySuccessRate:   ${formatPercent(metrics.structuralRobustness.structuredRecoverySuccessRate)}`);
  console.log(`  schemaRepairActivationRate:      ${formatPercent(metrics.structuralRobustness.schemaRepairActivationRate)}`);
  console.log(`  schemaRepairSuccessRate:         ${formatPercent(metrics.structuralRobustness.schemaRepairSuccessRate)}`);
  console.log("Latency:");
  console.log(`  LLM calls/turn avg/max:      ${metrics.latency.llmCallsPerTurnAvg?.toFixed(2) ?? "n/a"} / ${metrics.latency.llmCallsPerTurnMax ?? "n/a"}`);
  console.log(`  LLM call latency p50/p95:    ${formatMs(metrics.latency.llmCallLatencyMsP50)} / ${formatMs(metrics.latency.llmCallLatencyMsP95)}`);
  console.log(`  Complete turn latency p50/p95: ${formatMs(metrics.latency.completeTurnLatencyMsP50)} / ${formatMs(metrics.latency.completeTurnLatencyMsP95)}`);
  console.log(`  LLM total ms/completed turn: ${formatMs(metrics.latency.llmTotalMsPerCompletedTurnAvg)}`);
  console.log("Tokens:");
  console.log(`  inputTokens/call avg:  ${metrics.tokens.inputTokensPerCallAvg?.toFixed(1) ?? "n/a"}`);
  console.log(`  outputTokens/call avg: ${metrics.tokens.outputTokensPerCallAvg?.toFixed(1) ?? "n/a"}`);
  console.log(`  usageComplete: ${metrics.tokens.usageComplete}`);
  console.log("Finish reasons:", metrics.finishReasonCounts);
}

async function main() {
  // select_products/set_shipping_destination have no DI seam for their own
  // durable persistence (see environment.ts) - they hit the same local test
  // DB every other DB-backed test in this repo already uses. Reuse the
  // repo's own dev-local env loader (scripts/db-utils.ts) instead of
  // hardcoding credentials here.
  await loadLocalEnv();

  const runsPerCase = Math.max(1, Number.parseInt(readArg("runs") ?? "1", 10) || 1);
  const wantsLive = readFlag("live");
  const caseFilter = readArg("case")?.split(",").map((value) => value.trim());
  const outPath = readArg("out");

  const corpusValidation = validateBenchmarkCorpus(BENCHMARK_CORPUS);
  if (!corpusValidation.ok) {
    console.error("[benchmark] corpus fixture is invalid, refusing to run:");
    for (const error of corpusValidation.errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }

  const cases = caseFilter ? BENCHMARK_CORPUS.filter((testCase) => caseFilter.includes(testCase.caseId)) : BENCHMARK_CORPUS;
  if (cases.length === 0) {
    console.error(`No corpus cases matched --case=${caseFilter?.join(",")}`);
    process.exitCode = 1;
    return;
  }

  if (!wantsLive) {
    console.log(`[benchmark] mode=offline runsPerCase=${runsPerCase} cases=${cases.map((testCase) => testCase.caseId).join(",")}`);
    const summary = await runCorpus(cases, { mode: "offline", runsPerCase });
    printMetrics("OFFLINE aggregate", computeAggregateMetrics(summary.results));
    for (const [caseId, metrics] of computeMetricsByCase(summary.results)) printMetrics(`case ${caseId}`, metrics);
    if (outPath) await writeFile(outPath, JSON.stringify(summary, null, 2), "utf8");
    return;
  }

  // LLM-R1-T05, Part D. Live mode is REJECTED unless the gate + full config
  // resolve - never silently falls back to offline just because --live was
  // passed without the environment actually authorizing it.
  if (!isLiveBenchmarkEnabled()) {
    console.error("[benchmark] --live was requested but BENCHMARK_LIVE_LLM_ENABLED is not \"true\" - REJECTED. Live LLM calls are opt-in only.");
    process.exitCode = 1;
    return;
  }
  const resolution = resolveLiveBenchmarkProviderConfig();
  if (!resolution.ok) {
    console.error(`[benchmark] --live REJECTED: ${resolution.reason}. Set BRAIN_MODEL_API_URL/BRAIN_MODEL_API_KEY and BENCHMARK_LIVE_LLM_MODEL (or BRAIN_MODEL_NAME).`);
    process.exitCode = 1;
    return;
  }

  console.log(`[benchmark] mode=live model=${resolution.config.model} runsPerCase=${runsPerCase} cases=${cases.map((testCase) => testCase.caseId).join(",")}`);
  console.log("[benchmark] Catalog/Carrier/commune/DB stay fully isolated - only the LLM provider call is real.");
  const summary = await runCorpus(cases, { mode: "live", runsPerCase, liveConfig: resolution.config });
  printMetrics(`LIVE aggregate (${resolution.config.model})`, computeAggregateMetrics(summary.results));
  for (const [caseId, metrics] of computeMetricsByCase(summary.results)) printMetrics(`case ${caseId}`, metrics);
  if (outPath) await writeFile(outPath, JSON.stringify(summary, null, 2), "utf8");
}

main().catch((error) => {
  console.error("[benchmark] fatal error:", error);
  process.exitCode = 1;
});
