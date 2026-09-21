import { seedBenchmarkSelection } from "../environment";
import type { BenchmarkE2ECase } from "../r3CommercialE2E/types";
import type { P78AnnotationResolver } from "../r3AutonomousAB/analysis";
import type { P78TurnAnnotation } from "../r3AutonomousAB/abCorpus";

/**
 * SALES-AGENT-R3-P7.10. Corpus stratified by SPEECH ACT (never mixed into one number):
 *  D  declarative desire  (12): "quiero dos ...", "necesito tres ...", "me llevo una ..."
 *  I  imperative          (8):  "agregame dos ...", "ponme tres ..."
 *  Q  quote-action        (8):  "cotizame dos ...", "quiero una cotizacion por ..."
 *  N  informational       (8):  price, stock, recommendation, comparison, link, features
 *  F  follow-up           (6):  the facts (product + quantity) are complete only on the last turn
 *  R  replacement         (4):  a durable selection is seeded; the customer changes it
 * = 46 scenarios. Every non-N scenario is ACTIONABLE by construction: the product is
 * identifiable, the quantity is explicit, there is a clear acquisition/selection intent, no
 * real ambiguity remains and select_products is structurally executable. No intentionally
 * ambiguous scenario ("creo que quizas dos", "estoy entre una o dos") is in this corpus.
 *
 * The fixture catalog only has the two bars (31 Classic, 32 Pro). Product names in the
 * messages always carry the noun ("barra Classic / barra Pro") except two scenarios that
 * keep the bare name because the task statement uses it ("me llevo una Pro"): they are
 * flagged `bare_pro_name`, because the P7.9 audit documented that the catalog stub makes
 * the model sometimes ask "which Pro?" for a bare "Pro" (instrument limitation, reported
 * separately, never attributed to the tool semantics).
 *
 * Context turns (before the last one) are annotated `other`: not analysed as turns, but a
 * mutation there is reported as `contextTurnMutation` (contamination), never excluded.
 * No phrase is copied from any prompt or tool contract (test).
 */
export const SEMANTICS_CORPUS_VERSION = "r3-p7-10.v1" as const;

export type SpeechActGroup = "D" | "I" | "Q" | "N" | "F" | "R";
export const SPEECH_ACT_GROUPS: readonly SpeechActGroup[] = ["D", "I", "Q", "N", "F", "R"];
export const SPEECH_ACT_LABELS: Record<SpeechActGroup, string> = { D: "declarative_desire", I: "imperative", Q: "quote_action", N: "informational_negative", F: "follow_up", R: "replacement" };

export type ExpectedItem = { productId: "31" | "32"; quantity: number };

export type SemanticsScenario = {
  caseId: string;
  group: SpeechActGroup;
  description: string;
  identityLevel: "LEVEL_0_ANONYMOUS" | "LEVEL_2_MASTER_RESOLVED";
  /** Context turns first; the LAST turn is the analysed one. */
  turns: string[];
  /** The durable selection the customer's stated facts should produce (every non-N scenario). */
  expected?: ExpectedItem[];
  /** F only: the expected product is whatever the assistant named (exactly one) in the first turn's reply (the `productId` in `expected` is only the offline-script placeholder); if it named zero or two, the scenario is NOT actionable in that run (reported, excluded from the ACTIONABLE denominator). */
  productFromContext?: boolean;
  /** Durable selection seeded before the first turn (R scenarios). */
  seedSelection?: { productId: string; quantity: number }[];
  fixtureFlags?: readonly "bare_pro_name"[];
};

const base = { identityLevel: "LEVEL_0_ANONYMOUS" } as const;
const d = (caseId: string, description: string, message: string, expected: ExpectedItem, extra: Partial<SemanticsScenario> = {}): SemanticsScenario => ({ caseId, group: "D", description, ...base, turns: [message], expected: [expected], ...extra });
const im = (caseId: string, description: string, message: string, expected: ExpectedItem): SemanticsScenario => ({ caseId, group: "I", description, ...base, turns: [message], expected: [expected] });
const qu = (caseId: string, description: string, message: string, expected: ExpectedItem): SemanticsScenario => ({ caseId, group: "Q", description, identityLevel: "LEVEL_2_MASTER_RESOLVED", turns: [message], expected: [expected] });
const n = (caseId: string, description: string, message: string): SemanticsScenario => ({ caseId, group: "N", description, ...base, turns: [message] });
const f = (caseId: string, description: string, turns: string[], expected: ExpectedItem, extra: Partial<SemanticsScenario> = {}): SemanticsScenario => ({ caseId, group: "F", description, ...base, turns, expected: [expected], ...extra });
const r = (caseId: string, description: string, message: string, seedSelection: { productId: string; quantity: number }[], expected: ExpectedItem, identityLevel: SemanticsScenario["identityLevel"] = "LEVEL_0_ANONYMOUS"): SemanticsScenario => ({ caseId, group: "R", description, identityLevel, turns: [message], expected: [expected], seedSelection });

export const SEMANTICS_SCENARIOS: readonly SemanticsScenario[] = [
  d("D01", "want, quantity in words", "Quiero dos barras Classic", { productId: "31", quantity: 2 }),
  d("D02", "need, quantity in words", "Necesito tres barras Classic", { productId: "31", quantity: 3 }),
  d("D03", "take, bare Pro name", "Me llevo una Pro", { productId: "32", quantity: 1 }, { fixtureFlags: ["bare_pro_name"] }),
  d("D04", "prefer, quantity in words", "Prefiero dos barras Classic", { productId: "31", quantity: 2 }),
  d("D05", "would like, bare Pro name", "Quisiera dos Pro", { productId: "32", quantity: 2 }, { fixtureFlags: ["bare_pro_name"] }),
  d("D06", "stay with, digit quantity", "Me quedo con 4 barras Classic", { productId: "31", quantity: 4 }),
  d("D07", "going to take, digit quantity", "Voy a llevar 3 barras Pro", { productId: "32", quantity: 3 }),
  d("D08", "need, purpose clause", "Necesito 2 barras olímpicas Pro para mi gimnasio", { productId: "32", quantity: 2 }),
  d("D09", "would like to take, quantity in words", "Me gustaría llevar una barra Classic", { productId: "31", quantity: 1 }),
  d("D10", "want, larger quantity", "Quiero 5 barras Classic para mi box", { productId: "31", quantity: 5 }),
  d("D11", "prefer, digit quantity", "Prefiero 3 barras Pro", { productId: "32", quantity: 3 }),
  d("D12", "want, quantity in words", "Quiero tres barras Pro", { productId: "32", quantity: 3 }),

  im("IM01", "imperative add", "Agrégame dos barras Classic", { productId: "31", quantity: 2 }),
  im("IM02", "imperative put", "Ponme tres barras Pro", { productId: "32", quantity: 3 }),
  im("IM03", "imperative leave in the selection", "Deja dos barras Classic en la selección", { productId: "31", quantity: 2 }),
  im("IM04", "imperative add, singular", "Agrega una barra Pro", { productId: "32", quantity: 1 }),
  im("IM05", "imperative add to the order", "Añade 4 barras Classic a mi pedido", { productId: "31", quantity: 4 }),
  im("IM06", "imperative sum", "Súmame una barra Classic", { productId: "31", quantity: 1 }),
  im("IM07", "imperative put in the selection", "Pon 2 barras Pro en mi selección", { productId: "32", quantity: 2 }),
  im("IM08", "imperative note down", "Anótame tres barras Classic", { productId: "31", quantity: 3 }),

  qu("Q01", "quote imperative", "Cotízame dos barras Classic", { productId: "31", quantity: 2 }),
  qu("Q02", "want a quote", "Quiero una cotización por tres barras Pro", { productId: "32", quantity: 3 }),
  qu("Q03", "make me a quote", "Hazme una cotización de una barra Classic", { productId: "31", quantity: 1 }),
  qu("Q04", "need to quote", "Necesito cotizar 2 barras Pro", { productId: "32", quantity: 2 }),
  qu("Q05", "quote with please", "Cotiza 4 barras Classic por favor", { productId: "31", quantity: 4 }),
  qu("Q06", "can you quote", "¿Me puedes cotizar una barra Pro?", { productId: "32", quantity: 1 }),
  qu("Q07", "give me a quote", "Dame una cotización de 3 barras Classic", { productId: "31", quantity: 3 }),
  qu("Q08", "would like to quote", "Quisiera cotizar dos barras Pro", { productId: "32", quantity: 2 }),

  n("N01", "price", "¿Cuánto cuesta la barra Classic?"),
  n("N02", "stock", "¿Tienen stock de la barra Pro?"),
  n("N03", "recommendation", "¿Cuál me recomiendas para armar un gimnasio en casa?"),
  n("N04", "comparison", "¿Qué diferencia hay entre la Classic y la Pro?"),
  n("N05", "link", "¿Me mandas el link de la barra Pro?"),
  n("N06", "features", "¿Qué características tiene la barra Classic?"),
  n("N07", "availability", "¿Está disponible la barra Pro?"),
  n("N08", "capacity", "¿Qué capacidad de carga tiene la barra Pro?"),

  f("F01", "recommendation, then quantity on the recommended one", ["¿Qué barra me recomiendas para mi gimnasio en casa?", "Quiero dos de esa"], { productId: "31", quantity: 2 }, { productFromContext: true }),
  f("F02", "show the product, then take one", ["Muéstrame la barra Pro", "Me llevo una"], { productId: "32", quantity: 1 }),
  f("F03", "product first, quantity in the next turn", ["Quiero la barra Classic", "Dos unidades"], { productId: "31", quantity: 2 }),
  f("F04", "price question, then need three of them", ["¿Cuánto cuesta la barra Classic?", "Necesito tres de esas"], { productId: "31", quantity: 3 }),
  f("F05", "comparison, then want three of one", ["¿Qué diferencia hay entre la Classic y la Pro?", "Quiero tres de la Pro"], { productId: "32", quantity: 3 }),
  f("F06", "stock question, then take two", ["¿Tienen stock de la barra Pro?", "Me llevo dos"], { productId: "32", quantity: 2 }),

  r("R01", "replace Classic x2 by one Pro (declarative)", "En realidad quiero una barra Pro", [{ productId: "31", quantity: 2 }], { productId: "32", quantity: 1 }),
  r("R02", "replace Pro x1 by three Classic (imperative)", "Cámbiala por tres barras Classic", [{ productId: "32", quantity: 1 }], { productId: "31", quantity: 3 }),
  r("R03", "change the quantity of the same product (declarative)", "Mejor prefiero 4 barras Classic", [{ productId: "31", quantity: 2 }], { productId: "31", quantity: 4 }),
  r("R04", "reduce the quantity of the same product (declarative)", "Ahora necesito solo dos barras Pro", [{ productId: "32", quantity: 3 }], { productId: "32", quantity: 2 })
];

export const SEMANTICS_SCENARIO_IDS: readonly string[] = SEMANTICS_SCENARIOS.map((scenario) => scenario.caseId);
export const scenarioById = (caseId: string): SemanticsScenario => {
  const found = SEMANTICS_SCENARIOS.find((scenario) => scenario.caseId === caseId);
  if (!found) throw new Error(`unknown P7.10 scenario ${caseId}`);
  return found;
};

export const isActionableGroup = (group: SpeechActGroup): boolean => group !== "N";

/** Per-turn annotation, declared here (never inferred from text at analysis time): context turns are `other`, the last turn carries the group semantics. */
export function turnAnnotations(scenario: SemanticsScenario): P78TurnAnnotation[] {
  const context: P78TurnAnnotation[] = scenario.turns.slice(0, -1).map(() => ({ kind: "other" }));
  const last: P78TurnAnnotation = scenario.group === "N" ? { kind: "informational" } : { kind: "explicit_purchase", statedQuantity: scenario.expected?.[0]?.quantity ?? null, commitAlternatives: scenario.group === "Q" ? ["create_quote"] : undefined };
  return [...context, last];
}

export const SEMANTICS_ANNOTATION_RESOLVER: P78AnnotationResolver = {
  annotationFor: (caseId, turnOrdinal) => turnAnnotations(scenarioById(caseId))[turnOrdinal] ?? { kind: "other" },
  annotatedTurnCount: (caseId) => scenarioById(caseId).turns.length
};

/** Offline (scripted-model) script per turn: only wiring tests use it, never a live run. Context replies of productFromContext scenarios name exactly one product. */
function offlineScript(scenario: SemanticsScenario, turnIndex: number): BenchmarkE2ECase["turns"][number]["offlineScript"] {
  const isLast = turnIndex === scenario.turns.length - 1;
  if (!isLast) return [{ kind: "use_tool", tool: "get_product_details", arguments: { productId: "31" } }, { kind: "respond", message: "La Barra Olimpica Classic 20kg cuesta $89.990." }];
  if (scenario.group === "N") return [{ kind: "use_tool", tool: "get_product_details", arguments: { productId: "31" } }, { kind: "respond", message: "La Barra Olimpica Classic 20kg cuesta $89.990." }];
  const expected = scenario.expected as ExpectedItem[];
  return [
    ...expected.map((item) => ({ kind: "use_tool" as const, tool: "get_product_details", arguments: { productId: item.productId } })),
    { kind: "use_tool", tool: "select_products", arguments: { items: expected.map((item) => ({ productId: item.productId, quantity: item.quantity })) } },
    { kind: "respond", message: "Listo, dejé tu selección." }
  ];
}

export function toBenchmarkCase(scenario: SemanticsScenario): BenchmarkE2ECase {
  const seed = scenario.seedSelection;
  return {
    caseId: scenario.caseId,
    description: scenario.description,
    notes: `P7.10 ${scenario.group} scenario. Outcome is measured by the P7.10 analysis, not by case expectations.`,
    identityLevel: scenario.identityLevel,
    ...(seed ? { setup: async (input: { opportunityId: number }) => seedBenchmarkSelection(input.opportunityId, seed) } : {}),
    turns: scenario.turns.map((customerMessage, turnIndex) => ({ customerMessage, offlineScript: offlineScript(scenario, turnIndex) })),
    expected: {},
    forbidden: {}
  };
}

export const buildSemanticsCorpus = (): BenchmarkE2ECase[] => SEMANTICS_SCENARIOS.map(toBenchmarkCase);
