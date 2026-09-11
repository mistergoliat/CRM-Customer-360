import { createOfflineScriptedProvider } from "../offlineProvider";
import { createInstrumentedProvider } from "../instrumentedProvider";
import { createLiveBenchmarkProvider } from "../liveProvider";
import type { LiveBenchmarkProviderConfig } from "../liveProvider";
import type { BenchmarkProviderCallRecord } from "../types";
import { runGoldenTurnCase } from "./runGoldenTurnCase";
import { runGoldenDecisionCase } from "./runGoldenDecisionCase";
import type { GoldenCase, GoldenRunMode, GoldenRunResult, GoldenRunSummary } from "./types";

export type RunGoldenSuiteOptions =
  | { mode: "offline"; runsPerCase: number }
  | { mode: "live"; runsPerCase: number; liveConfig: LiveBenchmarkProviderConfig };

async function runOneCase(testCase: GoldenCase, mode: GoldenRunMode, liveConfig: LiveBenchmarkProviderConfig | undefined, runIndex: number): Promise<GoldenRunResult> {
  if (testCase.mode === "turn") {
    return runGoldenTurnCase(testCase, mode, liveConfig, runIndex);
  }

  const providerCalls: BenchmarkProviderCallRecord[] = [];
  const innerProvider = mode === "offline" ? createOfflineScriptedProvider([testCase.offlineNextStep]) : createLiveBenchmarkProvider(liveConfig!);
  const provider = createInstrumentedProvider(innerProvider, testCase.caseId, runIndex, providerCalls);
  return runGoldenDecisionCase(testCase, provider, runIndex);
}

/**
 * R3 Stable Agent Acceptance Harness V1. Runs the whole golden corpus,
 * `runsPerCase` times each, sequentially - same discipline as the legacy
 * runCorpus.ts (no concurrent DB/HTTP fixtures for a local benchmark tool
 * with no throughput requirement).
 */
export async function runGoldenSuite(cases: GoldenCase[], options: RunGoldenSuiteOptions): Promise<GoldenRunSummary> {
  const startedAt = new Date().toISOString();
  const results: GoldenRunResult[] = [];

  for (const testCase of cases) {
    for (let runIndex = 0; runIndex < options.runsPerCase; runIndex += 1) {
      const result = await runOneCase(testCase, options.mode, options.mode === "live" ? options.liveConfig : undefined, runIndex);
      results.push(result);
    }
  }

  const finishedAt = new Date().toISOString();
  return {
    mode: options.mode,
    model: options.mode === "live" ? options.liveConfig.model : "benchmark-offline-model",
    runsPerCase: options.runsPerCase,
    startedAt,
    finishedAt,
    results
  };
}
