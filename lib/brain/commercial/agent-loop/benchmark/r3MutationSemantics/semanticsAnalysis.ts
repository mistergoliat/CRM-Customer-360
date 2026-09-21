import { analyzeRun, selectionIsCorrupt, type AbRunConfig, type AbRunRecord } from "../r3AutonomousAB/analysis";
import { computeBenchmarkE2ESummaryMetrics } from "../r3CommercialE2E/metrics";
import type { BenchmarkE2ERunTrace } from "../r3CommercialE2E/types";
import { ratio, type Ratio } from "../r3CapabilityIsolation/isolationAnalysis";
import { classifyConfirmation, classifyMissingFactKind, type ConfirmationClass } from "./confirmationClassifier";
import { SEMANTICS_ANNOTATION_RESOLVER, scenarioById, type ExpectedItem, type SpeechActGroup } from "./semanticsCorpus";
import { SEMANTICS_VARIANT_IDS, type SemanticsVariantId } from "./semanticsSurfaces";

/**
 * SALES-AGENT-R3-P7.10. Pure analysis (no IO). Per-turn facts (tools, durable state, tokens)
 * come from the same analyzeRun P7.8/P7.9 use; what the reply IS comes from the frozen
 * confirmation classifier; correctness (product / quantity) is judged on the DURABLE final
 * selection against the scenario's declared expectation, never on text. The signal rule below
 * is PRE-REGISTERED (fixed before any batch) and computed per speech act - the D (declarative)
 * group is the target; the pooled ACTIONABLE aggregate is only a summary.
 */

export type SemanticsRunRecord = {
  pairId: string;
  variant: SemanticsVariantId;
  caseId: string;
  group: SpeechActGroup;
  runOrdinal: number;
  sequenceIndex: number;
  trace: BenchmarkE2ERunTrace | null;
  harnessError: string | null;
  runConfig: { variant: SemanticsVariantId; model: string | null; temperature: number | null; thinking: "enabled" | "disabled" | null; timeoutMs: number; maxOutputTokens: number | null; maxModelRetries: number | null; promptVersion: string; promptSha256: string | null; toolContractSha16: string };
  promptStats: { systemPromptChars: number; systemPromptApproxTokens: number; toolContractChars: number; providerCallCount: number } | null;
};

export const SEMANTICS_CATEGORIES = ["SELECTION_SUCCESS", "UNNECESSARY_CONFIRMATION", "MISSING_FACT", "INFORMATIONAL_CLOSE", "WRONG_PRODUCT", "WRONG_QUANTITY", "OVER_MUTATION", "SELECTION_CORRUPTION", "GATEWAY_REJECTION", "PROVIDER_FAILURE", "HARNESS_FAILURE", "OTHER", /** Not a failure: an informational control turn with no unrequested mutation. */ "CONTROL_OK"] as const;
export type SemanticsCategory = (typeof SEMANTICS_CATEGORIES)[number];

const NON_FAILURE: ReadonlySet<SemanticsCategory> = new Set(["SELECTION_SUCCESS", "CONTROL_OK"]);
export const isSemanticsFailure = (category: SemanticsCategory): boolean => !NON_FAILURE.has(category);

const MUTATIONS = new Set(["select_products", "set_shipping_destination", "create_quote"]);
type Item = { productId: string; quantity: number };

/**
 * Residual failure taxonomy of an ACTIONABLE turn that did not end in SELECTION_SUCCESS (reported
 * for every speech act, decisive for declarative). Not mixed into one bucket: a redundant
 * confirmation, an informational close, a request for the product and a request for the quantity
 * are different failures. OTHER = everything else (Gateway rejection, wrong product/quantity,
 * another fact, provider failure, an unbacked claim).
 */
export const DECLARATIVE_RESIDUALS = ["UNNECESSARY_CONFIRMATION", "INFORMATIONAL_CLOSE", "PRODUCT_REQUESTION", "QUANTITY_REQUESTION", "OTHER"] as const;
export type DeclarativeResidual = (typeof DECLARATIVE_RESIDUALS)[number];

export type SemanticsTurn = {
  variant: SemanticsVariantId;
  caseId: string;
  group: SpeechActGroup;
  runOrdinal: number;
  executed: boolean;
  /** ACTIONABLE: product known, quantity known, select_products executable, no ambiguity (declared per scenario; F01 also needs the context reply to name exactly one product). */
  actionable: boolean;
  notActionableReason: string | null;
  expectedItems: ExpectedItem[] | null;
  fixtureFlags: readonly string[];
  confirmationClass: ConfirmationClass;
  selectAttempted: boolean;
  selectCompleted: boolean;
  selectRejected: boolean;
  durableSelection: boolean;
  finalItems: Item[];
  correctDurable: boolean;
  wrongProduct: boolean;
  wrongQuantity: boolean;
  selectionCorruption: boolean;
  quoteProgress: boolean;
  /** ACTIONABLE turn that ended asking for a confirmation to persist, with no select_products attempted before it. */
  unnecessaryConfirmation: boolean;
  overMutationSelect: boolean;
  overMutationAny: boolean;
  mutationsRequested: readonly string[];
  contextTurnMutation: boolean;
  category: SemanticsCategory;
  /** Set only on an executed ACTIONABLE turn that was not a SELECTION_SUCCESS. */
  residual: DeclarativeResidual | null;
  terminalReason: string | null;
  toolSequence: string;
  providerCallCount: number;
  providerMs: number;
  inputTokens: number;
  outputTokens: number;
};

const sameItem = (item: Item, expected: ExpectedItem) => item.productId === expected.productId && item.quantity === expected.quantity;

/** The durable selection the customer's facts should produce. F01 (productFromContext): the product the assistant named, if exactly one, in the FIRST turn's reply. */
export function resolveExpected(caseId: string, trace: BenchmarkE2ERunTrace | null): { items: ExpectedItem[] | null; reason: string | null } {
  const scenario = scenarioById(caseId);
  if (scenario.group === "N" || !scenario.expected) return { items: null, reason: null };
  if (!scenario.productFromContext) return { items: scenario.expected, reason: null };
  const reply = trace?.turns[0]?.response.finalMessage ?? "";
  const classic = /\bclassic\b/i.test(reply);
  const pro = /\bpro\b/i.test(reply);
  if (classic === pro) return { items: null, reason: classic ? "context_reply_named_both_products" : "context_reply_named_no_product" };
  return { items: [{ productId: classic ? "31" : "32", quantity: scenario.expected[0].quantity }], reason: null };
}

function categorize(turn: Omit<SemanticsTurn, "category" | "residual">): SemanticsCategory {
  if (!turn.executed) return "HARNESS_FAILURE";
  if (turn.selectionCorruption) return "SELECTION_CORRUPTION";
  if (turn.group === "N") return turn.overMutationAny ? "OVER_MUTATION" : "CONTROL_OK";
  if (!turn.actionable) return "OTHER";
  if (turn.selectCompleted) return turn.wrongProduct ? "WRONG_PRODUCT" : turn.wrongQuantity ? "WRONG_QUANTITY" : "SELECTION_SUCCESS";
  if (turn.selectAttempted) return "GATEWAY_REJECTION";
  if (turn.terminalReason !== "responded") return "PROVIDER_FAILURE";
  if (turn.confirmationClass === "UNNECESSARY_CONFIRMATION") return "UNNECESSARY_CONFIRMATION";
  if (turn.confirmationClass === "MISSING_FACT_QUESTION") return "MISSING_FACT";
  if (turn.confirmationClass === "INFORMATIONAL_RESPONSE") return "INFORMATIONAL_CLOSE";
  return "OTHER";
}

export function analyzeSemanticsRun(record: SemanticsRunRecord): SemanticsTurn[] {
  const asAb: AbRunRecord = {
    pairId: record.pairId,
    variant: "B_AUTONOMOUS",
    caseId: record.caseId,
    runOrdinal: record.runOrdinal,
    sequenceIndex: record.sequenceIndex,
    firstInPair: false,
    isNegativeControl: record.group === "N",
    trace: record.trace,
    harnessError: record.harnessError,
    runConfig: record.runConfig as unknown as AbRunConfig,
    promptStats: null
  };
  const scenario = scenarioById(record.caseId);
  const contextTurnMutation = (record.trace?.turns ?? []).slice(0, -1).some((turn) => turn.toolInvocations.some((invocation) => MUTATIONS.has(invocation.capability)));
  return analyzeRun(asAb, SEMANTICS_ANNOTATION_RESOLVER).map((analysis) => {
    const turn = record.trace?.turns[analysis.turnOrdinal];
    const expected = resolveExpected(record.caseId, record.trace);
    const actionable = analysis.executed && expected.items !== null;
    const expectedItems = expected.items;
    const finalItems: Item[] = (turn?.durableStateAfterTurn?.selection.items ?? []).map((item) => ({ productId: item.productId, quantity: item.quantity }));
    const selectCompleted = analysis.selectCompleted;
    const finalIds = new Set(finalItems.map((item) => item.productId));
    const wrongProduct = actionable && selectCompleted && expectedItems !== null && !(finalIds.size === expectedItems.length && expectedItems.every((item) => finalIds.has(item.productId)));
    const wrongQuantity = actionable && selectCompleted && expectedItems !== null && !wrongProduct && !expectedItems.every((item) => finalItems.some((final) => sameItem(final, item)));
    const correctDurable = actionable && expectedItems !== null && finalItems.length === expectedItems.length && expectedItems.every((item) => finalItems.some((final) => sameItem(final, item)));
    const confirmationClass = analysis.executed ? classifyConfirmation({ reply: turn?.response.finalMessage, selectCompleted }) : "OTHER";
    const capabilities = analysis.toolCalls.map((call) => call.capability);
    const overMutationSelect = scenario.group === "N" && analysis.selectAttempted;
    const overMutationAny = scenario.group === "N" && analysis.mutationRequested.length > 0;
    const partial: Omit<SemanticsTurn, "category" | "residual"> = {
      variant: record.variant,
      caseId: record.caseId,
      group: record.group,
      runOrdinal: record.runOrdinal,
      executed: analysis.executed,
      actionable,
      notActionableReason: scenario.group === "N" ? "informational_control" : expected.reason,
      expectedItems,
      fixtureFlags: scenario.fixtureFlags ?? [],
      confirmationClass,
      selectAttempted: analysis.selectAttempted,
      selectCompleted,
      selectRejected: analysis.selectAttempted && !selectCompleted,
      durableSelection: selectCompleted && analysis.durableSelectionAfterTurn,
      finalItems,
      correctDurable,
      wrongProduct,
      wrongQuantity,
      selectionCorruption: selectionIsCorrupt(finalItems),
      quoteProgress: analysis.selectAttempted || capabilities.includes("create_quote"),
      unnecessaryConfirmation: actionable && !analysis.selectAttempted && confirmationClass === "UNNECESSARY_CONFIRMATION",
      overMutationSelect,
      overMutationAny,
      mutationsRequested: analysis.mutationRequested,
      contextTurnMutation,
      terminalReason: analysis.terminalReason,
      toolSequence: analysis.toolCalls.map((call) => `${call.capability}:${call.toolStatus}`).join(">") || "(none)",
      providerCallCount: analysis.providerCallCount,
      providerMs: analysis.providerMs,
      inputTokens: analysis.inputTokens,
      outputTokens: analysis.outputTokens
    };
    const category = categorize(partial);
    const missingKind = confirmationClass === "MISSING_FACT_QUESTION" ? classifyMissingFactKind(turn?.response.finalMessage) : null;
    return { ...partial, category, residual: residualOf(partial, category, missingKind) };
  });
}

function residualOf(turn: Omit<SemanticsTurn, "category" | "residual">, category: SemanticsCategory, missingKind: ReturnType<typeof classifyMissingFactKind>): DeclarativeResidual | null {
  if (!turn.executed || !turn.actionable || category === "SELECTION_SUCCESS") return null;
  if (category === "UNNECESSARY_CONFIRMATION" || category === "INFORMATIONAL_CLOSE") return category;
  if (category === "MISSING_FACT") return missingKind === "QUANTITY_REQUESTION" ? "QUANTITY_REQUESTION" : missingKind === "PRODUCT_REQUESTION" ? "PRODUCT_REQUESTION" : "OTHER";
  return "OTHER";
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const mean = (values: readonly number[]) => (values.length > 0 ? sum(values) / values.length : null);
function pct(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/** speechActGap = imperativeSelectionRate - declarativeSelectionRate, in percentage points (null if either group has no turns). */
export function speechActGapPp(imperativeSelectionRate: number | null, declarativeSelectionRate: number | null): number | null {
  return imperativeSelectionRate !== null && declarativeSelectionRate !== null ? (imperativeSelectionRate - declarativeSelectionRate) * 100 : null;
}

export type ActionableBlock = {
  turns: number;
  /** actionableSelectionRate: select_products completed / actionable turns. */
  selectionRate: Ratio;
  /** durableActionableSelectionRate: select_products completed AND a durable selection exists after the turn. */
  durableSelectionRate: Ratio;
  /** The durable final selection equals the declared expectation exactly. */
  correctDurableRate: Ratio;
  /** PRIMARY: no select_products attempted and the turn ended asking a confirmation to persist. */
  unnecessaryConfirmationRate: Ratio;
  missingFactRate: Ratio;
  informationalCloseRate: Ratio;
  /** select_products attempted but never completed (Gateway/evidence-gate rejection). */
  selectRejectedRate: Ratio;
  categories: Record<string, number>;
  /** Residual failures (turns that did not end in SELECTION_SUCCESS), one bucket per kind. */
  residuals: Record<DeclarativeResidual, number>;
};

function actionableBlock(turns: readonly SemanticsTurn[]): ActionableBlock {
  const categories: Record<string, number> = {};
  for (const turn of turns) categories[turn.category] = (categories[turn.category] ?? 0) + 1;
  const residuals = Object.fromEntries(DECLARATIVE_RESIDUALS.map((kind) => [kind, 0])) as Record<DeclarativeResidual, number>;
  for (const turn of turns) if (turn.residual !== null) residuals[turn.residual] += 1;
  return {
    turns: turns.length,
    selectionRate: ratio(turns.filter((turn) => turn.selectCompleted).length, turns.length),
    durableSelectionRate: ratio(turns.filter((turn) => turn.durableSelection).length, turns.length),
    correctDurableRate: ratio(turns.filter((turn) => turn.correctDurable).length, turns.length),
    unnecessaryConfirmationRate: ratio(turns.filter((turn) => turn.unnecessaryConfirmation).length, turns.length),
    missingFactRate: ratio(turns.filter((turn) => !turn.selectAttempted && turn.confirmationClass === "MISSING_FACT_QUESTION").length, turns.length),
    informationalCloseRate: ratio(turns.filter((turn) => !turn.selectAttempted && turn.confirmationClass === "INFORMATIONAL_RESPONSE").length, turns.length),
    selectRejectedRate: ratio(turns.filter((turn) => turn.selectRejected).length, turns.length),
    categories,
    residuals
  };
}

export type SemanticsVariantMetrics = {
  variant: SemanticsVariantId;
  runsExecuted: number;
  harnessFailures: number;
  turnsAnalyzed: number;
  contextContaminatedRuns: number;
  /** F scenarios whose context reply did not name exactly one product (excluded from the ACTIONABLE denominator, reported). */
  notActionableAfterContext: number;
  /** Pooled over D, I, Q, F, R: a summary, never the only reading. */
  actionable: ActionableBlock;
  bySpeechAct: {
    D: ActionableBlock;
    I: ActionableBlock;
    Q: ActionableBlock & { quoteProgressionRate: Ratio };
    F: ActionableBlock;
    R: ActionableBlock;
  };
  /** D excluding scenarios flagged with a documented fixture limitation (bare "Pro" name). Descriptive only. */
  dExcludingFlagged: { turns: number; selectionRate: Ratio; unnecessaryConfirmationRate: Ratio };
  informational: { turns: number; informationalOverMutationRate: Ratio; anyMutationRate: Ratio; mutationsByCapability: Record<string, number>; byScenario: Record<string, number> };
  /** imperativeSelectionRate - declarativeSelectionRate, in percentage points (null when a group has no turns). */
  speechActGapPp: number | null;
  accuracy: { selectedTurns: number; wrongQuantityRate: Ratio; wrongProductRate: Ratio };
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
  latency: { perCallMs: { p50: number | null; p90: number | null; p95: number | null } };
  tokens: { inputPerTurnMean: number | null; outputPerTurnMean: number | null };
  contract: { toolContractCharsMean: number | null; distinctToolContractSha16: string[]; distinctPromptSha256: string[] };
  failureTaxonomy: Record<SemanticsCategory, number>;
  scenarioBreakdown: Record<string, { group: SpeechActGroup; successes: number; turns: number }>;
};

export function computeSemanticsVariantMetrics(variant: SemanticsVariantId, records: readonly SemanticsRunRecord[]): SemanticsVariantMetrics {
  const mine = records.filter((record) => record.variant === variant);
  const executedRecords = mine.filter((record) => record.trace !== null);
  const traces = executedRecords.map((record) => record.trace as BenchmarkE2ERunTrace);
  const allTurns = mine.flatMap(analyzeSemanticsRun);
  const turns = allTurns.filter((turn) => turn.executed);
  const actionableTurns = turns.filter((turn) => turn.actionable);
  const of = (group: SpeechActGroup) => actionableTurns.filter((turn) => turn.group === group);
  const negatives = turns.filter((turn) => turn.group === "N");
  const turnTraces = traces.flatMap((trace) => trace.turns);
  const calls = turnTraces.flatMap((turn) => [...turn.providerCalls]);
  const invocations = turnTraces.flatMap((turn) => turn.toolInvocations);
  const shared = computeBenchmarkE2ESummaryMetrics(traces);
  const selected = actionableTurns.filter((turn) => turn.selectCompleted);
  const d = of("D");
  const dClean = d.filter((turn) => turn.fixtureFlags.length === 0);
  const q = of("Q");

  const mutationsByCapability: Record<string, number> = {};
  const negativeByScenario: Record<string, number> = {};
  for (const turn of negatives) {
    for (const capability of turn.mutationsRequested) mutationsByCapability[capability] = (mutationsByCapability[capability] ?? 0) + 1;
    if (turn.overMutationAny) negativeByScenario[turn.caseId] = (negativeByScenario[turn.caseId] ?? 0) + 1;
  }
  const failureTaxonomy = Object.fromEntries(["SELECTION_SUCCESS", "UNNECESSARY_CONFIRMATION", "MISSING_FACT", "INFORMATIONAL_CLOSE", "WRONG_PRODUCT", "WRONG_QUANTITY", "OVER_MUTATION", "SELECTION_CORRUPTION", "GATEWAY_REJECTION", "PROVIDER_FAILURE", "HARNESS_FAILURE", "OTHER", "CONTROL_OK"].map((category) => [category, 0])) as Record<SemanticsCategory, number>;
  for (const turn of allTurns) failureTaxonomy[turn.category] += 1;

  const scenarioBreakdown: SemanticsVariantMetrics["scenarioBreakdown"] = {};
  for (const turn of turns) {
    const entry = (scenarioBreakdown[turn.caseId] ??= { group: turn.group, successes: 0, turns: 0 });
    entry.turns += 1;
    if (turn.category === "SELECTION_SUCCESS" || turn.category === "CONTROL_OK") entry.successes += 1;
  }
  const stats = executedRecords.map((record) => record.promptStats).filter((value): value is NonNullable<typeof value> => value !== null);
  const dBlock = actionableBlock(d);
  const iBlock = actionableBlock(of("I"));
  const gap = speechActGapPp(iBlock.selectionRate.rate, dBlock.selectionRate.rate);

  return {
    variant,
    runsExecuted: executedRecords.length,
    harnessFailures: mine.length - executedRecords.length,
    turnsAnalyzed: turns.length,
    contextContaminatedRuns: new Set(allTurns.filter((turn) => turn.contextTurnMutation).map((turn) => `${turn.caseId}-${turn.runOrdinal}`)).size,
    notActionableAfterContext: turns.filter((turn) => turn.group !== "N" && !turn.actionable).length,
    actionable: actionableBlock(actionableTurns),
    bySpeechAct: { D: dBlock, I: iBlock, Q: { ...actionableBlock(q), quoteProgressionRate: ratio(q.filter((turn) => turn.quoteProgress).length, q.length) }, F: actionableBlock(of("F")), R: actionableBlock(of("R")) },
    dExcludingFlagged: { turns: dClean.length, selectionRate: ratio(dClean.filter((turn) => turn.selectCompleted).length, dClean.length), unnecessaryConfirmationRate: ratio(dClean.filter((turn) => turn.unnecessaryConfirmation).length, dClean.length) },
    informational: {
      turns: negatives.length,
      informationalOverMutationRate: ratio(negatives.filter((turn) => turn.overMutationSelect).length, negatives.length),
      anyMutationRate: ratio(negatives.filter((turn) => turn.overMutationAny).length, negatives.length),
      mutationsByCapability,
      byScenario: negativeByScenario
    },
    speechActGapPp: gap,
    accuracy: { selectedTurns: selected.length, wrongQuantityRate: ratio(selected.filter((turn) => turn.wrongQuantity).length, selected.length), wrongProductRate: ratio(selected.filter((turn) => turn.wrongProduct).length, selected.length) },
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
    latency: { perCallMs: { p50: pct(calls.map((call) => call.elapsedMs ?? 0), 0.5), p90: pct(calls.map((call) => call.elapsedMs ?? 0), 0.9), p95: pct(calls.map((call) => call.elapsedMs ?? 0), 0.95) } },
    tokens: { inputPerTurnMean: turns.length > 0 ? sum(turns.map((turn) => turn.inputTokens)) / turns.length : null, outputPerTurnMean: turns.length > 0 ? sum(turns.map((turn) => turn.outputTokens)) / turns.length : null },
    contract: {
      toolContractCharsMean: mean(stats.map((value) => value.toolContractChars)),
      distinctToolContractSha16: [...new Set(executedRecords.map((record) => record.runConfig.toolContractSha16))],
      distinctPromptSha256: [...new Set(executedRecords.map((record) => record.runConfig.promptSha256).filter((hash): hash is string => hash !== null))]
    },
    failureTaxonomy,
    scenarioBreakdown
  };
}


// ---------------------------------------------------------------------------
// Pre-registered signal (three arms: S0 current, S1 consequence statement, S2 coherent reversible semantics)
// ---------------------------------------------------------------------------

export const SEMANTICS_THRESHOLDS = {
  /** A step "reaches the support margin" when BOTH primary outcomes move by at least this many pp in D (unnecessary confirmation down, selection up)... */
  supportedMinDeltaPp: 20,
  /** ...and is "below the not-causal margin" when BOTH move by less than this many pp (a worsening counts as below). */
  notCausalMaxDeltaPp: 10,
  /** Safety (always measured against S0): the arm may exceed S0 by at most this many pp on informational over-mutation, wrong quantity, wrong product and Gateway rejection; selection corruption may not increase. */
  maxSafetyExcessPp: 5,
  minDTurnsPerVariant: 30
} as const;

export const SEMANTICS_SIGNALS = ["REVERSIBLE_SEMANTICS_SUPPORTED", "CONSEQUENCE_STATEMENT_SUFFICIENT", "DISTRIBUTED_SEMANTIC_CONTRADICTION_SUPPORTED", "SEMANTICS_NOT_CAUSAL", "PARTIAL_SEMANTIC_EFFECT"] as const;
export type SemanticsSignal = (typeof SEMANTICS_SIGNALS)[number];

/**
 * The pre-registered decision order (fixed before any smoke/batch). Steps: a = S0->S1 (the
 * consequence statement alone), b = S1->S2 (removing the distributed contradictory framing),
 * c = S0->S2 (total). "meets(x)" = x reaches the support margin AND the arm it leads to is safe
 * versus S0. The first rule that holds wins; REVERSIBLE_SEMANTICS_SUPPORTED (c meets) is the
 * umbrella and is also reported as a boolean next to a more specific label.
 *  1. CONSEQUENCE_STATEMENT_SUFFICIENT           meets(a) AND b is below the not-causal margin (S2 adds nothing material)
 *  2. DISTRIBUTED_SEMANTIC_CONTRADICTION_SUPPORTED  a does NOT reach the support margin AND b reaches it AND S2 is safe
 *  3. REVERSIBLE_SEMANTICS_SUPPORTED             meets(c)
 *  4. SEMANTICS_NOT_CAUSAL                       c is below the not-causal margin
 *  5. PARTIAL_SEMANTIC_EFFECT                    anything else
 */
export const SEMANTICS_SIGNAL_RULE = [
  "1. CONSEQUENCE_STATEMENT_SUFFICIENT: S0->S1 meets the support margin (D confirmation -20 pp AND D selection +20 pp) with S1 safe vs S0, AND S1->S2 is below the not-causal margin (both < 10 pp).",
  "2. DISTRIBUTED_SEMANTIC_CONTRADICTION_SUPPORTED: S0->S1 does not reach the support margin, S1->S2 reaches it (both >= 20 pp), and S2 is safe vs S0.",
  "3. REVERSIBLE_SEMANTICS_SUPPORTED: S0->S2 meets the support margin with S2 safe vs S0.",
  "4. SEMANTICS_NOT_CAUSAL: S0->S2 moves both D outcomes by less than 10 pp.",
  "5. PARTIAL_SEMANTIC_EFFECT: any other result."
] as const;

const pp = (value: number | null, base: number | null): number | null => (value !== null && base !== null ? (value - base) * 100 : null);
const nz = (value: number | null) => value ?? 0;

export type SemanticsSafety = { informationalOverMutationExcessPp: number | null; wrongQuantityExcessPp: number | null; wrongProductExcessPp: number | null; selectionCorruptionExcessPp: number | null; gatewayRejectionExcessPp: number | null; ok: boolean };

/** Safety of `arm` versus the control `s0`. */
export function evaluateSemanticsSafety(arm: SemanticsVariantMetrics, s0: SemanticsVariantMetrics): SemanticsSafety {
  const t = SEMANTICS_THRESHOLDS;
  const overMutation = pp(arm.informational.informationalOverMutationRate.rate, s0.informational.informationalOverMutationRate.rate);
  const wrongQuantity = pp(arm.accuracy.wrongQuantityRate.rate, s0.accuracy.wrongQuantityRate.rate);
  const wrongProduct = pp(arm.accuracy.wrongProductRate.rate, s0.accuracy.wrongProductRate.rate);
  const corruption = pp(arm.quality.selectionCorruptionRate.rate, s0.quality.selectionCorruptionRate.rate);
  const rejection = pp(nz(arm.quality.gatewayRejectionRate), nz(s0.quality.gatewayRejectionRate));
  const ok = nz(overMutation) <= t.maxSafetyExcessPp && nz(wrongQuantity) <= t.maxSafetyExcessPp && nz(wrongProduct) <= t.maxSafetyExcessPp && nz(corruption) <= 0 && nz(rejection) <= t.maxSafetyExcessPp;
  return { informationalOverMutationExcessPp: overMutation, wrongQuantityExcessPp: wrongQuantity, wrongProductExcessPp: wrongProduct, selectionCorruptionExcessPp: corruption, gatewayRejectionExcessPp: rejection, ok };
}

export type SemanticsStepName = "S0_to_S1" | "S1_to_S2" | "S0_to_S2";
export const SEMANTICS_STEPS: readonly { step: SemanticsStepName; from: SemanticsVariantId; to: SemanticsVariantId; measures: string }[] = [
  { step: "S0_to_S1", from: "S0_CURRENT_SEMANTICS", to: "S1_CONSEQUENCE_STATEMENT", measures: "effect of the consequence statement alone" },
  { step: "S1_to_S2", from: "S1_CONSEQUENCE_STATEMENT", to: "S2_COHERENT_REVERSIBLE_SEMANTICS", measures: "effect of removing the distributed contradictory framing (useWhen + doNotUseWhen)" },
  { step: "S0_to_S2", from: "S0_CURRENT_SEMANTICS", to: "S2_COHERENT_REVERSIBLE_SEMANTICS", measures: "total semantic-boundary effect" }
];

export type SemanticsStep = {
  step: SemanticsStepName;
  from: SemanticsVariantId;
  to: SemanticsVariantId;
  /** Positive = `to` better. confirmationDropDPp = from - to unnecessaryConfirmationRate (D). */
  confirmationDropDPp: number | null;
  /** selectionGainDPp = to - from actionableSelectionRate (D). */
  selectionGainDPp: number | null;
  durableSelectionGainDPp: number | null;
  reachesSupportMargin: boolean;
  belowNotCausalMargin: boolean;
  /** Safety of the `to` arm versus S0. */
  safety: SemanticsSafety;
};

export function evaluateStep(step: SemanticsStepName, from: SemanticsVariantMetrics, to: SemanticsVariantMetrics, s0: SemanticsVariantMetrics): SemanticsStep {
  const t = SEMANTICS_THRESHOLDS;
  const drop = pp(from.bySpeechAct.D.unnecessaryConfirmationRate.rate, to.bySpeechAct.D.unnecessaryConfirmationRate.rate);
  const gain = pp(to.bySpeechAct.D.selectionRate.rate, from.bySpeechAct.D.selectionRate.rate);
  const durable = pp(to.bySpeechAct.D.durableSelectionRate.rate, from.bySpeechAct.D.durableSelectionRate.rate);
  return {
    step,
    from: from.variant,
    to: to.variant,
    confirmationDropDPp: drop,
    selectionGainDPp: gain,
    durableSelectionGainDPp: durable,
    reachesSupportMargin: drop !== null && gain !== null && drop >= t.supportedMinDeltaPp && gain >= t.supportedMinDeltaPp,
    belowNotCausalMargin: drop !== null && gain !== null && drop < t.notCausalMaxDeltaPp && gain < t.notCausalMaxDeltaPp,
    safety: evaluateSemanticsSafety(to, s0)
  };
}

export type SemanticsSignalResult = {
  signal: SemanticsSignal;
  reason: string;
  /** The umbrella criterion (S0->S2 meets the margin with S2 safe), reported even when a more specific label wins. */
  reversibleSemanticsSupported: boolean;
  steps: Record<SemanticsStepName, SemanticsStep>;
  dataSufficient: boolean;
};

export function deriveSemanticsSignal(s0: SemanticsVariantMetrics, s1: SemanticsVariantMetrics, s2: SemanticsVariantMetrics): SemanticsSignalResult {
  const t = SEMANTICS_THRESHOLDS;
  const a = evaluateStep("S0_to_S1", s0, s1, s0);
  const b = evaluateStep("S1_to_S2", s1, s2, s0);
  const c = evaluateStep("S0_to_S2", s0, s2, s0);
  const arms = [s0, s1, s2];
  const dataSufficient = arms.every((arm) => arm.harnessFailures === 0 && arm.bySpeechAct.D.turns >= t.minDTurnsPerVariant);
  const meets = (step: SemanticsStep) => step.reachesSupportMargin && step.safety.ok;
  const base = { reversibleSemanticsSupported: meets(c), steps: { S0_to_S1: a, S1_to_S2: b, S0_to_S2: c }, dataSufficient };
  if ([a, b, c].some((step) => step.confirmationDropDPp === null || step.selectionGainDPp === null)) return { signal: "PARTIAL_SEMANTIC_EFFECT", reason: "no D turns to compare", ...base };
  if (meets(a) && b.belowNotCausalMargin) return { signal: "CONSEQUENCE_STATEMENT_SUFFICIENT", reason: "S0->S1 meets the support margin safely and S1->S2 adds no material improvement (both < 10 pp)", ...base };
  if (!a.reachesSupportMargin && b.reachesSupportMargin && b.safety.ok) return { signal: "DISTRIBUTED_SEMANTIC_CONTRADICTION_SUPPORTED", reason: "S0->S1 does not reach the support margin, S1->S2 does, safety holds", ...base };
  if (meets(c)) return { signal: "REVERSIBLE_SEMANTICS_SUPPORTED", reason: "S0->S2 reaches the support margin on both D outcomes, safety holds", ...base };
  if (c.belowNotCausalMargin) return { signal: "SEMANTICS_NOT_CAUSAL", reason: "S0->S2 moved both D outcomes by less than 10 pp", ...base };
  const moved = c.reachesSupportMargin;
  return { signal: "PARTIAL_SEMANTIC_EFFECT", reason: moved ? "S0->S2 reaches the support margin but a safety criterion is violated (or the S0->S1 / S1->S2 pattern matches no specific label)" : "intermediate result: neither the support margin nor the not-causal margin is met", ...base };
}

// ---------------------------------------------------------------------------
// Comparison (S0 -> S1, S1 -> S2, S0 -> S2)
// ---------------------------------------------------------------------------

/** Exact two-sided McNemar test on discordant pairs (exploratory; never part of the pre-registered signal). */
export function mcnemarExact(onlyFirst: number, onlySecond: number): number {
  const n = onlyFirst + onlySecond;
  if (n === 0) return 1;
  const k = Math.min(onlyFirst, onlySecond);
  let tail = 0;
  for (let i = 0; i <= k; i += 1) {
    let c = 1;
    for (let j = 1; j <= i; j += 1) c = (c * (n - j + 1)) / j;
    tail += c;
  }
  return Math.min(1, (2 * tail) / 2 ** n);
}

function pairedD(records: readonly SemanticsRunRecord[], pick: (turn: SemanticsTurn) => boolean, first: SemanticsVariantId, second: SemanticsVariantId) {
  const byVariant = (variant: SemanticsVariantId) => new Map(records.filter((record) => record.variant === variant).flatMap(analyzeSemanticsRun).filter((turn) => turn.executed && turn.actionable && turn.group === "D").map((turn) => [`${turn.caseId}-r${turn.runOrdinal}`, pick(turn)] as const));
  const a = byVariant(first);
  const b = byVariant(second);
  let onlyFirst = 0;
  let onlySecond = 0;
  let both = 0;
  let neither = 0;
  for (const [key, x] of a) {
    const y = b.get(key);
    if (y === undefined) continue;
    if (x && y) both += 1;
    else if (x) onlyFirst += 1;
    else if (y) onlySecond += 1;
    else neither += 1;
  }
  return { pairs: both + onlyFirst + onlySecond + neither, both, onlyFirst, onlySecond, neither, mcnemarExactP: mcnemarExact(onlyFirst, onlySecond) };
}

function stepDeltas(from: SemanticsVariantMetrics, to: SemanticsVariantMetrics): Record<string, number | null> {
  const delta = (pick: (m: SemanticsVariantMetrics) => number | null) => pp(pick(to), pick(from));
  return {
    actionableSelectionPooled: delta((m) => m.actionable.selectionRate.rate),
    durableActionableSelectionPooled: delta((m) => m.actionable.durableSelectionRate.rate),
    unnecessaryConfirmationPooled: delta((m) => m.actionable.unnecessaryConfirmationRate.rate),
    dSelection: delta((m) => m.bySpeechAct.D.selectionRate.rate),
    dDurableSelection: delta((m) => m.bySpeechAct.D.durableSelectionRate.rate),
    dUnnecessaryConfirmation: delta((m) => m.bySpeechAct.D.unnecessaryConfirmationRate.rate),
    dMissingFact: delta((m) => m.bySpeechAct.D.missingFactRate.rate),
    iSelection: delta((m) => m.bySpeechAct.I.selectionRate.rate),
    qSelection: delta((m) => m.bySpeechAct.Q.selectionRate.rate),
    qQuoteProgression: delta((m) => m.bySpeechAct.Q.quoteProgressionRate.rate),
    fSelection: delta((m) => m.bySpeechAct.F.selectionRate.rate),
    rCorrectReplacement: delta((m) => m.bySpeechAct.R.correctDurableRate.rate),
    informationalOverMutation: delta((m) => m.informational.informationalOverMutationRate.rate),
    informationalAnyMutation: delta((m) => m.informational.anyMutationRate.rate),
    wrongQuantity: delta((m) => m.accuracy.wrongQuantityRate.rate),
    wrongProduct: delta((m) => m.accuracy.wrongProductRate.rate),
    selectionCorruption: delta((m) => m.quality.selectionCorruptionRate.rate),
    gatewayRejection: delta((m) => nz(m.quality.gatewayRejectionRate)),
    argumentFailure: delta((m) => m.quality.argumentFailureCalls.rate),
    inputTokensPerTurn: (to.tokens.inputPerTurnMean ?? 0) - (from.tokens.inputPerTurnMean ?? 0),
    latencyPerCallP95Ms: (to.latency.perCallMs.p95 ?? 0) - (from.latency.perCallMs.p95 ?? 0)
  };
}

export type SemanticsComparison = {
  denominatorDefinition: string;
  thresholds: typeof SEMANTICS_THRESHOLDS;
  signalRule: readonly string[];
  signal: SemanticsSignalResult;
  steps: readonly { step: SemanticsStepName; from: SemanticsVariantId; to: SemanticsVariantId; measures: string }[];
  /** to - from, in pp (tokens/latency in their own units), per pre-registered step. */
  deltasByStep: Record<SemanticsStepName, Record<string, number | null>>;
  speechActGap: { perVariantPp: Record<string, number | null>; deltaByStepPp: Record<SemanticsStepName, number | null> };
  perSpeechAct: Record<string, Record<string, { turns: number; selectionRate: number | null; unnecessaryConfirmationRate: number | null }>>;
  /** Residual failures of the actionable declarative turns, one bucket per kind, per variant (never mixed). */
  declarativeResiduals: Record<string, Record<DeclarativeResidual, number>>;
  /** Same D primary outcomes excluding the fixture-flagged scenarios (bare "Pro"). Descriptive only, never part of the signal. */
  sensitivityDExcludingFlagged: Record<SemanticsStepName, { confirmationDropPp: number | null; selectionGainPp: number | null }>;
  exploratory: { note: string; pairedDeclarativeSelection: Record<SemanticsStepName, ReturnType<typeof pairedD>>; pairedDeclarativeUnnecessaryConfirmation: Record<SemanticsStepName, ReturnType<typeof pairedD>> };
  dataQuality: { harnessFailures: Record<string, number>; dTurns: Record<string, number>; notActionableAfterContext: Record<string, number>; contextContaminatedRuns: Record<string, number>; sufficient: boolean };
};

export function compareSemantics(metrics: Record<SemanticsVariantId, SemanticsVariantMetrics>, records: readonly SemanticsRunRecord[]): SemanticsComparison {
  const s0 = metrics.S0_CURRENT_SEMANTICS;
  const signal = deriveSemanticsSignal(s0, metrics.S1_CONSEQUENCE_STATEMENT, metrics.S2_COHERENT_REVERSIBLE_SEMANTICS);
  const stepMap = <T>(build: (from: SemanticsVariantMetrics, to: SemanticsVariantMetrics, fromId: SemanticsVariantId, toId: SemanticsVariantId) => T): Record<SemanticsStepName, T> =>
    Object.fromEntries(SEMANTICS_STEPS.map(({ step, from, to }) => [step, build(metrics[from], metrics[to], from, to)])) as Record<SemanticsStepName, T>;
  const groups = ["D", "I", "Q", "F", "R"] as const;
  return {
    denominatorDefinition:
      "ACTIONABLE = turns where the product is known, the quantity is explicit, select_products is structurally executable and no ambiguity remains (D, I, Q, F, R scenarios; N is never actionable; F01 additionally needs the first-turn reply to name exactly one product). unnecessaryConfirmationRate = ACTIONABLE turns with no select_products attempted whose final reply the frozen classifier labels UNNECESSARY_CONFIRMATION. actionableSelectionRate = select_products completed. durable = completed AND a durable selection exists after the turn. Every rate is reported per speech act; the pooled ACTIONABLE block is a summary only. The signal uses D and the three pre-registered steps S0->S1, S1->S2, S0->S2.",
    thresholds: SEMANTICS_THRESHOLDS,
    signalRule: SEMANTICS_SIGNAL_RULE,
    signal,
    steps: SEMANTICS_STEPS,
    deltasByStep: stepMap((from, to) => stepDeltas(from, to)),
    speechActGap: {
      perVariantPp: Object.fromEntries(SEMANTICS_VARIANT_IDS.map((id) => [id, metrics[id].speechActGapPp])),
      deltaByStepPp: stepMap((from, to) => (from.speechActGapPp !== null && to.speechActGapPp !== null ? to.speechActGapPp - from.speechActGapPp : null))
    },
    perSpeechAct: Object.fromEntries(
      groups.map((group) => [group, Object.fromEntries(SEMANTICS_VARIANT_IDS.map((id) => [id, { turns: metrics[id].bySpeechAct[group].turns, selectionRate: metrics[id].bySpeechAct[group].selectionRate.rate, unnecessaryConfirmationRate: metrics[id].bySpeechAct[group].unnecessaryConfirmationRate.rate }]))])
    ),
    declarativeResiduals: Object.fromEntries(SEMANTICS_VARIANT_IDS.map((id) => [id, metrics[id].bySpeechAct.D.residuals])),
    sensitivityDExcludingFlagged: stepMap((from, to) => ({ confirmationDropPp: pp(from.dExcludingFlagged.unnecessaryConfirmationRate.rate, to.dExcludingFlagged.unnecessaryConfirmationRate.rate), selectionGainPp: pp(to.dExcludingFlagged.selectionRate.rate, from.dExcludingFlagged.selectionRate.rate) })),
    exploratory: {
      note: "Exploratory, NOT part of the pre-registered signal: exact McNemar on (scenario, run) pairs of D turns, per step.",
      pairedDeclarativeSelection: stepMap((_from, _to, fromId, toId) => pairedD(records, (turn) => turn.selectCompleted, fromId, toId)),
      pairedDeclarativeUnnecessaryConfirmation: stepMap((_from, _to, fromId, toId) => pairedD(records, (turn) => turn.unnecessaryConfirmation, fromId, toId))
    },
    dataQuality: {
      harnessFailures: Object.fromEntries(SEMANTICS_VARIANT_IDS.map((id) => [id, metrics[id].harnessFailures])),
      dTurns: Object.fromEntries(SEMANTICS_VARIANT_IDS.map((id) => [id, metrics[id].bySpeechAct.D.turns])),
      notActionableAfterContext: Object.fromEntries(SEMANTICS_VARIANT_IDS.map((id) => [id, metrics[id].notActionableAfterContext])),
      contextContaminatedRuns: Object.fromEntries(SEMANTICS_VARIANT_IDS.map((id) => [id, metrics[id].contextContaminatedRuns])),
      sufficient: signal.dataSufficient
    }
  };
}
