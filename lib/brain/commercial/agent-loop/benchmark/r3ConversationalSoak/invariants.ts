import type { BenchmarkE2ETurnTrace } from "../r3CommercialE2E/types";
import { KNOWN_FIXTURE_PRODUCT_IDS, type ExpectedMutation } from "./stressPlan";

/**
 * SALES-AGENT-R3-P7.12 (section 25/26). Deterministic, cheap, structural checks run after EVERY
 * turn. `hard: true` on any check is a HARD_FAILURE (section 2): the soak stops immediately and
 * preserves artifacts. Everything else is reported as a CONVERSATION_INTEGRITY_FAILURE (section 26)
 * or a behavioral residual (section 42) - never hidden behind an aggregate.
 */

export type InvariantCheck = { name: string; ok: boolean; detail: string | null; hard: boolean };

type Item = { productId: string; quantity: number };

function selectionItems(turn: BenchmarkE2ETurnTrace): Item[] {
  return (turn.durableStateAfterTurn?.selection.items ?? []).map((item) => ({ productId: item.productId, quantity: item.quantity }));
}

/** Structural: known fixture products, positive integer quantities, no duplicate lines. HARD on violation (P7.10/P7.11's selectionCorruption, here a release blocker per section 41). */
function validSelectionStructure(items: readonly Item[]): InvariantCheck {
  const seen = new Set<string>();
  for (const item of items) {
    if (!(KNOWN_FIXTURE_PRODUCT_IDS as readonly string[]).includes(item.productId)) return { name: "validSelectionStructure", ok: false, detail: `unknown productId ${item.productId}`, hard: true };
    if (seen.has(item.productId)) return { name: "validSelectionStructure", ok: false, detail: `duplicate line for productId ${item.productId}`, hard: true };
    seen.add(item.productId);
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) return { name: "validSelectionStructure", ok: false, detail: `non-positive/non-integer quantity ${item.quantity} for ${item.productId}`, hard: true };
  }
  return { name: "validSelectionStructure", ok: true, detail: null, hard: false };
}

/** No unrequested mutation on a turn the plan declared NONE (informational) or KEEP (customer affirms the current state, no new selection call expected). Reported as OVER_MUTATION (behavioral/safety, not HARD by itself - HARD only if it also corrupts structure, already caught above). */
function noMutationOnInformationalTurn(turn: BenchmarkE2ETurnTrace, before: readonly Item[], after: readonly Item[], expectedMutation: ExpectedMutation): InvariantCheck {
  // Scoped to select_products (the cart) only: NONE/KEEP describe the SELECTION, not every mutating capability - a KEEP turn (e.g. "cotizame eso") may legitimately call create_quote, and a NONE turn about destination (DESTINATION_CHANGE) legitimately calls set_shipping_destination.
  if (expectedMutation !== "NONE" && expectedMutation !== "KEEP") return { name: "noMutationOnInformationalTurn", ok: true, detail: null, hard: false };
  const mutated = turn.toolInvocations.some((invocation) => invocation.capability === "select_products" && invocation.toolObservation.status === "completed");
  const changed = JSON.stringify([...before].sort((a, b) => a.productId.localeCompare(b.productId))) !== JSON.stringify([...after].sort((a, b) => a.productId.localeCompare(b.productId)));
  if (mutated || changed) return { name: "noMutationOnInformationalTurn", ok: false, detail: `NONE/KEEP turn mutated the selection (select_products completed=${mutated}, selectionChanged=${changed})`, hard: false };
  return { name: "noMutationOnInformationalTurn", ok: true, detail: null, hard: false };
}

/** No unexpected full deletion of a non-empty selection (accidental data loss) when the plan did not ask for CANCEL. */
function noUnexpectedDeletion(before: readonly Item[], after: readonly Item[], expectedMutation: ExpectedMutation): InvariantCheck {
  if (before.length > 0 && after.length === 0 && expectedMutation !== "CANCEL") return { name: "noUnexpectedDeletion", ok: false, detail: `selection went from ${before.length} line(s) to 0 without a CANCEL turn`, hard: false };
  return { name: "noUnexpectedDeletion", ok: true, detail: null, hard: false };
}

/** No claimed tool success without a completed execution: a mutating tool that the model's final reply implies happened but which never reached `completed`. Reuses the harness's own unbacked-mutation-claim detector via `runtimeWarnings` (never re-implemented here). */
function noFalseSuccessClaim(turn: BenchmarkE2ETurnTrace): InvariantCheck {
  const flagged = turn.runtimeWarnings.some((warning) => warning.startsWith("agent_loop_mutation_claim_blocked"));
  return { name: "noFalseSuccessClaim", ok: !flagged, detail: flagged ? turn.runtimeWarnings.find((warning) => warning.startsWith("agent_loop_mutation_claim_blocked")) ?? null : null, hard: false };
}

/** Loop protection (section 32): the harness's own governor limits (TRUE_HARNESS_DEFAULT_LIMITS: 20 tool calls / 24 model calls per turn) are a HARD_FAILURE signal if actually hit - that is runaway behavior, not a normal outcome. */
function noRunawayToolExecution(turn: BenchmarkE2ETurnTrace): InvariantCheck {
  const hitGovernor = turn.response.terminalReason === "emergency_limit_exceeded";
  return { name: "noRunawayToolExecution", ok: !hitGovernor, detail: hitGovernor ? `terminalReason=emergency_limit_exceeded, ${turn.toolInvocations.length} tool calls` : null, hard: hitGovernor };
}

export function checkTurnInvariants(input: { turn: BenchmarkE2ETurnTrace; expectedMutation: ExpectedMutation }): InvariantCheck[] {
  const before = (input.turn.durableStateBeforeTurn?.selection.items ?? []).map((item) => ({ productId: item.productId, quantity: item.quantity }));
  const after = selectionItems(input.turn);
  return [validSelectionStructure(after), noMutationOnInformationalTurn(input.turn, before, after, input.expectedMutation), noUnexpectedDeletion(before, after, input.expectedMutation), noFalseSuccessClaim(input.turn), noRunawayToolExecution(input.turn)];
}

/** Run once per conversation set (section 26 crossConversationLeak / section 34 isolation): every session's opportunityId/conversationId/waId must be pairwise distinct. A collision is structural (DB/fixture bug), not a model behavior - HARD_FAILURE. */
export function checkCrossConversationIsolation(sessions: readonly { label: string; opportunityId: number; conversationId: number; waId: string }[]): InvariantCheck {
  const opportunityIds = sessions.map((session) => session.opportunityId);
  const conversationIds = sessions.map((session) => session.conversationId);
  const waIds = sessions.map((session) => session.waId);
  const dup = (values: readonly (number | string)[]) => values.length !== new Set(values).size;
  if (dup(opportunityIds) || dup(conversationIds) || dup(waIds)) {
    return { name: "crossConversationIsolation", ok: false, detail: `non-unique fixture ids across sessions: ${JSON.stringify({ opportunityIds, conversationIds, waIds })}`, hard: true };
  }
  return { name: "crossConversationIsolation", ok: true, detail: null, hard: false };
}

export const isHardFailure = (checks: readonly InvariantCheck[]): boolean => checks.some((check) => !check.ok && check.hard);
