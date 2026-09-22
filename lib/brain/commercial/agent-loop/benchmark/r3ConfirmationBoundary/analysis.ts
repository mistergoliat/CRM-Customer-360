import { analyzeRun, selectionIsCorrupt, type AbRunConfig, type AbRunRecord } from "../r3AutonomousAB/analysis";
import { computeBenchmarkE2ESummaryMetrics } from "../r3CommercialE2E/metrics";
import type { BenchmarkE2ERunTrace } from "../r3CommercialE2E/types";
import { ratio, type Ratio } from "../r3CapabilityIsolation/isolationAnalysis";
import { classifyConfirmation, classifyMissingFactKind, type ConfirmationClass } from "../r3MutationSemantics/confirmationClassifier";
import { REPLICATION_ANNOTATION_RESOLVER, REPLICATION_GROUPS, scenarioById, type ExpectedItem, type ReplicationGroup } from "./corpus";
import type { ReplicationVariantId } from "./surfaces";

/**
 * SALES-AGENT-R3-P7.11. Pure analysis (no IO), deliberately mirroring P7.10's semanticsAnalysis.ts
 * (same per-turn primitives, same confirmation classifier, same categorize/residual scheme) so the
 * two phases stay comparable. What differs: two arms (R0/R1, not three), six new groups (A-F, not
 * D/I/Q/N/F/R), and product resolution that NEVER depends on the assistant's reply (every P7.11
 * scenario states the product in the customer's own text - the P7.10 F01 "productFromContext"
 * problem does not exist here by construction).
 */

export type ReplicationRunRecord = {
  pairId: string;
  variant: ReplicationVariantId;
  caseId: string;
  group: ReplicationGroup;
  runOrdinal: number;
  sequenceIndex: number;
  trace: BenchmarkE2ERunTrace | null;
  harnessError: string | null;
  runConfig: { variant: ReplicationVariantId; model: string | null; temperature: number | null; thinking: "enabled" | "disabled" | null; timeoutMs: number; maxOutputTokens: number | null; maxModelRetries: number | null; promptVersion: string; promptSha256: string | null; toolContractSha16: string };
  promptStats: { systemPromptChars: number; systemPromptApproxTokens: number; toolContractChars: number; providerCallCount: number } | null;
};

export const REPLICATION_CATEGORIES = ["SELECTION_SUCCESS", "UNNECESSARY_CONFIRMATION", "MISSING_FACT", "INFORMATIONAL_CLOSE", "WRONG_PRODUCT", "WRONG_QUANTITY", "OVER_MUTATION", "SELECTION_CORRUPTION", "GATEWAY_REJECTION", "PROVIDER_FAILURE", "HARNESS_FAILURE", "OTHER", "CONTROL_OK"] as const;
export type ReplicationCategory = (typeof REPLICATION_CATEGORIES)[number];

const NON_FAILURE: ReadonlySet<ReplicationCategory> = new Set(["SELECTION_SUCCESS", "CONTROL_OK"]);
export const isReplicationFailure = (category: ReplicationCategory): boolean => !NON_FAILURE.has(category);

const MUTATIONS = new Set(["select_products", "set_shipping_destination", "create_quote"]);
type Item = { productId: string; quantity: number };

export const RESIDUALS = ["UNNECESSARY_CONFIRMATION", "INFORMATIONAL_CLOSE", "PRODUCT_REQUESTION", "QUANTITY_REQUESTION", "OTHER"] as const;
export type Residual = (typeof RESIDUALS)[number];

export type ReplicationTurn = {
  variant: ReplicationVariantId;
  caseId: string;
  group: ReplicationGroup;
  runOrdinal: number;
  executed: boolean;
  actionable: boolean;
  expectedItems: ExpectedItem[] | null;
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
  unnecessaryConfirmation: boolean;
  overMutationSelect: boolean;
  overMutationAny: boolean;
  mutationsRequested: readonly string[];
  contextTurnMutation: boolean;
  category: ReplicationCategory;
  residual: Residual | null;
  terminalReason: string | null;
  toolSequence: string;
  providerCallCount: number;
  providerMs: number;
  inputTokens: number;
  outputTokens: number;
};

const sameItem = (item: Item, expected: ExpectedItem) => item.productId === expected.productId && item.quantity === expected.quantity;

/** The product is always stated by the customer's own text (turn 1 or 2 for group B); the expected outcome is the scenario's declared expectation, never inferred from a trace. */
function resolveExpected(caseId: string): ExpectedItem[] | null {
  const scenario = scenarioById(caseId);
  return scenario.group === "E" ? null : (scenario.expected ?? null);
}

function categorize(turn: Omit<ReplicationTurn, "category" | "residual">): ReplicationCategory {
  if (!turn.executed) return "HARNESS_FAILURE";
  if (turn.selectionCorruption) return "SELECTION_CORRUPTION";
  if (turn.group === "E") return turn.overMutationAny ? "OVER_MUTATION" : "CONTROL_OK";
  if (!turn.actionable) return "OTHER";
  if (turn.selectCompleted) return turn.wrongProduct ? "WRONG_PRODUCT" : turn.wrongQuantity ? "WRONG_QUANTITY" : "SELECTION_SUCCESS";
  if (turn.selectAttempted) return "GATEWAY_REJECTION";
  if (turn.terminalReason !== "responded") return "PROVIDER_FAILURE";
  if (turn.confirmationClass === "UNNECESSARY_CONFIRMATION") return "UNNECESSARY_CONFIRMATION";
  if (turn.confirmationClass === "MISSING_FACT_QUESTION") return "MISSING_FACT";
  if (turn.confirmationClass === "INFORMATIONAL_RESPONSE") return "INFORMATIONAL_CLOSE";
  return "OTHER";
}

function residualOf(turn: Omit<ReplicationTurn, "category" | "residual">, category: ReplicationCategory, missingKind: ReturnType<typeof classifyMissingFactKind>): Residual | null {
  if (!turn.executed || !turn.actionable || category === "SELECTION_SUCCESS") return null;
  if (category === "UNNECESSARY_CONFIRMATION" || category === "INFORMATIONAL_CLOSE") return category;
  if (category === "MISSING_FACT") return missingKind === "QUANTITY_REQUESTION" ? "QUANTITY_REQUESTION" : missingKind === "PRODUCT_REQUESTION" ? "PRODUCT_REQUESTION" : "OTHER";
  return "OTHER";
}

export function analyzeReplicationRun(record: ReplicationRunRecord): ReplicationTurn[] {
  const asAb: AbRunRecord = {
    pairId: record.pairId,
    variant: "B_AUTONOMOUS",
    caseId: record.caseId,
    runOrdinal: record.runOrdinal,
    sequenceIndex: record.sequenceIndex,
    firstInPair: false,
    isNegativeControl: record.group === "E",
    trace: record.trace,
    harnessError: record.harnessError,
    runConfig: record.runConfig as unknown as AbRunConfig,
    promptStats: null
  };
  const scenario = scenarioById(record.caseId);
  const contextTurnMutation = (record.trace?.turns ?? []).slice(0, -1).some((turn) => turn.toolInvocations.some((invocation) => MUTATIONS.has(invocation.capability)));
  return analyzeRun(asAb, REPLICATION_ANNOTATION_RESOLVER).map((analysis) => {
    const turn = record.trace?.turns[analysis.turnOrdinal];
    const expectedItems = resolveExpected(record.caseId);
    const actionable = analysis.executed && expectedItems !== null;
    const finalItems: Item[] = (turn?.durableStateAfterTurn?.selection.items ?? []).map((item) => ({ productId: item.productId, quantity: item.quantity }));
    const selectCompleted = analysis.selectCompleted;
    const finalIds = new Set(finalItems.map((item) => item.productId));
    const wrongProduct = actionable && selectCompleted && expectedItems !== null && !(finalIds.size === expectedItems.length && expectedItems.every((item) => finalIds.has(item.productId)));
    const wrongQuantity = actionable && selectCompleted && expectedItems !== null && !wrongProduct && !expectedItems.every((item) => finalItems.some((final) => sameItem(final, item)));
    const correctDurable = actionable && expectedItems !== null && finalItems.length === expectedItems.length && expectedItems.every((item) => finalItems.some((final) => sameItem(final, item)));
    const confirmationClass = analysis.executed ? classifyConfirmation({ reply: turn?.response.finalMessage, selectCompleted }) : "OTHER";
    const capabilities = analysis.toolCalls.map((call) => call.capability);
    const overMutationSelect = scenario.group === "E" && analysis.selectAttempted;
    const overMutationAny = scenario.group === "E" && analysis.mutationRequested.length > 0;
    const partial: Omit<ReplicationTurn, "category" | "residual"> = {
      variant: record.variant,
      caseId: record.caseId,
      group: record.group,
      runOrdinal: record.runOrdinal,
      executed: analysis.executed,
      actionable,
      expectedItems,
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

export type GroupBlock = {
  turns: number;
  /** actionableSelectionRate. */
  selectionRate: Ratio;
  /** durableActionableSelectionRate. */
  durableSelectionRate: Ratio;
  correctDurableRate: Ratio;
  /** unnecessaryConfirmationRate. */
  unnecessaryConfirmationRate: Ratio;
  missingFactRate: Ratio;
  informationalCloseRate: Ratio;
  selectRejectedRate: Ratio;
  categories: Record<string, number>;
  residuals: Record<Residual, number>;
};

function groupBlock(turns: readonly ReplicationTurn[]): GroupBlock {
  const categories: Record<string, number> = {};
  for (const turn of turns) categories[turn.category] = (categories[turn.category] ?? 0) + 1;
  const residuals = Object.fromEntries(RESIDUALS.map((kind) => [kind, 0])) as Record<Residual, number>;
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

export type ReplicationVariantMetrics = {
  variant: ReplicationVariantId;
  runsExecuted: number;
  harnessFailures: number;
  turnsAnalyzed: number;
  contextContaminatedRuns: number;
  actionable: GroupBlock;
  byGroup: {
    A: GroupBlock;
    B: GroupBlock;
    C: GroupBlock;
    D: GroupBlock & { quoteProgressionRate: Ratio };
    F: GroupBlock;
  };
  /** Aliases of the multi-turn (B) group, named per the pre-registered metric names (section 19). */
  multiTurn: { selectionAfterFactsCompleteRate: Ratio; confirmationAfterFactsCompleteRate: Ratio; durableSelectionAfterFactsCompleteRate: Ratio };
  informational: { turns: number; informationalOverMutationRate: Ratio; anyMutationRate: Ratio; mutationsByCapability: Record<string, number>; byScenario: Record<string, number> };
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
  failureTaxonomy: Record<ReplicationCategory, number>;
  scenarioBreakdown: Record<string, { group: ReplicationGroup; successes: number; turns: number }>;
};

export function computeReplicationVariantMetrics(variant: ReplicationVariantId, records: readonly ReplicationRunRecord[]): ReplicationVariantMetrics {
  const mine = records.filter((record) => record.variant === variant);
  const executedRecords = mine.filter((record) => record.trace !== null);
  const traces = executedRecords.map((record) => record.trace as BenchmarkE2ERunTrace);
  const allTurns = mine.flatMap(analyzeReplicationRun);
  const turns = allTurns.filter((turn) => turn.executed);
  const actionableTurns = turns.filter((turn) => turn.actionable);
  const of = (group: ReplicationGroup) => actionableTurns.filter((turn) => turn.group === group);
  const negatives = turns.filter((turn) => turn.group === "E");
  const turnTraces = traces.flatMap((trace) => trace.turns);
  const calls = turnTraces.flatMap((turn) => [...turn.providerCalls]);
  const invocations = turnTraces.flatMap((turn) => turn.toolInvocations);
  const shared = computeBenchmarkE2ESummaryMetrics(traces);
  const selected = actionableTurns.filter((turn) => turn.selectCompleted);
  const dGroup = of("D");
  const bBlock = groupBlock(of("B"));

  const mutationsByCapability: Record<string, number> = {};
  const negativeByScenario: Record<string, number> = {};
  for (const turn of negatives) {
    for (const capability of turn.mutationsRequested) mutationsByCapability[capability] = (mutationsByCapability[capability] ?? 0) + 1;
    if (turn.overMutationAny) negativeByScenario[turn.caseId] = (negativeByScenario[turn.caseId] ?? 0) + 1;
  }
  const failureTaxonomy = Object.fromEntries(REPLICATION_CATEGORIES.map((category) => [category, 0])) as Record<ReplicationCategory, number>;
  for (const turn of allTurns) failureTaxonomy[turn.category] += 1;

  const scenarioBreakdown: ReplicationVariantMetrics["scenarioBreakdown"] = {};
  for (const turn of turns) {
    const entry = (scenarioBreakdown[turn.caseId] ??= { group: turn.group, successes: 0, turns: 0 });
    entry.turns += 1;
    if (turn.category === "SELECTION_SUCCESS" || turn.category === "CONTROL_OK") entry.successes += 1;
  }
  const stats = executedRecords.map((record) => record.promptStats).filter((value): value is NonNullable<typeof value> => value !== null);

  return {
    variant,
    runsExecuted: executedRecords.length,
    harnessFailures: mine.length - executedRecords.length,
    turnsAnalyzed: turns.length,
    contextContaminatedRuns: new Set(allTurns.filter((turn) => turn.contextTurnMutation).map((turn) => `${turn.caseId}-${turn.runOrdinal}`)).size,
    actionable: groupBlock(actionableTurns),
    byGroup: {
      A: groupBlock(of("A")),
      B: bBlock,
      C: groupBlock(of("C")),
      D: { ...groupBlock(dGroup), quoteProgressionRate: ratio(dGroup.filter((turn) => turn.quoteProgress).length, dGroup.length) },
      F: groupBlock(of("F"))
    },
    multiTurn: { selectionAfterFactsCompleteRate: bBlock.selectionRate, confirmationAfterFactsCompleteRate: bBlock.unnecessaryConfirmationRate, durableSelectionAfterFactsCompleteRate: bBlock.durableSelectionRate },
    informational: {
      turns: negatives.length,
      informationalOverMutationRate: ratio(negatives.filter((turn) => turn.overMutationSelect).length, negatives.length),
      anyMutationRate: ratio(negatives.filter((turn) => turn.overMutationAny).length, negatives.length),
      mutationsByCapability,
      byScenario: negativeByScenario
    },
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
// Pre-registered signal (single step: R0 -> R1)
// ---------------------------------------------------------------------------

export const REPLICATION_THRESHOLDS = {
  /** Group A reaches the support margin when BOTH primaries move by at least this many pp (confirmation down, selection up). */
  supportedMinDeltaPp: 20,
  /** Group A is below the not-causal margin when BOTH move by less than this many pp (a worsening counts as below). */
  notCausalMaxDeltaPp: 10,
  /** Safety (R1 vs R0): informational over-mutation, wrong quantity and wrong product may exceed R0 by at most this many pp; selection corruption may not increase. Gateway rejection is reported, never a safety gate here (section 20/37: Quote Service BLOCKED locally is not evidence against R1). */
  maxSafetyExcessPp: 5,
  /** Group B (multi-turn) generalization margin: selectionAfterFactsCompleteRate gain OR confirmationAfterFactsCompleteRate drop of at least this many pp. */
  generalizationMinDeltaPp: 15,
  /** Group B must not degrade by more than this many pp for S1_REPLICATED to still hold (informal "no empeora materialmente"). */
  maxMultiTurnDegradationPp: 10,
  minATurnsPerVariant: 30
} as const;

export const REPLICATION_SIGNALS = ["S1_REPLICATED_AND_GENERALIZES", "S1_REPLICATED", "S1_PARTIAL_REPLICATION", "S1_NOT_REPLICATED"] as const;
export type ReplicationSignal = (typeof REPLICATION_SIGNALS)[number];

const pp = (value: number | null, base: number | null): number | null => (value !== null && base !== null ? (value - base) * 100 : null);
const nz = (value: number | null) => value ?? 0;

export type ReplicationSafety = { informationalOverMutationExcessPp: number | null; wrongQuantityExcessPp: number | null; wrongProductExcessPp: number | null; selectionCorruptionExcessPp: number | null; ok: boolean };

/** Safety of R1 versus R0 (section 20/23: informational over-mutation, wrong quantity, wrong product, selection corruption - Gateway rejection is reported separately, not a safety gate here). */
export function evaluateReplicationSafety(r1: ReplicationVariantMetrics, r0: ReplicationVariantMetrics): ReplicationSafety {
  const t = REPLICATION_THRESHOLDS;
  const overMutation = pp(r1.informational.informationalOverMutationRate.rate, r0.informational.informationalOverMutationRate.rate);
  const wrongQuantity = pp(r1.accuracy.wrongQuantityRate.rate, r0.accuracy.wrongQuantityRate.rate);
  const wrongProduct = pp(r1.accuracy.wrongProductRate.rate, r0.accuracy.wrongProductRate.rate);
  const corruption = pp(r1.quality.selectionCorruptionRate.rate, r0.quality.selectionCorruptionRate.rate);
  const ok = nz(overMutation) <= t.maxSafetyExcessPp && nz(wrongQuantity) <= t.maxSafetyExcessPp && nz(wrongProduct) <= t.maxSafetyExcessPp && nz(corruption) <= 0;
  return { informationalOverMutationExcessPp: overMutation, wrongQuantityExcessPp: wrongQuantity, wrongProductExcessPp: wrongProduct, selectionCorruptionExcessPp: corruption, ok };
}

export type ReplicationSignalResult = {
  signal: ReplicationSignal;
  reason: string;
  groupA: { confirmationDropPp: number | null; selectionGainPp: number | null; durableSelectionGainPp: number | null; reachesSupportMargin: boolean; belowNotCausalMargin: boolean };
  groupB: { selectionAfterFactsCompleteGainPp: number | null; confirmationAfterFactsCompleteDropPp: number | null; reachesGeneralizationMargin: boolean; degradedMaterially: boolean };
  safety: ReplicationSafety;
  dataSufficient: boolean;
};

/**
 * Section 23 (pre-registered before the smoke; not changed after the batch).
 *  S1_REPLICATED_AND_GENERALIZES: group A reaches the support margin, R1 is safe vs R0, group B does
 *    not degrade materially, AND group B reaches the generalization margin (selection +15pp or
 *    confirmation -15pp).
 *  S1_REPLICATED: group A reaches the support margin, R1 is safe vs R0, group B does not degrade
 *    materially (generalization margin not required).
 *  S1_NOT_REPLICATED: group A - both primary deltas below the not-causal margin (<10pp).
 *  S1_PARTIAL_REPLICATION: anything else.
 */
export function deriveReplicationSignal(r0: ReplicationVariantMetrics, r1: ReplicationVariantMetrics): ReplicationSignalResult {
  const t = REPLICATION_THRESHOLDS;
  const confirmationDropPp = pp(r0.byGroup.A.unnecessaryConfirmationRate.rate, r1.byGroup.A.unnecessaryConfirmationRate.rate);
  const selectionGainPp = pp(r1.byGroup.A.selectionRate.rate, r0.byGroup.A.selectionRate.rate);
  const durableSelectionGainPp = pp(r1.byGroup.A.durableSelectionRate.rate, r0.byGroup.A.durableSelectionRate.rate);
  const reachesSupportMargin = confirmationDropPp !== null && selectionGainPp !== null && confirmationDropPp >= t.supportedMinDeltaPp && selectionGainPp >= t.supportedMinDeltaPp;
  const belowNotCausalMargin = confirmationDropPp !== null && selectionGainPp !== null && confirmationDropPp < t.notCausalMaxDeltaPp && selectionGainPp < t.notCausalMaxDeltaPp;
  const groupA = { confirmationDropPp, selectionGainPp, durableSelectionGainPp, reachesSupportMargin, belowNotCausalMargin };

  const selectionAfterFactsCompleteGainPp = pp(r1.multiTurn.selectionAfterFactsCompleteRate.rate, r0.multiTurn.selectionAfterFactsCompleteRate.rate);
  const confirmationAfterFactsCompleteDropPp = pp(r0.multiTurn.confirmationAfterFactsCompleteRate.rate, r1.multiTurn.confirmationAfterFactsCompleteRate.rate);
  const reachesGeneralizationMargin = (selectionAfterFactsCompleteGainPp !== null && selectionAfterFactsCompleteGainPp >= t.generalizationMinDeltaPp) || (confirmationAfterFactsCompleteDropPp !== null && confirmationAfterFactsCompleteDropPp >= t.generalizationMinDeltaPp);
  const degradedMaterially = (selectionAfterFactsCompleteGainPp !== null && selectionAfterFactsCompleteGainPp <= -t.maxMultiTurnDegradationPp) || (confirmationAfterFactsCompleteDropPp !== null && confirmationAfterFactsCompleteDropPp <= -t.maxMultiTurnDegradationPp);
  const groupB = { selectionAfterFactsCompleteGainPp, confirmationAfterFactsCompleteDropPp, reachesGeneralizationMargin, degradedMaterially };

  const safety = evaluateReplicationSafety(r1, r0);
  const dataSufficient = [r0, r1].every((arm) => arm.harnessFailures === 0 && arm.byGroup.A.turns >= t.minATurnsPerVariant);
  const base = { groupA, groupB, safety, dataSufficient };

  if (confirmationDropPp === null || selectionGainPp === null) return { signal: "S1_PARTIAL_REPLICATION", reason: "no group A turns to compare", ...base };
  const replicated = reachesSupportMargin && safety.ok && !degradedMaterially;
  if (replicated && reachesGeneralizationMargin) return { signal: "S1_REPLICATED_AND_GENERALIZES", reason: "group A reaches the support margin safely, group B does not degrade and reaches the generalization margin", ...base };
  if (replicated) return { signal: "S1_REPLICATED", reason: "group A reaches the support margin safely and group B does not degrade materially, but the generalization margin is not reached", ...base };
  if (belowNotCausalMargin) return { signal: "S1_NOT_REPLICATED", reason: "group A moved both primary outcomes by less than 10pp", ...base };
  return { signal: "S1_PARTIAL_REPLICATION", reason: !safety.ok ? "group A reaches the support margin but a safety criterion is violated" : degradedMaterially ? "group A reaches the support margin but group B degraded materially" : "intermediate result: neither the support margin nor the not-causal margin is met on group A", ...base };
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

function stepDeltas(r0: ReplicationVariantMetrics, r1: ReplicationVariantMetrics): Record<string, number | null> {
  const delta = (pick: (m: ReplicationVariantMetrics) => number | null) => pp(pick(r1), pick(r0));
  return {
    actionableSelectionPooled: delta((m) => m.actionable.selectionRate.rate),
    durableActionableSelectionPooled: delta((m) => m.actionable.durableSelectionRate.rate),
    unnecessaryConfirmationPooled: delta((m) => m.actionable.unnecessaryConfirmationRate.rate),
    aSelection: delta((m) => m.byGroup.A.selectionRate.rate),
    aDurableSelection: delta((m) => m.byGroup.A.durableSelectionRate.rate),
    aUnnecessaryConfirmation: delta((m) => m.byGroup.A.unnecessaryConfirmationRate.rate),
    bSelectionAfterFactsComplete: delta((m) => m.multiTurn.selectionAfterFactsCompleteRate.rate),
    bConfirmationAfterFactsComplete: delta((m) => m.multiTurn.confirmationAfterFactsCompleteRate.rate),
    cSelection: delta((m) => m.byGroup.C.selectionRate.rate),
    dSelection: delta((m) => m.byGroup.D.selectionRate.rate),
    dQuoteProgression: delta((m) => m.byGroup.D.quoteProgressionRate.rate),
    fCorrectReplacement: delta((m) => m.byGroup.F.correctDurableRate.rate),
    informationalOverMutation: delta((m) => m.informational.informationalOverMutationRate.rate),
    informationalAnyMutation: delta((m) => m.informational.anyMutationRate.rate),
    wrongQuantity: delta((m) => m.accuracy.wrongQuantityRate.rate),
    wrongProduct: delta((m) => m.accuracy.wrongProductRate.rate),
    selectionCorruption: delta((m) => m.quality.selectionCorruptionRate.rate),
    gatewayRejection: delta((m) => nz(m.quality.gatewayRejectionRate)),
    argumentFailure: delta((m) => m.quality.argumentFailureCalls.rate),
    inputTokensPerTurn: (r1.tokens.inputPerTurnMean ?? 0) - (r0.tokens.inputPerTurnMean ?? 0),
    latencyPerCallP95Ms: (r1.latency.perCallMs.p95 ?? 0) - (r0.latency.perCallMs.p95 ?? 0)
  };
}

export type ReplicationComparison = {
  denominatorDefinition: string;
  thresholds: typeof REPLICATION_THRESHOLDS;
  signal: ReplicationSignalResult;
  deltas: Record<string, number | null>;
  perGroup: Record<string, Record<string, { turns: number; selectionRate: number | null; unnecessaryConfirmationRate: number | null }>>;
  residuals: Record<string, Record<Residual, number>>;
  dataQuality: { harnessFailures: Record<string, number>; aTurns: Record<string, number>; bTurns: Record<string, number>; contextContaminatedRuns: Record<string, number>; sufficient: boolean };
};

export function compareReplication(r0: ReplicationVariantMetrics, r1: ReplicationVariantMetrics): ReplicationComparison {
  const signal = deriveReplicationSignal(r0, r1);
  const groups = ["A", "B", "C", "D", "F"] as const;
  const metrics = { R0_CURRENT_SEMANTICS: r0, R1_CONSEQUENCE_STATEMENT: r1 };
  return {
    denominatorDefinition:
      "ACTIONABLE = turns where the product is known (stated by the customer, never inferred from the assistant's reply), the quantity is explicit, select_products is structurally executable and no ambiguity remains (A, B, C, D, F scenarios; E is never actionable). unnecessaryConfirmationRate = ACTIONABLE turns with no select_products attempted whose final reply the frozen P7.10 classifier labels UNNECESSARY_CONFIRMATION. actionableSelectionRate = select_products completed. durable = completed AND a durable selection exists after the turn. selectionAfterFactsCompleteRate / confirmationAfterFactsCompleteRate = the same rates restricted to group B (the turn where the last missing fact - quantity - just became available).",
    thresholds: REPLICATION_THRESHOLDS,
    signal,
    deltas: stepDeltas(r0, r1),
    perGroup: Object.fromEntries(groups.map((group) => [group, Object.fromEntries(Object.entries(metrics).map(([id, m]) => [id, { turns: m.byGroup[group].turns, selectionRate: m.byGroup[group].selectionRate.rate, unnecessaryConfirmationRate: m.byGroup[group].unnecessaryConfirmationRate.rate }]))])),
    residuals: Object.fromEntries(Object.entries(metrics).map(([id, m]) => [id, m.byGroup.A.residuals])),
    dataQuality: {
      harnessFailures: Object.fromEntries(Object.entries(metrics).map(([id, m]) => [id, m.harnessFailures])),
      aTurns: Object.fromEntries(Object.entries(metrics).map(([id, m]) => [id, m.byGroup.A.turns])),
      bTurns: Object.fromEntries(Object.entries(metrics).map(([id, m]) => [id, m.byGroup.B.turns])),
      contextContaminatedRuns: Object.fromEntries(Object.entries(metrics).map(([id, m]) => [id, m.contextContaminatedRuns])),
      sufficient: signal.dataSufficient
    }
  };
}

export { REPLICATION_GROUPS };
