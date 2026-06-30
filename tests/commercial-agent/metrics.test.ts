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
import { computeAgentRuntimeMetrics } from "@/lib/brain/commercial/agent-runtime/metrics";
import type { AgentProviderDecision } from "@/lib/brain/commercial/agent-runtime/provider/types";

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

test("computeAgentRuntimeMetrics reflects real recorded turns since a given timestamp", async () => {
  const since = new Date().toISOString();
  const registry = buildAgentToolRegistry({
    productRepository: createMemorySalesConsultativeProductRepository([]),
    operationsRepository: createSalesConsultativeOperationsRepository()
  });

  const waId = `5695${String(Date.now()).slice(-7)}`;
  const inbound = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.metrics-${Date.now()}`,
    phoneNumberId: "phone-metrics-test",
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Metricas",
    messageType: "text",
    text: "hola",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });

  const provider = createScriptedAgentProvider([
    { type: "respond", message: "Hola, ¿en qué te ayudo?", thought: "", finalize: true }
  ] as AgentProviderDecision[]);

  await runCommercialAgentTurn(
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

  const metrics = await computeAgentRuntimeMetrics(since);
  assert.ok(metrics.totalTurns >= 1);
  assert.ok(metrics.autonomousResolutionRate !== null && metrics.autonomousResolutionRate > 0);
  assert.equal(metrics.humanTransferRate !== null && metrics.humanTransferRate < 1, true);
});
