import { randomUUID } from "node:crypto";
import { DEFAULT_MAX_DECISIONS, DEFAULT_MAX_TOOL_EXECUTIONS, DEFAULT_TIMEOUT_MS, runAgentToolLoop } from "../../runAgentToolLoop";
import { setupR3BenchmarkEnvironment } from "./environment";
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
 * benchmark/runCorpus.ts#runBenchmarkCase (same instrumented provider
 * wrapping, same real unmodified runAgentToolLoop) - the golden scorer
 * (scoreGoldenCase.ts) replaces the legacy scoreCase, and the environment is
 * setupR3BenchmarkEnvironment (FIX1) rather than the legacy
 * setupBenchmarkEnvironment: this corpus needs a real, durable
 * opportunityId/conversationId (TS-005 writes a real crm_capability_executions
 * row referencing both as foreign keys), which the legacy synthetic-id
 * environment never provided.
 */
export async function runGoldenTurnCase(
  testCase: GoldenTurnCase,
  mode: GoldenRunMode,
  liveConfig: LiveBenchmarkProviderConfig | undefined,
  runIndex: number
): Promise<GoldenTurnRunResult> {
  const environment = await setupR3BenchmarkEnvironment();
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
