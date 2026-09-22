import assert from "node:assert/strict";
import test from "node:test";
import type { BenchmarkE2EDurableStateSnapshot, BenchmarkE2ETurnTrace } from "@/lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/types";
import { checkCrossConversationIsolation, checkTurnInvariants, isHardFailure } from "@/lib/brain/commercial/agent-loop/benchmark/r3ConversationalSoak/invariants";

/** SALES-AGENT-R3-P7.12. Pure/in-memory: structural per-turn invariants and cross-conversation isolation (sections 25/26). */

const state = (items: { productId: string; quantity: number }[]): BenchmarkE2EDurableStateSnapshot => ({
  capturedAt: new Date().toISOString(),
  workId: "work-1",
  workVersion: 1,
  workStatus: "open",
  objectiveType: null,
  objectiveStatus: null,
  selection: { present: items.length > 0, freshness: "CURRENT", itemCount: items.length, items },
  destination: { present: false, freshness: null, communeId: null },
  shipping: { present: false, freshness: null },
  quote: { present: false, freshness: null, quoteId: null, quoteStatus: null },
  identityLevel: "LEVEL_2_MASTER_RESOLVED"
});

function turn(overrides: Partial<BenchmarkE2ETurnTrace> & { before: { productId: string; quantity: number }[]; after: { productId: string; quantity: number }[] }): BenchmarkE2ETurnTrace {
  return {
    turnOrdinal: 0,
    inboundMessageId: "msg-1",
    correlationId: "corr-1",
    customerMessage: "test",
    durableStateBeforeTurn: state(overrides.before),
    kernel: { workId: "work-1", workVersion: 1, result: "EXISTING" },
    toolInvocations: overrides.toolInvocations ?? [],
    proposal: null,
    objectiveReconciliation: { decided: null, reconciled: null },
    eligibilityShadow: null,
    response: overrides.response ?? { status: "responded", terminalReason: "responded", finalMessage: "ok", handoffReason: null, toolExecutionCount: 0 },
    runtimeWarnings: overrides.runtimeWarnings ?? [],
    outbox: { attempted: false, outboxWritten: false, outboxId: null, status: null, messageTextPresent: true },
    durableStateAfterTurn: state(overrides.after),
    providerCalls: []
  };
}

test("P7.12: validSelectionStructure - unknown product id is a HARD_FAILURE", () => {
  const t = turn({ before: [], after: [{ productId: "99", quantity: 1 }] });
  const checks = checkTurnInvariants({ turn: t, expectedMutation: "SELECT" });
  assert.equal(isHardFailure(checks), true);
  assert.equal(checks.find((c) => c.name === "validSelectionStructure")?.ok, false);
});

test("P7.12: validSelectionStructure - duplicate product line is a HARD_FAILURE", () => {
  const t = turn({
    before: [],
    after: [
      { productId: "31", quantity: 2 },
      { productId: "31", quantity: 1 }
    ]
  });
  assert.equal(isHardFailure(checkTurnInvariants({ turn: t, expectedMutation: "SELECT" })), true);
});

test("P7.12: validSelectionStructure - non-integer or non-positive quantity is a HARD_FAILURE", () => {
  const t1 = turn({ before: [], after: [{ productId: "31", quantity: 0 }] });
  const t2 = turn({ before: [], after: [{ productId: "31", quantity: 1.5 }] });
  assert.equal(isHardFailure(checkTurnInvariants({ turn: t1, expectedMutation: "SELECT" })), true);
  assert.equal(isHardFailure(checkTurnInvariants({ turn: t2, expectedMutation: "SELECT" })), true);
});

test("P7.12: a valid, unchanged selection on a NONE-mutation turn passes every check", () => {
  const t = turn({ before: [{ productId: "31", quantity: 2 }], after: [{ productId: "31", quantity: 2 }] });
  const checks = checkTurnInvariants({ turn: t, expectedMutation: "NONE" });
  assert.equal(isHardFailure(checks), false);
  assert.ok(checks.every((c) => c.ok));
});

test("P7.12: noMutationOnInformationalTurn - a completed select_products on a NONE turn is flagged (not HARD)", () => {
  const t = turn({
    before: [],
    after: [{ productId: "31", quantity: 2 }],
    toolInvocations: [{ stepIndex: 0, capability: "select_products", workId: null, workVersion: null, objectiveId: null, objectiveType: null, eligibilityAtTurnStart: null, gateway: { status: "completed", errorCode: null, retryable: false }, toolObservation: { status: "completed", errorCode: null, retryable: null }, inTurnEvidence: { relevantEvidenceProduced: [], blockerPotentiallyChanged: false, potentiallyAffectedReasonCodes: [] } }]
  });
  const checks = checkTurnInvariants({ turn: t, expectedMutation: "NONE" });
  const check = checks.find((c) => c.name === "noMutationOnInformationalTurn")!;
  assert.equal(check.ok, false);
  assert.equal(check.hard, false);
  assert.equal(isHardFailure(checks), false);
});

test("P7.12: noMutationOnInformationalTurn - a KEEP turn may legitimately call create_quote/set_shipping_destination without tripping the check (only select_products is scoped)", () => {
  const t = turn({
    before: [{ productId: "31", quantity: 2 }],
    after: [{ productId: "31", quantity: 2 }],
    toolInvocations: [{ stepIndex: 0, capability: "create_quote", workId: null, workVersion: null, objectiveId: null, objectiveType: null, eligibilityAtTurnStart: null, gateway: { status: "completed", errorCode: null, retryable: false }, toolObservation: { status: "completed", errorCode: null, retryable: null }, inTurnEvidence: { relevantEvidenceProduced: [], blockerPotentiallyChanged: false, potentiallyAffectedReasonCodes: [] } }]
  });
  const checks = checkTurnInvariants({ turn: t, expectedMutation: "KEEP" });
  assert.equal(checks.find((c) => c.name === "noMutationOnInformationalTurn")?.ok, true);
});

test("P7.12: noUnexpectedDeletion - selection drops to empty without a CANCEL turn is flagged (not HARD)", () => {
  const t = turn({ before: [{ productId: "31", quantity: 2 }], after: [] });
  const checks = checkTurnInvariants({ turn: t, expectedMutation: "NONE" });
  const check = checks.find((c) => c.name === "noUnexpectedDeletion")!;
  assert.equal(check.ok, false);
  assert.equal(check.hard, false);
});

test("P7.12: noUnexpectedDeletion - an intentional CANCEL is not flagged", () => {
  const t = turn({ before: [{ productId: "31", quantity: 2 }], after: [] });
  const checks = checkTurnInvariants({ turn: t, expectedMutation: "CANCEL" });
  assert.equal(checks.find((c) => c.name === "noUnexpectedDeletion")?.ok, true);
});

test("P7.12: noFalseSuccessClaim - a blocked mutation claim warning is flagged (not HARD)", () => {
  const t = turn({ before: [], after: [], runtimeWarnings: ["agent_loop_mutation_claim_blocked:agregue"] });
  const checks = checkTurnInvariants({ turn: t, expectedMutation: "NONE" });
  const check = checks.find((c) => c.name === "noFalseSuccessClaim")!;
  assert.equal(check.ok, false);
  assert.equal(check.hard, false);
});

test("P7.12: noRunawayToolExecution - emergency_limit_exceeded terminal reason is a HARD_FAILURE (loop protection, section 32)", () => {
  const t = turn({ before: [], after: [], response: { status: "failed", terminalReason: "emergency_limit_exceeded", finalMessage: null, handoffReason: null, toolExecutionCount: 20 } });
  const checks = checkTurnInvariants({ turn: t, expectedMutation: "NONE" });
  assert.equal(isHardFailure(checks), true);
  assert.equal(checks.find((c) => c.name === "noRunawayToolExecution")?.ok, false);
});

test("P7.12: crossConversationIsolation - distinct fixture ids pass, a collision is a HARD_FAILURE", () => {
  const distinct = [
    { label: "A", opportunityId: 1, conversationId: 10, waId: "wa-1" },
    { label: "B", opportunityId: 2, conversationId: 20, waId: "wa-2" },
    { label: "C", opportunityId: 3, conversationId: 30, waId: "wa-3" }
  ];
  assert.equal(checkCrossConversationIsolation(distinct).ok, true);
  const collided = [distinct[0], { ...distinct[1], opportunityId: 1 }, distinct[2]];
  const check = checkCrossConversationIsolation(collided);
  assert.equal(check.ok, false);
  assert.equal(check.hard, true);
});
