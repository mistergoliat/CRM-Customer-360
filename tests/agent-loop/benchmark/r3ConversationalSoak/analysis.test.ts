import assert from "node:assert/strict";
import test from "node:test";
import type { BenchmarkE2EDurableStateSnapshot, BenchmarkE2ETurnTrace } from "@/lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/types";
import type { PlannedTurn } from "@/lib/brain/commercial/agent-loop/benchmark/r3ConversationalSoak/stressPlan";
import { analyzeConversation, deriveRobustnessSignal, findReleaseBlockers, type SoakTurnAnalysis } from "@/lib/brain/commercial/agent-loop/benchmark/r3ConversationalSoak/analysis";

/** SALES-AGENT-R3-P7.12. Pure/in-memory: the deterministic judge (carry-forward verification), release-blocker detection and the robustness signal (sections 26-31, 41, 44), on synthetic turns. */

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

const plan = (overrides: Partial<PlannedTurn> & { message: string }): PlannedTurn => ({
  conversation: "A",
  sequenceIndex: 0,
  localIndex: 0,
  stressCategory: "DIRECT_PURCHASE",
  expectedMutation: "SELECT",
  allowClarification: false,
  ...overrides
});

function turn(after: { productId: string; quantity: number }[], overrides: Partial<BenchmarkE2ETurnTrace> = {}, before: { productId: string; quantity: number }[] = []): BenchmarkE2ETurnTrace {
  return {
    turnOrdinal: 0,
    inboundMessageId: "msg",
    correlationId: "corr",
    customerMessage: "x",
    durableStateBeforeTurn: state(before),
    kernel: { workId: "work-1", workVersion: 1, result: "EXISTING" },
    toolInvocations: overrides.toolInvocations ?? [{ stepIndex: 0, capability: "select_products", workId: null, workVersion: null, objectiveId: null, objectiveType: null, eligibilityAtTurnStart: null, gateway: { status: "completed", errorCode: null, retryable: false }, toolObservation: { status: "completed", errorCode: null, retryable: null }, inTurnEvidence: { relevantEvidenceProduced: [], blockerPotentiallyChanged: false, potentiallyAffectedReasonCodes: [] } }],
    proposal: null,
    objectiveReconciliation: { decided: null, reconciled: null },
    eligibilityShadow: null,
    response: overrides.response ?? { status: "responded", terminalReason: "responded", finalMessage: "listo", handoffReason: null, toolExecutionCount: 1 },
    runtimeWarnings: overrides.runtimeWarnings ?? [],
    outbox: { attempted: false, outboxWritten: false, outboxId: null, status: null, messageTextPresent: true },
    durableStateAfterTurn: state(after),
    providerCalls: []
  };
}

test("P7.12 analyzer: a declared expectation that matches the durable state after the turn is a pass, matches=true", () => {
  const [analysis] = analyzeConversation([plan({ message: "quiero dos Classic", expectedFinalSelection: [{ productId: "31", quantity: 2 }] })], [turn([{ productId: "31", quantity: 2 }])]);
  assert.equal(analysis.matches, true);
  assert.equal(analysis.expectationSource, "declared");
  assert.equal(analysis.wrongProduct, false);
  assert.equal(analysis.wrongQuantity, false);
});

test("P7.12 analyzer: wrong product vs wrong quantity are distinguished", () => {
  const [wrongProduct] = analyzeConversation([plan({ message: "m", expectedFinalSelection: [{ productId: "31", quantity: 2 }] })], [turn([{ productId: "32", quantity: 2 }])]);
  assert.equal(wrongProduct.wrongProduct, true);
  assert.equal(wrongProduct.wrongQuantity, false);
  const [wrongQty] = analyzeConversation([plan({ message: "m", expectedFinalSelection: [{ productId: "31", quantity: 2 }] })], [turn([{ productId: "31", quantity: 3 }])]);
  assert.equal(wrongQty.wrongProduct, false);
  assert.equal(wrongQty.wrongQuantity, true);
});

test("P7.12 analyzer: carry-forward - a NONE/KEEP turn after a declared checkpoint is verified against the carried expectation, not left unverified", () => {
  const planned = [
    plan({ message: "quiero dos Classic", expectedMutation: "SELECT", expectedFinalSelection: [{ productId: "31", quantity: 2 }] }),
    plan({ message: "¿cuanto pesa la Pro?", expectedMutation: "NONE", stressCategory: "INFORMATION_ONLY" })
  ];
  const traces = [turn([{ productId: "31", quantity: 2 }]), turn([{ productId: "31", quantity: 2 }], { toolInvocations: [] })];
  const analyses = analyzeConversation(planned, traces);
  assert.equal(analyses[1].expectationSource, "carried");
  assert.equal(analyses[1].matches, true);
});

test("P7.12 analyzer: carry-forward catches a casual/informational turn that silently changed the cart (integrity failure, not HARD)", () => {
  const planned = [
    plan({ message: "quiero dos Classic", expectedMutation: "SELECT", expectedFinalSelection: [{ productId: "31", quantity: 2 }] }),
    plan({ message: "gracias", expectedMutation: "NONE", stressCategory: "CASUAL_CHAT" })
  ];
  const traces = [turn([{ productId: "31", quantity: 2 }]), turn([{ productId: "31", quantity: 5 }], { toolInvocations: [] })];
  const analyses = analyzeConversation(planned, traces);
  assert.equal(analyses[1].matches, false);
  assert.ok(analyses[1].integrityFailures.includes("CASUAL_TURN_CHANGED_STATE"));
});

test("P7.12 analyzer: a planned SELECT where select_products never completed (asked instead, or blocked by an injected fault) is 'not verified' (matches null) - NEVER classified as wrongProduct/wrongQuantity, since nothing was actually selected", () => {
  const [analysis] = analyzeConversation([plan({ message: "quiero dos Classic", expectedMutation: "SELECT", expectedFinalSelection: [{ productId: "31", quantity: 2 }] })], [turn([], { toolInvocations: [] })]);
  assert.equal(analysis.matches, null);
  assert.equal(analysis.wrongProduct, false);
  assert.equal(analysis.wrongQuantity, false);
  assert.equal(analysis.expectedMutationNotCompleted, true);
  assert.deepEqual(analysis.integrityFailures, []);
});

test("P7.12 analyzer: an ambiguous turn with no declared or carried expectation is 'not verified' (matches null), never silently counted as correct", () => {
  const [analysis] = analyzeConversation([plan({ message: "esa", expectedMutation: "NONE", stressCategory: "AMBIGUOUS_REFERENCE", allowClarification: true })], [turn([], { toolInvocations: [] })]);
  assert.equal(analysis.matches, null);
  assert.equal(analysis.expectationSource, "none");
});

test("P7.12 analyzer: CANCELLATION_IGNORED - a carried empty expectation (post-CANCEL) that reappears is flagged distinctly from a generic mismatch", () => {
  const planned = [
    plan({ message: "cancela todo", expectedMutation: "CANCEL", expectedFinalSelection: [] }),
    plan({ message: "gracias", expectedMutation: "NONE", stressCategory: "CASUAL_CHAT" })
  ];
  const traces = [turn([]), turn([{ productId: "31", quantity: 2 }], { toolInvocations: [] })];
  const analyses = analyzeConversation(planned, traces);
  assert.ok(analyses[1].integrityFailures.includes("CANCELLATION_IGNORED"));
});

function fakeAnalysis(overrides: Partial<SoakTurnAnalysis>): SoakTurnAnalysis {
  return {
    conversation: "A",
    sequenceIndex: 0,
    localIndex: 0,
    stressCategory: "DIRECT_PURCHASE",
    expectedMutation: "SELECT",
    allowClarification: false,
    message: "m",
    executed: true,
    terminalReason: "responded",
    selectAttempted: true,
    selectCompleted: true,
    finalItems: [],
    expectedItems: null,
    expectationSource: "none",
    matches: null,
    wrongProduct: false,
    wrongQuantity: false,
    expectedMutationNotCompleted: false,
    confirmationClass: null,
    invariants: [],
    hardFailure: false,
    integrityFailures: [],
    toolCallCount: 1,
    providerCallCount: 1,
    providerMs: 100,
    inputTokens: 10,
    outputTokens: 5,
    ...overrides
  };
}

test("P7.12 signal: ROBUSTNESS_PASS with no failures at all", () => {
  const all = [fakeAnalysis({}), fakeAnalysis({ stressCategory: "INFORMATION_ONLY", expectedMutation: "NONE" })];
  const result = deriveRobustnessSignal(all, false, 0);
  assert.equal(result.signal, "ROBUSTNESS_PASS");
  assert.equal(result.releaseBlockers.length, 0);
});

test("P7.12 signal: a HARD_FAILURE always yields ROBUSTNESS_FAIL", () => {
  const result = deriveRobustnessSignal([fakeAnalysis({})], false, 1);
  assert.equal(result.signal, "ROBUSTNESS_FAIL");
});

test("P7.12 signal: cross-conversation leak is always a release blocker -> ROBUSTNESS_FAIL", () => {
  const result = deriveRobustnessSignal([fakeAnalysis({})], true, 0);
  assert.equal(result.signal, "ROBUSTNESS_FAIL");
  assert.ok(result.releaseBlockers.some((b) => b.kind === "STATE_LEAK_ACROSS_CONVERSATIONS"));
});

test("P7.12 signal: a wrong-product event on a FINAL-say category (DIRECT_PURCHASE) is a release blocker", () => {
  const all = [fakeAnalysis({ stressCategory: "DIRECT_PURCHASE", integrityFailures: ["WRONG_PRODUCT_DURABLE"] })];
  const blockers = findReleaseBlockers(all, false);
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].kind, "WRONG_PRODUCT_DURABLE");
});

test("P7.12 signal: a wrong-product event on an interior CONTRADICTION step is still counted (CONTRADICTION is a final-say category here since its own last entry is the one that must be correct)", () => {
  const all = [fakeAnalysis({ stressCategory: "CONTRADICTION", integrityFailures: ["WRONG_PRODUCT_DURABLE"] })];
  assert.equal(findReleaseBlockers(all, false).length, 1);
});

test("P7.12 signal: an over-mutation-style residual (STALE_INTENT_OVERWRITES_NEWER on a non-final-say category) with no other issue -> ROBUSTNESS_PASS_WITH_RESIDUALS, not FAIL", () => {
  const all = [fakeAnalysis({ stressCategory: "INFORMATION_ONLY", integrityFailures: ["STALE_INTENT_OVERWRITES_NEWER"] })];
  const result = deriveRobustnessSignal(all, false, 0);
  assert.equal(result.signal, "ROBUSTNESS_PASS_WITH_RESIDUALS");
  assert.equal(result.releaseBlockers.length, 0);
});

test("P7.12 signal: FALSE_SUCCESS_CLAIM is always a release blocker regardless of category", () => {
  const all = [fakeAnalysis({ stressCategory: "CASUAL_CHAT", integrityFailures: ["FALSE_SUCCESS_CLAIM"] })];
  const result = deriveRobustnessSignal(all, false, 0);
  assert.equal(result.signal, "ROBUSTNESS_FAIL");
});

test("P7.12 signal: unnecessary confirmation alone (no integrity failure) demotes PASS to PASS_WITH_RESIDUALS", () => {
  const all = [fakeAnalysis({ confirmationClass: "UNNECESSARY_CONFIRMATION" })];
  const result = deriveRobustnessSignal(all, false, 0);
  assert.equal(result.signal, "ROBUSTNESS_PASS_WITH_RESIDUALS");
});
