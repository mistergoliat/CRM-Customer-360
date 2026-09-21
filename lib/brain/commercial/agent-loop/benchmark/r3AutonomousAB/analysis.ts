import { computeBenchmarkE2ESummaryMetrics } from "../r3CommercialE2E/metrics";
import type { BenchmarkE2EFlagsConfig, BenchmarkE2ERunTrace, BenchmarkE2EToolInvocationTrace, BenchmarkE2ETurnTrace } from "../r3CommercialE2E/types";
import type { BenchmarkProviderCallRecord } from "../types";
import { annotatedTurnCount, annotationFor, P78_KNOWN_FIXTURE_PRODUCT_IDS, type P78TurnAnnotation } from "./abCorpus";
import type { AbVariantId } from "./variants";

/**
 * SALES-AGENT-R3-P7.8. Pure analysis (no IO): per-turn classification with
 * the section 26 taxonomy, per-variant metrics (section 16), and the A vs B
 * comparison (sections 13-15, 31). Success is derived ONLY from tool
 * execution, durable state and negative controls (section 25) - never from
 * CommercialProposal/P4 agreement, which B does not even produce.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const P78_FAILURE_CATEGORIES = [
  "COMMIT_SUCCESS",
  "NO_COMMIT_AFTER_GROUNDING",
  "OVER_MUTATION",
  "WRONG_QUANTITY",
  "SELECTION_CORRUPTION",
  "UNNECESSARY_CONFIRMATION",
  "TIMEOUT",
  "DEPENDENCY",
  "GATEWAY_REJECTION",
  "HARNESS_FAILURE",
  "OTHER",
  /** Only ever assigned to variant B: loop-governor terminal reasons (no_progress, emergency ceiling, ...) or a turn ended by unparseable AgentStep JSON. The same conditions in A are OTHER. */
  "AUTONOMOUS_LOOP_FAILURE",
  /** Not a failure: an informational negative-control turn with no unrequested mutation. */
  "INFORMATIONAL_OK"
] as const;
export type P78Category = (typeof P78_FAILURE_CATEGORIES)[number];

export type AbRunConfig = {
  variant: AbVariantId;
  model: string | null;
  temperature: number | null;
  thinking: "enabled" | "disabled" | null;
  timeoutMs: number;
  maxOutputTokens: number | null;
  maxModelRetries: number | null;
  maxDecisions: number;
  maxToolExecutions: number;
  promptVersion: string;
  /** sha256 (first 16 hex) of the system prompt of the first provider call of the run; null when no provider call happened. */
  promptSha256: string | null;
  /** section 24: P6 eligibility may be computed as telemetry in B, but it never reaches cognition there. */
  eligibilityInfluencedCognition: boolean;
  flags: BenchmarkE2EFlagsConfig;
};

export type AbPromptStats = {
  systemPromptChars: number;
  /** chars/4 - an approximation, labeled as such everywhere it is reported. */
  systemPromptApproxTokens: number;
  /** Lines of the system prompt before the tool catalog ("Available tools:") - the measured policy/steering volume. */
  policyLineCount: number;
  toolCatalogChars: number;
  providerCallCount: number;
};

export type AbRunRecord = {
  pairId: string;
  variant: AbVariantId;
  caseId: string;
  runOrdinal: number;
  sequenceIndex: number;
  firstInPair: boolean;
  isNegativeControl: boolean;
  /** null only when the run itself threw (HARNESS_FAILURE). */
  trace: BenchmarkE2ERunTrace | null;
  harnessError: string | null;
  runConfig: AbRunConfig;
  promptStats: AbPromptStats | null;
};

export type P78TurnAnalysis = {
  variant: AbVariantId;
  caseId: string;
  runOrdinal: number;
  turnOrdinal: number;
  kind: P78TurnAnnotation["kind"];
  executed: boolean;
  statedQuantity: number | null;
  harnessLimitation: string | null;
  terminalReason: string | null;
  toolCalls: readonly { capability: string; stepIndex: number; toolStatus: string; gatewayStatus: string | null }[];
  grounded: boolean;
  selectAttempted: boolean;
  selectCompleted: boolean;
  commitAttemptedAfterGrounding: boolean;
  commitCompletedAfterGrounding: boolean;
  durableCommitAfterGrounding: boolean;
  durableSelectionAfterTurn: boolean;
  mutationRequested: readonly string[];
  overMutationDurable: boolean;
  wrongQuantity: boolean;
  selectionCorruption: boolean;
  unnecessaryConfirmation: boolean;
  askedForQuantity: boolean;
  category: P78Category;
  providerCallCount: number;
  providerMs: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MUTATING_CAPABILITIES: ReadonlySet<string> = new Set(["select_products", "set_shipping_destination", "create_quote"]);
// External-service failures only. Deliberately NOT /_unavailable$/: opportunity_unavailable, identity_context_unavailable, weight/price_unavailable are domain/Gateway rejections (P7.6 2.8), not dependencies.
const DEPENDENCY_ERROR_PATTERN = /^(catalog|quote|carrier|customer)_service_(not_configured|unavailable)$|^(catalog_unavailable|temporarily_unavailable|customer_profile_unavailable)$/;
const LOOP_GOVERNOR_TERMINAL_REASONS: ReadonlySet<string> = new Set(["no_progress", "emergency_limit_exceeded", "max_steps_exceeded", "invalid_output"]);
// ponytail: benchmark-only heuristics over the final customer-facing text, mirroring the narrow-regex discipline of conversationalSignals.ts (never production, never an LLM judge).
const QUESTION_PATTERN = /[?¿]/;
const ASKS_QUANTITY_PATTERN = /cu[aá]nt[oa]s?|cantidad|unidades/i;

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function computePromptStats(systemPrompt: string, providerCallCount: number): AbPromptStats {
  const lines = systemPrompt.split("\n");
  // Tool catalog = the consecutive "- <tool>: ..." lines right after the "Available tools:" header (rendered by the shared renderToolLine);
  // everything else - rules, contract, eligibility advisory, identity - is policy/steering volume.
  const headerIndex = lines.indexOf("Available tools:");
  let toolLines: string[] = [];
  if (headerIndex >= 0) {
    let end = headerIndex;
    while (end + 1 < lines.length && lines[end + 1].startsWith("- ")) end += 1;
    toolLines = lines.slice(headerIndex + 1, end + 1);
  }
  return {
    systemPromptChars: systemPrompt.length,
    systemPromptApproxTokens: Math.ceil(systemPrompt.length / 4),
    policyLineCount: lines.length - toolLines.length - (headerIndex >= 0 ? 1 : 0),
    toolCatalogChars: toolLines.join("\n").length,
    providerCallCount
  };
}

/** The provider answered but its output was not parseable AgentStep JSON twice (the loop's one-shot structured recovery included): a model output-format failure, NOT an external dependency. */
function endedByInvalidResponse(turn: BenchmarkE2ETurnTrace): boolean {
  return turn.response.terminalReason === "provider_unavailable" && turn.runtimeWarnings.includes("agent_loop_provider_error:invalid_response");
}

function orderedInvocations(turn: BenchmarkE2ETurnTrace): BenchmarkE2EToolInvocationTrace[] {
  return [...turn.toolInvocations].sort((left, right) => left.stepIndex - right.stepIndex);
}

/** Durable selection integrity, structural only: known fixture products, no duplicates, positive integer quantities. */
export function selectionIsCorrupt(items: readonly { productId: string; quantity: number }[] | undefined): boolean {
  if (!items || items.length === 0) return false;
  const seen = new Set<string>();
  for (const item of items) {
    if (!P78_KNOWN_FIXTURE_PRODUCT_IDS.includes(item.productId)) return true;
    if (seen.has(item.productId)) return true;
    seen.add(item.productId);
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Per-turn analysis + taxonomy
// ---------------------------------------------------------------------------

function unexecutedTurn(record: AbRunRecord, turnOrdinal: number, annotation: P78TurnAnnotation): P78TurnAnalysis {
  return {
    variant: record.variant,
    caseId: record.caseId,
    runOrdinal: record.runOrdinal,
    turnOrdinal,
    kind: annotation.kind,
    executed: false,
    statedQuantity: annotation.kind === "explicit_purchase" ? annotation.statedQuantity : null,
    harnessLimitation: annotation.kind === "explicit_purchase" ? (annotation.harnessLimitation ?? null) : null,
    terminalReason: null,
    toolCalls: [],
    grounded: false,
    selectAttempted: false,
    selectCompleted: false,
    commitAttemptedAfterGrounding: false,
    commitCompletedAfterGrounding: false,
    durableCommitAfterGrounding: false,
    durableSelectionAfterTurn: false,
    mutationRequested: [],
    overMutationDurable: false,
    wrongQuantity: false,
    selectionCorruption: false,
    unnecessaryConfirmation: false,
    askedForQuantity: false,
    category: "HARNESS_FAILURE",
    providerCallCount: 0,
    providerMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0
  };
}

function classifyTurn(input: {
  variant: AbVariantId;
  annotation: P78TurnAnnotation;
  turn: BenchmarkE2ETurnTrace;
  invocations: readonly BenchmarkE2EToolInvocationTrace[];
  flags: Pick<P78TurnAnalysis, "selectAttempted" | "selectCompleted" | "wrongQuantity" | "selectionCorruption" | "mutationRequested" | "grounded">;
}): { category: P78Category; unnecessaryConfirmation: boolean; askedForQuantity: boolean } {
  const { variant, annotation, turn, invocations, flags } = input;
  const terminalReason = turn.response.terminalReason;
  const finalMessage = turn.response.finalMessage ?? "";
  const asksQuestion = QUESTION_PATTERN.test(finalMessage);
  const askedForQuantity = asksQuestion && ASKS_QUANTITY_PATTERN.test(finalMessage);

  if (flags.selectionCorruption) return { category: "SELECTION_CORRUPTION", unnecessaryConfirmation: false, askedForQuantity };

  if (annotation.kind === "informational") {
    if (terminalReason === "timeout") return { category: "TIMEOUT", unnecessaryConfirmation: false, askedForQuantity };
    if (endedByInvalidResponse(turn)) return { category: variant === "B_AUTONOMOUS" ? "AUTONOMOUS_LOOP_FAILURE" : "OTHER", unnecessaryConfirmation: false, askedForQuantity };
    if (terminalReason === "provider_unavailable") return { category: "DEPENDENCY", unnecessaryConfirmation: false, askedForQuantity };
    if (flags.mutationRequested.length > 0) return { category: "OVER_MUTATION", unnecessaryConfirmation: false, askedForQuantity };
    if (LOOP_GOVERNOR_TERMINAL_REASONS.has(terminalReason)) return { category: variant === "B_AUTONOMOUS" ? "AUTONOMOUS_LOOP_FAILURE" : "OTHER", unnecessaryConfirmation: false, askedForQuantity };
    return { category: "INFORMATIONAL_OK", unnecessaryConfirmation: false, askedForQuantity };
  }

  // explicit_purchase (the only other annotated kind analysed here)
  const alternatives = annotation.kind === "explicit_purchase" ? (annotation.commitAlternatives ?? []) : [];
  const alternativeRequested = invocations.some((invocation) => alternatives.includes(invocation.capability));

  if (flags.selectCompleted) {
    if (flags.wrongQuantity) return { category: "WRONG_QUANTITY", unnecessaryConfirmation: false, askedForQuantity };
    return { category: "COMMIT_SUCCESS", unnecessaryConfirmation: false, askedForQuantity };
  }
  if (alternativeRequested) return { category: "COMMIT_SUCCESS", unnecessaryConfirmation: false, askedForQuantity };

  if (terminalReason === "timeout") return { category: "TIMEOUT", unnecessaryConfirmation: false, askedForQuantity };
  if (endedByInvalidResponse(turn)) return { category: variant === "B_AUTONOMOUS" ? "AUTONOMOUS_LOOP_FAILURE" : "OTHER", unnecessaryConfirmation: false, askedForQuantity };
  if (terminalReason === "provider_unavailable" || invocations.some((invocation) => invocation.toolObservation.errorCode !== null && DEPENDENCY_ERROR_PATTERN.test(invocation.toolObservation.errorCode))) {
    return { category: "DEPENDENCY", unnecessaryConfirmation: false, askedForQuantity };
  }
  if (LOOP_GOVERNOR_TERMINAL_REASONS.has(terminalReason)) return { category: variant === "B_AUTONOMOUS" ? "AUTONOMOUS_LOOP_FAILURE" : "OTHER", unnecessaryConfirmation: false, askedForQuantity };
  if (flags.selectAttempted) return { category: "GATEWAY_REJECTION", unnecessaryConfirmation: false, askedForQuantity };

  const statedQuantity = annotation.kind === "explicit_purchase" ? annotation.statedQuantity : null;
  if (statedQuantity !== null && asksQuestion) return { category: "UNNECESSARY_CONFIRMATION", unnecessaryConfirmation: true, askedForQuantity };
  if (flags.grounded) return { category: "NO_COMMIT_AFTER_GROUNDING", unnecessaryConfirmation: false, askedForQuantity };
  return { category: "OTHER", unnecessaryConfirmation: false, askedForQuantity };
}

export function analyzeRun(record: AbRunRecord): P78TurnAnalysis[] {
  const caseTurnCount = record.trace?.turns.length ?? annotatedTurnCount(record.caseId);
  const analyses: P78TurnAnalysis[] = [];

  for (let turnOrdinal = 0; turnOrdinal < caseTurnCount; turnOrdinal += 1) {
    const annotation = annotationFor(record.caseId, turnOrdinal);
    if (annotation.kind === "other") continue;

    const turn = record.trace?.turns[turnOrdinal];
    if (!record.trace || !turn) {
      analyses.push(unexecutedTurn(record, turnOrdinal, annotation));
      continue;
    }

    const invocations = orderedInvocations(turn);
    const statedQuantity = annotation.kind === "explicit_purchase" ? annotation.statedQuantity : null;
    const groundingStepIndex = invocations.find((invocation) => invocation.capability === "get_product_details" && invocation.toolObservation.status === "completed")?.stepIndex;
    const grounded = groundingStepIndex !== undefined;
    const selects = invocations.filter((invocation) => invocation.capability === "select_products");
    const selectAttempted = selects.length > 0;
    const selectCompleted = selects.some((invocation) => invocation.toolObservation.status === "completed");
    const after = turn.durableStateAfterTurn;
    const before = turn.durableStateBeforeTurn;
    const afterItems = after?.selection.items;

    const commitAttemptedAfterGrounding = grounded && selects.some((invocation) => invocation.stepIndex > groundingStepIndex);
    const commitCompletedAfterGrounding = grounded && selects.some((invocation) => invocation.stepIndex > groundingStepIndex && invocation.toolObservation.status === "completed");
    const durableSelectionAfterTurn = Boolean(after?.selection.present && (after.selection.itemCount ?? 0) >= 1);
    const mutationRequested = [...new Set(invocations.filter((invocation) => MUTATING_CAPABILITIES.has(invocation.capability)).map((invocation) => invocation.capability))];
    const overMutationDurable =
      annotation.kind === "informational" &&
      Boolean(
        (after?.selection.present && !before?.selection.present) ||
          (after?.destination.present && !before?.destination.present) ||
          (after?.quote.present && !before?.quote.present)
      );
    const wrongQuantity = selectCompleted && statedQuantity !== null && !(afterItems ?? []).some((item) => item.quantity === statedQuantity);
    const selectionCorruption = selectionIsCorrupt(afterItems);

    const classification = classifyTurn({
      variant: record.variant,
      annotation,
      turn,
      invocations,
      flags: { selectAttempted, selectCompleted, wrongQuantity, selectionCorruption, mutationRequested, grounded }
    });

    analyses.push({
      variant: record.variant,
      caseId: record.caseId,
      runOrdinal: record.runOrdinal,
      turnOrdinal,
      kind: annotation.kind,
      executed: true,
      statedQuantity,
      harnessLimitation: annotation.kind === "explicit_purchase" ? (annotation.harnessLimitation ?? null) : null,
      terminalReason: turn.response.terminalReason,
      toolCalls: invocations.map((invocation) => ({ capability: invocation.capability, stepIndex: invocation.stepIndex, toolStatus: invocation.toolObservation.status, gatewayStatus: invocation.gateway?.status ?? null })),
      grounded,
      selectAttempted,
      selectCompleted,
      commitAttemptedAfterGrounding,
      commitCompletedAfterGrounding,
      durableCommitAfterGrounding: commitCompletedAfterGrounding && durableSelectionAfterTurn,
      durableSelectionAfterTurn,
      mutationRequested,
      overMutationDurable,
      wrongQuantity,
      selectionCorruption,
      unnecessaryConfirmation: classification.unnecessaryConfirmation,
      askedForQuantity: classification.askedForQuantity,
      category: classification.category,
      providerCallCount: turn.providerCalls.length,
      providerMs: sum(turn.providerCalls.map((call) => call.elapsedMs ?? 0)),
      inputTokens: sum(turn.providerCalls.map((call) => call.inputTokens ?? 0)),
      outputTokens: sum(turn.providerCalls.map((call) => call.outputTokens ?? 0)),
      reasoningTokens: sum(turn.providerCalls.map((call) => call.reasoningTokens ?? 0))
    });
  }
  return analyses;
}

// ---------------------------------------------------------------------------
// Per-variant metrics
// ---------------------------------------------------------------------------

type Ratio = { numerator: number; denominator: number; rate: number | null };
const ratio = (numerator: number, denominator: number): Ratio => ({ numerator, denominator, rate: rate(numerator, denominator) });

export type P78VariantMetrics = {
  variant: AbVariantId;
  runsExecuted: number;
  harnessFailures: number;
  turnsAnalyzed: number;
  /** section 13/14: identical definition for both variants - explicit purchase intent + get_product_details completed in the turn. */
  primary: {
    explicitPurchaseTurns: number;
    groundedTurns: number;
    commitAfterGroundingRate: Ratio;
    durableCommitAfterGroundingRate: Ratio;
    byQuantity: { statedQuantity: { commitAfterGroundingRate: Ratio }; missingQuantity: { commitAfterGroundingRate: Ratio } };
    /** Sensitivity: the same metric without the turn documented as a harness limitation (section 18). */
    excludingHarnessLimitation: { commitAfterGroundingRate: Ratio; durableCommitAfterGroundingRate: Ratio };
  };
  /** Denominator that does not depend on the variant's behavior: every explicit-purchase turn. Guards against "skip grounding" gaming the primary metric. */
  fixedCohort: { explicitPurchaseTurns: number; selectProductsAttempted: Ratio; selectProductsCompleted: Ratio; durableSelectionAfterTurn: Ratio };
  negativeControls: { informationalTurns: number; overMutation: Ratio; overMutationDurable: Ratio; mutationsByCapability: Record<string, number> };
  quantity: { wrongQuantity: Ratio; unnecessaryConfirmation: Ratio; askedForQuantityOnMissingQuantityTurns: Ratio };
  selectionCorruption: Ratio;
  /** Durable case expectations of the primary cases (objective type excluded: it is P4/P5-derived and not produced by B). */
  commercialOutcomeCompletion: Ratio;
  shared: {
    validArgumentsRate: number | null;
    gatewayCompletionRate: number | null;
    gatewayRejectionRate: number | null;
    unnecessaryRequestionRate: number | null;
    duplicateToolCallRate: number | null;
    ungroundedMutationClaimRate: number | null;
    terminalReasonDistribution: Record<string, number>;
  };
  behavior: {
    averageToolCallsPerTurn: number | null;
    averageProviderCallsPerTurn: number | null;
    /** Provider calls whose output was not parseable AgentStep JSON (model output-format reliability), over all provider calls. */
    providerInvalidResponseCalls: Ratio;
    turnsEndedByInvalidResponse: number;
  };
  latency: { perCallMs: { p50: number | null; p90: number | null; p95: number | null }; perTurnProviderMs: { p50: number | null; p90: number | null; p95: number | null } };
  tokens: { inputTotal: number; outputTotal: number; reasoningTotal: number; inputPerTurnMean: number | null; outputPerTurnMean: number | null };
  failureCategoryDistribution: Record<string, number>;
  prompt: { systemPromptCharsMean: number | null; systemPromptApproxTokensMean: number | null; policyLineCountMean: number | null; toolCatalogCharsMean: number | null; distinctPromptSha256: string[] };
};

function mean(values: readonly number[]): number | null {
  return values.length > 0 ? sum(values) / values.length : null;
}

function pct(values: readonly number[]) {
  return { p50: percentile(values, 0.5), p90: percentile(values, 0.9), p95: percentile(values, 0.95) };
}

const NON_OBJECTIVE_EXPECTATION_KEYS_EXCLUDED = new Set(["finalObjectiveType", "terminalReasonLastTurn"]);

export function computeVariantMetrics(variant: AbVariantId, records: readonly AbRunRecord[]): P78VariantMetrics {
  const mine = records.filter((record) => record.variant === variant);
  const executedRecords = mine.filter((record) => record.trace !== null);
  const traces = executedRecords.map((record) => record.trace as BenchmarkE2ERunTrace);
  const analyses = mine.flatMap(analyzeRun);
  const executed = analyses.filter((analysis) => analysis.executed);

  const explicit = executed.filter((analysis) => analysis.kind === "explicit_purchase");
  const grounded = explicit.filter((analysis) => analysis.grounded);
  const stated = grounded.filter((analysis) => analysis.statedQuantity !== null);
  const missing = grounded.filter((analysis) => analysis.statedQuantity === null);
  const groundedNoLimitation = grounded.filter((analysis) => analysis.harnessLimitation === null);
  const informational = executed.filter((analysis) => analysis.kind === "informational");
  const explicitStated = explicit.filter((analysis) => analysis.statedQuantity !== null);
  const explicitMissing = explicit.filter((analysis) => analysis.statedQuantity === null);

  const mutationsByCapability: Record<string, number> = {};
  for (const analysis of informational) for (const capability of analysis.mutationRequested) mutationsByCapability[capability] = (mutationsByCapability[capability] ?? 0) + 1;

  const failureCategoryDistribution: Record<string, number> = {};
  for (const analysis of analyses) failureCategoryDistribution[analysis.category] = (failureCategoryDistribution[analysis.category] ?? 0) + 1;

  const primaryRuns = executedRecords.filter((record) => !record.isNegativeControl);
  const outcomeCompleted = primaryRuns.filter((record) =>
    Object.entries((record.trace as BenchmarkE2ERunTrace).outcome.expectationResults)
      .filter(([key]) => !NON_OBJECTIVE_EXPECTATION_KEYS_EXCLUDED.has(key))
      .every(([, value]) => value !== false)
  );

  const shared = computeBenchmarkE2ESummaryMetrics(traces);
  const allTurnTraces = traces.flatMap((trace) => trace.turns);
  const allCalls: BenchmarkProviderCallRecord[] = allTurnTraces.flatMap((turn) => [...turn.providerCalls]);
  const promptStats = executedRecords.map((record) => record.promptStats).filter((stats): stats is AbPromptStats => stats !== null);

  const inputTokens = sum(executed.map((analysis) => analysis.inputTokens));
  const outputTokens = sum(executed.map((analysis) => analysis.outputTokens));

  return {
    variant,
    runsExecuted: executedRecords.length,
    harnessFailures: mine.length - executedRecords.length,
    turnsAnalyzed: executed.length,
    primary: {
      explicitPurchaseTurns: explicit.length,
      groundedTurns: grounded.length,
      commitAfterGroundingRate: ratio(grounded.filter((analysis) => analysis.commitAttemptedAfterGrounding).length, grounded.length),
      durableCommitAfterGroundingRate: ratio(grounded.filter((analysis) => analysis.durableCommitAfterGrounding).length, grounded.length),
      byQuantity: {
        statedQuantity: { commitAfterGroundingRate: ratio(stated.filter((analysis) => analysis.commitAttemptedAfterGrounding).length, stated.length) },
        missingQuantity: { commitAfterGroundingRate: ratio(missing.filter((analysis) => analysis.commitAttemptedAfterGrounding).length, missing.length) }
      },
      excludingHarnessLimitation: {
        commitAfterGroundingRate: ratio(groundedNoLimitation.filter((analysis) => analysis.commitAttemptedAfterGrounding).length, groundedNoLimitation.length),
        durableCommitAfterGroundingRate: ratio(groundedNoLimitation.filter((analysis) => analysis.durableCommitAfterGrounding).length, groundedNoLimitation.length)
      }
    },
    fixedCohort: {
      explicitPurchaseTurns: explicit.length,
      selectProductsAttempted: ratio(explicit.filter((analysis) => analysis.selectAttempted).length, explicit.length),
      selectProductsCompleted: ratio(explicit.filter((analysis) => analysis.selectCompleted).length, explicit.length),
      durableSelectionAfterTurn: ratio(explicit.filter((analysis) => analysis.selectCompleted && analysis.durableSelectionAfterTurn).length, explicit.length)
    },
    negativeControls: {
      informationalTurns: informational.length,
      overMutation: ratio(informational.filter((analysis) => analysis.mutationRequested.length > 0).length, informational.length),
      overMutationDurable: ratio(informational.filter((analysis) => analysis.overMutationDurable).length, informational.length),
      mutationsByCapability
    },
    quantity: {
      wrongQuantity: ratio(explicitStated.filter((analysis) => analysis.wrongQuantity).length, explicitStated.filter((analysis) => analysis.selectCompleted).length),
      unnecessaryConfirmation: ratio(explicitStated.filter((analysis) => analysis.unnecessaryConfirmation).length, explicitStated.length),
      askedForQuantityOnMissingQuantityTurns: ratio(explicitMissing.filter((analysis) => analysis.askedForQuantity).length, explicitMissing.length)
    },
    selectionCorruption: ratio(executed.filter((analysis) => analysis.selectionCorruption).length, executed.length),
    commercialOutcomeCompletion: ratio(outcomeCompleted.length, primaryRuns.length),
    shared: {
      validArgumentsRate: shared.validArgumentsRate,
      gatewayCompletionRate: shared.gatewayCompletionRate,
      gatewayRejectionRate: shared.gatewayRejectionRate,
      unnecessaryRequestionRate: shared.unnecessaryRequestionRate,
      duplicateToolCallRate: shared.duplicateToolCallRate,
      ungroundedMutationClaimRate: shared.ungroundedMutationClaimRate,
      terminalReasonDistribution: shared.terminalReasonDistribution
    },
    behavior: {
      averageToolCallsPerTurn: mean(allTurnTraces.map((turn) => turn.toolInvocations.length)),
      averageProviderCallsPerTurn: mean(allTurnTraces.map((turn) => turn.providerCalls.length)),
      providerInvalidResponseCalls: ratio(allCalls.filter((call) => call.outcome === "invalid_response").length, allCalls.length),
      turnsEndedByInvalidResponse: allTurnTraces.filter(endedByInvalidResponse).length
    },
    latency: {
      perCallMs: pct(allCalls.map((call) => call.elapsedMs ?? 0)),
      perTurnProviderMs: pct(executed.map((analysis) => analysis.providerMs))
    },
    tokens: {
      inputTotal: inputTokens,
      outputTotal: outputTokens,
      reasoningTotal: sum(executed.map((analysis) => analysis.reasoningTokens)),
      inputPerTurnMean: rate(inputTokens, executed.length),
      outputPerTurnMean: rate(outputTokens, executed.length)
    },
    failureCategoryDistribution,
    prompt: {
      systemPromptCharsMean: mean(promptStats.map((stats) => stats.systemPromptChars)),
      systemPromptApproxTokensMean: mean(promptStats.map((stats) => stats.systemPromptApproxTokens)),
      policyLineCountMean: mean(promptStats.map((stats) => stats.policyLineCount)),
      toolCatalogCharsMean: mean(promptStats.map((stats) => stats.toolCatalogChars)),
      distinctPromptSha256: [...new Set(executedRecords.map((record) => record.runConfig.promptSha256).filter((hash): hash is string => hash !== null))]
    }
  };
}

// ---------------------------------------------------------------------------
// Comparison + architecture signal (thresholds fixed BEFORE any measurement)
// ---------------------------------------------------------------------------

export const P78_SIGNAL_THRESHOLDS = {
  /** B must beat A by at least this much (absolute rate) on BOTH the primary and the durable commit metric... */
  minCommitDelta: 0.2,
  /** ...and by at least this much on the fixed-denominator cohort (select_products completed / all explicit turns). */
  minFixedCohortCommitDelta: 0.1,
  maxOverMutationRate: 0.1,
  maxOverMutationExcessOverA: 0.1,
  maxValidArgumentsDrop: 0.05,
  maxGatewayRejectionExcess: 0.05,
  /** Model output-format failures (unparseable AgentStep JSON) per provider call: B may not exceed A by more than this. Added after the smoke run exposed the failure mode and BEFORE the measured batch. */
  maxInvalidResponseExcess: 0.05,
  maxWrongQuantityExcess: 0.1,
  maxLatencyP95Ratio: 2,
  /** A rate over fewer grounded turns than this is reported as low-denominator and cannot support AUTONOMOUS_FAVORED. */
  minGroundedTurnsForRate: 5
} as const;

export const P78_ARCHITECTURE_SIGNALS = ["AUTONOMOUS_FAVORED", "NO_CLEAR_WINNER", "HYBRID_FAVORED"] as const;
export type P78ArchitectureSignal = (typeof P78_ARCHITECTURE_SIGNALS)[number];

type MetricPair = { A: number | null; B: number | null; delta: number | null };
function pair(a: number | null, b: number | null): MetricPair {
  return { A: a, B: b, delta: a !== null && b !== null ? b - a : null };
}

export type P78Comparison = {
  denominatorDefinition: string;
  primary: { commitAfterGroundingRate: MetricPair; durableCommitAfterGroundingRate: MetricPair; groundedTurns: { A: number; B: number }; explicitPurchaseTurns: { A: number; B: number } };
  fixedCohort: { selectProductsAttemptedRate: MetricPair; selectProductsCompletedRate: MetricPair; durableSelectionRate: MetricPair };
  quantitySplit: { statedQuantityCommitRate: MetricPair; missingQuantityCommitRate: MetricPair };
  sensitivityExcludingHarnessLimitation: { commitAfterGroundingRate: MetricPair; durableCommitAfterGroundingRate: MetricPair };
  negativeControls: { overMutationRate: MetricPair; overMutationDurableRate: MetricPair };
  toolAndGateway: { validArgumentsRate: MetricPair; gatewayCompletionRate: MetricPair; gatewayRejectionRate: MetricPair; duplicateToolCallRate: MetricPair; averageToolCallsPerTurn: MetricPair; averageProviderCallsPerTurn: MetricPair; providerInvalidResponseCallRate: MetricPair };
  correctness: { wrongQuantityRate: MetricPair; selectionCorruptionRate: MetricPair; unnecessaryConfirmationRate: MetricPair; commercialOutcomeCompletionRate: MetricPair };
  latency: { perCallP50Ms: MetricPair; perCallP90Ms: MetricPair; perCallP95Ms: MetricPair; perTurnProviderP50Ms: MetricPair; perTurnProviderP95Ms: MetricPair };
  tokens: { inputPerTurnMean: MetricPair; outputPerTurnMean: MetricPair };
  prompt: { systemPromptChars: MetricPair; systemPromptApproxTokens: MetricPair; policyLineCount: MetricPair };
  failureCategoryDistribution: { A: Record<string, number>; B: Record<string, number> };
  dataQuality: { harnessFailures: { A: number; B: number }; lowGroundedDenominator: { A: boolean; B: boolean } };
  architectureSignal: { signal: P78ArchitectureSignal; candidateOnly: true; thresholds: typeof P78_SIGNAL_THRESHOLDS; criteria: Record<string, boolean | null>; reasons: string[] };
};

export function compareVariants(a: P78VariantMetrics, b: P78VariantMetrics): P78Comparison {
  const t = P78_SIGNAL_THRESHOLDS;
  const primary = pair(a.primary.commitAfterGroundingRate.rate, b.primary.commitAfterGroundingRate.rate);
  const durable = pair(a.primary.durableCommitAfterGroundingRate.rate, b.primary.durableCommitAfterGroundingRate.rate);
  const fixedCompleted = pair(a.fixedCohort.selectProductsCompleted.rate, b.fixedCohort.selectProductsCompleted.rate);
  const overMutation = pair(a.negativeControls.overMutation.rate, b.negativeControls.overMutation.rate);
  const validArgs = pair(a.shared.validArgumentsRate, b.shared.validArgumentsRate);
  const rejection = pair(a.shared.gatewayRejectionRate, b.shared.gatewayRejectionRate);
  const wrongQuantity = pair(a.quantity.wrongQuantity.rate, b.quantity.wrongQuantity.rate);
  const corruption = pair(a.selectionCorruption.rate, b.selectionCorruption.rate);
  const p95 = pair(a.latency.perCallMs.p95, b.latency.perCallMs.p95);
  const invalidResponse = pair(a.behavior.providerInvalidResponseCalls.rate, b.behavior.providerInvalidResponseCalls.rate);

  const lowA = a.primary.groundedTurns < t.minGroundedTurnsForRate;
  const lowB = b.primary.groundedTurns < t.minGroundedTurnsForRate;

  const nz = (value: number | null) => value ?? 0;
  const criteria: Record<string, boolean | null> = {
    commitImproved: primary.delta === null || durable.delta === null || fixedCompleted.delta === null ? null : primary.delta >= t.minCommitDelta && durable.delta >= t.minCommitDelta && fixedCompleted.delta >= t.minFixedCohortCommitDelta,
    overMutationAcceptable: overMutation.B === null ? null : overMutation.B <= t.maxOverMutationRate && overMutation.B <= nz(overMutation.A) + t.maxOverMutationExcessOverA,
    validArgumentsNotDegraded: validArgs.B === null || validArgs.A === null ? null : validArgs.B >= validArgs.A - t.maxValidArgumentsDrop,
    gatewayRejectionsNotIncreased: rejection.B === null ? null : rejection.B <= nz(rejection.A) + t.maxGatewayRejectionExcess,
    noDurableCorruptionBeyondA: corruption.B === null ? null : corruption.B <= nz(corruption.A),
    structuredOutputNotDegraded: invalidResponse.B === null ? null : invalidResponse.B <= nz(invalidResponse.A) + t.maxInvalidResponseExcess,
    wrongQuantityNotIncreased: wrongQuantity.B === null ? true : wrongQuantity.B <= nz(wrongQuantity.A) + t.maxWrongQuantityExcess,
    latencyReasonable: p95.B === null || p95.A === null || p95.A === 0 ? null : p95.B <= p95.A * t.maxLatencyP95Ratio,
    denominatorsSufficient: !lowA && !lowB
  };

  const reasons: string[] = [];
  const safe = (["overMutationAcceptable", "validArgumentsNotDegraded", "gatewayRejectionsNotIncreased", "noDurableCorruptionBeyondA", "structuredOutputNotDegraded", "wrongQuantityNotIncreased", "latencyReasonable"] as const).every((key) => criteria[key] !== false);
  const safetyViolated = criteria.overMutationAcceptable === false || criteria.noDurableCorruptionBeyondA === false || criteria.gatewayRejectionsNotIncreased === false;
  const materiallyWorseOnCommit = (primary.delta !== null && primary.delta <= -t.minCommitDelta) || (fixedCompleted.delta !== null && fixedCompleted.delta <= -t.minFixedCohortCommitDelta);

  let signal: P78ArchitectureSignal = "NO_CLEAR_WINNER";
  if (criteria.commitImproved === true && safe && criteria.denominatorsSufficient) {
    signal = "AUTONOMOUS_FAVORED";
    reasons.push("B beats A on primary, durable and fixed-cohort commit by the declared margins, with no safety criterion violated");
  } else if (safetyViolated || materiallyWorseOnCommit) {
    signal = "HYBRID_FAVORED";
    if (safetyViolated) reasons.push("B violates a safety criterion (over-mutation, durable corruption or more Gateway rejections than the tolerance)");
    if (materiallyWorseOnCommit) reasons.push("B is materially worse than A on commit");
  } else {
    if (criteria.commitImproved === null) reasons.push("a commit metric has an empty denominator - improvement cannot be established");
    else if (criteria.commitImproved === false) reasons.push("commit difference is below the declared materiality margins");
    if (!criteria.denominatorsSufficient) reasons.push(`grounded-turn denominator below ${t.minGroundedTurnsForRate} in at least one variant`);
    if (!safe) reasons.push("a non-safety-critical criterion (valid arguments, structured-output reliability, wrong quantity or latency) is not satisfied");
  }

  return {
    denominatorDefinition:
      "primary: explicit-purchase turns (fixed per-turn annotation, identical for A and B) in which get_product_details completed; numerator = select_products requested later in the same turn (durable: completed AND durable selection present after the turn). fixedCohort: every explicit-purchase turn, independent of variant behavior.",
    primary: { commitAfterGroundingRate: primary, durableCommitAfterGroundingRate: durable, groundedTurns: { A: a.primary.groundedTurns, B: b.primary.groundedTurns }, explicitPurchaseTurns: { A: a.primary.explicitPurchaseTurns, B: b.primary.explicitPurchaseTurns } },
    fixedCohort: {
      selectProductsAttemptedRate: pair(a.fixedCohort.selectProductsAttempted.rate, b.fixedCohort.selectProductsAttempted.rate),
      selectProductsCompletedRate: fixedCompleted,
      durableSelectionRate: pair(a.fixedCohort.durableSelectionAfterTurn.rate, b.fixedCohort.durableSelectionAfterTurn.rate)
    },
    quantitySplit: {
      statedQuantityCommitRate: pair(a.primary.byQuantity.statedQuantity.commitAfterGroundingRate.rate, b.primary.byQuantity.statedQuantity.commitAfterGroundingRate.rate),
      missingQuantityCommitRate: pair(a.primary.byQuantity.missingQuantity.commitAfterGroundingRate.rate, b.primary.byQuantity.missingQuantity.commitAfterGroundingRate.rate)
    },
    sensitivityExcludingHarnessLimitation: {
      commitAfterGroundingRate: pair(a.primary.excludingHarnessLimitation.commitAfterGroundingRate.rate, b.primary.excludingHarnessLimitation.commitAfterGroundingRate.rate),
      durableCommitAfterGroundingRate: pair(a.primary.excludingHarnessLimitation.durableCommitAfterGroundingRate.rate, b.primary.excludingHarnessLimitation.durableCommitAfterGroundingRate.rate)
    },
    negativeControls: { overMutationRate: overMutation, overMutationDurableRate: pair(a.negativeControls.overMutationDurable.rate, b.negativeControls.overMutationDurable.rate) },
    toolAndGateway: {
      validArgumentsRate: validArgs,
      gatewayCompletionRate: pair(a.shared.gatewayCompletionRate, b.shared.gatewayCompletionRate),
      gatewayRejectionRate: rejection,
      duplicateToolCallRate: pair(a.shared.duplicateToolCallRate, b.shared.duplicateToolCallRate),
      averageToolCallsPerTurn: pair(a.behavior.averageToolCallsPerTurn, b.behavior.averageToolCallsPerTurn),
      averageProviderCallsPerTurn: pair(a.behavior.averageProviderCallsPerTurn, b.behavior.averageProviderCallsPerTurn),
      providerInvalidResponseCallRate: invalidResponse
    },
    correctness: {
      wrongQuantityRate: wrongQuantity,
      selectionCorruptionRate: corruption,
      unnecessaryConfirmationRate: pair(a.quantity.unnecessaryConfirmation.rate, b.quantity.unnecessaryConfirmation.rate),
      commercialOutcomeCompletionRate: pair(a.commercialOutcomeCompletion.rate, b.commercialOutcomeCompletion.rate)
    },
    latency: {
      perCallP50Ms: pair(a.latency.perCallMs.p50, b.latency.perCallMs.p50),
      perCallP90Ms: pair(a.latency.perCallMs.p90, b.latency.perCallMs.p90),
      perCallP95Ms: p95,
      perTurnProviderP50Ms: pair(a.latency.perTurnProviderMs.p50, b.latency.perTurnProviderMs.p50),
      perTurnProviderP95Ms: pair(a.latency.perTurnProviderMs.p95, b.latency.perTurnProviderMs.p95)
    },
    tokens: { inputPerTurnMean: pair(a.tokens.inputPerTurnMean, b.tokens.inputPerTurnMean), outputPerTurnMean: pair(a.tokens.outputPerTurnMean, b.tokens.outputPerTurnMean) },
    prompt: {
      systemPromptChars: pair(a.prompt.systemPromptCharsMean, b.prompt.systemPromptCharsMean),
      systemPromptApproxTokens: pair(a.prompt.systemPromptApproxTokensMean, b.prompt.systemPromptApproxTokensMean),
      policyLineCount: pair(a.prompt.policyLineCountMean, b.prompt.policyLineCountMean)
    },
    failureCategoryDistribution: { A: a.failureCategoryDistribution, B: b.failureCategoryDistribution },
    dataQuality: { harnessFailures: { A: a.harnessFailures, B: b.harnessFailures }, lowGroundedDenominator: { A: lowA, B: lowB } },
    architectureSignal: { signal, candidateOnly: true, thresholds: t, criteria, reasons }
  };
}
