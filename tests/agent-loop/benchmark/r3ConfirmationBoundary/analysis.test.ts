import assert from "node:assert/strict";
import test from "node:test";
import { ratio } from "@/lib/brain/commercial/agent-loop/benchmark/r3CapabilityIsolation/isolationAnalysis";
import { deriveReplicationSignal, evaluateReplicationSafety, REPLICATION_THRESHOLDS, type ReplicationVariantMetrics } from "@/lib/brain/commercial/agent-loop/benchmark/r3ConfirmationBoundary/analysis";

/**
 * SALES-AGENT-R3-P7.11. Pure/in-memory: the pre-registered signal rule (section 23) against
 * synthetic metrics - never real trace data (that is run.test.ts's job, DB-backed and offline).
 */

const emptyBlock = () => ({ turns: 0, selectionRate: ratio(0, 0), durableSelectionRate: ratio(0, 0), correctDurableRate: ratio(0, 0), unnecessaryConfirmationRate: ratio(0, 0), missingFactRate: ratio(0, 0), informationalCloseRate: ratio(0, 0), selectRejectedRate: ratio(0, 0), categories: {}, residuals: { UNNECESSARY_CONFIRMATION: 0, INFORMATIONAL_CLOSE: 0, PRODUCT_REQUESTION: 0, QUANTITY_REQUESTION: 0, OTHER: 0 } });

function baseMetrics(variant: ReplicationVariantMetrics["variant"]): ReplicationVariantMetrics {
  return {
    variant,
    runsExecuted: 0,
    harnessFailures: 0,
    turnsAnalyzed: 0,
    contextContaminatedRuns: 0,
    actionable: emptyBlock(),
    byGroup: { A: emptyBlock(), B: emptyBlock(), C: emptyBlock(), D: { ...emptyBlock(), quoteProgressionRate: ratio(0, 0) }, F: emptyBlock() },
    multiTurn: { selectionAfterFactsCompleteRate: ratio(0, 0), confirmationAfterFactsCompleteRate: ratio(0, 0), durableSelectionAfterFactsCompleteRate: ratio(0, 0) },
    informational: { turns: 0, informationalOverMutationRate: ratio(0, 0), anyMutationRate: ratio(0, 0), mutationsByCapability: {}, byScenario: {} },
    accuracy: { selectedTurns: 0, wrongQuantityRate: ratio(0, 0), wrongProductRate: ratio(0, 0) },
    quality: { selectionCorruptionRate: ratio(0, 0), validArgumentsRate: null, gatewayRejectionRate: null, duplicateToolCallRate: null, argumentFailureCalls: ratio(0, 0), providerInvalidResponseCalls: ratio(0, 0), toolCallsPerTurn: null, providerCallsPerTurn: null, terminalReasonDistribution: {} },
    latency: { perCallMs: { p50: null, p90: null, p95: null } },
    tokens: { inputPerTurnMean: null, outputPerTurnMean: null },
    contract: { toolContractCharsMean: null, distinctToolContractSha16: [], distinctPromptSha256: [] },
    failureTaxonomy: { SELECTION_SUCCESS: 0, UNNECESSARY_CONFIRMATION: 0, MISSING_FACT: 0, INFORMATIONAL_CLOSE: 0, WRONG_PRODUCT: 0, WRONG_QUANTITY: 0, OVER_MUTATION: 0, SELECTION_CORRUPTION: 0, GATEWAY_REJECTION: 0, PROVIDER_FAILURE: 0, HARNESS_FAILURE: 0, OTHER: 0, CONTROL_OK: 0 },
    scenarioBreakdown: {}
  };
}

/** A of 36 turns (12 scenarios x 3 runs), selection/confirmation rates as given (n/36). */
function withA(m: ReplicationVariantMetrics, selected: number, unnecessary: number): ReplicationVariantMetrics {
  return { ...m, byGroup: { ...m.byGroup, A: { ...m.byGroup.A, turns: 36, selectionRate: ratio(selected, 36), durableSelectionRate: ratio(selected, 36), unnecessaryConfirmationRate: ratio(unnecessary, 36) } } };
}
function withB(m: ReplicationVariantMetrics, selected: number, unnecessary: number, n = 36): ReplicationVariantMetrics {
  const block = { ...m.byGroup.B, turns: n, selectionRate: ratio(selected, n), durableSelectionRate: ratio(selected, n), unnecessaryConfirmationRate: ratio(unnecessary, n) };
  return { ...m, byGroup: { ...m.byGroup, B: block }, multiTurn: { selectionAfterFactsCompleteRate: block.selectionRate, confirmationAfterFactsCompleteRate: block.unnecessaryConfirmationRate, durableSelectionAfterFactsCompleteRate: block.durableSelectionRate } };
}

test("P7.11 signal: S1_REPLICATED_AND_GENERALIZES when group A meets the support margin safely, group B does not degrade and reaches the generalization margin", () => {
  let r0 = baseMetrics("R0_CURRENT_SEMANTICS");
  let r1 = baseMetrics("R1_CONSEQUENCE_STATEMENT");
  r0 = withA(r0, 7, 25); // 19.4% / 69.4%
  r1 = withA(r1, 24, 7); // 66.7% / 19.4% -> +47.2pp selection, -50pp confirmation: meets 20pp margin
  r0 = withB(r0, 10, 20);
  r1 = withB(r1, 25, 3); // +41.7pp selection after facts, well past the 15pp generalization margin
  const signal = deriveReplicationSignal(r0, r1);
  assert.equal(signal.signal, "S1_REPLICATED_AND_GENERALIZES");
  assert.equal(signal.groupA.reachesSupportMargin, true);
  assert.equal(signal.groupB.reachesGeneralizationMargin, true);
  assert.equal(signal.safety.ok, true);
});

test("P7.11 signal: S1_REPLICATED when group A meets the margin safely but group B neither degrades nor reaches the generalization margin", () => {
  let r0 = baseMetrics("R0_CURRENT_SEMANTICS");
  let r1 = baseMetrics("R1_CONSEQUENCE_STATEMENT");
  r0 = withA(r0, 7, 25);
  r1 = withA(r1, 24, 7);
  r0 = withB(r0, 20, 5);
  r1 = withB(r1, 21, 4); // +2.8pp, well under the 15pp generalization margin, not a degradation either
  const signal = deriveReplicationSignal(r0, r1);
  assert.equal(signal.signal, "S1_REPLICATED");
  assert.equal(signal.groupB.reachesGeneralizationMargin, false);
  assert.equal(signal.groupB.degradedMaterially, false);
});

test("P7.11 signal: group A meets the margin but group B degrades materially -> S1_PARTIAL_REPLICATION (replication does not generalize safely)", () => {
  let r0 = baseMetrics("R0_CURRENT_SEMANTICS");
  let r1 = baseMetrics("R1_CONSEQUENCE_STATEMENT");
  r0 = withA(r0, 7, 25);
  r1 = withA(r1, 24, 7);
  r0 = withB(r0, 30, 2);
  r1 = withB(r1, 15, 2); // -41.7pp: degrades materially (past 10pp)
  const signal = deriveReplicationSignal(r0, r1);
  assert.equal(signal.signal, "S1_PARTIAL_REPLICATION");
  assert.equal(signal.groupB.degradedMaterially, true);
});

test("P7.11 signal: S1_NOT_REPLICATED when group A moves both primaries by less than 10pp", () => {
  let r0 = baseMetrics("R0_CURRENT_SEMANTICS");
  let r1 = baseMetrics("R1_CONSEQUENCE_STATEMENT");
  r0 = withA(r0, 10, 20); // 27.8% / 55.6%
  r1 = withA(r1, 12, 18); // 33.3% / 50.0% -> +5.5pp, -5.6pp: both below 10pp
  const signal = deriveReplicationSignal(r0, r1);
  assert.equal(signal.signal, "S1_NOT_REPLICATED");
  assert.equal(signal.groupA.belowNotCausalMargin, true);
});

test("P7.11 signal: an intermediate group A result (one primary moves, the other does not) is S1_PARTIAL_REPLICATION", () => {
  let r0 = baseMetrics("R0_CURRENT_SEMANTICS");
  let r1 = baseMetrics("R1_CONSEQUENCE_STATEMENT");
  r0 = withA(r0, 10, 20); // 27.8% / 55.6%
  r1 = withA(r1, 24, 19); // 66.7% selection (+38.9pp) but confirmation barely moves (52.8%, -2.8pp)
  const signal = deriveReplicationSignal(r0, r1);
  assert.equal(signal.signal, "S1_PARTIAL_REPLICATION");
  assert.equal(signal.groupA.reachesSupportMargin, false);
  assert.equal(signal.groupA.belowNotCausalMargin, false);
});

test("P7.11 signal: a safety violation (informational over-mutation, wrong quantity/product beyond +5pp, or any selection corruption) demotes an otherwise-replicated result to S1_PARTIAL_REPLICATION", () => {
  let r0 = baseMetrics("R0_CURRENT_SEMANTICS");
  let r1 = baseMetrics("R1_CONSEQUENCE_STATEMENT");
  r0 = withA(r0, 7, 25);
  r1 = withA(r1, 24, 7);
  r0 = { ...r0, quality: { ...r0.quality, selectionCorruptionRate: ratio(0, 138) } };
  r1 = { ...r1, quality: { ...r1.quality, selectionCorruptionRate: ratio(1, 138) } }; // any corruption increase fails safety
  const signal = deriveReplicationSignal(r0, r1);
  assert.equal(signal.safety.ok, false);
  assert.equal(signal.signal, "S1_PARTIAL_REPLICATION");
});

test("P7.11 safety: exactly the four gates (informational over-mutation, wrong quantity, wrong product, corruption) - Gateway rejection is NOT a safety gate (section 20/37: Quote Service BLOCKED is not evidence against R1)", () => {
  const r0 = baseMetrics("R0_CURRENT_SEMANTICS");
  const r1 = { ...baseMetrics("R1_CONSEQUENCE_STATEMENT"), quality: { ...baseMetrics("R1_CONSEQUENCE_STATEMENT").quality, gatewayRejectionRate: 0.9 } };
  assert.equal(evaluateReplicationSafety(r1, r0).ok, true, "a large Gateway rejection excess alone must not fail safety");
});

test("P7.11 signal: not data-sufficient when a variant has a harness failure or group A has fewer than the minimum turns", () => {
  let r0 = baseMetrics("R0_CURRENT_SEMANTICS");
  let r1 = baseMetrics("R1_CONSEQUENCE_STATEMENT");
  r0 = withA(r0, 7, 25);
  r1 = withA(r1, 24, 7);
  assert.equal(deriveReplicationSignal(r0, r1).dataSufficient, true);
  assert.equal(deriveReplicationSignal({ ...r0, harnessFailures: 1 }, r1).dataSufficient, false);
  const fewTurns = { ...r1, byGroup: { ...r1.byGroup, A: { ...r1.byGroup.A, turns: REPLICATION_THRESHOLDS.minATurnsPerVariant - 1 } } };
  assert.equal(deriveReplicationSignal(r0, fewTurns).dataSufficient, false);
});

test("P7.11: thresholds are frozen numbers (never tuned post-batch)", () => {
  assert.deepEqual(REPLICATION_THRESHOLDS, { supportedMinDeltaPp: 20, notCausalMaxDeltaPp: 10, maxSafetyExcessPp: 5, generalizationMinDeltaPp: 15, maxMultiTurnDegradationPp: 10, minATurnsPerVariant: 30 });
});
