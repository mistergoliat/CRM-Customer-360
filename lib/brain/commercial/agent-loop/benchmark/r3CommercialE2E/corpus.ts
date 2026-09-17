import { seedBenchmarkSelection, seedBenchmarkShippingDestination } from "../environment";
import type { BenchmarkE2ECase } from "./types";

/**
 * SALES-AGENT-R3-P7.4 (Section "CORPUS ACTUAL" / "CASOS MÍNIMOS"). New,
 * commercial-outcome-oriented corpus - none of the 15 cases below existed
 * before this task (the legacy C01-C12 and r3StableAgentV1 TS-0xx corpora
 * are tool-selection/boundary-behavior benchmarks at the Agent Tool Loop
 * layer only, never the full native R3 cycle - see docs/audits/
 * r3-p7-0-comparative-harness-capability-runtime-audit.md and this task's
 * own audit report). Kept deliberately reusing the SAME fixture data
 * (BENCHMARK_PRODUCTS "31"/"32", BENCHMARK_COMMUNES 99/100/101 -
 * benchmark/environment.ts) rather than inventing a second fixture catalog.
 *
 * Every case declares outcome + invariants, never a rigid tool sequence,
 * except where the case is explicitly about tool selection (none here are -
 * that dimension is already covered by the legacy/r3StableAgentV1 corpora,
 * kept and reused, never duplicated).
 */
export const BENCHMARK_E2E_CORPUS_VERSION = "r3-commercial-e2e.v1" as const;

export const BENCHMARK_E2E_CORPUS: BenchmarkE2ECase[] = [
  {
    caseId: "E01",
    description: "Product discovery, simple",
    notes: "A pure catalog read - never creates an opportunity, never a commercial objective.",
    identityLevel: "LEVEL_0_ANONYMOUS",
    turns: [
      {
        customerMessage: "que barras olimpicas tienen?",
        offlineScript: [
          { kind: "use_tool", tool: "search_products", arguments: { query: "barra olimpica" } },
          { kind: "respond", message: "Tenemos dos barras olimpicas de 20kg disponibles: la Classic y la Pro." }
        ]
      }
    ],
    expected: { selectionExists: false, destinationExists: false, quoteExists: false },
    forbidden: {}
  },
  {
    caseId: "E02",
    description: "Direct known product selection",
    notes: "Customer names a concrete product; the model grounds it via get_product_details before select_products.",
    identityLevel: "LEVEL_0_ANONYMOUS",
    turns: [
      {
        customerMessage: "quiero la barra olimpica classic de 20kg",
        offlineScript: [
          { kind: "use_tool", tool: "get_product_details", arguments: { productId: "31" } },
          { kind: "use_tool", tool: "select_products", arguments: { items: [{ productId: "31", quantity: 1 }] } },
          { kind: "respond", message: "Listo, agregue la Barra Olimpica Classic 20kg." }
        ]
      }
    ],
    expected: { selectionExists: true, minSelectionItemCount: 1 },
    forbidden: {}
  },
  {
    caseId: "E03",
    description: "Multiple products in one selection",
    notes: "Selection with two distinct products in a single select_products call.",
    identityLevel: "LEVEL_0_ANONYMOUS",
    turns: [
      {
        customerMessage: "quiero la classic y tambien la pro",
        offlineScript: [
          { kind: "use_tool", tool: "get_product_details", arguments: { productId: "31" } },
          { kind: "use_tool", tool: "get_product_details", arguments: { productId: "32" } },
          { kind: "use_tool", tool: "select_products", arguments: { items: [{ productId: "31", quantity: 1 }, { productId: "32", quantity: 1 }] } },
          { kind: "respond", message: "Listo, agregue ambas barras." }
        ]
      }
    ],
    expected: { selectionExists: true, minSelectionItemCount: 2 },
    forbidden: {}
  },
  {
    caseId: "E04",
    description: "Quantity correction across turns",
    notes: "Turn 1 selects quantity 1; turn 2 corrects it to 2 - the SAME product, a full-replacement select_products call per its own operationSemantics.",
    identityLevel: "LEVEL_0_ANONYMOUS",
    turns: [
      {
        customerMessage: "quiero una barra olimpica classic",
        offlineScript: [
          { kind: "use_tool", tool: "get_product_details", arguments: { productId: "31" } },
          { kind: "use_tool", tool: "select_products", arguments: { items: [{ productId: "31", quantity: 1 }] } },
          { kind: "respond", message: "Listo, una unidad." }
        ]
      },
      {
        customerMessage: "mejor dos unidades",
        offlineScript: [
          { kind: "use_tool", tool: "select_products", arguments: { items: [{ productId: "31", quantity: 2 }] } },
          { kind: "respond", message: "Listo, ahora son 2 unidades." }
        ]
      }
    ],
    expected: { selectionExists: true, minSelectionItemCount: 1 },
    forbidden: {}
  },
  {
    caseId: "E05",
    description: "Replace selection (customer changes their mind about the product)",
    notes: "Turn 2 replaces product 31 with product 32 entirely - a legitimate change, never flagged as repeatKnownSelection (that forbidden flag is intentionally NOT set on this case).",
    identityLevel: "LEVEL_0_ANONYMOUS",
    turns: [
      {
        customerMessage: "quiero la classic",
        offlineScript: [
          { kind: "use_tool", tool: "get_product_details", arguments: { productId: "31" } },
          { kind: "use_tool", tool: "select_products", arguments: { items: [{ productId: "31", quantity: 1 }] } },
          { kind: "respond", message: "Listo, agregue la Classic." }
        ]
      },
      {
        customerMessage: "en realidad prefiero la pro",
        offlineScript: [
          { kind: "use_tool", tool: "get_product_details", arguments: { productId: "32" } },
          { kind: "use_tool", tool: "select_products", arguments: { items: [{ productId: "32", quantity: 1 }] } },
          { kind: "respond", message: "Listo, cambie a la Pro." }
        ]
      }
    ],
    expected: { selectionExists: true, minSelectionItemCount: 1 },
    forbidden: {}
  },
  {
    caseId: "E06",
    description: "Destination already known - must not be re-asked",
    notes: "setup() durably seeds a CURRENT destination before the turn even starts. Historical defect (Section 'HISTORICAL FAILURES TO PRESERVE'): re-asking a durably known destination.",
    identityLevel: "LEVEL_0_ANONYMOUS",
    setup: async (input) => {
      await seedBenchmarkShippingDestination(input.opportunityId, "Las Condes");
    },
    turns: [
      {
        customerMessage: "cuanto demora el envio?",
        offlineScript: [{ kind: "respond", message: "El envio a Las Condes demora entre 2 y 3 dias habiles." }]
      }
    ],
    expected: { destinationExists: true },
    forbidden: { repeatKnownDestination: true }
  },
  {
    caseId: "E07",
    description: "Destination supplied mid-conversation",
    notes: "No destination in turn 1; the customer supplies one in turn 2, which the model persists via set_shipping_destination.",
    identityLevel: "LEVEL_0_ANONYMOUS",
    turns: [
      {
        customerMessage: "quiero la barra olimpica classic",
        offlineScript: [
          { kind: "use_tool", tool: "get_product_details", arguments: { productId: "31" } },
          { kind: "use_tool", tool: "select_products", arguments: { items: [{ productId: "31", quantity: 1 }] } },
          { kind: "respond", message: "Listo, la agregue. A donde la enviamos?" }
        ]
      },
      {
        customerMessage: "a Providencia por favor",
        offlineScript: [
          { kind: "use_tool", tool: "set_shipping_destination", arguments: { destination: "Providencia" } },
          { kind: "respond", message: "Listo, registre Providencia como destino." }
        ]
      }
    ],
    expected: { selectionExists: true, destinationExists: true },
    forbidden: {}
  },
  {
    caseId: "E08",
    description: "Calculate shipping once selection and destination are both current",
    notes: "setup() seeds both prerequisites durably, so the single turn can go straight to calculate_shipping - no rigid tool sequence imposed.",
    identityLevel: "LEVEL_0_ANONYMOUS",
    setup: async (input) => {
      await seedBenchmarkSelection(input.opportunityId, [{ productId: "31", quantity: 1 }]);
      await seedBenchmarkShippingDestination(input.opportunityId, "Ñuñoa");
    },
    turns: [
      {
        customerMessage: "cuanto sale el envio?",
        offlineScript: [
          { kind: "use_tool", tool: "calculate_shipping", arguments: {} },
          { kind: "respond", message: "El envio a Ñuñoa cuesta $4.990 y demora 2-3 dias habiles." }
        ]
      }
    ],
    expected: { selectionExists: true, destinationExists: true },
    forbidden: {}
  },
  {
    caseId: "E09",
    description: "Create quote without shipping requirement",
    notes: "create_quote has requireShipping:false structurally - a case must be able to reach QUOTE with only a current selection, no destination/shipping call at all.",
    identityLevel: "LEVEL_2_MASTER_RESOLVED",
    setup: async (input) => {
      await seedBenchmarkSelection(input.opportunityId, [{ productId: "31", quantity: 1 }]);
    },
    turns: [
      {
        customerMessage: "hazme una cotizacion",
        offlineScript: [
          { kind: "use_tool", tool: "create_quote", arguments: {} },
          { kind: "respond", message: "Tu cotizacion esta lista." }
        ]
      }
    ],
    expected: { selectionExists: true, quoteExists: true, finalObjectiveType: "QUOTE" },
    forbidden: { ungroundedQuoteClaim: true }
  },
  {
    caseId: "E10",
    description: "Create quote with shipping already available",
    notes: "Both destination and a calculated shipping option exist before create_quote - the richer, but still not required, path.",
    identityLevel: "LEVEL_2_MASTER_RESOLVED",
    setup: async (input) => {
      await seedBenchmarkSelection(input.opportunityId, [{ productId: "31", quantity: 1 }]);
      await seedBenchmarkShippingDestination(input.opportunityId, "Las Condes");
    },
    turns: [
      {
        customerMessage: "cotizame con el envio incluido",
        offlineScript: [
          { kind: "use_tool", tool: "calculate_shipping", arguments: {} },
          { kind: "use_tool", tool: "create_quote", arguments: {} },
          { kind: "respond", message: "Tu cotizacion con envio a Las Condes esta lista." }
        ]
      }
    ],
    expected: { selectionExists: true, destinationExists: true, quoteExists: true, finalObjectiveType: "QUOTE" },
    forbidden: { ungroundedQuoteClaim: true }
  },
  {
    caseId: "E11",
    description: "Retrieve an existing quote",
    notes: "The SAME turn's own create_quote produces the quote this harness can seed no other way (Quote Service has no injectable fixture seam) - turn 2 retrieves it via get_quote. ENVIRONMENT_BLOCKED end to end without a configured Quote Service, by honest construction, never a fabricated pass.",
    identityLevel: "LEVEL_2_MASTER_RESOLVED",
    setup: async (input) => {
      await seedBenchmarkSelection(input.opportunityId, [{ productId: "31", quantity: 1 }]);
    },
    turns: [
      {
        customerMessage: "hazme una cotizacion",
        offlineScript: [
          { kind: "use_tool", tool: "create_quote", arguments: {} },
          { kind: "respond", message: "Tu cotizacion esta lista." }
        ]
      },
      {
        customerMessage: "puedes confirmarme el estado de la cotizacion?",
        offlineScript: [
          { kind: "use_tool", tool: "get_quote", arguments: {} },
          { kind: "respond", message: "Tu cotizacion sigue vigente." }
        ]
      }
    ],
    expected: { quoteExists: true, finalObjectiveType: "QUOTE" },
    forbidden: { ungroundedQuoteClaim: true }
  },
  {
    caseId: "E12",
    description: "Identity insufficient for create_quote",
    notes: "LEVEL_0_ANONYMOUS session - the identity gate must deny create_quote, never the model's own reasoning fault.",
    identityLevel: "LEVEL_0_ANONYMOUS",
    setup: async (input) => {
      await seedBenchmarkSelection(input.opportunityId, [{ productId: "31", quantity: 1 }]);
    },
    turns: [
      {
        customerMessage: "hazme una cotizacion",
        offlineScript: [
          { kind: "use_tool", tool: "create_quote", arguments: {} },
          { kind: "respond", message: "Necesito verificar tu identidad antes de generar la cotizacion." }
        ]
      }
    ],
    expected: { identitySufficientForMutation: false, quoteExists: false },
    forbidden: {}
  },
  {
    caseId: "E13",
    description: "Courtesy turn after an active QUOTE objective preserves it",
    notes: "Turn 2 is pure courtesy (\"gracias\") - proposal.objective=null, P5 NOOP - the durable QUOTE objective from turn 1 must survive unchanged.",
    identityLevel: "LEVEL_2_MASTER_RESOLVED",
    setup: async (input) => {
      await seedBenchmarkSelection(input.opportunityId, [{ productId: "31", quantity: 1 }]);
    },
    turns: [
      {
        customerMessage: "hazme una cotizacion",
        offlineScript: [
          { kind: "use_tool", tool: "create_quote", arguments: {} },
          { kind: "respond", message: "Tu cotizacion esta lista." }
        ]
      },
      {
        customerMessage: "muchas gracias!",
        offlineScript: [{ kind: "respond", message: "De nada, cualquier cosa me avisas." }]
      }
    ],
    expected: { finalObjectiveType: "QUOTE", quoteExists: true },
    forbidden: { ungroundedQuoteClaim: true }
  },
  {
    caseId: "E14",
    description: "Customer changes objective mid-conversation",
    notes: "Turn 1 is a SELECT_PRODUCTS objective; turn 2 the customer explicitly asks to quote - a REPLACE, never a rigid tool sequence requirement.",
    identityLevel: "LEVEL_2_MASTER_RESOLVED",
    turns: [
      {
        customerMessage: "quiero la barra olimpica classic",
        offlineScript: [
          { kind: "use_tool", tool: "get_product_details", arguments: { productId: "31" } },
          { kind: "use_tool", tool: "select_products", arguments: { items: [{ productId: "31", quantity: 1 }] } },
          { kind: "respond", message: "Listo, la agregue." }
        ]
      },
      {
        customerMessage: "mejor cotizamela",
        offlineScript: [
          { kind: "use_tool", tool: "create_quote", arguments: {} },
          { kind: "respond", message: "Tu cotizacion esta lista." }
        ]
      }
    ],
    expected: { finalObjectiveType: "QUOTE", selectionExists: true },
    forbidden: { ungroundedQuoteClaim: true }
  },
  {
    caseId: "E15",
    description: "\"Todo junto\" - one turn states product, quantity and destination together",
    notes: "A single multi-fact customer turn - the model must ground and persist selection AND destination without needing separate turns.",
    identityLevel: "LEVEL_0_ANONYMOUS",
    turns: [
      {
        customerMessage: "quiero 2 barras olimpicas classic, envialas a Ñuñoa",
        offlineScript: [
          { kind: "use_tool", tool: "get_product_details", arguments: { productId: "31" } },
          { kind: "use_tool", tool: "select_products", arguments: { items: [{ productId: "31", quantity: 2 }] } },
          { kind: "use_tool", tool: "set_shipping_destination", arguments: { destination: "Ñuñoa" } },
          { kind: "respond", message: "Listo, 2 unidades a Ñuñoa." }
        ]
      }
    ],
    expected: { selectionExists: true, destinationExists: true, minSelectionItemCount: 1 },
    forbidden: {}
  }
];
