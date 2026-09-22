import type { PlannedFault } from "./faultInjection";

/**
 * SALES-AGENT-R3-P7.12. The deterministic stress-plan, FROZEN before the soak (section 9): no
 * turn is generated at runtime, none depends on a previous turn's outcome. Three independent,
 * persistent conversations (A buyer-chaotic, B browser/uncertain, C adversarial/stress),
 * interleaved turn-by-turn (never run start-to-finish one after another).
 *
 * `expectedFinalSelection` is declared ONLY where the customer's own words make the resulting
 * FULL durable cart unambiguous (select_products is FULL_REPLACEMENT); it is intentionally left
 * undefined on ambiguous/casual/informational/contradiction-interior turns (section 27: "evaluar
 * semantica/estado, no wording" - an undeclared expectation is not silently treated as a pass,
 * the analyzer reports it as "not verified", never as correct).
 */

export const KNOWN_FIXTURE_PRODUCT_IDS = ["31", "32"] as const;
export type FixtureProductId = (typeof KNOWN_FIXTURE_PRODUCT_IDS)[number];
export type ExpectedItem = { productId: FixtureProductId; quantity: number };

export type ConversationLabel = "A" | "B" | "C";
export const CONVERSATION_LABELS: readonly ConversationLabel[] = ["A", "B", "C"];
export const CONVERSATION_PERSONA: Record<ConversationLabel, string> = {
  A: "BUYER_CHAOTIC",
  B: "BROWSER_UNCERTAIN",
  C: "ADVERSARIAL_STRESS"
};

export type ExpectedMutation = "NONE" | "SELECT" | "MODIFY" | "REPLACE" | "CANCEL" | "KEEP";

export const STRESS_CATEGORIES = [
  "DIRECT_PURCHASE",
  "INFORMATION_ONLY",
  "AMBIGUOUS_REFERENCE",
  "QUANTITY_FRAGMENT",
  "PRODUCT_FRAGMENT",
  "CORRECTION",
  "REPLACEMENT",
  "CANCEL",
  "RESUME",
  "TOPIC_SWITCH",
  "CASUAL_CHAT",
  "CONTRADICTION",
  "REPEATED_MESSAGE",
  "MULTI_INTENT",
  "MULTI_PRODUCT",
  "QUOTE_INTENT",
  "DESTINATION_CHANGE",
  "SHIPPING_QUESTION",
  "OLD_CONTEXT_REFERENCE",
  "EVIDENCE_REUSE",
  "EVIDENCE_REFRESH",
  "TOOL_FAILURE_RECOVERY",
  "DUPLICATE_ACTION_RISK",
  "NEGATION",
  "DELAYED_CONFIRMATION",
  "OUT_OF_ORDER_FACTS"
] as const;
export type StressCategory = (typeof STRESS_CATEGORIES)[number];

export type RawTurn = {
  message: string;
  stressCategory: StressCategory;
  expectedMutation: ExpectedMutation;
  /** Full expected durable cart after this turn, when (and only when) it is unambiguous from the customer's own words. */
  expectedFinalSelection?: readonly ExpectedItem[];
  /** true = the model may legitimately ask a clarifying question instead of acting; that is not a failure. */
  allowClarification?: boolean;
  expectedCommercialInvariant?: string;
  fault?: PlannedFault;
};

export type PlannedTurn = RawTurn & { conversation: ConversationLabel; localIndex: number; sequenceIndex: number };

const t = (stressCategory: StressCategory, message: string, expectedMutation: ExpectedMutation, expectedFinalSelection?: readonly ExpectedItem[], extra: Partial<Pick<RawTurn, "allowClarification" | "expectedCommercialInvariant" | "fault">> = {}): RawTurn => ({
  message,
  stressCategory,
  expectedMutation,
  expectedFinalSelection,
  allowClarification: extra.allowClarification ?? false,
  expectedCommercialInvariant: extra.expectedCommercialInvariant,
  fault: extra.fault
});

// ============================================================================
// Conversation A - BUYER CHAOTIC (wants to buy, but changes mind, corrects, backtracks)
// ============================================================================
export const CONVERSATION_A: readonly RawTurn[] = [
  t("INFORMATION_ONLY", "Estoy viendo barras olimpicas", "NONE"),
  t("INFORMATION_ONLY", "¿Cual conviene mas entre Classic y Pro?", "NONE"),
  t("PRODUCT_FRAGMENT", "La Classic entonces", "NONE", undefined, { allowClarification: true }),
  t("QUANTITY_FRAGMENT", "Serian dos", "SELECT", [{ productId: "31", quantity: 2 }]),
  t("CASUAL_CHAT", "Aunque espera", "NONE", undefined, { allowClarification: true }),
  t("TOPIC_SWITCH", "¿Cuanto pesa la Pro?", "NONE"),
  t("NEGATION", "No, sigamos con la Classic", "KEEP", [{ productId: "31", quantity: 2 }]),
  t("CORRECTION", "Mejor tres", "MODIFY", [{ productId: "31", quantity: 3 }]),
  t("SHIPPING_QUESTION", "¿Despachan a Maipu?", "NONE"),
  t("QUANTITY_FRAGMENT", "Agregame otra mas", "MODIFY", [{ productId: "31", quantity: 4 }]),
  t("CORRECTION", "No, deja tres", "MODIFY", [{ productId: "31", quantity: 3 }]),
  t("QUOTE_INTENT", "Cotizame eso", "KEEP", [{ productId: "31", quantity: 3 }]),
  t("INFORMATION_ONLY", "Antes dime cuanto sale cada una", "NONE"),
  t("AMBIGUOUS_REFERENCE", "Ya", "NONE", undefined, { allowClarification: true }),
  t("MULTI_PRODUCT", "Cambia una Classic por una Pro", "REPLACE", [
    { productId: "31", quantity: 2 },
    { productId: "32", quantity: 1 }
  ]),
  t("REPLACEMENT", "No, mejor todas Classic otra vez", "REPLACE", [{ productId: "31", quantity: 3 }]),
  t("CORRECTION", "Dejalas en dos", "MODIFY", [{ productId: "31", quantity: 2 }]),
  t("CANCEL", "Olvida la cotizacion por ahora", "NONE"),
  t("CASUAL_CHAT", "Oye, ¿hacen envios los fines de semana?", "NONE"),
  t("CASUAL_CHAT", "Gracias por la ayuda", "NONE"),
  t("RESUME", "Retomando, sigamos con lo de antes", "KEEP", [{ productId: "31", quantity: 2 }]),
  t("QUANTITY_FRAGMENT", "Agregame dos Classic mas", "MODIFY", [{ productId: "31", quantity: 4 }]),
  t("REPEATED_MESSAGE", "Agregame dos Classic mas", "MODIFY", undefined, { allowClarification: true, expectedCommercialInvariant: "duplicate consecutive message: either re-applies (6) or the model clarifies - never a corrupt/negative/non-integer line" }),
  t("DESTINATION_CHANGE", "En realidad despachalo a Puente Alto, no a Maipu", "NONE"),
  t("MULTI_PRODUCT", "Agregame tambien una Pro", "MODIFY", undefined, { expectedCommercialInvariant: "one Pro line added, existing Classic line(s) preserved (not wiped)" }),
  t("EVIDENCE_REUSE", "¿Cuanto pesa esa Pro que agregue?", "NONE"),
  t("QUOTE_INTENT", "Cotizame el carrito completo", "KEEP", undefined, { expectedCommercialInvariant: "selection unchanged by a pure quote request" }),
  t("MULTI_INTENT", "Cambia la Pro por dos Classic y cotizame de nuevo", "REPLACE"),
  t("CASUAL_CHAT", "Como estai", "NONE"),
  t("TOPIC_SWITCH", "¿Tienen garantia las barras?", "NONE"),
  t("OLD_CONTEXT_REFERENCE", "Volvamos a la que habia elegido al principio", "NONE", undefined, { allowClarification: true, expectedCommercialInvariant: "long-range reference to turn 3-4 (Classic); resolvable from durable state/context, no fabricated product" }),
  t("CONTRADICTION", "Quiero dos", "MODIFY"),
  t("CONTRADICTION", "No, tres", "MODIFY"),
  t("CONTRADICTION", "Espera, una", "MODIFY"),
  t("CONTRADICTION", "Mejor ninguna", "CANCEL", [], { allowClarification: true }),
  t("CONTRADICTION", "Ok si, dos", "MODIFY", undefined, { expectedCommercialInvariant: "final durable state reflects ONLY the last decision (dos), not an intermediate one" }),
  t("EVIDENCE_REFRESH", "¿Sigue disponible la Classic?", "NONE"),
  t("DELAYED_CONFIRMATION", "Dale, confirma eso", "KEEP"),
  t("PRODUCT_FRAGMENT", "Tambien quiero la Pro", "NONE", undefined, { allowClarification: true, expectedCommercialInvariant: "product named, no quantity yet - a mutation here needs a quantity from somewhere explicit, not invented" }),
  t("QUANTITY_FRAGMENT", "Una de esa", "MODIFY", undefined, { expectedCommercialInvariant: "Pro line added with quantity 1, Classic line preserved" }),
  t("REPLACEMENT", "Cambia la Pro por otra Classic", "REPLACE"),
  t("CASUAL_CHAT", "Buena onda la atencion", "NONE"),
  t("REPLACEMENT", "Quiero cambiar todo por tres Pro", "REPLACE", [{ productId: "32", quantity: 3 }], { expectedCommercialInvariant: "full replacement to a product not looked up in several turns - evidence gate may legitimately require a fresh get_product_details" }),
  t("TOOL_FAILURE_RECOVERY", "¿Cuanto cuesta la Classic?", "NONE", undefined, { fault: { targetCapability: "get_product_details", kind: "CATALOG_TIMEOUT" }, expectedCommercialInvariant: "one-shot catalog fault: model must not invent a price nor a false success, and must not corrupt the existing selection" }),
  t("EVIDENCE_REFRESH", "¿Y la Classic, cuanto cuesta?", "NONE"),
  t("CORRECTION", "Mejor deja solo dos Pro", "MODIFY", [{ productId: "32", quantity: 2 }]),
  t("SHIPPING_QUESTION", "¿Cuanto sale el despacho a esa direccion?", "NONE"),
  t("QUOTE_INTENT", "Ya, cotiza eso altiro", "KEEP", [{ productId: "32", quantity: 2 }]),
  t("CASUAL_CHAT", "Perfecto, muchas gracias", "NONE"),
  t("CASUAL_CHAT", "Una consulta aparte, ¿tienen tienda fisica?", "NONE"),
  t("RESUME", "Bueno, sigamos con mi pedido", "KEEP", [{ productId: "32", quantity: 2 }]),
  t("NEGATION", "No quiero mas Pro", "NONE", undefined, { allowClarification: true, expectedCommercialInvariant: "a negation about future additions must not delete the existing selection" }),
  t("MULTI_PRODUCT", "Agrega tres Classic tambien", "MODIFY", undefined, { expectedCommercialInvariant: "Classic line added, Pro line (2) preserved" }),
  t("CANCEL", "Sabes que, cancela todo", "CANCEL", []),
  t("CASUAL_CHAT", "Fue un gusto igual", "NONE"),
  t("RESUME", "Espera, mejor si quiero comprar de nuevo", "NONE", undefined, { allowClarification: true }),
  t("DIRECT_PURCHASE", "Dame dos Classic", "SELECT", [{ productId: "31", quantity: 2 }]),
  t("AMBIGUOUS_REFERENCE", "La otra igual", "NONE", undefined, { allowClarification: true, expectedCommercialInvariant: "'la otra' has no unambiguous antecedent here - no mutation without asking" }),
  t("PRODUCT_FRAGMENT", "Una Pro", "MODIFY", undefined, { expectedCommercialInvariant: "'una' read as quantity 1 for Pro (P7.10 article/quantity ambiguity track), Classic line preserved" }),
  t("QUANTITY_FRAGMENT", "quiero una", "MODIFY", undefined, { allowClarification: true, expectedCommercialInvariant: "article/quantity track (P7.10): bare 'quiero una' with no product named in this turn - product must come from context, not be guessed" }),
  t("MULTI_INTENT", "Dame dos Classic mas y dime si hay stock de Pro", "MODIFY", undefined, { expectedCommercialInvariant: "both sub-intents addressed: quantity updated AND a stock answer given" }),
  t("REPLACEMENT", "Reemplaza toda la Pro por una Classic", "REPLACE"),
  t("QUOTE_INTENT", "Cotiza el pedido final", "KEEP"),
  t("CASUAL_CHAT", "Eso seria todo, gracias totales", "NONE"),
  t("OLD_CONTEXT_REFERENCE", "Oye, ¿al final cuantas Classic me quedaron?", "NONE"),
  t("DIRECT_PURCHASE", "Dejalo asi, cierro aqui", "KEEP")
];

// ============================================================================
// Conversation B - BROWSER / UNCERTAIN (mostly consults, rarely commits, tries to induce over-mutation)
// ============================================================================
export const CONVERSATION_B: readonly RawTurn[] = [
  t("CASUAL_CHAT", "Hola, buenas", "NONE"),
  t("INFORMATION_ONLY", "¿Cuanto cuesta la barra Classic?", "NONE"),
  t("INFORMATION_ONLY", "¿Tienen stock de la Pro?", "NONE"),
  t("INFORMATION_ONLY", "¿Que diferencia hay entre las dos?", "NONE"),
  t("INFORMATION_ONLY", "¿Cuanto costarian dos?", "NONE", undefined, { expectedCommercialInvariant: "a price-for-N-units question is informational, not a selection" }),
  t("INFORMATION_ONLY", "Si quisiera tres, ¿cuanto seria?", "NONE"),
  t("INFORMATION_ONLY", "Estoy pensando en comprar una", "NONE", undefined, { allowClarification: true, expectedCommercialInvariant: "'pensando en' is deliberation, not a decision - no mutation" }),
  t("INFORMATION_ONLY", "Quizas me lleve dos", "NONE", undefined, { expectedCommercialInvariant: "hedged/hypothetical phrasing - no mutation" }),
  t("INFORMATION_ONLY", "¿Que pasa si compro tres?", "NONE"),
  t("INFORMATION_ONLY", "Muestrame la Pro", "NONE"),
  t("INFORMATION_ONLY", "Comparame dos Classic contra una Pro", "NONE"),
  t("SHIPPING_QUESTION", "¿Cuanto sale el despacho a Providencia?", "NONE"),
  t("CASUAL_CHAT", "Ya, gracias por la info", "NONE"),
  t("TOPIC_SWITCH", "¿Tienen otros productos de gimnasio?", "NONE"),
  t("CASUAL_CHAT", "Nada, era solo curiosidad", "NONE"),
  t("INFORMATION_ONLY", "¿Cual me recomiendas para en casa?", "NONE"),
  t("AMBIGUOUS_REFERENCE", "Esa se ve bien", "NONE", undefined, { allowClarification: true }),
  t("INFORMATION_ONLY", "Pero antes, ¿cuanto pesa?", "NONE"),
  t("AMBIGUOUS_REFERENCE", "Dale", "NONE", undefined, { allowClarification: true, expectedCommercialInvariant: "'dale' alone with no clear product+quantity antecedent must not trigger a mutation" }),
  t("QUANTITY_FRAGMENT", "Una de esas", "NONE", undefined, { allowClarification: true, expectedCommercialInvariant: "product still not unambiguous at this point in this conversation - clarification is acceptable, a guessed mutation is not" }),
  t("PRODUCT_FRAGMENT", "La Classic, digo", "NONE", undefined, { allowClarification: true }),
  t("DIRECT_PURCHASE", "Ya, dame una Classic entonces", "SELECT", [{ productId: "31", quantity: 1 }]),
  t("INFORMATION_ONLY", "En realidad solo estaba preguntando", "NONE", undefined, { expectedCommercialInvariant: "a clarification that this was informational must not by itself delete a selection the customer just explicitly made" }),
  t("CASUAL_CHAT", "jajaja disculpa el show", "NONE"),
  t("INFORMATION_ONLY", "¿Cuanto seria el despacho de esa?", "NONE"),
  t("QUOTE_INTENT", "Mandame una cotizacion nomas para ver", "KEEP", [{ productId: "31", quantity: 1 }]),
  t("CANCEL", "Mejor no, cancela esa cotizacion", "NONE"),
  t("NEGATION", "Y de hecho tampoco quiero la Classic por ahora", "CANCEL", []),
  t("CASUAL_CHAT", "Voy a pensarlo con calma", "NONE"),
  t("TOPIC_SWITCH", "¿Cual es mas durable a largo plazo?", "NONE"),
  t("INFORMATION_ONLY", "¿Y en cuotas se puede pagar?", "NONE"),
  t("CASUAL_CHAT", "Ya casi me convences jaja", "NONE"),
  t("INFORMATION_ONLY", "¿Tienen envio express?", "NONE"),
  t("AMBIGUOUS_REFERENCE", "La primera que me dijiste", "NONE", undefined, { allowClarification: true, expectedCommercialInvariant: "reference across many turns to 'the first one mentioned' - resolvable only if truly unambiguous, otherwise clarify" }),
  t("INFORMATION_ONLY", "¿Que capacidad de carga tiene?", "NONE"),
  t("DIRECT_PURCHASE", "Ya la decidi, dame dos Pro", "SELECT", [{ productId: "32", quantity: 2 }]),
  t("QUANTITY_FRAGMENT", "mejor una", "MODIFY", [{ productId: "32", quantity: 1 }]),
  t("INFORMATION_ONLY", "¿Puedo pagar contra entrega?", "NONE"),
  t("CASUAL_CHAT", "Buena, gracias", "NONE"),
  t("EVIDENCE_REUSE", "¿La Pro que elegi, sigue con stock?", "NONE"),
  t("MULTI_INTENT", "Cotizame esa y dime cuanto tarda el despacho", "KEEP", [{ productId: "32", quantity: 1 }], { fault: { targetCapability: "calculate_shipping", kind: "GATEWAY_DEPENDENCY_REJECTION" } }),
  t("CASUAL_CHAT", "Se agradece toda la ayuda", "NONE"),
  t("CANCEL", "En verdad no voy a comprar hoy, cancela todo", "CANCEL", []),
  t("CASUAL_CHAT", "Cualquier cosa vuelvo a escribir", "NONE"),
  t("RESUME", "Ya volvi, ¿seguia disponible lo que habia visto?", "NONE"),
  t("DIRECT_PURCHASE", "Dame la Pro entonces, dos", "SELECT", [{ productId: "32", quantity: 2 }]),
  t("DELAYED_CONFIRMATION", "Espera antes de nada, confirmame el precio total", "NONE"),
  t("DELAYED_CONFIRMATION", "Ya, ahora si, dale para adelante", "KEEP", [{ productId: "32", quantity: 2 }]),
  t("CASUAL_CHAT", "Excelente, gracias", "NONE"),
  t("INFORMATION_ONLY", "Ultima duda, ¿la garantia cubre uso en gimnasio comercial?", "NONE"),
  t("QUOTE_INTENT", "Ya, cotizame el pedido final", "KEEP", [{ productId: "32", quantity: 2 }]),
  t("CASUAL_CHAT", "Eso seria todo por ahora", "NONE")
];

// ============================================================================
// Conversation C - ADVERSARIAL / STRESS (contradicts, fragments, repeats, tries to induce mistakes)
// ============================================================================
export const CONVERSATION_C: readonly RawTurn[] = [
  t("CASUAL_CHAT", "hola", "NONE"),
  t("PRODUCT_FRAGMENT", "quiero una", "NONE", undefined, { allowClarification: true, expectedCommercialInvariant: "no product named anywhere yet - must not guess" }),
  t("AMBIGUOUS_REFERENCE", "esa", "NONE", undefined, { allowClarification: true }),
  t("AMBIGUOUS_REFERENCE", "la otra", "NONE", undefined, { allowClarification: true }),
  t("AMBIGUOUS_REFERENCE", "dos", "NONE", undefined, { allowClarification: true, expectedCommercialInvariant: "a bare quantity with no resolvable product must not select anything" }),
  t("DIRECT_PURCHASE", "ya bueno, quiero dos Classic", "SELECT", [{ productId: "31", quantity: 2 }], { fault: { targetCapability: "get_product_details", kind: "CATALOG_TIMEOUT" }, expectedCommercialInvariant: "one-shot catalog fault on the very first grounding call of the conversation: the model must recover (retry) or ask, never fabricate a completed selection" }),
  t("REPEATED_MESSAGE", "quiero dos Classic", "KEEP", [{ productId: "31", quantity: 2 }], { expectedCommercialInvariant: "exact repeat of an already-fulfilled request must not duplicate the line (still 2, not 4)" }),
  t("REPEATED_MESSAGE", "quiero dos Classic", "KEEP", [{ productId: "31", quantity: 2 }], { expectedCommercialInvariant: "third identical message in a row - same invariant" }),
  t("CONTRADICTION", "no, mejor tres", "MODIFY", [{ productId: "31", quantity: 3 }]),
  t("CONTRADICTION", "espera, dos otra vez", "MODIFY", [{ productId: "31", quantity: 2 }]),
  t("CONTRADICTION", "no, cuatro", "MODIFY", [{ productId: "31", quantity: 4 }]),
  t("CONTRADICTION", "en realidad ninguna", "CANCEL", []),
  t("CONTRADICTION", "ok dos entonces", "MODIFY"),
  t("NEGATION", "no quiero Pro", "NONE", undefined, { expectedCommercialInvariant: "a negative statement about a DIFFERENT product must not touch the Classic line" }),
  t("OUT_OF_ORDER_FACTS", "tres", "MODIFY", undefined, { allowClarification: true, expectedCommercialInvariant: "bare quantity, product implied by recent context (Classic) - resolvable only if truly unambiguous" }),
  t("OUT_OF_ORDER_FACTS", "Classic", "KEEP", undefined, { allowClarification: true, expectedCommercialInvariant: "product named after the quantity already given in the previous turn - facts arriving out of order should still resolve to one coherent selection" }),
  t("REPLACEMENT", "cambia todo por Pro", "REPLACE", undefined, { expectedCommercialInvariant: "replacement to a product not grounded in this conversation - evidence gate may require fresh get_product_details" }),
  t("TOOL_FAILURE_RECOVERY", "dame el precio de la Pro", "NONE", undefined, { fault: { targetCapability: "search_products_by_semantics", kind: "REGISTRY_MISMATCH" } }),
  t("EVIDENCE_REFRESH", "¿y bien, cuanto es?", "NONE"),
  t("MULTI_PRODUCT", "agrega tambien dos Classic", "MODIFY", undefined, { expectedCommercialInvariant: "adds a Classic line without wiping the Pro line" }),
  t("QUANTITY_FRAGMENT", "de la Pro, mejor tres", "MODIFY", undefined, { expectedCommercialInvariant: "quantity change scoped to Pro only, Classic line preserved" }),
  t("DUPLICATE_ACTION_RISK", "agrega tres Pro", "MODIFY", undefined, { allowClarification: true, expectedCommercialInvariant: "same product+quantity as current state phrased as a fresh add - must not silently double to 6" }),
  t("CASUAL_CHAT", "test test", "NONE"),
  t("CASUAL_CHAT", "1 2 3", "NONE"),
  t("AMBIGUOUS_REFERENCE", "la de antes", "NONE", undefined, { allowClarification: true }),
  t("AMBIGUOUS_REFERENCE", "la primera", "NONE", undefined, { allowClarification: true }),
  t("AMBIGUOUS_REFERENCE", "la mas barata", "NONE", undefined, { allowClarification: true, expectedCommercialInvariant: "'cheapest' requires a price lookup before it could ever be unambiguous - no guessed mutation" }),
  t("AMBIGUOUS_REFERENCE", "la que dijiste", "NONE", undefined, { allowClarification: true }),
  t("AMBIGUOUS_REFERENCE", "esa misma", "NONE", undefined, { allowClarification: true }),
  t("AMBIGUOUS_REFERENCE", "ya", "NONE", undefined, { allowClarification: true }),
  t("AMBIGUOUS_REFERENCE", "ok", "NONE", undefined, { allowClarification: true }),
  t("MULTI_INTENT", "cambia la Classic por una Pro y cotiza todo junto", "REPLACE"),
  t("NEGATION", "no confirmes nada todavia", "NONE", undefined, { expectedCommercialInvariant: "an explicit hold-off must not be followed by a mutation in the SAME or next turn without new customer input" }),
  t("DELAYED_CONFIRMATION", "ahora si, procede", "KEEP"),
  t("CONTRADICTION", "en verdad cancela todo", "CANCEL", []),
  t("CONTRADICTION", "no espera, no canceles", "NONE", undefined, { allowClarification: true, expectedCommercialInvariant: "customer immediately retracts a cancellation - the agent should not have irreversibly discarded state it can still recover via this turn" }),
  t("OLD_CONTEXT_REFERENCE", "en verdad quiero lo que tenia hace rato, las Pro", "REPLACE", undefined, { allowClarification: true }),
  t("PRODUCT_FRAGMENT", "un banco tambien", "NONE", undefined, { allowClarification: true, expectedCommercialInvariant: "'banco' is not a fixture product - must not be fabricated into a selection" }),
  t("QUANTITY_FRAGMENT", "un", "NONE", undefined, { allowClarification: true, expectedCommercialInvariant: "bare 'un' with nothing else in the turn - no product, no mutation" }),
  t("DIRECT_PURCHASE", "dame una Pro", "MODIFY", undefined, { expectedCommercialInvariant: "P7.10 article/quantity track: 'una' read as quantity 1" }),
  t("REPLACEMENT", "cambiala por dos Classic", "REPLACE"),
  t("MULTI_INTENT", "quiero tres Pro pero primero dime si hay stock", "MODIFY", undefined, { expectedCommercialInvariant: "both the stock answer and the quantity update happen; the stock question is not skipped" }),
  t("TOOL_FAILURE_RECOVERY", "¿cuanto pesa la Pro?", "NONE", undefined, { fault: { targetCapability: "get_product_details", kind: "INVALID_CATALOG_RESPONSE" } }),
  t("EVIDENCE_REFRESH", "bueno, dime de nuevo", "NONE"),
  t("REPEATED_MESSAGE", "quiero tres Pro", "KEEP", undefined, { expectedCommercialInvariant: "restates an already-current selection - must not double it" }),
  t("CASUAL_CHAT", "oye una consulta aparte", "NONE"),
  t("CASUAL_CHAT", "¿cual es el horario de atencion?", "NONE"),
  t("TOPIC_SWITCH", "¿y hacen mantenimiento de las barras?", "NONE"),
  t("RESUME", "bueno, volvamos a lo mio", "KEEP"),
  t("CONTRADICTION", "mejor cambialo todo a Classic", "REPLACE"),
  t("CONTRADICTION", "no, dejalo como estaba antes", "REPLACE", undefined, { allowClarification: true, expectedCommercialInvariant: "reverting to 'como estaba antes' is only safe if the prior state is truly unambiguous from context; otherwise clarify rather than guess which 'antes'" }),
  t("DESTINATION_CHANGE", "despachalo a Las Condes esta vez", "NONE"),
  t("SHIPPING_QUESTION", "¿eso cambia el precio del despacho?", "NONE"),
  t("QUOTE_INTENT", "cotiza el pedido", "KEEP"),
  t("NEGATION", "no, espera, no cotices todavia", "NONE", undefined, { expectedCommercialInvariant: "explicit stop must be honored - no create_quote/select_products right after this turn" }),
  t("DELAYED_CONFIRMATION", "ya, ahora si cotiza", "KEEP"),
  t("MULTI_PRODUCT", "agrega una Classic mas a lo que ya cotizaste", "MODIFY", undefined, { expectedCommercialInvariant: "adds a Classic line without discarding the existing Pro/Classic lines from the quote's selection" }),
  t("CANCEL", "mejor cancela absolutamente todo", "CANCEL", []),
  t("CASUAL_CHAT", "jaja perdon por el lio", "NONE"),
  t("DIRECT_PURCHASE", "ya en serio, dos Classic nada mas", "SELECT", [{ productId: "31", quantity: 2 }]),
  t("REPEATED_MESSAGE", "dos Classic nada mas", "KEEP", [{ productId: "31", quantity: 2 }]),
  t("OLD_CONTEXT_REFERENCE", "¿te acuerdas cuantas Pro pedi al principio?", "NONE"),
  t("MULTI_INTENT", "deja las Classic en tres y cotiza denuevo", "MODIFY", [{ productId: "31", quantity: 3 }]),
  t("CASUAL_CHAT", "gracias por la paciencia", "NONE"),
  t("DIRECT_PURCHASE", "cierra el pedido asi", "KEEP", [{ productId: "31", quantity: 3 }])
];

export const RAW_CONVERSATIONS: Record<ConversationLabel, readonly RawTurn[]> = { A: CONVERSATION_A, B: CONVERSATION_B, C: CONVERSATION_C };

/** Simple round-robin interleave (A, B, C, A, B, C, ...); once a conversation is exhausted the remaining ones keep round-robining. Deterministic, frozen (section 6/9/33). */
export function buildStressPlan(): PlannedTurn[] {
  const cursors: Record<ConversationLabel, number> = { A: 0, B: 0, C: 0 };
  const plan: PlannedTurn[] = [];
  let sequenceIndex = 0;
  let remaining = CONVERSATION_LABELS.reduce((sum, label) => sum + RAW_CONVERSATIONS[label].length, 0);
  while (remaining > 0) {
    for (const label of CONVERSATION_LABELS) {
      const cursor = cursors[label];
      const raw = RAW_CONVERSATIONS[label];
      if (cursor >= raw.length) continue;
      plan.push({ ...raw[cursor], conversation: label, localIndex: cursor, sequenceIndex });
      cursors[label] += 1;
      sequenceIndex += 1;
      remaining -= 1;
    }
  }
  return plan;
}

export const STRESS_PLAN: readonly PlannedTurn[] = buildStressPlan();
