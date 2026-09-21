import { BENCHMARK_E2E_CORPUS } from "../r3CommercialE2E/corpus";
import type { BenchmarkE2ECase } from "../r3CommercialE2E/types";

/**
 * SALES-AGENT-R3-P7.8. The primary cases are the P7.7 cohort verbatim (task
 * section 11: "No modificar inputs") - taken by reference from the existing
 * E2E corpus, never copied. Only the four informational negative controls
 * (section 12) are new.
 */
export const P78_AB_CORPUS_VERSION = "r3-p7-8-ab.v1" as const;

export const P78_PRIMARY_CASE_IDS = ["E02", "E04", "E05", "E07", "E14", "E15"] as const;
export const P78_NEGATIVE_CONTROL_CASE_IDS = ["N01", "N02", "N03", "N04"] as const;

/** Fixture catalog (benchmark/environment.ts BENCHMARK_PRODUCTS) - a durable selection outside this set is corruption by construction. */
export const P78_KNOWN_FIXTURE_PRODUCT_IDS: readonly string[] = ["31", "32"];

/**
 * Per-turn intent annotation, declared here (never inferred from text at
 * analysis time). `statedQuantity` separates the two quantity semantics of
 * section 17: a number means the customer already gave the quantity (a
 * follow-up question about quantity is then unnecessary); null means the
 * quantity is genuinely missing (asking for it is legitimate, never penalized).
 * `commitAlternatives` lists capabilities that also count as commercial
 * progression for the taxonomy only (E14 t1 asks to quote - Quote Service is
 * BLOCKED locally, section 19); the primary metric is always select_products.
 */
export type P78TurnAnnotation =
  | {
      kind: "explicit_purchase";
      statedQuantity: number | null;
      commitAlternatives?: readonly string[];
      /** Documented instrument limitation (section 18) - reported, never used as an argument for either variant. */
      harnessLimitation?: string;
    }
  | { kind: "informational" }
  | { kind: "other" };

export const P78_TURN_ANNOTATIONS: Readonly<Record<string, readonly P78TurnAnnotation[]>> = {
  E02: [{ kind: "explicit_purchase", statedQuantity: null }],
  E04: [
    { kind: "explicit_purchase", statedQuantity: 1 },
    { kind: "explicit_purchase", statedQuantity: 2 }
  ],
  E05: [
    { kind: "explicit_purchase", statedQuantity: null },
    { kind: "explicit_purchase", statedQuantity: null, harnessLimitation: "E05_T1_REPLACEMENT_CATALOG_STUB: the catalog stub cannot reliably resolve 'la Pro' from this phrase (P7.6 10.1, P7.7 section 9)" }
  ],
  E07: [{ kind: "explicit_purchase", statedQuantity: null }, { kind: "other" }],
  E14: [
    { kind: "explicit_purchase", statedQuantity: null },
    { kind: "explicit_purchase", statedQuantity: null, commitAlternatives: ["create_quote"] }
  ],
  E15: [{ kind: "explicit_purchase", statedQuantity: 2 }],
  N01: [{ kind: "informational" }],
  N02: [{ kind: "informational" }],
  N03: [{ kind: "informational" }],
  N04: [{ kind: "informational" }]
};

function informationalCase(caseId: string, description: string, customerMessage: string, offlineReply: string): BenchmarkE2ECase {
  return {
    caseId,
    description,
    notes: "P7.8 negative control: a purely informational question. No commercial mutation may be requested (over-mutation check).",
    identityLevel: "LEVEL_0_ANONYMOUS",
    turns: [
      {
        customerMessage,
        offlineScript: [
          { kind: "use_tool", tool: "get_product_details", arguments: { productId: "31" } },
          { kind: "respond", message: offlineReply }
        ]
      }
    ],
    expected: { selectionExists: false, destinationExists: false, quoteExists: false },
    forbidden: {}
  };
}

export const P78_NEGATIVE_CONTROL_CORPUS: BenchmarkE2ECase[] = [
  informationalCase("N01", "Price question", "¿Cuánto cuesta la barra Classic?", "La Barra Olimpica Classic 20kg cuesta $89.990."),
  informationalCase("N02", "Comparison question", "¿Qué diferencia hay entre la Classic y la Pro?", "La Pro tiene mayor capacidad de carga que la Classic."),
  informationalCase("N03", "Stock question", "¿Tienen stock de la Classic?", "Si, tenemos stock de la Classic."),
  informationalCase("N04", "Recommendation question", "¿Cuál me recomiendas?", "Depende de tu entrenamiento: la Classic sirve para uso general.")
];

export function buildP78AbCorpus(): BenchmarkE2ECase[] {
  const primary = P78_PRIMARY_CASE_IDS.map((caseId) => {
    const found = BENCHMARK_E2E_CORPUS.find((testCase) => testCase.caseId === caseId);
    if (!found) throw new Error(`P7.8 primary case ${caseId} is missing from the E2E corpus`);
    return found;
  });
  return [...primary, ...P78_NEGATIVE_CONTROL_CORPUS];
}

export function annotatedTurnCount(caseId: string): number {
  return P78_TURN_ANNOTATIONS[caseId]?.length ?? 0;
}

export function annotationFor(caseId: string, turnOrdinal: number): P78TurnAnnotation {
  return P78_TURN_ANNOTATIONS[caseId]?.[turnOrdinal] ?? { kind: "other" };
}
