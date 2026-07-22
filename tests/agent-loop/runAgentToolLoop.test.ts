import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { runAgentToolLoop } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";
import { createFakeAgentLoopProvider } from "@/lib/brain/commercial/agent-loop/providers/fakeAgentLoopProvider";
import { resetCapabilityGatewayCatalogPortForTests } from "@/lib/brain/commercial/capability-gateway/registry";

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

function catalogDown() {
  handler = (_req, res) => sendJson(res, 503, { error: "unavailable" });
}

const baseInput = {
  correlationId: "corr-1",
  conversationId: 1,
  opportunityId: null,
  currentTime: "2026-07-21T15:00:00.000Z"
};

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
});
