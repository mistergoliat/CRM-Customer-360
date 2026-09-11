import { executeGovernedCapability } from "../../../capability-gateway/executeCapability";
import { setCalculateShippingCarrierServiceForTests } from "../../../capability-gateway/calculateShippingCapability";
import type { CarrierQuoteResult, CarrierService } from "@/lib/domains/carrier-service";
import { BENCHMARK_PRODUCTS, seedBenchmarkSelection, seedBenchmarkShippingDestination } from "../environment";
import type { RecentCatalogContext } from "../../recentCatalogContext";
import type { GoldenCase, GoldenDecisionCase, GoldenTurnCase } from "./types";

/**
 * R3 Stable Agent Acceptance Harness V1 - frozen golden case set V1 (task
 * section 2/3). Deliberately separate from the legacy C01-C12 corpus and the
 * MI01-MI06 multi-intent corpus - neither is touched by this task. Reuses
 * BENCHMARK_PRODUCTS/seedBenchmarkSelection/seedBenchmarkShippingDestination
 * (environment.ts) unchanged, same fixture catalog every other benchmark
 * corpus in this repo already shares.
 *
 * Every case's own offlineScript is a well-behaved answer matching that
 * exact case's own expected ground truth - a fixture for validating the
 * harness/scorer, never a claim about real model behavior (see runGoldenSuite.ts's
 * "offline" vs "live" mode distinction, same discipline the legacy corpus
 * already established).
 */

const CLASSIC = BENCHMARK_PRODUCTS["31"];
const CONTROLLED_FAILURE_PRODUCT = BENCHMARK_PRODUCTS["999"];

function singleProductContext(productId: string, name: string): RecentCatalogContext {
  return { interactions: [{ inboundMessageId: "ctx-m1", completedAt: new Date().toISOString(), sourceTool: "search_products", products: [{ productId, name, position: 1 }] }] };
}

function multiProductContext(products: Array<{ productId: string; name: string }>): RecentCatalogContext {
  return {
    interactions: [
      {
        inboundMessageId: "ctx-m1",
        completedAt: new Date().toISOString(),
        sourceTool: "search_products",
        products: products.map((product, index) => ({ productId: product.productId, name: product.name, position: index + 1 }))
      }
    ]
  };
}

// ==================================================
// A. NO-TOOL / RESPOND CASES (NT-001..NT-005)
// ==================================================

const ALL_CATALOG_AND_MUTATION_TOOLS: GoldenTurnCase["expected"]["forbiddenTools"] = [
  "search_products",
  "get_product_details",
  "search_company_knowledge",
  "explore_catalog",
  "search_products_by_semantics",
  "recommend_catalog_products",
  "set_shipping_destination",
  "select_products",
  "calculate_shipping",
  "select_shipping_option",
  "create_quote"
];

const MUTATION_TOOLS: GoldenTurnCase["expected"]["forbiddenTools"] = ["select_products", "set_shipping_destination", "calculate_shipping", "select_shipping_option", "create_quote"];
const CATALOG_IDENTITY_TOOLS: GoldenTurnCase["expected"]["forbiddenTools"] = ["search_products", "get_product_details", "explore_catalog", "search_products_by_semantics", "recommend_catalog_products"];

const NT_001: GoldenTurnCase = {
  mode: "turn",
  caseId: "NT-001",
  category: "NO_TOOL",
  description: "Pure greeting - no tool of any kind is ever warranted.",
  customerMessage: "hola",
  commercialContextSummary: {},
  offlineScript: [{ kind: "respond", message: "Hola, bienvenido. En qué puedo ayudarte hoy?" }],
  expected: { requiredTools: [], forbiddenTools: ALL_CATALOG_AND_MUTATION_TOOLS, firstActionType: "respond", expectedTool: null, terminalReason: "responded" },
  notes: "A greeting must never trigger any tool call."
};

const NT_002: GoldenTurnCase = {
  mode: "turn",
  caseId: "NT-002",
  category: "NO_TOOL",
  description: "General product-education question, not a purchase/identity query.",
  customerMessage: "qué diferencia hay entre una barra olímpica y una estándar?",
  commercialContextSummary: {},
  offlineScript: [{ kind: "respond", message: "Una barra olímpica pesa 20kg, usa rodamientos y encaja en discos de 50mm; una barra estándar es más liviana y usa discos de 28mm." }],
  expected: {
    requiredTools: [],
    // Flexible per task section 3A: a company-knowledge lookup is
    // architecturally acceptable here; only mutation tools and
    // product-identity/commercial tools are structurally wrong for a pure
    // educational comparison question.
    forbiddenTools: [...MUTATION_TOOLS, ...CATALOG_IDENTITY_TOOLS],
    firstActionType: null,
    expectedTool: null,
    terminalReason: "responded"
  },
  notes: "Scored per the flexible contract the task itself specifies for this exact case - never forced to a strict no-tool expectation."
};

const NT_003: GoldenTurnCase = {
  mode: "turn",
  caseId: "NT-003",
  category: "NO_TOOL",
  description: "Conversational close/thanks - no tool of any kind is ever warranted.",
  customerMessage: "gracias, eso es todo por ahora",
  commercialContextSummary: {},
  offlineScript: [{ kind: "respond", message: "De nada! Cualquier cosa, aquí estoy." }],
  expected: { requiredTools: [], forbiddenTools: ALL_CATALOG_AND_MUTATION_TOOLS, firstActionType: "respond", expectedTool: null, terminalReason: "responded" },
  notes: "A closing/thanks message must never trigger any tool call."
};

const NT_004: GoldenTurnCase = {
  mode: "turn",
  caseId: "NT-004",
  category: "NO_TOOL",
  description: "Company-info question (hours) - search_company_knowledge is architecturally legitimate here.",
  customerMessage: "cuál es el horario de atención?",
  commercialContextSummary: {},
  offlineScript: [{ kind: "use_tool", tool: "search_company_knowledge", arguments: { query: "horario de atención" } }, { kind: "respond", message: "Atendemos de lunes a viernes de 9 a 18 hrs." }],
  expected: { requiredTools: [], forbiddenTools: [...MUTATION_TOOLS, ...CATALOG_IDENTITY_TOOLS], firstActionType: null, expectedTool: null, terminalReason: "responded" },
  notes: "search_company_knowledge's own description names hours/channels/policies explicitly - this is its intended use, not a catalog/mutation question."
};

const NT_005: GoldenTurnCase = {
  mode: "turn",
  caseId: "NT-005",
  category: "NO_TOOL",
  description: "Pure small talk, unrelated to catalog or commerce.",
  customerMessage: "cómo estás?",
  commercialContextSummary: {},
  offlineScript: [{ kind: "respond", message: "Muy bien, gracias! En qué te puedo ayudar?" }],
  expected: { requiredTools: [], forbiddenTools: ALL_CATALOG_AND_MUTATION_TOOLS, firstActionType: "respond", expectedTool: null, terminalReason: "responded" },
  notes: "Small talk must never trigger any tool call."
};

// ==================================================
// B. SIMPLE TOOL SELECTION (TS-001..TS-005)
// ==================================================

const TS_001: GoldenTurnCase = {
  mode: "turn",
  caseId: "TS-001",
  category: "SIMPLE_TOOL_SELECTION",
  description: "A named, specific product -> nominal search_products.",
  customerMessage: "tienen la Leg Press Obelix?",
  commercialContextSummary: {},
  offlineScript: [{ kind: "use_tool", tool: "search_products", arguments: { query: "Leg Press Obelix" } }, { kind: "respond", message: "Tenemos estas opciones relacionadas con leg press." }],
  expected: {
    requiredTools: ["search_products"],
    forbiddenTools: ["search_products_by_semantics", "select_products", "set_shipping_destination", "calculate_shipping", "select_shipping_option", "create_quote"],
    firstActionType: "use_tool",
    expectedTool: "search_products",
    terminalReason: "responded"
  },
  notes: "A concrete named product must resolve via nominal search, never semantic discovery."
};

const TS_002: GoldenTurnCase = {
  mode: "turn",
  caseId: "TS-002",
  category: "SIMPLE_TOOL_SELECTION",
  description: "A functional/body-region need with no named product -> semantic discovery.",
  customerMessage: "quiero algo para entrenar piernas",
  commercialContextSummary: {},
  offlineScript: [
    { kind: "use_tool", tool: "search_products_by_semantics", arguments: { requirements: [{ axis: "BODY_REGION", codes: ["LOWER_BODY"], mode: "required", match: "any" }] } },
    { kind: "respond", message: "Te recomiendo revisar estas opciones para entrenar piernas." }
  ],
  expected: {
    // requiredTools intentionally excludes search_products_by_semantics: this
    // benchmark's fixture Catalog Service does not implement the semantic
    // discovery registry/query endpoints (see corpus.ts header note in the
    // final report's Known Limitations) - completion is not required, only
    // that the correct tool was SELECTED (toolSelectionPass), which is what
    // this category measures.
    requiredTools: [],
    forbiddenTools: ["search_products", "select_products", "set_shipping_destination", "calculate_shipping", "select_shipping_option", "create_quote"],
    firstActionType: "use_tool",
    expectedTool: "search_products_by_semantics",
    terminalReason: "responded"
  },
  notes: "A generic functional need (no named product) must resolve via semantic discovery, never nominal search."
};

const TS_003: GoldenTurnCase = {
  mode: "turn",
  caseId: "TS-003",
  category: "SIMPLE_TOOL_SELECTION",
  description: "Known recent single product + 'send the link' -> get_product_details.",
  customerMessage: "dame el link",
  commercialContextSummary: {},
  recentCatalogContext: singleProductContext(CLASSIC.productId, CLASSIC.name),
  offlineScript: [{ kind: "use_tool", tool: "get_product_details", arguments: { productId: CLASSIC.productId } }, { kind: "respond", message: "Aquí tienes el link del producto." }],
  expected: {
    requiredTools: ["get_product_details"],
    forbiddenTools: ["select_products", "set_shipping_destination", "calculate_shipping", "select_shipping_option", "create_quote"],
    firstActionType: "use_tool",
    expectedTool: "get_product_details",
    terminalReason: "responded"
  },
  notes: "A pronoun reference to the one recently observed product must resolve via get_product_details, grounded in recentCatalogContext."
};

const TS_004: GoldenTurnCase = {
  mode: "turn",
  caseId: "TS-004",
  category: "SIMPLE_TOOL_SELECTION",
  description: "Existing commercial selection + shipping-options request -> calculate_shipping.",
  customerMessage: "quiero opciones de envío",
  commercialContextSummary: { commercialLineItems: { items: [{ productId: CLASSIC.productId, combinationId: null, quantity: 1 }] }, shippingDestination: { communeId: 99, canonicalName: "Ñuñoa" } },
  setup: async ({ opportunityId }) => {
    await seedBenchmarkSelection(opportunityId, [{ productId: CLASSIC.productId, quantity: 1 }]);
    await seedBenchmarkShippingDestination(opportunityId, "Ñuñoa");
  },
  offlineScript: [{ kind: "use_tool", tool: "calculate_shipping", arguments: {} }, { kind: "respond", message: "El despacho a Ñuñoa cuesta $4.990, llega en 2-3 días hábiles." }],
  expected: {
    requiredTools: ["calculate_shipping"],
    forbiddenTools: ["select_products", "set_shipping_destination", "select_shipping_option", "create_quote"],
    firstActionType: "use_tool",
    expectedTool: "calculate_shipping",
    terminalReason: "responded"
  },
  notes: "A durable selection and destination already exist - the shipping request must resolve via calculate_shipping directly, never re-asking for either."
};

const TS_005: GoldenTurnCase = {
  mode: "turn",
  caseId: "TS-005",
  category: "SIMPLE_TOOL_SELECTION",
  description: "Existing valid shipping options (already quoted) + 'pick the second one' -> select_shipping_option.",
  customerMessage: "elige la segunda",
  commercialContextSummary: { commercialLineItems: { items: [{ productId: CLASSIC.productId, combinationId: null, quantity: 1 }] }, shippingDestination: { communeId: 99, canonicalName: "Ñuñoa" } },
  setup: async ({ opportunityId, conversationId }) => {
    await seedBenchmarkSelection(opportunityId, [{ productId: CLASSIC.productId, quantity: 1 }]);
    await seedBenchmarkShippingDestination(opportunityId, "Ñuñoa");
    // A real completed calculate_shipping execution, seeded ahead of this
    // turn (mirrors "shipping options already shown in a prior turn") - a
    // two-option carrier response so "the second one" (index 1) is
    // meaningful. Real production code path (executeGovernedCapability),
    // never a hand-written DB insert.
    const twoOptionCarrier: CarrierService = {
      async quoteAll(): Promise<CarrierQuoteResult> {
        return {
          ok: true,
          options: [
            { carrierName: "Chilexpress", serviceType: "STANDARD", totalCost: 4990, estimatedDelivery: "3-5 dias habiles" },
            { carrierName: "Starken", serviceType: "EXPRESS", totalCost: 6990, estimatedDelivery: "1-2 dias habiles" }
          ]
        };
      }
    };
    setCalculateShippingCarrierServiceForTests(twoOptionCarrier);
    await executeGovernedCapability("calculate_shipping", {}, { correlationId: `ts-005-seed-${opportunityId}`, opportunityId, conversationId });
  },
  offlineScript: [{ kind: "use_tool", tool: "select_shipping_option", arguments: { optionIndex: 1 } }, { kind: "respond", message: "Perfecto, elegiste el envío Starken express." }],
  expected: {
    requiredTools: ["select_shipping_option"],
    forbiddenTools: ["select_products", "set_shipping_destination", "calculate_shipping", "create_quote"],
    firstActionType: "use_tool",
    expectedTool: "select_shipping_option",
    terminalReason: "responded",
    argumentSemantics: (loop) => {
      const call = [...loop.steps].reverse().find((record) => record.step.type === "use_tool" && record.step.tool === "select_shipping_option");
      const args = call?.step.type === "use_tool" ? call.step.arguments : null;
      const pass = args?.optionIndex === 1 ? "PASS" : "FAIL";
      return { pass, notes: pass === "FAIL" ? [`expected select_shipping_option optionIndex=1 (the second option), got ${JSON.stringify(args)}`] : [] };
    }
  },
  notes: "select_shipping_option's evidence gate (resolveObservedShippingOption.ts) requires a real, DB-persisted completed calculate_shipping execution for this conversationId - seeded via the real capability, not faked."
};

// ==================================================
// C. TOOL BOUNDARY / AMBIGUITY (TB-001..TB-005)
// ==================================================

const TB_001: GoldenTurnCase = {
  mode: "turn",
  caseId: "TB-001",
  category: "TOOL_BOUNDARY",
  description: "A category name ('máquina para leg press') without a specific product name - known current debt case (nominal search over-triggers here in practice).",
  customerMessage: "quiero una máquina para hacer leg press",
  commercialContextSummary: {},
  offlineScript: [
    { kind: "use_tool", tool: "search_products_by_semantics", arguments: { requirements: [{ axis: "BODY_REGION", codes: ["LOWER_BODY"], mode: "required", match: "any" }] } },
    { kind: "respond", message: "Tenemos estas máquinas de leg press disponibles." }
  ],
  expected: { requiredTools: [], forbiddenTools: [], firstActionType: "use_tool", expectedTool: "search_products_by_semantics", terminalReason: "responded" },
  notes: "Known current debt case (task section 3C): baseline Boundary tool-selection accuracy is expected to be lower than Simple selection - this case measures that gap, it does not fix it."
};

const TB_002: GoldenTurnCase = {
  mode: "turn",
  caseId: "TB-002",
  category: "TOOL_BOUNDARY",
  description: "A named product line ('Leg Press Obelix') - the boundary counterpart to TB-001, confirming nominal search still wins when a concrete product is named.",
  customerMessage: "tienen Leg Press Obelix?",
  commercialContextSummary: {},
  offlineScript: [{ kind: "use_tool", tool: "search_products", arguments: { query: "Leg Press Obelix" } }, { kind: "respond", message: "Sí, tenemos esa línea disponible." }],
  expected: {
    requiredTools: ["search_products"],
    forbiddenTools: ["search_products_by_semantics"],
    firstActionType: "use_tool",
    expectedTool: "search_products",
    terminalReason: "responded"
  },
  notes: "The same product family as TB-001, but named specifically - must not fall back to semantic discovery."
};

const TB_003: GoldenTurnCase = {
  mode: "turn",
  caseId: "TB-003",
  category: "TOOL_BOUNDARY",
  description: "A functional need with an explicit use-context qualifier ('en la casa') - arguments should carry both dimensions when canonical vocabulary allows it.",
  customerMessage: "quiero algo para piernas en la casa",
  commercialContextSummary: {},
  offlineScript: [
    {
      kind: "use_tool",
      tool: "search_products_by_semantics",
      arguments: {
        requirements: [
          { axis: "BODY_REGION", codes: ["LOWER_BODY"], mode: "required", match: "any" },
          { axis: "USE_CONTEXT", codes: ["HOME_GYM"], mode: "required", match: "any" }
        ]
      }
    },
    { kind: "respond", message: "Te recomiendo estas opciones para entrenar piernas en casa." }
  ],
  expected: {
    requiredTools: [],
    forbiddenTools: ["search_products"],
    firstActionType: "use_tool",
    expectedTool: "search_products_by_semantics",
    terminalReason: "responded",
    argumentSemantics: (loop) => {
      const call = [...loop.steps].reverse().find((record) => record.step.type === "use_tool" && record.step.tool === "search_products_by_semantics");
      if (!call || call.step.type !== "use_tool") return { pass: "NOT_APPLICABLE", notes: [] };
      const requirements = Array.isArray(call.step.arguments.requirements) ? (call.step.arguments.requirements as Array<{ axis?: unknown }>) : [];
      const axes = new Set(requirements.map((requirement) => requirement.axis));
      const hasBodyRegion = axes.has("BODY_REGION");
      const hasUseContext = axes.has("USE_CONTEXT");
      const pass = hasBodyRegion && hasUseContext ? "PASS" : "FAIL";
      return { pass, notes: pass === "FAIL" ? [`expected both BODY_REGION and USE_CONTEXT axes, got: ${[...axes].join(", ") || "none"}`] : [] };
    }
  },
  notes: "Task section 3C: arguments should express both the functional/body-region and the use-context requirement, not just one."
};

const TB_004: GoldenTurnCase = {
  mode: "turn",
  caseId: "TB-004",
  category: "TOOL_BOUNDARY",
  description: "Known product + price question phrased as a pronoun ('esa') - boundary with TS-003's 'send the link' phrasing.",
  customerMessage: "cuánto cuesta esa?",
  commercialContextSummary: {},
  recentCatalogContext: singleProductContext(CLASSIC.productId, CLASSIC.name),
  offlineScript: [{ kind: "use_tool", tool: "get_product_details", arguments: { productId: CLASSIC.productId } }, { kind: "respond", message: "Cuesta $89.990." }],
  expected: {
    requiredTools: ["get_product_details"],
    forbiddenTools: ["select_products", "set_shipping_destination", "calculate_shipping", "select_shipping_option", "create_quote"],
    firstActionType: "use_tool",
    expectedTool: "get_product_details",
    terminalReason: "responded"
  },
  notes: "A price question about a pronoun-referenced product must resolve via get_product_details, never a stale/remembered price."
};

const TB_005: GoldenTurnCase = {
  mode: "turn",
  caseId: "TB-005",
  category: "TOOL_BOUNDARY",
  description: "Known commercial selection + 'add one more unit' - boundary between select_products (correct) and search/details (wrong, would ignore existing selection).",
  customerMessage: "agrégame otra unidad",
  commercialContextSummary: { commercialLineItems: { items: [{ productId: CLASSIC.productId, combinationId: null, quantity: 1 }] } },
  recentCatalogContext: singleProductContext(CLASSIC.productId, CLASSIC.name),
  setup: async ({ opportunityId }) => {
    await seedBenchmarkSelection(opportunityId, [{ productId: CLASSIC.productId, quantity: 1 }]);
  },
  offlineScript: [{ kind: "use_tool", tool: "select_products", arguments: { items: [{ productId: CLASSIC.productId, quantity: 2 }] } }, { kind: "respond", message: "Listo, quedaron 2 unidades." }],
  expected: {
    requiredTools: ["select_products"],
    forbiddenTools: [],
    firstActionType: "use_tool",
    expectedTool: "select_products",
    terminalReason: "responded",
    argumentSemantics: (loop) => {
      const call = [...loop.steps].reverse().find((record) => record.step.type === "use_tool" && record.step.tool === "select_products" && record.observation?.status === "completed");
      const items = call?.step.type === "use_tool" && Array.isArray(call.step.arguments.items) ? (call.step.arguments.items as Array<Record<string, unknown>>) : [];
      const matches = items.some((item) => item.productId === CLASSIC.productId && item.quantity === 2);
      return { pass: matches ? "PASS" : "FAIL", notes: matches ? [] : [`expected select_products to target productId=${CLASSIC.productId} quantity=2 (full replacement), got items=${JSON.stringify(items)}`] };
    }
  },
  notes: "select_products is a full-replacement call - 'one more unit' on an existing qty=1 selection must resolve to qty=2, never a delta/second line item."
};

// ==================================================
// D. OBSERVATION -> REPLAN (RP-001..RP-005, decision-mode)
// ==================================================

const RP_001: GoldenDecisionCase = {
  mode: "decision",
  caseId: "RP-001",
  category: "OBSERVATION_REPLAN",
  description: "search_products_by_semantics returns 3 valid results - must ground on them, never invent a 4th.",
  customerMessage: "quiero algo para entrenar piernas",
  priorSteps: [
    {
      stepIndex: 0,
      phase: "gathering",
      governance: "authorized",
      step: { type: "use_tool", tool: "search_products_by_semantics", arguments: { requirements: [{ axis: "BODY_REGION", codes: ["LOWER_BODY"], mode: "required", match: "any" }] } },
      observation: {
        tool: "search_products_by_semantics",
        status: "completed",
        data: { outcome: "matched", results: [{ productId: "31" }, { productId: "32" }, { productId: "999" }], totalMatches: 3, truncated: false }
      }
    }
  ],
  offlineNextStep: { kind: "respond", message: "Encontramos 3 opciones para entrenar piernas. Quieres el detalle de alguna?" },
  expected: { allowedNextActionTypes: ["respond", "use_tool"], allowedNextTools: ["get_product_details"], groundedProductIds: ["31", "32", "999"] },
  notes: "3 valid observed results - the model must either respond grounded on them or request details for one of them, never cite an unobserved productId."
};

const RP_002: GoldenDecisionCase = {
  mode: "decision",
  caseId: "RP-002",
  category: "OBSERVATION_REPLAN",
  description: "search_products returns no_match - must reformulate or respond honestly, never invent a product.",
  customerMessage: "tienen una barra hexagonal de 15kg?",
  priorSteps: [
    {
      stepIndex: 0,
      phase: "gathering",
      governance: "authorized",
      step: { type: "use_tool", tool: "search_products", arguments: { query: "barra hexagonal 15kg" } },
      observation: { tool: "search_products", status: "completed", data: { query: "barra hexagonal 15kg", resolutionStatus: "no_match", items: [] } }
    }
  ],
  offlineNextStep: { kind: "respond", message: "No encontré una barra hexagonal de 15kg en el catálogo. Te sirve alguna de nuestras barras olímpicas de 20kg?" },
  expected: { allowedNextActionTypes: ["respond", "use_tool"], allowedNextTools: ["search_products", "search_products_by_semantics", "search_company_knowledge"], groundedProductIds: [] },
  notes: "no_match is a valid domain result, not a technical failure - the model must reformulate/change strategy or respond honestly, never fabricate a product."
};

const RP_003: GoldenDecisionCase = {
  mode: "decision",
  caseId: "RP-003",
  category: "OBSERVATION_REPLAN",
  description: "search_products_by_semantics returns invalid_code (stale/unrecognized canonical code) - a repairable observation, never a product no_match.",
  customerMessage: "quiero algo para entrenar piernas",
  priorSteps: [
    {
      stepIndex: 0,
      phase: "gathering",
      governance: "authorized",
      step: { type: "use_tool", tool: "search_products_by_semantics", arguments: { requirements: [{ axis: "BODY_REGION", codes: ["PIERNA_INVENTADA_XYZ"], mode: "required", match: "any" }] } },
      observation: { tool: "search_products_by_semantics", status: "blocked", errorCode: "invalid_code", data: { invalidRequirements: [{ axis: "BODY_REGION", codes: ["PIERNA_INVENTADA_XYZ"] }] } }
    }
  ],
  offlineNextStep: { kind: "use_tool", tool: "search_products_by_semantics", arguments: { requirements: [{ axis: "BODY_REGION", codes: ["LOWER_BODY"], mode: "required", match: "any" }] } },
  expected: { allowedNextActionTypes: ["use_tool", "respond"], allowedNextTools: ["search_products_by_semantics"], groundedProductIds: [] },
  notes: "invalid_code is a repair/replan signal (fix the requirement and retry), structurally distinct from a genuine no_match - must not be treated as 'nothing found'."
};

const RP_004: GoldenDecisionCase = {
  mode: "decision",
  caseId: "RP-004",
  category: "OBSERVATION_REPLAN",
  description: "get_product_details fails/unavailable for an already-observed product - must respond grounded, never invent price/link/stock.",
  customerMessage: "cuánto cuesta ese producto?",
  priorSteps: [
    {
      stepIndex: 0,
      phase: "gathering",
      governance: "authorized",
      step: { type: "use_tool", tool: "get_product_details", arguments: { productId: CONTROLLED_FAILURE_PRODUCT.productId } },
      observation: { tool: "get_product_details", status: "failed", errorCode: "catalog_service_error" }
    }
  ],
  offlineNextStep: { kind: "respond", message: "En este momento no puedo confirmar el precio de ese producto, tuvimos un problema técnico. Quieres que lo intente de nuevo en unos minutos?" },
  expected: { allowedNextActionTypes: ["respond"], allowedNextTools: [], groundedProductIds: [CONTROLLED_FAILURE_PRODUCT.productId] },
  notes: "A failed get_product_details must never be papered over with an invented price, stock figure, or link."
};

const RP_005: GoldenDecisionCase = {
  mode: "decision",
  caseId: "RP-005",
  category: "OBSERVATION_REPLAN",
  description: "The catalog service itself is temporarily_blocked - no fabricated catalog answer, a safe terminal response only.",
  customerMessage: "tienen barra olímpica?",
  priorSteps: [
    {
      stepIndex: 0,
      phase: "gathering",
      governance: "authorized",
      step: { type: "use_tool", tool: "search_products", arguments: { query: "barra olimpica" } },
      observation: { tool: "search_products", status: "failed", errorCode: "catalog_service_not_configured" }
    }
  ],
  offlineNextStep: { kind: "respond", message: "En este momento no puedo consultar el catálogo. Puedes intentar en unos minutos o prefieres que te contacte un asesor?" },
  expected: { allowedNextActionTypes: ["respond"], allowedNextTools: [], groundedProductIds: [] },
  notes: "A technical catalog outage must produce an honest, safe response - never a fabricated catalog answer or a retry loop."
};

// ==================================================
// E. COMMERCIAL MUTATION (CM-001..CM-005)
// ==================================================

const CM_001: GoldenTurnCase = {
  mode: "turn",
  caseId: "CM-001",
  category: "COMMERCIAL_MUTATION",
  description: "Durable multi-item selection (10,15,20,25,30) + 'remove the 30' -> select_products targeting exactly {10,15,20,25}.",
  customerMessage: "saca la de 30",
  commercialContextSummary: { commercialLineItems: { items: ["10", "15", "20", "25", "30"].map((productId) => ({ productId, combinationId: null, quantity: 1 })) } },
  recentCatalogContext: multiProductContext(["10", "15", "20", "25", "30"].map((productId) => ({ productId, name: `Producto ${productId}` }))),
  setup: async ({ opportunityId }) => {
    await seedBenchmarkSelection(
      opportunityId,
      ["10", "15", "20", "25", "30"].map((productId) => ({ productId, quantity: 1 }))
    );
  },
  offlineScript: [
    { kind: "use_tool", tool: "select_products", arguments: { items: ["10", "15", "20", "25"].map((productId) => ({ productId, quantity: 1 })) } },
    { kind: "respond", message: "Listo, saqué la de 30. Te quedan estas 4 unidades." }
  ],
  expected: {
    requiredTools: ["select_products"],
    forbiddenTools: [],
    firstActionType: "use_tool",
    expectedTool: "select_products",
    terminalReason: "responded",
    argumentSemantics: (loop) => {
      const call = [...loop.steps].reverse().find((record) => record.step.type === "use_tool" && record.step.tool === "select_products" && record.observation?.status === "completed");
      const items = call?.step.type === "use_tool" && Array.isArray(call.step.arguments.items) ? (call.step.arguments.items as Array<Record<string, unknown>>) : [];
      const targetIds = new Set(items.map((item) => item.productId));
      const expectedIds = ["10", "15", "20", "25"];
      const matches = expectedIds.every((id) => targetIds.has(id)) && targetIds.size === expectedIds.length;
      return { pass: matches ? "PASS" : "FAIL", notes: matches ? [] : [`expected select_products to target exactly {${expectedIds.join(",")}}, got {${[...targetIds].join(",")}}`] };
    }
  },
  notes: "Must separately score toolSelectionPass/argumentSemanticsPass/mutationGroundingPass - a 'listo, saqué...' response with no completed select_products targeting exactly {10,15,20,25} is a false commercial confirmation."
};

const CM_002: GoldenTurnCase = {
  mode: "turn",
  caseId: "CM-002",
  category: "COMMERCIAL_MUTATION",
  description: "Durable single-item selection (qty 1) + 'add one more unit' -> select_products with resulting qty 2.",
  customerMessage: "agrega otra unidad",
  commercialContextSummary: { commercialLineItems: { items: [{ productId: CLASSIC.productId, combinationId: null, quantity: 1 }] } },
  recentCatalogContext: singleProductContext(CLASSIC.productId, CLASSIC.name),
  setup: async ({ opportunityId }) => {
    await seedBenchmarkSelection(opportunityId, [{ productId: CLASSIC.productId, quantity: 1 }]);
  },
  offlineScript: [{ kind: "use_tool", tool: "select_products", arguments: { items: [{ productId: CLASSIC.productId, quantity: 2 }] } }, { kind: "respond", message: "Listo, quedaron 2 unidades." }],
  expected: {
    requiredTools: ["select_products"],
    forbiddenTools: [],
    firstActionType: "use_tool",
    expectedTool: "select_products",
    terminalReason: "responded",
    argumentSemantics: (loop) => {
      const call = [...loop.steps].reverse().find((record) => record.step.type === "use_tool" && record.step.tool === "select_products" && record.observation?.status === "completed");
      const items = call?.step.type === "use_tool" && Array.isArray(call.step.arguments.items) ? (call.step.arguments.items as Array<Record<string, unknown>>) : [];
      const matches = items.length === 1 && items[0]?.productId === CLASSIC.productId && items[0]?.quantity === 2;
      return { pass: matches ? "PASS" : "FAIL", notes: matches ? [] : [`expected exactly one item productId=${CLASSIC.productId} quantity=2, got ${JSON.stringify(items)}`] };
    }
  },
  notes: "Full-replacement select_products call, resulting quantity must be exactly 2 - never a second line item."
};

const CM_003: GoldenTurnCase = {
  mode: "turn",
  caseId: "CM-003",
  category: "COMMERCIAL_MUTATION",
  description: "No valid prior selection/evidence + a bare 'add it' - must never execute an ungrounded select_products.",
  customerMessage: "agrégalo",
  commercialContextSummary: {},
  offlineScript: [{ kind: "respond", message: "Podrías confirmarme qué producto quieres agregar? No tengo uno identificado en esta conversación." }],
  expected: {
    requiredTools: [],
    forbiddenTools: [],
    firstActionType: "respond",
    expectedTool: null,
    terminalReason: "responded",
    argumentSemantics: (loop) => {
      const completedSelection = loop.steps.some((record) => record.step.type === "use_tool" && record.step.tool === "select_products" && record.observation?.status === "completed");
      return { pass: completedSelection ? "FAIL" : "PASS", notes: completedSelection ? ["an ungrounded select_products completed with no observed antecedent product"] : [] };
    }
  },
  notes: "With zero evidence and no antecedent, the only safe outcomes are a clarifying response or an attempted-but-blocked tool call - never a completed selection."
};

const CM_004: GoldenTurnCase = {
  mode: "turn",
  caseId: "CM-004",
  category: "COMMERCIAL_MUTATION",
  description: "Known destination state + 'change the address to Providencia' -> set_shipping_destination.",
  customerMessage: "cambia la dirección a Providencia",
  commercialContextSummary: { shippingDestination: { communeId: 99, canonicalName: "Ñuñoa" } },
  setup: async ({ opportunityId }) => {
    await seedBenchmarkShippingDestination(opportunityId, "Ñuñoa");
  },
  offlineScript: [{ kind: "use_tool", tool: "set_shipping_destination", arguments: { destination: "Providencia" } }, { kind: "respond", message: "Listo, actualicé tu dirección a Providencia." }],
  expected: {
    requiredTools: ["set_shipping_destination"],
    forbiddenTools: ["select_products", "calculate_shipping", "select_shipping_option", "create_quote"],
    firstActionType: "use_tool",
    expectedTool: "set_shipping_destination",
    terminalReason: "responded",
    argumentSemantics: (loop) => {
      const call = [...loop.steps].reverse().find((record) => record.step.type === "use_tool" && record.step.tool === "set_shipping_destination" && record.observation?.status === "completed");
      const data = call && typeof call.observation?.data === "object" && call.observation?.data !== null ? (call.observation.data as Record<string, unknown>) : null;
      const communeId = data?.status === "resolved" && typeof data.destination === "object" && data.destination !== null ? (data.destination as Record<string, unknown>).communeId : null;
      const pass = communeId === 101 ? "PASS" : "FAIL";
      return { pass, notes: pass === "FAIL" ? [`expected the destination to resolve to communeId=101 (Providencia), got ${JSON.stringify(data)}`] : [] };
    }
  },
  notes: "A new explicit destination must supersede the prior one, resolved to the correct commune - never left ambiguous or silently ignored."
};

const CM_005: GoldenTurnCase = {
  mode: "turn",
  caseId: "CM-005",
  category: "COMMERCIAL_MUTATION",
  description: "Selection + destination exist, but no shipping calculation/selection yet - 'make me the quote'. create_quote's real precondition chain is not fully met; either it completes or the model honestly names the missing step.",
  customerMessage: "hazme la cotización",
  commercialContextSummary: { commercialLineItems: { items: [{ productId: CLASSIC.productId, combinationId: null, quantity: 1 }] }, shippingDestination: { communeId: 99, canonicalName: "Ñuñoa" } },
  setup: async ({ opportunityId }) => {
    await seedBenchmarkSelection(opportunityId, [{ productId: CLASSIC.productId, quantity: 1 }]);
    await seedBenchmarkShippingDestination(opportunityId, "Ñuñoa");
  },
  offlineScript: [{ kind: "respond", message: "Antes de generar la cotización necesito calcular el envío. Quieres que lo haga ahora?" }],
  expected: {
    requiredTools: [],
    forbiddenTools: [],
    firstActionType: null,
    expectedTool: null,
    terminalReason: "responded",
    checkFalseQuoteClaim: true
  },
  notes: "Task section 3E's explicit escape hatch: create_quote succeeding is acceptable, and so is a precise missing-precondition response - the zero-tolerance condition is a claimed-ready quote with no completed create_quote backing it."
};

export const R3_STABLE_AGENT_V1_CORPUS: GoldenCase[] = [
  NT_001,
  NT_002,
  NT_003,
  NT_004,
  NT_005,
  TS_001,
  TS_002,
  TS_003,
  TS_004,
  TS_005,
  TB_001,
  TB_002,
  TB_003,
  TB_004,
  TB_005,
  RP_001,
  RP_002,
  RP_003,
  RP_004,
  RP_005,
  CM_001,
  CM_002,
  CM_003,
  CM_004,
  CM_005
];
