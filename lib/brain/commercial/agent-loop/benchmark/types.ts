import type { PendingCatalogActionStep } from "../agentStepTypes";
import type { AgentLoopResult, AgentLoopTerminalReason } from "../agentStepTypes";
import type { AgentLoopInferenceOutcome, AgentLoopStepPhase, AgentLoopStepRecord, AgentStepType, ToolObservationStatus } from "../agentStepTypes";
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
  /** LLM-R1-T08B. Numeric count only - never reasoning_content text (see AgentLoopProviderResponse). null when the provider/mode did not report it. */
  reasoningTokens: number | null;
  providerRequestId: string | null;
  model: string | null;
};

export type BenchmarkLoopConfiguration = {
  maxDecisions: number;
  maxToolExecutions: number;
  timeoutMs: number;
};

export type BenchmarkLoopOverrides = Partial<BenchmarkLoopConfiguration>;

export type BenchmarkTurnTraceDecision = {
  decisionIndex: number;
  toolExecutionCountBeforeDecision: number;
  remainingToolExecutions: number;
  stepsRemaining: number;
  modelStepType: AgentStepType;
  selectedTool: string | null;
  toolArguments: Record<string, unknown> | null;
  observationStatus: ToolObservationStatus | null;
  observationDataStatus: string | null;
  observationErrorCode: string | null;
  governance: AgentLoopStepRecord["governance"];
  consumedToolBudget: boolean;
  blocked: boolean;
  duplicate: boolean;
  invalid: boolean;
  llmAttempts: Array<{ attempt: number; outcome: AgentLoopInferenceOutcome; elapsedMs: number }>;
};

export type BenchmarkTurnTrace = {
  configuredMaxDecisions: number;
  configuredMaxToolExecutions: number;
  configuredTimeoutMs: number;
  decisionTrace: BenchmarkTurnTraceDecision[];
  orderedToolSequence: string[];
  selectProductsAttempted: boolean;
  selectProductsCompleted: boolean;
  setShippingDestinationAttempted: boolean;
  getProductDetailsAttempted: boolean;
  guardActivated: boolean;
  terminalReason: AgentLoopTerminalReason;
  warnings: string[];
  llmCallCount: number;
  toolExecutionCount: number;
  turnLatencyMs: number;
  llmCallLatenciesMs: number[];
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
  trace: BenchmarkTurnTrace;
};

export type BenchmarkRunMode = "offline" | "live";

export type BenchmarkRunSummary = {
  mode: BenchmarkRunMode;
  model: string | null;
  runsPerCase: number;
  loopConfiguration: BenchmarkLoopConfiguration;
  startedAt: string;
  finishedAt: string;
  results: BenchmarkTurnResult[];
};

export const BENCHMARK_AUDIT_PRIMARY_CLASSES = [
  "CORRECT",
  "ACCEPTABLE_DEGRADATION",
  "REAL_FUNCTIONAL_FAILURE",
  "SAFETY_FAILURE",
  "BENCHMARK_EXPECTATION_MISMATCH",
  "FAULT_INJECTION_NOT_REPRODUCED"
] as const;
export type BenchmarkAuditPrimaryClass = (typeof BENCHMARK_AUDIT_PRIMARY_CLASSES)[number];

export const BENCHMARK_AUDIT_RESPONSE_QUALITIES = ["GOOD", "ACCEPTABLE", "POOR_BUT_CORRECT"] as const;
export type BenchmarkAuditResponseQuality = (typeof BENCHMARK_AUDIT_RESPONSE_QUALITIES)[number];

export const BENCHMARK_AUDIT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type BenchmarkAuditSeverity = (typeof BENCHMARK_AUDIT_SEVERITIES)[number];

export type BenchmarkExpectedAuditSummary = {
  requiredTools: string[];
  forbiddenTools: string[];
  expectedTerminalReason: string | null;
  expectedBusinessOutcome: string;
  expectedFailureMode: string | null;
};

export type BenchmarkContextSummary = {
  recentCatalogContextPresent: boolean;
  pendingCatalogActionPresent: boolean;
  shippingContextPresent: boolean;
  commercialLineItemsPresent: boolean;
};

export type BenchmarkAuditDecision = {
  phase: AgentLoopStepPhase;
  decisionIndex: number;
  stepType: string;
  tool?: string;
  toolArguments?: unknown;
  responseMessage?: string | null;
  handoffReason?: string | null;
  observationStatus: ToolObservationStatus | null;
  observationDataStatus: string | null;
  observationErrorCode: string | null;
  observationData?: unknown;
  observationWarnings: string[];
  consumedToolBudget: boolean;
};

export type BenchmarkAuditRecord = {
  caseId: string;
  caseDescription: string;
  runIndex: number;
  userMessage: string;
  expected: BenchmarkExpectedAuditSummary;
  contextSummary: BenchmarkContextSummary;
  decisions: BenchmarkAuditDecision[];
  toolSequence: string[];
  modelResponseBeforeRuntimeGuards: string | null;
  guardInterventions: {
    commercialMutationGuardActivated: boolean;
    warnings: string[];
  };
  finalCustomerMessage: string | null;
  metrics: {
    scorerPass: boolean;
    requiredToolsCompleted: boolean;
    toolArgumentsCorrect: boolean;
    terminalReasonCorrect: boolean;
    timeout: boolean;
    structuredFailure: boolean;
    unbackedCommercialMutationClaim: boolean;
    llmCalls: number;
    toolExecutions: number;
    turnLatencyMs: number;
  };
  providerCalls: BenchmarkProviderCallRecord[];
  auditClassification: BenchmarkAuditPrimaryClass;
  responseQuality: BenchmarkAuditResponseQuality | null;
  severity: BenchmarkAuditSeverity | null;
  auditNotes: string[];
  /** Benchmark-only carry-throughs for audit logic/reporting; never production persistence. */
  score: BenchmarkCaseScore;
  loop: AgentLoopResult;
  groundTruth: BenchmarkGroundTruth;
};

export type BenchmarkAuditCaseSummary = {
  caseId: string;
  distinctResponsePatterns: Array<{ pattern: string; count: number; runs: number[] }>;
  toolSequenceDistribution: Array<{ pattern: string; count: number; runs: number[] }>;
  customerResponsePatternDistribution: Array<{ pattern: string; count: number; runs: number[] }>;
  bestRepresentativeRun: {
    runIndex: number;
    responseQuality: BenchmarkAuditResponseQuality | null;
    auditClassification: BenchmarkAuditPrimaryClass;
    finalCustomerMessage: string | null;
  } | null;
  worstPassingRun: {
    runIndex: number;
    responseQuality: BenchmarkAuditResponseQuality | null;
    auditClassification: BenchmarkAuditPrimaryClass;
    finalCustomerMessage: string | null;
  } | null;
};

export type BenchmarkAuditArtifact = {
  generatedAt: string;
  mode: BenchmarkRunMode;
  model: string | null;
  runsPerCase: number;
  loopConfiguration: BenchmarkLoopConfiguration;
  aggregateMetrics: import("./metrics").BenchmarkAggregateMetrics;
  customerVisibleMetrics: {
    customerCorrectRate: number | null;
    acceptableDegradationRate: number | null;
    realFunctionalFailureRate: number | null;
    safetyFailureRate: number | null;
    benchmarkExpectationMismatchRate: number | null;
    faultInjectionNotReproducedRate: number | null;
    goodResponseQualityRate: number | null;
    acceptableResponseQualityRate: number | null;
    poorButCorrectResponseQualityRate: number | null;
  };
  records: BenchmarkAuditRecord[];
  caseSummaries: BenchmarkAuditCaseSummary[];
};
