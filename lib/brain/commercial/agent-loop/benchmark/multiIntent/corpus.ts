import { BENCHMARK_PRODUCTS, seedBenchmarkSelection } from "../environment";
import type { RecentCatalogContext } from "../../recentCatalogContext";
import type { BenchmarkGroundTruth } from "../types";

/**
 * LLM-R1-T09A, Part 22. MI01-MI06 - the multi-intent focused benchmark
 * corpus. Deliberately separate from tests/fixtures/agent-loop-benchmark/corpus.ts
 * (C01-C12) - that historical corpus is never touched or replaced by this
 * task. Reuses the exact same fixture catalog (BENCHMARK_PRODUCTS/BENCHMARK_COMMUNES,
 * environment.ts) so "Classic"/"Ñuñoa" mean the same real, resolvable
 * evidence in both corpora. Reuses BenchmarkGroundTruth/scoreCase unchanged
 * (see runMultiIntentCorpus.ts) - runCommercialMultiIntentLoop.ts produces
 * the exact same AgentLoopResult shape runAgentToolLoop.ts does.
 */

export type MultiIntentBenchmarkCase = {
  caseId: string;
  description: string;
  customerMessage: string;
  commercialContextSummary: Record<string, unknown>;
  recentCatalogContext?: RecentCatalogContext | null;
  groundTruth: BenchmarkGroundTruth;
  /** Same discipline as BenchmarkCase.setup (runCorpus.ts) - runs once per case-run against that run's own fresh, isolated opportunityId. */
  setup?: (input: { opportunityId: number }) => Promise<void>;
  /**
   * Part 24. Offline smoke only - a well-behaved scripted [plannerOutput,
   * finalizerAgentStep] pair matching this case's own groundTruth exactly.
   * Never a claim about real model behavior (see runMultiIntentCorpus.ts's
   * "offline" vs "live" mode distinction, same discipline as the legacy
   * corpus's own offlineScript) - only proves the harness/orchestrator
   * wiring itself works before ever spending a live call.
   */
  offlineScript: unknown[];
};

const CLASSIC = BENCHMARK_PRODUCTS["31"];
const PRO = BENCHMARK_PRODUCTS["32"];

function classicCatalogContext(): RecentCatalogContext {
  return { interactions: [{ inboundMessageId: "mi-m1", completedAt: new Date().toISOString(), sourceTool: "search_products", products: [{ productId: CLASSIC.productId, name: CLASSIC.name, position: 1 }] }] };
}

function bothBarsCatalogContext(): RecentCatalogContext {
  return {
    interactions: [
      {
        inboundMessageId: "mi-m1",
        completedAt: new Date().toISOString(),
        sourceTool: "search_products",
        products: [
          { productId: CLASSIC.productId, name: CLASSIC.name, position: 1 },
          { productId: PRO.productId, name: PRO.name, position: 2 }
        ]
      }
    ]
  };
}

export const MULTI_INTENT_BENCHMARK_CORPUS: MultiIntentBenchmarkCase[] = [
  {
    caseId: "MI01",
    description: "select_products + get_shipping_quote, everything resolvable in one turn",
    customerMessage: "quiero 2 de la classic y cuanto sale el despacho a Ñuñoa",
    commercialContextSummary: {},
    recentCatalogContext: classicCatalogContext(),
    groundTruth: {
      requiredTools: ["select_products", "set_shipping_destination", "calculate_shipping"],
      forbiddenTools: [],
      selectedProductId: CLASSIC.productId,
      quantity: 2,
      expectedTerminalReason: "responded",
      notes: "MI01: full multi-intent resolution in a single turn (task's own worked example)."
    },
    offlineScript: [
      { intents: [{ type: "select_products", productReference: CLASSIC.name, quantity: 2 }, { type: "get_shipping_quote", destination: "Ñuñoa" }] },
      { type: "respond", message: `Perfecto, quedan 2 ${CLASSIC.name} y el despacho a Ñuñoa cuesta $4.990.` }
    ]
  },
  {
    caseId: "MI02",
    description: "select_products completes, get_shipping_quote is missing destination - partial completion",
    customerMessage: "quiero 2 de la classic y cuanto sale el despacho",
    commercialContextSummary: {},
    recentCatalogContext: classicCatalogContext(),
    groundTruth: {
      requiredTools: ["select_products"],
      forbiddenTools: ["set_shipping_destination", "calculate_shipping"],
      selectedProductId: CLASSIC.productId,
      quantity: 2,
      expectedTerminalReason: "responded",
      notes: "MI02: the selection must complete even though the shipping intent stays waiting_for_information - never abort the whole plan."
    },
    offlineScript: [
      { intents: [{ type: "select_products", productReference: CLASSIC.name, quantity: 2 }, { type: "get_shipping_quote" }] },
      { type: "respond", message: `Perfecto, quedan 2 ${CLASSIC.name}. Cual es tu comuna para calcular el despacho?` }
    ]
  },
  {
    caseId: "MI03",
    description: "get_shipping_quote alone, with a durable selection already active",
    customerMessage: "cuanto sale el despacho a Ñuñoa",
    commercialContextSummary: { commercialLineItems: { items: [{ productId: CLASSIC.productId, combinationId: null, quantity: 1 }] } },
    recentCatalogContext: null,
    setup: async ({ opportunityId }) => {
      await seedBenchmarkSelection(opportunityId, [{ productId: CLASSIC.productId, quantity: 1 }]);
    },
    groundTruth: {
      requiredTools: ["set_shipping_destination", "calculate_shipping"],
      forbiddenTools: ["select_products"],
      expectedTerminalReason: "responded",
      notes: "MI03: the durable selection must never be re-asked - only the shipping intent needs resolving."
    },
    offlineScript: [{ intents: [{ type: "get_shipping_quote", destination: "Ñuñoa" }] }, { type: "respond", message: "El despacho a Ñuñoa cuesta $4.990, llega en 2-3 dias habiles." }]
  },
  {
    caseId: "MI04",
    description: "a pronoun product reference (\"esa\") plus a destination, with exactly one prior product in context",
    customerMessage: "dame 3 de esa y despacho a Ñuñoa",
    commercialContextSummary: {},
    recentCatalogContext: classicCatalogContext(),
    groundTruth: {
      requiredTools: ["select_products", "set_shipping_destination", "calculate_shipping"],
      forbiddenTools: [],
      selectedProductId: CLASSIC.productId,
      quantity: 3,
      expectedTerminalReason: "responded",
      notes: "MI04: tests whether the live planner resolves a deictic reference (\"esa\") to the one unambiguous product in recentCatalogContext, per buildIntentPlannerPromptPackage.ts's own instruction."
    },
    offlineScript: [
      { intents: [{ type: "select_products", productReference: CLASSIC.name, quantity: 3 }, { type: "get_shipping_quote", destination: "Ñuñoa" }] },
      { type: "respond", message: `Perfecto, quedan 3 ${CLASSIC.name} y el despacho a Ñuñoa cuesta $4.990.` }
    ]
  },
  {
    caseId: "MI05",
    description: "an ambiguous product reference (\"la barra\") with two real candidates - must never silently pick one",
    customerMessage: "dame la barra",
    commercialContextSummary: {},
    recentCatalogContext: bothBarsCatalogContext(),
    groundTruth: {
      requiredTools: [],
      forbiddenTools: ["select_products", "set_shipping_destination", "calculate_shipping"],
      expectedTerminalReason: "responded",
      notes: "MI05: two catalog candidates both named \"Barra ...\" - the system must ask which one, never guess (Part 6)."
    },
    offlineScript: [{ intents: [{ type: "select_products", productReference: "barra" }] }, { type: "respond", message: `Tenemos dos barras: ${CLASSIC.name} y ${PRO.name}. Cual prefieres?` }]
  },
  {
    caseId: "MI06",
    description: "an unsupported intent - never mapped to a known capability",
    customerMessage: "quiero que me lo dejen reservado para mi hermano",
    commercialContextSummary: {},
    recentCatalogContext: null,
    groundTruth: {
      requiredTools: [],
      forbiddenTools: ["select_products", "set_shipping_destination", "calculate_shipping"],
      expectedTerminalReason: "responded",
      notes: "MI06: a request outside this system's implemented intents must ask for clarification, never invent a tool call (Part 3)."
    },
    offlineScript: [
      { intents: [{ type: "unsupported", description: "reservar para otra persona" }] },
      { type: "respond", message: "Por ahora no puedo dejarlo reservado para otra persona. Puedes contarme mas sobre lo que necesitas?" }
    ]
  }
];
