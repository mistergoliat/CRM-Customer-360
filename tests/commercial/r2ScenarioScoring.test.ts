import assert from "node:assert/strict";
import test from "node:test";
import { deriveCommercialWorkMetrics } from "@/lib/brain/commercial/work/evaluateCommercialWork";
import type { CommercialObjective, CommercialWork, CommercialWorkStep } from "@/lib/brain/commercial/work/types";
import type { PersistedCommercialWork } from "@/lib/brain/commercial/work/persistenceTypes";
import { countLostObjectives, isObjectiveDurablyRepresented, scoreR2Scenario } from "@/lib/brain/commercial/work/benchmark/scoring";
import { computeFollowUpCorrectRate, computeR2AggregateMetrics, type R2AggregateMetrics } from "@/lib/brain/commercial/work/benchmark/metrics";
import { computeR2Verdict, type R2ScenarioOutcome } from "@/lib/brain/commercial/work/benchmark/verdict";
import type { CapabilityCallLogEntry, R2ArchitectureScenario, R2ScenarioRunOutcome, R2ScenarioRunResult } from "@/lib/brain/commercial/work/benchmark/types";

/**
 * SALES-AGENT-R2-A07.5, stage 1. Pure unit coverage for the R2 scorer/metrics
 * modules - no DB, no LLM, no real CommercialWork pipeline. Every input here
 * is a hand-built PersistedCommercialWork-shaped fixture.
 */

function objective(overrides: Partial<CommercialObjective> = {}): CommercialObjective {
  return {
    objectiveId: "obj-1",
    type: "SELECT_PRODUCTS",
    status: "COMPLETED",
    origin: "customer_requested",
    inputs: {},
    resolvedInputs: { commercialLineItemsFactId: "fact-1" },
    missingRequirements: [],
    supersedesObjectiveIds: [],
    evidence: [{ kind: "request_fact", factType: "commercial_line_items", id: "fact-1" }],
    blockers: [],
    ...overrides
  };
}

function step(overrides: Partial<CommercialWorkStep> = {}): CommercialWorkStep {
  return {
    stepId: "step-1",
    objectiveIds: ["obj-1"],
    type: "SELECT_PRODUCTS",
    status: "COMPLETED",
    dependencies: [],
    capabilityName: "select_products",
    input: {},
    evidence: [{ kind: "request_fact", factType: "commercial_line_items", id: "fact-1" }],
    blockers: [],
    retryable: false,
    retryCandidate: false,
    idempotencyKey: "idem-1",
    attemptCount: 1,
    maxAttempts: 2,
    nextAttemptAt: null,
    startedAt: null,
    lastAttemptAt: null,
    lockOwner: null,
    lockUntil: null,
    ...overrides
  };
}

function work(overrides: Partial<CommercialWork> = {}): PersistedCommercialWork {
  const objectives = overrides.objectives ?? [objective()];
  const steps = overrides.steps ?? [step()];
  const blockers = overrides.blockers ?? [];
  const base: CommercialWork = {
    id: "projection:1:1",
    projectionVersion: 1,
    opportunityId: 1,
    conversationId: 1,
    sourceMessageId: 1,
    sourceSequence: null,
    lastReconciledSequence: null,
    previousWorkPublicId: null,
    supersedesWorkPublicId: null,
    trigger: { type: "CUSTOMER_MESSAGE", conversationId: 1, opportunityId: 1, sourceMessageId: 1 },
    status: "COMPLETED",
    objectives,
    steps,
    blockers,
    derivedAt: "2026-08-17T12:00:00.000Z",
    metrics: deriveCommercialWorkMetrics({ objectives, steps, blockers }),
    ...overrides
  };
  return {
    ...base,
    publicId: "cw-1",
    correlationKey: "corr-1",
    version: 1,
    createdAt: base.derivedAt,
    updatedAt: base.derivedAt,
    completedAt: base.status === "COMPLETED" ? base.derivedAt : null,
    cancelledAt: null,
    cancelReason: null
  };
}

function call(overrides: Partial<CapabilityCallLogEntry> = {}): CapabilityCallLogEntry {
  return { capabilityName: "select_products", status: "completed", stepId: "step-1", objectiveIds: ["obj-1"], injectedFault: null, atIso: "2026-08-17T12:00:00.000Z", ...overrides };
}

function scenario(overrides: Partial<R2ArchitectureScenario> = {}): R2ArchitectureScenario {
  return {
    scenarioId: "R2-TEST",
    description: "test",
    customerTurns: [{ customerMessage: "quiero 2 de la classic" }],
    expected: {
      objectives: [{ type: "SELECT_PRODUCTS", status: "COMPLETED" }],
      workStatus: "COMPLETED",
      stepStatuses: [{ type: "SELECT_PRODUCTS", status: "COMPLETED" }],
      durableFacts: { commercialLineItems: [{ productId: "31", quantity: 2 }] },
      customerVisibleOutcome: "correct",
      retryExpected: false,
      followUpExpected: false,
      handoffExpected: false
    },
    ...overrides
  };
}

function outcome(finalWork: PersistedCommercialWork, overrides: Partial<R2ScenarioRunOutcome> = {}): R2ScenarioRunOutcome {
  return {
    scenarioId: "R2-TEST",
    runIndex: 0,
    blocked: null,
    finalWork,
    capabilityCalls: [call()],
    llmCallCount: 1,
    turnLatencyMs: 500,
    commercialCompletionLatencyMs: 500,
    followUpScheduled: false,
    followUpSent: false,
    followUpCancelled: false,
    handoffOccurred: false,
    retryOccurred: false,
    restartRecoveryOccurred: false,
    runFailureClassification: null,
    ...overrides
  };
}

test("isObjectiveDurablyRepresented: COMPLETED/CANCELLED/SUPERSEDED/WAITING_* are safe, bare READY/PENDING is not", () => {
  const safe = ["COMPLETED", "CANCELLED", "SUPERSEDED", "WAITING_CUSTOMER", "WAITING_SYSTEM"] as const;
  for (const status of safe) {
    assert.equal(isObjectiveDurablyRepresented(objective({ status }), work({ status: "ACTIVE" })), true, status);
  }
  assert.equal(isObjectiveDurablyRepresented(objective({ status: "READY" }), work({ status: "ACTIVE" })), false);
  assert.equal(isObjectiveDurablyRepresented(objective({ status: "PENDING" }), work({ status: "ACTIVE" })), false);
});

test("isObjectiveDurablyRepresented: HANDOFF work covers every objective, RETRY_SCHEDULED step covers its own objective", () => {
  const readyObjective = objective({ status: "READY" });
  assert.equal(isObjectiveDurablyRepresented(readyObjective, work({ status: "HANDOFF", objectives: [readyObjective] })), true);

  const retryStep = step({ status: "RETRY_SCHEDULED" });
  assert.equal(isObjectiveDurablyRepresented(readyObjective, work({ status: "WAITING_SYSTEM", objectives: [readyObjective], steps: [retryStep] })), true);

  // FAILED is deliberately not a safe status - retry-exhausted-with-no-handoff is real lost work.
  assert.equal(isObjectiveDurablyRepresented(objective({ status: "FAILED" }), work({ status: "FAILED" })), false);
});

test("countLostObjectives: the T08/T09 regression shape (selection done, shipping silently abandoned) is lost work", () => {
  const done = objective({ objectiveId: "obj-select", type: "SELECT_PRODUCTS", status: "COMPLETED" });
  const abandoned = objective({ objectiveId: "obj-ship", type: "GET_SHIPPING_QUOTE", status: "READY" });
  const result = countLostObjectives(work({ status: "ACTIVE", objectives: [done, abandoned], steps: [step()] }));
  assert.deepEqual(result, { lost: 1, total: 2 });
});

test("scoreR2Scenario: fully completed work passes and reports zero lost objectives", () => {
  const score = scoreR2Scenario(scenario(), outcome(work()));
  assert.equal(score.overallPass, true);
  assert.equal(score.lostObjectiveCount, 0);
  assert.equal(score.customerVisibleOutcome, "correct");
});

test("scoreR2Scenario: a blocked (BLOCKED_BY_A07_DB_VALIDATION) run never reports PASS", () => {
  const score = scoreR2Scenario(scenario(), outcome(work(), { blocked: "BLOCKED_BY_A07_DB_VALIDATION", finalWork: null }));
  assert.equal(score.blocked, true);
  assert.equal(score.overallPass, false);
});

test("scoreR2Scenario: duplicate real capability calls for the same step are flagged and fail the run", () => {
  const calls = [call(), call()];
  const score = scoreR2Scenario(scenario(), outcome(work(), { capabilityCalls: calls }));
  assert.equal(score.duplicateSideEffect, true);
  assert.equal(score.overallPass, false);
});

test("scoreR2Scenario: a duplicate call where one side is an injected fault is not a real duplicate", () => {
  const calls = [call({ status: "temporarily_blocked", injectedFault: "temporarily_blocked" }), call()];
  const score = scoreR2Scenario(scenario(), outcome(work(), { capabilityCalls: calls }));
  assert.equal(score.duplicateSideEffect, false);
});

test("scoreR2Scenario: a COMPLETED step with no evidence is an unbacked mutation claim and a safety failure", () => {
  const unbackedStep = step({ evidence: [] });
  const badWork = work({ steps: [unbackedStep] });
  const score = scoreR2Scenario(scenario(), outcome(badWork));
  assert.equal(score.unbackedMutationClaim, true);
  assert.equal(score.safetyFailure, true);
  assert.equal(score.customerVisibleOutcome, "unacceptable");
});

test("scoreR2Scenario: a capability invoked against a step still carrying STALE_EVIDENCE is flagged", () => {
  const staleStep = step({ blockers: [{ code: "STALE_EVIDENCE", source: "step", stepId: "step-1" }] });
  const score = scoreR2Scenario(scenario(), outcome(work({ steps: [staleStep] })));
  assert.equal(score.staleEvidenceExecuted, true);
});

test("scoreR2Scenario: objective/step status expectations accept an array as an explicit either/or (R2-02 acceptable A/B)", () => {
  const scen = scenario({
    expected: {
      ...scenario().expected,
      objectives: [{ type: "SELECT_PRODUCTS", status: ["COMPLETED", "WAITING_SYSTEM"] }],
      workStatus: ["COMPLETED", "WAITING_SYSTEM"],
      stepStatuses: [{ type: "SELECT_PRODUCTS", status: ["COMPLETED", "WAITING_SYSTEM"] }]
    }
  });
  const waitingWork = work({ status: "WAITING_SYSTEM", objectives: [objective({ status: "WAITING_SYSTEM" })], steps: [step({ status: "WAITING_SYSTEM", evidence: [] })] });
  const score = scoreR2Scenario(scen, outcome(waitingWork, { capabilityCalls: [] }));
  assert.equal(score.workGraphCorrect, true);
  assert.equal(score.objectiveDetectionCorrect, true);
});

test("computeR2AggregateMetrics: lostCommercialWorkRate is null with no runs and 0 when every run is clean", () => {
  const empty = computeR2AggregateMetrics([]);
  assert.equal(empty.architecture.lostCommercialWorkRate, null);

  const clean: R2ScenarioRunResult[] = [1, 2].map((index) => {
    const w = work();
    const o = outcome(w, { runIndex: index });
    return { scenario: scenario(), outcome: o, score: scoreR2Scenario(scenario(), o) };
  });
  const metrics = computeR2AggregateMetrics(clean);
  assert.equal(metrics.architecture.lostCommercialWorkRate, 0);
  assert.equal(metrics.architecture.duplicateSideEffectRate, 0);
  assert.equal(metrics.architecture.unbackedCommercialMutationClaimRate, 0);
  assert.equal(metrics.architecture.staleEvidenceExecutionRate, 0);
});

test("computeR2AggregateMetrics: one lost objective among three total objectives across two runs is a 1/3 rate", () => {
  const cleanWork = work();
  const cleanOutcome = outcome(cleanWork, { runIndex: 0 });
  const lossyWork = work({
    status: "ACTIVE",
    objectives: [objective({ status: "COMPLETED" }), objective({ objectiveId: "obj-2", type: "GET_SHIPPING_QUOTE", status: "READY" })],
    steps: [step()]
  });
  const lossyOutcome = outcome(lossyWork, { runIndex: 1 });
  const results: R2ScenarioRunResult[] = [
    { scenario: scenario(), outcome: cleanOutcome, score: scoreR2Scenario(scenario(), cleanOutcome) },
    { scenario: scenario(), outcome: lossyOutcome, score: scoreR2Scenario(scenario(), lossyOutcome) }
  ];
  const metrics = computeR2AggregateMetrics(results);
  assert.equal(metrics.architecture.lostCommercialWorkRate, 1 / 3);
});

test("computeFollowUpCorrectRate: null when no scenario in the batch scheduled a follow-up", () => {
  const w = work();
  const o = outcome(w);
  const results: R2ScenarioRunResult[] = [{ scenario: scenario(), outcome: o, score: scoreR2Scenario(scenario(), o) }];
  assert.equal(computeFollowUpCorrectRate(results), null);
});

const CORE_SCENARIO_IDS = ["R2-01", "R2-02", "R2-03", "R2-04", "R2-05", "R2-06", "R2-07", "R2-08", "R2-09", "R2-12"];

function allOutcomes(overrides: Record<string, R2ScenarioOutcome> = {}): Record<string, R2ScenarioOutcome> {
  const outcomes: Record<string, R2ScenarioOutcome> = {};
  for (const id of CORE_SCENARIO_IDS) outcomes[id] = "PASS";
  outcomes["R2-10"] = "PASS";
  outcomes["R2-11"] = "PASS";
  return { ...outcomes, ...overrides };
}

function cleanMetrics(): R2AggregateMetrics {
  const zeroRates = {
    objectiveDetectionCorrectRate: 1,
    requirementResolutionCorrectRate: 1,
    requiredObjectiveCompletionRate: 1,
    workGraphCorrectRate: 1,
    durableRemainingWorkCorrectRate: 1,
    lostCommercialWorkRate: 0,
    duplicateSideEffectRate: 0,
    unbackedCommercialMutationClaimRate: 0,
    staleEvidenceExecutionRate: 0,
    retryRecoveryRate: 1,
    restartRecoveryRate: 1
  };
  return {
    totalRuns: CORE_SCENARIO_IDS.length,
    scoredRuns: CORE_SCENARIO_IDS.length,
    blockedRuns: 0,
    architecture: zeroRates,
    customerVisible: { customerReaskRate: 0, customerVisibleCorrectRate: 1, safetyFailureRate: 0 },
    efficiency: {
      llmCallsPerTurnAvg: 1,
      llmCallsPerCompletedObjectiveAvg: 1,
      capabilityExecutionsPerTurnAvg: 1,
      turnLatencyMsP50: 100,
      turnLatencyMsP95: 100,
      commercialCompletionLatencyMsP50: 100,
      commercialCompletionLatencyMsP95: 100
    }
  };
}

test("computeR2Verdict: R2_CORE_VALIDATED when every gate holds and A07 DB scenarios pass", () => {
  const result = computeR2Verdict({ scenarioOutcomes: allOutcomes(), metrics: cleanMetrics() });
  assert.equal(result.verdict, "R2_CORE_VALIDATED");
  assert.equal(result.gates.every((gate) => gate.passed), true);
});

test("computeR2Verdict: R2_CORE_VALIDATED_A07_DB_PENDING when the core gate holds but R2-10/R2-11 are blocked", () => {
  const result = computeR2Verdict({
    scenarioOutcomes: allOutcomes({ "R2-10": "BLOCKED_BY_A07_DB_VALIDATION", "R2-11": "BLOCKED_BY_A07_DB_VALIDATION" }),
    metrics: cleanMetrics()
  });
  assert.equal(result.verdict, "R2_CORE_VALIDATED_A07_DB_PENDING");
});

test("computeR2Verdict: a nonzero lostCommercialWorkRate alone prevents R2_CORE_VALIDATED even if every scenario passed", () => {
  const dirtyMetrics = { ...cleanMetrics(), architecture: { ...cleanMetrics().architecture, lostCommercialWorkRate: 0.1 } };
  const result = computeR2Verdict({ scenarioOutcomes: allOutcomes(), metrics: dirtyMetrics });
  assert.notEqual(result.verdict, "R2_CORE_VALIDATED");
  assert.equal(result.gates.find((gate) => gate.criterion.startsWith("lostCommercialWorkRate"))?.passed, false);
});

test("computeR2Verdict: R2_ARCHITECTURE_NOT_VALIDATED when every gate fails", () => {
  const failing: Record<string, R2ScenarioOutcome> = {};
  for (const id of CORE_SCENARIO_IDS) failing[id] = "FAIL";
  const dirtyMetrics: R2AggregateMetrics = {
    ...cleanMetrics(),
    architecture: { ...cleanMetrics().architecture, lostCommercialWorkRate: 1, unbackedCommercialMutationClaimRate: 1, duplicateSideEffectRate: 1, staleEvidenceExecutionRate: 1 }
  };
  const result = computeR2Verdict({ scenarioOutcomes: allOutcomes(failing), metrics: dirtyMetrics });
  assert.equal(result.verdict, "R2_ARCHITECTURE_NOT_VALIDATED");
});
