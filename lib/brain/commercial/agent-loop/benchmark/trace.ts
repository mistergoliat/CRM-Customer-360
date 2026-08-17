import type { AgentLoopInferenceOutcome, AgentLoopResult, AgentLoopStepRecord } from "../agentStepTypes";
import type { BenchmarkLoopConfiguration, BenchmarkTurnTrace, BenchmarkTurnTraceDecision } from "./types";

function extractObservationDataStatus(record: AgentLoopStepRecord): string | null {
  const data = record.observation?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const status = (data as { status?: unknown }).status;
  return typeof status === "string" ? status : null;
}

function buildInvalidArgumentWarningSet(warnings: string[]): Set<string> {
  return new Set(warnings.filter((warning) => warning.startsWith("agent_loop_tool_invalid_arguments:")));
}

function consumedToolBudget(record: AgentLoopStepRecord, invalidArgumentWarnings: Set<string>): boolean {
  if (record.step.type !== "use_tool") return false;
  if (record.governance === "blocked_duplicate" || record.governance === "blocked_unregistered") return false;
  const errorCode = record.observation?.errorCode ?? "unknown";
  if (invalidArgumentWarnings.has(`agent_loop_tool_invalid_arguments:${record.step.tool}:${errorCode}`)) return false;
  if (
    errorCode === "source_product_not_observed" ||
    errorCode === "source_product_variant_not_observed" ||
    errorCode === "recent_catalog_context_unavailable" ||
    errorCode === "product_not_in_pending_catalog_candidates"
  ) {
    return false;
  }
  return true;
}

function buildDecisionTrace(input: {
  record: AgentLoopStepRecord;
  loop: AgentLoopResult;
  config: BenchmarkLoopConfiguration;
  toolExecutionCountBeforeDecision: number;
  invalidArgumentWarnings: Set<string>;
}): BenchmarkTurnTraceDecision {
  const llmAttempts = input.loop.llmCalls
    .filter((call) => call.phase === "gathering" && call.decisionIndex === input.record.stepIndex)
    .map((call) => ({ attempt: call.attempt, outcome: call.outcome as AgentLoopInferenceOutcome, elapsedMs: call.elapsedMs }));
  const step = input.record.step;
  const observationStatus = input.record.observation?.status ?? null;
  const consumed = consumedToolBudget(input.record, input.invalidArgumentWarnings);

  return {
    decisionIndex: input.record.stepIndex,
    toolExecutionCountBeforeDecision: input.toolExecutionCountBeforeDecision,
    remainingToolExecutions: Math.max(0, input.config.maxToolExecutions - input.toolExecutionCountBeforeDecision),
    stepsRemaining: Math.max(0, input.config.maxDecisions - input.record.stepIndex),
    modelStepType: step.type,
    selectedTool: step.type === "use_tool" ? step.tool : null,
    toolArguments: step.type === "use_tool" ? step.arguments : null,
    observationStatus,
    observationDataStatus: extractObservationDataStatus(input.record),
    observationErrorCode: input.record.observation?.errorCode ?? null,
    governance: input.record.governance,
    consumedToolBudget: consumed,
    blocked: observationStatus === "blocked",
    duplicate: input.record.governance === "blocked_duplicate" || input.record.observation?.errorCode === "duplicate_tool_call",
    invalid:
      step.type === "use_tool" &&
      input.invalidArgumentWarnings.has(`agent_loop_tool_invalid_arguments:${step.tool}:${input.record.observation?.errorCode ?? "unknown"}`),
    llmAttempts
  };
}

export function buildBenchmarkTurnTrace(loop: AgentLoopResult, totalElapsedMs: number, config: BenchmarkLoopConfiguration): BenchmarkTurnTrace {
  const invalidArgumentWarnings = buildInvalidArgumentWarningSet(loop.warnings);
  const gatheringSteps = loop.steps.filter((record) => record.phase === "gathering");

  let executedBefore = 0;
  const decisionTrace = gatheringSteps.map((record) => {
    const trace = buildDecisionTrace({
      record,
      loop,
      config,
      toolExecutionCountBeforeDecision: executedBefore,
      invalidArgumentWarnings
    });
    if (trace.consumedToolBudget) executedBefore += 1;
    return trace;
  });

  const orderedToolSequence = gatheringSteps.flatMap((record) => (record.step.type === "use_tool" ? [record.step.tool] : []));

  return {
    configuredMaxDecisions: config.maxDecisions,
    configuredMaxToolExecutions: config.maxToolExecutions,
    configuredTimeoutMs: config.timeoutMs,
    decisionTrace,
    orderedToolSequence,
    selectProductsAttempted: orderedToolSequence.includes("select_products"),
    selectProductsCompleted: gatheringSteps.some(
      (record) => record.step.type === "use_tool" && record.step.tool === "select_products" && record.observation?.status === "completed"
    ),
    setShippingDestinationAttempted: orderedToolSequence.includes("set_shipping_destination"),
    getProductDetailsAttempted: orderedToolSequence.includes("get_product_details"),
    guardActivated: loop.warnings.some((warning) => warning.startsWith("agent_loop_mutation_claim_blocked:")),
    terminalReason: loop.terminalReason,
    warnings: [...loop.warnings],
    llmCallCount: loop.llmCalls.length,
    toolExecutionCount: loop.toolExecutionCount,
    turnLatencyMs: totalElapsedMs,
    llmCallLatenciesMs: loop.llmCalls.map((call) => call.elapsedMs)
  };
}
