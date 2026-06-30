import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool } from "@/lib/db";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";
import {
  createMemorySalesConsultativeProductRepository,
  createSalesConsultativeOperationsRepository
} from "@/lib/brain/commercial/sales-consultative";
import { buildAgentToolRegistry } from "@/lib/brain/commercial/agent-runtime/tools/registry";
import { createScriptedAgentProvider } from "@/lib/brain/commercial/agent-runtime/provider/fakeProvider";
import { runCommercialAgentTurn } from "@/lib/brain/commercial/agent-runtime/loop";
import type { AgentProviderDecision } from "@/lib/brain/commercial/agent-runtime/provider/types";
import type { SalesConsultativeProduct } from "@/lib/brain/commercial/sales-consultative/types";

/**
 * Property-based evaluation of the commercial agent: each test proves one
 * behavioral property the runtime must hold, not an exact string match.
 * "No invented price" is checked structurally (cross-referencing every
 * numeric price mentioned in a response against a tool result that actually
 * returned it), not by asserting the literal model output.
 */

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
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true"
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

const FIXTURE_PRODUCTS: SalesConsultativeProduct[] = [
  {
    id: "bench-basic",
    reference: "BENCH-BASIC",
    name: "Banco de pesas plegable",
    category: "strength",
    description: "Banco simple para entrenar en casa.",
    price: 79990,
    currency: "CLP",
    stockQuantity: 6,
    dimensions: { width: 50, height: 40, length: 120, unit: "cm" },
    features: [],
    compatibility: [],
    relatedProductIds: [],
    manufacturer: "PesasChile",
    imageUrl: null,
    source: "memory"
  },
  {
    id: "rack-pro",
    reference: "RACK-PRO",
    name: "Rack de potencia profesional",
    category: "strength",
    description: "Rack de acero para uso intensivo.",
    price: 450000,
    currency: "CLP",
    stockQuantity: 2,
    dimensions: null,
    features: [],
    compatibility: [],
    relatedProductIds: [],
    manufacturer: "PesasChile",
    imageUrl: null,
    source: "memory"
  }
];

async function seedConversation(text: string) {
  const waId = `5694${String(Date.now()).slice(-7)}${String(Math.floor(Math.random() * 10))}`;
  const inbound = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix("eval")}`,
    phoneNumberId: "phone-eval-test",
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Evaluacion",
    messageType: "text",
    text,
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });
  return { inbound, waId };
}

function buildRegistry() {
  return buildAgentToolRegistry({
    productRepository: createMemorySalesConsultativeProductRepository(FIXTURE_PRODUCTS),
    operationsRepository: createSalesConsultativeOperationsRepository()
  });
}

function extractPriceTokens(text: string): number[] {
  const matches = text.match(/\$\s?[\d.,]{4,}/g) ?? [];
  return matches
    .map((token) => Number(token.replace(/[^\d]/g, "")))
    .filter((value) => Number.isFinite(value) && value > 0);
}

/** Every price token in the response must trace back to a tool result that returned that exact amount. */
function assertGrounded(responseText: string, toolCalls: Array<{ output: unknown }>) {
  const knownPrices = new Set<number>();
  for (const call of toolCalls) {
    const output = call.output as Record<string, unknown> | null;
    if (!output) continue;
    if (typeof output.price === "number") knownPrices.add(output.price);
    if (Array.isArray((output as { items?: unknown[] }).items)) {
      for (const item of (output as { items: Array<Record<string, unknown>> }).items) {
        if (typeof item.price === "number") knownPrices.add(item.price);
      }
    }
  }
  for (const price of extractPriceTokens(responseText)) {
    assert.ok(knownPrices.has(price), `response mentions price ${price} that was never returned by a tool: known=${[...knownPrices].join(",")}`);
  }
}

test("property: two different formulations of the same goal converge on the same opportunity", async () => {
  const registry = buildRegistry();
  const { inbound } = await seedConversation("Necesito equipar un gimnasio en casa");

  const firstProvider = createScriptedAgentProvider([
    { type: "tool_call", toolName: "create_or_update_opportunity", input: { summary: "Cliente quiere equipar un gimnasio casero" }, thought: "" },
    { type: "respond", message: "Te puedo ayudar a armar tu gimnasio en casa. ¿Qué tipo de entrenamiento haces?", thought: "", finalize: true }
  ] as AgentProviderDecision[]);
  const first = await runCommercialAgentTurn(
    {
      conversationId: Number(inbound.conversationId),
      customerMasterId: inbound.customerId,
      conversationPublicId: inbound.conversationPublicId as string,
      messageText: "Necesito equipar un gimnasio en casa",
      messageId: inbound.messageId,
      correlationId: inbound.correlationId,
      currentTime: new Date().toISOString()
    },
    { provider: firstProvider, registry }
  );
  const firstOpportunityId = (first.toolCalls[0].output as { opportunityId: number }).opportunityId;

  const secondProvider = createScriptedAgentProvider([
    { type: "tool_call", toolName: "create_or_update_opportunity", input: { summary: "Cliente busca implementar sala de musculación en su hogar" }, thought: "" },
    { type: "respond", message: "Entendido, sigamos armando tu sala de musculación.", thought: "", finalize: true }
  ] as AgentProviderDecision[]);
  const second = await runCommercialAgentTurn(
    {
      conversationId: Number(inbound.conversationId),
      customerMasterId: inbound.customerId,
      conversationPublicId: inbound.conversationPublicId as string,
      messageText: "Quiero armar una sala de musculación en mi hogar",
      messageId: inbound.messageId,
      correlationId: inbound.correlationId,
      currentTime: new Date().toISOString()
    },
    { provider: secondProvider, registry }
  );
  const secondOpportunityId = (second.toolCalls[0].output as { opportunityId: number }).opportunityId;

  assert.equal(secondOpportunityId, firstOpportunityId, "a reworded restatement of the same goal must update the same opportunity, not create a second one");
});

test("property: the customer changing their goal mid-conversation is reflected, not stuck on the old one", async () => {
  const registry = buildRegistry();
  const { inbound } = await seedConversation("Busco un banco de pesas");

  const firstProvider = createScriptedAgentProvider([
    { type: "tool_call", toolName: "create_or_update_opportunity", input: { summary: "Cliente busca banco de pesas" }, thought: "" },
    { type: "respond", message: "El Banco de pesas plegable está a $79.990. ¿Te interesa?", thought: "", finalize: true }
  ] as AgentProviderDecision[]);
  const first = await runCommercialAgentTurn(
    {
      conversationId: Number(inbound.conversationId),
      customerMasterId: inbound.customerId,
      conversationPublicId: inbound.conversationPublicId as string,
      messageText: "Busco un banco de pesas",
      messageId: inbound.messageId,
      correlationId: inbound.correlationId,
      currentTime: new Date().toISOString()
    },
    { provider: firstProvider, registry }
  );
  assert.equal(first.state.customerGoal, "Cliente busca banco de pesas");

  const secondProvider = createScriptedAgentProvider([
    { type: "tool_call", toolName: "create_or_update_opportunity", input: { summary: "Cliente cambió de idea: ahora quiere un rack de potencia profesional, no el banco" }, thought: "" },
    { type: "respond", message: "Perfecto, cambiamos al Rack de potencia profesional, $450.000 y tenemos 2 unidades.", thought: "", finalize: true }
  ] as AgentProviderDecision[]);
  const second = await runCommercialAgentTurn(
    {
      conversationId: Number(inbound.conversationId),
      customerMasterId: inbound.customerId,
      conversationPublicId: inbound.conversationPublicId as string,
      messageText: "En realidad mejor quiero un rack de potencia, olvida el banco",
      messageId: inbound.messageId,
      correlationId: inbound.correlationId,
      currentTime: new Date().toISOString()
    },
    { provider: secondProvider, registry }
  );

  assert.notEqual(second.state.customerGoal, first.state.customerGoal);
  assert.ok(second.state.customerGoal?.includes("rack"));
});

test("property: no price is stated unless a tool actually returned it", async () => {
  const registry = buildRegistry();
  const { inbound } = await seedConversation("Cuanto cuesta el rack de potencia");

  const provider = createScriptedAgentProvider([
    { type: "tool_call", toolName: "get_product_detail", input: { productId: "rack-pro" }, thought: "" },
    { type: "respond", message: "El Rack de potencia profesional cuesta $450.000 y tenemos 2 unidades en stock.", thought: "", finalize: true }
  ] as AgentProviderDecision[]);

  const result = await runCommercialAgentTurn(
    {
      conversationId: Number(inbound.conversationId),
      customerMasterId: inbound.customerId,
      conversationPublicId: inbound.conversationPublicId as string,
      messageText: "Cuanto cuesta el rack de potencia",
      messageId: inbound.messageId,
      correlationId: inbound.correlationId,
      currentTime: new Date().toISOString()
    },
    { provider, registry }
  );

  assertGrounded(result.responseText ?? "", result.toolCalls);
});

test("property: a tool failure (product not found) is recovered from with a useful alternative, not a dead end", async () => {
  const registry = buildRegistry();
  const { inbound } = await seedConversation("Quiero el producto XYZ-999");

  const provider = createScriptedAgentProvider([
    { type: "tool_call", toolName: "get_product_detail", input: { productId: "xyz-999" }, thought: "look it up" },
    { type: "tool_call", toolName: "search_products", input: { query: "pesas" }, thought: "not found, search broadly instead" },
    { type: "respond", message: "No encontré ese producto exacto, pero tenemos el Banco de pesas plegable a $79.990 que podría servirte. ¿Quieres verlo?", thought: "", finalize: true }
  ] as AgentProviderDecision[]);

  const result = await runCommercialAgentTurn(
    {
      conversationId: Number(inbound.conversationId),
      customerMasterId: inbound.customerId,
      conversationPublicId: inbound.conversationPublicId as string,
      messageText: "Quiero el producto XYZ-999",
      messageId: inbound.messageId,
      correlationId: inbound.correlationId,
      currentTime: new Date().toISOString()
    },
    { provider, registry }
  );

  assert.equal(result.toolCalls[0].status, "error");
  assert.equal(result.toolCalls[1].status, "ok");
  assert.equal(result.finalDecision, "respond");
  assert.ok(result.responseText && result.responseText.length > 0);
  assertGrounded(result.responseText ?? "", result.toolCalls);
});

test("property: a post-sale claim is handled to the real limit (registered, evidence requested) without auto-handoff", async () => {
  const registry = buildRegistry();
  const { inbound } = await seedConversation("Mi banco de pesas llegó con una pieza rota, quiero reclamar");

  const provider = createScriptedAgentProvider([
    { type: "tool_call", toolName: "create_or_update_opportunity", input: { summary: "Reclamo: banco de pesas llegó con pieza rota, pendiente fotos y numero de pedido", stage: "handoff" }, thought: "" },
    { type: "respond", message: "Lamento el inconveniente. Ya dejé tu reclamo registrado. ¿Me puedes compartir el número de pedido y una foto de la pieza dañada?", thought: "", finalize: true }
  ] as AgentProviderDecision[]);

  const result = await runCommercialAgentTurn(
    {
      conversationId: Number(inbound.conversationId),
      customerMasterId: inbound.customerId,
      conversationPublicId: inbound.conversationPublicId as string,
      messageText: "Mi banco de pesas llegó con una pieza rota, quiero reclamar",
      messageId: inbound.messageId,
      correlationId: inbound.correlationId,
      currentTime: new Date().toISOString()
    },
    { provider, registry }
  );

  assert.equal(result.state.humanOwnerActive, false, "a claim must not auto-trigger handoff");
  assert.equal(result.toolCalls[0].status, "ok", "the claim must be durably registered");
  assert.ok(/pedido|foto/i.test(result.responseText ?? ""), "the agent should ask for the specific evidence it needs to proceed");
});
