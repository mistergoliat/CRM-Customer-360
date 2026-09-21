import { seedBenchmarkSelection } from "../environment";
import type { BenchmarkE2ECase } from "../r3CommercialE2E/types";
import type { P78AnnotationResolver } from "../r3AutonomousAB/analysis";
import type { P78TurnAnnotation } from "../r3AutonomousAB/abCorpus";

/**
 * SALES-AGENT-R3-P7.9. Corpus for the capability-contract isolation, separated by
 * quantity semantics (never mixed into one number):
 *  - M (Q-, "quantity missing"): the product is identifiable, the quantity is not
 *    stated anywhere (not in the message, not in the durable state). 12 scenarios.
 *  - K (Q+, "quantity known"): product identifiable and quantity explicit. 12.
 *  - I (negative controls): purely informational questions. 8.
 * The fixture catalog only has the two bars (31 Classic, 32 Pro), so scenarios vary
 * syntax, quantity position, follow-ups, quote requests and selection changes over
 * those two products. Context turns (an informational question before the
 * purchase turn) are annotated `other`: they are not analysed as turns, but a
 * mutation there is reported as `contextTurnMutation` (contamination) per run.
 * No phrase here is copied from any prompt or tool contract.
 */
export const ISOLATION_CORPUS_VERSION = "r3-p7-9.v1" as const;

export type IsolationGroup = "Q-" | "Q+" | "NEG";

export type IsolationScenario = {
  caseId: string;
  group: IsolationGroup;
  description: string;
  identityLevel: "LEVEL_0_ANONYMOUS" | "LEVEL_2_MASTER_RESOLVED";
  /** Optional context turns come first; the LAST turn is the analysed one. */
  turns: string[];
  /** Only Q+: what the customer asked for. */
  expected?: { productId: "31" | "32"; quantity: number };
  /** Durable selection seeded before the first turn (selection-change scenarios). */
  seedSelection?: { productId: string; quantity: number }[];
};

const q = (caseId: string, description: string, turns: string[], extra: Partial<IsolationScenario> = {}): IsolationScenario => ({ caseId, group: "Q-", description, identityLevel: "LEVEL_0_ANONYMOUS", turns, ...extra });
const k = (caseId: string, description: string, turns: string[], expected: IsolationScenario["expected"], extra: Partial<IsolationScenario> = {}): IsolationScenario => ({ caseId, group: "Q+", description, identityLevel: "LEVEL_0_ANONYMOUS", turns, expected, ...extra });
const i = (caseId: string, description: string, message: string): IsolationScenario => ({ caseId, group: "NEG", description, identityLevel: "LEVEL_0_ANONYMOUS", turns: [message] });

export const ISOLATION_SCENARIOS: readonly IsolationScenario[] = [
  q("M01", "interest, polite opener", ["Hola, me interesa llevar la barra olímpica Classic"]),
  q("M02", "imperative add", ["agrégame la Classic de 20kg por favor"]),
  q("M03", "preference", ["Prefiero la barra Pro"]),
  q("M04", "change of mind after a price question", ["¿Cuánto cuesta la Classic?", "mejor me quedo con la Pro"]),
  q("M05", "quote request", ["Cotízame la barra Classic"], { identityLevel: "LEVEL_2_MASTER_RESOLVED" }),
  q("M06", "anaphoric follow-up after a stock question", ["¿Tienen stock de la Classic?", "Perfecto, esa me sirve. La quiero"]),
  q("M07", "colloquial take", ["Me llevo la Classic"]),
  q("M08", "colloquial give-me", ["Dame la Pro nomás"]),
  q("M09", "let's buy it", ["Ok, comprémosla: la barra Classic de 20 kilos"]),
  q("M10", "would like to buy", ["Me gustaría comprar la barra olímpica Pro"]),
  q("M11", "decision after a comparison", ["¿Qué diferencia hay entre la Classic y la Pro?", "Ya decidí: la Classic"]),
  q("M12", "need statement", ["Necesito la barra Classic para mi gimnasio en casa"]),

  k("K01", "quantity in words", ["Quiero dos barras Classic"], { productId: "31", quantity: 2 }),
  k("K02", "quantity as digit, purpose clause", ["Necesito 3 barras olímpicas Pro para el gimnasio"], { productId: "32", quantity: 3 }),
  k("K03", "colloquial take with quantity", ["Me llevo una Pro"], { productId: "32", quantity: 1 }),
  k("K04", "imperative add with quantity", ["Agrégame 2 Classic al pedido"], { productId: "31", quantity: 2 }),
  k("K05", "selection change with quantity", ["Cámbialo por 2 Pro"], { productId: "32", quantity: 2 }, { seedSelection: [{ productId: "31", quantity: 1 }] }),
  k("K06", "quantity first, then add", ["Con 4 barras Classic me alcanza, agrégalas"], { productId: "31", quantity: 4 }),
  k("K07", "follow-up quantity after a stock question", ["¿Tienen stock de la Classic?", "Perfecto, dame 2"], { productId: "31", quantity: 2 }),
  k("K08", "quantity after the product", ["Classic x2 por favor"], { productId: "31", quantity: 2 }),
  k("K09", "digit quantity", ["1 barra Pro por favor"], { productId: "32", quantity: 1 }),
  k("K10", "larger quantity, purpose clause", ["Necesito llevar 5 barras Classic para mi box"], { productId: "31", quantity: 5 }),
  k("K11", "anaphoric quantity after a price question", ["¿Cuánto cuesta la Pro?", "Ok, quiero 2 de esas"], { productId: "32", quantity: 2 }),
  k("K12", "quote request with quantity", ["Cotízame 2 barras Classic"], { productId: "31", quantity: 2 }, { identityLevel: "LEVEL_2_MASTER_RESOLVED" }),

  i("I01", "price", "¿Qué precio tiene la barra Pro?"),
  i("I02", "stock", "¿Les quedan barras Classic disponibles?"),
  i("I03", "comparison", "¿En qué se diferencia la Pro de la Classic?"),
  i("I04", "recommendation", "Estoy armando un gimnasio en casa, ¿cuál me recomiendas?"),
  i("I05", "compatibility", "¿Sirven discos de 50mm en la barra Classic?"),
  i("I06", "features", "¿Qué capacidad de carga tiene la barra Pro y qué características trae?"),
  i("I07", "link", "¿Me pasas el link de la Classic?"),
  i("I08", "availability", "¿Está disponible la Pro ahora mismo?")
];

export const ISOLATION_SCENARIO_IDS: readonly string[] = ISOLATION_SCENARIOS.map((scenario) => scenario.caseId);
export const scenarioById = (caseId: string): IsolationScenario => {
  const found = ISOLATION_SCENARIOS.find((scenario) => scenario.caseId === caseId);
  if (!found) throw new Error(`unknown P7.9 scenario ${caseId}`);
  return found;
};

/** Per-turn annotation (declared here, never inferred from text at analysis time): context turns are `other`; the last turn carries the group semantics. */
export function turnAnnotations(scenario: IsolationScenario): P78TurnAnnotation[] {
  const context: P78TurnAnnotation[] = scenario.turns.slice(0, -1).map(() => ({ kind: "other" }));
  const last: P78TurnAnnotation = scenario.group === "NEG" ? { kind: "informational" } : { kind: "explicit_purchase", statedQuantity: scenario.group === "Q+" ? (scenario.expected as { quantity: number }).quantity : null };
  return [...context, last];
}

export const ISOLATION_ANNOTATION_RESOLVER: P78AnnotationResolver = {
  annotationFor: (caseId, turnOrdinal) => turnAnnotations(scenarioById(caseId))[turnOrdinal] ?? { kind: "other" },
  annotatedTurnCount: (caseId) => scenarioById(caseId).turns.length
};

/** Offline (scripted-model) script per turn: only used by wiring tests, never in a live run. */
function offlineScript(scenario: IsolationScenario, turnIndex: number): BenchmarkE2ECase["turns"][number]["offlineScript"] {
  const isLast = turnIndex === scenario.turns.length - 1;
  if (!isLast || scenario.group === "NEG") return [{ kind: "use_tool", tool: "get_product_details", arguments: { productId: "31" } }, { kind: "respond", message: "La Barra Olimpica Classic 20kg cuesta $89.990." }];
  if (scenario.group === "Q-") return [{ kind: "use_tool", tool: "get_product_details", arguments: { productId: "31" } }, { kind: "respond", message: "Encontre la Barra Olimpica Classic 20kg. ¿Cuantas unidades necesitas?" }];
  const expected = scenario.expected as { productId: string; quantity: number };
  return [{ kind: "use_tool", tool: "get_product_details", arguments: { productId: expected.productId } }, { kind: "use_tool", tool: "select_products", arguments: { items: [{ productId: expected.productId, quantity: expected.quantity }] } }, { kind: "respond", message: "Listo, agregue tu seleccion." }];
}

export function toBenchmarkCase(scenario: IsolationScenario): BenchmarkE2ECase {
  const seed = scenario.seedSelection;
  return {
    caseId: scenario.caseId,
    description: scenario.description,
    notes: `P7.9 ${scenario.group} scenario. Outcome is measured by the P7.9 analysis, not by case expectations.`,
    identityLevel: scenario.identityLevel,
    ...(seed ? { setup: async (input: { opportunityId: number }) => seedBenchmarkSelection(input.opportunityId, seed) } : {}),
    turns: scenario.turns.map((customerMessage, turnIndex) => ({ customerMessage, offlineScript: offlineScript(scenario, turnIndex) })),
    expected: {},
    forbidden: {}
  };
}

export const buildIsolationCorpus = (): BenchmarkE2ECase[] => ISOLATION_SCENARIOS.map(toBenchmarkCase);
