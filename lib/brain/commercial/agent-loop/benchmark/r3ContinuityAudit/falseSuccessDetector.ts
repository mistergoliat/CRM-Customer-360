/**
 * P7.13 (task section 24). Benchmark-only, broader false-success detector -
 * NEVER the production guard (commercialMutationClaims.ts#checkUnbackedCommercialMutationClaim
 * stays untouched). P7.12 section 14 found the production detector's pattern
 * list too narrow ("Actualizo a N unidades", "Quedan anotadas" went
 * undetected) - this extends the phrase list per the task's explicit
 * examples, still a deterministic regex classifier, never an LLM judge.
 * "Backed" here is computed from this turn's own tool invocations
 * (continuitySession.ts already has that from buildTurnTrace), not from
 * AgentLoopResult.steps (unavailable at this call site - runSalesAgentRuntimeCycle
 * does not return the raw loop steps).
 */

const FALSE_SUCCESS_CLAIM_PATTERNS: readonly RegExp[] = [
  /actualiz[oé]\s+(la\s+)?(selecci[oó]n|cantidad|pedido|carrito)/i,
  /actualiz[oé]\s+a\s+\d+/i,
  /queda(n)?\s+anotad[ao]s?/i,
  /queda(n)?\s+en\s+\d+/i,
  /te\s+dej[oé]\s+(con\s+)?\d+/i,
  /agregu[eé]\s+\d+/i,
  /agrego\s+\d+/i,
  /ya\s+est[aá]\s+(agregad[ao]|actualizad[ao]|list[ao]|seleccionad[ao])/i,
  /listo,?\s+queda(n)?/i,
  /qued[oó]\s+(seleccionad[ao]|agregad[ao]|registrad[ao])/i,
  /prepar[oé]\s+\d+/i,
  /registr[eé]\s+\d+\s+unidad/i,
  /confirm[eoé]\s+(tu|la|el)\s+(selecci[oó]n|pedido|compra|cantidad)/i
];

export type ContinuityFalseSuccessCheck = { claimed: boolean; backed: boolean; unbacked: boolean; matchedPattern: string | null };

export function checkContinuityFalseSuccessClaim(input: {
  finalMessage: string | null;
  terminalReason: string;
  selectCompleted: boolean;
}): ContinuityFalseSuccessCheck {
  if (input.terminalReason !== "responded" || !input.finalMessage) {
    return { claimed: false, backed: false, unbacked: false, matchedPattern: null };
  }
  const matched = FALSE_SUCCESS_CLAIM_PATTERNS.find((pattern) => pattern.test(input.finalMessage as string));
  const claimed = matched !== undefined;
  const backed = input.selectCompleted;
  return { claimed, backed, unbacked: claimed && !backed, matchedPattern: matched?.source ?? null };
}
