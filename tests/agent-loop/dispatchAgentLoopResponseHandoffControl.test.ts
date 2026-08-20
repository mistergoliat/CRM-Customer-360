import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, safeQueryRows } from "@/lib/db";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";
import { dispatchAgentLoopResponse } from "@/lib/brain/commercial/agent-loop/dispatchAgentLoopResponse";
import type { AgentLoopResult } from "@/lib/brain/commercial/agent-loop/agentStepTypes";

/**
 * SALES-AGENT-R1 checkout-readiness audit, TASK_001. Before this fix, a
 * handoff decided by the model sent a generic acknowledgement but never
 * flipped human_owner_active/ai_enabled - the same customer's next inbound
 * reactivated the loop instead of reaching the human who was promised.
 */
Object.assign(process.env, {
  // SALES-AGENT-R2-A11: opens runNativeAutonomousCycle's new autonomy/access gates - unrelated to this file's own pre-A11 assertions.
  BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true",
  BRAIN_WHATSAPP_TEST_MODE_ENABLED: "false",
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "main_management",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true",
  BRAIN_META_SEND_ENABLED: "false",
  BRAIN_SALES_AGENT_ENABLED: "false",
  BRAIN_COMMERCIAL_SHADOW_ENABLED: "false",
  BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED: "false",
  BRAIN_AGENT_ACTION_QUEUE_ENABLED: "true",
  BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED: "true"
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

async function createConversation(label: string) {
  const waId = `5697${String(Date.now()).slice(-8)}`;
  const phoneNumberId = `phone-${uniqueSuffix(label)}`;
  const inbound = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix(label)}`,
    phoneNumberId,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Handoff",
    messageType: "text",
    text: "Hola, necesito ayuda con un pedido complejo.",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });
  assert.equal(inbound.duplicate, false);
  return {
    waId,
    conversationId: inbound.conversationId as number,
    conversationPublicId: inbound.conversationPublicId as string
  };
}

async function loadConversation(conversationId: number) {
  const result = await safeQueryRows<{ ai_enabled: number; human_owner_active: number }>(
    "SELECT ai_enabled, human_owner_active FROM conversation WHERE id = ? LIMIT 1",
    [conversationId]
  );
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.rows[0];
}

function buildLoop(overrides: Partial<AgentLoopResult>): AgentLoopResult {
  return {
    ran: true,
    terminalReason: "responded",
    steps: [],
    toolExecutionCount: 0,
    finalMessage: null,
    handoffReason: null,
    warnings: [],
    llmCalls: [],
    ...overrides
  };
}

test("TASK_001: a model-decided handoff durably takes human control before the acknowledgement is dispatched", async () => {
  const conv = await createConversation("handoff-control");

  const result = await dispatchAgentLoopResponse({
    conversationId: conv.conversationId,
    conversationCaseId: conv.conversationId,
    opportunityId: null,
    waId: conv.waId,
    inboundMessageId: `msg-${uniqueSuffix("handoff")}`,
    currentTime: new Date().toISOString(),
    humanOwnerActive: false,
    aiBlocked: false,
    caseStatus: "open",
    loop: buildLoop({ terminalReason: "handoff", handoffReason: "Cliente pide hablar con un humano." }),
    commercialNeed: { productQuery: null, usage: null, budgetMax: null, currency: null }
  });

  assert.equal(result.attempted, true);
  assert.ok(result.messageSent);

  const row = await loadConversation(conv.conversationId);
  assert.equal(Number(row.human_owner_active), 1, "handoff must leave the conversation under durable human control");
  assert.equal(Number(row.ai_enabled), 0, "handoff must disable the AI so the next inbound reaches the human, not the loop");
});

test("a non-handoff terminal reason (responded) never touches conversation control", async () => {
  const conv = await createConversation("no-handoff-control");

  await dispatchAgentLoopResponse({
    conversationId: conv.conversationId,
    conversationCaseId: conv.conversationId,
    opportunityId: null,
    waId: conv.waId,
    inboundMessageId: `msg-${uniqueSuffix("responded")}`,
    currentTime: new Date().toISOString(),
    humanOwnerActive: false,
    aiBlocked: false,
    caseStatus: "open",
    loop: buildLoop({ terminalReason: "responded", finalMessage: "Hola, en que te puedo ayudar" }),
    commercialNeed: { productQuery: null, usage: null, budgetMax: null, currency: null }
  });

  const row = await loadConversation(conv.conversationId);
  assert.equal(Number(row.human_owner_active), 0);
  assert.equal(Number(row.ai_enabled), 1);
});
