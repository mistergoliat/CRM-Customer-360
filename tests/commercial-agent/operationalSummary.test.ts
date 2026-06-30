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
import { buildAgentOperationalView } from "@/lib/brain/commercial/agent-runtime/operationalSummary";
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
  DB_WRITE_ENABLED: "true"
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

const FIXTURE_PRODUCTS: SalesConsultativeProduct[] = [
  {
    id: "bench-basic",
    reference: "BENCH-BASIC",
    name: "Banco de pesas plegable",
    category: "strength",
    description: "Banco simple.",
    price: 79990,
    currency: "CLP",
    stockQuantity: 6,
    dimensions: null,
    features: [],
    compatibility: [],
    relatedProductIds: [],
    manufacturer: "PesasChile",
    imageUrl: null,
    source: "memory"
  }
];

test("the operational view summarizes tool usage in plain operator language, not chain-of-thought", async () => {
  const waId = `5693${String(Date.now()).slice(-7)}`;
  const inbound = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.summary-${Date.now()}`,
    phoneNumberId: "phone-summary-test",
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Resumen",
    messageType: "text",
    text: "Busco un banco de pesas",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });

  const registry = buildAgentToolRegistry({
    productRepository: createMemorySalesConsultativeProductRepository(FIXTURE_PRODUCTS),
    operationsRepository: createSalesConsultativeOperationsRepository()
  });
  const provider = createScriptedAgentProvider([
    { type: "tool_call", toolName: "search_products", input: { query: "banco" }, thought: "this internal reasoning must never leak to the operator view" },
    { type: "tool_call", toolName: "create_or_update_opportunity", input: { summary: "Cliente interesado en banco de pesas" }, thought: "internal" },
    { type: "respond", message: "Te recomiendo el Banco de pesas plegable a $79.990.", thought: "internal", finalize: true }
  ] as AgentProviderDecision[]);

  await runCommercialAgentTurn(
    {
      conversationId: Number(inbound.conversationId),
      customerMasterId: inbound.customerId,
      conversationPublicId: inbound.conversationPublicId as string,
      messageText: "Busco un banco de pesas",
      messageId: inbound.messageId,
      correlationId: inbound.correlationId,
      currentTime: new Date().toISOString()
    },
    { provider, registry }
  );

  const view = await buildAgentOperationalView(Number(inbound.conversationId));
  assert.ok(view.state);
  assert.equal(view.state?.customerGoal, "Cliente interesado en banco de pesas");
  assert.equal(view.turns.length, 1);
  assert.deepEqual(view.turns[0].lines, ["Consultó catálogo (\"banco\").", "Creó o actualizó una oportunidad comercial."]);
  for (const line of view.turns[0].lines) {
    assert.equal(line.includes("internal"), false, "operator summary must not leak raw model reasoning");
  }
});
