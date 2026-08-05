import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { AGENT_LOOP_TOOL_POOL, runAgentToolLoop } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";
import { createFakeAgentLoopProvider } from "@/lib/brain/commercial/agent-loop/providers/fakeAgentLoopProvider";
import type { AgentLoopProvider } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";
import { resetCapabilityGatewayCatalogPortForTests } from "@/lib/brain/commercial/capability-gateway/registry";
import { markAgentLoopProviderFailure } from "@/lib/brain/commercial/agent-loop/providers/providerFailureClassification";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
let server: http.Server;
let handler: Handler = (_req, res) => res.writeHead(500).end();

before(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  process.env.CATALOG_SERVICE_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.CATALOG_SERVICE_API_KEY = "test-key";
  resetCapabilityGatewayCatalogPortForTests();
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function catalogUp(itemCount: number) {
  handler = (req, res) => {
    if (req.url?.includes("/v1/products/search")) {
      const items = itemCount === 0 ? [] : [
        { productId: 501, combinationId: 1, sku: "KB-16", name: "Kettlebell 16kg", variantLabel: null, shortDescription: "Kettlebell de fundicion 16kg.", physicalQuantity: 4, available: true, matchType: "exact_name" }
      ];
      return sendJson(res, 200, { query: "kettlebell", items, freshness: { cached: false } });
    }
    if (req.url?.startsWith("/v1/products/501")) {
      return sendJson(res, 200, {
        product: { productId: 501, name: "Kettlebell 16kg", sku: "KB-16", shortDescription: "Kettlebell de fundicion 16kg.", longDescription: null, active: true },
        variants: [],
        selectedVariant: null,
        pricing: { effectiveUnitPrice: 29990, currency: "CLP", taxIncluded: true, discountApplied: false },
        stock: { available: true, physicalQuantity: 4 },
        freshness: { cached: false }
      });
    }
    return sendJson(res, 404, { error: "not_found" });
  };
}

function catalogUpWithPublicLink(publicLink: Record<string, unknown>) {
  handler = (req, res) => {
    if (req.url?.includes("/v1/products/search")) {
      return sendJson(res, 200, {
        query: "kettlebell",
        items: [
          { productId: 501, combinationId: 1, sku: "KB-16", name: "Kettlebell 16kg", variantLabel: null, shortDescription: "Kettlebell de fundicion 16kg.", physicalQuantity: 4, available: true, matchType: "exact_name" }
        ],
        freshness: { cached: false }
      });
    }
    if (req.url?.startsWith("/v1/products/501")) {
      return sendJson(res, 200, {
        product: { productId: 501, name: "Kettlebell 16kg", sku: "KB-16", shortDescription: "Kettlebell de fundicion 16kg.", longDescription: null, active: true },
        variants: [],
        selectedVariant: null,
        pricing: { effectiveUnitPrice: 29990, currency: "CLP", taxIncluded: true, discountApplied: false },
        stock: { available: true, physicalQuantity: 4 },
        publicLink,
        freshness: { cached: false }
      });
    }
    return sendJson(res, 404, { error: "not_found" });
  };
}

function catalogDown() {
  handler = (_req, res) => sendJson(res, 503, { error: "unavailable" });
}

/** ACS-R1-05.1-T02.6: serves /v1/products/explore for scripted explore_catalog scenarios, alongside the existing search/details routes. */
function catalogUpWithExplore(explorePayload: Record<string, unknown>, detailPayload?: Record<string, unknown>) {
  handler = (req, res) => {
    if (req.url === "/v1/products/explore" && req.method === "POST") {
      return sendJson(res, 200, explorePayload);
    }
    if (detailPayload && req.url?.startsWith("/v1/products/")) {
      return sendJson(res, 200, detailPayload);
    }
    return sendJson(res, 404, { error: "not_found" });
  };
}

const baseInput = {
  correlationId: "corr-1",
  conversationId: 1,
  opportunityId: null,
  currentTime: "2026-07-21T15:00:00.000Z"
};

function createRecentCatalogReferenceProvider(): AgentLoopProvider {
  return {
    name: "recent-catalog-reference-provider",
    async invoke(request) {
      const user = request.messages.find((message) => message.role === "user");
      const payload = JSON.parse(user?.content ?? "{}") as {
        customerMessage?: string;
        recentCatalogContext?: {
          interactions?: Array<{
            products?: Array<{ position?: number; productId?: string; combinationId?: string; name?: string }>;
          }>;
        };
        priorStepsThisTurn?: Array<{
          step?: { type?: string; tool?: string };
          observation?: { data?: { publicLink?: { canonicalUrl?: string | null } } };
        }>;
      };

      const detailObservation = payload.priorStepsThisTurn?.find((step) => step.step?.type === "use_tool" && step.step.tool === "get_product_details")?.observation;
      const canonicalUrl = detailObservation?.data?.publicLink?.canonicalUrl;
      if (canonicalUrl) {
        return { rawOutput: { type: "respond", message: `Te dejo el link: ${canonicalUrl}` } };
      }

      const products = (payload.recentCatalogContext?.interactions ?? []).flatMap((interaction) => interaction.products ?? []);
      const customerMessage = payload.customerMessage?.toLowerCase() ?? "";
      let selected: { productId?: string; combinationId?: string; name?: string } | null = null;

      if (customerMessage.includes("segundo")) {
        selected = products.find((product) => product.position === 2) ?? null;
      } else if (customerMessage.includes("barra")) {
        selected = products.find((product) => product.name?.toLowerCase().includes("barra")) ?? null;
      } else if (customerMessage.includes("ese") && products.length > 1) {
        return { rawOutput: { type: "respond", message: "A cual producto te refieres: la barra o los discos?" } };
      } else if (products.length === 1) {
        selected = products[0];
      }

      if (!selected?.productId) {
        return { rawOutput: { type: "respond", message: "A cual producto te refieres?" } };
      }

      return {
        rawOutput: {
          type: "use_tool",
          tool: "get_product_details",
          arguments: {
            productId: selected.productId,
            ...(selected.combinationId ? { combinationId: selected.combinationId } : {})
          }
        }
      };
    }
  };
}

function createAdaptivePresentationProvider(): AgentLoopProvider {
  return {
    name: "adaptive-presentation-provider",
    async invoke(request) {
      const system = request.messages.find((message) => message.role === "system")?.content ?? "";
      assert.match(system, /Adapt how many products you present to the customer's intent/);
      assert.match(system, /Absolute maximum: show no more than five products in one message/);

      const user = request.messages.find((message) => message.role === "user");
      const payload = JSON.parse(user?.content ?? "{}") as { customerMessage?: string };
      const customerMessage = payload.customerMessage?.toLowerCase() ?? "";

      if (customerMessage.includes("ambigu")) {
        return { rawOutput: { type: "respond", message: "Para recomendar bien, buscas barra olimpica, barra tecnica o discos?" } };
      }
      if (customerMessage.includes("mas opciones")) {
        return { rawOutput: { type: "respond", message: "1. Barra olimpica: mayor carga.\n2. Barra tecnica: mas liviana.\n3. Barra Z: agarre comodo.\n4. Mancuernas: alternativa compacta." } };
      }
      if (customerMessage.includes("muestrame uno")) {
        return { rawOutput: { type: "respond", message: "Te mostraria la Barra olimpica 20 kg como opcion principal." } };
      }
      if (customerMessage.includes("explorar")) {
        return { rawOutput: { type: "respond", message: "1. Barra olimpica: para fuerza.\n2. Discos bumper: para halterofilia.\n3. Mancuernas: para accesorios.\n4. Kettlebell: para acondicionamiento." } };
      }
      return { rawOutput: { type: "respond", message: "Principal: Barra olimpica 20 kg.\nAlternativas pertinentes: Barra tecnica 10 kg y Barra Z." } };
    }
  };
}

test("A - producto claro: search_products then a grounded respond", async () => {
  catalogUp(1);
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell 16 kg" } },
      { type: "respond", message: "Tenemos una Kettlebell de 16kg disponible por $29.990." }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "¿Tienen una kettlebell de 16 kg?", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.toolExecutionCount, 1);
  assert.equal(result.steps[0].observation?.status, "completed");
  assert.ok(result.finalMessage?.includes("Kettlebell"));
});

test("B - necesidad ambigua: agent may respond/ask without a forced tool call", async () => {
  const provider = createFakeAgentLoopProvider({
    script: [{ type: "respond", message: "¿Buscas maquinas o pesas libres, y cual es tu presupuesto?" }]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "Necesito algo para entrenar piernas en casa.",
    commercialContextSummary: {},
    provider
  });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.toolExecutionCount, 0);
});

test("C - presupuesto: search then detail then a grounded respond within the 3-decision budget", async () => {
  catalogUp(1);
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "jaula" } },
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      { type: "respond", message: "La jaula esta dentro de tu presupuesto de $500.000." }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "Busco una jaula y tengo hasta $500.000.",
    commercialContextSummary: { budgetMax: 500000 },
    provider
  });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.toolExecutionCount, 2);
  assert.equal(result.steps.length, 3);
});

test("publicLink: search then detail can finalize with the exact catalog URL within the current tool budget", async () => {
  const canonicalUrl = "https://pesaschile.cl/categories/501-kettlebell-16kg.html?ref=wa";
  catalogUpWithPublicLink({
    canonicalUrl,
    scope: "exact_product",
    available: true,
    requiresVariantSelection: false,
    variantAttributeLabels: []
  });
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell 16 kg" } },
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      { type: "respond", message: `Puedes revisar el producto aqui: ${canonicalUrl}` }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "Dame el link de la kettlebell", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.toolExecutionCount, 2);
  assert.equal(result.finalMessage, `Puedes revisar el producto aqui: ${canonicalUrl}`);
  const detailData = result.steps[1].observation?.data as { publicLink?: { canonicalUrl?: string } } | null;
  assert.equal(detailData?.publicLink?.canonicalUrl, canonicalUrl);
  assert.ok(result.warnings.includes("agent_loop_finalization_entered"));
});

test("publicLink: unavailable link evidence does not require or produce a URL in the final answer", async () => {
  catalogUpWithPublicLink({
    canonicalUrl: null,
    scope: "exact_product",
    available: false,
    unavailableReason: "missing_link_rewrite",
    requiresVariantSelection: false,
    variantAttributeLabels: []
  });
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell 16 kg" } },
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      { type: "respond", message: "No tengo un enlace oficial disponible para ese producto ahora." }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "Dame el link de la kettlebell", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.doesNotMatch(result.finalMessage ?? "", /https?:\/\//);
  const detailData = result.steps[1].observation?.data as { publicLink?: { canonicalUrl?: string | null; available?: boolean } } | null;
  assert.equal(detailData?.publicLink?.available, false);
  assert.equal(detailData?.publicLink?.canonicalUrl, null);
});

test("publicLink: parent product detail can answer with URL and variant selection guidance", async () => {
  const canonicalUrl = "https://pesaschile.cl/categories/501-kettlebell-16kg.html";
  catalogUpWithPublicLink({
    canonicalUrl,
    scope: "parent_product",
    available: true,
    requiresVariantSelection: true,
    variantAttributeLabels: ["Talla", "Color"]
  });
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell" } },
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      { type: "respond", message: `Puedes revisar el producto aqui: ${canonicalUrl}\n\nRecuerda seleccionar la talla y el color antes de agregarlo al carrito.` }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "Dame el link del producto", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.match(result.finalMessage ?? "", new RegExp(canonicalUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(result.finalMessage ?? "", /talla y el color/i);
  const detailData = result.steps[1].observation?.data as { publicLink?: { requiresVariantSelection?: boolean; variantAttributeLabels?: string[] } } | null;
  assert.equal(detailData?.publicLink?.requiresVariantSelection, true);
  assert.deepEqual(detailData?.publicLink?.variantAttributeLabels, ["Talla", "Color"]);
});

test("RecentCatalogContext: 'dame el link' with a single recent product uses get_product_details", async () => {
  const canonicalUrl = "https://pesaschile.cl/categories/501-kettlebell-16kg.html";
  catalogUpWithPublicLink({
    canonicalUrl,
    scope: "exact_product",
    available: true,
    requiresVariantSelection: false,
    variantAttributeLabels: []
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "dame el link",
    commercialContextSummary: {},
    recentCatalogContext: {
      interactions: [
        {
          inboundMessageId: "msg-search",
          completedAt: "2026-07-21T14:59:00.000Z",
          sourceTool: "search_products",
          products: [{ position: 1, productId: "501", name: "Kettlebell 16kg" }]
        }
      ]
    },
    provider: createRecentCatalogReferenceProvider()
  });

  assert.equal(result.steps[0].step.type, "use_tool");
  assert.equal(result.steps[0].step.type === "use_tool" ? result.steps[0].step.tool : null, "get_product_details");
  assert.equal(result.steps[0].step.type === "use_tool" ? result.steps[0].step.arguments.productId : null, "501");
  assert.equal(result.finalMessage, `Te dejo el link: ${canonicalUrl}`);
});

test("RecentCatalogContext: 'dame el link del segundo' uses the productId at position 2", async () => {
  const canonicalUrl = "https://pesaschile.cl/categories/501-kettlebell-16kg.html";
  catalogUpWithPublicLink({
    canonicalUrl,
    scope: "exact_product",
    available: true,
    requiresVariantSelection: false,
    variantAttributeLabels: []
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "dame el link del segundo",
    commercialContextSummary: {},
    recentCatalogContext: {
      interactions: [
        {
          inboundMessageId: "msg-search",
          completedAt: "2026-07-21T14:59:00.000Z",
          sourceTool: "search_products",
          products: [
            { position: 1, productId: "111", name: "Disco bumper" },
            { position: 2, productId: "501", combinationId: "7", name: "Kettlebell 16kg" },
            { position: 3, productId: "333", name: "Mancuerna" }
          ]
        }
      ]
    },
    provider: createRecentCatalogReferenceProvider()
  });

  assert.equal(result.steps[0].step.type === "use_tool" ? result.steps[0].step.arguments.productId : null, "501");
  assert.equal(result.steps[0].step.type === "use_tool" ? result.steps[0].step.arguments.combinationId : null, "7");
  assert.equal(result.finalMessage, `Te dejo el link: ${canonicalUrl}`);
});

test("RecentCatalogContext (ACS-R1-05.1-T02.6, sourceTool=explore_catalog): turno 1 'las tres bancas mas baratas' -> turno 2 'el enlace de la segunda' resuelve position 2 y usa get_product_details", async () => {
  const canonicalUrl = "https://pesaschile.cl/categories/501-banca-ajustable.html";
  catalogUpWithPublicLink({
    canonicalUrl,
    scope: "exact_product",
    available: true,
    requiresVariantSelection: false,
    variantAttributeLabels: []
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "dame el link del segundo",
    commercialContextSummary: {},
    recentCatalogContext: {
      interactions: [
        {
          inboundMessageId: "msg-explore-bancas",
          completedAt: "2026-07-21T14:59:00.000Z",
          sourceTool: "explore_catalog",
          products: [
            { position: 1, productId: "601", name: "Banca plana" },
            { position: 2, productId: "501", name: "Banca ajustable" },
            { position: 3, productId: "603", name: "Banca multifuncion" }
          ]
        }
      ]
    },
    provider: createRecentCatalogReferenceProvider()
  });

  assert.equal(result.steps[0].step.type === "use_tool" ? result.steps[0].step.tool : null, "get_product_details");
  assert.equal(result.steps[0].step.type === "use_tool" ? result.steps[0].step.arguments.productId : null, "501");
  assert.equal(result.finalMessage, `Te dejo el link: ${canonicalUrl}`);
});

test("RecentCatalogContext (ACS-R1-05.1-T02.6, sourceTool=explore_catalog): 'dame el link' con un unico producto reciente resuelve directo, sin ambiguedad", async () => {
  const canonicalUrl = "https://pesaschile.cl/categories/501-camara-hiperbarica.html";
  catalogUpWithPublicLink({
    canonicalUrl,
    scope: "exact_product",
    available: true,
    requiresVariantSelection: false,
    variantAttributeLabels: []
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "dame el link",
    commercialContextSummary: {},
    recentCatalogContext: {
      interactions: [
        {
          inboundMessageId: "msg-explore-top",
          completedAt: "2026-07-21T14:59:00.000Z",
          sourceTool: "explore_catalog",
          products: [{ position: 1, productId: "501", name: "Camara Hiperbarica ST801" }]
        }
      ]
    },
    provider: createRecentCatalogReferenceProvider()
  });

  assert.equal(result.steps[0].step.type === "use_tool" ? result.steps[0].step.tool : null, "get_product_details");
  assert.equal(result.steps[0].step.type === "use_tool" ? result.steps[0].step.arguments.productId : null, "501");
  assert.equal(result.finalMessage, `Te dejo el link: ${canonicalUrl}`);
});

test("RecentCatalogContext: after bars and discs, 'dame el link de la barra' selects the bar identity", async () => {
  const canonicalUrl = "https://pesaschile.cl/categories/501-barra.html";
  catalogUpWithPublicLink({
    canonicalUrl,
    scope: "exact_product",
    available: true,
    requiresVariantSelection: false,
    variantAttributeLabels: []
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "dame el link de la barra",
    commercialContextSummary: {},
    recentCatalogContext: {
      interactions: [
        {
          inboundMessageId: "msg-discs",
          completedAt: "2026-07-21T15:00:00.000Z",
          sourceTool: "search_products",
          products: [{ position: 1, productId: "301", name: "Discos bumper 10 kg" }]
        },
        {
          inboundMessageId: "msg-bars",
          completedAt: "2026-07-21T14:50:00.000Z",
          sourceTool: "search_products",
          products: [{ position: 1, productId: "501", name: "Barra olimpica 20 kg" }]
        }
      ]
    },
    provider: createRecentCatalogReferenceProvider()
  });

  assert.equal(result.steps[0].step.type === "use_tool" ? result.steps[0].step.arguments.productId : null, "501");
  assert.equal(result.finalMessage, `Te dejo el link: ${canonicalUrl}`);
});

test("RecentCatalogContext: 'ese' with multiple equivalent candidates asks for clarification and does not use a URL", async () => {
  catalogUpWithPublicLink({
    canonicalUrl: "https://pesaschile.cl/categories/501-hidden.html",
    scope: "exact_product",
    available: true,
    requiresVariantSelection: false,
    variantAttributeLabels: []
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "dame el link de ese",
    commercialContextSummary: {},
    recentCatalogContext: {
      interactions: [
        {
          inboundMessageId: "msg-search",
          completedAt: "2026-07-21T14:59:00.000Z",
          sourceTool: "search_products",
          products: [
            { position: 1, productId: "501", name: "Barra olimpica 20 kg" },
            { position: 2, productId: "502", name: "Barra tecnica 10 kg" }
          ]
        }
      ]
    },
    provider: createRecentCatalogReferenceProvider()
  });

  assert.equal(result.toolExecutionCount, 0);
  assert.match(result.finalMessage ?? "", /A cual producto te refieres/i);
  assert.doesNotMatch(result.finalMessage ?? "", /https?:\/\//);
});

test("Adaptive presentation: a specific query can respond with one main product and up to two alternatives", async () => {
  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "busco una barra olimpica especifica",
    commercialContextSummary: {},
    provider: createAdaptivePresentationProvider()
  });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.toolExecutionCount, 0);
  assert.match(result.finalMessage ?? "", /Principal:/);
  assert.match(result.finalMessage ?? "", /Alternativas pertinentes:/);
});

test("Adaptive presentation: an exploratory query can present between three and five products", async () => {
  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "quiero explorar opciones para entrenar en casa",
    commercialContextSummary: {},
    provider: createAdaptivePresentationProvider()
  });

  assert.equal(result.terminalReason, "responded");
  assert.match(result.finalMessage ?? "", /1\./);
  assert.match(result.finalMessage ?? "", /4\./);
  assert.doesNotMatch(result.finalMessage ?? "", /6\./);
});

test("Adaptive presentation: an ambiguous query can ask for clarification without unnecessary tool calls", async () => {
  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "quiero algo ambiguo para entrenar",
    commercialContextSummary: {},
    provider: createAdaptivePresentationProvider()
  });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.toolExecutionCount, 0);
  assert.match(result.finalMessage ?? "", /Para recomendar bien/);
});

test("Adaptive presentation: 'dame mas opciones' can present more than one product", async () => {
  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "dame mas opciones",
    commercialContextSummary: {},
    provider: createAdaptivePresentationProvider()
  });

  assert.equal(result.terminalReason, "responded");
  assert.match(result.finalMessage ?? "", /1\./);
  assert.match(result.finalMessage ?? "", /4\./);
});

test("Adaptive presentation: 'muestrame uno' can present only one product", async () => {
  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "muestrame uno",
    commercialContextSummary: {},
    provider: createAdaptivePresentationProvider()
  });

  assert.equal(result.terminalReason, "responded");
  assert.match(result.finalMessage ?? "", /opcion principal/);
  assert.doesNotMatch(result.finalMessage ?? "", /2\./);
  assert.doesNotMatch(result.finalMessage ?? "", /Alternativas/);
});

test("D - horarios: search_company_knowledge answers from the fixture source", async () => {
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_company_knowledge", arguments: { query: "¿Atienden el sábado?" } },
      { type: "respond", message: "Te comparto el horario de atencion." }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "¿Atienden el sábado?", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  const observation = result.steps[0].observation;
  assert.equal(observation?.status, "completed");
  const data = observation?.data as { entries: { topic: string }[] } | null;
  assert.ok(data?.entries.some((entry) => entry.topic === "horarios_atencion"));
});

test("E - sin resultado: empty search result, agent does not invent a product", async () => {
  catalogUp(0);
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "producto-inexistente-xyz" } },
      { type: "respond", message: "No encontre ese producto en el catalogo, ¿quieres que busque algo similar?" }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "Quiero el producto XYZ que no existe.", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  const data = result.steps[0].observation?.data as { items: unknown[] } | null;
  assert.equal(data?.items.length, 0);
});

test("F - tool invalida: platform blocks an unregistered tool, agent replans without a side effect", async () => {
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "create_checkout_link", arguments: {} },
      { type: "respond", message: "No puedo hacer eso, pero puedo ayudarte a buscar el producto." }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "Cierra la compra ahora.", commercialContextSummary: {}, provider });

  assert.equal(result.steps[0].governance, "blocked_unregistered");
  assert.equal(result.steps[0].observation?.status, "blocked");
  assert.equal(result.toolExecutionCount, 0);
  assert.equal(result.terminalReason, "responded");
});

test("G - loop repetido: duplicate tool+arguments is deduplicated, never executed twice", async () => {
  catalogUp(1);
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "jaula" } },
      { type: "use_tool", tool: "search_products", arguments: { query: "jaula" } },
      { type: "respond", message: "Esto es lo que encontre." }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "Busco una jaula.", commercialContextSummary: {}, provider });

  assert.equal(result.steps[1].governance, "blocked_duplicate");
  assert.equal(result.toolExecutionCount, 1);
  assert.equal(result.terminalReason, "responded");
});

test("G2 - loop repetido con argumentos en distinto orden de claves: sigue siendo deduplicado", async () => {
  catalogUp(1);
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "jaula", limit: 5 } },
      { type: "use_tool", tool: "search_products", arguments: { limit: 5, query: "jaula" } },
      { type: "respond", message: "Esto es lo que encontre." }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "Busco una jaula.", commercialContextSummary: {}, provider });

  assert.equal(result.steps[1].governance, "blocked_duplicate");
  assert.equal(result.toolExecutionCount, 1);
});

test("H - falla del catalogo: failed observation, agent responds without inventing data", async () => {
  catalogDown();
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "jaula" } },
      { type: "respond", message: "No pude confirmar el catalogo justo ahora, ¿puedo ayudarte con otra cosa mientras tanto?" }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "Busco una jaula.", commercialContextSummary: {}, provider });

  assert.equal(result.steps[0].observation?.status, "failed");
  assert.equal(result.terminalReason, "responded");
});

test("presupuesto de tools y presupuesto de cierre estan separados: agotar tools entra en finalization, nunca max_steps_exceeded directo", async () => {
  catalogUp(1);
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "a" } },
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      { type: "respond", message: "Esto es lo que encontre dentro de tu presupuesto." }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "hola", commercialContextSummary: {}, provider });

  assert.equal(result.toolExecutionCount, 2);
  assert.equal(result.steps.filter((s) => s.phase === "gathering").length, 2);
  assert.equal(result.steps.filter((s) => s.phase === "finalization").length, 1);
  assert.equal(result.terminalReason, "responded");
});

// --- Los 7 escenarios pedidos tras el smoke real (post-smoke fix) ---

test("1. search -> respond", async () => {
  catalogUp(1);
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell 16 kg" } },
      { type: "respond", message: "Tenemos una Kettlebell de 16kg disponible." }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "¿Tienen una kettlebell de 16 kg?", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.toolExecutionCount, 1);
});

test("2. search -> reformulate search -> respond", async () => {
  catalogUp(1);
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "jaula grande" } },
      { type: "use_tool", tool: "search_products", arguments: { query: "jaula compacta" } },
      { type: "respond", message: "Encontre una jaula compacta dentro de lo que buscas." }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "Busco una jaula.", commercialContextSummary: {}, provider });

  assert.equal(result.toolExecutionCount, 2);
  assert.equal(result.steps[0].governance, "authorized");
  assert.equal(result.steps[1].governance, "authorized");
  assert.equal(result.terminalReason, "responded");
});

test("3. search -> detail -> respond", async () => {
  catalogUp(1);
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "jaula" } },
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      { type: "respond", message: "La jaula esta dentro de tu presupuesto." }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "Busco una jaula y tengo hasta $500.000.", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.toolExecutionCount, 2);
  assert.equal(result.steps.length, 3);
});

test("4. tools agotadas -> respuesta obligatoria (un intento ilegal de use_tool en finalization se rechaza y se fuerza el cierre)", async () => {
  catalogUp(1);
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "a" } },
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      { type: "use_tool", tool: "search_company_knowledge", arguments: { query: "horario" } }, // ilegal en finalization
      { type: "respond", message: "Con lo que ya tengo, esto es lo que te recomiendo." }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "hola", commercialContextSummary: {}, provider });

  assert.equal(result.toolExecutionCount, 2);
  assert.equal(result.terminalReason, "responded");
  assert.ok(result.warnings.some((w) => w.startsWith("agent_step_invalid:")));
  assert.equal(result.steps[result.steps.length - 1].phase, "finalization");
});

test("5. finalizacion invalida -> retry (salida malformada en el primer intento, valida en el segundo)", async () => {
  catalogUp(1);
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "a" } },
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      "not an object", // primer intento de finalization: invalido
      { type: "respond", message: "Retomo con lo que ya se de tu consulta." }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "hola", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.steps[result.steps.length - 1].phase, "finalization");
});

test("6. finalizacion falla dos veces -> fallback (invalid_output, nunca max_steps_exceeded)", async () => {
  catalogUp(1);
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "a" } },
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      "not an object",
      "still not an object"
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "hola", commercialContextSummary: {}, provider });

  assert.equal(result.toolExecutionCount, 2);
  assert.equal(result.terminalReason, "invalid_output");
  assert.ok(result.warnings.includes("agent_loop_finalization_failed"));
});

test("7. presupuesto se proyecta a search_products cuando el modelo no lo incluye", async () => {
  catalogUp(1);
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "jaula" } },
      { type: "respond", message: "Esto es lo que encontre dentro de tu presupuesto." }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "Busco una jaula y tengo hasta $400.000.",
    commercialContextSummary: { needProfile: { useCase: "full_body", budgetMax: 400000, requiredFeatures: [] } },
    provider
  });

  const step = result.steps[0].step;
  assert.equal(step.type, "use_tool");
  assert.equal(step.type === "use_tool" ? step.arguments.budgetMax : undefined, 400000);
});

test("7b. presupuesto no sobreescribe un budgetMax que el modelo ya incluyo", async () => {
  catalogUp(1);
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "jaula", budgetMax: 250000 } },
      { type: "respond", message: "Esto es lo que encontre." }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "Busco una jaula.",
    commercialContextSummary: { needProfile: { useCase: "full_body", budgetMax: 400000, requiredFeatures: [] } },
    provider
  });

  const step = result.steps[0].step;
  assert.equal(step.type === "use_tool" ? step.arguments.budgetMax : undefined, 250000);
});

test("invalid model output gets exactly one format retry, then fails safe", async () => {
  const provider = createFakeAgentLoopProvider({ script: ["not an object", "still not an object"] });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "hola", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "invalid_output");
  assert.equal(result.steps.length, 0);
  assert.ok(result.warnings.some((warning) => warning.startsWith("agent_step_invalid:")));
});

test("one invalid output followed by a valid one recovers within the same decision slot", async () => {
  catalogUp(1);
  const provider = createFakeAgentLoopProvider({
    script: ["not an object", { type: "respond", message: "Recuperado tras un reintento de formato." }]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "hola", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.steps.length, 1);
});

test("no provider configured fails closed without ever attempting a tool call", async () => {
  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "hola", commercialContextSummary: {}, provider: null });

  assert.equal(result.ran, false);
  assert.equal(result.terminalReason, "provider_unavailable");
  assert.equal(result.toolExecutionCount, 0);
  assert.equal(result.providerFailure ?? null, null, "no exception was ever caught here, so no cause must be fabricated");
});

// --- LLM provider error observability ---

function createThrowingAgentLoopProvider(): AgentLoopProvider {
  return {
    name: "throwing-agent-loop-provider",
    async invoke() {
      throw markAgentLoopProviderFailure(new Error("Agent loop HTTP provider failed with status 401."), {
        model: "deepseek-v4-flash",
        attemptCount: 1,
        maxAttempts: 1,
        httpStatus: 401,
        errorCode: "http_401",
        errorClass: "HttpStatusError",
        normalizedReason: "authentication_error",
        retryable: false
      });
    }
  };
}

test("[PF11] a provider error in the gathering phase is preserved on the terminal result - never just collapsed into provider_unavailable", async () => {
  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "hola",
    commercialContextSummary: {},
    provider: createThrowingAgentLoopProvider()
  });

  assert.equal(result.terminalReason, "provider_unavailable");
  assert.equal(result.steps.length, 0, "matches the reported production state: decisionCount 0");
  assert.equal(result.toolExecutionCount, 0, "matches the reported production state: toolExecutionCount 0");
  assert.ok(result.providerFailure, "the sanitized cause must survive on the loop's own terminal result");
  assert.equal(result.providerFailure?.provider, "throwing-agent-loop-provider");
  assert.equal(result.providerFailure?.model, "deepseek-v4-flash");
  assert.equal(result.providerFailure?.normalizedReason, "authentication_error");
  assert.equal(result.providerFailure?.httpStatus, 401);
  assert.equal(result.providerFailure?.retryable, false);
  assert.equal(typeof result.providerFailure?.elapsedMs, "number");
  assert.ok(result.warnings.includes("agent_loop_provider_error:authentication_error"));
  assert.ok(
    !result.warnings.some((warning) => warning.includes("401.")),
    "the raw error message must never leak into warnings - only the sanitized reason"
  );
});

test("[PF12] a provider error during finalization is also preserved (finalization is only reached after the gathering tool budget is spent)", async () => {
  catalogUp(1);
  let callCount = 0;
  const provider: AgentLoopProvider = {
    name: "flaky-finalization-provider",
    async invoke() {
      callCount += 1;
      if (callCount <= 2) {
        return { rawOutput: { type: "use_tool", tool: callCount === 1 ? "search_products" : "get_product_details", arguments: callCount === 1 ? { query: "a" } : { productId: "501" } } };
      }
      throw markAgentLoopProviderFailure(new Error("Agent loop HTTP provider failed with status 503."), {
        model: "deepseek-v4-flash",
        attemptCount: 1,
        maxAttempts: 1,
        httpStatus: 503,
        errorCode: "http_503",
        errorClass: "HttpStatusError",
        normalizedReason: "provider_server_error",
        retryable: true
      });
    }
  };

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "hola", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "provider_unavailable");
  assert.equal(result.toolExecutionCount, 2);
  assert.equal(result.providerFailure?.normalizedReason, "provider_server_error");
  assert.equal(result.providerFailure?.httpStatus, 503);
  assert.equal(result.providerFailure?.retryable, true);
});

// --- ACS-R1-05.1-T02.6: explore_catalog ---

function exploreResponsePayload(overrides: Record<string, unknown> = {}) {
  return {
    scope: { availability: "available" },
    sort: { by: "price", direction: "desc" },
    totalMatched: 833,
    exhaustiveForScope: true,
    products: [{ productId: "1532", name: "Camara Hiperbarica ST801", price: 8599990, currency: "CLP", stockQuantity: 4, stockScope: "product", availability: "available" }],
    ...overrides
  };
}

test("I0 - el pool conserva las 4 tools previas mas explore_catalog (expansion intencional, nada eliminado)", () => {
  assert.deepEqual(
    [...AGENT_LOOP_TOOL_POOL].sort(),
    ["explore_catalog", "get_product_details", "recommend_catalog_products", "search_company_knowledge", "search_products"].sort()
  );
});

test("I - 'producto mas caro de la pagina': explore_catalog resuelve el extremo global, nunca search_products", async () => {
  catalogUpWithExplore(exploreResponsePayload());
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "explore_catalog", arguments: { availability: "available", sort: { by: "price", direction: "desc" }, limit: 1 } },
      { type: "respond", message: "El producto mas caro disponible es la Camara Hiperbarica ST801 a $8.599.990." }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "¿Cual es el producto mas caro que tienen disponible?", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.toolExecutionCount, 1);
  assert.equal(result.steps[0].step.type === "use_tool" ? result.steps[0].step.tool : null, "explore_catalog");
  assert.equal(result.steps[0].observation?.status, "completed");
  const data = result.steps[0].observation?.data as { exhaustiveForScope?: boolean } | null;
  assert.equal(data?.exhaustiveForScope, true);
});

test("I2 - 'la maquina mas cara': el modelo envia productType=machine y el argumento llega intacto al Catalog Service", async () => {
  let capturedBody: Record<string, unknown> = {};
  handler = (req, res) => {
    if (req.url === "/v1/products/explore") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        capturedBody = JSON.parse(raw);
        sendJson(res, 200, exploreResponsePayload({ scope: { productType: "machine", availability: "available" } }));
      });
      return;
    }
    return sendJson(res, 404, { error: "not_found" });
  };

  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "explore_catalog", arguments: { productType: "machine", sort: { by: "price", direction: "desc" }, limit: 1 } },
      { type: "respond", message: "La maquina mas cara es la Camara Hiperbarica ST801." }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "¿Cual es la maquina mas cara que tienen?", commercialContextSummary: {}, provider });

  assert.equal(result.toolExecutionCount, 1);
  assert.equal(capturedBody.productType, "machine");
});

test("I3 - 'tres bancas mas baratas disponibles': filtros de query/availability/sort/limit llegan correctos", async () => {
  let capturedBody: Record<string, unknown> = {};
  handler = (req, res) => {
    if (req.url === "/v1/products/explore") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        capturedBody = JSON.parse(raw);
        sendJson(res, 200, exploreResponsePayload({ sort: { by: "price", direction: "asc" } }));
      });
      return;
    }
    return sendJson(res, 404, { error: "not_found" });
  };

  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "explore_catalog", arguments: { query: "banca", availability: "available", sort: { by: "price", direction: "asc" }, limit: 3 } },
      { type: "respond", message: "Estas son las tres bancas mas baratas disponibles que encontre." }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "Muestrame las tres bancas mas baratas que tengan disponibles.", commercialContextSummary: {}, provider });

  assert.equal(result.toolExecutionCount, 1);
  assert.equal(capturedBody.query, "banca");
  assert.equal(capturedBody.availability, "available");
  assert.deepEqual(capturedBody.sort, { by: "price", direction: "asc" });
  assert.equal(capturedBody.limit, 3);
});

test("I4 - 'enlace de esa': explore_catalog encadena con get_product_details en el mismo turno", async () => {
  const canonicalUrl = "https://pesaschile.cl/categories/1532-camara-hiperbarica.html";
  catalogUpWithExplore(exploreResponsePayload(), {
    product: { productId: 1532, name: "Camara Hiperbarica ST801", sku: "SKU-1532", shortDescription: null, longDescription: null, active: true },
    variants: [],
    selectedVariant: null,
    pricing: { effectiveUnitPrice: 8599990, currency: "CLP", taxIncluded: true, discountApplied: false },
    stock: { available: true, physicalQuantity: 4 },
    publicLink: { canonicalUrl, scope: "exact_product", available: true, requiresVariantSelection: false, variantAttributeLabels: [] },
    freshness: { cached: false }
  });

  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "explore_catalog", arguments: { availability: "available", sort: { by: "price", direction: "desc" }, limit: 1 } },
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "1532" } },
      { type: "respond", message: `Puedes revisar el producto aqui: ${canonicalUrl}` }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "Dame el enlace de esa.", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.toolExecutionCount, 2);
  assert.equal(result.steps[0].step.type === "use_tool" ? result.steps[0].step.tool : null, "explore_catalog");
  assert.equal(result.steps[1].step.type === "use_tool" ? result.steps[1].step.tool : null, "get_product_details");
  assert.equal(result.finalMessage, `Puedes revisar el producto aqui: ${canonicalUrl}`);
});

test("I5 - deduplicacion: explore_catalog con el mismo tool+argumentos nunca se ejecuta dos veces", async () => {
  catalogUpWithExplore(exploreResponsePayload());
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "explore_catalog", arguments: { availability: "available", sort: { by: "price", direction: "desc" }, limit: 1 } },
      { type: "use_tool", tool: "explore_catalog", arguments: { sort: { by: "price", direction: "desc" }, availability: "available", limit: 1 } },
      { type: "respond", message: "Esto es lo que encontre." }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "¿Cual es el mas caro?", commercialContextSummary: {}, provider });

  assert.equal(result.steps[1].governance, "blocked_duplicate");
  assert.equal(result.toolExecutionCount, 1);
});

test("I6 - falla del catalogo: explore_catalog failed observation, el agente responde sin inventar datos", async () => {
  catalogDown();
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "explore_catalog", arguments: { availability: "available", sort: { by: "price", direction: "desc" }, limit: 1 } },
      { type: "respond", message: "No pude confirmar el catalogo justo ahora, ¿puedo ayudarte con otra cosa mientras tanto?" }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "¿Cual es el mas caro?", commercialContextSummary: {}, provider });

  assert.equal(result.steps[0].observation?.status, "failed");
  assert.equal(result.terminalReason, "responded");
});

// --- ACS-R1-05.1-T02.6.1: tool schema + invalid_arguments recovery ---

test("ACS-R1-05.1-T02.6.1: real incident regression - '¿Cual es el producto mas caro de la pagina?' with the legacy {orderBy, orderDirection} shape normalizes transparently and responds, never handoff", async () => {
  catalogUpWithExplore(exploreResponsePayload());
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "explore_catalog", arguments: { orderBy: "price", orderDirection: "desc", limit: 1 } },
      { type: "respond", message: "El producto mas caro disponible es la Camara Hiperbarica ST801 a $8.599.990." }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "¿Cual es el producto mas caro de la pagina?", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.notEqual(result.terminalReason, "handoff");
  assert.equal(result.toolExecutionCount, 1);
  assert.equal(result.steps[0].observation?.status, "completed");
  const data = result.steps[0].observation?.data as { exhaustiveForScope?: boolean } | null;
  assert.equal(data?.exhaustiveForScope, true);

  // ACS-R1-05.1-T02.6.1: the legacy-alias warning must not vanish silently -
  // visible on the tool observation (model-facing, sanitized) and folded
  // into this turn's own warnings list (internal observability).
  assert.deepEqual(result.steps[0].observation?.warnings, ["explore_catalog_legacy_sort_alias_used"]);
  assert.ok(result.warnings.includes("agent_loop_tool_warning:explore_catalog:explore_catalog_legacy_sort_alias_used"));
});

test("invalid_arguments (missing limit) does not consume tool-execution budget - the model corrects and responds within budget, never handoff", async () => {
  catalogUpWithExplore(exploreResponsePayload());
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "explore_catalog", arguments: { sort: { by: "price", direction: "desc" } } },
      { type: "use_tool", tool: "explore_catalog", arguments: { sort: { by: "price", direction: "desc" }, limit: 1 } },
      { type: "respond", message: "El producto mas caro disponible es la Camara Hiperbarica ST801." }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "¿Cual es el mas caro?", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.notEqual(result.terminalReason, "handoff");
  assert.equal(result.steps[0].observation?.status, "blocked");
  assert.equal(result.steps[0].observation?.errorCode, "sort_and_limit_required");
  assert.equal(result.steps[1].observation?.status, "completed");
  assert.equal(result.toolExecutionCount, 1, "only the corrected call counts toward the tool-execution budget");
  assert.ok(result.warnings.some((warning) => warning.startsWith("agent_loop_tool_invalid_arguments:explore_catalog:")));
});

test("repeated invalid_arguments across the full decision budget never exceeds maxToolExecutions and never loops infinitely - falls safely into finalization", async () => {
  catalogUpWithExplore(exploreResponsePayload());
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "explore_catalog", arguments: { sort: { by: "price", direction: "desc" } } },
      { type: "use_tool", tool: "explore_catalog", arguments: { sort: { by: "stock", direction: "desc" } } },
      { type: "use_tool", tool: "explore_catalog", arguments: { sort: { by: "name", direction: "asc" } } },
      { type: "respond", message: "No pude confirmar esa informacion en este momento." }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "hola", commercialContextSummary: {}, provider });

  assert.equal(result.toolExecutionCount, 0, "none of the three malformed calls should ever count toward the execution budget");
  assert.ok(result.steps.every((step) => step.observation?.status === "blocked" || step.phase === "finalization"));
  assert.equal(result.terminalReason, "responded");
});

// ACS-R1-05.1-T02.7 - pendingCatalogAction continuity (catalog link
// follow-up). The scripted steps below stand in for "what a correctly
// behaving model does" - these tests verify the runtime threads the input
// in, captures what the terminal respond step declares, and logs the
// active/renewed/consumed transition, not model reasoning itself (already
// covered by real-world evidence in the release notes and out of reach of a
// scripted fake provider).

test("pendingCatalogAction is threaded into the prompt payload seen by the provider", async () => {
  let capturedPendingCatalogAction: unknown;
  const provider: AgentLoopProvider = {
    name: "capture-pending-catalog-action-provider",
    async invoke(request) {
      const user = request.messages.find((message) => message.role === "user");
      capturedPendingCatalogAction = (JSON.parse(user?.content ?? "{}") as { pendingCatalogAction?: unknown }).pendingCatalogAction;
      return { rawOutput: { type: "respond", message: "ok" } };
    }
  };

  await runAgentToolLoop({
    ...baseInput,
    customerMessage: "si",
    commercialContextSummary: {},
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"] },
    provider
  });

  assert.deepEqual(capturedPendingCatalogAction, { actionType: "send_product_link", candidateProductIds: ["501"] });
});

test("pendingCatalogAction: a fresh multi-product link offer is captured as finalPendingCatalogAction", async () => {
  const provider = createFakeAgentLoopProvider({
    script: [
      {
        type: "respond",
        message: "¿Quieres que te envíe el link de alguno de estos productos?",
        pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["80", "2164", "8"] }
      }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "que opciones tienen en magnesio",
    commercialContextSummary: {},
    recentCatalogContext: {
      interactions: [
        {
          inboundMessageId: "msg-products",
          completedAt: "2026-07-21T14:59:00.000Z",
          sourceTool: "search_products",
          products: [
            { position: 1, productId: "80", name: "Magnesio A" },
            { position: 2, productId: "2164", name: "Magnesio B" },
            { position: 3, productId: "8", name: "Magnesio C" }
          ]
        }
      ]
    },
    provider
  });

  assert.equal(result.terminalReason, "responded");
  assert.deepEqual(result.finalPendingCatalogAction, { actionType: "send_product_link", candidateProductIds: ["80", "2164", "8"] });
  assert.ok(result.warnings.some((warning) => warning.startsWith("pending_catalog_action_sanitized:send_product_link:")));
  assert.ok(!result.warnings.some((warning) => warning.startsWith("pending_catalog_action_renewed:")));
});

test("pendingCatalogAction: single candidate + plain confirmation resolves directly, no intermediate re-presentation turn", async () => {
  const canonicalUrl = "https://pesaschile.cl/categories/501-magnesio.html";
  catalogUpWithPublicLink({ canonicalUrl, scope: "exact_product", available: true, requiresVariantSelection: false, variantAttributeLabels: [] });
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      { type: "respond", message: `Aqui tienes el enlace: ${canonicalUrl}` }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "si",
    commercialContextSummary: {},
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"] },
    provider
  });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.steps.length, 2, "no intermediate re-presentation turn before delivering the link");
  assert.equal(result.finalMessage, `Aqui tienes el enlace: ${canonicalUrl}`);
  assert.equal(result.finalPendingCatalogAction, null);
  assert.ok(result.warnings.includes("pending_catalog_action_active:send_product_link:1"));
  assert.ok(result.warnings.includes("pending_catalog_action_consumed:send_product_link"));
});

test("pendingCatalogAction: ambiguous selection keeps the action pending (renewed) instead of guessing", async () => {
  const provider = createFakeAgentLoopProvider({
    script: [
      {
        type: "respond",
        message: "Te refieres al Set 30kg o al Set 20kg de mancuernas?",
        pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["80", "81"] }
      }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "el set de mancuernas",
    commercialContextSummary: {},
    recentCatalogContext: {
      interactions: [
        {
          inboundMessageId: "msg-sets",
          completedAt: "2026-07-21T14:59:00.000Z",
          sourceTool: "search_products",
          products: [
            { position: 1, productId: "80", name: "Set 30kg de mancuernas" },
            { position: 2, productId: "81", name: "Set 20kg de mancuernas" }
          ]
        }
      ]
    },
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["80", "81"] },
    provider
  });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.toolExecutionCount, 0);
  assert.deepEqual(result.finalPendingCatalogAction, { actionType: "send_product_link", candidateProductIds: ["80", "81"] });
  assert.ok(result.warnings.includes("pending_catalog_action_active:send_product_link:2"));
  assert.ok(result.warnings.includes("pending_catalog_action_renewed:send_product_link:2"));
});

test("pendingCatalogAction: multiple candidates plus plain confirmation asks for precision and renews sanitized candidates", async () => {
  const provider = createFakeAgentLoopProvider({
    script: [
      {
        type: "respond",
        message: "¿Te refieres al Magnesio en polvo o al Magnesio liquido?",
        pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["80", "2164", "999"] }
      }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "si",
    commercialContextSummary: {},
    recentCatalogContext: {
      interactions: [
        {
          inboundMessageId: "msg-magnesium",
          completedAt: "2026-07-21T14:59:00.000Z",
          sourceTool: "search_products",
          products: [
            { position: 1, productId: "80", name: "Magnesio en polvo" },
            { position: 2, productId: "2164", name: "Magnesio liquido" }
          ]
        }
      ]
    },
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["80", "2164"] },
    provider
  });

  assert.equal(result.toolExecutionCount, 0);
  assert.match(result.finalMessage ?? "", /Magnesio en polvo|Magnesio liquido/);
  assert.deepEqual(result.finalPendingCatalogAction, { actionType: "send_product_link", candidateProductIds: ["80", "2164"] });
  assert.ok(result.warnings.some((warning) => warning.includes("candidateCountBefore=3:candidateCountAfter=2")));
  assert.ok(result.warnings.includes("pending_catalog_action_renewed:send_product_link:2"));
});

test("pendingCatalogAction: final candidates are sanitized against current tool observations and the visible response stays intact", async () => {
  catalogUp(1);
  const visibleMessage = "¿Quieres que te envie el link de esta kettlebell?";
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell" } },
      {
        type: "respond",
        message: visibleMessage,
        pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501", "501", "999"] }
      }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "busco kettlebell",
    commercialContextSummary: {},
    provider
  });

  assert.equal(result.finalMessage, visibleMessage);
  assert.deepEqual(result.finalPendingCatalogAction, { actionType: "send_product_link", candidateProductIds: ["501"] });
  assert.ok(result.warnings.some((warning) => warning.includes("candidateCountBefore=3:candidateCountAfter=1")));
});

test("pendingCatalogAction: final action is dropped when all candidates are outside evidence, without changing the visible response", async () => {
  const visibleMessage = "¿Quieres que te envie el link de este producto?";
  const provider = createFakeAgentLoopProvider({
    script: [
      {
        type: "respond",
        message: visibleMessage,
        pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["999"] }
      }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "busco magnesio",
    commercialContextSummary: {},
    recentCatalogContext: {
      interactions: [
        {
          inboundMessageId: "msg-products",
          completedAt: "2026-07-21T14:59:00.000Z",
          sourceTool: "search_products",
          products: [{ position: 1, productId: "80", name: "Magnesio" }]
        }
      ]
    },
    provider
  });

  assert.equal(result.finalMessage, visibleMessage);
  assert.equal(result.finalPendingCatalogAction, null);
  assert.ok(result.warnings.some((warning) => warning.startsWith("pending_catalog_action_dropped_no_candidates:send_product_link:")));
});

test("pendingCatalogAction: a message unrelated to the offer drops the pending action instead of resolving it", async () => {
  const provider = createFakeAgentLoopProvider({
    script: [{ type: "respond", message: "Claro, el horario de despacho es de lunes a viernes." }]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "a que hora despachan?",
    commercialContextSummary: {},
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["80"] },
    provider
  });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.toolExecutionCount, 0);
  assert.equal(result.finalPendingCatalogAction, null);
  assert.ok(result.warnings.includes("pending_catalog_action_consumed:send_product_link"));
});

test("pendingCatalogAction: link unavailable still consumes the action and never invents a URL", async () => {
  catalogUpWithPublicLink({
    canonicalUrl: null,
    scope: "exact_product",
    available: false,
    unavailableReason: "missing_link_rewrite",
    requiresVariantSelection: false,
    variantAttributeLabels: []
  });
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      { type: "respond", message: "No tengo un enlace disponible para ese producto ahora." }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "dale",
    commercialContextSummary: {},
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"] },
    provider
  });

  assert.equal(result.terminalReason, "responded");
  assert.doesNotMatch(result.finalMessage ?? "", /https?:\/\//);
  assert.equal(result.finalPendingCatalogAction, null);
  assert.ok(result.warnings.includes("pending_catalog_action_consumed:send_product_link"));
});

test("pendingCatalogAction: get_product_details failure consumes the action, never invents a URL and never re-offers automatically", async () => {
  catalogDown();
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      { type: "respond", message: "No puedo obtener el enlace en este momento. Probemos de nuevo mas tarde." }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "si",
    commercialContextSummary: {},
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"] },
    provider
  });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.toolExecutionCount, 1);
  assert.equal(result.steps.filter((record) => record.step.type === "use_tool" && record.step.tool === "get_product_details").length, 1);
  assert.doesNotMatch(result.finalMessage ?? "", /https?:\/\//);
  assert.doesNotMatch(result.finalMessage ?? "", /quieres.*link|envi[eé].*link/i);
  assert.equal(result.finalPendingCatalogAction, null);
  assert.ok(result.warnings.some((warning) => warning.startsWith("pendingCatalogAction_tool_failed_consumed:send_product_link:")));
  assert.ok(result.warnings.includes("pending_catalog_action_consumed:send_product_link"));
});

test("pendingCatalogAction: get_product_details failure suppresses a non-cooperative model renewal", async () => {
  catalogDown();
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      {
        type: "respond",
        message: "No puedo obtener el enlace en este momento.",
        pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"] }
      }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "si",
    commercialContextSummary: {},
    recentCatalogContext: {
      interactions: [
        {
          inboundMessageId: "catalog-msg",
          completedAt: "2026-07-21T14:59:00.000Z",
          sourceTool: "search_products",
          products: [{ position: 1, productId: "501", name: "Kettlebell" }]
        }
      ]
    },
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"] },
    provider
  });

  assert.equal(result.toolExecutionCount, 1);
  assert.equal(result.finalPendingCatalogAction, null);
  assert.ok(result.warnings.some((warning) => warning.startsWith("pendingCatalogAction_tool_failed_consumed:send_product_link:")));
  assert.ok(result.warnings.some((warning) => warning.startsWith("pendingCatalogAction_model_renewal_suppressed:send_product_link:")));
  assert.ok(result.warnings.includes("pending_catalog_action_consumed:send_product_link"));
});

test("pendingCatalogAction: blocked get_product_details suppresses a non-cooperative model renewal", async () => {
  catalogUpWithPublicLink({
    canonicalUrl: "https://pesaschile.cl/productos/501-kettlebell",
    scope: "exact_product",
    available: true,
    requiresVariantSelection: false,
    variantAttributeLabels: []
  });
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      {
        type: "respond",
        message: "No puedo volver a obtener el enlace en este momento.",
        pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"] }
      }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "si",
    commercialContextSummary: {},
    recentCatalogContext: {
      interactions: [
        {
          inboundMessageId: "catalog-msg",
          completedAt: "2026-07-21T14:59:00.000Z",
          sourceTool: "search_products",
          products: [{ position: 1, productId: "501", name: "Kettlebell" }]
        }
      ]
    },
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"] },
    provider,
    maxDecisions: 4,
    maxToolExecutions: 2
  });

  assert.equal(result.toolExecutionCount, 1);
  assert.equal(result.finalPendingCatalogAction, null);
  assert.ok(result.warnings.some((warning) => warning.startsWith("pendingCatalogAction_tool_blocked_consumed:send_product_link:")));
  assert.ok(result.warnings.some((warning) => warning.startsWith("pendingCatalogAction_model_renewal_suppressed:send_product_link:")));
  assert.ok(result.warnings.includes("pending_catalog_action_consumed:send_product_link"));
});

test("pendingCatalogAction: unrelated get_product_details failure does not consume the pending action", async () => {
  catalogDown();
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "777" } },
      {
        type: "respond",
        message: "Sigo pendiente del link del producto anterior.",
        pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"] }
      }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "si",
    commercialContextSummary: {},
    recentCatalogContext: {
      interactions: [
        {
          inboundMessageId: "catalog-msg",
          completedAt: "2026-07-21T14:59:00.000Z",
          sourceTool: "search_products",
          products: [{ position: 1, productId: "501", name: "Kettlebell" }]
        }
      ]
    },
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"] },
    provider
  });

  assert.equal(result.toolExecutionCount, 1);
  assert.deepEqual(result.finalPendingCatalogAction, { actionType: "send_product_link", candidateProductIds: ["501"] });
  assert.ok(!result.warnings.some((warning) => warning.startsWith("pendingCatalogAction_tool_failed_consumed:")));
  assert.ok(!result.warnings.some((warning) => warning.startsWith("pendingCatalogAction_model_renewal_suppressed:")));
});

test("pendingCatalogAction: numeric tool productId matches string pending candidate on terminal failure", async () => {
  catalogDown();
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "get_product_details", arguments: { productId: 123 } },
      {
        type: "respond",
        message: "No puedo obtener el enlace en este momento.",
        pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["123"] }
      }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "si",
    commercialContextSummary: {},
    recentCatalogContext: {
      interactions: [
        {
          inboundMessageId: "catalog-msg",
          completedAt: "2026-07-21T14:59:00.000Z",
          sourceTool: "search_products",
          products: [{ position: 1, productId: "123", name: "Banco" }]
        }
      ]
    },
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["123"] },
    provider
  });

  assert.equal(result.toolExecutionCount, 1);
  assert.equal(result.finalPendingCatalogAction, null);
  assert.ok(result.warnings.some((warning) => warning.startsWith("pendingCatalogAction_tool_failed_consumed:send_product_link:")));
  assert.ok(result.warnings.some((warning) => warning.startsWith("pendingCatalogAction_model_renewal_suppressed:send_product_link:")));
});

test("pendingCatalogAction: a different failing tool does not consume the pending action", async () => {
  catalogDown();
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "explore_catalog", arguments: { sort: { by: "price", direction: "desc" }, limit: 1 } },
      {
        type: "respond",
        message: "Sigo pendiente del link del producto anterior.",
        pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"] }
      }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "si",
    commercialContextSummary: {},
    recentCatalogContext: {
      interactions: [
        {
          inboundMessageId: "catalog-msg",
          completedAt: "2026-07-21T14:59:00.000Z",
          sourceTool: "search_products",
          products: [{ position: 1, productId: "501", name: "Kettlebell" }]
        }
      ]
    },
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"] },
    provider
  });

  assert.equal(result.toolExecutionCount, 1);
  assert.deepEqual(result.finalPendingCatalogAction, { actionType: "send_product_link", candidateProductIds: ["501"] });
  assert.ok(!result.warnings.some((warning) => warning.startsWith("pendingCatalogAction_tool_failed_consumed:")));
  assert.ok(!result.warnings.some((warning) => warning.startsWith("pendingCatalogAction_tool_blocked_consumed:")));
  assert.ok(!result.warnings.some((warning) => warning.startsWith("pendingCatalogAction_model_renewal_suppressed:")));
});

test("pendingCatalogAction: completed get_product_details does not force consumption when the model emits valid continuity", async () => {
  catalogUpWithPublicLink({
    canonicalUrl: "https://pesaschile.cl/productos/501-kettlebell",
    scope: "exact_product",
    available: true,
    requiresVariantSelection: false,
    variantAttributeLabels: []
  });
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      {
        type: "respond",
        message: "Te dejo el link y puedo mantenerlo a mano si quieres.",
        pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"] }
      }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "si",
    commercialContextSummary: {},
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"] },
    provider
  });

  assert.equal(result.toolExecutionCount, 1);
  assert.deepEqual(result.finalPendingCatalogAction, { actionType: "send_product_link", candidateProductIds: ["501"] });
  assert.ok(!result.warnings.some((warning) => warning.startsWith("pendingCatalogAction_tool_failed_consumed:")));
  assert.ok(!result.warnings.some((warning) => warning.startsWith("pendingCatalogAction_tool_blocked_consumed:")));
  assert.ok(!result.warnings.some((warning) => warning.startsWith("pendingCatalogAction_model_renewal_suppressed:")));
});

test("pendingCatalogAction: a handoff terminal never carries a pending action forward", async () => {
  const provider = createFakeAgentLoopProvider({ script: [{ type: "handoff", reason: "Requiere revision humana." }] });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "quiero hablar con una persona",
    commercialContextSummary: {},
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"] },
    provider
  });

  assert.equal(result.terminalReason, "handoff");
  assert.equal(result.finalPendingCatalogAction, null);
});
