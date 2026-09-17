import {
  caseHasGreetingRepetition,
  turnHasUngroundedMutationClaim,
  turnHasUngroundedQuoteClaim,
  turnRepeatsKnownDestination,
  turnRepeatsKnownSelection
} from "./conversationalSignals";
import type { BenchmarkE2ECase, BenchmarkE2ECaseOutcome, BenchmarkE2EDurableStateSnapshot, BenchmarkE2ETurnTrace } from "./types";

const IDENTITY_DENIAL_ERROR_CODES = new Set(["master_identity_required", "identity_context_unavailable", "identity_requirement_unresolved"]);

function completedCapabilitiesAnyTurn(turns: readonly BenchmarkE2ETurnTrace[]): Set<string> {
  return new Set(turns.flatMap((turn) => turn.toolInvocations.filter((invocation) => invocation.toolObservation.status === "completed").map((invocation) => invocation.capability)));
}

function requestedCapabilitiesAnyTurn(turns: readonly BenchmarkE2ETurnTrace[]): Set<string> {
  return new Set(turns.flatMap((turn) => turn.toolInvocations.map((invocation) => invocation.capability)));
}

function identityDeniedThisRun(turns: readonly BenchmarkE2ETurnTrace[]): boolean {
  return turns.some((turn) => turn.toolInvocations.some((invocation) => (invocation.gateway?.errorCode && IDENTITY_DENIAL_ERROR_CODES.has(invocation.gateway.errorCode)) || (invocation.toolObservation.errorCode && IDENTITY_DENIAL_ERROR_CODES.has(invocation.toolObservation.errorCode))));
}

/**
 * SALES-AGENT-R3-P7.4 (Section "CASE EXPECTATIONS"). Pure scoring: outcome +
 * invariants, never a required tool sequence unless the case opts into
 * requiredToolsAnyTurn/forbiddenToolsAnyTurn (the legacy tool-selection
 * dimension, kept for cases specifically about that - Section "NO VOLVER...").
 */
export function scoreCase(
  testCase: BenchmarkE2ECase,
  turns: readonly BenchmarkE2ETurnTrace[],
  finalState: BenchmarkE2EDurableStateSnapshot | null
): Omit<BenchmarkE2ECaseOutcome, "status" | "failure"> {
  const expected = testCase.expected;
  const results: Record<string, boolean | null> = {};

  if (expected.finalObjectiveType !== undefined) results.finalObjectiveType = (finalState?.objectiveType ?? null) === expected.finalObjectiveType;
  if (expected.quoteExists !== undefined) results.quoteExists = (finalState?.quote.present ?? false) === expected.quoteExists;
  if (expected.destinationExists !== undefined) results.destinationExists = (finalState?.destination.present ?? false) === expected.destinationExists;
  if (expected.selectionExists !== undefined) results.selectionExists = (finalState?.selection.present ?? false) === expected.selectionExists;
  if (expected.minSelectionItemCount !== undefined) results.minSelectionItemCount = (finalState?.selection.itemCount ?? 0) >= expected.minSelectionItemCount;
  if (expected.identitySufficientForMutation !== undefined) {
    const denied = identityDeniedThisRun(turns);
    results.identitySufficientForMutation = expected.identitySufficientForMutation ? !denied : denied;
  }
  if (expected.terminalReasonLastTurn !== undefined) {
    const last = turns[turns.length - 1];
    results.terminalReasonLastTurn = (last?.response.terminalReason ?? null) === expected.terminalReasonLastTurn;
  }
  if (expected.requiredToolsAnyTurn) {
    const completed = completedCapabilitiesAnyTurn(turns);
    results.requiredToolsAnyTurn = expected.requiredToolsAnyTurn.every((tool) => completed.has(tool));
  }
  if (expected.forbiddenToolsAnyTurn) {
    const requested = requestedCapabilitiesAnyTurn(turns);
    results.forbiddenToolsAnyTurn = !expected.forbiddenToolsAnyTurn.some((tool) => requested.has(tool));
  }

  const forbiddenViolations: string[] = [];
  const forbidden = testCase.forbidden;
  if (forbidden.repeatKnownDestination && turns.some(turnRepeatsKnownDestination)) forbiddenViolations.push("repeatKnownDestination");
  if (forbidden.repeatKnownSelection && turns.some(turnRepeatsKnownSelection)) forbiddenViolations.push("repeatKnownSelection");
  if (forbidden.ungroundedQuoteClaim && turns.some(turnHasUngroundedQuoteClaim)) forbiddenViolations.push("ungroundedQuoteClaim");
  if (forbidden.ungroundedMutationClaim && turns.some(turnHasUngroundedMutationClaim)) forbiddenViolations.push("ungroundedMutationClaim");
  if (forbidden.greetingRepetition && caseHasGreetingRepetition(turns)) forbiddenViolations.push("greetingRepetition");

  return { expectationResults: results, forbiddenViolations };
}

export function caseOutcomePassed(outcome: Pick<BenchmarkE2ECaseOutcome, "expectationResults" | "forbiddenViolations">): boolean {
  const expectationsPassed = Object.values(outcome.expectationResults).every((value) => value !== false);
  return expectationsPassed && outcome.forbiddenViolations.length === 0;
}
