import type { AgentLoopResult } from "../agentStepTypes";

/**
 * LLM-R1-T08C, Parte 8. Benchmark-only heuristic: does this turn's final
 * customer-facing message CLAIM a product selection/quantity/order mutation
 * is already done, without a `select_products` observation this turn
 * actually completing it? Never used by production or by runAgentToolLoop.ts -
 * text-pattern matching over `finalMessage` only, never persisted, never fed
 * back into any prompt.
 *
 * Deliberately narrow (surgical, matching T08C's own scope constraint): only
 * select_products/commercial-selection claims, never generalized to every
 * capability. Patterns are grounded in the real phrasing observed in T08B's
 * live raw output (docs/releases/LLM-R1-T08B-deepseek-thinking-mode-benchmark.md,
 * "Hallazgo critico" section) - both the unbacked ones ("te dejo 3 unidades...")
 * and the backed ones from Config A that use similar confident language
 * ("quedaron seleccionadas 3 unidades..."). Over-matching "claimed" is safe:
 * `unbacked` only fires when a claim is ALSO not backed by real evidence, so
 * a message that claims a mutation the tool genuinely completed is never
 * flagged, regardless of how many claim patterns it happens to match.
 */
// JS's \b is ASCII-only (relative to \w = [A-Za-z0-9_]) - "é"/"í"/"ó" are NOT
// word characters to it, so a pattern like /agregu[eé]\b/ never matches
// "agregué" (no boundary exists between a non-word "é" and a following
// space, both non-word). WORD_END sidesteps this with an explicit lookahead
// instead of relying on \b after an accented vowel.
const WORD_END = "(?=\\s|[.,;:!?)]|$)";

const COMMERCIAL_MUTATION_CLAIM_PATTERNS: RegExp[] = [
  // "te dejo/dejé/agrego/agregué/preparo/preparé 3 unidades..." - present and
  // past tense both read as a completion claim ("te agrego" = "I'm putting
  // 2 units in for you", not a future/conditional offer).
  new RegExp(`\\bte\\s+(dej[eoé]|agreg[oé]|prepar[oé])${WORD_END}`, "i"),
  /\bqued(ó|aron)\s+(seleccionad|agregad|registrad|list[oa])/i, // "quedó/quedaron seleccionadas...", "quedó lista tu selección"
  new RegExp(`\\bregistr[eé]${WORD_END}`, "i"), // "registré 3 unidades"
  new RegExp(`\\bagregu[eé]${WORD_END}`, "i"), // "agregué 2 unidades"
  /\bconfirm(ad[oa]|[eoé])\s+(tu|la|el)\s+(selecci[oó]n|pedido|compra|cantidad)/i,
  // Implicit confirmation with no explicit verb: "Perfecto, 2 unidades...",
  // "Perfecto, son 2 unidades..." - a bare restatement of the requested
  // quantity right after an acknowledgment opener reads as confirming it is
  // set, exactly like the explicit-verb forms above.
  /\b(perfecto|listo|entendido|dale|claro)[,.]?\s+(son\s+)?\d+\s+unidad/i
];

export type UnbackedCommercialMutationClaimCheck = {
  /** The final message matched at least one commercial-mutation-claim pattern. */
  claimed: boolean;
  /** A select_products observation with status "completed" exists among this turn's steps. */
  backed: boolean;
  /** claimed && !backed - the metric this task cares about. */
  unbacked: boolean;
  matchedPattern: string | null;
};

/**
 * Only evaluates a turn that actually produced a customer-facing message
 * (terminalReason "responded") - a timeout/handoff/provider_unavailable turn
 * never claims anything to the customer, so it is never "unbacked" by this
 * definition (a separate, already-existing metric - terminalReasonCorrectness -
 * covers whether THAT outcome itself was correct).
 */
export function checkUnbackedCommercialMutationClaim(loop: Pick<AgentLoopResult, "terminalReason" | "finalMessage" | "steps">): UnbackedCommercialMutationClaimCheck {
  if (loop.terminalReason !== "responded" || !loop.finalMessage) {
    return { claimed: false, backed: false, unbacked: false, matchedPattern: null };
  }

  const matched = COMMERCIAL_MUTATION_CLAIM_PATTERNS.find((pattern) => pattern.test(loop.finalMessage as string));
  if (!matched) {
    return { claimed: false, backed: false, unbacked: false, matchedPattern: null };
  }

  const backed = loop.steps.some(
    (record) => record.step.type === "use_tool" && record.step.tool === "select_products" && record.observation?.status === "completed"
  );

  return { claimed: true, backed, unbacked: !backed, matchedPattern: matched.source };
}
