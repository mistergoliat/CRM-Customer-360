import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { getPool } from "@/lib/db";
import { AGENT_LOOP_TOOL_POOL, runAgentToolLoop } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";
import { createFakeAgentLoopProvider } from "@/lib/brain/commercial/agent-loop/providers/fakeAgentLoopProvider";
import type { AgentLoopProvider } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";
import { resetCapabilityGatewayCatalogPortForTests } from "@/lib/brain/commercial/capability-gateway/registry";
import { markAgentLoopProviderFailure } from "@/lib/brain/commercial/agent-loop/providers/providerFailureClassification";

// LLM-R1-T08D. Same local dev DB credentials tests/commercial/selectProductsCapability.test.ts
// already establishes - node:test loads every matched file into one process,
// so whichever file sets these first makes select_products' real DB write
// path reachable for the rest of the run too. Needed here (unlike every
// other test in this file, which stays at opportunityId: null and observes
// select_products as "denied") only for the two new mutation-guard tests
// below that need a genuinely completed selection.
Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "main_management",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "main_management",
  DATABASE_USER: "crm_app",
  DATABASE_PASSWORD: "una_clave_local",
  DATABASE_URL: ""
});

function uniqueOpportunityId() {
  return 830000000 + Math.floor(Math.random() * 9999999);
}

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
  // LLM-R1-T08D. This file never opened the real DB pool before (every other
  // test stays at opportunityId: null, so select_products always short-
  // circuits to "denied" before touching lib/db.ts) - the new mutation-guard
  // tests are the first ones here to actually reach it. mysql2's pool keeps
  // the event loop alive indefinitely once opened; same teardown
  // tests/commercial/selectProductsCapability.test.ts already uses.
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures - test results already reported
  }
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

// --- LLM-R1-T01: bounded structured-output recovery (normalizedReason "invalid_response" only) ---
// See docs/audits/SALES-AGENT-LLM-PROVIDER-LATENCY-STRUCTURED-OUTPUT-AUDIT.md (P0-1) and
// docs/releases/LLM-R1-T01-structured-output-recovery.md.

function invalidResponseFailure(errorCode: "empty_response" | "invalid_model_json" = "invalid_model_json"): Error {
  return markAgentLoopProviderFailure(
    new Error(errorCode === "empty_response" ? "Agent loop HTTP provider returned an empty response." : "Agent loop HTTP provider returned invalid response JSON."),
    {
      model: "deepseek-v4-flash",
      attemptCount: 1,
      maxAttempts: 1,
      httpStatus: 200,
      errorCode,
      errorClass: "InvalidProviderResponseError",
      normalizedReason: "invalid_response",
      retryable: false
    }
  );
}

test("[LLM-R1-T01 Case 1] gathering recovers from a single invalid_response with exactly one structured-recovery attempt", async () => {
  let callCount = 0;
  const provider: AgentLoopProvider = {
    name: "flaky-gathering-provider",
    async invoke() {
      callCount += 1;
      if (callCount === 1) throw invalidResponseFailure("invalid_model_json");
      return { rawOutput: { type: "respond", message: "Recuperado tras invalid_response." } };
    }
  };

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "hola", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.finalMessage, "Recuperado tras invalid_response.");
  assert.equal(callCount, 2, "exactly 2 provider calls: the failed attempt plus the one structured-recovery attempt");
  assert.ok(result.warnings.includes("agent_loop_structured_recovery_attempted:gathering"));
});

test("[LLM-R1-T01 Case 2] gathering fails closed after a second consecutive invalid_response - never a third attempt", async () => {
  let callCount = 0;
  const provider: AgentLoopProvider = {
    name: "always-invalid-response-gathering-provider",
    async invoke() {
      callCount += 1;
      throw invalidResponseFailure("empty_response");
    }
  };

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "hola", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "provider_unavailable");
  assert.equal(callCount, 2, "exactly 2 provider calls: the original attempt plus the one structured-recovery attempt, never a third");
  assert.equal(result.providerFailure?.normalizedReason, "invalid_response");
  assert.equal(result.providerFailure?.errorCode, "empty_response");
  assert.ok(result.warnings.includes("agent_loop_structured_recovery_attempted:gathering"));
});

test("[LLM-R1-T01 Case 3] finalization recovers after tools already completed - reproduces the reported incident (tools stay completed, final answer recovered instead of lost) and never re-executes the mutating tool", async () => {
  catalogUp(1);
  let callCount = 0;
  const provider: AgentLoopProvider = {
    name: "structured-recovery-finalization-provider",
    async invoke() {
      callCount += 1;
      if (callCount === 1) return { rawOutput: { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } } };
      if (callCount === 2) return { rawOutput: { type: "use_tool", tool: "select_products", arguments: { items: [{ productId: "501", quantity: 2 }] } } };
      if (callCount === 3) throw invalidResponseFailure("invalid_model_json");
      return { rawOutput: { type: "respond", message: "Listo, agregue 2 unidades del Kettlebell 16kg." } };
    }
  };

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "dame 2 de las classic", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(callCount, 4, "2 tool decisions + 1 failed finalization attempt + 1 recovered finalization attempt");
  assert.equal(result.toolExecutionCount, 2, "both tools already completed before the structural failure - the recovery attempt must never re-run them");

  const toolNames = result.steps.filter((step) => step.step.type === "use_tool").map((step) => (step.step as { tool: string }).tool);
  assert.deepEqual(toolNames, ["get_product_details", "select_products"], "each tool - including the mutating select_products - appears exactly once in the full turn trace, never duplicated by the finalization structured-recovery attempt");
  assert.ok(result.warnings.includes("agent_loop_structured_recovery_attempted:finalization"));

  // LLM-R1-T08D, Parte 5. baseInput.opportunityId is null, so select_products
  // never actually reaches status "completed" here (denied:
  // no_active_opportunity) - the recovered finalization message ("Listo,
  // agregue 2 unidades...") claims a completion this fixture never truly
  // backs. Before this task that mismatch was invisible; the Commercial
  // Mutation Execution Guard now correctly intercepts it - this is the guard
  // doing its job, not a regression of T01's recovery mechanism (which the
  // assertions above already fully cover: exactly 2 tool executions, never
  // duplicated, recovery warning present).
  assert.equal(result.finalMessage, "Necesito un momento mas para confirmar tu seleccion antes de continuar - ¿puedes confirmarme nuevamente que producto y cantidad quieres?");
  assert.ok(result.warnings.some((warning) => warning.startsWith("agent_loop_mutation_claim_blocked:")));
});

test("[LLM-R1-T01 Case 4] finalization fails closed after a second consecutive invalid_response - never a third finalization attempt", async () => {
  catalogUp(1);
  let callCount = 0;
  const provider: AgentLoopProvider = {
    name: "always-invalid-response-finalization-provider",
    async invoke() {
      callCount += 1;
      if (callCount === 1) return { rawOutput: { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } } };
      if (callCount === 2) return { rawOutput: { type: "use_tool", tool: "select_products", arguments: { items: [{ productId: "501", quantity: 2 }] } } };
      throw invalidResponseFailure("empty_response");
    }
  };

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "dame 2 de las classic", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "provider_unavailable");
  assert.equal(callCount, 4, "2 tool decisions + exactly 2 finalization attempts, never a third");
  assert.equal(result.toolExecutionCount, 2, "tools already completed before finalization must never be re-run just because finalization itself failed twice");
  assert.equal(result.providerFailure?.normalizedReason, "invalid_response");
  assert.equal(result.providerFailure?.errorCode, "empty_response");
  assert.ok(result.warnings.includes("agent_loop_structured_recovery_attempted:finalization"));
});

test("[LLM-R1-T01 Case 5] a non-structural provider error (authentication_error) still fails fast - never gets a structured-recovery attempt", async () => {
  let callCount = 0;
  const provider: AgentLoopProvider = {
    name: "auth-error-provider",
    async invoke() {
      callCount += 1;
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

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "hola", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "provider_unavailable");
  assert.equal(callCount, 1, "authentication_error is not normalizedReason invalid_response - must fail immediately, no structured-recovery attempt");
  assert.equal(result.providerFailure?.normalizedReason, "authentication_error");
  assert.ok(!result.warnings.some((warning) => warning.startsWith("agent_loop_structured_recovery_attempted")), "a non-invalid_response failure must never trigger structured recovery");
});

// --- LLM-R1-T02: per-inference observability (llmCalls) ---
// See docs/audits/SALES-AGENT-LLM-PROVIDER-LATENCY-STRUCTURED-OUTPUT-AUDIT.md
// and docs/releases/LLM-R1-T02-provider-observability.md.

function networkErrorFailure(): Error {
  return markAgentLoopProviderFailure(new TypeError("fetch failed"), {
    model: "deepseek-v4-flash",
    attemptCount: 1,
    maxAttempts: 1,
    httpStatus: null,
    errorCode: "ECONNRESET",
    errorClass: "TypeError",
    normalizedReason: "network_error",
    retryable: true
  });
}

test("[LLM-R1-T02 Caso 1] a successful gathering call's llmCalls entry captures elapsedMs/model/finishReason/tokens/providerRequestId", async () => {
  const provider = createFakeAgentLoopProvider({ script: [{ type: "respond", message: "hola" }] });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "hola", commercialContextSummary: {}, provider });

  assert.equal(result.llmCalls.length, 1);
  const call = result.llmCalls[0];
  assert.equal(call.phase, "gathering");
  assert.equal(call.attempt, 0);
  assert.equal(call.decisionIndex, 0);
  assert.ok(call.elapsedMs >= 0, "elapsedMs must be a real measured duration");
  assert.equal(call.model, "fake-agent-loop-model");
  assert.equal(call.finishReason, "stop");
  assert.equal(call.inputTokens, 32);
  assert.equal(call.outputTokens, 64);
  assert.ok(call.providerRequestId?.startsWith("fake-agent-loop-"));
  assert.equal(call.outcome, "success");
});

test("[LLM-R1-T02 Caso 4] a network_error failure's llmCalls entry has elapsedMs captured but finishReason/tokens null, never fabricated", async () => {
  let callCount = 0;
  const provider: AgentLoopProvider = {
    name: "network-error-provider",
    async invoke() {
      callCount += 1;
      throw networkErrorFailure();
    }
  };

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "hola", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "provider_unavailable");
  assert.equal(callCount, 1, "network_error is not normalizedReason invalid_response - fails immediately, no structured recovery");
  assert.equal(result.llmCalls.length, 1);
  const call = result.llmCalls[0];
  assert.equal(call.outcome, "network_error");
  assert.ok(call.elapsedMs >= 0, "elapsedMs must still be captured even though the call failed");
  assert.equal(call.finishReason, null);
  assert.equal(call.inputTokens, null);
  assert.equal(call.outputTokens, null);
});

test("[LLM-R1-T02 Caso 5] T01's gathering structured recovery produces two distinct, individually observable llmCalls entries", async () => {
  let callCount = 0;
  const provider: AgentLoopProvider = {
    name: "flaky-gathering-provider",
    async invoke() {
      callCount += 1;
      if (callCount === 1) throw invalidResponseFailure("invalid_model_json");
      return { rawOutput: { type: "respond", message: "Recuperado tras invalid_response." }, model: "deepseek-v4-flash", finishReason: "stop", inputTokens: 40, outputTokens: 12, providerRequestId: "req-recovered" };
    }
  };

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "hola", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.llmCalls.length, 2, "llmCallCount=2 - both invocations individually observable");
  assert.equal(result.llmCalls[0].phase, "gathering");
  assert.equal(result.llmCalls[0].attempt, 0);
  assert.equal(result.llmCalls[0].decisionIndex, 0);
  assert.equal(result.llmCalls[0].outcome, "invalid_response");
  assert.equal(result.llmCalls[1].phase, "gathering");
  assert.equal(result.llmCalls[1].attempt, 1, "the recovery attempt is distinguished from the initial attempt by its attempt index");
  assert.equal(result.llmCalls[1].decisionIndex, 0, "same decision slot as the failed attempt it recovered");
  assert.equal(result.llmCalls[1].outcome, "success");
  assert.equal(result.llmCalls[1].providerRequestId, "req-recovered");
});

test("[LLM-R1-T02 Caso 6] finalization structured recovery after tools already completed: correct llmCalls, toolExecutionCount unchanged, side effects never duplicated", async () => {
  catalogUp(1);
  let callCount = 0;
  const provider: AgentLoopProvider = {
    name: "structured-recovery-finalization-provider",
    async invoke() {
      callCount += 1;
      if (callCount === 1) return { rawOutput: { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } } };
      if (callCount === 2) return { rawOutput: { type: "use_tool", tool: "select_products", arguments: { items: [{ productId: "501", quantity: 2 }] } } };
      if (callCount === 3) throw invalidResponseFailure("invalid_model_json");
      return { rawOutput: { type: "respond", message: "Listo, agregue 2 unidades del Kettlebell 16kg." } };
    }
  };

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "dame 2 de las classic", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.toolExecutionCount, 2);
  assert.equal(result.llmCalls.length, 4, "2 gathering decisions + 2 finalization attempts");
  assert.deepEqual(
    result.llmCalls.map((call) => [call.phase, call.attempt, call.decisionIndex, call.outcome]),
    [
      ["gathering", 0, 0, "success"],
      ["gathering", 0, 1, "success"],
      ["finalization", 0, null, "invalid_response"],
      ["finalization", 1, null, "success"]
    ]
  );
  const toolNames = result.steps.filter((step) => step.step.type === "use_tool").map((step) => (step.step as { tool: string }).tool);
  assert.deepEqual(toolNames, ["get_product_details", "select_products"], "each tool - including the mutating select_products - still executes exactly once");
});

test("[LLM-R1-T02 Caso 8] a successful call with no usage data leaves that call's inputTokens/outputTokens null, never an invented 0", async () => {
  const provider: AgentLoopProvider = {
    name: "no-usage-provider",
    async invoke() {
      return { rawOutput: { type: "respond", message: "hola" }, model: "deepseek-v4-flash", finishReason: "stop" };
    }
  };

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "hola", commercialContextSummary: {}, provider });

  assert.equal(result.llmCalls.length, 1);
  assert.equal(result.llmCalls[0].inputTokens, null);
  assert.equal(result.llmCalls[0].outputTokens, null);
  assert.equal(result.llmCalls[0].finishReason, "stop", "a field the provider did supply must still be preserved, even when another is missing");
});

test("[LLM-R1-T02] llmCalls never carries rawOutput, prompt text, or any secret-shaped key", async () => {
  catalogUp(1);
  let callCount = 0;
  const provider: AgentLoopProvider = {
    name: "structured-recovery-finalization-provider",
    async invoke() {
      callCount += 1;
      if (callCount === 1) return { rawOutput: { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } } };
      if (callCount === 2) return { rawOutput: { type: "use_tool", tool: "select_products", arguments: { items: [{ productId: "501", quantity: 2 }] } } };
      if (callCount === 3) throw invalidResponseFailure("invalid_model_json");
      return { rawOutput: { type: "respond", message: "Listo." } };
    }
  };

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "dame 2 de las classic", commercialContextSummary: {}, provider });

  const allowedKeys = new Set(["phase", "attempt", "decisionIndex", "elapsedMs", "model", "providerRequestId", "finishReason", "inputTokens", "outputTokens", "reasoningTokens", "outcome"]);
  for (const call of result.llmCalls) {
    for (const key of Object.keys(call)) {
      assert.ok(allowedKeys.has(key), `unexpected key leaked into an llmCalls entry: ${key}`);
    }
  }
  const serialized = JSON.stringify(result.llmCalls);
  assert.ok(!serialized.includes("get_product_details"), "no tool name/argument (rawOutput content) may leak into llmCalls");
  assert.ok(!serialized.toLowerCase().includes("apikey"));
  assert.ok(!serialized.toLowerCase().includes("authorization"));
  assert.ok(!serialized.toLowerCase().includes("bearer"));
});

// --- LLM-R1-T03: the real finalization prompt sent to the provider reflects
// the reduction (end-to-end, not just buildAgentStepPromptPackage in
// isolation) - see docs/releases/LLM-R1-T03-prompt-finalization-reduction.md.

test("[LLM-R1-T03 Caso 6] the actual finalization system prompt the provider receives omits removed tool-invocation lines while keeping grounding/closing/pending-action rules, and the turn still completes normally", async () => {
  catalogUp(1);
  let finalizationSystemPrompt: string | null = null;
  let callCount = 0;
  const provider: AgentLoopProvider = {
    name: "finalization-prompt-capturing-provider",
    async invoke(request) {
      callCount += 1;
      if (callCount === 1) return { rawOutput: { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } } };
      if (callCount === 2) return { rawOutput: { type: "use_tool", tool: "select_products", arguments: { items: [{ productId: "501", quantity: 2 }] } } };
      finalizationSystemPrompt = request.messages.find((message) => message.role === "system")?.content ?? null;
      return { rawOutput: { type: "respond", message: "Listo, agregue 2 unidades del Kettlebell 16kg." } };
    }
  };

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "dame 2 de las classic", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded", "the turn must still complete normally - the reduced prompt changes tokens sent, never functional behavior");
  assert.equal(result.toolExecutionCount, 2);
  assert.ok(finalizationSystemPrompt, "the finalization call must have been reached and its system prompt captured");

  assert.doesNotMatch(finalizationSystemPrompt!, /Use select_products only once the customer has confirmed/);
  assert.doesNotMatch(finalizationSystemPrompt!, /Use calculate_shipping only after the destination/);
  assert.doesNotMatch(finalizationSystemPrompt!, /recommend_catalog_products requires sourceProduct\.productId/);
  assert.match(finalizationSystemPrompt!, /You must never invent product, price, stock, or delivery information not returned by a tool this turn/);
  assert.match(finalizationSystemPrompt!, /close with exactly: "¿Quieres que te envíe el link para revisarlo\?"/);
});

// --- LLM-R1-T04: guided structured repair (the real retry prompt the
// provider receives is guided by the prior failure, not a blind resend).
// See docs/releases/LLM-R1-T04-guided-structured-repair.md.

test("[LLM-R1-T04 Caso 2] gathering: the structured-recovery attempt's real prompt contains the guided repair instruction", async () => {
  let capturedRepairSystemPrompt: string | null = null;
  let callCount = 0;
  const provider: AgentLoopProvider = {
    name: "gathering-repair-capturing-provider",
    async invoke(request) {
      callCount += 1;
      if (callCount === 1) throw invalidResponseFailure("invalid_model_json");
      capturedRepairSystemPrompt = request.messages.find((message) => message.role === "system")?.content ?? null;
      return { rawOutput: { type: "respond", message: "Recuperado con reparacion guiada." } };
    }
  };

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "hola", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(callCount, 2, "exactly the 1 failed attempt + T01's 1 recovery attempt");
  assert.ok(capturedRepairSystemPrompt, "the recovery call must have been reached and its system prompt captured");
  assert.match(capturedRepairSystemPrompt!, /Your previous response was structurally invalid or empty/);
  assert.match(capturedRepairSystemPrompt!, /Return exactly one valid JSON object matching the AgentStep contract/);
});

test("[LLM-R1-T04 Caso 1] gathering: the very first attempt's real prompt never contains a repair instruction", async () => {
  let firstSystemPrompt: string | null = null;
  const provider: AgentLoopProvider = {
    name: "first-attempt-capturing-provider",
    async invoke(request) {
      firstSystemPrompt = request.messages.find((message) => message.role === "system")?.content ?? null;
      return { rawOutput: { type: "respond", message: "hola" } };
    }
  };

  await runAgentToolLoop({ ...baseInput, customerMessage: "hola", commercialContextSummary: {}, provider });

  assert.ok(firstSystemPrompt);
  assert.doesNotMatch(firstSystemPrompt!, /previous response was structurally invalid/);
  assert.doesNotMatch(firstSystemPrompt!, /previous AgentStep was rejected/);
});

test("[LLM-R1-T04 Caso 3] finalization: the recovery attempt's real prompt contains the guided repair instruction, and the turn still completes normally", async () => {
  catalogUp(1);
  let capturedRepairSystemPrompt: string | null = null;
  let callCount = 0;
  const provider: AgentLoopProvider = {
    name: "finalization-repair-capturing-provider",
    async invoke(request) {
      callCount += 1;
      if (callCount === 1) return { rawOutput: { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } } };
      if (callCount === 2) return { rawOutput: { type: "use_tool", tool: "select_products", arguments: { items: [{ productId: "501", quantity: 2 }] } } };
      if (callCount === 3) throw invalidResponseFailure("invalid_model_json");
      capturedRepairSystemPrompt = request.messages.find((message) => message.role === "system")?.content ?? null;
      return { rawOutput: { type: "respond", message: "Listo, agregue 2 unidades del Kettlebell 16kg." } };
    }
  };

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "dame 2 de las classic", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.toolExecutionCount, 2, "[Caso 7] both tools already completed before the structural failure - never re-run by the repair attempt");
  assert.ok(capturedRepairSystemPrompt, "the finalization recovery call must have been reached and its system prompt captured");
  assert.match(capturedRepairSystemPrompt!, /Your previous response was structurally invalid or empty/);

  // [Caso 9] the repaired finalization prompt still excludes what LLM-R1-T03 removed.
  assert.doesNotMatch(capturedRepairSystemPrompt!, /Use select_products only once the customer has confirmed/);
  assert.doesNotMatch(capturedRepairSystemPrompt!, /recommend_catalog_products requires sourceProduct\.productId/);
  assert.match(capturedRepairSystemPrompt!, /You must never invent product, price, stock, or delivery information not returned by a tool this turn/);

  const toolNames = result.steps.filter((step) => step.step.type === "use_tool").map((step) => (step.step as { tool: string }).tool);
  assert.deepEqual(toolNames, ["get_product_details", "select_products"], "[Caso 7] the mutating tool select_products still executes exactly once");
});

test("[LLM-R1-T04 Caso 4] gathering: a schema-invalid AgentStep retry's real prompt receives the sanitized reasonCode", async () => {
  let capturedRepairSystemPrompt: string | null = null;
  let callCount = 0;
  const provider: AgentLoopProvider = {
    name: "schema-repair-capturing-provider",
    async invoke(request) {
      callCount += 1;
      // Missing `tool` for a use_tool step -> validateAgentStep rejects with reasonCode "missing_required_field".
      if (callCount === 1) return { rawOutput: { type: "use_tool" } };
      capturedRepairSystemPrompt = request.messages.find((message) => message.role === "system")?.content ?? null;
      return { rawOutput: { type: "respond", message: "Recuperado tras reparacion de schema." } };
    }
  };

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "hola", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(callCount, 2, "exactly the 1 failed attempt + the pre-existing 1 schema-invalid retry");
  assert.ok(capturedRepairSystemPrompt);
  assert.match(capturedRepairSystemPrompt!, /Your previous AgentStep was rejected: reason=missing_required_field\./);
});

test("[LLM-R1-T04 Caso 5] the schema-repair prompt never leaks the raw invalid output that failed validation", async () => {
  const SECRET = "SECRET_RAW_MODEL_OUTPUT_123";
  const capturedMessages: { role: string; content: string }[] = [];
  let callCount = 0;
  const provider: AgentLoopProvider = {
    name: "no-leakage-provider",
    async invoke(request) {
      callCount += 1;
      // An invalid `type` (never use_tool/respond/handoff) with the secret
      // embedded in a field validateAgentStep never reads - reasonCode
      // "missing_or_invalid_type", entirely independent of `note`'s value.
      if (callCount === 1) return { rawOutput: { type: "not_a_real_agent_step_type", note: SECRET } };
      capturedMessages.push(...request.messages);
      return { rawOutput: { type: "respond", message: "Disculpa, reformulo mi respuesta." } };
    }
  };

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "hola", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.ok(capturedMessages.length > 0, "the repair call must have been reached and its messages captured");
  for (const message of capturedMessages) {
    assert.ok(!message.content.includes(SECRET), `${message.role} message must never contain the raw invalid output`);
  }
});

test("[LLM-R1-T04 Caso 6] the repair instruction never expands the recovery budget - still exactly one structured-recovery attempt, no third call", async () => {
  let callCount = 0;
  const provider: AgentLoopProvider = {
    name: "always-invalid-response-with-repair-provider",
    async invoke() {
      callCount += 1;
      throw invalidResponseFailure("empty_response");
    }
  };

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "hola", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "provider_unavailable");
  assert.equal(callCount, 2, "exactly 2 calls even with guided repair now attached - never a 3rd");
});

test("[LLM-R1-T04 Caso 8] T02 observability still records the failed attempt and the repaired attempt as two separate llmCalls entries", async () => {
  let callCount = 0;
  const provider: AgentLoopProvider = {
    name: "repair-observability-provider",
    async invoke() {
      callCount += 1;
      if (callCount === 1) throw invalidResponseFailure("invalid_model_json");
      return { rawOutput: { type: "respond", message: "ok" } };
    }
  };

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "hola", commercialContextSummary: {}, provider });

  assert.equal(result.llmCalls.length, 2, "the guided repair attempt is still individually observable, exactly like before this task");
  assert.equal(result.llmCalls[0].outcome, "invalid_response");
  assert.equal(result.llmCalls[0].attempt, 0);
  assert.equal(result.llmCalls[1].outcome, "success");
  assert.equal(result.llmCalls[1].attempt, 1);
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

test("I0 - el pool conserva las tools previas mas explore_catalog/set_shipping_destination/select_products/calculate_shipping/select_shipping_option (expansion intencional, nada eliminado)", () => {
  assert.deepEqual(
    [...AGENT_LOOP_TOOL_POOL].sort(),
    [
      "calculate_shipping",
      "explore_catalog",
      "get_product_details",
      "recommend_catalog_products",
      "search_company_knowledge",
      "search_products",
      "select_products",
      "select_shipping_option",
      "set_shipping_destination"
    ].sort()
  );
});

// --- CRM-R1-T13E.2: select_products evidence gate ---

test("select_products: an item never observed this conversation is blocked before the capability ever runs (no persistence attempted)", async () => {
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "select_products", arguments: { items: [{ productId: "999", quantity: 1 }] } },
      { type: "respond", message: "No pude confirmar ese producto." }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "quiero 1 del producto 999",
    commercialContextSummary: {},
    // Present but empty, so the gate reports the precise "not observed"
    // reason rather than "no evidence source available at all".
    recentCatalogContext: { interactions: [] },
    provider
  });

  assert.equal(result.toolExecutionCount, 0, "a call blocked by the evidence gate must never reach the Gateway/count toward the tool budget");
  const observation = result.steps.find((step) => step.step.type === "use_tool")?.observation;
  assert.equal(observation?.status, "blocked");
  assert.equal(observation?.errorCode, "source_product_not_observed");
});

test("select_products: an item observed via search_products this conversation clears the evidence gate and reaches the Gateway", async () => {
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "select_products", arguments: { items: [{ productId: "501", quantity: 2 }] } },
      { type: "respond", message: "Listo, agregue el producto." }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "quiero 2 del kettlebell",
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
    provider
  });

  assert.equal(result.toolExecutionCount, 1, "an evidence-grounded call must reach the Gateway, not be blocked by the evidence gate");
  const observation = result.steps.find((step) => step.step.type === "use_tool")?.observation;
  assert.notEqual(observation?.errorCode, "source_product_not_observed");
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

// --- CP-R1-T10B8D: get_product_details continuity gating against a recommendation-origin pendingCatalogAction ---
// A pendingCatalogAction WITHOUT candidateProducts (every pre-existing test above) never triggers any of this -
// get_product_details keeps its pre-existing, unconditioned authorization. Only candidateProducts turns it on.

test("get_product_details continuity: a matching recommendation candidate is authorized and consumes the action on completion", async () => {
  catalogUp(1);
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      { type: "respond", message: "Aqui el detalle." }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "el primero",
    commercialContextSummary: {},
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"], candidateProducts: [{ productId: "501" }] },
    provider
  });

  assert.equal(result.toolExecutionCount, 1);
  assert.equal(result.steps[0].observation?.status, "completed");
  assert.equal(result.finalPendingCatalogAction, null);
  assert.ok(result.warnings.includes("recommendation_pending_catalog_action_consumed:completed"));
});

test("get_product_details continuity: a non-candidate product with no other evidence is blocked before any HTTP call, action stays intact", async () => {
  let called = false;
  handler = (_req, res) => {
    called = true;
    sendJson(res, 200, { error: "must never be reached" });
  };
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "999" } },
      { type: "respond", message: "No pude confirmar ese producto." }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "dame el detalle de otro",
    commercialContextSummary: {},
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"], candidateProducts: [{ productId: "501" }] },
    provider
  });

  assert.equal(called, false, "the gate must block before any HTTP call reaches the catalog service");
  assert.equal(result.toolExecutionCount, 0);
  const observation = result.steps.find((step) => step.step.type === "use_tool")?.observation;
  assert.equal(observation?.status, "blocked");
  assert.equal(observation?.errorCode, "product_not_in_pending_catalog_candidates");
  assert.deepEqual(result.finalPendingCatalogAction, { actionType: "send_product_link", candidateProductIds: ["501"], candidateProducts: [{ productId: "501" }] });
});

test("get_product_details continuity: exact combinationId match against the candidate is authorized", async () => {
  catalogUp(1);
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501", combinationId: "10" } },
      { type: "respond", message: "Aqui esa variante." }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "esa variante",
    commercialContextSummary: {},
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"], candidateProducts: [{ productId: "501", combinationId: "10" }] },
    provider
  });

  assert.equal(result.toolExecutionCount, 1);
  assert.equal(result.steps[0].observation?.status, "completed");
});

test("get_product_details continuity: a different combinationId of the same candidate product is blocked, never silently resolved to the base product", async () => {
  let called = false;
  handler = (_req, res) => {
    called = true;
    sendJson(res, 200, { error: "must never be reached" });
  };
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501", combinationId: "11" } },
      { type: "respond", message: "..." }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "otra variante",
    commercialContextSummary: {},
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"], candidateProducts: [{ productId: "501", combinationId: "10" }] },
    provider
  });

  assert.equal(called, false);
  const observation = result.steps.find((step) => step.step.type === "use_tool")?.observation;
  assert.equal(observation?.status, "blocked");
  assert.equal(observation?.errorCode, "product_not_in_pending_catalog_candidates");
});

test("get_product_details continuity: a related (candidate) failure still consumes the action - the complementary case to the unrelated test above", async () => {
  catalogDown();
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      { type: "respond", message: "No pude confirmar ese producto ahora." }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "dame el detalle",
    commercialContextSummary: {},
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"], candidateProducts: [{ productId: "501" }] },
    provider
  });

  assert.equal(result.toolExecutionCount, 1);
  assert.equal(result.steps[0].observation?.status, "failed");
  assert.equal(result.finalPendingCatalogAction, null);
  assert.ok(result.warnings.includes("recommendation_pending_catalog_action_consumed:failed"));
});

/**
 * CP-R1-T10B8D. "blocked" and "completed" are OR'd into the exact same
 * consumption condition (see runAgentToolLoop.ts) - there is no code path in
 * this loop that can put a first-touch get_product_details call for an
 * already-authorized candidate into a governance "blocked" state (the only
 * reachable governance block, duplicate-call detection, requires an
 * identical prior call, which - being for the same matching candidate -
 * already consumed the action via completed/failed before the duplicate is
 * even attempted). This test verifies the observable, always-true invariant
 * instead: touching a candidate via get_product_details in any way this
 * turn, completed or blocked-duplicate, always ends with the action
 * consumed and never resurrected.
 */
test("get_product_details continuity: a duplicate call to an already-consumed candidate never resurrects the action", async () => {
  catalogUp(1);
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      { type: "respond", message: "..." }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "...",
    commercialContextSummary: {},
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"], candidateProducts: [{ productId: "501" }] },
    maxDecisions: 4,
    maxToolExecutions: 2,
    provider
  });

  assert.equal(result.steps[0].observation?.status, "completed");
  assert.equal(result.steps[1].observation?.status, "blocked");
  assert.equal(result.steps[1].observation?.errorCode, "duplicate_tool_call");
  assert.equal(result.finalPendingCatalogAction, null);
});

test("get_product_details continuity: another tool never consumes the recommendation action", async () => {
  catalogDown();
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "explore_catalog", arguments: { sort: { by: "price", direction: "desc" }, limit: 1 } },
      { type: "respond", message: "Sigo con la recomendacion anterior." }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "algo mas",
    commercialContextSummary: {},
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["501"], candidateProducts: [{ productId: "501" }] },
    provider
  });

  assert.deepEqual(result.finalPendingCatalogAction, { actionType: "send_product_link", candidateProductIds: ["501"], candidateProducts: [{ productId: "501" }] });
});

test("get_product_details continuity: a non-candidate product backed by this turn's own search_products evidence is authorized but does not consume the action", async () => {
  catalogUp(1);
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "search_products", arguments: { query: "kettlebell" } },
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      { type: "respond", message: "Aqui otro producto que encontre." }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    customerMessage: "y busca otra cosa tambien",
    commercialContextSummary: {},
    // The active recommendation continuity is for a DIFFERENT product (777) -
    // 501 only becomes reachable via this turn's own search_products evidence.
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["777"], candidateProducts: [{ productId: "777" }] },
    maxToolExecutions: 2,
    provider
  });

  assert.equal(result.toolExecutionCount, 2);
  const detailStep = result.steps.filter((step) => step.step.type === "use_tool")[1];
  assert.equal(detailStep.observation?.status, "completed");
  assert.deepEqual(result.finalPendingCatalogAction, { actionType: "send_product_link", candidateProductIds: ["777"], candidateProducts: [{ productId: "777" }] });
});

// ---------------------------------------------------------------------------
// LLM-R1-T08D: Commercial Mutation Execution Guard (Parte 5) + C09 budget
// strategy (Parte 6, Option A - maxToolExecutions stays 2). See
// docs/releases/LLM-R1-T08D-multi-intent-tool-budget-and-mutation-guard.md.
// ---------------------------------------------------------------------------

test("[T08D-1] Commercial Mutation Execution Guard blocks an unbacked mutation claim - no select_products evidence this turn", async () => {
  catalogUp(1);
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      { type: "respond", message: "Perfecto, te dejo 2 unidades del Kettlebell 16kg." }
    ]
  });

  const result = await runAgentToolLoop({ ...baseInput, customerMessage: "quiero 2 kettlebell", commercialContextSummary: {}, provider });

  assert.equal(result.terminalReason, "responded");
  assert.equal(
    result.finalMessage,
    "Necesito un momento mas para confirmar tu seleccion antes de continuar - ¿puedes confirmarme nuevamente que producto y cantidad quieres?"
  );
  assert.ok(result.warnings.some((warning) => warning.startsWith("agent_loop_mutation_claim_blocked:")));
});

test("[T08D-2] Commercial Mutation Execution Guard allows a backed mutation claim - select_products genuinely completed this turn", async () => {
  catalogUp(1);
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      { type: "use_tool", tool: "select_products", arguments: { items: [{ productId: "501", quantity: 2 }] } },
      { type: "respond", message: "Listo, agregue 2 unidades del Kettlebell 16kg." }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    opportunityId: uniqueOpportunityId(),
    customerMessage: "quiero 2 kettlebell",
    commercialContextSummary: {},
    provider
  });

  assert.equal(result.terminalReason, "responded");
  assert.equal(result.finalMessage, "Listo, agregue 2 unidades del Kettlebell 16kg.");
  assert.ok(!result.warnings.some((warning) => warning.startsWith("agent_loop_mutation_claim_blocked:")));

  const selectStep = result.steps.find((step) => step.step.type === "use_tool" && step.step.tool === "select_products");
  assert.equal(selectStep?.observation?.status, "completed");
});

test("[T08D-3] C09-style multi-intent turn completes select_products within the unchanged maxToolExecutions=2 budget when the model prioritizes the confirmed mutation first (Option A)", async () => {
  catalogUp(1);
  const provider = createFakeAgentLoopProvider({
    script: [
      { type: "use_tool", tool: "get_product_details", arguments: { productId: "501" } },
      { type: "use_tool", tool: "select_products", arguments: { items: [{ productId: "501", quantity: 2 }] } },
      { type: "respond", message: "Listo, agregue 2 unidades del Kettlebell 16kg. Dame un momento y te confirmo el despacho a Ñuñoa." }
    ]
  });

  const result = await runAgentToolLoop({
    ...baseInput,
    opportunityId: uniqueOpportunityId(),
    customerMessage: "quiero 2 kettlebell y saber cuanto sale el despacho a Ñuñoa",
    commercialContextSummary: {},
    provider
    // maxToolExecutions left at its default (2) - LLM-R1-T08D Option A: no budget increase.
  });

  assert.equal(result.terminalReason, "responded");
  assert.equal(
    result.toolExecutionCount,
    2,
    "get_product_details + select_products both fit inside the unchanged budget of 2 when select_products is prioritized over the secondary shipping intent"
  );
  const selectStep = result.steps.find((step) => step.step.type === "use_tool" && step.step.tool === "select_products");
  assert.equal(
    selectStep?.observation?.status,
    "completed",
    "the required mutation completes within budget - set_shipping_destination/calculate_shipping are correctly deferred to a follow-up turn, per C09's own groundTruth design (LLM-R1-T05 Parte E)"
  );
  assert.ok(!result.warnings.some((warning) => warning.startsWith("agent_loop_mutation_claim_blocked:")), "a truthful, backed claim is never touched by the guard");
});
