/**
 * ACS-R1-05-T06.2 (P1 correction). Shared, deterministic sentence-level
 * classification used by both the autonomy sandbox (commitment detection,
 * detectUnsupportedCommercialCommitment.ts) and commercial policy
 * (grounding detection, evaluateCommercialCommitmentGrounding.ts) so both
 * layers agree on what counts as a question or a pending/tentative action.
 * A sentence in either category is never treated as a commercial commitment
 * or a claim requiring evidence, regardless of which commercial topic it
 * mentions - this is what keeps "¿Quieres que revise el precio?" and "Voy a
 * consultar el stock." from ever being flagged, without needing to inspect
 * evidence at all.
 */

export function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

const QUESTION_PATTERN = /[?¿]/;

export function isQuestionSentence(sentence: string): boolean {
  return QUESTION_PATTERN.test(sentence);
}

const PENDING_ACTION_PATTERN =
  /\b(voy a|vamos a|necesito|necesitamos|debo|debemos|tengo que|tenemos que|dejar[eé]|dejaremos|puedo revisar|podemos revisar|queda(?:r[aá])?\s+pendiente)\b/i;

export function isPendingActionSentence(sentence: string): boolean {
  return PENDING_ACTION_PATTERN.test(sentence);
}
