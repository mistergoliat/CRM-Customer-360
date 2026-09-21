import { computeBenchmarkE2ESummaryMetrics } from "../r3CommercialE2E/metrics";
import type { BenchmarkE2ERunTrace } from "../r3CommercialE2E/types";
import { analyzeRun, type AbRunConfig, type AbRunRecord, type P78TurnAnalysis } from "../r3AutonomousAB/analysis";

/**
 * SALES-AGENT-R3-P7.8-R. Pure analysis for the three-arm experiment:
 *   A  = R3 current (runAgentToolLoop, hybrid prompt, P4/P5/P6.3)
 *   B  = true autonomous harness + CURRENT tool contract
 *   C1 = true autonomous harness + THIN tool contract (quantity still required)
 * Per-turn classification is the P7.8 one (analyzeRun) - success is derived
 * only from tool execution, durable state and negative controls. On top of it:
 * Q+/Q- grouping and commercialProgressAfterGrounding (task sections 12-13),
 * the two taxes (A->B harness, B->C1 capability contract) and the signal rule.
 */

export const TRUE_ARM_IDS = ["A_R3_CURRENT", "B_PURE_CURRENT_TOOLS", "C1_PURE_THIN_TOOLS"] as const;
export type TrueArmId = (typeof TRUE_ARM_IDS)[number];

export type TrueRunConfig = Omit<AbRunConfig, "variant" | "flags"> & { arm: TrueArmId; toolSurface: "current" | "thin"; usesR3Loop: boolean; eligibilityInfluencedCognition: boolean };

export type TrueRunRecord = {
  pairId: string;
  arm: TrueArmId;
  caseId: string;
  runOrdinal: number;
  sequenceIndex: number;
  isNegativeControl: boolean;
  trace: BenchmarkE2ERunTrace | null;
  harnessError: string | null;
  runConfig: TrueRunConfig;
  promptStats: { systemPromptChars: number; systemPromptApproxTokens: number; policyLineCount: number; toolContractChars: number; providerCallCount: number } | null;
};

const QUESTION = /[?¿]/;

/**
 * Quantity-request detectors over the customer-facing reply (benchmark-only heuristics, never an LLM judge).
 *  - "legacy": the P7.8 pattern used by the PRE-REGISTERED run. Known defect (found after the batch, by reading the replies):
 *    it matches any "unidades" plus any question, so "Quedan 15 unidades disponibles. ¿Quieres que te envíe el link?" counted
 *    as asking for the quantity. Kept only to reproduce the pre-registered numbers.
 *  - "strict": a question that specifically asks HOW MANY / which quantity ("cuántas/cuántos", "qué cantidad",
 *    "cantidad que/de unidades/...", "número de unidades"). Validated against a manual reading of all 54 Q- replies of the
 *    P7.8-R batch (no disagreement). Singular "cuánto" is excluded on purpose (it is "cuánto cuesta").
 */
export type QuantityDetector = "legacy" | "strict";
const LEGACY_ASKS_QUANTITY = /cu[aá]nt[oa]s?|cantidad|unidades/i;
const STRICT_ASKS_QUANTITY = /cu[aá]nt(as|os)|qu[eé] cantidad|cantidad (que|de unidades|necesit|deseas|quieres|requieres)|n[uú]mero de unidades/i;

export function asksForQuantity(message: string, detector: QuantityDetector): boolean {
  return QUESTION.test(message) && (detector === "strict" ? STRICT_ASKS_QUANTITY : LEGACY_ASKS_QUANTITY).test(message);
}

/** P7.8 analysis works on two variant labels; A keeps A_HYBRID, every autonomous arm is analysed as B_AUTONOMOUS (only used to decide loop-failure labelling). */
function toP78Record(record: TrueRunRecord): AbRunRecord {
  return {
    pairId: record.pairId,
    variant: record.arm === "A_R3_CURRENT" ? "A_HYBRID" : "B_AUTONOMOUS",
    caseId: record.caseId,
    runOrdinal: record.runOrdinal,
    sequenceIndex: record.sequenceIndex,
    firstInPair: false,
    isNegativeControl: record.isNegativeControl,
    trace: record.trace,
    harnessError: record.harnessError,
    runConfig: record.runConfig as unknown as AbRunConfig,
    promptStats: record.promptStats ? { systemPromptChars: record.promptStats.systemPromptChars, systemPromptApproxTokens: record.promptStats.systemPromptApproxTokens, policyLineCount: record.promptStats.policyLineCount, toolCatalogChars: record.promptStats.toolContractChars, providerCallCount: record.promptStats.providerCallCount } : null
  };
}

export type TrueTurnAnalysis = P78TurnAnalysis & {
  arm: TrueArmId;
  /** The P7.8 regex result (pre-registered, defective - see QuantityDetector). `askedForQuantity` (inherited) is overridden with the selected detector. */
  askedForQuantityLegacy: boolean;
  group: "Q+" | "Q-" | null;
  /** Fixed cohort (every explicit-purchase turn): the appropriate progress action happened. */
  progressFixed: boolean;
  /** Success after grounding (only meaningful when `grounded`). */
  progressAfterGrounding: boolean;
  /** Q- turn where the model persisted a selection anyway: it had to invent a quantity. */
  assumedQuantity: boolean;
  endedWithQuestion: boolean;
  repeatedMutationCall: boolean;
};

const MUTATIONS = new Set(["select_products", "set_shipping_destination", "create_quote"]);

export function analyzeTrueRun(record: TrueRunRecord, detector: QuantityDetector = "strict"): TrueTurnAnalysis[] {
  const p78 = analyzeRun(toP78Record(record));
  return p78.map((analysis) => {
    const turn = record.trace?.turns[analysis.turnOrdinal];
    const explicit = analysis.kind === "explicit_purchase";
    const group = explicit ? (analysis.statedQuantity !== null ? "Q+" : "Q-") : null;
    const alternativeRequested = analysis.category === "COMMIT_SUCCESS" && !analysis.selectAttempted; // E14 t1: create_quote request counted as progression (Quote Service BLOCKED)
    const appropriate = (grounded: boolean): boolean => {
      if (!explicit || !analysis.executed) return false;
      if (group === "Q+") return grounded ? analysis.commitAttemptedAfterGrounding : analysis.selectAttempted;
      return (askedQuantity && !analysis.selectAttempted) || alternativeRequested;
    };
    const finalMessage = turn?.response.finalMessage ?? "";
    const askedQuantity = asksForQuantity(finalMessage, detector);
    const mutationCalls = (turn?.toolInvocations ?? []).filter((invocation) => MUTATIONS.has(invocation.capability)).map((invocation) => invocation.capability);
    return {
      ...analysis,
      askedForQuantityLegacy: analysis.askedForQuantity,
      askedForQuantity: askedQuantity,
      arm: record.arm,
      group,
      progressFixed: appropriate(false),
      progressAfterGrounding: analysis.grounded && appropriate(true),
      assumedQuantity: group === "Q-" && analysis.selectAttempted,
      endedWithQuestion: QUESTION.test(finalMessage),
      repeatedMutationCall: new Set(mutationCalls).size < mutationCalls.length
    };
  });
}

type Ratio = { numerator: number; denominator: number; rate: number | null };
const ratio = (numerator: number, denominator: number): Ratio => ({ numerator, denominator, rate: denominator > 0 ? numerator / denominator : null });
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const mean = (values: readonly number[]) => (values.length > 0 ? sum(values) / values.length : null);
function pct(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

export type TrueArmMetrics = {
  arm: TrueArmId;
  runsExecuted: number;
  harnessFailures: number;
  turnsAnalyzed: number;
  explicitPurchaseTurns: number;
  /** PRIMARY (task section 13). Denominator: explicit-purchase turns in which get_product_details completed. */
  commercialProgressAfterGroundingRate: Ratio;
  /** Same success rule over every explicit-purchase turn (denominator independent of the arm's behavior). */
  commercialProgressFixedCohortRate: Ratio;
  /** Secondary, comparable with P7.7/P7.8: select_products requested after grounding, over grounded explicit turns. */
  commitAfterGroundingRate: Ratio;
  durableCommitRate: Ratio;
  qPlus: { turns: number; commitRateWhenQuantityKnown: Ratio; commitAfterGroundingRate: Ratio; progressAfterGroundingRate: Ratio; unnecessaryConfirmation: Ratio };
  qMinus: { turns: number; commitRateWhenQuantityMissing: Ratio; requestQuantityRateWhenMissing: Ratio; respondWithoutCommitOrQuantityQuestion: Ratio; assumedQuantity: Ratio; progressAfterGroundingRate: Ratio };
  /** (asked for quantity on Q-) + (did not ask on Q+) over all explicit-purchase turns. */
  quantityRequestAccuracy: Ratio;
  clarificationTurnRate: Ratio;
  negativeControls: { informationalTurns: number; overMutation: Ratio; overMutationDurable: Ratio };
  wrongQuantity: Ratio;
  selectionCorruption: Ratio;
  repeatedMutationCalls: Ratio;
  shared: { validArgumentsRate: number | null; gatewayCompletionRate: number | null; gatewayRejectionRate: number | null; unnecessaryRequestionRate: number | null; duplicateToolCallRate: number | null; ungroundedMutationClaimRate: number | null; terminalReasonDistribution: Record<string, number> };
  toolQuality: { toolCallsPerTurn: number | null; providerCallsPerTurn: number | null; argumentFailureCalls: Ratio; providerInvalidResponseCalls: Ratio; preGatewayRejections: number };
  latency: { perCallMs: { p50: number | null; p95: number | null }; perTurnProviderMs: { p50: number | null; p95: number | null } };
  tokens: { inputPerTurnMean: number | null; outputPerTurnMean: number | null; inputTotal: number; outputTotal: number };
  failureCategoryDistribution: Record<string, number>;
  prompt: { systemPromptCharsMean: number | null; systemPromptApproxTokensMean: number | null; policyLineCountMean: number | null; toolContractCharsMean: number | null; distinctPromptSha256: string[] };
};

export function computeTrueArmMetrics(arm: TrueArmId, records: readonly TrueRunRecord[], detector: QuantityDetector = "strict"): TrueArmMetrics {
  const mine = records.filter((record) => record.arm === arm);
  const executedRecords = mine.filter((record) => record.trace !== null);
  const traces = executedRecords.map((record) => record.trace as BenchmarkE2ERunTrace);
  const analyses = mine.flatMap((record) => analyzeTrueRun(record, detector)).filter((analysis) => analysis.executed);
  const explicit = analyses.filter((analysis) => analysis.kind === "explicit_purchase");
  const grounded = explicit.filter((analysis) => analysis.grounded);
  const qPlus = explicit.filter((analysis) => analysis.group === "Q+");
  const qMinus = explicit.filter((analysis) => analysis.group === "Q-");
  const informational = analyses.filter((analysis) => analysis.kind === "informational");
  const turnTraces = traces.flatMap((trace) => trace.turns);
  const calls = turnTraces.flatMap((turn) => [...turn.providerCalls]);
  const invocations = turnTraces.flatMap((turn) => turn.toolInvocations);
  const shared = computeBenchmarkE2ESummaryMetrics(traces);

  const failureCategoryDistribution: Record<string, number> = {};
  for (const analysis of mine.flatMap((record) => analyzeTrueRun(record, detector))) failureCategoryDistribution[analysis.category] = (failureCategoryDistribution[analysis.category] ?? 0) + 1;

  const stats = executedRecords.map((record) => record.promptStats).filter((value): value is NonNullable<typeof value> => value !== null);
  const inputTokens = sum(analyses.map((analysis) => analysis.inputTokens));
  const outputTokens = sum(analyses.map((analysis) => analysis.outputTokens));

  return {
    arm,
    runsExecuted: executedRecords.length,
    harnessFailures: mine.length - executedRecords.length,
    turnsAnalyzed: analyses.length,
    explicitPurchaseTurns: explicit.length,
    commercialProgressAfterGroundingRate: ratio(grounded.filter((analysis) => analysis.progressAfterGrounding).length, grounded.length),
    commercialProgressFixedCohortRate: ratio(explicit.filter((analysis) => analysis.progressFixed).length, explicit.length),
    commitAfterGroundingRate: ratio(grounded.filter((analysis) => analysis.commitAttemptedAfterGrounding).length, grounded.length),
    durableCommitRate: ratio(explicit.filter((analysis) => analysis.selectCompleted && analysis.durableSelectionAfterTurn).length, explicit.length),
    qPlus: {
      turns: qPlus.length,
      commitRateWhenQuantityKnown: ratio(qPlus.filter((analysis) => analysis.selectAttempted).length, qPlus.length),
      commitAfterGroundingRate: ratio(qPlus.filter((analysis) => analysis.grounded && analysis.commitAttemptedAfterGrounding).length, qPlus.filter((analysis) => analysis.grounded).length),
      progressAfterGroundingRate: ratio(qPlus.filter((analysis) => analysis.progressAfterGrounding).length, qPlus.filter((analysis) => analysis.grounded).length),
      unnecessaryConfirmation: ratio(qPlus.filter((analysis) => analysis.unnecessaryConfirmation).length, qPlus.length)
    },
    qMinus: {
      turns: qMinus.length,
      commitRateWhenQuantityMissing: ratio(qMinus.filter((analysis) => analysis.selectAttempted).length, qMinus.length),
      requestQuantityRateWhenMissing: ratio(qMinus.filter((analysis) => analysis.askedForQuantity).length, qMinus.length),
      respondWithoutCommitOrQuantityQuestion: ratio(qMinus.filter((analysis) => !analysis.selectAttempted && !analysis.askedForQuantity && analysis.category !== "COMMIT_SUCCESS").length, qMinus.length),
      assumedQuantity: ratio(qMinus.filter((analysis) => analysis.assumedQuantity).length, qMinus.length),
      progressAfterGroundingRate: ratio(qMinus.filter((analysis) => analysis.progressAfterGrounding).length, qMinus.filter((analysis) => analysis.grounded).length)
    },
    quantityRequestAccuracy: ratio(qMinus.filter((analysis) => analysis.askedForQuantity).length + qPlus.filter((analysis) => !analysis.askedForQuantity || analysis.selectAttempted).length, explicit.length),
    clarificationTurnRate: ratio(explicit.filter((analysis) => analysis.endedWithQuestion).length, explicit.length),
    negativeControls: {
      informationalTurns: informational.length,
      overMutation: ratio(informational.filter((analysis) => analysis.mutationRequested.length > 0).length, informational.length),
      overMutationDurable: ratio(informational.filter((analysis) => analysis.overMutationDurable).length, informational.length)
    },
    wrongQuantity: ratio(qPlus.filter((analysis) => analysis.wrongQuantity).length, qPlus.filter((analysis) => analysis.selectCompleted).length),
    selectionCorruption: ratio(analyses.filter((analysis) => analysis.selectionCorruption).length, analyses.length),
    repeatedMutationCalls: ratio(analyses.filter((analysis) => analysis.repeatedMutationCall).length, analyses.length),
    shared: {
      validArgumentsRate: shared.validArgumentsRate,
      gatewayCompletionRate: shared.gatewayCompletionRate,
      gatewayRejectionRate: shared.gatewayRejectionRate,
      unnecessaryRequestionRate: shared.unnecessaryRequestionRate,
      duplicateToolCallRate: shared.duplicateToolCallRate,
      ungroundedMutationClaimRate: shared.ungroundedMutationClaimRate,
      terminalReasonDistribution: shared.terminalReasonDistribution
    },
    toolQuality: {
      toolCallsPerTurn: mean(turnTraces.map((turn) => turn.toolInvocations.length)),
      providerCallsPerTurn: mean(turnTraces.map((turn) => turn.providerCalls.length)),
      argumentFailureCalls: ratio(invocations.filter((invocation) => invocation.gateway?.status === "invalid_arguments" || invocation.toolObservation.errorCode === "invalid_arguments_json").length, invocations.length),
      providerInvalidResponseCalls: ratio(calls.filter((call) => call.outcome === "invalid_response").length, calls.length),
      preGatewayRejections: invocations.filter((invocation) => invocation.gateway === null).length
    },
    latency: {
      perCallMs: { p50: pct(calls.map((call) => call.elapsedMs ?? 0), 0.5), p95: pct(calls.map((call) => call.elapsedMs ?? 0), 0.95) },
      perTurnProviderMs: { p50: pct(analyses.map((analysis) => analysis.providerMs), 0.5), p95: pct(analyses.map((analysis) => analysis.providerMs), 0.95) }
    },
    tokens: { inputPerTurnMean: analyses.length > 0 ? inputTokens / analyses.length : null, outputPerTurnMean: analyses.length > 0 ? outputTokens / analyses.length : null, inputTotal: inputTokens, outputTotal: outputTokens },
    failureCategoryDistribution,
    prompt: {
      systemPromptCharsMean: mean(stats.map((value) => value.systemPromptChars)),
      systemPromptApproxTokensMean: mean(stats.map((value) => value.systemPromptApproxTokens)),
      policyLineCountMean: mean(stats.map((value) => value.policyLineCount)),
      toolContractCharsMean: mean(stats.map((value) => value.toolContractChars)),
      distinctPromptSha256: [...new Set(executedRecords.map((record) => record.runConfig.promptSha256).filter((hash): hash is string => hash !== null))]
    }
  };
}

// ---------------------------------------------------------------------------
// Taxes, comparison and signal (thresholds fixed BEFORE any run)
// ---------------------------------------------------------------------------

export const TRUE_SIGNAL_THRESHOLDS = {
  /** A difference in commercialProgressFixedCohortRate of at least this (absolute) is a material tax. */
  materialProgressDelta: 0.2,
  maxOverMutationRate: 0.1,
  maxOverMutationExcessOverA: 0.1,
  maxValidArgumentsDrop: 0.05,
  maxGatewayRejectionExcess: 0.05,
  maxWrongQuantityExcess: 0.1,
  /** "All arms fail": best arm below this fixed-cohort progress rate. */
  allFailCeiling: 0.6,
  minExplicitTurns: 18
} as const;

export const TRUE_ARCHITECTURE_SIGNALS = ["R3_FAVORED", "PURE_HARNESS_FAVORED", "CAPABILITY_CONTRACT_IS_BOTTLENECK", "MODEL_OR_DOMAIN_CONTRACT_IS_BOTTLENECK", "NO_CLEAR_WINNER"] as const;
export type TrueArchitectureSignal = (typeof TRUE_ARCHITECTURE_SIGNALS)[number];

type Pair = { first: number | null; second: number | null; delta: number | null };
const pair = (first: number | null, second: number | null): Pair => ({ first, second, delta: first !== null && second !== null ? second - first : null });

export type TrueDelta = {
  from: TrueArmId;
  to: TrueArmId;
  commercialProgressFixedCohortRate: Pair;
  commercialProgressAfterGroundingRate: Pair;
  commitAfterGroundingRate: Pair;
  durableCommitRate: Pair;
  qPlusCommitRate: Pair;
  qMinusRequestQuantityRate: Pair;
  qMinusCommitRate: Pair;
  overMutationRate: Pair;
  unnecessaryConfirmationQPlus: Pair;
  validArgumentsRate: Pair;
  gatewayRejectionRate: Pair;
  argumentFailureRate: Pair;
  toolCallsPerTurn: Pair;
  providerCallsPerTurn: Pair;
  clarificationTurnRate: Pair;
  inputTokensPerTurn: Pair;
  latencyPerCallP95Ms: Pair;
  systemPromptChars: Pair;
  toolContractChars: Pair;
};

export function computeDelta(a: TrueArmMetrics, b: TrueArmMetrics): TrueDelta {
  return {
    from: a.arm,
    to: b.arm,
    commercialProgressFixedCohortRate: pair(a.commercialProgressFixedCohortRate.rate, b.commercialProgressFixedCohortRate.rate),
    commercialProgressAfterGroundingRate: pair(a.commercialProgressAfterGroundingRate.rate, b.commercialProgressAfterGroundingRate.rate),
    commitAfterGroundingRate: pair(a.commitAfterGroundingRate.rate, b.commitAfterGroundingRate.rate),
    durableCommitRate: pair(a.durableCommitRate.rate, b.durableCommitRate.rate),
    qPlusCommitRate: pair(a.qPlus.commitRateWhenQuantityKnown.rate, b.qPlus.commitRateWhenQuantityKnown.rate),
    qMinusRequestQuantityRate: pair(a.qMinus.requestQuantityRateWhenMissing.rate, b.qMinus.requestQuantityRateWhenMissing.rate),
    qMinusCommitRate: pair(a.qMinus.commitRateWhenQuantityMissing.rate, b.qMinus.commitRateWhenQuantityMissing.rate),
    overMutationRate: pair(a.negativeControls.overMutation.rate, b.negativeControls.overMutation.rate),
    unnecessaryConfirmationQPlus: pair(a.qPlus.unnecessaryConfirmation.rate, b.qPlus.unnecessaryConfirmation.rate),
    validArgumentsRate: pair(a.shared.validArgumentsRate, b.shared.validArgumentsRate),
    gatewayRejectionRate: pair(a.shared.gatewayRejectionRate, b.shared.gatewayRejectionRate),
    argumentFailureRate: pair(a.toolQuality.argumentFailureCalls.rate, b.toolQuality.argumentFailureCalls.rate),
    toolCallsPerTurn: pair(a.toolQuality.toolCallsPerTurn, b.toolQuality.toolCallsPerTurn),
    providerCallsPerTurn: pair(a.toolQuality.providerCallsPerTurn, b.toolQuality.providerCallsPerTurn),
    clarificationTurnRate: pair(a.clarificationTurnRate.rate, b.clarificationTurnRate.rate),
    inputTokensPerTurn: pair(a.tokens.inputPerTurnMean, b.tokens.inputPerTurnMean),
    latencyPerCallP95Ms: pair(a.latency.perCallMs.p95, b.latency.perCallMs.p95),
    systemPromptChars: pair(a.prompt.systemPromptCharsMean, b.prompt.systemPromptCharsMean),
    toolContractChars: pair(a.prompt.toolContractCharsMean, b.prompt.toolContractCharsMean)
  };
}

function isSafe(arm: TrueArmMetrics, baseline: TrueArmMetrics): boolean {
  const t = TRUE_SIGNAL_THRESHOLDS;
  const nz = (value: number | null) => value ?? 0;
  const overMutation = arm.negativeControls.overMutation.rate;
  if (overMutation !== null && (overMutation > t.maxOverMutationRate || overMutation > nz(baseline.negativeControls.overMutation.rate) + t.maxOverMutationExcessOverA)) return false;
  if (nz(arm.selectionCorruption.rate) > nz(baseline.selectionCorruption.rate)) return false;
  if (arm.shared.validArgumentsRate !== null && baseline.shared.validArgumentsRate !== null && arm.shared.validArgumentsRate < baseline.shared.validArgumentsRate - t.maxValidArgumentsDrop) return false;
  if (arm.shared.gatewayRejectionRate !== null && arm.shared.gatewayRejectionRate > nz(baseline.shared.gatewayRejectionRate) + t.maxGatewayRejectionExcess) return false;
  if (arm.wrongQuantity.rate !== null && arm.wrongQuantity.rate > nz(baseline.wrongQuantity.rate) + t.maxWrongQuantityExcess) return false;
  return true;
}

export type TrueComparison = {
  denominatorDefinition: string;
  A_vs_B_harness_tax: TrueDelta;
  B_vs_C_capability_tax: TrueDelta;
  A_vs_C_total_difference: TrueDelta;
  capabilityContractTax: {
    toolContractCharsB: number | null;
    toolContractCharsC1: number | null;
    relevantToolContractReduction: number | null;
    invalidArgsB: number | null;
    invalidArgsC1: number | null;
    clarificationTurnsB: number | null;
    clarificationTurnsC1: number | null;
  };
  dataQuality: { harnessFailures: Record<TrueArmId, number>; explicitPurchaseTurns: Record<TrueArmId, number>; sufficient: boolean };
  architectureSignal: { signal: TrueArchitectureSignal; candidateOnly: true; harnessTaxDetected: boolean; capabilityTaxDetected: boolean; thresholds: typeof TRUE_SIGNAL_THRESHOLDS; safe: Record<TrueArmId, boolean>; reasons: string[] };
};

export function compareArms(metrics: Record<TrueArmId, TrueArmMetrics>): TrueComparison {
  const a = metrics.A_R3_CURRENT;
  const b = metrics.B_PURE_CURRENT_TOOLS;
  const c = metrics.C1_PURE_THIN_TOOLS;
  const t = TRUE_SIGNAL_THRESHOLDS;
  const pa = a.commercialProgressFixedCohortRate.rate;
  const pb = b.commercialProgressFixedCohortRate.rate;
  const pc = c.commercialProgressFixedCohortRate.rate;
  const safe = { A_R3_CURRENT: true, B_PURE_CURRENT_TOOLS: isSafe(b, a), C1_PURE_THIN_TOOLS: isSafe(c, a) };
  const sufficient = TRUE_ARM_IDS.every((arm) => metrics[arm].harnessFailures === 0 && metrics[arm].explicitPurchaseTurns >= t.minExplicitTurns);

  const harnessTax = pa !== null && pb !== null && pb - pa >= t.materialProgressDelta && safe.B_PURE_CURRENT_TOOLS;
  const capabilityTax = pb !== null && pc !== null && pc - pb >= t.materialProgressDelta && safe.C1_PURE_THIN_TOOLS;
  const r3Better = pa !== null && pb !== null && pc !== null && pa - Math.max(pb, pc) >= t.materialProgressDelta;

  const reasons: string[] = [];
  let signal: TrueArchitectureSignal = "NO_CLEAR_WINNER";
  if (!sufficient) {
    reasons.push("insufficient data (harness failures or explicit-purchase turns below the minimum)");
  } else if (r3Better) {
    signal = "R3_FAVORED";
    reasons.push("A beats both autonomous arms by the material margin");
  } else if (harnessTax || capabilityTax) {
    const harnessGain = harnessTax && pa !== null && pb !== null ? pb - pa : 0;
    const capabilityGain = capabilityTax && pb !== null && pc !== null ? pc - pb : 0;
    signal = capabilityGain > harnessGain ? "CAPABILITY_CONTRACT_IS_BOTTLENECK" : "PURE_HARNESS_FAVORED";
    if (harnessTax) reasons.push("B improves on A by the material margin (harness/orchestration tax)");
    if (capabilityTax) reasons.push("C1 improves on B by the material margin (capability contract tax)");
  } else {
    const best = Math.max(pa ?? 0, pb ?? 0, pc ?? 0);
    const spread = Math.max(pa ?? 0, pb ?? 0, pc ?? 0) - Math.min(pa ?? 0, pb ?? 0, pc ?? 0);
    if (spread < t.materialProgressDelta && best < t.allFailCeiling) {
      signal = "MODEL_OR_DOMAIN_CONTRACT_IS_BOTTLENECK";
      reasons.push("all three arms within the material margin and none above the all-fail ceiling");
    } else {
      reasons.push("differences below the material margin or mixed, with a high-performing arm");
    }
  }

  const ratioOrNull = (x: number | null, y: number | null) => (x !== null && y !== null && y > 0 ? 1 - x / y : null);
  return {
    denominatorDefinition:
      "commercialProgressFixedCohortRate: every explicit-purchase turn (fixed per-turn annotation, identical for A/B/C1); success = Q+ (quantity stated): select_products requested; Q- (quantity missing): the reply specifically asks for the quantity without inventing one (or, for E14 t1, requests the quote). commercialProgressAfterGroundingRate: same success rule restricted to turns in which get_product_details completed (denominator depends on the arm).",
    A_vs_B_harness_tax: computeDelta(a, b),
    B_vs_C_capability_tax: computeDelta(b, c),
    A_vs_C_total_difference: computeDelta(a, c),
    capabilityContractTax: {
      toolContractCharsB: b.prompt.toolContractCharsMean,
      toolContractCharsC1: c.prompt.toolContractCharsMean,
      relevantToolContractReduction: ratioOrNull(c.prompt.toolContractCharsMean, b.prompt.toolContractCharsMean),
      invalidArgsB: b.toolQuality.argumentFailureCalls.rate,
      invalidArgsC1: c.toolQuality.argumentFailureCalls.rate,
      clarificationTurnsB: b.clarificationTurnRate.rate,
      clarificationTurnsC1: c.clarificationTurnRate.rate
    },
    dataQuality: {
      harnessFailures: { A_R3_CURRENT: a.harnessFailures, B_PURE_CURRENT_TOOLS: b.harnessFailures, C1_PURE_THIN_TOOLS: c.harnessFailures },
      explicitPurchaseTurns: { A_R3_CURRENT: a.explicitPurchaseTurns, B_PURE_CURRENT_TOOLS: b.explicitPurchaseTurns, C1_PURE_THIN_TOOLS: c.explicitPurchaseTurns },
      sufficient
    },
    architectureSignal: { signal, candidateOnly: true, harnessTaxDetected: harnessTax, capabilityTaxDetected: capabilityTax, thresholds: t, safe, reasons }
  };
}
