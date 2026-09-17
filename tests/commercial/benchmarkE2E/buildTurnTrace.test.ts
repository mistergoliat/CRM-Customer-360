import assert from "node:assert/strict";
import test from "node:test";
import { buildTurnTrace } from "@/lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/buildTurnTrace";
import type { CommercialEventRow } from "@/lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/eventRows";

// SALES-AGENT-R3-P7.4 (P7.4-A..H). Pure unit tests for buildTurnTrace - no
// DB, no HTTP, no LLM. eventRows here are exactly what
// loadCommercialEventRowsForInboundMessage would return - this proves the
// pure assembler correlates run->turn->tool from already-fetched rows.

function baseInput(overrides: Partial<Parameters<typeof buildTurnTrace>[0]> = {}) {
  return {
    turnOrdinal: 0,
    inboundMessageId: "inbound-1",
    correlationId: "corr-1",
    customerMessage: "hola",
    eventRows: [] as CommercialEventRow[],
    runtimeStatus: "responded",
    terminalReason: "responded" as const,
    finalMessage: "Listo.",
    handoffReason: null,
    toolExecutionCount: 0,
    runtimeWarnings: [] as string[],
    outboxAttempted: true,
    outboxWritten: true,
    outboxId: 42,
    outboxRow: { status: "queued", messageText: "Listo." },
    durableStateBeforeTurn: null,
    durableStateAfterTurn: null,
    providerCalls: [],
    ...overrides
  };
}

test("P7.4-A: trace carries turnOrdinal/inboundMessageId/correlationId through unchanged", () => {
  const trace = buildTurnTrace(baseInput({ turnOrdinal: 2, inboundMessageId: "inbound-x", correlationId: "corr-x" }));
  assert.equal(trace.turnOrdinal, 2);
  assert.equal(trace.inboundMessageId, "inbound-x");
  assert.equal(trace.correlationId, "corr-x");
});

test("P7.4-B: multiple tool invocations in the same turn are all preserved, ordered by stepIndex", () => {
  const eventRows: CommercialEventRow[] = [
    {
      eventType: "commercial_capability_invocation_observed",
      payload: { capability: "select_products", stepIndex: 1, gateway: { status: "completed", errorCode: null, retryable: false }, toolObservation: { status: "completed", errorCode: null, retryable: null }, inTurnEvidence: { relevantEvidenceProduced: [], blockerPotentiallyChanged: false, potentiallyAffectedReasonCodes: [] } }
    },
    {
      eventType: "commercial_capability_invocation_observed",
      payload: { capability: "get_product_details", stepIndex: 0, gateway: { status: "completed", errorCode: null, retryable: false }, toolObservation: { status: "completed", errorCode: null, retryable: null }, inTurnEvidence: { relevantEvidenceProduced: [], blockerPotentiallyChanged: false, potentiallyAffectedReasonCodes: [] } }
    }
  ];
  const trace = buildTurnTrace(baseInput({ eventRows }));
  assert.equal(trace.toolInvocations.length, 2);
  assert.deepEqual(trace.toolInvocations.map((invocation) => invocation.capability), ["get_product_details", "select_products"]);
  assert.deepEqual(trace.toolInvocations.map((invocation) => invocation.stepIndex), [0, 1]);
});

test("P7.4-C: eligibility shadow event is joined onto the trace", () => {
  const eventRows: CommercialEventRow[] = [
    {
      eventType: "commercial_capability_eligibility_evaluated",
      payload: { workId: "cw-1", workVersion: 3, objectiveType: "QUOTE", eligibleCapabilityNames: ["create_quote"], blockedCapabilities: [{ capability: "calculate_shipping", reasonCodes: ["MISSING_DESTINATION"] }], metadataVersion: "p6.2-b.1" }
    }
  ];
  const trace = buildTurnTrace(baseInput({ eventRows }));
  assert.deepEqual(trace.eligibilityShadow, {
    workId: "cw-1",
    workVersion: 3,
    objectiveType: "QUOTE",
    eligibleCapabilityNames: ["create_quote"],
    blockedCapabilities: [{ capability: "calculate_shipping", reasonCodes: ["MISSING_DESTINATION"] }]
  });
});

test("P7.4-D: Gateway result is joined per tool invocation, including a rejection", () => {
  const eventRows: CommercialEventRow[] = [
    {
      eventType: "commercial_capability_invocation_observed",
      payload: { capability: "create_quote", stepIndex: 0, gateway: { status: "denied", errorCode: "master_identity_required", retryable: false }, toolObservation: { status: "blocked", errorCode: "master_identity_required", retryable: null }, inTurnEvidence: { relevantEvidenceProduced: [], blockerPotentiallyChanged: false, potentiallyAffectedReasonCodes: [] } }
    }
  ];
  const trace = buildTurnTrace(baseInput({ eventRows }));
  assert.deepEqual(trace.toolInvocations[0].gateway, { status: "denied", errorCode: "master_identity_required", retryable: false });
  assert.equal(trace.toolInvocations[0].toolObservation.status, "blocked");
});

test("P7.4-D: gateway=null (pre-Gateway rejection) is preserved, never fabricated", () => {
  const eventRows: CommercialEventRow[] = [
    {
      eventType: "commercial_capability_invocation_observed",
      payload: { capability: "select_products", stepIndex: 0, gateway: null, toolObservation: { status: "blocked", errorCode: "duplicate_tool_call", retryable: null }, inTurnEvidence: { relevantEvidenceProduced: [], blockerPotentiallyChanged: false, potentiallyAffectedReasonCodes: [] } }
    }
  ];
  const trace = buildTurnTrace(baseInput({ eventRows }));
  assert.equal(trace.toolInvocations[0].gateway, null);
});

test("P7.4-E: in-turn evidence (P7.3) is preserved on the tool invocation trace", () => {
  const eventRows: CommercialEventRow[] = [
    {
      eventType: "commercial_capability_invocation_observed",
      payload: {
        capability: "calculate_shipping",
        stepIndex: 1,
        eligibilityAtTurnStart: { status: "BLOCKED", reasonCodes: ["MISSING_DESTINATION"], metadataVersion: "p6.2-b.1" },
        gateway: { status: "completed", errorCode: null, retryable: false },
        toolObservation: { status: "completed", errorCode: null, retryable: null },
        inTurnEvidence: { relevantEvidenceProduced: ["COMMERCIAL_DESTINATION_STATE"], blockerPotentiallyChanged: true, potentiallyAffectedReasonCodes: ["MISSING_DESTINATION"] }
      }
    }
  ];
  const trace = buildTurnTrace(baseInput({ eventRows }));
  assert.deepEqual(trace.toolInvocations[0].inTurnEvidence, {
    relevantEvidenceProduced: ["COMMERCIAL_DESTINATION_STATE"],
    blockerPotentiallyChanged: true,
    potentiallyAffectedReasonCodes: ["MISSING_DESTINATION"]
  });
  assert.equal(trace.toolInvocations[0].eligibilityAtTurnStart?.status, "BLOCKED");
});

test("P7.4-F: P5 objective reconciliation decided+reconciled events are both joined", () => {
  const eventRows: CommercialEventRow[] = [
    { eventType: "commercial_objective_reconciliation_decided", payload: { decisionAction: "START", reasonCode: "NO_ACTIVE_OBJECTIVE", workVersionBefore: 1, proposalObjectiveKind: "QUOTE", previousObjectiveKind: null } },
    { eventType: "commercial_objective_reconciled", payload: { workVersionAfter: 2, resultingObjectiveKind: "QUOTE", resultingObjectiveId: "obj-1" } }
  ];
  const trace = buildTurnTrace(baseInput({ eventRows }));
  assert.equal(trace.objectiveReconciliation.decided?.decisionAction, "START");
  assert.equal(trace.objectiveReconciliation.reconciled?.workVersionAfter, 2);
});

test("P7.4-F: a NOOP turn (no write) has decided but no reconciled event - never a fabricated reconciliation", () => {
  const eventRows: CommercialEventRow[] = [
    { eventType: "commercial_objective_reconciliation_decided", payload: { decisionAction: "CONTINUE", reasonCode: "SAME_KIND_ACTIVE", workVersionBefore: 2, proposalObjectiveKind: "QUOTE", previousObjectiveKind: "QUOTE" } }
  ];
  const trace = buildTurnTrace(baseInput({ eventRows }));
  assert.equal(trace.objectiveReconciliation.decided?.decisionAction, "CONTINUE");
  assert.equal(trace.objectiveReconciliation.reconciled, null);
});

test("P7.4-G: kernel event is joined (workId/workVersion/result)", () => {
  const eventRows: CommercialEventRow[] = [{ eventType: "commercial_work_kernel_resolved", payload: { workId: "cw-1", workVersion: 1, result: "CREATED" } }];
  const trace = buildTurnTrace(baseInput({ eventRows }));
  assert.deepEqual(trace.kernel, { workId: "cw-1", workVersion: 1, result: "CREATED" });
});

test("P7.4-G: durable state before/after the turn is captured verbatim", () => {
  const before = { capturedAt: "t0", workId: null, workVersion: null, workStatus: null, objectiveType: null, objectiveStatus: null, selection: { present: false, freshness: null, itemCount: null }, destination: { present: false, freshness: null, communeId: null }, shipping: { present: false, freshness: null }, quote: { present: false, freshness: null, quoteId: null, quoteStatus: null }, identityLevel: null };
  const after = { ...before, capturedAt: "t1", selection: { present: true, freshness: "CURRENT", itemCount: 1 } };
  const trace = buildTurnTrace(baseInput({ durableStateBeforeTurn: before, durableStateAfterTurn: after }));
  assert.equal(trace.durableStateBeforeTurn?.selection.present, false);
  assert.equal(trace.durableStateAfterTurn?.selection.present, true);
});

test("P7.4-H: outbox correlation is captured from the runtime's own dispatch result plus the id-based row lookup", () => {
  const trace = buildTurnTrace(baseInput({ outboxAttempted: true, outboxWritten: true, outboxId: 99, outboxRow: { status: "sent", messageText: "hola" } }));
  assert.deepEqual(trace.outbox, { attempted: true, outboxWritten: true, outboxId: 99, status: "sent", messageTextPresent: true });
});

test("P7.4-H: a skipped/blocked turn (no dispatch attempted) never fabricates an outbox row", () => {
  const trace = buildTurnTrace(baseInput({ outboxAttempted: false, outboxWritten: false, outboxId: null, outboxRow: null }));
  assert.deepEqual(trace.outbox, { attempted: false, outboxWritten: false, outboxId: null, status: null, messageTextPresent: false });
});

test("proposal event is joined when present", () => {
  const eventRows: CommercialEventRow[] = [
    { eventType: "commercial_proposal_shadow_built", payload: { proposalPresent: true, objectiveKind: "QUOTE", operation: "START", confidence: "HIGH", requestedOutcome: "QUOTE_CREATION", evidenceCodes: ["EXPLICIT_QUOTE_CONTINUATION"] } }
  ];
  const trace = buildTurnTrace(baseInput({ eventRows }));
  assert.deepEqual(trace.proposal, { present: true, objectiveKind: "QUOTE", operation: "START", confidence: "HIGH", requestedOutcome: "QUOTE_CREATION", evidenceCodes: ["EXPLICIT_QUOTE_CONTINUATION"] });
});

test("absence of an event type never throws - it simply means that field is null", () => {
  const trace = buildTurnTrace(baseInput());
  assert.equal(trace.kernel, null);
  assert.equal(trace.proposal, null);
  assert.equal(trace.eligibilityShadow, null);
  assert.deepEqual(trace.toolInvocations, []);
});
