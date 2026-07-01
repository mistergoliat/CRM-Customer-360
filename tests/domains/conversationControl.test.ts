import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, safeQueryRows } from "@/lib/db";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";
import { applyConversationControl, isWhatsAppWindowOpen } from "@/lib/domains/conversations/control";
import { sendConversationManualReply } from "@/lib/domains/conversations/manual-reply";

Object.assign(process.env, {
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
  BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED: "false"
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
    senderName: "Cliente Control",
    messageType: "text",
    text: "Hola, quiero cotizar.",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });
  assert.equal(inbound.duplicate, false);
  return {
    waId,
    phoneNumberId,
    conversationId: inbound.conversationId as number,
    conversationPublicId: inbound.conversationPublicId as string
  };
}

async function loadConversation(conversationId: number) {
  const result = await safeQueryRows<{ status: string; ai_enabled: number; human_owner_active: number }>(
    "SELECT status, ai_enabled, human_owner_active FROM conversation WHERE id = ? LIMIT 1",
    [conversationId]
  );
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.rows[0];
}

test("escenario C: take → human, release → ai, pause → paused; each transition is authoritative in DB", async () => {
  const conv = await createConversation("transitions");

  const take = await applyConversationControl({ conversationPublicId: conv.conversationPublicId, action: "take", operatorName: "Ana" });
  assert.ok(take.ok, take.ok ? "" : take.message);
  assert.equal(take.controlMode, "human");
  let row = await loadConversation(conv.conversationId);
  assert.equal(Number(row.human_owner_active), 1);
  assert.equal(Number(row.ai_enabled), 0);

  const release = await applyConversationControl({ conversationPublicId: conv.conversationPublicId, action: "release", operatorName: "Ana" });
  assert.ok(release.ok, release.ok ? "" : release.message);
  assert.equal(release.controlMode, "ai_autonomous");
  row = await loadConversation(conv.conversationId);
  assert.equal(Number(row.human_owner_active), 0);
  assert.equal(Number(row.ai_enabled), 1);

  const pause = await applyConversationControl({ conversationPublicId: conv.conversationPublicId, action: "pause" });
  assert.ok(pause.ok, pause.ok ? "" : pause.message);
  assert.equal(pause.controlMode, "paused");
  row = await loadConversation(conv.conversationId);
  assert.equal(Number(row.human_owner_active), 0);
  assert.equal(Number(row.ai_enabled), 0);

  // Control events are visible in the timeline as system messages.
  const systemEvents = await safeQueryRows<{ total: number }>(
    "SELECT COUNT(*) AS total FROM conversation_message WHERE conversation_id = ? AND direction = 'system'",
    [conv.conversationId]
  );
  assert.ok(systemEvents.ok);
  assert.ok(Number(systemEvents.rows[0].total) >= 3);
});

test("escenario C7: a new inbound NEVER hands control back to the AI", async () => {
  const conv = await createConversation("preserve");

  const take = await applyConversationControl({ conversationPublicId: conv.conversationPublicId, action: "take", operatorName: "Ana" });
  assert.ok(take.ok);

  // The customer replies while the operator holds the conversation.
  const secondInbound = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix("preserve-2")}`,
    phoneNumberId: conv.phoneNumberId,
    externalSenderId: conv.waId,
    senderPhone: conv.waId,
    senderName: "Cliente Control",
    messageType: "text",
    text: "¿Sigues ahí?",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });
  assert.equal(secondInbound.duplicate, false);
  assert.equal(secondInbound.conversationId, conv.conversationId, "must reuse the same conversation");

  const row = await loadConversation(conv.conversationId);
  assert.equal(Number(row.human_owner_active), 1, "human ownership must survive a new inbound");
  assert.equal(Number(row.ai_enabled), 0, "AI must stay disabled after a new inbound");
});

test("escenario I: close blocks sends; a new inbound reopens the conversation", async () => {
  const conv = await createConversation("closing");

  const close = await applyConversationControl({ conversationPublicId: conv.conversationPublicId, action: "close" });
  assert.ok(close.ok, close.ok ? "" : close.message);
  assert.equal(close.status, "closed");

  // Manual reply on a closed conversation is rejected by the backend.
  const reply = await sendConversationManualReply({ conversationPublicId: conv.conversationPublicId, text: "hola" });
  assert.equal(reply.ok, false);
  assert.equal(reply.ok ? "" : reply.code, "conversation_closed");

  // Double close is rejected.
  const closeAgain = await applyConversationControl({ conversationPublicId: conv.conversationPublicId, action: "close" });
  assert.equal(closeAgain.ok, false);

  // New inbound reopens it.
  const reopenInbound = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix("reopen")}`,
    phoneNumberId: conv.phoneNumberId,
    externalSenderId: conv.waId,
    senderPhone: conv.waId,
    senderName: "Cliente Control",
    messageType: "text",
    text: "Volví, ¿me ayudas?",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });
  assert.equal(reopenInbound.duplicate, false);
  const row = await loadConversation(conv.conversationId);
  assert.equal(row.status, "open", "inbound must reopen a closed conversation");

  // Manual reopen/close via the endpoint-facing domain also works.
  const close2 = await applyConversationControl({ conversationPublicId: conv.conversationPublicId, action: "close" });
  assert.ok(close2.ok);
  const reopen = await applyConversationControl({ conversationPublicId: conv.conversationPublicId, action: "reopen" });
  assert.ok(reopen.ok);
  assert.equal(reopen.ok ? reopen.status : "", "open");
});

test("escenario H: manual reply outside the 24h window is rejected by the backend", async () => {
  const conv = await createConversation("manual-window");
  await safeQueryRows("UPDATE conversation SET last_inbound_at = DATE_SUB(NOW(3), INTERVAL 25 HOUR) WHERE id = ?", [conv.conversationId]);

  const reply = await sendConversationManualReply({ conversationPublicId: conv.conversationPublicId, text: "hola" });
  assert.equal(reply.ok, false);
  assert.equal(reply.ok ? "" : reply.code, "window_closed");
});

test("manual reply takes control atomically and persists the operator message", async () => {
  const conv = await createConversation("manual-send");

  const providerMessageId = `wamid.${uniqueSuffix("manual")}`;
  const reply = await sendConversationManualReply({
    conversationPublicId: conv.conversationPublicId,
    text: "Hola, te atiende Ana.",
    operatorName: "Ana",
    sendFn: async () =>
      ({
        ok: true,
        status: "sent",
        error_code: null,
        error_message: null,
        blocked_reasons: [],
        warnings: [],
        http_status: 200,
        provider_message_id: providerMessageId,
        meta_payload_preview: null,
        response_body: null
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any
  });
  assert.ok(reply.ok);
  assert.equal(reply.ok ? reply.status : "", "sent");

  const row = await loadConversation(conv.conversationId);
  assert.equal(Number(row.human_owner_active), 1);
  assert.equal(Number(row.ai_enabled), 0);

  const message = await safeQueryRows<{ direction: string; sender_type: string; status: string }>(
    "SELECT direction, sender_type, status FROM conversation_message WHERE provider_message_id = ? LIMIT 1",
    [providerMessageId]
  );
  assert.ok(message.ok);
  assert.equal(message.rows.length, 1);
  assert.equal(message.rows[0].direction, "outbound");
  assert.equal(message.rows[0].sender_type, "operator");
  assert.equal(message.rows[0].status, "sent");
});

test("window helper: open within 24h of last inbound, closed after", () => {
  const now = Date.now();
  assert.equal(isWhatsAppWindowOpen(new Date(now - 60 * 60 * 1000).toISOString(), now), true);
  assert.equal(isWhatsAppWindowOpen(new Date(now - 25 * 60 * 60 * 1000).toISOString(), now), false);
  assert.equal(isWhatsAppWindowOpen(null, now), false);
  assert.equal(isWhatsAppWindowOpen("2024-01-01 10:00:00", new Date("2024-01-01T11:00:00Z").getTime()), true);
});
