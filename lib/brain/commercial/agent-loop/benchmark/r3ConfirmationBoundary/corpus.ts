import { seedBenchmarkSelection } from "../environment";
import type { BenchmarkE2ECase } from "../r3CommercialE2E/types";
import type { P78AnnotationResolver } from "../r3AutonomousAB/analysis";
import type { P78TurnAnnotation } from "../r3AutonomousAB/abCorpus";

/**
 * SALES-AGENT-R3-P7.11. A NEW corpus (not the 46 P7.10 scenarios), same business truth, more
 * natural commercial language, more multi-turn. Groups:
 *  A direct declarative actionable      (12): single turn, product+quantity stated together.
 *  B multi-turn intent completion       (12): 3 turns; product is stated by the CUSTOMER in turn 1
 *      or turn 2 (never inferred from the assistant's reply); quantity is stated in turn 3, the
 *      only analysed turn.
 *  C imperative / explicit action        (6): positive control, expected high even under R0.
 *  D quote-oriented                      (6): measures selection progression, not create_quote
 *      success (Quote Service is BLOCKED locally - never held against either variant).
 *  E informational negative              (8): no mutation expected.
 *  F correction / replacement            (4): a durable selection is seeded; the customer changes it.
 * = 48 scenarios, 72 turns. No message string is copied from the P7.10 corpus (semanticsCorpus.ts,
 * test-verified). "barra Classic" / "barra Pro" always carries the noun at first mention in a
 * scenario, so no scenario accidentally reproduces the P7.10 bare-"Pro" fixture ambiguity
 * (documented instrument limitation, out of scope here).
 */
export const REPLICATION_CORPUS_VERSION = "r3-p7-11.v1" as const;

export type ReplicationGroup = "A" | "B" | "C" | "D" | "E" | "F";
export const REPLICATION_GROUPS: readonly ReplicationGroup[] = ["A", "B", "C", "D", "E", "F"];
export const REPLICATION_GROUP_LABELS: Record<ReplicationGroup, string> = {
  A: "direct_declarative_actionable",
  B: "multi_turn_intent_completion",
  C: "imperative_explicit_action",
  D: "quote_oriented",
  E: "informational_negative",
  F: "correction_replacement"
};

export type ExpectedItem = { productId: "31" | "32"; quantity: number };

export type ReplicationScenario = {
  caseId: string;
  group: ReplicationGroup;
  description: string;
  identityLevel: "LEVEL_0_ANONYMOUS" | "LEVEL_2_MASTER_RESOLVED";
  /** Context turns first; the LAST turn is the analysed one (for B: the turn where quantity - the last missing fact - is stated). */
  turns: string[];
  /** The durable selection the customer's stated facts should produce. Absent only for E (informational). */
  expected?: ExpectedItem[];
  /** Durable selection seeded before the first turn (F scenarios). */
  seedSelection?: { productId: string; quantity: number }[];
};

const base = { identityLevel: "LEVEL_0_ANONYMOUS" } as const;
const a = (caseId: string, description: string, message: string, expected: ExpectedItem): ReplicationScenario => ({ caseId, group: "A", description, ...base, turns: [message], expected: [expected] });
const b = (caseId: string, description: string, turns: string[], expected: ExpectedItem): ReplicationScenario => ({ caseId, group: "B", description, ...base, turns, expected: [expected] });
const c = (caseId: string, description: string, message: string, expected: ExpectedItem): ReplicationScenario => ({ caseId, group: "C", description, ...base, turns: [message], expected: [expected] });
const d = (caseId: string, description: string, message: string, expected: ExpectedItem): ReplicationScenario => ({ caseId, group: "D", description, identityLevel: "LEVEL_2_MASTER_RESOLVED", turns: [message], expected: [expected] });
const e = (caseId: string, description: string, message: string): ReplicationScenario => ({ caseId, group: "E", description, ...base, turns: [message] });
const f = (caseId: string, description: string, message: string, seedSelection: { productId: string; quantity: number }[], expected: ExpectedItem): ReplicationScenario => ({ caseId, group: "F", description, ...base, turns: [message], expected: [expected], seedSelection });

export const REPLICATION_SCENARIOS: readonly ReplicationScenario[] = [
  // A - direct declarative actionable (12)
  a("P11A01", "conditional quantity phrasing", "Serían dos de la barra Classic, por favor", { productId: "31", quantity: 2 }),
  a("P11A02", "for-me phrasing", "Para mí, tres barras Pro nomás", { productId: "32", quantity: 3 }),
  a("P11A03", "going-for phrasing", "Voy por dos barras Classic entonces", { productId: "31", quantity: 2 }),
  a("P11A04", "final-count phrasing", "Al final serán cuatro de la barra Pro", { productId: "32", quantity: 4 }),
  a("P11A05", "demonstrative plus product name", "Me quedo con dos de esas, la barra Classic", { productId: "31", quantity: 2 }),
  a("P11A06", "purpose clause, branch", "Que sean tres barras Classic para la sucursal", { productId: "31", quantity: 3 }),
  a("P11A07", "single unit, sufficiency phrasing", "Dame no más una barra Pro, con eso me basta", { productId: "32", quantity: 1 }),
  a("P11A08", "larger quantity, resignation phrasing", "Llévame igual cinco barras Classic", { productId: "31", quantity: 5 }),
  a("P11A09", "product-first phrasing", "De la barra Pro, ándate con dos", { productId: "32", quantity: 2 }),
  a("P11A10", "account phrasing", "Ya, cárgame tres barras Classic a mi cuenta", { productId: "31", quantity: 3 }),
  a("P11A11", "recall-then-want phrasing", "Esas dos barras Pro que vimos, esas quiero", { productId: "32", quantity: 2 }),
  a("P11A12", "note-down phrasing, quantity in words", "Anota que son cuatro barras Classic las que necesito", { productId: "31", quantity: 4 }),

  // B - multi-turn intent completion (12): product named by the customer in turn 1 or 2, quantity in turn 3
  b("P11B01", "recommendation request, product confirmed, quantity", ["¿Cuál barra recomiendas para armar algo en la casa?", "Esa barra Classic me acomoda", "Van a ser dos"], { productId: "31", quantity: 2 }),
  b("P11B02", "show product, stock follow-up, quantity", ["Muéstrame la barra Pro porfa", "¿Qué stock tienen de esa?", "Dale, con tres"], { productId: "32", quantity: 3 }),
  b("P11B03", "comparison, preference, quantity", ["Entre la barra Classic y la barra Pro, ¿cuál conviene más para powerlifting?", "Prefiero la barra Pro entonces", "Dos unidades, por favor"], { productId: "32", quantity: 2 }),
  b("P11B04", "difference question, preference, quantity", ["¿Qué diferencia hay entre las dos barras que tienen?", "Me quedo mejor con la barra Classic", "Serían tres"], { productId: "31", quantity: 3 }),
  b("P11B05", "beginner suggestion, agreement, quantity", ["Para alguien que recién parte, ¿qué me sugieres?", "Ya, la barra Classic entonces", "Me llevo cuatro"], { productId: "31", quantity: 4 }),
  b("P11B06", "product named in turn 1, confirmation, quantity", ["¿La barra Pro sirve para uso diario en un box?", "Perfecto, esa quiero", "Una nomás"], { productId: "32", quantity: 1 }),
  b("P11B07", "product named in turn 1, confirmation, imperative quantity", ["¿Qué tal la barra Classic para mi gimnasio en casa?", "Sí, esa me sirve", "Ponme dos entonces"], { productId: "31", quantity: 2 }),
  b("P11B08", "product named in turn 1, conviction, quantity", ["Cuéntame de la barra Pro, ¿para qué sirve?", "Me convence, esa es", "Tres, por favor"], { productId: "32", quantity: 3 }),
  b("P11B09", "weight question on named product, agreement, quantity", ["¿Cuánto pesa la barra Classic?", "Ya, me quedo con esa", "Manda dos"], { productId: "31", quantity: 2 }),
  b("P11B10", "durability question, alternative preferred, quantity", ["¿Tienen algo más resistente que la barra Classic?", "La barra Pro entonces, esa es mejor para mí", "Necesito cuatro"], { productId: "32", quantity: 4 }),
  b("P11B11", "competition comparison, decision, quantity", ["¿Cuál es mejor para competencia, la barra Classic o la barra Pro?", "Listo, la barra Pro", "Con dos me alcanza"], { productId: "32", quantity: 2 }),
  b("P11B12", "load capacity on named product, agreement, quantity", ["¿Qué capacidad de peso soporta la barra Classic?", "Bien, esa es la que quiero", "Tres unidades"], { productId: "31", quantity: 3 }),

  // C - imperative / explicit action (6, positive control)
  c("P11C01", "imperative add to selection, with courtesy tail", "Agrégame tres barras Pro a la selección, porfa", { productId: "32", quantity: 3 }),
  c("P11C02", "imperative sum to what is carried", "Suma dos barras Classic a lo que ya llevo", { productId: "31", quantity: 2 }),
  c("P11C03", "imperative note down, singular", "Déjame anotada una barra Pro nomás", { productId: "32", quantity: 1 }),
  c("P11C04", "imperative incorporate to order", "Incorpora cuatro barras Classic al pedido ahora", { productId: "31", quantity: 4 }),
  c("P11C05", "imperative add to shopping list", "Métele dos barras Pro a mi lista de compra", { productId: "32", quantity: 2 }),
  c("P11C06", "imperative register at once", "Regístrame tres barras Classic de una vez", { productId: "31", quantity: 3 }),

  // D - quote-oriented (6, LEVEL_2_MASTER_RESOLVED like P7.10 Q)
  d("P11D01", "quote request, courtesy phrasing", "Ocupo que me coticen dos barras Classic, por favor", { productId: "31", quantity: 2 }),
  d("P11D02", "quote request, can-you phrasing", "¿Puedes prepararme una cotización de tres barras Pro?", { productId: "32", quantity: 3 }),
  d("P11D03", "quote request, informal number phrasing", "Pásame el numerito formal de cuatro barras Classic, para cotizar", { productId: "31", quantity: 4 }),
  d("P11D04", "quote request, third-party purpose", "Requiero cotización de dos barras Pro para mi jefe", { productId: "32", quantity: 2 }),
  d("P11D05", "quote request, send-when-you-can phrasing", "Envíame cotización de una barra Classic cuando puedas", { productId: "31", quantity: 1 }),
  d("P11D06", "quote request, imperative build", "Arma la cotización con tres barras Pro, porfa", { productId: "32", quantity: 3 }),

  // E - informational negative (8): price, stock, comparison, recommendation, features, compatibility, link, informational shipping
  e("P11E01", "price", "¿A cómo está la barra Classic?"),
  e("P11E02", "stock", "¿Les queda stock de la barra Pro?"),
  e("P11E03", "comparison", "¿En qué se diferencian la barra Classic y la barra Pro?"),
  e("P11E04", "recommendation", "¿Cuál me conviene para entrenar en casa?"),
  e("P11E05", "features", "¿De qué material es la barra Pro?"),
  e("P11E06", "compatibility", "¿La barra Classic sirve con discos olímpicos estándar?"),
  e("P11E07", "link", "¿Me pasas el link de la barra Pro para verla?"),
  e("P11E08", "informational shipping", "¿Hacen despacho a regiones con la barra Classic?"),

  // F - correction / replacement (4): durable selection seeded, then changed
  f("P11F01", "replace product entirely (declarative)", "Mejor déjame solo con una barra Pro", [{ productId: "31", quantity: 2 }], { productId: "32", quantity: 1 }),
  f("P11F02", "replace product entirely (dismissal + imperative-ish)", "Olvida esa, ahora son dos barras Classic", [{ productId: "32", quantity: 1 }], { productId: "31", quantity: 2 }),
  f("P11F03", "increase quantity of the same product", "Súbele, al final quiero cinco barras Classic", [{ productId: "31", quantity: 3 }], { productId: "31", quantity: 5 }),
  f("P11F04", "decrease quantity of the same product", "Bájale a dos barras Pro, con eso basta", [{ productId: "32", quantity: 4 }], { productId: "32", quantity: 2 })
];

export const REPLICATION_SCENARIO_IDS: readonly string[] = REPLICATION_SCENARIOS.map((scenario) => scenario.caseId);
export const scenarioById = (caseId: string): ReplicationScenario => {
  const found = REPLICATION_SCENARIOS.find((scenario) => scenario.caseId === caseId);
  if (!found) throw new Error(`unknown P7.11 scenario ${caseId}`);
  return found;
};

export const isActionableGroup = (group: ReplicationGroup): boolean => group !== "E";

/** Scenarios interleaved round-robin across the six groups so no group is bunched in time. */
export function interleavedScenarioIds(scenarios: readonly ReplicationScenario[] = REPLICATION_SCENARIOS): string[] {
  const groups = REPLICATION_GROUPS.map((group) => scenarios.filter((scenario) => scenario.group === group).map((scenario) => scenario.caseId));
  const out: string[] = [];
  for (let index = 0; index < Math.max(...groups.map((group) => group.length)); index += 1) for (const group of groups) if (index < group.length) out.push(group[index]);
  return out;
}

/** Per-turn annotation, declared here (never inferred from text at analysis time): context turns are `other`, the last turn carries the group semantics. Product resolution never depends on the assistant's reply (unlike P7.10 F01): every B scenario's product is stated by the customer in turn 1 or turn 2. */
export function turnAnnotations(scenario: ReplicationScenario): P78TurnAnnotation[] {
  const context: P78TurnAnnotation[] = scenario.turns.slice(0, -1).map(() => ({ kind: "other" }));
  const last: P78TurnAnnotation = scenario.group === "E" ? { kind: "informational" } : { kind: "explicit_purchase", statedQuantity: scenario.expected?.[0]?.quantity ?? null, commitAlternatives: scenario.group === "D" ? ["create_quote"] : undefined };
  return [...context, last];
}

export const REPLICATION_ANNOTATION_RESOLVER: P78AnnotationResolver = {
  annotationFor: (caseId, turnOrdinal) => turnAnnotations(scenarioById(caseId))[turnOrdinal] ?? { kind: "other" },
  annotatedTurnCount: (caseId) => scenarioById(caseId).turns.length
};

/** Offline (scripted-model) script per turn: only wiring tests use it, never a live run. */
function offlineScript(scenario: ReplicationScenario, turnIndex: number): BenchmarkE2ECase["turns"][number]["offlineScript"] {
  const isLast = turnIndex === scenario.turns.length - 1;
  if (!isLast || scenario.group === "E") return [{ kind: "use_tool", tool: "get_product_details", arguments: { productId: "31" } }, { kind: "respond", message: "La Barra Olimpica Classic 20kg cuesta $89.990." }];
  const expected = scenario.expected as ExpectedItem[];
  return [
    ...expected.map((item) => ({ kind: "use_tool" as const, tool: "get_product_details", arguments: { productId: item.productId } })),
    { kind: "use_tool", tool: "select_products", arguments: { items: expected.map((item) => ({ productId: item.productId, quantity: item.quantity })) } },
    { kind: "respond", message: "Listo, dejé tu selección." }
  ];
}

export function toBenchmarkCase(scenario: ReplicationScenario): BenchmarkE2ECase {
  const seed = scenario.seedSelection;
  return {
    caseId: scenario.caseId,
    description: scenario.description,
    notes: `P7.11 ${scenario.group} scenario. Outcome is measured by the P7.11 analysis, not by case expectations.`,
    identityLevel: scenario.identityLevel,
    ...(seed ? { setup: async (input: { opportunityId: number }) => seedBenchmarkSelection(input.opportunityId, seed) } : {}),
    turns: scenario.turns.map((customerMessage, turnIndex) => ({ customerMessage, offlineScript: offlineScript(scenario, turnIndex) })),
    expected: {},
    forbidden: {}
  };
}

export const buildReplicationCorpus = (): BenchmarkE2ECase[] => REPLICATION_SCENARIOS.map(toBenchmarkCase);
