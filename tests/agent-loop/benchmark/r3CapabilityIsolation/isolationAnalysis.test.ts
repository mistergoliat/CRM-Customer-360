import assert from "node:assert/strict";
import test from "node:test";
import { buildTrueHarnessSystemPrompt } from "@/lib/brain/commercial/agent-loop/benchmark/r3TrueAB/trueHarnessPrompt";
import { SALES_AGENT_CONFIGURATION_SAFE_DEFAULT } from "@/lib/brain/commercial/sales-agent-configuration";
import { buildIsolationCorpus, ISOLATION_ANNOTATION_RESOLVER, ISOLATION_SCENARIOS, turnAnnotations } from "@/lib/brain/commercial/agent-loop/benchmark/r3CapabilityIsolation/isolationCorpus";
import { compareIsolation, computeIsolationVariantMetrics, deriveSignal, evaluatePromotion, ISOLATION_MIN_TURNS_PER_GROUP, ratio, type IsolationVariantMetrics } from "@/lib/brain/commercial/agent-loop/benchmark/r3CapabilityIsolation/isolationAnalysis";
import { ISOLATION_VARIANT_IDS, buildIsolationSurface, type IsolationVariantId } from "@/lib/brain/commercial/agent-loop/benchmark/r3CapabilityIsolation/isolationSurfaces";
import { buildIsolationPlan, interleavedScenarioIds } from "@/lib/brain/commercial/agent-loop/benchmark/r3CapabilityIsolation/runIsolation";

// ---- corpus -------------------------------------------------------------------------------

test("P7.9 corpus: 12 Q-, 12 Q+, 8 negative scenarios with unique ids; each group semantics is declared, never inferred", () => {
  const by = (group: string) => ISOLATION_SCENARIOS.filter((scenario) => scenario.group === group);
  assert.deepEqual([by("Q-").length, by("Q+").length, by("NEG").length], [12, 12, 8]);
  assert.equal(new Set(ISOLATION_SCENARIOS.map((scenario) => scenario.caseId)).size, 32);
  for (const scenario of ISOLATION_SCENARIOS) {
    const annotations = turnAnnotations(scenario);
    assert.equal(annotations.length, scenario.turns.length);
    assert.deepEqual(annotations.slice(0, -1).map((annotation) => annotation.kind), scenario.turns.slice(0, -1).map(() => "other"), `${scenario.caseId}: context turns are not analysed`);
    const last = annotations[annotations.length - 1];
    if (scenario.group === "NEG") assert.equal(last.kind, "informational");
    else assert.deepEqual(last, { kind: "explicit_purchase", statedQuantity: scenario.group === "Q+" ? scenario.expected!.quantity : null });
    assert.equal(ISOLATION_ANNOTATION_RESOLVER.annotationFor(scenario.caseId, scenario.turns.length - 1).kind, last.kind);
  }
  assert.equal(buildIsolationCorpus().length, 32);
});

test("P7.9 corpus: Q- messages carry no quantity, Q+ messages carry the declared quantity, and Q+ declares what was asked", () => {
  const QUANTITY_TOKEN = /\b(\d+|un|una|uno|dos|tres|cuatro|cinco|par)\b|x\d/i;
  const withoutWeight = (text: string) => text.replace(/\d+\s?(kg|kilos?)/gi, "");
  const words: Record<number, RegExp> = { 1: /\b(1|una|un|uno)\b/i, 2: /\b(2|dos)\b|x2/i, 3: /\b3\b/, 4: /\b4\b/, 5: /\b5\b/ };
  for (const scenario of ISOLATION_SCENARIOS) {
    const last = withoutWeight(scenario.turns[scenario.turns.length - 1]);
    if (scenario.group === "Q-") assert.equal(QUANTITY_TOKEN.test(last), false, `${scenario.caseId}: "${last}" states a quantity`);
    if (scenario.group === "Q+") {
      assert.ok(scenario.expected, scenario.caseId);
      assert.ok(words[scenario.expected!.quantity].test(last), `${scenario.caseId}: "${last}" does not state ${scenario.expected!.quantity}`);
    }
  }
});

test("P7.9 corpus: realistic and varied - not all 'quiero X'; follow-ups, quote requests and a selection change are present; nothing copied from the prompt or tool contracts", () => {
  const finalMessages = ISOLATION_SCENARIOS.filter((scenario) => scenario.group !== "NEG").map((scenario) => scenario.turns[scenario.turns.length - 1].toLowerCase());
  assert.ok(finalMessages.filter((message) => message.startsWith("quiero")).length <= 3);
  assert.ok(new Set(finalMessages.map((message) => message.split(/\s+/)[0])).size >= 12, "varied openings");
  assert.ok(ISOLATION_SCENARIOS.filter((scenario) => scenario.turns.length > 1).length >= 5, "follow-ups");
  assert.ok(ISOLATION_SCENARIOS.some((scenario) => /cot[ií]z/i.test(scenario.turns[0])), "quote requests");
  assert.ok(ISOLATION_SCENARIOS.some((scenario) => scenario.seedSelection), "selection change over a durable selection");
  const haystack = [buildTrueHarnessSystemPrompt(SALES_AGENT_CONFIGURATION_SAFE_DEFAULT), ...buildIsolationSurface("B0_CURRENT").tools.map((tool) => tool.description)].join("\n").toLowerCase();
  for (const scenario of ISOLATION_SCENARIOS) for (const turn of scenario.turns) assert.equal(haystack.includes(turn.toLowerCase()), false, turn);
});

// ---- plan -------------------------------------------------------------------------------------

test("P7.9 plan: 32 scenarios x 3 runs x 7 variants = 672; variants interleaved per (scenario, run) group with rotating leader; deterministic", () => {
  const ids = interleavedScenarioIds();
  assert.equal(ids.length, 32);
  assert.deepEqual(ids.slice(0, 6), ["M01", "K01", "I01", "M02", "K02", "I02"]);
  const plan = buildIsolationPlan(ids, 3);
  assert.equal(plan.length, 672);
  assert.deepEqual(plan, buildIsolationPlan(ids, 3));
  for (let index = 0; index < plan.length; index += 7) {
    const group = plan.slice(index, index + 7);
    assert.equal(new Set(group.map((entry) => entry.pairId)).size, 1, "a group is one (scenario, run)");
    assert.equal(new Set(group.map((entry) => entry.variant)).size, 7, "every variant once per group");
  }
  // not "all B0, then all B1, ...": the first 14 runs already show two different leaders
  assert.notEqual(plan[0].variant, plan[7].variant);
  const leaders = plan.filter((entry) => entry.positionInGroup === 0).map((entry) => entry.variant);
  for (const id of ISOLATION_VARIANT_IDS) assert.ok([13, 14].includes(leaders.filter((leader) => leader === id).length), `${id} leads 13 or 14 of 96 groups`);
  assert.equal(plan.filter((entry) => entry.runOrdinal === 0).length, 224, "outer loop is the run ordinal: run 0 completes for all scenarios before run 1 starts");
  assert.equal(plan[223].runOrdinal, 0);
  assert.equal(plan[224].runOrdinal, 1);
});

// ---- promotion rule / signal (fake metrics) ------------------------------------------------------

function fake(variant: IsolationVariantId, over: { qMinusAsk?: [number, number]; qPlusCommit?: [number, number]; overMutation?: [number, number]; argFail?: [number, number]; gatewayRejection?: number; corruption?: [number, number] } = {}): IsolationVariantMetrics {
  const base = computeIsolationVariantMetrics(variant, []);
  const qMinusAsk = over.qMinusAsk ?? [10, 36];
  const qPlusCommit = over.qPlusCommit ?? [18, 36];
  return {
    ...base,
    qMinus: { ...base.qMinus, turns: 36, explicitQuantityRequestRate: ratio(...qMinusAsk) },
    qPlus: { ...base.qPlus, turns: 36, commitRate: ratio(...qPlusCommit) },
    negatives: { ...base.negatives, turns: 24, overMutationRate: ratio(...(over.overMutation ?? [0, 24])) },
    quality: { ...base.quality, gatewayRejectionRate: over.gatewayRejection ?? 0, argumentFailureCalls: ratio(...(over.argFail ?? [0, 100])), selectionCorruptionRate: ratio(...(over.corruption ?? [0, 100])) }
  };
}

test("P7.9 promotion rule: +20pp on Q- explicit request OR Q+ commit, and no safety regression beyond B0 (+5pp mutation/args/Gateway, corruption <= B0)", () => {
  const b0 = fake("B0_CURRENT", { qMinusAsk: [9, 36], qPlusCommit: [18, 36] }); // 25% / 50%
  const exactly20 = evaluatePromotion(fake("B2_NO_USEWHEN", { qMinusAsk: [16, 36] }), b0); // 44.4% => +19.4pp
  assert.equal(exactly20.qMinusPasses, false, "+19.4pp is below the margin");
  const passes = evaluatePromotion(fake("B2_NO_USEWHEN", { qMinusAsk: [17, 36] }), b0); // 47.2% => +22.2pp
  assert.equal(passes.qMinusPasses && passes.candidate && passes.candidateQMinus && !passes.candidateQPlus, true);
  const viaQPlus = evaluatePromotion(fake("B3_NO_DONOTUSEWHEN", { qPlusCommit: [26, 36] }), b0); // 72.2% => +22.2pp
  assert.equal(viaQPlus.candidateQPlus && viaQPlus.candidate && !viaQPlus.candidateQMinus, true);
  const unsafe = evaluatePromotion(fake("B1_THIN_DESCRIPTION", { qMinusAsk: [20, 36], overMutation: [2, 24] }), b0); // +8.3pp over-mutation
  assert.equal(unsafe.effectButUnsafe && !unsafe.candidate, true);
  const atLimit = evaluatePromotion(fake("B1_THIN_DESCRIPTION", { qMinusAsk: [20, 36], argFail: [5, 100] }), b0); // exactly +5pp invalid args: allowed
  assert.equal(atLimit.candidate, true);
  const overLimit = evaluatePromotion(fake("B1_THIN_DESCRIPTION", { qMinusAsk: [20, 36], gatewayRejection: 0.051 }), b0);
  assert.equal(overLimit.candidate, false);
  const corrupt = evaluatePromotion(fake("B1_THIN_DESCRIPTION", { qMinusAsk: [20, 36], corruption: [1, 100] }), b0);
  assert.equal(corrupt.candidate, false, "any selection corruption above B0 disqualifies");
});

test("P7.9 signal mapping (the task's interpretation examples)", () => {
  const sig = (candidates: IsolationVariantId[], b6: { candidate: boolean; effectButUnsafe?: boolean }, dataSufficient = true) => deriveSignal({ candidates: new Set(candidates), positiveControl: { candidate: b6.candidate, effectButUnsafe: b6.effectButUnsafe ?? false }, dataSufficient }).signal;
  assert.equal(sig(["B2_NO_USEWHEN", "B4_THIN_PROSE"], { candidate: true }), "USEWHEN_IS_BOTTLENECK");
  assert.equal(sig(["B3_NO_DONOTUSEWHEN"], { candidate: true }), "DONOTUSEWHEN_IS_BOTTLENECK");
  assert.equal(sig(["B1_THIN_DESCRIPTION"], { candidate: true }), "DESCRIPTION_IS_BOTTLENECK");
  assert.equal(sig(["B5_STRIPPED_SCHEMA_ANNOTATIONS"], { candidate: true }), "SCHEMA_PRESENTATION_IS_BOTTLENECK");
  assert.equal(sig(["B1_THIN_DESCRIPTION", "B2_NO_USEWHEN"], { candidate: true }), "MULTIPLE_FACTORS");
  assert.equal(sig([], { candidate: true }), "COMBINED_CONTRACT_COMPLEXITY_IS_BOTTLENECK");
  assert.equal(sig(["B4_THIN_PROSE"], { candidate: true }), "COMBINED_CONTRACT_COMPLEXITY_IS_BOTTLENECK");
  assert.equal(sig([], { candidate: false }), "CAPABILITY_TAX_NOT_REPLICATED");
  assert.equal(sig([], { candidate: false, effectButUnsafe: true }), "NO_CLEAR_CAUSE");
  assert.equal(sig(["B2_NO_USEWHEN"], { candidate: false }), "NO_CLEAR_CAUSE", "a partial effect without the positive control is inconsistent, not a finding");
  assert.equal(sig(["B2_NO_USEWHEN"], { candidate: true }, false), "NO_CLEAR_CAUSE", "insufficient data never yields a cause");
});

test("P7.9 comparison: denominators, deltas in pp vs B0, replication status, and Q-/Q+ signals are reported separately", () => {
  const metrics = Object.fromEntries(
    ISOLATION_VARIANT_IDS.map((id) => [id, fake(id, id === "B6_FULL_THIN" ? { qMinusAsk: [26, 36], qPlusCommit: [19, 36] } : id === "B2_NO_USEWHEN" ? { qMinusAsk: [25, 36], qPlusCommit: [18, 36] } : { qMinusAsk: [9, 36], qPlusCommit: [18, 36] })])
  ) as Record<IsolationVariantId, IsolationVariantMetrics>;
  const comparison = compareIsolation(metrics);
  assert.equal(comparison.dataQuality.sufficient, true);
  assert.ok(36 >= ISOLATION_MIN_TURNS_PER_GROUP);
  assert.equal(comparison.replication.status, "REPLICATED");
  assert.ok(Math.abs((comparison.deltasVsB0.B6_FULL_THIN.qMinusExplicitQuantityRequestPp as number) - ((26 / 36 - 9 / 36) * 100)) < 1e-9);
  assert.equal(comparison.signals.missingQuantityCognition.signal, "USEWHEN_IS_BOTTLENECK");
  assert.deepEqual(comparison.signals.missingQuantityCognition.candidates.sort(), ["B2_NO_USEWHEN", "B6_FULL_THIN"]);
  assert.equal(comparison.signals.knownQuantityExecution.signal, "CAPABILITY_TAX_NOT_REPLICATED", "Q+ commit did not move: a distinct conclusion from Q-");
  assert.equal(comparison.signals.overall.signal, "USEWHEN_IS_BOTTLENECK");
  assert.match(comparison.denominatorDefinition, /FIXED denominators/);
  const thin = { ...metrics, B6_FULL_THIN: { ...metrics.B6_FULL_THIN, harnessFailures: 1 } };
  assert.equal(compareIsolation(thin).dataQuality.sufficient, false);
  assert.equal(compareIsolation(thin).signals.overall.signal, "NO_CLEAR_CAUSE");
});
