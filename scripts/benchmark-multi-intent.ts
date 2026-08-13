/**
 * LLM-R1-T09A. Reproducible Multi-Intent Planner benchmark CLI (MI01-MI06).
 * Mirrors scripts/benchmark-agent-tool-loop.ts exactly - see that file's own
 * header for the offline/live/--case/--out contract, unchanged here.
 *
 * Offline (default, safe, no external calls beyond the local loopback
 * Catalog Service mock this process itself starts):
 *   npx tsx scripts/benchmark-multi-intent.ts
 *
 * Live (the ONLY external call this script can ever make is to the LLM
 * provider - Catalog/Carrier/commune/DB stay isolated regardless of this
 * flag; disabled unless BENCHMARK_LIVE_LLM_ENABLED=true AND
 * BRAIN_MODEL_API_URL/BRAIN_MODEL_API_KEY are set):
 *   BENCHMARK_LIVE_LLM_ENABLED=true BENCHMARK_LIVE_LLM_THINKING=disabled npx tsx scripts/benchmark-multi-intent.ts --live --runs=5
 */
import { writeFile } from "node:fs/promises";
import { getPool } from "../lib/db";
import { loadLocalEnv } from "./db-utils";
import { MULTI_INTENT_BENCHMARK_CORPUS } from "../lib/brain/commercial/agent-loop/benchmark/multiIntent/corpus";
import { runMultiIntentCorpus } from "../lib/brain/commercial/agent-loop/benchmark/multiIntent/runMultiIntentCorpus";
import { computeAggregateMetrics, computeMetricsByCase } from "../lib/brain/commercial/agent-loop/benchmark/metrics";
import { isLiveBenchmarkEnabled, resolveLiveBenchmarkProviderConfig } from "../lib/brain/commercial/agent-loop/benchmark/liveProvider";
import type { BenchmarkAggregateMetrics } from "../lib/brain/commercial/agent-loop/benchmark/metrics";
import type { BenchmarkRunSummary } from "../lib/brain/commercial/agent-loop/benchmark/types";

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
  console.log(`  terminalReasonCorrectness:   ${formatPercent(metrics.correctness.terminalReasonCorrectness)}`);
  console.log(`  overallPassRate (== multiIntentResolutionRate for this corpus - see docs): ${formatPercent(metrics.correctness.overallPassRate)}`);
  console.log(`  unbackedCommercialMutationClaimRate: ${formatPercent(metrics.correctness.unbackedCommercialMutationClaimRate)}`);
  console.log("Latency:");
  console.log(`  LLM calls/turn avg/max:      ${metrics.latency.llmCallsPerTurnAvg?.toFixed(2) ?? "n/a"} / ${metrics.latency.llmCallsPerTurnMax ?? "n/a"}`);
  console.log(`  LLM call latency p50/p95:    ${formatMs(metrics.latency.llmCallLatencyMsP50)} / ${formatMs(metrics.latency.llmCallLatencyMsP95)}`);
  console.log(`  Complete turn latency p50/p95: ${formatMs(metrics.latency.completeTurnLatencyMsP50)} / ${formatMs(metrics.latency.completeTurnLatencyMsP95)}`);
  console.log("Finish reasons:", metrics.finishReasonCounts);
}

function computeTimeoutRate(summary: BenchmarkRunSummary): number {
  const timeouts = summary.results.filter((result) => result.loop.terminalReason === "timeout").length;
  return summary.results.length === 0 ? 0 : timeouts / summary.results.length;
}

async function main() {
  await loadLocalEnv();

  try {
    const runsPerCase = Math.max(1, Number.parseInt(readArg("runs") ?? "1", 10) || 1);
    const wantsLive = readFlag("live");
    const caseFilter = readArg("case")?.split(",").map((value) => value.trim());
    const outPath = readArg("out");

    const cases = caseFilter ? MULTI_INTENT_BENCHMARK_CORPUS.filter((testCase) => caseFilter.includes(testCase.caseId)) : MULTI_INTENT_BENCHMARK_CORPUS;
    if (cases.length === 0) {
      console.error(`No corpus cases matched --case=${caseFilter?.join(",")}`);
      process.exitCode = 1;
      return;
    }

    if (!wantsLive) {
      console.log(`[mi-benchmark] mode=offline runsPerCase=${runsPerCase} cases=${cases.map((testCase) => testCase.caseId).join(",")}`);
      const summary = await runMultiIntentCorpus(cases, { mode: "offline", runsPerCase });
      printMetrics("OFFLINE aggregate", computeAggregateMetrics(summary.results));
      for (const [caseId, metrics] of computeMetricsByCase(summary.results)) printMetrics(`case ${caseId}`, metrics);
      console.log(`\ntimeoutRate: ${formatPercent(computeTimeoutRate(summary))}`);
      if (outPath) await writeFile(outPath, JSON.stringify(summary, null, 2), "utf8");
      return;
    }

    if (!isLiveBenchmarkEnabled()) {
      console.error("[mi-benchmark] --live was requested but BENCHMARK_LIVE_LLM_ENABLED is not \"true\" - REJECTED. Live LLM calls are opt-in only.");
      process.exitCode = 1;
      return;
    }
    const resolution = resolveLiveBenchmarkProviderConfig();
    if (!resolution.ok) {
      console.error(`[mi-benchmark] --live REJECTED: ${resolution.reason}. Set BRAIN_MODEL_API_URL/BRAIN_MODEL_API_KEY and BENCHMARK_LIVE_LLM_MODEL (or BRAIN_MODEL_NAME).`);
      process.exitCode = 1;
      return;
    }

    console.log(
      `[mi-benchmark] mode=live model=${resolution.config.model} thinking=${resolution.config.thinking ?? "(provider default)"} runsPerCase=${runsPerCase} cases=${cases.map((testCase) => testCase.caseId).join(",")}`
    );
    console.log("[mi-benchmark] Catalog/Carrier/commune/DB stay fully isolated - only the LLM provider call is real.");
    const summary = await runMultiIntentCorpus(cases, { mode: "live", runsPerCase, liveConfig: resolution.config });
    printMetrics(`LIVE aggregate (${resolution.config.model})`, computeAggregateMetrics(summary.results));
    for (const [caseId, metrics] of computeMetricsByCase(summary.results)) printMetrics(`case ${caseId}`, metrics);
    console.log(`\ntimeoutRate: ${formatPercent(computeTimeoutRate(summary))}`);
    if (outPath) await writeFile(outPath, JSON.stringify(summary, null, 2), "utf8");
  } finally {
    try {
      await getPool().end();
    } catch {
      // ignore pool teardown failures - the benchmark's own result already printed
    }
  }
}

main().catch((error) => {
  console.error("[mi-benchmark] fatal error:", error);
  process.exitCode = 1;
});
