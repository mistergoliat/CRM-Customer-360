import { AGENT_LOOP_TOOL_POOL } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";
import { seedBenchmarkSelection, seedBenchmarkShippingDestination } from "@/lib/brain/commercial/agent-loop/benchmark/environment";
import type { BenchmarkCase } from "@/lib/brain/commercial/agent-loop/benchmark/types";

/**
 * LLM-R1-T05 corpus - versioned, fixed fixtures for the 12 minimum cases the
 * task specifies (C01-C12). Each case's offlineScript is a deterministic
 * simulation used only to validate the harness/scoring/metrics pipeline
 * offline (Part C) - never a claim about real model behavior. Ground truth
 * (groundTruth) is what both the offline run and any future live run are
 * scored against, structurally (never a text-similarity check on the final
 * message).
 */

const PRODUCT_31_EVIDENCE = { position: 1, productId: "31", name: "Barra Olimpica Classic 20kg" };
const PRODUCT_32_EVIDENCE = { position: 2, productId: "32", name: "Barra Olimpica Pro 20kg" };

export const BENCHMARK_CORPUS: BenchmarkCase[] = [
  {
    caseId: "C01",
    description: "busqueda simple de un producto por nombre/atributo",
    customerMessage: "busco una barra olimpica de 20kg",
    commercialContextSummary: {},
    groundTruth: {
      requiredTools: ["search_products"],
      forbiddenTools: [],
      expectedTerminalReason: "responded",
      notes: "Debe elegir search_products (nunca explore_catalog/recommend_catalog_products para un pedido semantico simple) con una query semanticamente correcta."
    },
    offlineScript: [
      { kind: "use_tool", tool: "search_products", arguments: { query: "barra olimpica 20kg" } },
      { kind: "respond", message: "Tenemos la Barra Olimpica Classic 20kg y la Pro 20kg, ambas disponibles. ¿Cual te interesa?" }
    ]
  },
  {
    caseId: "C02",
    description: "seleccion contextual: resolver 'las classic' al productId correcto entre varias barras ya observadas",
    customerMessage: "dame 2 de las classic",
    commercialContextSummary: {},
    recentCatalogContext: {
      interactions: [
        { inboundMessageId: "seed-c02", completedAt: "2026-08-12T14:59:00.000Z", sourceTool: "search_products", products: [PRODUCT_31_EVIDENCE, PRODUCT_32_EVIDENCE] }
      ]
    },
    groundTruth: {
      requiredTools: ["get_product_details", "select_products"],
      forbiddenTools: [],
      selectedProductId: "31",
      quantity: 2,
      expectedTerminalReason: "responded",
      notes:
        "get_product_details no es obligatorio por el evidence gate en si (recentCatalogContext ya basta), pero se espera como buena practica comercial (confirmar precio/stock vigente antes de seleccionar). El requisito duro es select_products con productId=31 (Classic, nunca 32/Pro) y quantity=2."
    },
    offlineScript: [
      { kind: "use_tool", tool: "get_product_details", arguments: { productId: "31" } },
      { kind: "use_tool", tool: "select_products", arguments: { items: [{ productId: "31", quantity: 2 }] } },
      { kind: "respond", message: "Listo, agregue 2 unidades de la Barra Olimpica Classic 20kg." }
    ]
  },
  {
    caseId: "C03",
    description: "shipping: calcular despacho con seleccion ya confirmada",
    customerMessage: "cuanto sale el despacho a ñuñoa?",
    commercialContextSummary: { commercialLineItems: { items: [{ productId: "31", quantity: 2 }] } },
    setup: async ({ opportunityId }) => {
      await seedBenchmarkSelection(opportunityId, [{ productId: "31", quantity: 2 }]);
    },
    groundTruth: {
      requiredTools: ["set_shipping_destination", "calculate_shipping"],
      forbiddenTools: ["select_products"],
      expectedDestinationCommuneId: 99,
      expectedTerminalReason: "responded",
      notes: "La seleccion ya esta confirmada (setup) - nunca debe volver a llamar select_products. Debe resolver Ñuñoa (communeId=99) y calcular shipping sin inventar un valor."
    },
    offlineScript: [
      { kind: "use_tool", tool: "set_shipping_destination", arguments: { destination: "ñuñoa" } },
      { kind: "use_tool", tool: "calculate_shipping", arguments: {} },
      { kind: "respond", message: "El despacho a Ñuñoa sale $4.990, llega en 2 a 3 dias habiles." }
    ]
  },
  {
    caseId: "C04",
    description: "cambio de cantidad sobre el producto contextual ya seleccionado",
    customerMessage: "mejor dejame 3",
    commercialContextSummary: { commercialLineItems: { items: [{ productId: "31", quantity: 2 }] } },
    recentCatalogContext: {
      interactions: [{ inboundMessageId: "seed-c04", completedAt: "2026-08-12T14:58:00.000Z", sourceTool: "get_product_details", products: [PRODUCT_31_EVIDENCE] }]
    },
    setup: async ({ opportunityId }) => {
      await seedBenchmarkSelection(opportunityId, [{ productId: "31", quantity: 2 }]);
    },
    groundTruth: {
      requiredTools: ["select_products"],
      forbiddenTools: [],
      selectedProductId: "31",
      quantity: 3,
      expectedTerminalReason: "responded",
      notes: "Debe modificar la cantidad del producto contextual correcto (31), nunca inventar o cambiar a otro producto."
    },
    offlineScript: [
      { kind: "use_tool", tool: "select_products", arguments: { items: [{ productId: "31", quantity: 3 }] } },
      { kind: "respond", message: "Listo, actualice tu pedido a 3 unidades de la Barra Olimpica Classic 20kg." }
    ]
  },
  {
    caseId: "C05",
    description: "cambio de comuna manteniendo la seleccion existente",
    customerMessage: "mejor a Las Condes",
    commercialContextSummary: { commercialLineItems: { items: [{ productId: "31", quantity: 2 }] }, shippingDestination: { communeId: 99, canonicalName: "Ñuñoa" } },
    setup: async ({ opportunityId }) => {
      await seedBenchmarkSelection(opportunityId, [{ productId: "31", quantity: 2 }]);
      await seedBenchmarkShippingDestination(opportunityId, "Ñuñoa");
    },
    groundTruth: {
      requiredTools: ["set_shipping_destination"],
      forbiddenTools: ["select_products"],
      expectedDestinationCommuneId: 100,
      expectedTerminalReason: "responded",
      notes: "Debe actualizar el destino a Las Condes (communeId=100) y nunca volver a llamar select_products - la seleccion no cambio."
    },
    offlineScript: [
      { kind: "use_tool", tool: "set_shipping_destination", arguments: { destination: "Las Condes" } },
      { kind: "respond", message: "Listo, actualice el destino a Las Condes." }
    ]
  },
  {
    caseId: "C06",
    description: "destino ambiguo: 'Santiago' nunca debe auto-resolverse a una comuna",
    customerMessage: "Santiago",
    commercialContextSummary: {},
    groundTruth: {
      requiredTools: ["set_shipping_destination"],
      forbiddenTools: [],
      expectedDestinationCommuneId: null,
      expectedTerminalReason: "responded",
      notes: "'Santiago' es una ciudad/conurbacion ambigua (knownAmbiguous.ts) - set_shipping_destination debe devolver needs_clarification, nunca auto-mapear a una comuna especifica (p.ej. Santiago Centro)."
    },
    offlineScript: [
      { kind: "use_tool", tool: "set_shipping_destination", arguments: { destination: "Santiago" } },
      { kind: "respond", message: "¿Podrias indicarme la comuna exacta dentro de Santiago? Por ejemplo Ñuñoa o Las Condes." }
    ]
  },
  {
    caseId: "C07",
    description: "producto no observado: el evidence gate debe bloquear una seleccion no sustentada",
    customerMessage: "quiero 1 de la barra hex de 15kg",
    commercialContextSummary: {},
    groundTruth: {
      requiredTools: [],
      forbiddenTools: [],
      expectedTerminalReason: "responded",
      expectsControlledToolFailure: true,
      notes: "La barra hex de 15kg nunca aparecio en evidencia (ni recentCatalogContext ni tool observations de este turno) - select_products debe quedar 'blocked' por el evidence gate (errorCode=source_product_not_observed), nunca ejecutar una seleccion fabricada."
    },
    offlineScript: [
      { kind: "use_tool", tool: "select_products", arguments: { items: [{ productId: "77", quantity: 1 }] } },
      { kind: "respond", message: "No encontre ese producto en lo que hemos conversado. ¿Podrias confirmarme el nombre exacto o lo buscamos primero?" }
    ]
  },
  {
    caseId: "C08",
    description: "conversacion sin tool: agradecimiento simple",
    customerMessage: "gracias",
    commercialContextSummary: {},
    groundTruth: {
      requiredTools: [],
      forbiddenTools: [...AGENT_LOOP_TOOL_POOL],
      expectedTerminalReason: "responded",
      notes: "Un mensaje puramente conversacional no debe disparar ningun tool call."
    },
    offlineScript: [{ kind: "respond", message: "¡De nada! Cualquier cosa que necesites, aqui estoy." }]
  },
  {
    caseId: "C09",
    description: "multi-intencion simple: seleccion + shipping en el mismo mensaje, dentro del budget real de gathering (maxToolExecutions=2 por defecto)",
    customerMessage: "quiero 2 de la classic y saber cuanto sale el despacho a Ñuñoa",
    commercialContextSummary: {},
    recentCatalogContext: {
      interactions: [{ inboundMessageId: "seed-c09", completedAt: "2026-08-12T14:59:00.000Z", sourceTool: "search_products", products: [PRODUCT_31_EVIDENCE, PRODUCT_32_EVIDENCE] }]
    },
    groundTruth: {
      requiredTools: ["select_products"],
      forbiddenTools: [],
      selectedProductId: "31",
      quantity: 2,
      expectedTerminalReason: "responded",
      notes:
        "Con maxToolExecutions=2 (default de plataforma) un solo turno de gathering no alcanza para completar ambas intenciones (get_product_details+select_products ya consume el budget completo) - calculate_shipping/set_shipping_destination NO se exigen en este turno; se espera que el agente complete la seleccion y ofrezca continuar con el despacho a continuacion. Ver LLM-R1-T05 Parte E."
    },
    offlineScript: [
      { kind: "use_tool", tool: "get_product_details", arguments: { productId: "31" } },
      { kind: "use_tool", tool: "select_products", arguments: { items: [{ productId: "31", quantity: 2 }] } },
      { kind: "respond", message: "Listo, agregue 2 unidades de la Barra Olimpica Classic 20kg. Dame un momento y te confirmo el valor del despacho a Ñuñoa." }
    ]
  },
  {
    caseId: "C10",
    description: "tool failure controlado: get_product_details falla de forma conocida",
    customerMessage: "dame el detalle del producto 999",
    commercialContextSummary: {},
    groundTruth: {
      requiredTools: [],
      forbiddenTools: [],
      expectedTerminalReason: "responded",
      expectsControlledToolFailure: true,
      notes: "El fixture de Catalog Service devuelve 503 para el producto 999 (fallo controlado) - el agente nunca debe inventar un exito ni datos del producto; debe responder con un fallback coherente."
    },
    offlineScript: [
      { kind: "use_tool", tool: "get_product_details", arguments: { productId: "999" } },
      { kind: "respond", message: "Por ahora no puedo obtener el detalle de ese producto. ¿Lo intentamos en unos minutos o te muestro otra opcion?" }
    ]
  },
  {
    caseId: "C11",
    description: "structured invalid response recuperable (LLM-R1-T01/T04)",
    customerMessage: "hola",
    commercialContextSummary: {},
    groundTruth: {
      requiredTools: [],
      forbiddenTools: [],
      expectedTerminalReason: "responded",
      expectsStructuredFailure: true,
      notes: "attempt 1 falla con invalid_response (invalid_model_json); T01 concede exactamente 1 recovery attempt guiado por T04; attempt 2 responde valido -> el turno debe completar normalmente."
    },
    offlineScript: [
      { kind: "invalid_response", errorCode: "invalid_model_json" },
      { kind: "respond", message: "¡Hola! ¿En que te puedo ayudar hoy?" }
    ]
  },
  {
    caseId: "C12",
    description: "structured invalid response persistente (fail closed, sin tercer intento)",
    customerMessage: "hola",
    commercialContextSummary: {},
    groundTruth: {
      requiredTools: [],
      forbiddenTools: [],
      expectedTerminalReason: "provider_unavailable",
      expectsStructuredFailure: true,
      notes: "attempt 1 y attempt 2 (el unico recovery que T01 concede) fallan ambos con invalid_response -> el turno debe fallar cerrado (provider_unavailable), nunca un tercer intento."
    },
    offlineScript: [
      { kind: "invalid_response", errorCode: "empty_response" },
      { kind: "invalid_response", errorCode: "empty_response" }
    ]
  }
];
