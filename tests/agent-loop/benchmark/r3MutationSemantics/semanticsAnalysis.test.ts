import assert from "node:assert/strict";
import test from "node:test";
import { ratio } from "@/lib/brain/commercial/agent-loop/benchmark/r3CapabilityIsolation/isolationAnalysis";
import type { BenchmarkE2ERunTrace } from "@/lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/types";
import { analyzeSemanticsRun, DECLARATIVE_RESIDUALS, deriveSemanticsSignal, evaluateSemanticsSafety, evaluateStep, mcnemarExact, SEMANTICS_CATEGORIES, SEMANTICS_SIGNALS, SEMANTICS_STEPS, SEMANTICS_THRESHOLDS, speechActGapPp, type SemanticsRunRecord, type SemanticsVariantMetrics } from "@/lib/brain/commercial/agent-loop/benchmark/r3MutationSemantics/semanticsAnalysis";

/**
 * SALES-AGENT-R3-P7.10. Pure analysis tests over minimal synthetic traces (only the fields the
 * per-turn analysis reads) and over hand-built metric objects for the pre-registered signal.
 */
type FakeTurn = { reply: string | null; calls?: { capability: string; toolStatus?: string; gatewayStatus?: string }[]; items?: { productId: string; quantity: number }[]; terminalReason?: string; beforeItems?: { productId: string; quantity: number }[] };

function fakeTrace(turns: FakeTurn[]): BenchmarkE2ERunTrace {
  const state = (items: { productId: string; quantity: number }[]) => ({ selection: { present: items.length > 0, itemCount: items.length, items }, destination: { present: false }, quote: { present: false } });
  return {
    turns: turns.map((turn, turnOrdinal) => ({
      turnOrdinal,
      toolInvocations: (turn.calls ?? []).map((call, stepIndex) => ({ stepIndex, capability: call.capability, toolObservation: { status: call.toolStatus ?? "completed", errorCode: null }, gateway: { status: call.gatewayStatus ?? "completed" } })),
      response: { terminalReason: turn.terminalReason ?? "responded", finalMessage: turn.reply },
      durableStateBeforeTurn: state(turn.beforeItems ?? []),
      durableStateAfterTurn: state(turn.items ?? []),
      providerCalls: [{ elapsedMs: 100, inputTokens: 1000, outputTokens: 10, reasoningTokens: 0 }],
      runtimeWarnings: []
    }))
  } as unknown as BenchmarkE2ERunTrace;
}

const CONFIG = { variant: "S0_CURRENT_SEMANTICS" as const, model: "m", temperature: 0, thinking: "disabled" as const, timeoutMs: 60000, maxOutputTokens: 4000, maxModelRetries: 5, promptVersion: "v", promptSha256: "x", toolContractSha16: "y" };
function record(caseId: string, group: SemanticsRunRecord["group"], turns: FakeTurn[]): SemanticsRunRecord {
  return { pairId: `${caseId}-r0`, variant: "S0_CURRENT_SEMANTICS", caseId, group, runOrdinal: 0, sequenceIndex: 0, trace: fakeTrace(turns), harnessError: null, runConfig: CONFIG, promptStats: null };
}
const analyze = (caseId: string, group: SemanticsRunRecord["group"], turns: FakeTurn[]) => analyzeSemanticsRun(record(caseId, group, turns))[0];
const ground = (productId: string) => ({ capability: "get_product_details", toolStatus: "completed", gatewayStatus: "completed", productId });

test("P7.10 analysis: the taxonomy is the declared one (plus CONTROL_OK for a clean informational control)", () => {
  assert.deepEqual([...SEMANTICS_CATEGORIES], ["SELECTION_SUCCESS", "UNNECESSARY_CONFIRMATION", "MISSING_FACT", "INFORMATIONAL_CLOSE", "WRONG_PRODUCT", "WRONG_QUANTITY", "OVER_MUTATION", "SELECTION_CORRUPTION", "GATEWAY_REJECTION", "PROVIDER_FAILURE", "HARNESS_FAILURE", "OTHER", "CONTROL_OK"]);
});

test("P7.10 analysis: an actionable turn that ends asking '¿confirmas las 2?' without select_products is an UNNECESSARY_CONFIRMATION", () => {
  const turn = analyze("D01", "D", [{ reply: "¿Confirmas las 2 unidades de la Classic?", calls: [ground("31")] }]);
  assert.equal(turn.actionable, true);
  assert.equal(turn.confirmationClass, "UNNECESSARY_CONFIRMATION");
  assert.equal(turn.unnecessaryConfirmation, true);
  assert.equal(turn.selectAttempted, false);
  assert.equal(turn.category, "UNNECESSARY_CONFIRMATION");
});

test("P7.10 analysis: select_products completed with the expected durable selection is SELECTION_SUCCESS (durable) even if the reply then asks something", () => {
  const turn = analyze("D01", "D", [{ reply: "Listo, dejé 2 Classic. ¿Confirmas que son 2?", calls: [ground("31"), { capability: "select_products" }], items: [{ productId: "31", quantity: 2 }] }]);
  assert.equal(turn.selectCompleted, true);
  assert.equal(turn.durableSelection, true);
  assert.equal(turn.correctDurable, true);
  assert.equal(turn.confirmationClass, "ACTION_EXECUTED");
  assert.equal(turn.unnecessaryConfirmation, false);
  assert.equal(turn.category, "SELECTION_SUCCESS");
});

test("P7.10 analysis: wrong quantity and wrong product are judged on the DURABLE selection, not on text", () => {
  const wrongQuantity = analyze("D01", "D", [{ reply: "Listo.", calls: [ground("31"), { capability: "select_products" }], items: [{ productId: "31", quantity: 3 }] }]);
  assert.deepEqual([wrongQuantity.wrongQuantity, wrongQuantity.wrongProduct, wrongQuantity.category], [true, false, "WRONG_QUANTITY"]);
  const wrongProduct = analyze("D01", "D", [{ reply: "Listo.", calls: [ground("32"), { capability: "select_products" }], items: [{ productId: "32", quantity: 2 }] }]);
  assert.deepEqual([wrongProduct.wrongProduct, wrongProduct.category], [true, "WRONG_PRODUCT"]);
});

test("P7.10 analysis: a text claim of action with no completed select_products is never a success", () => {
  const turn = analyze("D01", "D", [{ reply: "Perfecto, dejé dos seleccionadas.", calls: [ground("31")] }]);
  assert.equal(turn.confirmationClass, "OTHER");
  assert.equal(turn.selectCompleted, false);
  assert.equal(turn.category, "OTHER");
  assert.equal(turn.correctDurable, false);
});

test("P7.10 analysis: a select_products that the Gateway rejected is GATEWAY_REJECTION (attempted, not completed), not a confirmation failure", () => {
  const turn = analyze("D01", "D", [{ reply: "No pude guardarlo. ¿Confirmas las 2?", calls: [ground("31"), { capability: "select_products", toolStatus: "blocked", gatewayStatus: "denied" }] }]);
  assert.deepEqual([turn.selectAttempted, turn.selectCompleted, turn.selectRejected, turn.unnecessaryConfirmation, turn.category], [true, false, true, false, "GATEWAY_REJECTION"]);
});

test("P7.10 analysis: missing-fact questions and informational closes are separate outcomes", () => {
  assert.equal(analyze("D01", "D", [{ reply: "¿Cuántas unidades quieres?", calls: [ground("31")] }]).category, "MISSING_FACT");
  assert.equal(analyze("D01", "D", [{ reply: "La Classic cuesta $89.990.", calls: [ground("31")] }]).category, "INFORMATIONAL_CLOSE");
});

test("P7.10 analysis: informational controls - any select_products is over-mutation; a clean answer is CONTROL_OK", () => {
  const over = analyze("N01", "N", [{ reply: "Listo.", calls: [ground("31"), { capability: "select_products" }], items: [{ productId: "31", quantity: 1 }] }]);
  assert.deepEqual([over.actionable, over.overMutationSelect, over.overMutationAny, over.category], [false, true, true, "OVER_MUTATION"]);
  const clean = analyze("N01", "N", [{ reply: "Cuesta $89.990. ¿Quieres que la agregue?", calls: [ground("31")] }]);
  assert.deepEqual([clean.overMutationAny, clean.unnecessaryConfirmation, clean.category], [false, false, "CONTROL_OK"]);
  const shipping = analyze("N02", "N", [{ reply: "ok", calls: [{ capability: "set_shipping_destination" }] }]);
  assert.deepEqual([shipping.overMutationSelect, shipping.overMutationAny], [false, true]);
});

test("P7.10 analysis: follow-up F01 is actionable only if the first reply names exactly ONE product, and the expected product is that one", () => {
  const facts = { reply: "Listo.", calls: [ground("31"), { capability: "select_products" }], items: [{ productId: "31", quantity: 2 }] };
  const one = analyzeSemanticsRun(record("F01", "F", [{ reply: "Te recomiendo la Classic para uso general." }, facts]))[0];
  assert.deepEqual([one.actionable, one.expectedItems, one.category], [true, [{ productId: "31", quantity: 2 }], "SELECTION_SUCCESS"]);
  const both = analyzeSemanticsRun(record("F01", "F", [{ reply: "Depende: la Classic o la Pro." }, facts]))[0];
  assert.deepEqual([both.actionable, both.notActionableReason], [false, "context_reply_named_both_products"]);
  const none = analyzeSemanticsRun(record("F01", "F", [{ reply: "Cuéntame más de tu gimnasio." }, facts]))[0];
  assert.deepEqual([none.actionable, none.notActionableReason], [false, "context_reply_named_no_product"]);
  const pro = analyzeSemanticsRun(record("F01", "F", [{ reply: "Te recomiendo la Pro." }, { ...facts, items: [{ productId: "31", quantity: 2 }] }]))[0];
  assert.deepEqual([pro.expectedItems, pro.wrongProduct, pro.category], [[{ productId: "32", quantity: 2 }], true, "WRONG_PRODUCT"]);
});

test("P7.10 analysis: a mutation in a context turn is reported as contamination, never excluded", () => {
  const turns = analyzeSemanticsRun(record("F03", "F", [{ reply: "Dejé 1.", calls: [{ capability: "select_products" }], items: [{ productId: "31", quantity: 1 }] }, { reply: "Listo.", calls: [ground("31"), { capability: "select_products" }], items: [{ productId: "31", quantity: 2 }], beforeItems: [{ productId: "31", quantity: 1 }] }]));
  assert.equal(turns.length, 1);
  assert.equal(turns[0].contextTurnMutation, true);
  assert.equal(turns[0].category, "SELECTION_SUCCESS");
});

test("P7.10 analysis: replacement is judged on the exact final selection (full replacement, no merge)", () => {
  const seed = [{ productId: "31", quantity: 2 }];
  const ok = analyze("R01", "R", [{ reply: "Listo.", calls: [ground("32"), { capability: "select_products" }], items: [{ productId: "32", quantity: 1 }], beforeItems: seed }]);
  assert.deepEqual([ok.correctDurable, ok.category], [true, "SELECTION_SUCCESS"]);
  const merged = analyze("R01", "R", [{ reply: "Listo.", calls: [ground("32"), { capability: "select_products" }], items: [{ productId: "31", quantity: 2 }, { productId: "32", quantity: 1 }], beforeItems: seed }]);
  assert.deepEqual([merged.correctDurable, merged.wrongProduct, merged.category], [false, true, "WRONG_PRODUCT"]);
  const asked = analyze("R01", "R", [{ reply: "¿Quieres que cambie la selección a una Pro?", calls: [], items: seed, beforeItems: seed }]);
  assert.deepEqual([asked.correctDurable, asked.category], [false, "UNNECESSARY_CONFIRMATION"]);
  const sameQuantityProduct = analyze("R03", "R", [{ reply: "Listo.", calls: [{ capability: "select_products" }], items: [{ productId: "31", quantity: 4 }], beforeItems: [{ productId: "31", quantity: 2 }] }]);
  assert.equal(sameQuantityProduct.category, "SELECTION_SUCCESS");
});

test("P7.10 analysis: quote-action progression counts select_products OR create_quote", () => {
  assert.equal(analyze("Q01", "Q", [{ reply: "ok", calls: [{ capability: "create_quote", toolStatus: "blocked", gatewayStatus: "temporarily_blocked" }] }]).quoteProgress, true);
  assert.equal(analyze("Q01", "Q", [{ reply: "ok", calls: [ground("31"), { capability: "select_products" }], items: [{ productId: "31", quantity: 2 }] }]).quoteProgress, true);
  assert.equal(analyze("Q01", "Q", [{ reply: "¿Quieres que te arme una cotización?", calls: [ground("31")] }]).quoteProgress, false);
});

test("P7.10 analysis: a run that threw is a HARNESS_FAILURE turn and is not analysed as executed", () => {
  const failed: SemanticsRunRecord = { ...record("D01", "D", []), trace: null, harnessError: "boom" };
  const [turn] = analyzeSemanticsRun(failed);
  assert.deepEqual([turn.executed, turn.actionable, turn.category], [false, false, "HARNESS_FAILURE"]);
});

test("P7.10 speechActGap = imperativeSelectionRate - declarativeSelectionRate, in pp", () => {
  assert.equal(speechActGapPp(0.9, 0.25), 65);
  assert.equal(Math.round((speechActGapPp(0.9, 0.75) as number) * 10) / 10, 15);
  assert.equal(speechActGapPp(0.5, 0.5), 0);
  assert.equal(speechActGapPp(null, 0.5), null);
  assert.equal(speechActGapPp(0.5, null), null);
});

test("P7.10 exploratory: exact McNemar", () => {
  assert.equal(mcnemarExact(0, 0), 1);
  assert.equal(mcnemarExact(5, 5), 1);
  assert.ok(mcnemarExact(0, 8) < 0.01);
  assert.ok(Math.abs(mcnemarExact(1, 8) - 0.0391) < 0.001);
});

// ---- residual taxonomy -----------------------------------------------------------------

test("P7.10 residuals: declarative failures are split into five kinds, never one bucket", () => {
  assert.deepEqual([...DECLARATIVE_RESIDUALS], ["UNNECESSARY_CONFIRMATION", "INFORMATIONAL_CLOSE", "PRODUCT_REQUESTION", "QUANTITY_REQUESTION", "OTHER"]);
  const residual = (reply: string, calls: FakeTurn["calls"] = [ground("31")]) => analyze("D01", "D", [{ reply, calls }]).residual;
  assert.equal(residual("¿Confirmas las 2 unidades?"), "UNNECESSARY_CONFIRMATION");
  assert.equal(residual("La Classic cuesta $89.990."), "INFORMATIONAL_CLOSE");
  assert.equal(residual("¿Cuál de las dos barras prefieres?"), "PRODUCT_REQUESTION");
  assert.equal(residual("¿Cuántas unidades quieres?"), "QUANTITY_REQUESTION");
  assert.equal(residual("¿A qué comuna despachamos?"), "OTHER");
  assert.equal(residual("¿Necesitas algo más?"), "OTHER");
  assert.equal(residual("Perfecto, dejé dos seleccionadas."), "OTHER", "an unbacked claim is OTHER, not a success");
  assert.equal(residual("No pude guardarlo.", [ground("31"), { capability: "select_products", toolStatus: "blocked", gatewayStatus: "denied" }]), "OTHER", "a Gateway rejection is OTHER");
});

test("P7.10 residuals: a success and a non-actionable / informational turn have no residual", () => {
  assert.equal(analyze("D01", "D", [{ reply: "Listo.", calls: [ground("31"), { capability: "select_products" }], items: [{ productId: "31", quantity: 2 }] }]).residual, null);
  assert.equal(analyze("N01", "N", [{ reply: "¿Cuántas unidades quieres?", calls: [ground("31")] }]).residual, null);
  const notActionable = analyzeSemanticsRun(record("F01", "F", [{ reply: "Depende: la Classic o la Pro." }, { reply: "¿Cuál de las dos?", calls: [ground("31")] }]))[0];
  assert.deepEqual([notActionable.actionable, notActionable.residual], [false, null]);
});

// ---- pre-registered signal (three arms) -----------------------------------------------------

type Spec = { dSelection: number; dConfirmation: number; overMutation?: number; wrongQuantity?: number; wrongProduct?: number; corruption?: number; rejection?: number; dTurns?: number; harnessFailures?: number };
const S0 = "S0_CURRENT_SEMANTICS" as const;
const S1 = "S1_CONSEQUENCE_STATEMENT" as const;
const S2 = "S2_COHERENT_REVERSIBLE_SEMANTICS" as const;
function metrics(variant: typeof S0 | typeof S1 | typeof S2, spec: Spec): SemanticsVariantMetrics {
  const dTurns = spec.dTurns ?? 36;
  const r = (rate: number, denominator = 100) => ratio(Math.round(rate * denominator), denominator);
  const dBlock = { turns: dTurns, selectionRate: r(spec.dSelection, dTurns * 100), durableSelectionRate: r(spec.dSelection, dTurns * 100), unnecessaryConfirmationRate: r(spec.dConfirmation, dTurns * 100) };
  return {
    variant,
    harnessFailures: spec.harnessFailures ?? 0,
    bySpeechAct: { D: dBlock },
    informational: { informationalOverMutationRate: r(spec.overMutation ?? 0) },
    accuracy: { wrongQuantityRate: r(spec.wrongQuantity ?? 0), wrongProductRate: r(spec.wrongProduct ?? 0) },
    quality: { selectionCorruptionRate: r(spec.corruption ?? 0), gatewayRejectionRate: spec.rejection ?? 0 }
  } as unknown as SemanticsVariantMetrics;
}
const signalOf = (a: Spec, b: Spec, c: Spec) => deriveSemanticsSignal(metrics(S0, a), metrics(S1, b), metrics(S2, c));

test("P7.10 signal: thresholds, signal set and the three steps are the pre-registered ones", () => {
  assert.deepEqual({ ...SEMANTICS_THRESHOLDS }, { supportedMinDeltaPp: 20, notCausalMaxDeltaPp: 10, maxSafetyExcessPp: 5, minDTurnsPerVariant: 30 });
  assert.deepEqual([...SEMANTICS_SIGNALS], ["REVERSIBLE_SEMANTICS_SUPPORTED", "CONSEQUENCE_STATEMENT_SUFFICIENT", "DISTRIBUTED_SEMANTIC_CONTRADICTION_SUPPORTED", "SEMANTICS_NOT_CAUSAL", "PARTIAL_SEMANTIC_EFFECT"]);
  assert.deepEqual(SEMANTICS_STEPS.map((step) => [step.step, step.from, step.to]), [["S0_to_S1", S0, S1], ["S1_to_S2", S1, S2], ["S0_to_S2", S0, S2]]);
});

test("P7.10 signal: each step measures (to - from) on D: confirmation drop and selection gain in pp", () => {
  const step = evaluateStep("S1_to_S2", metrics(S1, { dSelection: 0.3, dConfirmation: 0.5 }), metrics(S2, { dSelection: 0.75, dConfirmation: 0.1 }), metrics(S0, { dSelection: 0.25, dConfirmation: 0.6 }));
  assert.ok(Math.abs((step.confirmationDropDPp as number) - 40) < 1e-9 && Math.abs((step.selectionGainDPp as number) - 45) < 1e-9);
  assert.deepEqual([step.reachesSupportMargin, step.belowNotCausalMargin, step.safety.ok], [true, false, true]);
});

test("P7.10 signal: CONSEQUENCE_STATEMENT_SUFFICIENT - S0->S1 already meets the margin and S2 adds nothing material (both < 10 pp)", () => {
  const result = signalOf({ dSelection: 0.25, dConfirmation: 0.6 }, { dSelection: 0.75, dConfirmation: 0.1 }, { dSelection: 0.78, dConfirmation: 0.08 });
  assert.equal(result.signal, "CONSEQUENCE_STATEMENT_SUFFICIENT");
  assert.equal(result.reversibleSemanticsSupported, true, "the umbrella criterion (S0->S2) also holds");
  assert.equal(result.dataSufficient, true);
  // an S2 that is WORSE than S1 still "adds no material improvement"
  assert.equal(signalOf({ dSelection: 0.3, dConfirmation: 0.6 }, { dSelection: 0.6, dConfirmation: 0.3 }, { dSelection: 0.3, dConfirmation: 0.6 }).signal, "CONSEQUENCE_STATEMENT_SUFFICIENT");
});

test("P7.10 signal: DISTRIBUTED_SEMANTIC_CONTRADICTION_SUPPORTED - S0->S1 below the margin, S1->S2 >= 20 pp on both, safety holds", () => {
  const result = signalOf({ dSelection: 0.25, dConfirmation: 0.6 }, { dSelection: 0.35, dConfirmation: 0.5 }, { dSelection: 0.75, dConfirmation: 0.1 });
  assert.equal(result.signal, "DISTRIBUTED_SEMANTIC_CONTRADICTION_SUPPORTED");
  assert.equal(result.steps.S0_to_S1.reachesSupportMargin, false);
  assert.equal(result.steps.S1_to_S2.reachesSupportMargin, true);
  // "S0->S1 < 20 pp" also holds when only ONE of the two S0->S1 outcomes reaches 20 pp
  assert.equal(signalOf({ dSelection: 0.25, dConfirmation: 0.6 }, { dSelection: 0.55, dConfirmation: 0.55 }, { dSelection: 0.85, dConfirmation: 0.1 }).signal, "DISTRIBUTED_SEMANTIC_CONTRADICTION_SUPPORTED");
});

test("P7.10 signal: REVERSIBLE_SEMANTICS_SUPPORTED - S0->S2 reaches the margin without the more specific S1/S2 pattern", () => {
  const result = signalOf({ dSelection: 0.25, dConfirmation: 0.6 }, { dSelection: 0.4, dConfirmation: 0.45 }, { dSelection: 0.55, dConfirmation: 0.35 });
  assert.equal(result.signal, "REVERSIBLE_SEMANTICS_SUPPORTED");
  assert.ok(Math.abs((result.steps.S0_to_S2.selectionGainDPp as number) - 30) < 1e-9 && Math.abs((result.steps.S0_to_S2.confirmationDropDPp as number) - 25) < 1e-9);
  // S1 unsafe but S2 safe: S0->S1 reaches the margin (so it is not the distributed pattern) yet S1 cannot be "sufficient" -> the umbrella label
  assert.equal(signalOf({ dSelection: 0.25, dConfirmation: 0.6 }, { dSelection: 0.75, dConfirmation: 0.1, overMutation: 0.3 }, { dSelection: 0.78, dConfirmation: 0.08 }).signal, "REVERSIBLE_SEMANTICS_SUPPORTED");
});

test("P7.10 signal: SEMANTICS_NOT_CAUSAL - S0->S2 moves both D outcomes < 10 pp", () => {
  assert.equal(signalOf({ dSelection: 0.3, dConfirmation: 0.6 }, { dSelection: 0.32, dConfirmation: 0.58 }, { dSelection: 0.35, dConfirmation: 0.57 }).signal, "SEMANTICS_NOT_CAUSAL");
  assert.equal(signalOf({ dSelection: 0.3, dConfirmation: 0.6 }, { dSelection: 0.25, dConfirmation: 0.65 }, { dSelection: 0.2, dConfirmation: 0.7 }).signal, "SEMANTICS_NOT_CAUSAL", "a worse S2 is not causal support either");
});

test("P7.10 signal: PARTIAL_SEMANTIC_EFFECT - intermediate results, a single outcome moving 20 pp, or no D turns", () => {
  assert.equal(signalOf({ dSelection: 0.25, dConfirmation: 0.6 }, { dSelection: 0.3, dConfirmation: 0.55 }, { dSelection: 0.4, dConfirmation: 0.45 }).signal, "PARTIAL_SEMANTIC_EFFECT");
  assert.equal(signalOf({ dSelection: 0.25, dConfirmation: 0.6 }, { dSelection: 0.3, dConfirmation: 0.58 }, { dSelection: 0.75, dConfirmation: 0.55 }).signal, "PARTIAL_SEMANTIC_EFFECT");
  const noD = deriveSemanticsSignal(metrics(S0, { dSelection: 0, dConfirmation: 0 }), metrics(S1, { dSelection: 0.5, dConfirmation: 0.1 }), { ...metrics(S2, { dSelection: 0, dConfirmation: 0 }), bySpeechAct: { D: { turns: 0, selectionRate: ratio(0, 0), durableSelectionRate: ratio(0, 0), unnecessaryConfirmationRate: ratio(0, 0) } } } as unknown as SemanticsVariantMetrics);
  assert.equal(noD.signal, "PARTIAL_SEMANTIC_EFFECT");
});

test("P7.10 signal: every safety criterion of the S2 arm can veto the support (arm vs S0 + 5 pp; corruption may not increase); exactly +5 pp is still safe", () => {
  const s0: Spec = { dSelection: 0.25, dConfirmation: 0.6 };
  const s1: Spec = { dSelection: 0.4, dConfirmation: 0.45 };
  const good: Spec = { dSelection: 0.75, dConfirmation: 0.1 };
  assert.equal(signalOf(s0, s1, good).signal, "DISTRIBUTED_SEMANTIC_CONTRADICTION_SUPPORTED");
  for (const [name, spec] of [["wrongQuantity", { wrongQuantity: 0.2 }], ["wrongProduct", { wrongProduct: 0.2 }], ["corruption", { corruption: 0.05 }], ["rejection", { rejection: 0.2 }], ["overMutation", { overMutation: 0.2 }]] as const) {
    const result = signalOf(s0, s1, { ...good, ...spec });
    assert.equal(result.signal, "PARTIAL_SEMANTIC_EFFECT", name);
    assert.equal(result.reversibleSemanticsSupported, false, name);
  }
  assert.equal(signalOf(s0, s1, { ...good, overMutation: 0.05, wrongQuantity: 0.05, wrongProduct: 0.05, rejection: 0.05 }).signal, "DISTRIBUTED_SEMANTIC_CONTRADICTION_SUPPORTED");
  assert.equal(evaluateSemanticsSafety(metrics(S2, { ...good, corruption: 0.05 }), metrics(S0, s0)).selectionCorruptionExcessPp, 5);
});

test("P7.10 signal: decided on D only (the pooled aggregate cannot rescue it) and data sufficiency is flagged", () => {
  const a: Spec = { dSelection: 0.25, dConfirmation: 0.6 };
  const b: Spec = { dSelection: 0.35, dConfirmation: 0.5 };
  const c: Spec = { dSelection: 0.75, dConfirmation: 0.1 };
  assert.equal(signalOf({ ...a, dTurns: 12 }, { ...b, dTurns: 12 }, { ...c, dTurns: 12 }).dataSufficient, false);
  assert.equal(signalOf({ ...a, harnessFailures: 1 }, b, c).dataSufficient, false);
  assert.equal(signalOf(a, { ...b, harnessFailures: 2 }, c).dataSufficient, false);
  assert.equal(signalOf(a, b, { ...c, harnessFailures: 1 }).dataSufficient, false);
  assert.equal(signalOf(a, b, c).dataSufficient, true);
});
