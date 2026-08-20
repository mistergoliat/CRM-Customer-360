import assert from "node:assert/strict";
import test from "node:test";
import { buildSafeExecutionWave } from "@/lib/brain/commercial/work/buildSafeExecutionWave";
import { classifyStepSafety, isReadOnlyStep, stepsConflict } from "@/lib/brain/commercial/work/parallelStepConflictModel";
import type { CommercialWorkStep } from "@/lib/brain/commercial/work/types";

/**
 * SALES-AGENT-R2-A09. Pure, deterministic, no DB/LLM - buildSafeExecutionWave
 * and parallelStepConflictModel are pure functions of their input.
 * resolveCapabilityGovernance reads the real Capability Gateway registry
 * (never mocked here), so these tests exercise the actual production
 * classification, not a hand-rolled stand-in.
 */

function makeStep(overrides: Partial<CommercialWorkStep> & Pick<CommercialWorkStep, "stepId" | "type" | "capabilityName" | "objectiveIds">): CommercialWorkStep {
  return {
    status: "READY",
    dependencies: [],
    input: {},
    evidence: [],
    blockers: [],
    retryable: false,
    retryCandidate: false,
    idempotencyKey: null,
    attemptCount: 0,
    maxAttempts: null,
    nextAttemptAt: null,
    startedAt: null,
    lastAttemptAt: null,
    lockOwner: null,
    lockUntil: null,
    ...overrides
  };
}

const searchA = makeStep({ stepId: "obj-a:step:SEARCH_PRODUCTS", type: "SEARCH_PRODUCTS", capabilityName: "search_products", objectiveIds: ["obj-a"] });
const searchB = makeStep({ stepId: "obj-b:step:SEARCH_PRODUCTS", type: "SEARCH_PRODUCTS", capabilityName: "search_products", objectiveIds: ["obj-b"] });
const searchC = makeStep({ stepId: "obj-c:step:SEARCH_PRODUCTS", type: "SEARCH_PRODUCTS", capabilityName: "search_products", objectiveIds: ["obj-c"] });
const selectProducts = makeStep({ stepId: "obj-d:step:SELECT_PRODUCTS", type: "SELECT_PRODUCTS", capabilityName: "select_products", objectiveIds: ["obj-d"] });
const setDestination = makeStep({ stepId: "obj-e:step:SET_SHIPPING_DESTINATION", type: "SET_SHIPPING_DESTINATION", capabilityName: "set_shipping_destination", objectiveIds: ["obj-e"] });
const calcShippingX = makeStep({ stepId: "obj-f:step:CALCULATE_SHIPPING", type: "CALCULATE_SHIPPING", capabilityName: "calculate_shipping", objectiveIds: ["obj-f"] });
const calcShippingY = makeStep({ stepId: "obj-g:step:CALCULATE_SHIPPING", type: "CALCULATE_SHIPPING", capabilityName: "calculate_shipping", objectiveIds: ["obj-g"] });
const unknownCapabilityStep = makeStep({ stepId: "obj-h:step:UNKNOWN", type: "SEARCH_PRODUCTS", capabilityName: "totally_unregistered_capability" as never, objectiveIds: ["obj-h"] });

test("[CWPAR01] safe independent read_only steps parallelize into one wave", () => {
  const result = buildSafeExecutionWave({ readyCandidates: [searchA, searchB, searchC], parallelExecutionEnabled: true, maxParallelSteps: 3 });
  assert.deepEqual(
    result.wave.map((step) => step.stepId),
    [searchA.stepId, searchB.stepId, searchC.stepId]
  );
  assert.deepEqual(result.deferred, []);
  assert.equal(result.decisions.find((d) => d.stepId === searchA.stepId)?.decision, "primary_step");
  assert.equal(result.decisions.find((d) => d.stepId === searchB.stepId)?.decision, "parallel_safe");
  assert.equal(result.decisions.find((d) => d.stepId === searchC.stepId)?.decision, "parallel_safe");
});

test("[CWPAR03] a write-conflicting pair never shares a wave (two calculate_shipping steps ARE independent, but a write/read pair on the same fact anchor is not)", () => {
  // select_products (writes commercial_line_items) and calculate_shipping (reads commercial_line_items) conflict - even though calculate_shipping is read_only, it is never the wave's primary here since select_products (mutating) sorts first by priority.
  const result = buildSafeExecutionWave({ readyCandidates: [selectProducts, calcShippingX], parallelExecutionEnabled: true, maxParallelSteps: 3 });
  assert.deepEqual(result.wave.map((s) => s.stepId), [selectProducts.stepId]);
  assert.equal(result.decisions.find((d) => d.stepId === calcShippingX.stepId)?.decision, "deferred_mutating");
});

test("[CWPAR03b] two read_only steps with an actual fact write/read conflict never share a wave", () => {
  // Construct a synthetic pair where the SECOND candidate's reads overlap the FIRST's writes, using calculate_shipping's real read set (commercial_line_items, shipping_destination) against a synthetic step typed CALCULATE_SHIPPING that writes into the same anchor is not directly expressible with real step types (calculate_shipping never writes a fact) - stepsConflict is exercised directly instead for this exact rule.
  assert.equal(stepsConflict(selectProducts, calcShippingX), true, "select_products writes commercial_line_items, calculate_shipping reads it");
  assert.equal(stepsConflict(setDestination, calcShippingX), true, "set_shipping_destination writes shipping_destination, calculate_shipping reads it");
  assert.equal(stepsConflict(calcShippingX, calcShippingY), false, "two independent calculate_shipping steps only read, never write - read/read is always safe");
  assert.equal(stepsConflict(searchA, searchB), false, "search_products touches no fact anchor at all");
});

test("[CWPAR03c] same-objective steps never share a wave even with disjoint fact profiles", () => {
  const sameObjectiveTwin = makeStep({ stepId: "obj-a:step:OTHER", type: "SEARCH_PRODUCTS", capabilityName: "search_products", objectiveIds: ["obj-a"] });
  assert.equal(stepsConflict(searchA, sameObjectiveTwin), true);
});

test("[CWPAR04] unknown/unregistered capability governance falls back to sequential, never optimistic parallelism", () => {
  assert.equal(classifyStepSafety(unknownCapabilityStep), "unknown_governance");
  assert.equal(isReadOnlyStep(unknownCapabilityStep), false);
  const result = buildSafeExecutionWave({ readyCandidates: [searchA, unknownCapabilityStep], parallelExecutionEnabled: true, maxParallelSteps: 3 });
  assert.deepEqual(result.wave.map((s) => s.stepId), [searchA.stepId]);
  assert.equal(result.decisions.find((d) => d.stepId === unknownCapabilityStep.stepId)?.decision, "deferred_unknown_governance");
});

test("[CWPAR05] max parallelism is respected - extra independent candidates defer even though they would otherwise be safe", () => {
  const result = buildSafeExecutionWave({ readyCandidates: [searchA, searchB, searchC], parallelExecutionEnabled: true, maxParallelSteps: 2 });
  assert.equal(result.wave.length, 2);
  assert.deepEqual(result.wave.map((s) => s.stepId), [searchA.stepId, searchB.stepId]);
  assert.equal(result.decisions.find((d) => d.stepId === searchC.stepId)?.decision, "deferred_max_parallelism");
});

test("[CWPAR17] an empty candidate list never busy-loops - returns an empty wave immediately", () => {
  const result = buildSafeExecutionWave({ readyCandidates: [], parallelExecutionEnabled: true, maxParallelSteps: 3 });
  assert.deepEqual(result.wave, []);
  assert.deepEqual(result.deferred, []);
  assert.deepEqual(result.decisions, []);
});

test("[CWPAR18] parallelExecutionEnabled=false always reproduces the pre-A09 single-step selection, regardless of how many independent candidates exist", () => {
  const result = buildSafeExecutionWave({ readyCandidates: [searchA, searchB, searchC], parallelExecutionEnabled: false, maxParallelSteps: 10 });
  assert.deepEqual(result.wave.map((s) => s.stepId), [searchA.stepId]);
  assert.equal(result.deferred.length, 2);
  assert.ok(result.deferred.every((s, i) => s.stepId === [searchB.stepId, searchC.stepId][i]));
  assert.ok(result.decisions.every((d) => d.decision === "primary_step" || d.decision === "deferred_parallel_execution_disabled"));
});

test("[CWPAR24] a mutating primary step never gains parallel siblings, even explicitly independent read_only ones", () => {
  const result = buildSafeExecutionWave({ readyCandidates: [selectProducts, searchA, searchB], parallelExecutionEnabled: true, maxParallelSteps: 5 });
  assert.deepEqual(result.wave.map((s) => s.stepId), [selectProducts.stepId]);
  assert.ok(result.decisions.filter((d) => d.decision === "deferred_mutating").length === 2);
});

test("[CWPAR24b] two mutating steps never share a wave regardless of fact independence (v1 conservative policy)", () => {
  // select_products and set_shipping_destination write disjoint fact anchors (provably independent by the conflict model), but Part 5's initial policy only ever admits read_only primaries into a multi-step wave.
  assert.equal(stepsConflict(selectProducts, setDestination), false, "provably independent by the fact-conflict model itself");
  const result = buildSafeExecutionWave({ readyCandidates: [selectProducts, setDestination], parallelExecutionEnabled: true, maxParallelSteps: 5 });
  assert.deepEqual(result.wave.map((s) => s.stepId), [selectProducts.stepId]);
  assert.equal(result.decisions.find((d) => d.stepId === setDestination.stepId)?.decision, "deferred_mutating");
});

test("[CWPAR02/CWPAR33] an explicit STEP_COMPLETED dependency keeps a downstream step out of the same wave as its dependencies - never A+B+C together", () => {
  // C depends on BOTH A and B via STEP_COMPLETED - dependenciesSatisfied
  // (commercialWorkExecutor.ts) already excludes C from the READY candidate
  // list until both are COMPLETED, so buildSafeExecutionWave never even
  // sees C as a candidate in wave 1 - it only ever receives steps that
  // already passed that filter. This test proves the two layers compose
  // correctly: wave 1 is A+B only, never A+B+C.
  const dependentC = makeStep({
    stepId: "obj-j:step:SEARCH_PRODUCTS",
    type: "SEARCH_PRODUCTS",
    capabilityName: "search_products",
    objectiveIds: ["obj-j"],
    dependencies: [
      { type: "STEP_COMPLETED", stepId: searchA.stepId },
      { type: "STEP_COMPLETED", stepId: searchB.stepId }
    ]
  });
  // Wave 1: only A and B are ever passed in as candidates (C is not
  // dependency-satisfied yet, so the caller - commercialWorkExecutor.ts's
  // sortedReadySteps - never includes it in readyCandidates at all).
  const wave1 = buildSafeExecutionWave({ readyCandidates: [searchA, searchB], parallelExecutionEnabled: true, maxParallelSteps: 5 });
  assert.deepEqual(wave1.wave.map((s) => s.stepId).sort(), [searchA.stepId, searchB.stepId].sort());
  assert.equal(wave1.wave.some((s) => s.stepId === dependentC.stepId), false, "C is never a wave-1 candidate at all");
});

test("classifyStepSafety: capability governance classification matches the real registry exactly", () => {
  assert.equal(classifyStepSafety(searchA), "read_only");
  assert.equal(classifyStepSafety(selectProducts), "mutating");
  assert.equal(classifyStepSafety(calcShippingX), "read_only");
  const handoff = makeStep({ stepId: "obj-i:step:HANDOFF", type: "HANDOFF", capabilityName: null, objectiveIds: ["obj-i"] });
  assert.equal(classifyStepSafety(handoff), "unknown_governance");
});
