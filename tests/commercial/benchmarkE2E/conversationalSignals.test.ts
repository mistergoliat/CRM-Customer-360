import assert from "node:assert/strict";
import test from "node:test";
import {
  caseHasGreetingRepetition,
  turnHasUngroundedMutationClaim,
  turnHasUngroundedQuoteClaim,
  turnOpensWithGreeting,
  turnRepeatsKnownDestination,
  turnRepeatsKnownSelection
} from "@/lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/conversationalSignals";
import type { BenchmarkE2EDurableStateSnapshot, BenchmarkE2ETurnTrace } from "@/lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/types";

function state(overrides: Partial<BenchmarkE2EDurableStateSnapshot> = {}): BenchmarkE2EDurableStateSnapshot {
  return {
    capturedAt: "t",
    workId: null,
    workVersion: null,
    workStatus: null,
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
    response: { status: "responded", terminalReason: "responded", finalMessage: null, handoffReason: null, toolExecutionCount: 0 },
    runtimeWarnings: [],
    outbox: { attempted: false, outboxWritten: false, outboxId: null, status: null, messageTextPresent: false },
    durableStateAfterTurn: null,
    providerCalls: [],
    ...overrides
  };
}

test("turnRepeatsKnownDestination: false when no durable state before the turn", () => {
  assert.equal(turnRepeatsKnownDestination(turn()), false);
});

test("turnRepeatsKnownDestination: true when set_shipping_destination completes while destination was already CURRENT", () => {
  const result = turnRepeatsKnownDestination(
    turn({
      durableStateBeforeTurn: state({ destination: { present: true, freshness: "CURRENT", communeId: 100 } }),
      toolInvocations: [{ stepIndex: 0, capability: "set_shipping_destination", workId: null, workVersion: null, objectiveId: null, objectiveType: null, eligibilityAtTurnStart: null, gateway: { status: "completed", errorCode: null, retryable: false }, toolObservation: { status: "completed", errorCode: null, retryable: null }, inTurnEvidence: { relevantEvidenceProduced: [], blockerPotentiallyChanged: false, potentiallyAffectedReasonCodes: [] } }]
    })
  );
  assert.equal(result, true);
});

test("turnRepeatsKnownSelection: false when the destination was STALE, not CURRENT, at turn start", () => {
  const result = turnRepeatsKnownSelection(
    turn({
      durableStateBeforeTurn: state({ selection: { present: true, freshness: "STALE", itemCount: 1 } }),
      toolInvocations: [{ stepIndex: 0, capability: "select_products", workId: null, workVersion: null, objectiveId: null, objectiveType: null, eligibilityAtTurnStart: null, gateway: { status: "completed", errorCode: null, retryable: false }, toolObservation: { status: "completed", errorCode: null, retryable: null }, inTurnEvidence: { relevantEvidenceProduced: [], blockerPotentiallyChanged: false, potentiallyAffectedReasonCodes: [] } }]
    })
  );
  assert.equal(result, false);
});

test("turnHasUngroundedQuoteClaim: matches quote-confirmation language with no durable quote afterward", () => {
  assert.equal(turnHasUngroundedQuoteClaim(turn({ response: { status: "responded", terminalReason: "responded", finalMessage: "Tu cotizacion esta lista.", handoffReason: null, toolExecutionCount: 0 } })), true);
});

test("turnHasUngroundedQuoteClaim: false for unrelated text", () => {
  assert.equal(turnHasUngroundedQuoteClaim(turn({ response: { status: "responded", terminalReason: "responded", finalMessage: "Tenemos dos barras disponibles.", handoffReason: null, toolExecutionCount: 0 } })), false);
});

test("turnHasUngroundedMutationClaim: reuses the real production guard's own warning", () => {
  assert.equal(turnHasUngroundedMutationClaim(turn({ runtimeWarnings: ["agent_loop_mutation_claim_blocked:select_products"] })), true);
  assert.equal(turnHasUngroundedMutationClaim(turn({ runtimeWarnings: ["some_other_warning"] })), false);
});

test("turnOpensWithGreeting / caseHasGreetingRepetition: only flags a SECOND greeting within the same case", () => {
  const turns = [
    turn({ turnOrdinal: 0, response: { status: "responded", terminalReason: "responded", finalMessage: "Hola! En que te ayudo?", handoffReason: null, toolExecutionCount: 0 } }),
    turn({ turnOrdinal: 1, response: { status: "responded", terminalReason: "responded", finalMessage: "Listo, lo agregue.", handoffReason: null, toolExecutionCount: 0 } })
  ];
  assert.equal(turnOpensWithGreeting(turns[0]), true);
  assert.equal(caseHasGreetingRepetition(turns), false);

  const repeated = [...turns, turn({ turnOrdinal: 2, response: { status: "responded", terminalReason: "responded", finalMessage: "Hola de nuevo!", handoffReason: null, toolExecutionCount: 0 } })];
  assert.equal(caseHasGreetingRepetition(repeated), true);
});
