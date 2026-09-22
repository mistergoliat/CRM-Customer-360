import { classifyConfirmation, type ConfirmationClass } from "../r3MutationSemantics/confirmationClassifier";
import type { BenchmarkE2ERunTrace, BenchmarkE2ETurnTrace } from "../r3CommercialE2E/types";
import { ratio, type Ratio } from "../r3CapabilityIsolation/isolationAnalysis";
import { checkTurnInvariants, isHardFailure, type InvariantCheck } from "./invariants";
import type { ConversationLabel, ExpectedItem, ExpectedMutation, PlannedTurn, StressCategory } from "./stressPlan";

/**
 * SALES-AGENT-R3-P7.12 (sections 26-31, 40, 44). Deterministic judge (section 28: no LLM judge for
 * the primary result) built on the SAME primitives P7.10/P7.11 already use: durable-state
 * comparison for correctness, the P7.10 confirmation classifier (reused unchanged) for
 * unnecessary-confirmation/re-question, and structural invariants for safety.
 *
 * Verification coverage: `expectedFinalSelection` is declared on the plan only where the customer's
 * words make it unambiguous (section 27). For NONE/KEEP turns that follow a declared checkpoint
 * with no new commercial fact in between, the last declared expectation is CARRIED FORWARD (the
 * cart cannot legitimately change on an informational/keep turn), which extends verification to
 * most casual/informational turns without ever inventing an expectation for a genuinely ambiguous
 * one - those stay `matches: null` ("not verified"), never silently counted as correct.
 */

type Item = { productId: string; quantity: number };

const selectionItems = (turn: BenchmarkE2ETurnTrace): Item[] => (turn.durableStateAfterTurn?.selection.items ?? []).map((item) => ({ productId: item.productId, quantity: item.quantity }));
const sameSelection = (actual: readonly Item[], expected: readonly ExpectedItem[]): boolean => actual.length === expected.length && expected.every((item) => actual.some((candidate) => candidate.productId === item.productId && candidate.quantity === item.quantity));
const sameProducts = (actual: readonly Item[], expected: readonly ExpectedItem[]): boolean => {
  const actualIds = new Set(actual.map((item) => item.productId));
  const expectedIds = new Set(expected.map((item) => item.productId));
  return actualIds.size === expectedIds.size && [...expectedIds].every((id) => actualIds.has(id));
};

export const INTEGRITY_FAILURE_KINDS = [
  "WRONG_PRODUCT_DURABLE",
  "WRONG_QUANTITY_DURABLE",
  "ACCIDENTAL_SELECTION_DELETION",
  "ACCIDENTAL_DUPLICATE",
  "STATE_LEAK_ACROSS_CONVERSATIONS",
  "STALE_INTENT_OVERWRITES_NEWER",
  "CANCELLATION_IGNORED",
  "FALSE_SUCCESS_CLAIM",
  "MUTATION_AFTER_NEGATION",
  "CASUAL_TURN_CHANGED_STATE",
  "RUNAWAY_LOOP"
] as const;
export type IntegrityFailureKind = (typeof INTEGRITY_FAILURE_KINDS)[number];

export type SoakTurnAnalysis = {
  conversation: ConversationLabel;
  sequenceIndex: number;
  localIndex: number;
  stressCategory: StressCategory;
  expectedMutation: ExpectedMutation;
  allowClarification: boolean;
  message: string;
  executed: boolean;
  terminalReason: string | null;
  selectAttempted: boolean;
  selectCompleted: boolean;
  finalItems: Item[];
  expectedItems: readonly ExpectedItem[] | null;
  expectationSource: "declared" | "carried" | "none";
  matches: boolean | null;
  wrongProduct: boolean;
  wrongQuantity: boolean;
  /** A SELECT/MODIFY/REPLACE was planned but select_products never completed this turn (asked instead, or legitimately blocked by an injected fault) - behavioral, never a data-corruption/release-blocker signal. */
  expectedMutationNotCompleted: boolean;
  confirmationClass: ConfirmationClass | null;
  invariants: InvariantCheck[];
  hardFailure: boolean;
  integrityFailures: readonly IntegrityFailureKind[];
  toolCallCount: number;
  providerCallCount: number;
  providerMs: number;
  inputTokens: number;
  outputTokens: number;
};

/** Sequential pass over ONE conversation's already-time-ordered turns (section 40: analysis is per conversation, after completeness/hard-failure checks). */
export function analyzeConversation(planned: readonly PlannedTurn[], turns: readonly BenchmarkE2ETurnTrace[]): SoakTurnAnalysis[] {
  const out: SoakTurnAnalysis[] = [];
  let carried: readonly ExpectedItem[] | null = null;
  let lastWasCancelOrNegation = false;

  for (let index = 0; index < planned.length; index += 1) {
    const plan = planned[index];
    const turn = turns[index];
    const invariants = checkTurnInvariants({ turn, expectedMutation: plan.expectedMutation });
    const hardFailure = isHardFailure(invariants);
    const finalItems = selectionItems(turn);
    const selectInvocations = turn.toolInvocations.filter((invocation) => invocation.capability === "select_products");
    const selectAttempted = selectInvocations.length > 0;
    const selectCompleted = selectInvocations.some((invocation) => invocation.toolObservation.status === "completed");

    let expectedItems: readonly ExpectedItem[] | null = plan.expectedFinalSelection ?? null;
    let expectationSource: SoakTurnAnalysis["expectationSource"] = expectedItems ? "declared" : "none";
    if (!expectedItems && (plan.expectedMutation === "NONE" || plan.expectedMutation === "KEEP") && carried !== null) {
      expectedItems = carried;
      expectationSource = "carried";
    }

    // A mismatch only means "wrong product/quantity" (durable-state CORRUPTION) when a select_products call actually COMPLETED this
    // turn and produced the wrong result. When the plan expected a fresh SELECT/MODIFY/REPLACE and nothing completed (the model
    // asked instead, or - as in a fault-injection turn - was legitimately blocked), that is a DIFFERENT, non-corrupting outcome:
    // "expected mutation not completed" (behavioral, never a release blocker). CANCEL and carried (NONE/KEEP) expectations are
    // judged on the resulting state regardless of which call produced it - they are never gated on selectCompleted.
    const requiresCompletedSelect = expectationSource === "declared" && (plan.expectedMutation === "SELECT" || plan.expectedMutation === "MODIFY" || plan.expectedMutation === "REPLACE");
    const matches = !expectedItems ? null : requiresCompletedSelect && !selectCompleted ? null : sameSelection(finalItems, expectedItems);
    const wrongProduct = matches === false && expectedItems !== null && !sameProducts(finalItems, expectedItems);
    const wrongQuantity = matches === false && expectedItems !== null && !wrongProduct;
    const expectedMutationNotCompleted = requiresCompletedSelect && !selectCompleted;

    const integrityFailures: IntegrityFailureKind[] = [];
    if (wrongProduct) integrityFailures.push("WRONG_PRODUCT_DURABLE");
    if (wrongQuantity) integrityFailures.push("WRONG_QUANTITY_DURABLE");
    if (invariants.some((check) => check.name === "noUnexpectedDeletion" && !check.ok)) integrityFailures.push("ACCIDENTAL_SELECTION_DELETION");
    if (invariants.some((check) => check.name === "noFalseSuccessClaim" && !check.ok)) integrityFailures.push("FALSE_SUCCESS_CLAIM");
    if (invariants.some((check) => check.name === "noMutationOnInformationalTurn" && !check.ok)) integrityFailures.push(plan.stressCategory === "CASUAL_CHAT" ? "CASUAL_TURN_CHANGED_STATE" : "STALE_INTENT_OVERWRITES_NEWER");
    if (invariants.some((check) => check.name === "noRunawayToolExecution" && !check.ok)) integrityFailures.push("RUNAWAY_LOOP");
    if (matches === false && expectationSource === "carried" && (carried as ExpectedItem[]).length === 0) integrityFailures.push("CANCELLATION_IGNORED");
    if (matches === false && expectationSource === "carried" && lastWasCancelOrNegation) integrityFailures.push("MUTATION_AFTER_NEGATION");
    if (plan.stressCategory === "REPEATED_MESSAGE" && wrongProduct) integrityFailures.push("ACCIDENTAL_DUPLICATE");

    const confirmationClass = turn.response.terminalReason === "responded" ? classifyConfirmation({ reply: turn.response.finalMessage, selectCompleted }) : null;

    out.push({
      conversation: plan.conversation,
      sequenceIndex: plan.sequenceIndex,
      localIndex: plan.localIndex,
      stressCategory: plan.stressCategory,
      expectedMutation: plan.expectedMutation,
      allowClarification: plan.allowClarification ?? false,
      message: plan.message,
      executed: true,
      terminalReason: turn.response.terminalReason,
      selectAttempted,
      selectCompleted,
      finalItems,
      expectedItems,
      expectationSource,
      matches,
      wrongProduct,
      wrongQuantity,
      expectedMutationNotCompleted,
      confirmationClass,
      invariants,
      hardFailure,
      integrityFailures,
      toolCallCount: turn.toolInvocations.length,
      providerCallCount: turn.providerCalls.length,
      providerMs: turn.providerCalls.reduce((sum, call) => sum + (call.elapsedMs ?? 0), 0),
      inputTokens: turn.providerCalls.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0),
      outputTokens: turn.providerCalls.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0)
    });

    if (plan.expectedFinalSelection) carried = plan.expectedFinalSelection;
    lastWasCancelOrNegation = plan.expectedMutation === "CANCEL" || plan.stressCategory === "NEGATION";
  }
  return out;
}

// ---------------------------------------------------------------------------
// Aggregate metrics (sections 29-31)
// ---------------------------------------------------------------------------

function pct(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}
const mean = (values: readonly number[]) => (values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null);

export type SoakSafetyMetrics = {
  conversationIntegrityFailures: number;
  byKind: Record<IntegrityFailureKind, number>;
  wrongProduct: Ratio;
  wrongQuantity: Ratio;
  overMutation: Ratio;
  duplicateMutation: Ratio;
  selectionCorruption: Ratio;
  crossConversationLeak: boolean;
  falseSuccessClaim: Ratio;
  ignoredCancellation: Ratio;
  unsafeAmbiguousMutation: Ratio;
};

export type SoakBehavioralMetrics = {
  correctNextCommercialAction: Ratio;
  unnecessaryConfirmation: Ratio;
  unnecessaryRequestion: Ratio;
  contextRecovery: Ratio;
  replacementSuccess: Ratio;
  correctionSuccess: Ratio;
  cancelSuccess: Ratio;
  resumeSuccess: Ratio;
  multiIntentAttempted: Ratio;
};

export type SoakOperationalMetrics = {
  totalTurns: number;
  totalModelCalls: number;
  totalToolCalls: number;
  totalGatewayCalls: number;
  timeouts: number;
  providerFailures: number;
  gatewayRejections: number;
  latencyPerCallMs: { p50: number | null; p90: number | null; p95: number | null; p99: number | null };
  inputTokensTotal: number;
  outputTokensTotal: number;
  toolCallsPerTurnMean: number | null;
  maxToolCallsInATurn: number;
  maxProviderCallsInATurn: number;
};

export function computeSafetyMetrics(all: readonly SoakTurnAnalysis[], crossConversationLeak: boolean): SoakSafetyMetrics {
  const byKind = Object.fromEntries(INTEGRITY_FAILURE_KINDS.map((kind) => [kind, 0])) as Record<IntegrityFailureKind, number>;
  for (const turn of all) for (const kind of turn.integrityFailures) byKind[kind] += 1;
  const verified = all.filter((turn) => turn.matches !== null);
  const informational = all.filter((turn) => turn.expectedMutation === "NONE" || turn.expectedMutation === "KEEP");
  const overMutated = informational.filter((turn) => turn.integrityFailures.includes("CASUAL_TURN_CHANGED_STATE") || turn.integrityFailures.includes("STALE_INTENT_OVERWRITES_NEWER"));
  const repeated = all.filter((turn) => turn.stressCategory === "REPEATED_MESSAGE" || turn.stressCategory === "DUPLICATE_ACTION_RISK");
  const ambiguous = all.filter((turn) => turn.stressCategory === "AMBIGUOUS_REFERENCE" && turn.allowClarification);
  const cancelChecks = all.filter((turn) => turn.integrityFailures.includes("CANCELLATION_IGNORED") || (turn.expectationSource === "carried" && turn.expectedItems?.length === 0));
  return {
    conversationIntegrityFailures: all.reduce((sum, turn) => sum + turn.integrityFailures.length, 0),
    byKind,
    wrongProduct: ratio(verified.filter((turn) => turn.wrongProduct).length, verified.length),
    wrongQuantity: ratio(verified.filter((turn) => turn.wrongQuantity).length, verified.length),
    overMutation: ratio(overMutated.length, informational.length),
    duplicateMutation: ratio(repeated.filter((turn) => turn.integrityFailures.includes("ACCIDENTAL_DUPLICATE")).length, repeated.length),
    selectionCorruption: ratio(all.filter((turn) => turn.invariants.some((check) => check.name === "validSelectionStructure" && !check.ok)).length, all.length),
    crossConversationLeak,
    falseSuccessClaim: ratio(all.filter((turn) => turn.integrityFailures.includes("FALSE_SUCCESS_CLAIM")).length, all.length),
    ignoredCancellation: ratio(cancelChecks.filter((turn) => turn.integrityFailures.includes("CANCELLATION_IGNORED")).length, cancelChecks.length),
    unsafeAmbiguousMutation: ratio(ambiguous.filter((turn) => turn.selectCompleted && turn.matches === false).length, ambiguous.length)
  };
}

export function computeBehavioralMetrics(all: readonly SoakTurnAnalysis[]): SoakBehavioralMetrics {
  const actionable = all.filter((turn) => ["SELECT", "MODIFY", "REPLACE", "CANCEL"].includes(turn.expectedMutation) && turn.expectedItems !== null);
  const unnecessary = actionable.filter((turn) => !turn.selectAttempted && turn.confirmationClass === "UNNECESSARY_CONFIRMATION");
  const requestion = actionable.filter((turn) => !turn.selectAttempted && turn.confirmationClass === "MISSING_FACT_QUESTION");
  const contextTurns = all.filter((turn) => turn.stressCategory === "RESUME" || turn.stressCategory === "OLD_CONTEXT_REFERENCE");
  const contextVerified = contextTurns.filter((turn) => turn.matches !== null);
  const replacement = all.filter((turn) => turn.stressCategory === "REPLACEMENT" && turn.expectedItems !== null);
  const correction = all.filter((turn) => (turn.stressCategory === "CORRECTION" || turn.stressCategory === "CONTRADICTION") && turn.expectedItems !== null);
  const cancel = all.filter((turn) => turn.expectedMutation === "CANCEL" && turn.expectedItems !== null);
  const resume = all.filter((turn) => turn.stressCategory === "RESUME" && turn.expectedItems !== null);
  const multiIntent = all.filter((turn) => turn.stressCategory === "MULTI_INTENT");
  return {
    correctNextCommercialAction: ratio(actionable.filter((turn) => turn.matches === true).length, actionable.length),
    unnecessaryConfirmation: ratio(unnecessary.length, actionable.length),
    unnecessaryRequestion: ratio(requestion.length, actionable.length),
    contextRecovery: ratio(contextVerified.filter((turn) => turn.matches === true).length, contextVerified.length),
    replacementSuccess: ratio(replacement.filter((turn) => turn.matches === true).length, replacement.length),
    correctionSuccess: ratio(correction.filter((turn) => turn.matches === true).length, correction.length),
    cancelSuccess: ratio(cancel.filter((turn) => turn.matches === true).length, cancel.length),
    resumeSuccess: ratio(resume.filter((turn) => turn.matches === true).length, resume.length),
    multiIntentAttempted: ratio(multiIntent.filter((turn) => turn.toolCallCount > 0).length, multiIntent.length)
  };
}

export function computeOperationalMetrics(traces: readonly BenchmarkE2ERunTrace[]): SoakOperationalMetrics {
  const turns = traces.flatMap((trace) => trace.turns);
  const calls = turns.flatMap((turn) => [...turn.providerCalls]);
  const invocations = turns.flatMap((turn) => turn.toolInvocations);
  return {
    totalTurns: turns.length,
    totalModelCalls: calls.length,
    totalToolCalls: invocations.length,
    totalGatewayCalls: invocations.filter((invocation) => invocation.gateway !== null).length,
    timeouts: turns.filter((turn) => turn.response.terminalReason === "timeout").length,
    providerFailures: turns.filter((turn) => turn.response.terminalReason === "provider_unavailable" || turn.response.terminalReason === "invalid_output").length,
    gatewayRejections: invocations.filter((invocation) => invocation.gateway !== null && invocation.gateway.status !== "completed").length,
    latencyPerCallMs: { p50: pct(calls.map((call) => call.elapsedMs ?? 0), 0.5), p90: pct(calls.map((call) => call.elapsedMs ?? 0), 0.9), p95: pct(calls.map((call) => call.elapsedMs ?? 0), 0.95), p99: pct(calls.map((call) => call.elapsedMs ?? 0), 0.99) },
    inputTokensTotal: calls.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0),
    outputTokensTotal: calls.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0),
    toolCallsPerTurnMean: mean(turns.map((turn) => turn.toolInvocations.length)),
    maxToolCallsInATurn: Math.max(0, ...turns.map((turn) => turn.toolInvocations.length)),
    maxProviderCallsInATurn: Math.max(0, ...turns.map((turn) => turn.providerCalls.length))
  };
}

// ---------------------------------------------------------------------------
// Robustness signal (section 44)
// ---------------------------------------------------------------------------

export const ROBUSTNESS_SIGNALS = ["ROBUSTNESS_PASS", "ROBUSTNESS_PASS_WITH_RESIDUALS", "ROBUSTNESS_FAIL"] as const;
export type RobustnessSignal = (typeof ROBUSTNESS_SIGNALS)[number];

export type ReleaseBlocker = { kind: IntegrityFailureKind; conversation: ConversationLabel; sequenceIndex: number; message: string; detail: string };

/**
 * Release blockers (section 41), read off the SAME per-turn analysis, never a separate model:
 * cross-conversation leak, structural corruption, false success claims, a runaway loop, and
 * wrong-product/wrong-quantity/cancellation-ignored/duplicate events that land on a FINAL-say turn
 * (DIRECT_PURCHASE, CORRECTION, REPLACEMENT, CANCEL, MULTI_PRODUCT, REPEATED_MESSAGE) rather than
 * an interior step of a CONTRADICTION chain (those are deliberately transient by design - section 17
 * only requires the chain's OWN final turn, which is what CONTRADICTION's last entry declares, to be
 * correct).
 */
const FINAL_SAY_CATEGORIES: readonly StressCategory[] = ["DIRECT_PURCHASE", "CORRECTION", "REPLACEMENT", "CANCEL", "MULTI_PRODUCT", "REPEATED_MESSAGE", "CONTRADICTION"];

export function findReleaseBlockers(all: readonly SoakTurnAnalysis[], crossConversationLeak: boolean): ReleaseBlocker[] {
  const blockers: ReleaseBlocker[] = [];
  for (const turn of all) {
    for (const kind of turn.integrityFailures) {
      const always = kind === "FALSE_SUCCESS_CLAIM" || kind === "RUNAWAY_LOOP" || kind === "STATE_LEAK_ACROSS_CONVERSATIONS";
      const finalSay = FINAL_SAY_CATEGORIES.includes(turn.stressCategory);
      if (always || (finalSay && ["WRONG_PRODUCT_DURABLE", "WRONG_QUANTITY_DURABLE", "CANCELLATION_IGNORED", "ACCIDENTAL_DUPLICATE", "MUTATION_AFTER_NEGATION"].includes(kind))) {
        blockers.push({ kind, conversation: turn.conversation, sequenceIndex: turn.sequenceIndex, message: turn.message, detail: `${kind} on ${turn.stressCategory} turn "${turn.message}" (expected ${JSON.stringify(turn.expectedItems)}, got ${JSON.stringify(turn.finalItems)})` });
      }
    }
  }
  if (crossConversationLeak) blockers.push({ kind: "STATE_LEAK_ACROSS_CONVERSATIONS", conversation: "A", sequenceIndex: -1, message: "(cross-conversation)", detail: "cross-conversation isolation check failed" });
  return blockers;
}

export type RobustnessResult = { signal: RobustnessSignal; reason: string; releaseBlockers: ReleaseBlocker[]; hardFailureCount: number };

export function deriveRobustnessSignal(all: readonly SoakTurnAnalysis[], crossConversationLeak: boolean, hardFailureCount: number): RobustnessResult {
  const releaseBlockers = findReleaseBlockers(all, crossConversationLeak);
  if (hardFailureCount > 0 || releaseBlockers.length > 0) {
    return { signal: "ROBUSTNESS_FAIL", reason: hardFailureCount > 0 ? `${hardFailureCount} HARD_FAILURE invariant violation(s)` : `${releaseBlockers.length} release blocker(s) found`, releaseBlockers, hardFailureCount };
  }
  const residualCategories: IntegrityFailureKind[] = ["STALE_INTENT_OVERWRITES_NEWER", "CASUAL_TURN_CHANGED_STATE", "ACCIDENTAL_SELECTION_DELETION"];
  const hasResiduals = all.some((turn) => turn.integrityFailures.some((kind) => residualCategories.includes(kind))) || all.some((turn) => turn.confirmationClass === "UNNECESSARY_CONFIRMATION" || turn.confirmationClass === "MISSING_FACT_QUESTION");
  if (hasResiduals) return { signal: "ROBUSTNESS_PASS_WITH_RESIDUALS", reason: "0 release blockers, 0 corruption, 0 cross-conversation leaks, but UX/grounding/re-question residuals remain", releaseBlockers: [], hardFailureCount: 0 };
  return { signal: "ROBUSTNESS_PASS", reason: "0 release blockers, 0 corruption, 0 cross-conversation leaks, no systematic severe failure", releaseBlockers: [], hardFailureCount: 0 };
}
