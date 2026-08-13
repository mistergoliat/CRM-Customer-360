import { randomUUID } from "node:crypto";
import { runCommercialMultiIntentLoop } from "../../../multi-intent/runCommercialMultiIntentLoop";
import { createFakeAgentLoopProvider } from "../../providers/fakeAgentLoopProvider";
import { setupBenchmarkEnvironment } from "../environment";
import { createInstrumentedProvider } from "../instrumentedProvider";
import { createLiveBenchmarkProvider } from "../liveProvider";
import type { LiveBenchmarkProviderConfig } from "../liveProvider";
import { scoreCase } from "../scoring";
import type { BenchmarkProviderCallRecord, BenchmarkRunMode, BenchmarkRunSummary, BenchmarkTurnResult } from "../types";
import type { MultiIntentBenchmarkCase } from "./corpus";

/**
 * LLM-R1-T09A, Part 22/24. Mirrors runCorpus.ts's own runBenchmarkCase/runCorpus
 * exactly, with two differences only: it calls runCommercialMultiIntentLoop
 * instead of runAgentToolLoop, and offline mode scripts a
 * [plannerOutput, finalizerAgentStep] pair via createFakeAgentLoopProvider
 * (generic - accepts any raw output in order) instead of the legacy corpus's
 * AgentStep-only offlineProvider.ts. scoreCase/BenchmarkGroundTruth/
 * BenchmarkTurnResult are all reused unchanged - runCommercialMultiIntentLoop
 * produces the exact same AgentLoopResult shape runAgentToolLoop does, so the
 * legacy harness's own scoring is directly applicable, never reimplemented.
 */
export type RunMultiIntentCorpusOptions =
  | { mode: "offline"; runsPerCase: number }
  | { mode: "live"; runsPerCase: number; liveConfig: LiveBenchmarkProviderConfig };

export async function runMultiIntentBenchmarkCase(
  testCase: MultiIntentBenchmarkCase,
  mode: BenchmarkRunMode,
  liveConfig: LiveBenchmarkProviderConfig | undefined,
  runIndex: number
): Promise<BenchmarkTurnResult> {
  const environment = await setupBenchmarkEnvironment();
  try {
    if (testCase.setup) {
      await testCase.setup({ opportunityId: environment.opportunityId });
    }

    const providerCalls: BenchmarkProviderCallRecord[] = [];
    const innerProvider = mode === "offline" ? createFakeAgentLoopProvider({ script: testCase.offlineScript }) : createLiveBenchmarkProvider(liveConfig!);
    const provider = createInstrumentedProvider(innerProvider, testCase.caseId, runIndex, providerCalls);

    const startedAt = Date.now();
    const loop = await runCommercialMultiIntentLoop({
      correlationId: `mi-benchmark-${testCase.caseId}-run${runIndex}-${randomUUID()}`,
      conversationId: null,
      opportunityId: environment.opportunityId,
      currentTime: new Date().toISOString(),
      customerMessage: testCase.customerMessage,
      commercialContextSummary: testCase.commercialContextSummary,
      recentCatalogContext: testCase.recentCatalogContext ?? null,
      pendingCatalogAction: null,
      provider
    });
    const totalElapsedMs = Date.now() - startedAt;

    const score = scoreCase(testCase.caseId, runIndex, loop, testCase.groundTruth);
    return { caseId: testCase.caseId, runIndex, loop, totalElapsedMs, providerCalls, score };
  } finally {
    await environment.teardown();
  }
}

export async function runMultiIntentCorpus(cases: MultiIntentBenchmarkCase[], options: RunMultiIntentCorpusOptions): Promise<BenchmarkRunSummary> {
  const startedAt = new Date().toISOString();
  const results: BenchmarkTurnResult[] = [];

  for (const testCase of cases) {
    for (let runIndex = 0; runIndex < options.runsPerCase; runIndex += 1) {
      const result = await runMultiIntentBenchmarkCase(testCase, options.mode, options.mode === "live" ? options.liveConfig : undefined, runIndex);
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
