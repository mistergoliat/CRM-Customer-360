import { isPendingActionSentence, isQuestionSentence, splitIntoSentences } from "../commercialSentenceClassifier";

/**
 * ACS-R1-05-T06.2 (P1 correction). Replaces the deleted
 * hasPromiseOrSensitiveCommercialClaim with a narrow, evidence-independent
 * check for unconditional commercial commitments - never a bare topic word
 * (precio/stock/garantia/despacho/entrega/descuento alone never matches,
 * unlike the removed blacklist). A direct promise to the customer about a
 * future commercial state (stock, price, delivery, warranty, discount) is
 * unsafe regardless of any evidence the Sales Agent might cite, because
 * evidence only ever describes the current known state, never a guaranteed
 * future one - so this function intentionally never requires or inspects
 * evidence. Grounded, sourced factual statements
 * ("El precio informado por catalogo es $500.000") are governed separately,
 * WITH real evidence, by evaluateCommercialCommitmentGrounding.ts in the
 * policy layer (lib/brain/commercial/policy/) - this function never touches
 * that case.
 *
 * Every pattern below requires a specific conjugated verb form or a fixed
 * absolute-certainty phrase, never a bare stem - "no puedo garantizarte" and
 * "antes de confirmar el precio" never match because "garantizarte"
 * (infinitive+clitic) and "confirmar" (infinitive) are not the conjugated
 * forms below, and pending-action / question sentences are skipped first.
 */

const DIRECTED_PROMISE_VERB_PATTERN =
  /\bte\s+(garantizo|garantizamos|aseguro|aseguramos|confirmo|confirmamos|prometo|prometemos|mantengo|mantenemos|doy\s+mi\s+palabra)\b|\ble\s+(garantizo|aseguro|confirmo|prometo)\b/i;

const STANDALONE_PROMISE_VERB_PATTERN = /\b(garantizo|garantizamos|aseguro|aseguramos|prometo|prometemos|confirmamos)\b/i;

const PASSIVE_CERTAINTY_PATTERN =
  /\b(est(?:á|án)|qued(?:a|ó|an|aron)|ser(?:á|án))\s+(asegurad[oa]s?|garantizad[oa]s?|confirmad[oa]s?)\b/i;

const ABSOLUTE_CERTAINTY_MARKER_PATTERN =
  /\b(con\s+(?:toda\s+|total\s+)?seguridad|sin\s+ning[uú]n\s+problema|no\s+tendr(?:á|ás|án)\s+ning[uú]n\s+problemas?|sin\s+duda(?:\s+alguna)?|cien\s+por\s+ciento|100\s*%)\b/i;

const ABSOLUTE_COVERAGE_PATTERN = /\b(cubrir[aá]n?|resolver[aá]n?|soluciona(?:r[aá]n?)?|arreglar[aá]n?)\s+cualquier\b/i;

function sentenceHasCommitment(sentence: string): boolean {
  return (
    DIRECTED_PROMISE_VERB_PATTERN.test(sentence) ||
    STANDALONE_PROMISE_VERB_PATTERN.test(sentence) ||
    PASSIVE_CERTAINTY_PATTERN.test(sentence) ||
    ABSOLUTE_CERTAINTY_MARKER_PATTERN.test(sentence) ||
    ABSOLUTE_COVERAGE_PATTERN.test(sentence)
  );
}

export function hasUnsupportedCommercialCommitment(text: string): boolean {
  const sentences = splitIntoSentences(text);
  const candidates = sentences.length > 0 ? sentences : [text];

  return candidates.some((sentence) => {
    if (isQuestionSentence(sentence)) return false;
    if (isPendingActionSentence(sentence)) return false;
    return sentenceHasCommitment(sentence);
  });
}
