import { createHash } from "node:crypto";
import { safeQueryRows, withTransaction } from "@/lib/db";
import { sendMetaWhatsAppTextMessage } from "@/lib/brain/messaging/metaClient";
import { appendConversationMessage } from "@/lib/brain/local-ai-sdr/repository";
import { isConversationClosedStatus, isWhatsAppWindowOpen, takeHumanControlTx } from "./control";
import type { ConversationThreadMessage } from "./thread";

/**
 * Operator manual reply with atomic AI/human control transfer.
 *
 * A manual send must never race the autonomous agent. Before sending we, in one
 * transaction: (1) take human ownership (`human_owner_active=1`, `ai_enabled=0`)
 * and (2) cancel any pending auto-response in the outbox (planned/locked). Only
 * then do we (3) send via the gated Meta client and (4) persist the outbound
 * message with its real delivery status. This is resolved in the backend, never
 * in the frontend.
 */

type ConversationRowForReply = {
  id: number;
  public_id: string;
  external_contact_id: string;
  channel_account_id: string;
  provider: string | null;
  status: string;
  last_inbound_at: string | Date | null;
};

export type ConversationManualReplyResult =
  | { ok: false; code: string; message: string }
  | {
      ok: true;
      status: "sent" | "failed";
      providerMessageId: string | null;
      errorCode: string | null;
      errorMessage: string | null;
      threadMessage: ConversationThreadMessage;
    };

function toMysql(iso: string): string {
  return iso.slice(0, 19).replace("T", " ");
}

export async function sendConversationManualReply(input: {
  conversationPublicId: string;
  text: string;
  operatorName?: string | null;
  sendFn?: typeof sendMetaWhatsAppTextMessage;
}): Promise<ConversationManualReplyResult> {
  const text = input.text?.trim() ?? "";
  if (!text) return { ok: false, code: "empty_text", message: "El mensaje no puede estar vacío." };

  const convResult = await safeQueryRows<ConversationRowForReply>(
    "SELECT id, public_id, external_contact_id, channel_account_id, provider, status, last_inbound_at FROM conversation WHERE public_id = ? LIMIT 1",
    [input.conversationPublicId]
  );
  if (!convResult.ok) return { ok: false, code: "load_failed", message: convResult.error };
  const conversation = convResult.rows[0];
  if (!conversation) return { ok: false, code: "conversation_not_found", message: "Conversación no encontrada." };
  if (isConversationClosedStatus(conversation.status)) {
    return { ok: false, code: "conversation_closed", message: "La conversación está cerrada." };
  }
  if (!isWhatsAppWindowOpen(conversation.last_inbound_at)) {
    // Meta rejects free-form text outside the 24h customer window and templates
    // are not implemented yet, so the backend blocks the attempt up front.
    return { ok: false, code: "window_closed", message: "La ventana de 24 horas de WhatsApp está cerrada; no se puede enviar texto libre." };
  }

  const nowIso = new Date().toISOString();
  const nowSql = toMysql(nowIso);

  // (1)+(2) Atomic: take human control and invalidate pending auto-responses.
  await withTransaction(async (connection) => {
    await takeHumanControlTx(connection, conversation.id, nowSql);
  });

  // (3) Real send — the Meta client enforces the allowlist and send flags.
  const sendResult = await (input.sendFn ?? sendMetaWhatsAppTextMessage)({
    waId: conversation.external_contact_id,
    phoneNumberId: conversation.channel_account_id,
    messageText: text,
    source: "operator",
    conversationCaseId: conversation.id,
    metadata: { manualReply: true, operator: input.operatorName ?? null }
  });

  const sent = sendResult.ok && sendResult.status === "sent";
  const status: "sent" | "failed" = sent ? "sent" : "failed";
  const providerMessageId =
    sendResult.provider_message_id ??
    `manual-${createHash("sha256").update([conversation.id, nowIso, text].join("|")).digest("hex").slice(0, 24)}`;

  // (4) Persist the outbound message with its real status so the timeline reflects it.
  await appendConversationMessage({
    conversationPublicId: conversation.public_id,
    provider: conversation.provider || "meta",
    providerMessageId,
    direction: "outbound",
    senderType: "operator",
    body: text,
    status,
    occurredAt: nowIso
  });

  if (sent) {
    await safeQueryRows("UPDATE conversation SET last_message_at = ?, last_outbound_at = ?, updated_at = ? WHERE id = ?", [nowSql, nowSql, nowSql, conversation.id]);
  }

  return {
    ok: true,
    status,
    providerMessageId: sendResult.provider_message_id ?? null,
    errorCode: sent ? null : sendResult.error_code ?? "send_failed",
    errorMessage: sent ? null : sendResult.error_message ?? null,
    threadMessage: {
      key: `outbound-${providerMessageId}`,
      direction: "outbound",
      origin: "operator",
      operatorName: input.operatorName ?? null,
      body: text,
      state: status,
      occurredAt: nowIso,
      source: conversation.provider || "meta",
      providerMessageId: sendResult.provider_message_id ?? null
    }
  };
}
