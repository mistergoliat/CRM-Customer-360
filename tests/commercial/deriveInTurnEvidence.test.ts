import assert from "node:assert/strict";
import test from "node:test";
import { deriveInTurnEvidenceForInvocation, type PriorToolStepForEvidence } from "@/lib/brain/commercial/capability-eligibility/deriveInTurnEvidence";
import type { CapabilityEligibilityAtTurnStart } from "@/lib/brain/commercial/capability-eligibility/lookupCapabilityEligibility";

// SALES-AGENT-R3-P7.3 (In-turn Relevant Evidence Correlation). Pure unit
// tests for deriveInTurnEvidenceForInvocation - no DB, no HTTP, no LLM. Uses
// only real registry capability names (search_products, select_products,
// set_shipping_destination, create_quote) and real P6 reason codes, never
// invented ones - see docs/R3_COMMERCIAL_AGENT_HANDOFF.md#23.3.

function blocked(reasonCodes: CapabilityEligibilityAtTurnStart["reasonCodes"]): CapabilityEligibilityAtTurnStart {
  return { status: "BLOCKED", reasonCodes, metadataVersion: "p6.2-b.1" };
}

function eligible(): CapabilityEligibilityAtTurnStart {
  return { status: "ELIGIBLE", reasonCodes: [], metadataVersion: "p6.2-b.1" };
}

function step(stepIndex: number, capability: string, observationStatus: PriorToolStepForEvidence["observationStatus"] = "completed"): PriorToolStepForEvidence {
  return { stepIndex, capability, observationStatus };
}

const NO_SIGNAL = { relevantEvidenceProducedThisTurn: [], blockerPotentiallyChangedThisTurn: false, potentiallyAffectedReasonCodes: [] };

test("P7.3-A: MISSING_DESTINATION + prior set_shipping_destination completed -> relevant evidence true", () => {
  const result = deriveInTurnEvidenceForInvocation({
    currentStepIndex: 1,
    eligibilityAtTurnStart: blocked(["MISSING_DESTINATION"]),
    priorToolSteps: [step(0, "set_shipping_destination")]
  });
  assert.deepEqual(result, {
    relevantEvidenceProducedThisTurn: ["COMMERCIAL_DESTINATION_STATE"],
    blockerPotentiallyChangedThisTurn: true,
    potentiallyAffectedReasonCodes: ["MISSING_DESTINATION"]
  });
});

test("P7.3-B: MISSING_DESTINATION + prior select_products completed -> false (unrelated evidence, the 'wrong mutation' case)", () => {
  const result = deriveInTurnEvidenceForInvocation({
    currentStepIndex: 1,
    eligibilityAtTurnStart: blocked(["MISSING_DESTINATION"]),
    priorToolSteps: [step(0, "select_products")]
  });
  assert.deepEqual(result, NO_SIGNAL);
});

test("P7.3-C: MISSING_SELECTION + prior select_products completed -> true", () => {
  const result = deriveInTurnEvidenceForInvocation({
    currentStepIndex: 1,
    eligibilityAtTurnStart: blocked(["MISSING_SELECTION"]),
    priorToolSteps: [step(0, "select_products")]
  });
  assert.deepEqual(result, {
    relevantEvidenceProducedThisTurn: ["COMMERCIAL_SELECTION_STATE"],
    blockerPotentiallyChangedThisTurn: true,
    potentiallyAffectedReasonCodes: ["MISSING_SELECTION"]
  });
});

test("P7.3-D: MISSING_SELECTION + select_products failed -> false", () => {
  const result = deriveInTurnEvidenceForInvocation({
    currentStepIndex: 1,
    eligibilityAtTurnStart: blocked(["MISSING_SELECTION"]),
    priorToolSteps: [step(0, "select_products", "failed")]
  });
  assert.deepEqual(result, NO_SIGNAL);
});

test("P7.3-E: multiple blockers + one relevant evidence -> only the affected reason code is marked", () => {
  const result = deriveInTurnEvidenceForInvocation({
    currentStepIndex: 1,
    eligibilityAtTurnStart: blocked(["MISSING_SELECTION", "MISSING_DESTINATION"]),
    priorToolSteps: [step(0, "select_products")]
  });
  assert.deepEqual(result, {
    relevantEvidenceProducedThisTurn: ["COMMERCIAL_SELECTION_STATE"],
    blockerPotentiallyChangedThisTurn: true,
    potentiallyAffectedReasonCodes: ["MISSING_SELECTION"]
  });
});

test("P7.3-F: ELIGIBLE at turn start -> no signal, regardless of prior tool activity", () => {
  const result = deriveInTurnEvidenceForInvocation({
    currentStepIndex: 1,
    eligibilityAtTurnStart: eligible(),
    priorToolSteps: [step(0, "select_products"), step(0, "set_shipping_destination")]
  });
  assert.deepEqual(result, NO_SIGNAL);
});

test("P7.3-G: eligibility null (no snapshot this turn) -> no signal", () => {
  const result = deriveInTurnEvidenceForInvocation({
    currentStepIndex: 1,
    eligibilityAtTurnStart: null,
    priorToolSteps: [step(0, "select_products")]
  });
  assert.deepEqual(result, NO_SIGNAL);
});

test("P7.3-H: OBJECTIVE_INCOMPATIBLE has no evidence mapping - never a fabricated relation", () => {
  const result = deriveInTurnEvidenceForInvocation({
    currentStepIndex: 1,
    eligibilityAtTurnStart: blocked(["OBJECTIVE_INCOMPATIBLE"]),
    priorToolSteps: [step(0, "select_products"), step(0, "set_shipping_destination"), step(0, "create_quote")]
  });
  assert.deepEqual(result, NO_SIGNAL);
});

test("P7.3-I: IDENTITY_LEVEL_INSUFFICIENT has no evidence mapping - identity is never tool-produced mid-turn", () => {
  const result = deriveInTurnEvidenceForInvocation({
    currentStepIndex: 1,
    eligibilityAtTurnStart: blocked(["IDENTITY_LEVEL_INSUFFICIENT"]),
    priorToolSteps: [step(0, "select_products")]
  });
  assert.deepEqual(result, NO_SIGNAL);
});

test("P7.3-J: same capability requested twice - the second invocation still only sees prior completed steps", () => {
  const firstCall = deriveInTurnEvidenceForInvocation({
    currentStepIndex: 0,
    eligibilityAtTurnStart: blocked(["MISSING_DESTINATION"]),
    priorToolSteps: []
  });
  assert.deepEqual(firstCall, NO_SIGNAL);

  const secondCall = deriveInTurnEvidenceForInvocation({
    currentStepIndex: 2,
    eligibilityAtTurnStart: blocked(["MISSING_DESTINATION"]),
    priorToolSteps: [step(0, "calculate_shipping", "blocked"), step(1, "set_shipping_destination")]
  });
  assert.equal(secondCall.blockerPotentiallyChangedThisTurn, true);
});

test("P7.3-K: the current step never counts itself as prior evidence", () => {
  const result = deriveInTurnEvidenceForInvocation({
    currentStepIndex: 0,
    eligibilityAtTurnStart: blocked(["MISSING_DESTINATION"]),
    priorToolSteps: [step(0, "set_shipping_destination")]
  });
  assert.deepEqual(result, NO_SIGNAL);
});

test("P7.3-L: a later step (stepIndex greater than current) is never counted", () => {
  const result = deriveInTurnEvidenceForInvocation({
    currentStepIndex: 1,
    eligibilityAtTurnStart: blocked(["MISSING_DESTINATION"]),
    priorToolSteps: [step(2, "set_shipping_destination")]
  });
  assert.deepEqual(result, NO_SIGNAL);
});

test("P7.3-M: a pre-Gateway blocked prior call (e.g. duplicate/unregistered) produces no evidence", () => {
  const result = deriveInTurnEvidenceForInvocation({
    currentStepIndex: 1,
    eligibilityAtTurnStart: blocked(["MISSING_SELECTION"]),
    priorToolSteps: [step(0, "select_products", "blocked")]
  });
  assert.deepEqual(result, NO_SIGNAL);
});

test("P7.3-N: a read tool's own registry-declared evidence is honored when it happens to be relevant, but search_products' PRODUCT_IDENTITY never satisfies a selection/destination/quote blocker", () => {
  const result = deriveInTurnEvidenceForInvocation({
    currentStepIndex: 1,
    eligibilityAtTurnStart: blocked(["MISSING_SELECTION"]),
    priorToolSteps: [step(0, "search_products")]
  });
  assert.deepEqual(result, NO_SIGNAL);
});

test("MISSING_QUOTE + prior create_quote completed -> true (get_quote's own prerequisite)", () => {
  const result = deriveInTurnEvidenceForInvocation({
    currentStepIndex: 1,
    eligibilityAtTurnStart: blocked(["MISSING_QUOTE"]),
    priorToolSteps: [step(0, "create_quote")]
  });
  assert.deepEqual(result, {
    relevantEvidenceProducedThisTurn: ["QUOTE_CREATED"],
    blockerPotentiallyChangedThisTurn: true,
    potentiallyAffectedReasonCodes: ["MISSING_QUOTE"]
  });
});

test("no prior tool steps at all -> no signal even when the blocker has a real mapping", () => {
  const result = deriveInTurnEvidenceForInvocation({
    currentStepIndex: 0,
    eligibilityAtTurnStart: blocked(["MISSING_SELECTION"]),
    priorToolSteps: []
  });
  assert.deepEqual(result, NO_SIGNAL);
});
