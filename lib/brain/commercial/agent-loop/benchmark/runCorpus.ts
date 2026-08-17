import { randomUUID } from "node:crypto";
import { DEFAULT_MAX_DECISIONS, DEFAULT_MAX_TOOL_EXECUTIONS, DEFAULT_TIMEOUT_MS, runAgentToolLoop } from "../runAgentToolLoop";
import { setupBenchmarkEnvironment } from "./environment";
import { createOfflineScriptedProvider } from "./offlineProvider";
import { createInstrumentedProvider } from "./instrumentedProvider";
import { createLiveBenchmarkProvider, type LiveBenchmarkProviderConfig } from "./liveProvider";
import { scoreCase } from "./scoring";
import { buildBenchmarkTurnTrace } from "./trace";
import type { BenchmarkCase, BenchmarkLoopConfiguration, BenchmarkLoopOverrides, BenchmarkProviderCallRecord, BenchmarkRunMode, BenchmarkRunSummary, BenchmarkTurnResult } from "./types";

export type RunCorpusOptions =
  | { mode: "offline"; runsPerCase: number; loopOverrides?: BenchmarkLoopOverrides }
  | { mode: "live"; runsPerCase: number; liveConfig: LiveBenchmarkProviderConfig; loopOverrides?: BenchmarkLoopOverrides };

function resolveLoopConfiguration(overrides: BenchmarkLoopOverrides | undefined): BenchmarkLoopConfiguration {
  return {
    maxDecisions: overrides?.maxDecisions ?? DEFAULT_MAX_DECISIONS,
    maxToolExecutions: overrides?.maxToolExecutions ?? DEFAULT_MAX_TOOL_EXECUTIONS,
    timeoutMs: overrides?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  };
}

/**
 * LLM-R1-T05, Part A/C/D. Runs one case, one time: fresh isolated
 * environment (Part A - local Catalog Service mock, fake Carrier, fake
 * commune catalog, a brand-new opportunityId), optional fixture setup (prior
 * durable state), the real unmodified runAgentToolLoop, then scores the
 * result against the case's ground truth. Mode selects only which
 * AgentLoopProvider is used - every other input (prompts, schema, tool
 * fixtures, commercialContext, budgets) is identical between offline and
 * live (Part D's comparison requirement).
 */
export async function runBenchmarkCase(
  testCase: BenchmarkCase,
  mode: BenchmarkRunMode,
  liveConfig: LiveBenchmarkProviderConfig | undefined,
  loopConfiguration: BenchmarkLoopConfiguration,
  runIndex: number
): Promise<BenchmarkTurnResult> {
  const environment = await setupBenchmarkEnvironment();
  try {
    if (testCase.setup) {
      await testCase.setup({ opportunityId: environment.opportunityId });
    }

    const providerCalls: BenchmarkProviderCallRecord[] = [];
    const innerProvider =
      mode === "offline"
        ? createOfflineScriptedProvider(testCase.offlineScript)
        : createLiveBenchmarkProvider(liveConfig!);
    const provider = createInstrumentedProvider(innerProvider, testCase.caseId, runIndex, providerCalls);

    const startedAt = Date.now();
    const loop = await runAgentToolLoop({
      correlationId: `benchmark-${testCase.caseId}-run${runIndex}-${randomUUID()}`,
      conversationId: null,
      opportunityId: environment.opportunityId,
      currentTime: new Date().toISOString(),
      customerMessage: testCase.customerMessage,
      commercialContextSummary: testCase.commercialContextSummary,
      recentCatalogContext: testCase.recentCatalogContext ?? null,
      pendingCatalogAction: testCase.pendingCatalogAction ?? null,
      provider,
      maxDecisions: loopConfiguration.maxDecisions,
      maxToolExecutions: loopConfiguration.maxToolExecutions,
      timeoutMs: loopConfiguration.timeoutMs
    });
    const totalElapsedMs = Date.now() - startedAt;

    const score = scoreCase(testCase.caseId, runIndex, loop, testCase.groundTruth);
    const trace = buildBenchmarkTurnTrace(loop, totalElapsedMs, loopConfiguration);
    return { caseId: testCase.caseId, runIndex, loop, totalElapsedMs, providerCalls, score, trace };
  } finally {
    await environment.teardown();
  }
}

/**
 * Runs the whole corpus, `runsPerCase` times each, sequentially (never
 * concurrent - a concurrent run would need N independent Catalog Service
 * mock servers/opportunityIds at once, adding accidental complexity for a
 * local benchmark tool with no throughput requirement). `mode: "live"`
 * requires a `liveConfig` already resolved by
 * liveProvider.ts#resolveLiveBenchmarkProviderConfig - this function itself
 * never reads process.env or decides whether live mode is allowed; that
 * gate lives entirely in liveProvider.ts and the CLI script that calls it.
 */
export async function runCorpus(cases: BenchmarkCase[], options: RunCorpusOptions): Promise<BenchmarkRunSummary> {
  const startedAt = new Date().toISOString();
  const loopConfiguration = resolveLoopConfiguration(options.loopOverrides);
  const results: BenchmarkTurnResult[] = [];

  for (const testCase of cases) {
    for (let runIndex = 0; runIndex < options.runsPerCase; runIndex += 1) {
      const result = await runBenchmarkCase(testCase, options.mode, options.mode === "live" ? options.liveConfig : undefined, loopConfiguration, runIndex);
      results.push(result);
    }
  }

  const finishedAt = new Date().toISOString();
  return {
    mode: options.mode,
    model: options.mode === "live" ? options.liveConfig.model : "benchmark-offline-model",
    runsPerCase: options.runsPerCase,
    loopConfiguration,
    startedAt,
    finishedAt,
    results
  };
}
