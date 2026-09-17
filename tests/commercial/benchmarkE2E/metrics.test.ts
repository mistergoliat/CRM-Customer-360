import assert from "node:assert/strict";
import test from "node:test";
import { computeBenchmarkE2ESummaryMetrics } from "@/lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/metrics";
import type { BenchmarkE2ERunTrace, BenchmarkE2ETurnTrace } from "@/lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/types";

// SALES-AGENT-R3-P7.4. Pure unit tests - no DB. Every rate must be null
// (never a fabricated 0) when its denominator is 0.

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

function run(overrides: Partial<BenchmarkE2ERunTrace> = {}): BenchmarkE2ERunTrace {
  return {
    benchmarkRunId: "run-1",
    caseId: "E01",
    runOrdinal: 0,
    executionMode: "STUBBED",
    startedAt: "t0",
    finishedAt: "t1",
    initialState: null,
    turns: [turn()],
    finalState: null,
    outcome: { status: "PASS", expectationResults: {}, forbiddenViolations: [], failure: null },
    ...overrides
  };
}

test("an empty run list never divides by zero - every rate is null, runCompletionRate is 0", () => {
  const summary = computeBenchmarkE2ESummaryMetrics([]);
  assert.equal(summary.runCompletionRate, 0);
  assert.equal(summary.quoteConversionRate, null);
  assert.equal(summary.gatewayCompletionRate, null);
  assert.equal(summary.outboxCompletionRate, null);
});

test("runCompletionRate counts everything except ENVIRONMENT_BLOCKED", () => {
  const summary = computeBenchmarkE2ESummaryMetrics([
    run({ outcome: { status: "PASS", expectationResults: {}, forbiddenViolations: [], failure: null } }),
    run({ outcome: { status: "FAIL", expectationResults: {}, forbiddenViolations: [], failure: null } }),
    run({ outcome: { status: "ENVIRONMENT_BLOCKED", expectationResults: {}, forbiddenViolations: [], failure: null } })
  ]);
  assert.equal(summary.runCompletionRate, 2 / 3);
});

test("gateway completion/rejection counts come from the same tool invocations, never double counted", () => {
  const summary = computeBenchmarkE2ESummaryMetrics([
    run({
      turns: [
        turn({
          toolInvocations: [
            { stepIndex: 0, capability: "select_products", workId: null, workVersion: null, objectiveId: null, objectiveType: null, eligibilityAtTurnStart: null, gateway: { status: "completed", errorCode: null, retryable: false }, toolObservation: { status: "completed", errorCode: null, retryable: null }, inTurnEvidence: { relevantEvidenceProduced: [], blockerPotentiallyChanged: false, potentiallyAffectedReasonCodes: [] } },
            { stepIndex: 1, capability: "create_quote", workId: null, workVersion: null, objectiveId: null, objectiveType: null, eligibilityAtTurnStart: null, gateway: { status: "denied", errorCode: "master_identity_required", retryable: false }, toolObservation: { status: "blocked", errorCode: "master_identity_required", retryable: null }, inTurnEvidence: { relevantEvidenceProduced: [], blockerPotentiallyChanged: false, potentiallyAffectedReasonCodes: [] } }
          ]
        })
      ]
    })
  ]);
  assert.equal(summary.toolBehavior.gatewayCompleted, 1);
  assert.equal(summary.toolBehavior.gatewayRejected, 1);
  assert.equal(summary.toolBehavior.requestedCapabilities, 2);
  assert.equal(summary.gatewayCompletionRate, 0.5);
});

test("blockedRequestCoherenceRate distinguishes Case 3 (relevant evidence) from Case 4 (no relevant evidence)", () => {
  const summary = computeBenchmarkE2ESummaryMetrics([
    run({
      turns: [
        turn({
          toolInvocations: [
            { stepIndex: 0, capability: "calculate_shipping", workId: null, workVersion: null, objectiveId: null, objectiveType: null, eligibilityAtTurnStart: { status: "BLOCKED", reasonCodes: ["MISSING_DESTINATION"], metadataVersion: "v1" }, gateway: { status: "completed", errorCode: null, retryable: false }, toolObservation: { status: "completed", errorCode: null, retryable: null }, inTurnEvidence: { relevantEvidenceProduced: ["COMMERCIAL_DESTINATION_STATE"], blockerPotentiallyChanged: true, potentiallyAffectedReasonCodes: ["MISSING_DESTINATION"] } },
            { stepIndex: 1, capability: "calculate_shipping", workId: null, workVersion: null, objectiveId: null, objectiveType: null, eligibilityAtTurnStart: { status: "BLOCKED", reasonCodes: ["MISSING_DESTINATION"], metadataVersion: "v1" }, gateway: { status: "denied", errorCode: "destination_missing", retryable: false }, toolObservation: { status: "blocked", errorCode: "destination_missing", retryable: null }, inTurnEvidence: { relevantEvidenceProduced: [], blockerPotentiallyChanged: false, potentiallyAffectedReasonCodes: [] } }
          ]
        })
      ]
    })
  ]);
  assert.equal(summary.toolBehavior.blockedAtTurnStartRequests, 2);
  assert.equal(summary.toolBehavior.blockedThenRelevantEvidence, 1);
  assert.equal(summary.toolBehavior.blockedWithoutRelevantEvidence, 1);
  assert.equal(summary.blockedRequestCoherenceRate, 0.5);
});

test("quoteConversionRate is scoped to quote-eligible runs only (runs that ever requested create_quote)", () => {
  const summary = computeBenchmarkE2ESummaryMetrics([
    run({ caseId: "E01" }), // never touches create_quote
    run({
      caseId: "E09",
      finalState: { capturedAt: "t", workId: null, workVersion: null, workStatus: null, objectiveType: "QUOTE", objectiveStatus: null, selection: { present: true, freshness: "CURRENT", itemCount: 1 }, destination: { present: false, freshness: null, communeId: null }, shipping: { present: false, freshness: null }, quote: { present: true, freshness: "CURRENT", quoteId: "q-1", quoteStatus: "draft" }, identityLevel: "LEVEL_2_MASTER_RESOLVED" },
      turns: [
        turn({
          toolInvocations: [
            { stepIndex: 0, capability: "create_quote", workId: null, workVersion: null, objectiveId: null, objectiveType: null, eligibilityAtTurnStart: null, gateway: { status: "completed", errorCode: null, retryable: false }, toolObservation: { status: "completed", errorCode: null, retryable: null }, inTurnEvidence: { relevantEvidenceProduced: [], blockerPotentiallyChanged: false, potentiallyAffectedReasonCodes: [] } }
          ]
        })
      ]
    })
  ]);
  assert.equal(summary.quoteConversionRate, 1);
});
