/**
 * SALES-AGENT-R3-P7.10. The confirmation classifier, PRE-REGISTERED and frozen before any
 * P7.10 batch (its sha256 and the golden file's sha256 are in the manifest; the run script
 * refuses to start if either changed after the smoke). Benchmark-only regex heuristics over
 * the customer-facing reply, never an LLM judge, never production.
 *
 * Classes (priority order):
 *  ACTION_EXECUTED          the ToolObservation of a select_products call in the turn is
 *                           `completed`. The reply text is irrelevant: a text claim WITHOUT
 *                           a completed tool call is never ACTION_EXECUTED (it is OTHER).
 *  MISSING_FACT_QUESTION    (1) a question/request that asks how many / which quantity.
 *  UNNECESSARY_CONFIRMATION (2) a question/request that asks permission or confirmation to
 *                           persist / advance a selection ("¿confirmas las 2?", "¿la agrego?",
 *                           "¿avanzo?", "¿te las dejo guardadas?", "¿te armo una cotizacion?").
 *                           Whether it is really UNNECESSARY depends on the turn: the metric
 *                           only applies it on ACTIONABLE turns, where every fact is known.
 *  MISSING_FACT_QUESTION    (3) a question/request that asks which product/model, the
 *                           destination or another customer fact.
 *  OTHER                    any other question, an unbacked action claim, or an empty reply.
 *  INFORMATIONAL_RESPONSE   no question and no unbacked action claim.
 */
export const CONFIRMATION_CLASSIFIER_VERSION = "p7.10-confirmation-classifier-v1" as const;

export const CONFIRMATION_CLASSES = ["UNNECESSARY_CONFIRMATION", "MISSING_FACT_QUESTION", "INFORMATIONAL_RESPONSE", "ACTION_EXECUTED", "OTHER"] as const;
export type ConfirmationClass = (typeof CONFIRMATION_CLASSES)[number];

// "cuanto/cuanta" (singular) is excluded on purpose: it is "cuanto cuesta".
const QUANTITY_QUESTION = /cu[aá]nt(as|os)\b|qu[eé] cantidad|cantidad (de unidades|que|deseas|necesit|quieres|requieres)|n[uú]mero de unidades|\b(una|un|uno|1) o (dos|2|m[aá]s|varias)\b/i;
const PRODUCT_QUESTION =
  /a qu[eé] (producto|barra|modelo)|qu[eé] (producto|barra|modelo)\b|cu[aá]l (de (las|los|ellas|ellos)|barra|modelo|producto|prefieres|quieres)|te refieres|which (product|one|model)|m[aá]s contexto|\b(classic|pro) o (la |el )?(classic|pro)\b|modelo (exacto|espec[ií]fico)/i;
const OTHER_FACT_QUESTION = /comuna|direcci[oó]n|correo|e-?mail|\brut\b|tel[eé]fono/i;
const PRODUCT_OR_FACT_QUESTION = new RegExp(`${PRODUCT_QUESTION.source}|${OTHER_FACT_QUESTION.source}`, "i");
const NUMBER_WORD = "\\d+|una?|dos|tres|cuatro|cinco";
const CONFIRM_OBJECT = new RegExp(`conf[ií]rm(o|as|amos|ame)\\b[^?.]*\\b(unidades?|pedido|compra|orden|selecci[oó]n|cantidad|que|las|los|esas?|esos?|${NUMBER_WORD})\\b`, "i");
const RESTATE_QUANTITY = new RegExp(`\\b(entonces|o sea)\\b[^?]*\\b(${NUMBER_WORD})\\b|\\b(son|ser[ií]an)\\b[^?]*\\b(\\d+|dos|tres|cuatro|cinco)\\b[^?]*unidades?`, "i");
const ADVANCE = /agreg|a[nñ]ad|apart|reserv|avanz|continu|seguimos|proced|te interesa|deseas|te parece|correcto|de acuerdo|\bdej(o|e|emos|amos|arla|arlas|arlo|arlos)\b|guard(o|e|ar|amos)|selecci[oó]n|seleccion|anot(o|e|ar)\b|\bsum(o|e|ar)\b|\bpong(o|a|amos)\b|llev(o|ar|as|amos)\b|compr(ar|o|amos)\b|cotiz(o|e|ar|amos)\b|cotizaci[oó]n|arm(e|o|ar|amos)\b|te (la|lo|las|los) (dejo|agrego|aparto|reservo)/i;
// A statement-form request ("indicame cuantas ...", "confirmame si ...", "avisame si ...") is a request even without a question mark.
const REQUEST_CUE = /\b(ind[ií]came|d[ií]me|conf[ií]rmame|av[ií]same|necesito que me|si me (confirmas|indicas|dices|avisas)|me (indicas|confirmas|dices))\b/i;
// An action reported in the past tense. Only meaningful WITHOUT a completed tool call (then it is an unbacked claim).
// (JS \b treats accented letters as non-word characters, so accented endings use an explicit lookahead instead.)
const ACTION_CLAIM = /\b(dej[eé]|agreg[uú]?[eé]|a[nñ]ad[ií]|guard[eé]|anot[eé]|sum[eé]|registr[eé])(?![a-záéíóúñ])|\bqued[oó]\s+(guardad|seleccionad|registrad|agregad|list)|\bya (est[aá]n?|tienes)(?![a-záéíóúñ])|\b(agregad|seleccionad|guardad)[oa]s?\b|\blist[oa]\s*[,.!]/i;

function sentencesOf(text: string): string[] {
  return text.split(/(?<=[?!.])\s+|\n+/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0);
}

const askingSentences = (text: string): string[] => sentencesOf(text).filter((sentence) => /[?¿]/.test(sentence) || REQUEST_CUE.test(sentence));

/**
 * Sub-kind of a MISSING_FACT_QUESTION reply (residual taxonomy of declarative failures; the five
 * classes above are unchanged). A reply that asks for the quantity is QUANTITY_REQUESTION even if
 * it also asks something else; otherwise a question about which product/model is PRODUCT_REQUESTION;
 * anything else (destination, contact data) is OTHER_FACT_REQUEST. null when the reply is not a
 * missing-fact question at all.
 */
export const MISSING_FACT_KINDS = ["QUANTITY_REQUESTION", "PRODUCT_REQUESTION", "OTHER_FACT_REQUEST"] as const;
export type MissingFactKind = (typeof MISSING_FACT_KINDS)[number];

export function classifyMissingFactKind(reply: string | null | undefined): MissingFactKind | null {
  if (classifyConfirmation({ reply, selectCompleted: false }) !== "MISSING_FACT_QUESTION") return null;
  const asking = askingSentences(reply?.trim() ?? "");
  if (asking.some((sentence) => QUANTITY_QUESTION.test(sentence))) return "QUANTITY_REQUESTION";
  if (asking.some((sentence) => PRODUCT_QUESTION.test(sentence))) return "PRODUCT_REQUESTION";
  return "OTHER_FACT_REQUEST";
}

export function classifyConfirmation(input: { reply: string | null | undefined; selectCompleted: boolean }): ConfirmationClass {
  if (input.selectCompleted) return "ACTION_EXECUTED";
  const text = input.reply?.trim() ?? "";
  if (text.length === 0) return "OTHER";
  const asking = askingSentences(text);
  if (asking.length === 0) return ACTION_CLAIM.test(text) ? "OTHER" : "INFORMATIONAL_RESPONSE";
  if (asking.some((sentence) => QUANTITY_QUESTION.test(sentence))) return "MISSING_FACT_QUESTION";
  if (asking.some((sentence) => CONFIRM_OBJECT.test(sentence) || RESTATE_QUANTITY.test(sentence) || ADVANCE.test(sentence))) return "UNNECESSARY_CONFIRMATION";
  if (asking.some((sentence) => PRODUCT_OR_FACT_QUESTION.test(sentence))) return "MISSING_FACT_QUESTION";
  return "OTHER";
}
