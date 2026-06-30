import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, safeQueryRows } from "@/lib/db";
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
  DB_WRITE_ENABLED: "true",
  BRAIN_META_SEND_ENABLED: "false",
  BRAIN_OUTBOX_WORKER_ENABLED: "false"
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
    description: "Banco simple para entrenar en casa, se pliega para guardar.",
    price: 79990,
    currency: "CLP",
    stockQuantity: 6,
    dimensions: { width: 50, height: 40, length: 120, unit: "cm" },
    features: ["plegable", "ajustable"],
    compatibility: ["entrenamiento_casa"],
    relatedProductIds: ["mancuernas-set"],
    manufacturer: "PesasChile",
    imageUrl: null,
    source: "memory"
  },
  {
    id: "mancuernas-set",
    reference: "DUMBBELL-SET",
    name: "Set de mancuernas ajustables",
    category: "strength",
    description: "Set de mancuernas con discos intercambiables.",
    price: 65000,
    currency: "CLP",
    stockQuantity: 0,
    dimensions: null,
    features: ["ajustable"],
    compatibility: ["entrenamiento_casa"],
    relatedProductIds: ["bench-basic"],
    manufacturer: "PesasChile",
    imageUrl: null,
    source: "memory"
  }
];

async function seedConversation(text: string) {
  const waId = `5691${String(Date.now()).slice(-7)}${String(Math.floor(Math.random() * 10))}`;
  const inbound = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix("agent")}`,
    phoneNumberId: "phone-agent-test",
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Agente",
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

test("executes a real tool call, observes the result, and finalizes with a grounded response", async () => {
  const { inbound } = await seedConversation("Hola, busco un banco para entrenar en casa");
  const registry = buildRegistry();
  const provider = createScriptedAgentProvider([
    { type: "tool_call", toolName: "search_products", input: { query: "banco entrenar casa" }, thought: "look up real catalog data" },
    { type: "respond", message: "Tenemos el Banco de pesas plegable a $79.990, con 6 unidades en stock. ¿Te sirve para tu espacio?", thought: "grounded in tool result", finalize: true }
  ] as AgentProviderDecision[]);

  const result = await runCommercialAgentTurn(
    {
      conversationId: Number(inbound.conversationId),
      customerMasterId: inbound.customerId,
      conversationPublicId: inbound.conversationPublicId as string,
      messageText: "Hola, busco un banco para entrenar en casa",
      messageId: inbound.messageId,
      correlationId: inbound.correlationId,
      currentTime: new Date().toISOString()
    },
    { provider, registry }
  );

  assert.equal(result.finalDecision, "respond");
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].toolName, "search_products");
  assert.equal(result.toolCalls[0].status, "ok");
  assert.ok(result.responseText?.includes("79.990"));
});

test("uses more than one tool in a single turn before responding", async () => {
  const { inbound } = await seedConversation("Quiero comparar el banco con las mancuernas");
  const registry = buildRegistry();
  const provider = createScriptedAgentProvider([
    { type: "tool_call", toolName: "get_product_detail", input: { productId: "bench-basic" }, thought: "check the bench" },
    { type: "tool_call", toolName: "get_related_products", input: { productId: "bench-basic" }, thought: "see what else pairs with it" },
    { type: "respond", message: "El banco tiene 6 unidades en stock a $79.990; también tenemos mancuernas que combinan bien, aunque están sin stock por ahora. ¿Prefieres que te avise cuando vuelvan?", thought: "compared both", finalize: true }
  ] as AgentProviderDecision[]);

  const result = await runCommercialAgentTurn(
    {
      conversationId: Number(inbound.conversationId),
      customerMasterId: inbound.customerId,
      conversationPublicId: inbound.conversationPublicId as string,
      messageText: "Quiero comparar el banco con las mancuernas",
      messageId: inbound.messageId,
      correlationId: inbound.correlationId,
      currentTime: new Date().toISOString()
    },
    { provider, registry }
  );

  const toolNames = new Set(result.toolCalls.map((call) => call.toolName));
  assert.ok(toolNames.size >= 2, "expected more than one distinct tool to be used in the turn");
  assert.equal(result.toolCalls.every((call) => call.status === "ok"), true);
});

test("denies a tool call with missing required arguments and lets the agent recover", async () => {
  const { inbound } = await seedConversation("Quiero crear una oportunidad");
  const registry = buildRegistry();
  const provider = createScriptedAgentProvider([
    { type: "tool_call", toolName: "create_or_update_opportunity", input: {}, thought: "forgot the summary" },
    { type: "tool_call", toolName: "create_or_update_opportunity", input: { summary: "Cliente interesado en banco de pesas, presupuesto 80000" }, thought: "retry with the missing field" },
    { type: "respond", message: "Dejé registrado tu interés en el banco de pesas. ¿Quieres que te muestre alternativas también?", thought: "confirm to customer", finalize: true }
  ] as AgentProviderDecision[]);

  const result = await runCommercialAgentTurn(
    {
      conversationId: Number(inbound.conversationId),
      customerMasterId: inbound.customerId,
      conversationPublicId: inbound.conversationPublicId as string,
      messageText: "Quiero crear una oportunidad",
      messageId: inbound.messageId,
      correlationId: inbound.correlationId,
      currentTime: new Date().toISOString()
    },
    { provider, registry }
  );

  assert.equal(result.toolCalls[0].status, "denied");
  assert.equal(result.toolCalls[1].status, "ok");
  assert.equal(result.finalDecision, "respond_and_act");
  assert.equal(result.state.customerGoal, "Cliente interesado en banco de pesas, presupuesto 80000");
});

test("maintains continuity across turns: the second turn sees the first turn's state", async () => {
  const { inbound, waId } = await seedConversation("Busco algo para entrenar en casa, mi presupuesto es 80 mil");
  const registry = buildRegistry();
  const conversationId = Number(inbound.conversationId);
  const conversationPublicId = inbound.conversationPublicId as string;

  const firstProvider = createScriptedAgentProvider([
    { type: "tool_call", toolName: "create_or_update_opportunity", input: { summary: "Cliente busca equipo para entrenar en casa, presupuesto 80000" }, thought: "register the goal" },
    { type: "respond", message: "Perfecto, con ese presupuesto el Banco de pesas plegable a $79.990 calza bien. ¿Te gustaría verlo?", thought: "recommend", finalize: true }
  ] as AgentProviderDecision[]);

  const first = await runCommercialAgentTurn(
    {
      conversationId,
      customerMasterId: inbound.customerId,
      conversationPublicId,
      messageText: "Busco algo para entrenar en casa, mi presupuesto es 80 mil",
      messageId: inbound.messageId,
      correlationId: inbound.correlationId,
      currentTime: new Date().toISOString()
    },
    { provider: firstProvider, registry }
  );
  assert.equal(first.state.customerGoal, "Cliente busca equipo para entrenar en casa, presupuesto 80000");

  const secondMessage = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix("agent-turn2")}`,
    phoneNumberId: "phone-agent-test",
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Agente",
    messageType: "text",
    text: "Si, muéstrame el banco",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });

  const secondProvider = createScriptedAgentProvider([
    {
      type: "respond",
      message: "Claro, el Banco de pesas plegable cuesta $79.990 y tenemos 6 unidades disponibles ahora mismo.",
      thought: "already know the goal and product from state, no need to re-search",
      finalize: true
    }
  ] as AgentProviderDecision[]);

  const second = await runCommercialAgentTurn(
    {
      conversationId,
      customerMasterId: inbound.customerId,
      conversationPublicId,
      messageText: "Si, muéstrame el banco",
      messageId: secondMessage.messageId,
      correlationId: secondMessage.correlationId,
      currentTime: new Date().toISOString()
    },
    { provider: secondProvider, registry }
  );

  assert.equal(second.state.customerGoal, "Cliente busca equipo para entrenar en casa, presupuesto 80000");
  assert.equal(second.state.turnCount, 2);
});

test("repeating the same opportunity action does not create a duplicate row (idempotent)", async () => {
  const { inbound } = await seedConversation("Quiero el banco de pesas");
  const registry = buildRegistry();
  const summary = "Cliente decidido a comprar el banco de pesas";

  const provider = createScriptedAgentProvider([
    { type: "tool_call", toolName: "create_or_update_opportunity", input: { summary }, thought: "first" },
    { type: "tool_call", toolName: "create_or_update_opportunity", input: { summary }, thought: "repeat the same intent" },
    { type: "respond", message: "Listo, dejé tu pedido registrado.", thought: "confirm", finalize: true }
  ] as AgentProviderDecision[]);

  const result = await runCommercialAgentTurn(
    {
      conversationId: Number(inbound.conversationId),
      customerMasterId: inbound.customerId,
      conversationPublicId: inbound.conversationPublicId as string,
      messageText: "Quiero el banco de pesas",
      messageId: inbound.messageId,
      correlationId: inbound.correlationId,
      currentTime: new Date().toISOString()
    },
    { provider, registry }
  );

  assert.equal(result.toolCalls.filter((call) => call.status === "ok").length, 2);
  const opportunityId = (result.toolCalls[0].output as { opportunityId: number }).opportunityId;
  const rows = await safeQueryRows<{ total: number }>("SELECT COUNT(*) AS total FROM crm_opportunities WHERE id = ?", [opportunityId]);
  assert.ok(rows.ok);
  assert.equal(rows.rows[0]?.total, 1);
});

test("a request to talk to a human does not stop the agent from continuing to help in the same turn", async () => {
  const { inbound } = await seedConversation("Quiero hablar con una persona");
  const registry = buildRegistry();
  const provider = createScriptedAgentProvider([
    {
      type: "respond",
      message: "Puedo ayudarte ahora mismo y, si no logramos resolverlo, dejo todo listo para una persona. ¿Qué necesitas solucionar?",
      thought: "do not auto-handoff on a bare request, keep helping",
      finalize: true
    }
  ] as AgentProviderDecision[]);

  const result = await runCommercialAgentTurn(
    {
      conversationId: Number(inbound.conversationId),
      customerMasterId: inbound.customerId,
      conversationPublicId: inbound.conversationPublicId as string,
      messageText: "Quiero hablar con una persona",
      messageId: inbound.messageId,
      correlationId: inbound.correlationId,
      currentTime: new Date().toISOString()
    },
    { provider, registry }
  );

  assert.equal(result.finalDecision, "respond");
  assert.equal(result.state.humanOwnerActive, false);
  assert.ok(result.responseText && !/transferenc/i.test(result.responseText));
});

test("a claim/post-sale message is registered as an action, not auto-blocked", async () => {
  const { inbound } = await seedConversation("El producto llegó dañado, quiero hacer un reclamo");
  const registry = buildRegistry();
  const provider = createScriptedAgentProvider([
    { type: "tool_call", toolName: "create_or_update_opportunity", input: { summary: "Reclamo: producto llegó dañado, pendiente de fotos", stage: "handoff" }, thought: "register the claim" },
    { type: "respond", message: "Lamento el inconveniente. Dejé tu reclamo registrado. ¿Puedes enviarme una foto del producto y el número de pedido?", thought: "keep helping, ask for evidence", finalize: true }
  ] as AgentProviderDecision[]);

  const result = await runCommercialAgentTurn(
    {
      conversationId: Number(inbound.conversationId),
      customerMasterId: inbound.customerId,
      conversationPublicId: inbound.conversationPublicId as string,
      messageText: "El producto llegó dañado, quiero hacer un reclamo",
      messageId: inbound.messageId,
      correlationId: inbound.correlationId,
      currentTime: new Date().toISOString()
    },
    { provider, registry }
  );

  assert.equal(result.finalDecision, "respond_and_act");
  assert.equal(result.state.humanOwnerActive, false);
  assert.equal(result.toolCalls[0].status, "ok");
});

test("an exclusive handoff blocks further durable actions but the conversation stays readable", async () => {
  const { inbound } = await seedConversation("Necesito una excepción de garantía especial");
  const registry = buildRegistry();
  const provider = createScriptedAgentProvider([
    { type: "handoff", reason: "Requires a policy exception only a human can grant", message: "Voy a derivar esto a una persona del equipo para que revise tu caso.", mode: "exclusive_handoff" }
  ] as AgentProviderDecision[]);

  const result = await runCommercialAgentTurn(
    {
      conversationId: Number(inbound.conversationId),
      customerMasterId: inbound.customerId,
      conversationPublicId: inbound.conversationPublicId as string,
      messageText: "Necesito una excepción de garantía especial",
      messageId: inbound.messageId,
      correlationId: inbound.correlationId,
      currentTime: new Date().toISOString()
    },
    { provider, registry }
  );

  assert.equal(result.finalDecision, "handoff");
  assert.equal(result.state.humanOwnerActive, true);
  assert.equal(result.state.handoffMode, "exclusive_handoff");

  const followUpRegistry = buildRegistry();
  const followUpProvider = createScriptedAgentProvider([
    { type: "tool_call", toolName: "create_or_update_opportunity", input: { summary: "intento tras handoff" }, thought: "should be denied" },
    { type: "respond", message: "Tu caso sigue con la persona asignada; te aviso apenas tenga novedades.", thought: "cannot act, but can still inform", finalize: true }
  ] as AgentProviderDecision[]);

  const followUp = await runCommercialAgentTurn(
    {
      conversationId: Number(inbound.conversationId),
      customerMasterId: inbound.customerId,
      conversationPublicId: inbound.conversationPublicId as string,
      messageText: "¿Alguna novedad?",
      messageId: inbound.messageId,
      correlationId: inbound.correlationId,
      currentTime: new Date().toISOString()
    },
    { provider: followUpProvider, registry: followUpRegistry }
  );
  assert.equal(followUp.toolCalls[0].status, "denied");
});

test("malformed provider output is recovered from instead of crashing the turn", async () => {
  const { inbound } = await seedConversation("hola");
  const registry = buildRegistry();
  let calls = 0;
  const provider = createScriptedAgentProvider([
    { type: "malformed", raw: "not json", error: "invalid_json" },
    { type: "respond", message: "Hola, ¿en qué puedo ayudarte hoy?", thought: "recovered", finalize: true }
  ] as AgentProviderDecision[]);
  void calls;

  const result = await runCommercialAgentTurn(
    {
      conversationId: Number(inbound.conversationId),
      customerMasterId: inbound.customerId,
      conversationPublicId: inbound.conversationPublicId as string,
      messageText: "hola",
      messageId: inbound.messageId,
      correlationId: inbound.correlationId,
      currentTime: new Date().toISOString()
    },
    { provider, registry }
  );

  assert.equal(result.finalDecision, "respond");
  assert.ok(result.warnings.some((warning) => warning.startsWith("malformed_provider_output")));
});

test("hitting the iteration limit ends in a safe, honest exit instead of looping forever", async () => {
  const { inbound } = await seedConversation("hola");
  const registry = buildRegistry();
  const provider = createScriptedAgentProvider(
    Array.from({ length: 10 }, () => ({ type: "tool_call", toolName: "search_products", input: { query: "x" }, thought: "loop" }) as AgentProviderDecision)
  );

  const result = await runCommercialAgentTurn(
    {
      conversationId: Number(inbound.conversationId),
      customerMasterId: inbound.customerId,
      conversationPublicId: inbound.conversationPublicId as string,
      messageText: "hola",
      messageId: inbound.messageId,
      correlationId: inbound.correlationId,
      currentTime: new Date().toISOString()
    },
    { provider, registry, maxIterations: 3 }
  );

  assert.equal(result.iterations, 3);
  assert.equal(result.finalDecision, "blocked_no_progress");
  assert.ok(result.responseText && result.responseText.length > 0);
  assert.ok(result.warnings.includes("max_iterations_reached"));
});
