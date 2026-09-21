import { analyzeRun, type AbRunConfig, type AbRunRecord, type P78TurnAnalysis } from "../r3AutonomousAB/analysis";
import { computeBenchmarkE2ESummaryMetrics } from "../r3CommercialE2E/metrics";
import type { BenchmarkE2ERunTrace, BenchmarkE2ETurnTrace } from "../r3CommercialE2E/types";
import { ISOLATION_ANNOTATION_RESOLVER, scenarioById, type IsolationGroup } from "./isolationCorpus";
import { classifyReply, type ReplyClass } from "./replyClassifier";
import { ISOLATION_VARIANT_IDS, type IsolationVariantId } from "./isolationSurfaces";

/**
 * SALES-AGENT-R3-P7.9. Pure analysis (no IO). Q- (quantity missing), Q+ (quantity
 * known) and negative controls are measured separately; the aggregate is only a
 * summary. Per-turn tool/durable facts come from the same analyzeRun P7.8/P7.8-R use;
 * what the reply IS comes from the frozen replyClassifier. The promotion rule and
 * the signal mapping below are PRE-REGISTERED (fixed before any batch).
 */

export type IsolationRunRecord = {
  pairId: string;
  variant: IsolationVariantId;
  caseId: string;
  group: IsolationGroup;
  runOrdinal: number;
  sequenceIndex: number;
  trace: BenchmarkE2ERunTrace | null;
  harnessError: string | null;
  runConfig: { variant: IsolationVariantId; model: string | null; temperature: number | null; thinking: "enabled" | "disabled" | null; timeoutMs: number; maxOutputTokens: number | null; maxModelRetries: number | null; promptVersion: string; promptSha256: string | null; toolContractSha16: string };
  promptStats: { systemPromptChars: number; systemPromptApproxTokens: number; toolContractChars: number; providerCallCount: number } | null;
};

const MUTATIONS = new Set(["select_products", "set_shipping_destination", "create_quote"]);
const CATALOG_READS = new Set(["search_products", "get_product_details", "search_products_by_semantics", "explore_catalog", "search_company_knowledge", "recommend_catalog_products"]);

export const QPLUS_FAILURE_MODES = ["malformed_call", "harness_terminal", "other_tool", "regrounding", "asks_known_quantity", "generic_confirmation", "link_offer", "information", "other_final_response"] as const;
export type QPlusFailureMode = (typeof QPLUS_FAILURE_MODES)[number];

export type IsolationTurn = Omit<P78TurnAnalysis, "variant"> & {
  variant: IsolationVariantId;
  scenarioGroup: IsolationGroup;
  replyClass: ReplyClass;
  asksQuantity: boolean;
  /** Fixed cohort success: Q- asked for the quantity without selecting; Q+ select_products requested. */
  progressFixed: boolean;
  /** Same success rule restricted to turns in which get_product_details completed. */
  progressAfterGrounding: boolean;
  assumedQuantity: boolean;
  wrongProduct: boolean;
  qPlusFailureMode: QPlusFailureMode | null;
  /** A context turn (before the analysed one) requested a mutation: the scenario is contaminated (reported, never excluded). */
  contextTurnMutation: boolean;
  toolSequence: string;
};

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const mean = (values: readonly number[]) => (values.length > 0 ? sum(values) / values.length : null);
function pct(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function qPlusFailureMode(turn: BenchmarkE2ETurnTrace, replyClass: ReplyClass): QPlusFailureMode {
  const invocations = [...turn.toolInvocations].sort((left, right) => left.stepIndex - right.stepIndex);
  if (invocations.some((invocation) => invocation.gateway === null || invocation.gateway.status === "invalid_arguments")) return "malformed_call";
  if (turn.response.terminalReason !== "responded") return "harness_terminal";
  if (invocations.some((invocation) => !CATALOG_READS.has(invocation.capability) && invocation.capability !== "select_products")) return "other_tool";
  const firstGrounding = invocations.findIndex((invocation) => invocation.capability === "get_product_details" && invocation.toolObservation.status === "completed");
  if (firstGrounding >= 0 && invocations.slice(firstGrounding + 1).some((invocation) => CATALOG_READS.has(invocation.capability))) return "regrounding";
  if (replyClass === "CORRECT_QUANTITY_REQUEST") return "asks_known_quantity";
  if (replyClass === "GENERIC_CONFIRMATION") return "generic_confirmation";
  if (replyClass === "LINK_OFFER") return "link_offer";
  if (replyClass === "PRODUCT_INFORMATION") return "information";
  return "other_final_response";
}

export function analyzeIsolationRun(record: IsolationRunRecord): IsolationTurn[] {
  const asAb: AbRunRecord = {
    pairId: record.pairId,
    variant: "B_AUTONOMOUS",
    caseId: record.caseId,
    runOrdinal: record.runOrdinal,
    sequenceIndex: record.sequenceIndex,
    firstInPair: false,
    isNegativeControl: record.group === "NEG",
    trace: record.trace,
    harnessError: record.harnessError,
    runConfig: record.runConfig as unknown as AbRunConfig,
    promptStats: null
  };
  const scenario = scenarioById(record.caseId);
  const contextTurnMutation = (record.trace?.turns ?? []).slice(0, -1).some((turn) => turn.toolInvocations.some((invocation) => MUTATIONS.has(invocation.capability)));
  return analyzeRun(asAb, ISOLATION_ANNOTATION_RESOLVER).map((analysis) => {
    const turn = record.trace?.turns[analysis.turnOrdinal];
    const replyClass = analysis.executed ? classifyReply(turn?.response.finalMessage) : "NO_REPLY";
    const asksQuantity = replyClass === "CORRECT_QUANTITY_REQUEST";
    const qMinus = record.group === "Q-";
    const qPlus = record.group === "Q+";
    const items = turn?.durableStateAfterTurn?.selection.items ?? [];
    const expected = scenario.expected;
    const wrongProduct = qPlus && analysis.selectCompleted && expected !== undefined && !(items.length === 1 && items[0].productId === expected.productId);
    const fixed = analysis.executed && (qMinus ? asksQuantity && !analysis.selectAttempted : qPlus ? analysis.selectAttempted : false);
    const afterGrounding = analysis.executed && analysis.grounded && (qMinus ? asksQuantity && !analysis.selectAttempted : qPlus ? analysis.commitAttemptedAfterGrounding : false);
    return {
      ...analysis,
      variant: record.variant,
      scenarioGroup: record.group,
      askedForQuantity: asksQuantity,
      replyClass,
      asksQuantity,
      progressFixed: fixed,
      progressAfterGrounding: afterGrounding,
      assumedQuantity: qMinus && analysis.selectAttempted,
      wrongProduct,
      qPlusFailureMode: qPlus && analysis.executed && !analysis.selectAttempted && turn ? qPlusFailureMode(turn, replyClass) : null,
      contextTurnMutation,
      toolSequence: analysis.toolCalls.map((call) => `${call.capability}:${call.toolStatus}`).join(">") || "(none)"
    } as IsolationTurn;
  });
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export type Ratio = { numerator: number; denominator: number; rate: number | null; wilson95: [number, number] | null };

/** Wilson score interval (95%) - reported next to every rate so n=36-per-cell effects are read with their width. */
function wilson(numerator: number, denominator: number): [number, number] | null {
  if (denominator === 0) return null;
  const z = 1.96;
  const p = numerator / denominator;
  const denom = 1 + (z * z) / denominator;
  const center = (p + (z * z) / (2 * denominator)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / denominator + (z * z) / (4 * denominator * denominator))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}
export const ratio = (numerator: number, denominator: number): Ratio => ({ numerator, denominator, rate: denominator > 0 ? numerator / denominator : null, wilson95: wilson(numerator, denominator) });

export type IsolationVariantMetrics = {
  variant: IsolationVariantId;
  runsExecuted: number;
  harnessFailures: number;
  turnsAnalyzed: number;
  contextContaminatedRuns: number;
  qMinus: {
    turns: number;
    groundedTurns: number;
    /** PRIMARY (pre-registered, Q- side): asked for the quantity without selecting, over grounded Q- turns. */
    commercialProgressAfterGroundingRate: Ratio;
    commercialProgressFixedCohortRate: Ratio;
    /** Promotion metric: the reply is a CORRECT_QUANTITY_REQUEST, over every Q- turn. */
    explicitQuantityRequestRate: Ratio;
    genericConfirmationRate: Ratio;
    linkOfferRate: Ratio;
    informationalCloseRate: Ratio;
    otherQuestionRate: Ratio;
    noReplyRate: Ratio;
    selectAttemptedRate: Ratio;
    assumedQuantityRate: Ratio;
  };
  qPlus: {
    turns: number;
    groundedTurns: number;
    /** PRIMARY (pre-registered, Q+ side): select_products requested after grounding, over grounded Q+ turns. */
    commercialProgressAfterGroundingRate: Ratio;
    /** Promotion metric: select_products requested over every Q+ turn. */
    commitRate: Ratio;
    durableCommitRate: Ratio;
    wrongQuantityRate: Ratio;
    wrongProductRate: Ratio;
    failureModes: Record<QPlusFailureMode, number>;
    failureModeReplyClasses: Record<string, number>;
  };
  negatives: { turns: number; overMutationRate: Ratio; overMutationDurableRate: Ratio; mutationsByCapability: Record<string, number> };
  /** Summary only (Q- and Q+ pooled): never the sole interpretation. */
  aggregate: { commercialProgressAfterGroundingRate: Ratio; commercialProgressFixedCohortRate: Ratio; commitAfterGroundingRate: Ratio; durableCommitAfterGroundingRate: Ratio };
  quality: {
    selectionCorruptionRate: Ratio;
    validArgumentsRate: number | null;
    gatewayRejectionRate: number | null;
    duplicateToolCallRate: number | null;
    argumentFailureCalls: Ratio;
    providerInvalidResponseCalls: Ratio;
    toolCallsPerTurn: number | null;
    providerCallsPerTurn: number | null;
    terminalReasonDistribution: Record<string, number>;
  };
  latency: { perCallMs: { p50: number | null; p90: number | null; p95: number | null }; perTurnProviderMs: { p50: number | null; p90: number | null; p95: number | null } };
  tokens: { inputPerTurnMean: number | null; outputPerTurnMean: number | null };
  contract: { toolContractCharsMean: number | null; distinctToolContractSha16: string[]; distinctPromptSha256: string[] };
  scenarioBreakdown: Record<string, { group: IsolationGroup; successes: number; turns: number }>;
};

export function computeIsolationVariantMetrics(variant: IsolationVariantId, records: readonly IsolationRunRecord[]): IsolationVariantMetrics {
  const mine = records.filter((record) => record.variant === variant);
  const executedRecords = mine.filter((record) => record.trace !== null);
  const traces = executedRecords.map((record) => record.trace as BenchmarkE2ERunTrace);
  const turns = mine.flatMap(analyzeIsolationRun).filter((turn) => turn.executed);
  const qm = turns.filter((turn) => turn.scenarioGroup === "Q-");
  const qp = turns.filter((turn) => turn.scenarioGroup === "Q+");
  const neg = turns.filter((turn) => turn.scenarioGroup === "NEG");
  const explicit = [...qm, ...qp];
  const explicitGrounded = explicit.filter((turn) => turn.grounded);
  const turnTraces = traces.flatMap((trace) => trace.turns);
  const calls = turnTraces.flatMap((turn) => [...turn.providerCalls]);
  const invocations = turnTraces.flatMap((turn) => turn.toolInvocations);
  const shared = computeBenchmarkE2ESummaryMetrics(traces);
  const inputTokens = sum(turns.map((turn) => turn.inputTokens));
  const outputTokens = sum(turns.map((turn) => turn.outputTokens));
  const of = (list: readonly IsolationTurn[], klass: ReplyClass) => ratio(list.filter((turn) => turn.replyClass === klass).length, list.length);

  const failureModes = Object.fromEntries(QPLUS_FAILURE_MODES.map((mode) => [mode, 0])) as Record<QPlusFailureMode, number>;
  const failureModeReplyClasses: Record<string, number> = {};
  for (const turn of qp) {
    if (turn.qPlusFailureMode) {
      failureModes[turn.qPlusFailureMode] += 1;
      failureModeReplyClasses[turn.replyClass] = (failureModeReplyClasses[turn.replyClass] ?? 0) + 1;
    }
  }
  const mutationsByCapability: Record<string, number> = {};
  for (const turn of neg) for (const capability of turn.mutationRequested) mutationsByCapability[capability] = (mutationsByCapability[capability] ?? 0) + 1;

  const scenarioBreakdown: IsolationVariantMetrics["scenarioBreakdown"] = {};
  for (const turn of turns) {
    const entry = (scenarioBreakdown[turn.caseId] ??= { group: turn.scenarioGroup, successes: 0, turns: 0 });
    entry.turns += 1;
    if (turn.scenarioGroup === "NEG" ? turn.mutationRequested.length === 0 : turn.progressFixed) entry.successes += 1;
  }
  const stats = executedRecords.map((record) => record.promptStats).filter((value): value is NonNullable<typeof value> => value !== null);

  return {
    variant,
    runsExecuted: executedRecords.length,
    harnessFailures: mine.length - executedRecords.length,
    turnsAnalyzed: turns.length,
    contextContaminatedRuns: new Set(mine.flatMap(analyzeIsolationRun).filter((turn) => turn.contextTurnMutation).map((turn) => `${turn.caseId}-${turn.runOrdinal}`)).size,
    qMinus: {
      turns: qm.length,
      groundedTurns: qm.filter((turn) => turn.grounded).length,
      commercialProgressAfterGroundingRate: ratio(qm.filter((turn) => turn.progressAfterGrounding).length, qm.filter((turn) => turn.grounded).length),
      commercialProgressFixedCohortRate: ratio(qm.filter((turn) => turn.progressFixed).length, qm.length),
      explicitQuantityRequestRate: of(qm, "CORRECT_QUANTITY_REQUEST"),
      genericConfirmationRate: of(qm, "GENERIC_CONFIRMATION"),
      linkOfferRate: of(qm, "LINK_OFFER"),
      informationalCloseRate: of(qm, "PRODUCT_INFORMATION"),
      otherQuestionRate: of(qm, "OTHER_QUESTION"),
      noReplyRate: of(qm, "NO_REPLY"),
      selectAttemptedRate: ratio(qm.filter((turn) => turn.selectAttempted).length, qm.length),
      assumedQuantityRate: ratio(qm.filter((turn) => turn.assumedQuantity).length, qm.length)
    },
    qPlus: {
      turns: qp.length,
      groundedTurns: qp.filter((turn) => turn.grounded).length,
      commercialProgressAfterGroundingRate: ratio(qp.filter((turn) => turn.progressAfterGrounding).length, qp.filter((turn) => turn.grounded).length),
      commitRate: ratio(qp.filter((turn) => turn.selectAttempted).length, qp.length),
      durableCommitRate: ratio(qp.filter((turn) => turn.selectCompleted && turn.durableSelectionAfterTurn).length, qp.length),
      wrongQuantityRate: ratio(qp.filter((turn) => turn.wrongQuantity).length, qp.filter((turn) => turn.selectCompleted).length),
      wrongProductRate: ratio(qp.filter((turn) => turn.wrongProduct).length, qp.filter((turn) => turn.selectCompleted).length),
      failureModes,
      failureModeReplyClasses
    },
    negatives: {
      turns: neg.length,
      overMutationRate: ratio(neg.filter((turn) => turn.mutationRequested.length > 0).length, neg.length),
      overMutationDurableRate: ratio(neg.filter((turn) => turn.overMutationDurable).length, neg.length),
      mutationsByCapability
    },
    aggregate: {
      commercialProgressAfterGroundingRate: ratio(explicitGrounded.filter((turn) => turn.progressAfterGrounding).length, explicitGrounded.length),
      commercialProgressFixedCohortRate: ratio(explicit.filter((turn) => turn.progressFixed).length, explicit.length),
      commitAfterGroundingRate: ratio(explicitGrounded.filter((turn) => turn.commitAttemptedAfterGrounding).length, explicitGrounded.length),
      durableCommitAfterGroundingRate: ratio(explicitGrounded.filter((turn) => turn.durableCommitAfterGrounding).length, explicitGrounded.length)
    },
    quality: {
      selectionCorruptionRate: ratio(turns.filter((turn) => turn.selectionCorruption).length, turns.length),
      validArgumentsRate: shared.validArgumentsRate,
      gatewayRejectionRate: shared.gatewayRejectionRate,
      duplicateToolCallRate: shared.duplicateToolCallRate,
      argumentFailureCalls: ratio(invocations.filter((invocation) => invocation.gateway?.status === "invalid_arguments" || invocation.toolObservation.errorCode === "invalid_arguments_json").length, invocations.length),
      providerInvalidResponseCalls: ratio(calls.filter((call) => call.outcome === "invalid_response").length, calls.length),
      toolCallsPerTurn: mean(turnTraces.map((turn) => turn.toolInvocations.length)),
      providerCallsPerTurn: mean(turnTraces.map((turn) => turn.providerCalls.length)),
      terminalReasonDistribution: shared.terminalReasonDistribution
    },
    latency: {
      perCallMs: { p50: pct(calls.map((call) => call.elapsedMs ?? 0), 0.5), p90: pct(calls.map((call) => call.elapsedMs ?? 0), 0.9), p95: pct(calls.map((call) => call.elapsedMs ?? 0), 0.95) },
      perTurnProviderMs: { p50: pct(turns.map((turn) => turn.providerMs), 0.5), p90: pct(turns.map((turn) => turn.providerMs), 0.9), p95: pct(turns.map((turn) => turn.providerMs), 0.95) }
    },
    tokens: { inputPerTurnMean: turns.length > 0 ? inputTokens / turns.length : null, outputPerTurnMean: turns.length > 0 ? outputTokens / turns.length : null },
    contract: {
      toolContractCharsMean: mean(stats.map((value) => value.toolContractChars)),
      distinctToolContractSha16: [...new Set(executedRecords.map((record) => record.runConfig.toolContractSha16))],
      distinctPromptSha256: [...new Set(executedRecords.map((record) => record.runConfig.promptSha256).filter((hash): hash is string => hash !== null))]
    },
    scenarioBreakdown
  };
}

// ---------------------------------------------------------------------------
// Pre-registered promotion rule, comparison and signal
// ---------------------------------------------------------------------------

export const ISOLATION_THRESHOLDS = {
  /** A partial variant is a candidate if it beats B0 by at least this many percentage points on Q- explicit quantity request OR Q+ commit rate... */
  minGainPp: 20,
  /** ...without exceeding B0 by more than this many pp on over-mutation, invalid arguments or Gateway rejection, and without more selection corruption than B0. */
  maxSafetyExcessPp: 5
} as const;

export const ISOLATION_SIGNALS = ["USEWHEN_IS_BOTTLENECK", "DONOTUSEWHEN_IS_BOTTLENECK", "DESCRIPTION_IS_BOTTLENECK", "SCHEMA_PRESENTATION_IS_BOTTLENECK", "COMBINED_CONTRACT_COMPLEXITY_IS_BOTTLENECK", "CAPABILITY_TAX_NOT_REPLICATED", "MULTIPLE_FACTORS", "NO_CLEAR_CAUSE"] as const;
export type IsolationSignal = (typeof ISOLATION_SIGNALS)[number];

const pp = (value: number | null, base: number | null): number | null => (value !== null && base !== null ? (value - base) * 100 : null);
const nz = (value: number | null) => value ?? 0;

export type PromotionEvaluation = {
  variant: IsolationVariantId;
  qMinusExplicitRequestGainPp: number | null;
  qPlusCommitGainPp: number | null;
  qMinusPasses: boolean;
  qPlusPasses: boolean;
  safety: { overMutationExcessPp: number | null; invalidArgsExcessPp: number | null; gatewayRejectionExcessPp: number | null; selectionCorruptionExcessPp: number | null; ok: boolean };
  /** Effect AND safe, per problem and overall. */
  candidateQMinus: boolean;
  candidateQPlus: boolean;
  candidate: boolean;
  effectButUnsafe: boolean;
};

export function evaluatePromotion(variant: IsolationVariantMetrics, control: IsolationVariantMetrics): PromotionEvaluation {
  const t = ISOLATION_THRESHOLDS;
  const qMinusGain = pp(variant.qMinus.explicitQuantityRequestRate.rate, control.qMinus.explicitQuantityRequestRate.rate);
  const qPlusGain = pp(variant.qPlus.commitRate.rate, control.qPlus.commitRate.rate);
  const overMutation = pp(variant.negatives.overMutationRate.rate, control.negatives.overMutationRate.rate);
  const invalid = pp(variant.quality.argumentFailureCalls.rate, control.quality.argumentFailureCalls.rate);
  const rejection = pp(nz(variant.quality.gatewayRejectionRate), nz(control.quality.gatewayRejectionRate));
  const corruption = pp(variant.quality.selectionCorruptionRate.rate, control.quality.selectionCorruptionRate.rate);
  const ok = nz(overMutation) <= t.maxSafetyExcessPp && nz(invalid) <= t.maxSafetyExcessPp && nz(rejection) <= t.maxSafetyExcessPp && nz(corruption) <= 0;
  const qMinusPasses = qMinusGain !== null && qMinusGain >= t.minGainPp;
  const qPlusPasses = qPlusGain !== null && qPlusGain >= t.minGainPp;
  return {
    variant: variant.variant,
    qMinusExplicitRequestGainPp: qMinusGain,
    qPlusCommitGainPp: qPlusGain,
    qMinusPasses,
    qPlusPasses,
    safety: { overMutationExcessPp: overMutation, invalidArgsExcessPp: invalid, gatewayRejectionExcessPp: rejection, selectionCorruptionExcessPp: corruption, ok },
    candidateQMinus: qMinusPasses && ok,
    candidateQPlus: qPlusPasses && ok,
    candidate: (qMinusPasses || qPlusPasses) && ok,
    effectButUnsafe: (qMinusPasses || qPlusPasses) && !ok
  };
}

const SINGLE_FACTOR_SIGNAL: Partial<Record<IsolationVariantId, IsolationSignal>> = {
  B1_THIN_DESCRIPTION: "DESCRIPTION_IS_BOTTLENECK",
  B2_NO_USEWHEN: "USEWHEN_IS_BOTTLENECK",
  B3_NO_DONOTUSEWHEN: "DONOTUSEWHEN_IS_BOTTLENECK",
  B5_STRIPPED_SCHEMA_ANNOTATIONS: "SCHEMA_PRESENTATION_IS_BOTTLENECK"
};

/** candidates: the partial variants (B1-B5) that passed the promotion rule for the problem under analysis; positiveControl: B6 evaluated the same way. */
export function deriveSignal(input: { candidates: ReadonlySet<IsolationVariantId>; positiveControl: { candidate: boolean; effectButUnsafe: boolean }; dataSufficient: boolean }): { signal: IsolationSignal; reason: string } {
  if (!input.dataSufficient) return { signal: "NO_CLEAR_CAUSE", reason: "insufficient data (harness failures or missing cells)" };
  const partial = ISOLATION_VARIANT_IDS.filter((id) => id !== "B0_CURRENT" && id !== "B6_FULL_THIN" && input.candidates.has(id));
  if (!input.positiveControl.candidate) {
    if (input.positiveControl.effectButUnsafe || partial.length > 0) return { signal: "NO_CLEAR_CAUSE", reason: input.positiveControl.effectButUnsafe ? "B6 shows an effect but violates a safety criterion" : `B6 does not reproduce the effect but ${partial.join(", ")} passed the rule` };
    return { signal: "CAPABILITY_TAX_NOT_REPLICATED", reason: "B6 (P7.8-R C1) does not pass the promotion rule against B0" };
  }
  const singles = partial.filter((id) => id !== "B4_THIN_PROSE");
  if (singles.length >= 2) return { signal: "MULTIPLE_FACTORS", reason: `${singles.join(", ")} each pass the rule` };
  if (singles.length === 1) return { signal: SINGLE_FACTOR_SIGNAL[singles[0]] as IsolationSignal, reason: `only ${singles[0]} passes the rule among the single-component variants` };
  return { signal: "COMBINED_CONTRACT_COMPLEXITY_IS_BOTTLENECK", reason: partial.includes("B4_THIN_PROSE") ? "no single component passes the rule; the combined prose (B4) and B6 do" : "no single component nor combined prose passes the rule; only the full thin contract (B6) does" };
}

export type IsolationComparison = {
  denominatorDefinition: string;
  thresholds: typeof ISOLATION_THRESHOLDS;
  promotion: Record<string, PromotionEvaluation>;
  deltasVsB0: Record<string, Record<string, number | null>>;
  replication: { status: "REPLICATED" | "NOT_REPLICATED" | "EFFECT_WITH_SAFETY_VIOLATION"; reason: string };
  signals: {
    overall: { signal: IsolationSignal; reason: string };
    missingQuantityCognition: { signal: IsolationSignal; reason: string; candidates: string[] };
    knownQuantityExecution: { signal: IsolationSignal; reason: string; candidates: string[] };
  };
  dataQuality: { harnessFailures: Record<string, number>; qMinusTurns: Record<string, number>; qPlusTurns: Record<string, number>; sufficient: boolean };
};

export const ISOLATION_MIN_TURNS_PER_GROUP = 30;

export function compareIsolation(metrics: Record<IsolationVariantId, IsolationVariantMetrics>): IsolationComparison {
  const control = metrics.B0_CURRENT;
  const promotion = Object.fromEntries(ISOLATION_VARIANT_IDS.filter((id) => id !== "B0_CURRENT").map((id) => [id, evaluatePromotion(metrics[id], control)]));
  const deltaPp = (pick: (m: IsolationVariantMetrics) => number | null, id: IsolationVariantId) => pp(pick(metrics[id]), pick(control));
  const deltasVsB0 = Object.fromEntries(
    ISOLATION_VARIANT_IDS.filter((id) => id !== "B0_CURRENT").map((id) => [
      id,
      {
        qMinusExplicitQuantityRequestPp: deltaPp((m) => m.qMinus.explicitQuantityRequestRate.rate, id),
        qMinusProgressAfterGroundingPp: deltaPp((m) => m.qMinus.commercialProgressAfterGroundingRate.rate, id),
        qMinusGenericConfirmationPp: deltaPp((m) => m.qMinus.genericConfirmationRate.rate, id),
        qMinusLinkOfferPp: deltaPp((m) => m.qMinus.linkOfferRate.rate, id),
        qMinusInformationalClosePp: deltaPp((m) => m.qMinus.informationalCloseRate.rate, id),
        qPlusCommitPp: deltaPp((m) => m.qPlus.commitRate.rate, id),
        qPlusDurableCommitPp: deltaPp((m) => m.qPlus.durableCommitRate.rate, id),
        qPlusProgressAfterGroundingPp: deltaPp((m) => m.qPlus.commercialProgressAfterGroundingRate.rate, id),
        aggregateProgressAfterGroundingPp: deltaPp((m) => m.aggregate.commercialProgressAfterGroundingRate.rate, id),
        aggregateProgressFixedCohortPp: deltaPp((m) => m.aggregate.commercialProgressFixedCohortRate.rate, id),
        overMutationPp: deltaPp((m) => m.negatives.overMutationRate.rate, id),
        argumentFailurePp: deltaPp((m) => m.quality.argumentFailureCalls.rate, id),
        gatewayRejectionPp: deltaPp((m) => nz(m.quality.gatewayRejectionRate), id),
        selectionCorruptionPp: deltaPp((m) => m.quality.selectionCorruptionRate.rate, id),
        inputTokensPerTurn: (metrics[id].tokens.inputPerTurnMean ?? 0) - (control.tokens.inputPerTurnMean ?? 0),
        latencyPerCallP95Ms: (metrics[id].latency.perCallMs.p95 ?? 0) - (control.latency.perCallMs.p95 ?? 0)
      }
    ])
  );

  const dataSufficient = ISOLATION_VARIANT_IDS.every((id) => metrics[id].harnessFailures === 0 && metrics[id].qMinus.turns >= ISOLATION_MIN_TURNS_PER_GROUP && metrics[id].qPlus.turns >= ISOLATION_MIN_TURNS_PER_GROUP);
  const b6 = promotion.B6_FULL_THIN;
  const replication: IsolationComparison["replication"] = b6.candidate
    ? { status: "REPLICATED", reason: "B6 (P7.8-R C1) passes the promotion rule against B0 and is safe" }
    : b6.effectButUnsafe
      ? { status: "EFFECT_WITH_SAFETY_VIOLATION", reason: "B6 shows the effect but violates a safety criterion" }
      : { status: "NOT_REPLICATED", reason: "B6 does not gain the promotion margin on Q- explicit quantity request nor on Q+ commit" };

  const candidatesFor = (pick: (evaluation: PromotionEvaluation) => boolean) => new Set(ISOLATION_VARIANT_IDS.filter((id) => id !== "B0_CURRENT" && pick(promotion[id])));
  const signalFor = (pick: (evaluation: PromotionEvaluation) => boolean, effectButUnsafe: (evaluation: PromotionEvaluation) => boolean) => {
    const candidates = candidatesFor(pick);
    return { ...deriveSignal({ candidates, positiveControl: { candidate: pick(b6), effectButUnsafe: effectButUnsafe(b6) }, dataSufficient: dataSufficient }), candidates: [...candidates] as string[] };
  };
  const overall = deriveSignal({ candidates: candidatesFor((evaluation) => evaluation.candidate), positiveControl: { candidate: b6.candidate, effectButUnsafe: b6.effectButUnsafe }, dataSufficient });

  return {
    denominatorDefinition:
      "Q- = quantity missing, Q+ = quantity stated (annotated per scenario, never inferred). Promotion metrics use FIXED denominators: Q- explicit quantity request rate = replies classified CORRECT_QUANTITY_REQUEST over all Q- turns; Q+ commit rate = select_products requested over all Q+ turns. commercialProgressAfterGroundingRate restricts the same success rules to turns where get_product_details completed (denominator depends on the variant) and is reported separately for Q- and Q+; the pooled aggregate is a summary only.",
    thresholds: ISOLATION_THRESHOLDS,
    promotion,
    deltasVsB0,
    replication,
    signals: {
      overall,
      missingQuantityCognition: signalFor((evaluation) => evaluation.candidateQMinus, (evaluation) => evaluation.qMinusPasses && !evaluation.safety.ok),
      knownQuantityExecution: signalFor((evaluation) => evaluation.candidateQPlus, (evaluation) => evaluation.qPlusPasses && !evaluation.safety.ok)
    },
    dataQuality: {
      harnessFailures: Object.fromEntries(ISOLATION_VARIANT_IDS.map((id) => [id, metrics[id].harnessFailures])),
      qMinusTurns: Object.fromEntries(ISOLATION_VARIANT_IDS.map((id) => [id, metrics[id].qMinus.turns])),
      qPlusTurns: Object.fromEntries(ISOLATION_VARIANT_IDS.map((id) => [id, metrics[id].qPlus.turns])),
      sufficient: dataSufficient
    }
  };
}
