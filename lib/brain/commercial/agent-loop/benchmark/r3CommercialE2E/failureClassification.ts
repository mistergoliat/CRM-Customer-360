import { turnHasUngroundedMutationClaim, turnHasUngroundedQuoteClaim, turnRepeatsKnownDestination, turnRepeatsKnownSelection } from "./conversationalSignals";
import type { BenchmarkE2ECase, BenchmarkE2ECaseOutcome, BenchmarkE2ECausalTraceLine, BenchmarkE2EFailureCategory, BenchmarkE2ETurnTrace } from "./types";

const DEPENDENCY_ERROR_CODE_PATTERN = /_(not_configured|unavailable)$/;
const INVALID_ARGUMENT_STATUS = "invalid_arguments";
const IDENTITY_DENIAL_ERROR_CODES = new Set(["master_identity_required", "identity_context_unavailable", "identity_requirement_unresolved"]);

function buildCausalTraceLine(turn: BenchmarkE2ETurnTrace, invocationIndex: number): BenchmarkE2ECausalTraceLine[] {
  const invocation = turn.toolInvocations[invocationIndex];
  const lines: BenchmarkE2ECausalTraceLine[] = [];
  if (invocation.eligibilityAtTurnStart) {
    lines.push(`Turn ${turn.turnOrdinal}: ${invocation.capability} eligibilityAtTurnStart=${invocation.eligibilityAtTurnStart.status}${invocation.eligibilityAtTurnStart.reasonCodes.length > 0 ? ` (${invocation.eligibilityAtTurnStart.reasonCodes.join(",")})` : ""}`);
  }
  lines.push(`Turn ${turn.turnOrdinal}: model requested ${invocation.capability}`);
  if (invocation.gateway) lines.push(`Turn ${turn.turnOrdinal}: gateway ${invocation.gateway.status}${invocation.gateway.errorCode ? ` (${invocation.gateway.errorCode})` : ""}`);
  if (invocation.inTurnEvidence.relevantEvidenceProduced.length > 0) {
    lines.push(`Turn ${turn.turnOrdinal}: in-turn evidence ${invocation.inTurnEvidence.relevantEvidenceProduced.join(",")} (blockerPotentiallyChanged=${invocation.inTurnEvidence.blockerPotentiallyChanged})`);
  }
  lines.push(`Turn ${turn.turnOrdinal}: toolObservation=${invocation.toolObservation.status}${invocation.toolObservation.errorCode ? ` (${invocation.toolObservation.errorCode})` : ""}`);
  return lines;
}

function findInvocation(turns: readonly BenchmarkE2ETurnTrace[], predicate: (invocation: BenchmarkE2ETurnTrace["toolInvocations"][number]) => boolean) {
  for (const turn of turns) {
    const index = turn.toolInvocations.findIndex(predicate);
    if (index >= 0) return { turn, index };
  }
  return null;
}

/**
 * SALES-AGENT-R3-P7.4 (Section "FAILURE CLASSIFICATION"). Ordered,
 * structural checks - "no clasificar automáticamente todo rejection como
 * model failure": dependency/identity-fixture/gateway causes are checked
 * BEFORE ever attributing MODEL_REASONING. Every causal trace line is
 * derived from already-typed trace fields, never CoT/free text.
 */
export function classifyFailure(testCase: BenchmarkE2ECase, turns: readonly BenchmarkE2ETurnTrace[], outcome: Pick<BenchmarkE2ECaseOutcome, "expectationResults" | "forbiddenViolations">): { category: BenchmarkE2EFailureCategory; reason: string; causalTrace: BenchmarkE2ECausalTraceLine[] } {
  const dependencyFailure = findInvocation(turns, (invocation) => Boolean(invocation.toolObservation.errorCode && DEPENDENCY_ERROR_CODE_PATTERN.test(invocation.toolObservation.errorCode)));
  if (dependencyFailure) {
    return { category: "DEPENDENCY_FAILURE", reason: `${dependencyFailure.turn.toolInvocations[dependencyFailure.index].capability} failed on an unconfigured/unavailable dependency`, causalTrace: buildCausalTraceLine(dependencyFailure.turn, dependencyFailure.index) };
  }

  if (testCase.expected.identitySufficientForMutation === true && outcome.expectationResults.identitySufficientForMutation === false) {
    const denial = findInvocation(turns, (invocation) => Boolean((invocation.gateway?.errorCode && IDENTITY_DENIAL_ERROR_CODES.has(invocation.gateway.errorCode)) || (invocation.toolObservation.errorCode && IDENTITY_DENIAL_ERROR_CODES.has(invocation.toolObservation.errorCode))));
    if (denial) {
      return { category: "IDENTITY_FIXTURE", reason: "case expected sufficient identity but the identity gate denied the mutation - the injected trustedCustomerSession fixture likely does not carry the identity level this case declared", causalTrace: buildCausalTraceLine(denial.turn, denial.index) };
    }
  }

  // P7.6. A run whose turn hit the deadline never had a complete opportunity
  // to behave, so it is attributed to TIMEOUT before any behavioral category.
  // ponytail: this can shadow a behavioral omission in an earlier turn of the
  // same run; behavior is read from toolInvocations, never from this label.
  const timedOut = turns.find((candidate) => candidate.response.terminalReason === "timeout");
  if (timedOut) {
    const providerMs = timedOut.providerCalls.reduce((total, call) => total + (call.elapsedMs ?? 0), 0);
    return {
      category: "TIMEOUT",
      reason: "a turn ended at the loop deadline before the model could finish",
      causalTrace: [
        `Turn ${timedOut.turnOrdinal}: terminalReason=timeout after ${timedOut.providerCalls.length} provider call(s) totaling ${providerMs} ms`,
        `Turn ${timedOut.turnOrdinal}: ${timedOut.toolInvocations.length} tool invocation(s) reached the Gateway before the deadline`
      ]
    };
  }

  const eligibilityIgnored = findInvocation(
    turns,
    (invocation) => invocation.eligibilityAtTurnStart?.status === "BLOCKED" && !invocation.inTurnEvidence.blockerPotentiallyChanged && invocation.toolObservation.status !== "completed"
  );
  if (eligibilityIgnored) {
    return { category: "ELIGIBILITY_IGNORED", reason: `${eligibilityIgnored.turn.toolInvocations[eligibilityIgnored.index].capability} was requested while BLOCKED with no relevant evidence produced this turn, and the Gateway did not complete it`, causalTrace: buildCausalTraceLine(eligibilityIgnored.turn, eligibilityIgnored.index) };
  }

  const invalidArguments = findInvocation(turns, (invocation) => invocation.gateway?.status === INVALID_ARGUMENT_STATUS);
  if (invalidArguments) {
    return { category: "ARGUMENT_BUILDING", reason: `${invalidArguments.turn.toolInvocations[invalidArguments.index].capability} was rejected for invalid_arguments`, causalTrace: buildCausalTraceLine(invalidArguments.turn, invalidArguments.index) };
  }

  const gatewayRejection = findInvocation(turns, (invocation) => invocation.gateway !== null && invocation.gateway.status !== "completed");
  if (gatewayRejection) {
    return { category: "GATEWAY_REJECTION", reason: `${gatewayRejection.turn.toolInvocations[gatewayRejection.index].capability} reached the Gateway but did not complete (${gatewayRejection.turn.toolInvocations[gatewayRejection.index].gateway?.status})`, causalTrace: buildCausalTraceLine(gatewayRejection.turn, gatewayRejection.index) };
  }

  if (outcome.forbiddenViolations.includes("repeatKnownDestination") || outcome.forbiddenViolations.includes("repeatKnownSelection")) {
    const turn = turns.find((candidate) => turnRepeatsKnownDestination(candidate) || turnRepeatsKnownSelection(candidate));
    return {
      category: "STATE_CONTINUITY",
      reason: "the model re-requested a fact the durable state already showed CURRENT at turn start",
      causalTrace: turn ? [`Turn ${turn.turnOrdinal}: durableStateBeforeTurn already showed the fact CURRENT`, `Turn ${turn.turnOrdinal}: model requested it again anyway`] : []
    };
  }

  if (outcome.expectationResults.requiredToolsAnyTurn === false || outcome.expectationResults.forbiddenToolsAnyTurn === false) {
    return { category: "TOOL_SELECTION", reason: "required tool never completed, or a forbidden tool was invoked", causalTrace: [] };
  }

  if (
    outcome.expectationResults.quoteExists === false ||
    outcome.expectationResults.destinationExists === false ||
    outcome.expectationResults.selectionExists === false ||
    outcome.expectationResults.minSelectionItemCount === false
  ) {
    const anyCompletedRelevantTool = turns.some((turn) => turn.toolInvocations.some((invocation) => invocation.toolObservation.status === "completed" && ["select_products", "set_shipping_destination", "create_quote"].includes(invocation.capability)));
    if (anyCompletedRelevantTool) {
      return { category: "DURABLE_STATE_FAILURE", reason: "a tool reported completed but the expected durable state was not observed afterward", causalTrace: [] };
    }
  }

  if (outcome.forbiddenViolations.includes("ungroundedQuoteClaim") || outcome.forbiddenViolations.includes("ungroundedMutationClaim")) {
    const turn = turns.find((candidate) => turnHasUngroundedQuoteClaim(candidate) || turnHasUngroundedMutationClaim(candidate));
    return { category: "MODEL_REASONING", reason: "the response claimed a commercial outcome the durable state does not back", causalTrace: turn ? [`Turn ${turn.turnOrdinal}: response text claimed an outcome`, `Turn ${turn.turnOrdinal}: durable state after the turn does not confirm it`] : [] };
  }

  const lastTurn = turns[turns.length - 1];
  if (lastTurn && lastTurn.response.status === "responded" && lastTurn.outbox.attempted && !lastTurn.outbox.outboxWritten) {
    return { category: "OUTBOX_FAILURE", reason: "a responded turn attempted dispatch but never wrote an outbox row", causalTrace: [`Turn ${lastTurn.turnOrdinal}: response.status=responded, outbox.attempted=true, outbox.outboxWritten=false`] };
  }

  if (outcome.expectationResults.finalObjectiveType === false || outcome.expectationResults.terminalReasonLastTurn === false) {
    return { category: "MODEL_REASONING", reason: "final objective or terminal reason did not match the case's expectation with no other structural cause identified", causalTrace: [] };
  }

  return { category: "UNKNOWN", reason: "one or more expectations/forbidden checks failed with no matching classification rule", causalTrace: [] };
}
