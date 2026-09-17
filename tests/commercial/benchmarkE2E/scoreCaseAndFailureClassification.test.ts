import assert from "node:assert/strict";
import test from "node:test";
import { caseOutcomePassed, scoreCase } from "@/lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/scoreCase";
import { classifyFailure } from "@/lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/failureClassification";
import type { BenchmarkE2ECase, BenchmarkE2EDurableStateSnapshot, BenchmarkE2ETurnTrace } from "@/lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/types";

// SALES-AGENT-R3-P7.4 (P7.4-I..L). Pure unit tests - no DB, no HTTP, no LLM.

function state(overrides: Partial<BenchmarkE2EDurableStateSnapshot> = {}): BenchmarkE2EDurableStateSnapshot {
  return {
    capturedAt: "t",
    workId: "cw-1",
    workVersion: 1,
    workStatus: "OPEN",
    objectiveType: null,
    objectiveStatus: null,
    selection: { present: false, freshness: null, itemCount: null },
    destination: { present: false, freshness: null, communeId: null },
    shipping: { present: false, freshness: null },
    quote: { present: false, freshness: null, quoteId: null, quoteStatus: null },
    identityLevel: null,
    ...overrides
  };
}

function turn(overrides: Partial<BenchmarkE2ETurnTrace> = {}): BenchmarkE2ETurnTrace {
  return {
    turnOrdinal: 0,
    inboundMessageId: "inbound-1",
    correlationId: "corr-1",
    customerMessage: "hola",
    durableStateBeforeTurn: null,
    kernel: null,
    toolInvocations: [],
    proposal: null,
    objectiveReconciliation: { decided: null, reconciled: null },
    eligibilityShadow: null,
    response: { status: "responded", terminalReason: "responded", finalMessage: "Listo.", handoffReason: null, toolExecutionCount: 0 },
    runtimeWarnings: [],
    outbox: { attempted: true, outboxWritten: true, outboxId: 1, status: "queued", messageTextPresent: true },
    durableStateAfterTurn: null,
    providerCalls: [],
    ...overrides
  };
}

function baseCase(overrides: Partial<BenchmarkE2ECase> = {}): BenchmarkE2ECase {
  return {
    caseId: "T01",
    description: "test case",
    notes: "",
    identityLevel: "LEVEL_0_ANONYMOUS",
    turns: [{ customerMessage: "hola", offlineScript: [] }],
    expected: {},
    forbidden: {},
    ...overrides
  };
}

test("P7.4-I: environment-blocked dependency errors are never classified as model reasoning", () => {
  const testCase = baseCase({ expected: { quoteExists: true } });
  const invokedTurn = turn({
    toolInvocations: [
      {
        stepIndex: 0,
        capability: "create_quote",
        workId: null,
        workVersion: null,
        objectiveId: null,
        objectiveType: "QUOTE",
        eligibilityAtTurnStart: null,
        gateway: { status: "unavailable", errorCode: "quote_service_not_configured", retryable: false },
        toolObservation: { status: "failed", errorCode: "quote_service_not_configured", retryable: false },
        inTurnEvidence: { relevantEvidenceProduced: [], blockerPotentiallyChanged: false, potentiallyAffectedReasonCodes: [] }
      }
    ]
  });
  const outcome = scoreCase(testCase, [invokedTurn], state());
  assert.equal(caseOutcomePassed(outcome), false);
  const classification = classifyFailure(testCase, [invokedTurn], outcome);
  assert.equal(classification.category, "DEPENDENCY_FAILURE");
});

test("P7.4-J: known-fact re-question is detected structurally and classified as STATE_CONTINUITY", () => {
  const testCase = baseCase({ forbidden: { repeatKnownDestination: true } });
  const before = state({ destination: { present: true, freshness: "CURRENT", communeId: 100 } });
  const invokedTurn = turn({
    durableStateBeforeTurn: before,
    toolInvocations: [
      {
        stepIndex: 0,
        capability: "set_shipping_destination",
        workId: null,
        workVersion: null,
        objectiveId: null,
        objectiveType: null,
        eligibilityAtTurnStart: null,
        gateway: { status: "completed", errorCode: null, retryable: false },
        toolObservation: { status: "completed", errorCode: null, retryable: null },
        inTurnEvidence: { relevantEvidenceProduced: [], blockerPotentiallyChanged: false, potentiallyAffectedReasonCodes: [] }
      }
    ]
  });
  const outcome = scoreCase(testCase, [invokedTurn], state());
  assert.deepEqual(outcome.forbiddenViolations, ["repeatKnownDestination"]);
  assert.equal(caseOutcomePassed(outcome), false);
  const classification = classifyFailure(testCase, [invokedTurn], outcome);
  assert.equal(classification.category, "STATE_CONTINUITY");
});

test("P7.4-J: re-invoking a mutation is NOT flagged when the case never opted into that forbidden check (e.g. a legitimate replace-selection case)", () => {
  const testCase = baseCase({ forbidden: {} });
  const before = state({ destination: { present: true, freshness: "CURRENT", communeId: 100 } });
  const invokedTurn = turn({
    durableStateBeforeTurn: before,
    toolInvocations: [
      {
        stepIndex: 0,
        capability: "set_shipping_destination",
        workId: null,
        workVersion: null,
        objectiveId: null,
        objectiveType: null,
        eligibilityAtTurnStart: null,
        gateway: { status: "completed", errorCode: null, retryable: false },
        toolObservation: { status: "completed", errorCode: null, retryable: null },
        inTurnEvidence: { relevantEvidenceProduced: [], blockerPotentiallyChanged: false, potentiallyAffectedReasonCodes: [] }
      }
    ]
  });
  const outcome = scoreCase(testCase, [invokedTurn], state());
  assert.deepEqual(outcome.forbiddenViolations, []);
});

test("P7.4-K: an ungrounded quote claim (response text without a durable quote) is detected and classified MODEL_REASONING", () => {
  const testCase = baseCase({ forbidden: { ungroundedQuoteClaim: true } });
  const invokedTurn = turn({ response: { status: "responded", terminalReason: "responded", finalMessage: "Tu cotizacion esta lista.", handoffReason: null, toolExecutionCount: 0 }, durableStateAfterTurn: state({ quote: { present: false, freshness: null, quoteId: null, quoteStatus: null } }) });
  const outcome = scoreCase(testCase, [invokedTurn], state());
  assert.deepEqual(outcome.forbiddenViolations, ["ungroundedQuoteClaim"]);
  const classification = classifyFailure(testCase, [invokedTurn], outcome);
  assert.equal(classification.category, "MODEL_REASONING");
});

test("P7.4-K: a quote claim backed by a durable quote is never flagged, even if create_quote ran in an earlier turn", () => {
  const testCase = baseCase({ forbidden: { ungroundedQuoteClaim: true } });
  const invokedTurn = turn({ response: { status: "responded", terminalReason: "responded", finalMessage: "Tu cotizacion esta lista.", handoffReason: null, toolExecutionCount: 0 }, durableStateAfterTurn: state({ quote: { present: true, freshness: "CURRENT", quoteId: "q-1", quoteStatus: "draft" } }) });
  const outcome = scoreCase(testCase, [invokedTurn], state());
  assert.deepEqual(outcome.forbiddenViolations, []);
});

test("P7.4-L: create_quote success is derived from durable quote presence, not response text alone", () => {
  const testCase = baseCase({ expected: { quoteExists: true } });
  const passingOutcome = scoreCase(testCase, [turn()], state({ quote: { present: true, freshness: "CURRENT", quoteId: "q-1", quoteStatus: "draft" } }));
  assert.equal(caseOutcomePassed(passingOutcome), true);

  const failingOutcome = scoreCase(testCase, [turn()], state({ quote: { present: false, freshness: null, quoteId: null, quoteStatus: null } }));
  assert.equal(caseOutcomePassed(failingOutcome), false);
});

test("identity-fixture classification: expected sufficient identity but the gate denied the mutation", () => {
  const testCase = baseCase({ expected: { identitySufficientForMutation: true } });
  const invokedTurn = turn({
    toolInvocations: [
      {
        stepIndex: 0,
        capability: "create_quote",
        workId: null,
        workVersion: null,
        objectiveId: null,
        objectiveType: "QUOTE",
        eligibilityAtTurnStart: null,
        gateway: { status: "denied", errorCode: "master_identity_required", retryable: false },
        toolObservation: { status: "blocked", errorCode: "master_identity_required", retryable: null },
        inTurnEvidence: { relevantEvidenceProduced: [], blockerPotentiallyChanged: false, potentiallyAffectedReasonCodes: [] }
      }
    ]
  });
  const outcome = scoreCase(testCase, [invokedTurn], state());
  assert.equal(caseOutcomePassed(outcome), false);
  const classification = classifyFailure(testCase, [invokedTurn], outcome);
  assert.equal(classification.category, "IDENTITY_FIXTURE");
});

test("identity denial IS the expectation for an identity-insufficient case - never a failure", () => {
  const testCase = baseCase({ expected: { identitySufficientForMutation: false } });
  const invokedTurn = turn({
    toolInvocations: [
      {
        stepIndex: 0,
        capability: "create_quote",
        workId: null,
        workVersion: null,
        objectiveId: null,
        objectiveType: "QUOTE",
        eligibilityAtTurnStart: null,
        gateway: { status: "denied", errorCode: "master_identity_required", retryable: false },
        toolObservation: { status: "blocked", errorCode: "master_identity_required", retryable: null },
        inTurnEvidence: { relevantEvidenceProduced: [], blockerPotentiallyChanged: false, potentiallyAffectedReasonCodes: [] }
      }
    ]
  });
  const outcome = scoreCase(testCase, [invokedTurn], state());
  assert.equal(caseOutcomePassed(outcome), true);
});

test("BLOCKED->completed is never automatically classified as an error - it is a valid PASS", () => {
  const testCase = baseCase({ expected: { selectionExists: true } });
  const invokedTurn = turn({
    toolInvocations: [
      {
        stepIndex: 1,
        capability: "calculate_shipping",
        workId: null,
        workVersion: null,
        objectiveId: null,
        objectiveType: "QUOTE",
        eligibilityAtTurnStart: { status: "BLOCKED", reasonCodes: ["MISSING_DESTINATION"], metadataVersion: "p6.2-b.1" },
        gateway: { status: "completed", errorCode: null, retryable: false },
        toolObservation: { status: "completed", errorCode: null, retryable: null },
        inTurnEvidence: { relevantEvidenceProduced: ["COMMERCIAL_DESTINATION_STATE"], blockerPotentiallyChanged: true, potentiallyAffectedReasonCodes: ["MISSING_DESTINATION"] }
      }
    ]
  });
  const outcome = scoreCase(testCase, [invokedTurn], state({ selection: { present: true, freshness: "CURRENT", itemCount: 1 } }));
  assert.equal(caseOutcomePassed(outcome), true);
});
