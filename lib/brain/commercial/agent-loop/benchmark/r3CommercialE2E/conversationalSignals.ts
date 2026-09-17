import type { BenchmarkE2ETurnTrace } from "./types";

/**
 * SALES-AGENT-R3-P7.4 (Sections "REQUESTION / KNOWN FACT DETECTION" /
 * "MUTATION GROUNDING" / "HISTORICAL FAILURES TO PRESERVE"). Deterministic,
 * structural detectors only - no LLM judge, no bare substring match where a
 * structured signal already exists.
 *
 * ponytail: turnRepeatsKnownDestination/Selection cannot, on their own,
 * distinguish "the model uselessly re-confirmed an already-current fact"
 * from "the customer genuinely changed their mind" (both re-invoke the same
 * capability against an already-CURRENT fact) - that distinction needs
 * intent, which this harness deliberately does not infer from free text.
 * The resolution lives one layer up, at scoring time: scoreCase.ts only
 * treats a true return from these functions as a violation for a case that
 * explicitly opts in via forbidden.repeatKnownDestination/repeatKnownSelection
 * (e.g. "destination already known", never "replace selection" or "customer
 * changes mind", which never set that flag). Upgrade path: a real intent
 * signal (e.g. the model's own tool-call rationale, if one is ever added to
 * AgentStepUseTool) would let this move out of the opt-in model.
 */

export function turnRepeatsKnownDestination(turn: BenchmarkE2ETurnTrace): boolean {
  const before = turn.durableStateBeforeTurn;
  if (!before || !(before.destination.present && before.destination.freshness === "CURRENT")) return false;
  return turn.toolInvocations.some((invocation) => invocation.capability === "set_shipping_destination" && invocation.toolObservation.status === "completed");
}

export function turnRepeatsKnownSelection(turn: BenchmarkE2ETurnTrace): boolean {
  const before = turn.durableStateBeforeTurn;
  if (!before || !(before.selection.present && before.selection.freshness === "CURRENT")) return false;
  return turn.toolInvocations.some((invocation) => invocation.capability === "select_products" && invocation.toolObservation.status === "completed");
}

/**
 * Benchmark-only heuristic, never production - same narrow-regex discipline
 * r3StableAgentV1/scoreGoldenCase.ts's own CM-005 check already established
 * for quote-confirmation language (that check is not exported and operates
 * on AgentLoopResult.steps, which SalesAgentRuntimeCycleResult never
 * populates - see runSalesAgentRuntimeCycle.ts's own comment - so this is a
 * distinct, adapted implementation, not a duplicate).
 *
 * Deliberately checks durableStateAfterTurn (cumulative truth), never
 * "was create_quote invoked THIS turn" - Section "MUTATION GROUNDING"
 * explicitly forbids penalizing a correct response merely because the
 * mutation happened in an earlier turn.
 */
const QUOTE_CONFIRMATION_CLAIM_PATTERN = /\b(cotizaci[oó]n|presupuesto)\b.*\b(list[ao]|generad[ao]|preparad[ao]|envi[ea]d[ao])\b/i;

export function turnHasUngroundedQuoteClaim(turn: BenchmarkE2ETurnTrace): boolean {
  if (!turn.response.finalMessage) return false;
  if (!QUOTE_CONFIRMATION_CLAIM_PATTERN.test(turn.response.finalMessage)) return false;
  return !(turn.durableStateAfterTurn?.quote.present ?? false);
}

/** Reuses the real production guard's own warning (agent_loop_mutation_claim_blocked:) - never a reimplemented regex. */
export function turnHasUngroundedMutationClaim(turn: BenchmarkE2ETurnTrace): boolean {
  return turn.runtimeWarnings.some((warning) => warning.startsWith("agent_loop_mutation_claim_blocked:"));
}

const GREETING_OPENING_PATTERN = /^\s*(hola|buen[oa]s\s+(d[ií]as|tardes|noches)|qu[eé]\s+tal)/i;

export function turnOpensWithGreeting(turn: BenchmarkE2ETurnTrace): boolean {
  return turn.response.finalMessage !== null && GREETING_OPENING_PATTERN.test(turn.response.finalMessage);
}

/** Section "HISTORICAL FAILURES TO PRESERVE" - "No saludar repetidamente durante misma conversación." Scoped to this one case-run's own turns only. */
export function caseHasGreetingRepetition(turns: readonly BenchmarkE2ETurnTrace[]): boolean {
  return turns.filter(turnOpensWithGreeting).length > 1;
}
