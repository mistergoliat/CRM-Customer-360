import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { safeQueryRows, withTransaction } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { appendConversationMessage } from "@/lib/brain/local-ai-sdr/repository";
import { deriveAiControlMode, type AiControlMode } from "./thread";

/**
 * Canonical conversation control transitions.
 *
 * The single source of truth for "who can act" is the `conversation` row
 * (`ai_enabled`, `human_owner_active`, `status`), mirrored onto the active
 * `crm_opportunities` row so plan-time gates (execution gate, follow-up
 * planner, sandbox) see the same state. Every transition that removes the AI's
 * right to send also cancels its pending outbox rows IN THE SAME TRANSACTION,
 * so a takeover is atomic with respect to queued auto-responses.
 */

export type ConversationControlAction = "take" | "release" | "pause" | "close" | "reopen";

export type ConversationControlResult =
  | { ok: false; code: string; message: string }
  | { ok: true; action: ConversationControlAction; controlMode: AiControlMode; status: string; cancelledOutbox: number };

const CLOSED_STATUSES = ["closed", "resolved", "done", "archived"];

export function isConversationClosedStatus(status: string | null | undefined): boolean {
  return CLOSED_STATUSES.includes((status ?? "").trim().toLowerCase());
}

/**
 * Meta's 24h customer-service window opens with the last CUSTOMER (inbound)
 * message. Free-form text outside it will be rejected by Meta, so the backend
 * blocks it up front (templates are not implemented yet).
 */
export function isWhatsAppWindowOpen(lastInboundAt: unknown, now = Date.now()): boolean {
  if (lastInboundAt === null || lastInboundAt === undefined) return false;
  let ms: number;
  if (lastInboundAt instanceof Date) ms = lastInboundAt.getTime();
  else if (typeof lastInboundAt === "number") ms = new Date(lastInboundAt).getTime();
  else if (typeof lastInboundAt === "string") {
    const text = lastInboundAt.trim();
    if (!text) return false;
    ms = new Date(text.includes("T") ? text : `${text.replace(" ", "T")}Z`).getTime();
  } else return false;
  if (Number.isNaN(ms)) return false;
  return now - ms < 24 * 60 * 60 * 1000;
}

function toMysql(iso: string): string {
  return iso.slice(0, 19).replace("T", " ");
}

type ControlConversationRow = {
  id: number;
  public_id: string;
  status: string;
  ai_enabled: number | string;
  human_owner_active: number | string;
  last_inbound_at: string | Date | null;
};

function toBool(value: number | string): boolean {
  if (typeof value === "number") return value !== 0;
  const t = value.trim().toLowerCase();
  return t !== "" && t !== "0" && t !== "false";
}

/**
 * Cancel every pending autonomous send for the conversation: outbox rows not
 * yet terminal ('planned' waiting for a worker, 'locked' claimed but unsent)
 * plus their still-pending source actions. Runs inside the caller's
 * transaction so it is atomic with the ownership flip.
 */
export async function cancelPendingAutonomousSendsTx(
  connection: PoolConnection,
  conversationId: number,
  nowSql: string,
  reason: string
): Promise<number> {
  const [outboxResult] = await connection.execute(
    `UPDATE brain_message_outbox
      SET status = 'cancelled', error_code = ?, failed_at = ?, updated_at = ?
      WHERE conversation_case_id = ? AND status IN ('planned','locked')`,
    [reason, nowSql, nowSql, conversationId]
  );
  await connection.execute(
    `UPDATE crm_agent_actions
      SET status = 'cancelled', cancel_reason = ?, updated_at = ?
      WHERE conversation_case_id = ? AND status IN ('proposed','planned')
        AND action_type IN ('send_whatsapp_reply','request_more_context')`,
    [reason, nowSql, conversationId]
  );
  return (outboxResult as { affectedRows?: number }).affectedRows ?? 0;
}

/** Atomic human takeover: flip ownership + cancel pending auto-responses. */
export async function takeHumanControlTx(connection: PoolConnection, conversationId: number, nowSql: string): Promise<number> {
  await connection.execute(
    "UPDATE conversation SET human_owner_active = 1, ai_enabled = 0, updated_at = ? WHERE id = ?",
    [nowSql, conversationId]
  );
  await connection.execute(
    "UPDATE crm_opportunities SET human_owner_active = 1, updated_at = ? WHERE conversation_case_id = ?",
    [nowSql, String(conversationId)]
  );
  return cancelPendingAutonomousSendsTx(connection, conversationId, nowSql, "superseded_by_operator");
}

const SYSTEM_EVENT_LABEL: Record<ConversationControlAction, string> = {
  take: "El operador tomó el control de la conversación.",
  release: "El operador devolvió el control a la IA.",
  pause: "La automatización fue pausada.",
  close: "La conversación fue cerrada.",
  reopen: "La conversación fue reabierta."
};

export async function applyConversationControl(input: {
  conversationPublicId: string;
  action: ConversationControlAction;
  operatorName?: string | null;
}): Promise<ConversationControlResult> {
  const convResult = await safeQueryRows<ControlConversationRow>(
    "SELECT id, public_id, status, ai_enabled, human_owner_active, last_inbound_at FROM conversation WHERE public_id = ? LIMIT 1",
    [input.conversationPublicId]
  );
  if (!convResult.ok) return { ok: false, code: "load_failed", message: convResult.error };
  const conversation = convResult.rows[0];
  if (!conversation) return { ok: false, code: "conversation_not_found", message: "Conversación no encontrada." };

  const closed = isConversationClosedStatus(conversation.status);
  if (input.action === "reopen" && !closed) {
    return { ok: false, code: "not_closed", message: "La conversación no está cerrada." };
  }
  if (input.action === "close" && closed) {
    return { ok: false, code: "already_closed", message: "La conversación ya está cerrada." };
  }
  if ((input.action === "take" || input.action === "release" || input.action === "pause") && closed) {
    return { ok: false, code: "conversation_closed", message: "La conversación está cerrada." };
  }

  const nowIso = new Date().toISOString();
  const nowSql = toMysql(nowIso);
  let cancelledOutbox = 0;
  let nextStatus = conversation.status;
  let aiEnabled = toBool(conversation.ai_enabled);
  let humanOwnerActive = toBool(conversation.human_owner_active);

  await withTransaction(async (connection) => {
    switch (input.action) {
      case "take":
        cancelledOutbox = await takeHumanControlTx(connection, conversation.id, nowSql);
        aiEnabled = false;
        humanOwnerActive = true;
        break;
      case "release":
        await connection.execute(
          "UPDATE conversation SET human_owner_active = 0, ai_enabled = 1, updated_at = ? WHERE id = ?",
          [nowSql, conversation.id]
        );
        await connection.execute(
          "UPDATE crm_opportunities SET human_owner_active = 0, ai_blocked = 0, updated_at = ? WHERE conversation_case_id = ?",
          [nowSql, String(conversation.id)]
        );
        aiEnabled = true;
        humanOwnerActive = false;
        break;
      case "pause":
        await connection.execute(
          "UPDATE conversation SET human_owner_active = 0, ai_enabled = 0, updated_at = ? WHERE id = ?",
          [nowSql, conversation.id]
        );
        await connection.execute(
          "UPDATE crm_opportunities SET ai_blocked = 1, updated_at = ? WHERE conversation_case_id = ?",
          [nowSql, String(conversation.id)]
        );
        cancelledOutbox = await cancelPendingAutonomousSendsTx(connection, conversation.id, nowSql, "ai_paused");
        aiEnabled = false;
        humanOwnerActive = false;
        break;
      case "close":
        await connection.execute("UPDATE conversation SET status = 'closed', updated_at = ? WHERE id = ?", [nowSql, conversation.id]);
        cancelledOutbox = await cancelPendingAutonomousSendsTx(connection, conversation.id, nowSql, "conversation_closed");
        nextStatus = "closed";
        break;
      case "reopen":
        await connection.execute("UPDATE conversation SET status = 'open', updated_at = ? WHERE id = ?", [nowSql, conversation.id]);
        nextStatus = "open";
        break;
    }
  });

  // Timeline system event + audit trail (best-effort; the transition already committed).
  await appendConversationMessage({
    conversationPublicId: conversation.public_id,
    provider: "hub",
    providerMessageId: `control-${randomUUID()}`,
    direction: "system",
    senderType: "system",
    messageType: "system",
    body: input.operatorName ? `${SYSTEM_EVENT_LABEL[input.action]} (${input.operatorName})` : SYSTEM_EVENT_LABEL[input.action],
    status: "received",
    occurredAt: nowIso
  }).catch(() => void 0);

  await auditLog({
    action: `conversation.control.${input.action}`,
    entityType: "conversation",
    entityId: conversation.id,
    after: {
      operator: input.operatorName ?? null,
      aiEnabled,
      humanOwnerActive,
      status: nextStatus,
      cancelledOutbox
    }
  });

  return {
    ok: true,
    action: input.action,
    controlMode: deriveAiControlMode(aiEnabled, humanOwnerActive),
    status: nextStatus,
    cancelledOutbox
  };
}
