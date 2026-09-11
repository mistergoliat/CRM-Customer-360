import { randomUUID } from "node:crypto";
import { DEFAULT_MAX_DECISIONS, DEFAULT_MAX_TOOL_EXECUTIONS, DEFAULT_TIMEOUT_MS, runAgentToolLoop } from "../../runAgentToolLoop";
import { setupBenchmarkEnvironment } from "../environment";
import { createOfflineScriptedProvider } from "../offlineProvider";
import { createInstrumentedProvider } from "../instrumentedProvider";
import { createLiveBenchmarkProvider } from "../liveProvider";
import type { LiveBenchmarkProviderConfig } from "../liveProvider";
import { buildBenchmarkTurnTrace } from "../trace";
import type { BenchmarkProviderCallRecord } from "../types";
import { scoreGoldenCase } from "./scoreGoldenCase";
import type { GoldenRunMode, GoldenTurnCase, GoldenTurnRunResult } from "./types";

/**
 * R3 Stable Agent Acceptance Harness V1. Mirrors the legacy
 * benchmark/runCorpus.ts#runBenchmarkCase exactly (same isolated environment,
 * same instrumented provider wrapping, same real unmodified runAgentToolLoop)
 * - the only difference is the golden scorer (scoreGoldenCase.ts) instead of
 * the legacy scoreCase, and passing environment.conversationId through so
 * select_shipping_option's evidence gate is exercisable.
 */
export async function runGoldenTurnCase(
  testCase: GoldenTurnCase,
  mode: GoldenRunMode,
  liveConfig: LiveBenchmarkProviderConfig | undefined,
  runIndex: number
): Promise<GoldenTurnRunResult> {
  const environment = await setupBenchmarkEnvironment();
  try {
    if (testCase.setup) {
      await testCase.setup({ opportunityId: environment.opportunityId, conversationId: environment.conversationId });
    }

    const providerCalls: BenchmarkProviderCallRecord[] = [];
    const innerProvider = mode === "offline" ? createOfflineScriptedProvider(testCase.offlineScript) : createLiveBenchmarkProvider(liveConfig!);
    const provider = createInstrumentedProvider(innerProvider, testCase.caseId, runIndex, providerCalls);

    const startedAt = Date.now();
    const loop = await runAgentToolLoop({
      correlationId: `r3-golden-${testCase.caseId}-run${runIndex}-${randomUUID()}`,
      conversationId: environment.conversationId,
      opportunityId: environment.opportunityId,
      currentTime: new Date().toISOString(),
      customerMessage: testCase.customerMessage,
      commercialContextSummary: testCase.commercialContextSummary,
      recentCatalogContext: testCase.recentCatalogContext ?? null,
      pendingCatalogAction: testCase.pendingCatalogAction ?? null,
      provider,
      maxDecisions: DEFAULT_MAX_DECISIONS,
      maxToolExecutions: DEFAULT_MAX_TOOL_EXECUTIONS,
      timeoutMs: DEFAULT_TIMEOUT_MS
    });
    const totalElapsedMs = Date.now() - startedAt;

    const trace = buildBenchmarkTurnTrace(loop, totalElapsedMs, { maxDecisions: DEFAULT_MAX_DECISIONS, maxToolExecutions: DEFAULT_MAX_TOOL_EXECUTIONS, timeoutMs: DEFAULT_TIMEOUT_MS });
    const score = scoreGoldenCase(testCase, runIndex, { loop, decisionCount: trace.decisionTrace.length });

    return { caseId: testCase.caseId, category: testCase.category, runIndex, mode: "turn", loop, totalElapsedMs, providerCalls, trace, score };
  } finally {
    await environment.teardown();
  }
}
