import assert from "node:assert/strict";
import test from "node:test";
import { analyzeTrueRun, asksForQuantity, compareArms, computeTrueArmMetrics, TRUE_ARM_IDS, type TrueArmId, type TrueRunRecord } from "@/lib/brain/commercial/agent-loop/benchmark/r3TrueAB/trueAnalysis";
import type { BenchmarkE2EDurableStateSnapshot, BenchmarkE2EToolInvocationTrace, BenchmarkE2ETurnTrace } from "@/lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/types";

/**
 * SALES-AGENT-R3-P7.8-R. Pure tests: Q+/Q- classification, the primary
 * commercialProgressAfterGrounding metric, negative controls, identical
 * denominators across arms and the five-way architecture signal.
 */

const inv = (capability: string, stepIndex: number, status = "completed", errorCode: string | null = null): BenchmarkE2EToolInvocationTrace => ({
  stepIndex,
  capability,
  workId: null,
  workVersion: null,
  objectiveId: null,
  objectiveType: null,
  eligibilityAtTurnStart: null,
  gateway: { status, errorCode, retryable: false },
  toolObservation: { status, errorCode, retryable: false },
  inTurnEvidence: { relevantEvidenceProduced: [], blockerPotentiallyChanged: false, potentiallyAffectedReasonCodes: [] }
});

const state = (items: { productId: string; quantity: number }[] = []): BenchmarkE2EDurableStateSnapshot => ({
  capturedAt: "t",
  workId: "w",
  workVersion: 1,
  workStatus: "ACTIVE",
  objectiveType: null,
  objectiveStatus: null,
  selection: { present: items.length > 0, freshness: items.length > 0 ? "CURRENT" : null, itemCount: items.length || null, items },
  destination: { present: false, freshness: null, communeId: null },
  shipping: { present: false, freshness: null },
  quote: { present: false, freshness: null, quoteId: null, quoteStatus: null },
  identityLevel: "LEVEL_0_ANONYMOUS"
});

const turn = (input: { ordinal?: number; invs?: BenchmarkE2EToolInvocationTrace[]; message?: string; after?: BenchmarkE2EDurableStateSnapshot }): BenchmarkE2ETurnTrace => ({
  turnOrdinal: input.ordinal ?? 0,
  inboundMessageId: "m",
  correlationId: "c",
  customerMessage: "x",
  durableStateBeforeTurn: state(),
  kernel: null,
  toolInvocations: input.invs ?? [],
  proposal: null,
  objectiveReconciliation: { decided: null, reconciled: null },
  eligibilityShadow: null,
  response: { status: "responded", terminalReason: "responded", finalMessage: input.message ?? "Listo.", handoffReason: null, toolExecutionCount: input.invs?.length ?? 0 },
  runtimeWarnings: [],
  outbox: { attempted: false, outboxWritten: false, outboxId: null, status: null, messageTextPresent: true },
  durableStateAfterTurn: input.after ?? state(),
  providerCalls: [{ caseId: "x", runIndex: 0, callIndex: 0, elapsedMs: 1000, outcome: "success", errorCode: null, finishReason: "stop", inputTokens: 100, outputTokens: 10, reasoningTokens: 0, providerRequestId: null, model: "m" }]
});

function record(arm: TrueArmId, caseId: string, turns: BenchmarkE2ETurnTrace[], run = 0): TrueRunRecord {
  return {
    pairId: `${caseId}-r${run}`,
    arm,
    caseId,
    runOrdinal: run,
    sequenceIndex: 0,
    isNegativeControl: caseId.startsWith("N"),
    trace: { benchmarkRunId: "b", caseId, runOrdinal: run, executionMode: "HYBRID", startedAt: "", finishedAt: "", initialState: state(), turns, finalState: turns[turns.length - 1]?.durableStateAfterTurn ?? null, outcome: { status: "PASS", expectationResults: {}, forbiddenViolations: [], failure: null } },
    harnessError: null,
    runConfig: { arm, model: "m", temperature: 0, thinking: "disabled", timeoutMs: 60000, maxOutputTokens: 4000, maxModelRetries: 5, maxDecisions: 3, maxToolExecutions: 2, promptVersion: "v", promptSha256: "h", toolSurface: "current", usesR3Loop: arm === "A_R3_CURRENT", eligibilityInfluencedCognition: arm === "A_R3_CURRENT" },
    promptStats: { systemPromptChars: arm === "A_R3_CURRENT" ? 47000 : 900, systemPromptApproxTokens: 1, policyLineCount: arm === "A_R3_CURRENT" ? 150 : 8, toolContractChars: arm === "C1_PURE_THIN_TOOLS" ? 4000 : 16000, providerCallCount: 1 }
  };
}
const first = (r: TrueRunRecord, ordinal = 0) => analyzeTrueRun(r).find((analysis) => analysis.turnOrdinal === ordinal)!;

test("P7.8-R/12: Q+ is a turn whose quantity is stated (E04 t0/t1, E15); Q- is every other explicit-purchase turn; informational turns have no group", () => {
  const groups = [["E04", 0], ["E04", 1], ["E15", 0], ["E02", 0], ["E05", 0], ["E07", 0], ["E14", 0], ["E14", 1], ["N01", 0]] as const;
  const expected = ["Q+", "Q+", "Q+", "Q-", "Q-", "Q-", "Q-", "Q-", null];
  groups.forEach(([caseId, ordinal], index) => {
    const turns = ordinal === 1 ? [turn({ ordinal: 0 }), turn({ ordinal: 1 })] : [turn({ ordinal: 0 })];
    assert.equal(first(record("A_R3_CURRENT", caseId, turns), ordinal).group, expected[index], `${caseId} t${ordinal}`);
  });
});

test("P7.8-R/13: Q+ progress = select_products requested; presenting the product or asking a known fact is failure", () => {
  const commit = first(record("B_PURE_CURRENT_TOOLS", "E15", [turn({ invs: [inv("get_product_details", 0), inv("select_products", 1)], after: state([{ productId: "31", quantity: 2 }]) })]));
  assert.equal(commit.progressAfterGrounding, true);
  assert.equal(commit.progressFixed, true);
  const present = first(record("B_PURE_CURRENT_TOOLS", "E15", [turn({ invs: [inv("get_product_details", 0)], message: "Cuesta $89.990. ¿Quieres que te envíe el link?" })]));
  assert.equal(present.progressAfterGrounding, false);
  assert.equal(present.category, "UNNECESSARY_CONFIRMATION");
});

test("P7.8-R/13: Q- progress = specifically asks for the quantity WITHOUT inventing one; selecting anyway is an assumed quantity, presenting only is failure", () => {
  const ask = first(record("C1_PURE_THIN_TOOLS", "E02", [turn({ invs: [inv("get_product_details", 0)], message: "¿Cuántas unidades necesitas?" })]));
  assert.equal(ask.progressAfterGrounding, true);
  assert.equal(ask.progressFixed, true);
  const assumed = first(record("C1_PURE_THIN_TOOLS", "E02", [turn({ invs: [inv("get_product_details", 0), inv("select_products", 1)], after: state([{ productId: "31", quantity: 1 }]) })]));
  assert.equal(assumed.assumedQuantity, true);
  assert.equal(assumed.progressAfterGrounding, false, "an invented quantity is not progress");
  const presentOnly = first(record("C1_PURE_THIN_TOOLS", "E02", [turn({ invs: [inv("get_product_details", 0)], message: "Es la Classic, $89.990. Quedan 15 unidades disponibles." })]));
  assert.equal(presentOnly.progressAfterGrounding, false);
});

test("P7.8-R/13: a create_quote REQUEST on E14 t1 counts as progression (Quote Service is BLOCKED)", () => {
  const t1 = first(record("A_R3_CURRENT", "E14", [turn({}), turn({ ordinal: 1, invs: [inv("create_quote", 0, "failed", "quote_service_not_configured")] })]), 1);
  assert.equal(t1.progressFixed, true);
});

test("P7.8-R/12: the group metrics are reported separately - commitRateWhenQuantityKnown, commitRateWhenQuantityMissing, requestQuantityRateWhenMissing, respondWithoutCommitOrQuantityQuestion", () => {
  const records = [
    record("A_R3_CURRENT", "E15", [turn({ invs: [inv("get_product_details", 0), inv("select_products", 1)], after: state([{ productId: "31", quantity: 2 }]) })]),
    record("A_R3_CURRENT", "E04", [turn({ invs: [inv("get_product_details", 0)], message: "¿Te lo agrego?" }), turn({ ordinal: 1, invs: [inv("select_products", 0)], after: state([{ productId: "31", quantity: 2 }]) })]),
    record("A_R3_CURRENT", "E02", [turn({ invs: [inv("get_product_details", 0)], message: "¿Cuántas necesitas?" })]),
    record("A_R3_CURRENT", "E05", [turn({ invs: [inv("get_product_details", 0)], message: "Tiene buen precio." }), turn({ ordinal: 1 })])
  ];
  const m = computeTrueArmMetrics("A_R3_CURRENT", records);
  assert.equal(m.qPlus.turns, 3);
  assert.deepEqual([m.qPlus.commitRateWhenQuantityKnown.numerator, m.qPlus.commitRateWhenQuantityKnown.denominator], [2, 3]);
  assert.equal(m.qMinus.turns, 3);
  assert.deepEqual([m.qMinus.requestQuantityRateWhenMissing.numerator, m.qMinus.requestQuantityRateWhenMissing.denominator], [1, 3]);
  assert.equal(m.qMinus.commitRateWhenQuantityMissing.numerator, 0);
  assert.equal(m.qMinus.respondWithoutCommitOrQuantityQuestion.numerator, 2);
  assert.equal(m.explicitPurchaseTurns, 6);
});

test("P7.8-R/L: negative controls - any commercial mutation on an informational turn is over-mutation, per arm", () => {
  const clean = record("B_PURE_CURRENT_TOOLS", "N01", [turn({ invs: [inv("get_product_details", 0)] })]);
  const dirty = record("B_PURE_CURRENT_TOOLS", "N02", [turn({ invs: [inv("select_products", 0, "blocked")] })]);
  const m = computeTrueArmMetrics("B_PURE_CURRENT_TOOLS", [clean, dirty]);
  assert.equal(m.negativeControls.informationalTurns, 2);
  assert.equal(m.negativeControls.overMutation.rate, 0.5);
  assert.equal(first(dirty).category, "OVER_MUTATION");
});

function fixture(arm: TrueArmId, spec: { commit: boolean; askQty: boolean; overMutate?: boolean }, runs = 9): TrueRunRecord[] {
  const out: TrueRunRecord[] = [];
  for (let run = 0; run < runs; run += 1) {
    out.push(record(arm, "E15", [turn({ invs: spec.commit ? [inv("get_product_details", 0), inv("select_products", 1)] : [inv("get_product_details", 0)], message: spec.commit ? "Listo" : "Es la Classic.", after: spec.commit ? state([{ productId: "31", quantity: 2 }]) : state() })], run));
    out.push(record(arm, "E02", [turn({ invs: [inv("get_product_details", 0)], message: spec.askQty ? "¿Cuántas unidades necesitas?" : "Es la Classic." })], run));
    out.push(record(arm, "N01", [turn({ invs: spec.overMutate ? [inv("select_products", 0, "blocked")] : [inv("get_product_details", 0)] })], run));
  }
  return out;
}

function metricsFor(specs: Record<TrueArmId, { commit: boolean; askQty: boolean; overMutate?: boolean }>) {
  const all = TRUE_ARM_IDS.flatMap((arm) => fixture(arm, specs[arm]));
  return Object.fromEntries(TRUE_ARM_IDS.map((arm) => [arm, computeTrueArmMetrics(arm, all)])) as Record<TrueArmId, ReturnType<typeof computeTrueArmMetrics>>;
}
const LOW = { commit: false, askQty: false };
const HIGH = { commit: true, askQty: true };

test("P7.8-R/K: every arm is measured over the same fixed explicit-purchase cohort (identical denominators)", () => {
  const metrics = metricsFor({ A_R3_CURRENT: LOW, B_PURE_CURRENT_TOOLS: HIGH, C1_PURE_THIN_TOOLS: HIGH });
  const denominators = TRUE_ARM_IDS.map((arm) => metrics[arm].commercialProgressFixedCohortRate.denominator);
  assert.deepEqual(new Set(denominators).size, 1);
  assert.equal(denominators[0], 18);
  const comparison = compareArms(metrics);
  assert.deepEqual(new Set(Object.values(comparison.dataQuality.explicitPurchaseTurns)).size, 1);
  assert.ok(comparison.denominatorDefinition.includes("fixed per-turn annotation"));
  for (const key of ["A_vs_B_harness_tax", "B_vs_C_capability_tax", "A_vs_C_total_difference"] as const) assert.ok(comparison[key].commercialProgressFixedCohortRate);
});

test("P7.8-R/24: signal - A 20% / B 65% / C1 70% => PURE_HARNESS_FAVORED (R3 orchestration degrades)", () => {
  const s = compareArms(metricsFor({ A_R3_CURRENT: LOW, B_PURE_CURRENT_TOOLS: HIGH, C1_PURE_THIN_TOOLS: HIGH })).architectureSignal;
  assert.equal(s.signal, "PURE_HARNESS_FAVORED");
  assert.equal(s.harnessTaxDetected, true);
});

test("P7.8-R/24: signal - A 20% / B 22% / C1 75% => CAPABILITY_CONTRACT_IS_BOTTLENECK", () => {
  const s = compareArms(metricsFor({ A_R3_CURRENT: LOW, B_PURE_CURRENT_TOOLS: LOW, C1_PURE_THIN_TOOLS: HIGH })).architectureSignal;
  assert.equal(s.signal, "CAPABILITY_CONTRACT_IS_BOTTLENECK");
  assert.equal(s.capabilityTaxDetected, true);
});

test("P7.8-R/24: signal - A ~ B ~ C1 all failing => MODEL_OR_DOMAIN_CONTRACT_IS_BOTTLENECK", () => {
  assert.equal(compareArms(metricsFor({ A_R3_CURRENT: LOW, B_PURE_CURRENT_TOOLS: LOW, C1_PURE_THIN_TOOLS: LOW })).architectureSignal.signal, "MODEL_OR_DOMAIN_CONTRACT_IS_BOTTLENECK");
});

test("P7.8-R/24: signal - A 70% / B 45% / C1 50% => R3_FAVORED", () => {
  assert.equal(compareArms(metricsFor({ A_R3_CURRENT: HIGH, B_PURE_CURRENT_TOOLS: LOW, C1_PURE_THIN_TOOLS: LOW })).architectureSignal.signal, "R3_FAVORED");
});

test("P7.8-R/24: an autonomous arm that improves progress but over-mutates on informational questions is never favored", () => {
  const s = compareArms(metricsFor({ A_R3_CURRENT: LOW, B_PURE_CURRENT_TOOLS: { ...HIGH, overMutate: true }, C1_PURE_THIN_TOOLS: { ...HIGH, overMutate: true } })).architectureSignal;
  assert.equal(s.safe.B_PURE_CURRENT_TOOLS, false);
  assert.equal(s.signal, "NO_CLEAR_WINNER");
});

test("P7.8-R/24: all arms high and equal => NO_CLEAR_WINNER; insufficient data never yields a winner", () => {
  assert.equal(compareArms(metricsFor({ A_R3_CURRENT: HIGH, B_PURE_CURRENT_TOOLS: HIGH, C1_PURE_THIN_TOOLS: HIGH })).architectureSignal.signal, "NO_CLEAR_WINNER");
  const thin = Object.fromEntries(TRUE_ARM_IDS.map((arm) => [arm, computeTrueArmMetrics(arm, fixture(arm, arm === "A_R3_CURRENT" ? LOW : HIGH, 1))])) as Record<TrueArmId, ReturnType<typeof computeTrueArmMetrics>>;
  const c = compareArms(thin);
  assert.equal(c.dataQuality.sufficient, false);
  assert.equal(c.architectureSignal.signal, "NO_CLEAR_WINNER");
});

test("P7.8-R/15: capability tax block reports the contract size reduction and the B vs C1 behavior deltas", () => {
  const c = compareArms(metricsFor({ A_R3_CURRENT: LOW, B_PURE_CURRENT_TOOLS: LOW, C1_PURE_THIN_TOOLS: HIGH }));
  assert.equal(c.capabilityContractTax.toolContractCharsB, 16000);
  assert.equal(c.capabilityContractTax.toolContractCharsC1, 4000);
  assert.equal(c.capabilityContractTax.relevantToolContractReduction, 0.75);
  assert.equal(c.B_vs_C_capability_tax.toolContractChars.delta, -12000);
});

test("P7.8-R: a run that threw is a HARNESS_FAILURE excluded from denominators and counted separately", () => {
  const broken: TrueRunRecord = { ...record("C1_PURE_THIN_TOOLS", "E02", []), trace: null, harnessError: "boom" };
  const m = computeTrueArmMetrics("C1_PURE_THIN_TOOLS", [broken]);
  assert.equal(m.harnessFailures, 1);
  assert.equal(m.explicitPurchaseTurns, 0);
  assert.equal(m.commercialProgressFixedCohortRate.rate, null);
});

test("P7.8-R: the strict quantity-request detector requires a question that asks HOW MANY; a link offer after 'unidades disponibles' is not a quantity request (the legacy pattern's false positive)", () => {
  const stockThenLink = "Precio: $89.990 CLP. Quedan 15 unidades disponibles. ¿Quieres que te envíe el link para revisarlo?";
  assert.equal(asksForQuantity(stockThenLink, "legacy"), true, "documented defect of the pre-registered pattern");
  assert.equal(asksForQuantity(stockThenLink, "strict"), false);
  assert.equal(asksForQuantity("¿Cuántas quieres y a qué comuna la enviamos?", "strict"), true);
  assert.equal(asksForQuantity("Para cotizarla necesito confirmar la cantidad de unidades que quieres. ¿Cuántas barras necesitas?", "strict"), true);
  assert.equal(asksForQuantity("¿Qué cantidad necesitas?", "strict"), true);
  assert.equal(asksForQuantity("¿Cuánto cuesta el envío?", "strict"), false, "singular 'cuánto' is a price question");
  assert.equal(asksForQuantity("Necesito saber cuántas unidades quieres", "strict"), false, "not a question");
  assert.equal(asksForQuantity("¿La agrego a tu pedido? Si me indicas la comuna, calculo el envío.", "strict"), false);
});

test("P7.8-R/13: Q- progress under the strict detector - presenting the product with a link offer is NOT progress; the legacy detector wrongly counted it", () => {
  const r = record("A_R3_CURRENT", "E02", [turn({ invs: [inv("get_product_details", 0)], message: "Precio: $89.990. Quedan 15 unidades disponibles. ¿Quieres que te envíe el link para revisarlo?" })]);
  assert.equal(analyzeTrueRun(r, "strict")[0].progressAfterGrounding, false);
  assert.equal(analyzeTrueRun(r, "legacy")[0].progressAfterGrounding, true);
  assert.equal(analyzeTrueRun(r)[0].progressAfterGrounding, false, "strict is the default");
  assert.equal(computeTrueArmMetrics("A_R3_CURRENT", [r]).qMinus.requestQuantityRateWhenMissing.numerator, 0);
  assert.equal(computeTrueArmMetrics("A_R3_CURRENT", [r], "legacy").qMinus.requestQuantityRateWhenMissing.numerator, 1);
});
