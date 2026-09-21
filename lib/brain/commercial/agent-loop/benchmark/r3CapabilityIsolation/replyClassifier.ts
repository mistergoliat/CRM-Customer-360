/**
 * SALES-AGENT-R3-P7.9. The reply detector, PRE-REGISTERED and frozen before any
 * P7.9 batch (its sha256 is in the manifest; the run script refuses to start if
 * the file changed after the smoke). It is the corrected P7.8-R "strict" detector
 * turned into a golden-set-backed classifier: 54 real P7.8-R Q- replies (labelled
 * by hand while reading them) plus the spec examples live in
 * tests/agent-loop/benchmark/r3CapabilityIsolation/goldenReplies.json.
 *
 * Benchmark-only regex heuristics over the customer-facing reply, never an LLM
 * judge, never production. Classes, in priority order:
 *  1. CORRECT_QUANTITY_REQUEST - a sentence that asks HOW MANY / which quantity
 *     (a question, or an indirect request such as "indicame cuantas unidades").
 *  2. GENERIC_CONFIRMATION - a question that only offers to advance ("la agrego?",
 *     "avanzamos?", "quieres revisarlo?", "te la dejo apartada?"). An "add" offer
 *     wins over a link mention in the same question.
 *  3. LINK_OFFER - a question that offers to send the link/URL.
 *  4. OTHER_QUESTION - any other question (e.g. asks which product).
 *  5. PRODUCT_INFORMATION - no question at all.
 *  NO_REPLY - empty / null (a turn that ended without a final message).
 */
export const REPLY_DETECTOR_VERSION = "p7.9-reply-detector-v1" as const;

export const REPLY_CLASSES = ["CORRECT_QUANTITY_REQUEST", "GENERIC_CONFIRMATION", "LINK_OFFER", "OTHER_QUESTION", "PRODUCT_INFORMATION", "NO_REPLY"] as const;
export type ReplyClass = (typeof REPLY_CLASSES)[number];

// "cuanto/cuanta" (singular) is excluded on purpose: it is "cuanto cuesta".
const QUANTITY_PATTERN = /cu[aá]nt(as|os)\b|qu[eé] cantidad|cantidad (de unidades|que|deseas|necesit|quieres|requieres)|n[uú]mero de unidades|\b(una|un|uno|1) o (dos|2|m[aá]s|varias)\b/i;
// An indirect request ("indicame cuantas ...", "si me confirmas cuantas ...") is a request even without a question mark.
const REQUEST_CUE = /\b(ind[ií]came|d[ií]me|conf[ií]rmame|necesito|si me (confirmas|indicas|dices|avisas)|me (indicas|confirmas|dices))\b/i;
// Extended once, BEFORE the freeze, after the smoke showed "¿Confirmo las 2 unidades?" and "¿... te arme una cotizacion?" falling into OTHER_QUESTION:
// confirming a stated order/quantity and offering to build a quote are advance offers too. "¿Me confirmas el modelo exacto?" stays OTHER_QUESTION (no order object).
const ADVANCE_PATTERN = /agreg|a[nñ]ad|apart|reserv|avanz|continu|seguimos|proceder|te interesa|quieres revis|deseas|llev(o|ar|as|amos)\b|compr(ar|o|amos)\b|cotiz(o|ar|amos)\b|cotizaci[oó]n|arm(e|o|ar|amos)\b|te (la|lo) dejo|conf[ií]rm(o|as|amos)\b[^?]*\b(unidades?|pedido|compra|orden|selecci[oó]n|cantidad|\d+)/i;
const LINK_PATTERN = /\blink\b|enlace|\burl\b/i;

function sentencesOf(text: string): string[] {
  return text.split(/(?<=[?!.])\s+|\n+/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0);
}

export function classifyReply(message: string | null | undefined): ReplyClass {
  const text = message?.trim() ?? "";
  if (text.length === 0) return "NO_REPLY";
  const sentences = sentencesOf(text);
  const isQuestion = (sentence: string) => /[?¿]/.test(sentence);
  if (sentences.some((sentence) => QUANTITY_PATTERN.test(sentence) && (isQuestion(sentence) || REQUEST_CUE.test(sentence)))) return "CORRECT_QUANTITY_REQUEST";
  const questions = sentences.filter(isQuestion);
  if (questions.length === 0) return "PRODUCT_INFORMATION";
  if (questions.some((question) => ADVANCE_PATTERN.test(question))) return "GENERIC_CONFIRMATION";
  if (questions.some((question) => LINK_PATTERN.test(question))) return "LINK_OFFER";
  return "OTHER_QUESTION";
}

export const asksForQuantity = (message: string | null | undefined): boolean => classifyReply(message) === "CORRECT_QUANTITY_REQUEST";
