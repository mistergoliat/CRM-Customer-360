import type { ContinuityAuditRunResult } from "./runContinuityAudit";
import { buildContinuitySummary } from "./summary";
import type { ContinuityManifest } from "./types";
import { CONTINUITY_CONVERSATION_LABELS, CONTINUITY_CONVERSATION_PERSONAS } from "./types";
import { listActiveBenchmarkE2EOverrides } from "../r3CommercialE2E/benchmarkOverrides";

/** P7.13 (task section 46). No PII - every conversation is a synthetic fixture (BENCHMARK_PRODUCTS/BENCHMARK_COMMUNES), never a real customer. */
function jsonlOf<T>(items: readonly T[]): string {
  return items.map((item) => JSON.stringify(item)).join("\n");
}

export function buildContinuityArtifactFiles(result: ContinuityAuditRunResult, gitSha: string | null, freezeHash: string): Record<string, string> {
  const summary = buildContinuitySummary(result);

  const manifest: ContinuityManifest = {
    runId: result.benchmarkRunId,
    gitSha,
    startedAt: new Date(Date.now() - result.wallClockMs).toISOString(),
    mode: result.benchmarkRunId.includes("smoke") ? "smoke" : "main",
    model: result.liveConfig.model,
    temperature: result.liveConfig.temperature,
    thinking: result.liveConfig.thinking ?? null,
    maxOutputTokens: result.liveConfig.maxOutputTokens ?? null,
    timeoutMs: null,
    maxModelRetries: result.liveConfig.maxModelRetries,
    flags: result.flags,
    benchmarkOverrides: listActiveBenchmarkE2EOverrides(),
    conversations: CONTINUITY_CONVERSATION_LABELS.map((label) => ({ label, persona: CONTINUITY_CONVERSATION_PERSONAS[label], plannedTurns: result.plans[label].length })),
    totalPlannedTurns: CONTINUITY_CONVERSATION_LABELS.reduce((sum, label) => sum + result.plans[label].length, 0),
    freezeHash
  };

  const executionPlan = CONTINUITY_CONVERSATION_LABELS.flatMap((label) => result.plans[label]);

  const turnRows = result.allTurns.map((turn) => ({
    turnIndex: turn.turnIndex,
    conversation: turn.conversation,
    localIndex: turn.localIndex,
    category: turn.category,
    probe: turn.probe,
    compactionGenerationBefore: turn.compactionGenerationBefore,
    customerMessage: turn.customerMessage,
    modelResponse: turn.modelResponse,
    terminalReason: turn.terminalReason,
    handoffReason: turn.handoffReason,
    runtimeReason: turn.runtimeReason,
    runtimeWarnings: turn.runtimeWarnings,
    toolCallCount: turn.toolCalls.length,
    compactionHappenedThisTurn: turn.compactionHappenedThisTurn,
    confirmationClass: turn.confirmationClass,
    missingFactKind: turn.missingFactKind,
    falseSuccessClaim: turn.falseSuccessClaim,
    regreeted: turn.regreeted,
    invariantChecks: turn.invariantChecks,
    providerInputTokens: turn.providerCalls[turn.providerCalls.length - 1]?.inputTokens ?? null,
    providerOutputTokens: turn.providerCalls[turn.providerCalls.length - 1]?.outputTokens ?? null
  }));

  const commercialWorkSnapshots = result.allTurns.map((turn) => ({
    turnIndex: turn.turnIndex,
    conversation: turn.conversation,
    workId: turn.durableStateAfterTurn?.workId ?? null,
    workVersion: turn.durableStateAfterTurn?.workVersion ?? null,
    workStatus: turn.durableStateAfterTurn?.workStatus ?? null,
    objectiveType: turn.durableStateAfterTurn?.objectiveType ?? null,
    objectiveStatus: turn.durableStateAfterTurn?.objectiveStatus ?? null
  }));

  const drmSnapshots = result.allTurns.map((turn) => ({
    turnIndex: turn.turnIndex,
    conversation: turn.conversation,
    selection: turn.durableStateAfterTurn?.selection ?? null,
    destination: turn.durableStateAfterTurn?.destination ?? null,
    shipping: turn.durableStateAfterTurn?.shipping ?? null,
    quote: turn.durableStateAfterTurn?.quote ?? null
  }));

  const agentInputSnapshots = result.factLineage.map((entry) => ({
    turnIndex: entry.turnIndex,
    conversation: entry.conversation,
    factKey: entry.factKey,
    agentInputValue: entry.agentInputValue,
    providerVisibleValue: entry.providerVisibleValue
  }));

  const sessionSnapshots = result.allTurns.map((turn) => ({
    turnIndex: turn.turnIndex,
    conversation: turn.conversation,
    sessionBefore: turn.sessionBefore,
    sessionAfter: turn.sessionAfter
  }));

  const compactionEligibilityRows = result.allTurns.map((turn) => turn.compactionEligibility);
  const providerCallOutcomeRows = result.allTurns.flatMap((turn) => turn.providerCallOutcomes);

  const toolCallRows = result.allTurns.flatMap((turn) => turn.toolCalls.map((call) => ({ turnIndex: turn.turnIndex, conversation: turn.conversation, ...call })));
  const gatewayEventRows = toolCallRows; // this codebase's tool-invocation trace already IS the Gateway-observed outcome (buildTurnTrace.toolInvocations.toolObservation) - never a second, independently reconstructed Gateway log.

  const tokenMetricRows = result.allTurns.map((turn) => ({
    turnIndex: turn.turnIndex,
    conversation: turn.conversation,
    providerInputTokens: turn.providerCalls[turn.providerCalls.length - 1]?.inputTokens ?? null,
    providerOutputTokens: turn.providerCalls[turn.providerCalls.length - 1]?.outputTokens ?? null,
    rawHistoryTokensEstimate: result.providerPayloadSnapshots.find((snapshot) => snapshot.turnIndex === turn.turnIndex)?.rawHistoryTokensEstimate ?? null
  }));

  return {
    "manifest.json": JSON.stringify(manifest, null, 2),
    "execution-plan.json": JSON.stringify(executionPlan, null, 2),
    "turns.jsonl": jsonlOf(turnRows),
    "fact-lineage.jsonl": jsonlOf(result.factLineage),
    "commercial-work-snapshots.jsonl": jsonlOf(commercialWorkSnapshots),
    "drm-snapshots.jsonl": jsonlOf(drmSnapshots),
    "agent-input-snapshots.jsonl": jsonlOf(agentInputSnapshots),
    "session-snapshots.jsonl": jsonlOf(sessionSnapshots),
    "compaction-events.jsonl": jsonlOf(result.compactionEvents),
    "provider-payload-metadata.jsonl": jsonlOf(result.providerPayloadSnapshots),
    "tool-calls.jsonl": jsonlOf(toolCallRows),
    "gateway-events.jsonl": jsonlOf(gatewayEventRows),
    "continuity-failures.jsonl": jsonlOf(result.failures),
    "token-metrics.jsonl": jsonlOf(tokenMetricRows),
    "compaction-eligibility-trace.jsonl": jsonlOf(compactionEligibilityRows),
    "provider-call-outcomes.jsonl": jsonlOf(providerCallOutcomeRows),
    "summary.json": JSON.stringify(summary, null, 2)
  };
}
