// SALES-AGENT-R3-V1.8-D3. Bounded read of conversation_message - the sole
// canonical human transcript (Section B/P of the task brief: conversation_message
// is the source of human transcript; agent_session_events is operational
// evidence only). Deliberately NOT loadNativeConversationDetailByPublicId
// (native-whatsapp/service.ts), which is unbounded (no LIMIT, full-history
// read then .slice(-12) in JS) - V1.8-D0 section 13 already found that query
// wrong for this purpose. This mirrors AgentSessionStore.loadRecentEvents'
// own bounded-DESC-then-reverse shape instead, and the same
// idx_message_conversation_created (conversation_id, created_at) index
// migrations/008_conversation_ai_runtime_core.sql already provides.

import type { RowDataPacket } from "mysql2/promise";
import { safeQueryRows } from "@/lib/db";

/** Same order of magnitude as AGENT_SESSION_DEFAULT_MAX_RECENT_EVENTS (store.ts) and COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES (constants.ts) - no larger default than this codebase's own established precedent. */
export const AGENT_SESSION_DEFAULT_MAX_TRANSCRIPT_MESSAGES = 20;
export const AGENT_SESSION_HARD_MAX_TRANSCRIPT_MESSAGES = 100;

export type ConversationTranscriptMessage = {
  /** conversation_message.id (numeric, as string) - NOT public_id. This is the same id AgentRuntimeEvent.messageId/inboundMessageId already carries (native-whatsapp/service.ts's appendConversationMessage returns this exact insertId), so a caller can exclude "the current turn's own message" by direct string equality. */
  id: string;
  /** 'inbound' | 'outbound' | 'system' (conversation control's own timeline rows, lib/domains/conversations/control.ts) - never filtered here, left to the caller (deriveMessages.ts only projects inbound/outbound as conversational history). */
  direction: string;
  body: string | null;
  createdAt: string;
};

type ConversationMessageRow = RowDataPacket & {
  id: number;
  direction: string;
  body: string | null;
  created_at: string | Date;
};

function asIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Ascending createdAt order (oldest first), matching every other bounded
 * reader in this module (loadRecentEvents). `maxMessages` is clamped to
 * AGENT_SESSION_HARD_MAX_TRANSCRIPT_MESSAGES regardless of what the caller
 * asks for - same discipline as AgentSessionStore.loadRecentEvents.
 */
export async function loadRecentConversationTranscript(
  conversationId: number,
  maxMessages: number = AGENT_SESSION_DEFAULT_MAX_TRANSCRIPT_MESSAGES
): Promise<ConversationTranscriptMessage[]> {
  const limit = Math.min(Math.max(1, maxMessages), AGENT_SESSION_HARD_MAX_TRANSCRIPT_MESSAGES);

  const result = await safeQueryRows<ConversationMessageRow>(
    `SELECT id, direction, body, created_at FROM conversation_message
     WHERE conversation_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    [conversationId, limit]
  );
  if (!result.ok) return [];

  return result.rows
    .map((row) => ({ id: String(row.id), direction: row.direction, body: row.body, createdAt: asIso(row.created_at) }))
    .reverse();
}
