import type { PendingCatalogActionStep } from "../agentStepTypes";
import type { AgentLoopResult, AgentLoopTerminalReason } from "../agentStepTypes";
import type { AgentLoopToolName } from "../runAgentToolLoop";
import type { RecentCatalogContext } from "../recentCatalogContext";
import type { AgentLoopProviderFailureCause } from "../providers/providerFailureClassification";

/**
 * LLM-R1-T05. Ground truth is structural, never a text-similarity check on
 * the final message (per the task's own instruction: "No dependas sólo de
 * comparación textual de la respuesta final. Prioriza métricas estructurales.").
 * Every field is optional except requiredTools/forbiddenTools/expectedTerminalReason -
 * a case only declares the ground truth dimensions relevant to it.
 */
export type BenchmarkGroundTruth = {
  /** Tools that must appear, at least once, with observation.status === "completed", for the case to pass. */
  requiredTools: AgentLoopToolName[];
  /** Tools that must never appear anywhere in loop.steps, regardless of outcome. */
  forbiddenTools: AgentLoopToolName[];
  /** For selection/quantity cases (C02/C04/C07) - the exact productId the final select_products call (if any) must carry. */
  selectedProductId?: string | null;
  /** For selection/quantity cases - the exact quantity the final select_products call (if any) must carry. */
  quantity?: number | null;
  /** For shipping-destination cases (C03/C05/C06) - the resolved communeId set_shipping_destination must produce. null explicitly means "must NOT resolve to any single commune" (C06's ambiguous-destination case). */
  expectedDestinationCommuneId?: number | null;
  expectedTerminalReason: AgentLoopTerminalReason;
  /** C11/C12: at least one llmCalls entry this case's script produces must have outcome === "invalid_response" before the turn resolves. */
  expectsStructuredFailure?: boolean;
  /** C10: at least one tool observation in loop.steps must have status "failed" or "blocked" (a controlled capability failure, never silently treated as success). */
  expectsControlledToolFailure?: boolean;
  /** Free-text rationale for what this case is checking and why - never used for scoring, only for report readability. */
  notes: string;
};

/**
 * One scripted decision for OFFLINE runs only - interpreted by
 * offlineProvider.ts into either a valid AgentStep-shaped rawOutput or a
 * classified provider failure (never a claim about real model behavior;
 * see runCorpus.ts's "offline" vs "live" mode distinction).
 */
export type BenchmarkOfflineStep =
  | { kind: "use_tool"; tool: string; arguments: Record<string, unknown> }
  | { kind: "respond"; message: string; pendingCatalogAction?: PendingCatalogActionStep }
  | { kind: "handoff"; reason: string }
  /** Simulates a provider-level structural failure (T01's normalizedReason "invalid_response") for this exact call, consumed once. */
  | { kind: "invalid_response"; errorCode: "empty_response" | "invalid_model_json" | "invalid_json_response" }
  /** Simulates a well-formed-but-schema-invalid AgentStep for this exact call (the pre-T01 retry path, still governed by T04's guided repair). */
  | { kind: "invalid_json_shape"; rawOutput: unknown };

export type BenchmarkCase = {
  caseId: string;
  description: string;
  customerMessage: string;
  commercialContextSummary: Record<string, unknown>;
  recentCatalogContext?: RecentCatalogContext | null;
  pendingCatalogAction?: PendingCatalogActionStep | null;
  groundTruth: BenchmarkGroundTruth;
  /** Consumed in order by the offline scripted provider; the last entry repeats if the loop calls more times than scripted (mirrors fakeAgentLoopProvider.ts's own convention). */
  offlineScript: BenchmarkOfflineStep[];
  /**
   * Optional pre-turn state seeding for cases whose scenario assumes prior
   * durable state already exists (C03/C04/C05/C09 - a confirmed selection
   * and/or destination from an earlier turn). Runs once per case-run,
   * against that run's own fresh, isolated opportunityId - never shared
   * across runs or cases. Uses the exact same real domain functions the
   * capabilities themselves call (never a parallel/reimplemented writer).
   */
  setup?: (input: { opportunityId: number }) => Promise<void>;
};

/**
 * One real provider invocation's outcome, captured by
 * instrumentedProvider.ts independently of AgentLoopResult.llmCalls (T02) -
 * this benchmark harness never modifies T01-T04 shipped code, so it
 * classifies failures itself via the same exported
 * classifyAgentLoopProviderFailure T01/T02 already use, giving finer-grained
 * errorCode resolution than the coarser `outcome` field T02 exposes.
 */
export type BenchmarkProviderCallRecord = {
  caseId: string;
  runIndex: number;
  callIndex: number;
  elapsedMs: number;
  outcome: "success" | AgentLoopProviderFailureCause["normalizedReason"];
  errorCode: string | null;
  finishReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  providerRequestId: string | null;
  model: string | null;
};

export type BenchmarkCaseScore = {
  caseId: string;
  runIndex: number;
  toolsUsed: AgentLoopToolName[];
  requiredToolsCompleted: boolean;
  missingRequiredTools: AgentLoopToolName[];
  forbiddenToolInvoked: boolean;
  invokedForbiddenTools: AgentLoopToolName[];
  toolArgumentsCorrect: boolean;
  terminalReasonCorrect: boolean;
  controlledToolFailureObserved: boolean;
  structuredFailureObserved: boolean;
  overallPass: boolean;
  notes: string[];
};

export type BenchmarkTurnResult = {
  caseId: string;
  runIndex: number;
  loop: AgentLoopResult;
  /** Wall-clock around the whole runAgentToolLoop call - includes tool/DB/Carrier time, not just LLM calls. */
  totalElapsedMs: number;
  providerCalls: BenchmarkProviderCallRecord[];
  score: BenchmarkCaseScore;
};

export type BenchmarkRunMode = "offline" | "live";

export type BenchmarkRunSummary = {
  mode: BenchmarkRunMode;
  model: string | null;
  runsPerCase: number;
  startedAt: string;
  finishedAt: string;
  results: BenchmarkTurnResult[];
};
