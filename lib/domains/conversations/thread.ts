import { safeQueryRows } from "@/lib/db";

/**
 * Unified conversation thread.
 *
 * The timeline must reflect BOTH persisted messages (`conversation_message`) and
 * outbound drafts/sends still living in `brain_message_outbox` (planned/locked/
 * failed, or sent-but-not-yet-canonicalized). Reading only `conversation_message`
 * is why a conversation could show "1 mensaje": the bot's replies only land there
 * once the outbox worker sends and canonical-persists a `sent` message.
 *
 * Sources are merged and DEDUPED by `provider_message_id`: when an outbox row has
 * already been canonicalized into `conversation_message` (same provider_message_id),
 * the persisted row wins (it carries the authoritative delivery status).
 */

export type ConversationMessageState =
  | "received"
  | "planned"
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

export type ConversationMessageOrigin = "customer" | "ai" | "operator" | "system";

export type ConversationThreadMessage = {
  key: string;
  direction: "inbound" | "outbound" | "system";
  origin: ConversationMessageOrigin;
  operatorName: string | null;
  body: string;
  state: ConversationMessageState;
  occurredAt: string | null;
  source: string;
  providerMessageId: string | null;
  messageType?: string | null;
};

export type ConversationMessageRow = {
  id: number;
  public_id: string;
  provider: string;
  provider_message_id: string | null;
  direction: string;
  sender_type: string | null;
  message_type: string | null;
  body: string | null;
  status: string | null;
  provider_timestamp: string | null;
  created_at: string;
};

export type ConversationOutboxRow = {
  id: number;
  dedupe_key: string;
  status: string;
  source: string | null;
  source_agent_name: string | null;
  message_text: string | null;
  provider_message_id: string | null;
  error_code: string | null;
  created_at: string;
  planned_at: string | null;
  sent_at: string | null;
  failed_at: string | null;
};

const DEFAULT_THREAD_LIMIT = 200;

function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value !== "string") return null;

  const text = value.trim();
  if (!text) return null;

  const normalized = text.includes("T") ? text : `${text.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

/** Operator-authored outbound messages carry an explicit operator sender_type. */
function isOperatorSender(senderType: string | null): boolean {
  if (!senderType) return false;
  const normalized = senderType.trim().toLowerCase();
  return normalized === "operator" || normalized === "human" || normalized === "agent_human";
}

/** Persisted message state: inbound is always `received`; outbound uses its delivery status. */
export function normalizeMessageState(direction: string, status: string | null): ConversationMessageState {
  if (direction === "inbound") return "received";
  const normalized = (status ?? "").trim().toLowerCase();
  if (normalized === "delivered") return "delivered";
  if (normalized === "read") return "read";
  if (normalized === "failed") return "failed";
  if (normalized === "queued" || normalized === "planned") return normalized;
  if (normalized === "received") return "received";
  return "sent";
}

/** Outbox lifecycle → timeline state. `locked` means a worker is mid-send. */
export function normalizeOutboxState(status: string | null): ConversationMessageState {
  const normalized = (status ?? "").trim().toLowerCase();
  if (normalized === "sent") return "sent";
  if (normalized === "failed") return "failed";
  if (normalized === "locked") return "queued";
  return "planned";
}

function messageRowToThread(row: ConversationMessageRow): ConversationThreadMessage {
  const direction = row.direction === "inbound" ? "inbound" : row.direction === "system" ? "system" : "outbound";
  let origin: ConversationMessageOrigin;
  if (direction === "inbound") origin = "customer";
  else if (direction === "system") origin = "system";
  else origin = isOperatorSender(row.sender_type) ? "operator" : "ai";

  return {
    key: row.public_id || `cm-${row.id}`,
    direction,
    origin,
    operatorName: origin === "operator" ? row.sender_type : null,
    body: row.body ?? "",
    state: normalizeMessageState(row.direction, row.status),
    occurredAt: toIso(row.provider_timestamp ?? row.created_at),
    source: row.provider || "conversation_message",
    providerMessageId: row.provider_message_id,
    messageType: row.message_type
  };
}

function outboxRowToThread(row: ConversationOutboxRow): ConversationThreadMessage {
  const operator = row.source ? row.source.trim().toLowerCase() === "operator" : false;
  return {
    key: `outbox-${row.dedupe_key || row.id}`,
    direction: "outbound",
    origin: operator ? "operator" : "ai",
    operatorName: null,
    body: row.message_text ?? "",
    state: normalizeOutboxState(row.status),
    occurredAt: toIso(row.sent_at ?? row.failed_at ?? row.planned_at ?? row.created_at),
    source: "outbox",
    providerMessageId: row.provider_message_id
  };
}

/**
 * Pure merge/dedup/sort. Persisted messages win over outbox rows that share a
 * provider_message_id; remaining outbox rows (planned/queued/failed, or not yet
 * canonicalized) are appended. Sorted chronologically ascending for display.
 */
export function mergeConversationThread(
  messageRows: ConversationMessageRow[],
  outboxRows: ConversationOutboxRow[]
): ConversationThreadMessage[] {
  const persisted = messageRows.map(messageRowToThread);
  const persistedProviderIds = new Set(
    messageRows.map((row) => row.provider_message_id).filter((id): id is string => Boolean(id))
  );

  const outboxOnly = outboxRows
    .filter((row) => !(row.provider_message_id && persistedProviderIds.has(row.provider_message_id)))
    .map(outboxRowToThread);

  return [...persisted, ...outboxOnly].sort((a, b) => {
    const at = a.occurredAt ? Date.parse(a.occurredAt) : 0;
    const bt = b.occurredAt ? Date.parse(b.occurredAt) : 0;
    if (at !== bt) return at - bt;
    return a.key.localeCompare(b.key);
  });
}

export type ConversationThreadResult = {
  messages: ConversationThreadMessage[];
  error: string | null;
  truncated: boolean;
};

/**
 * Load and merge the thread for a conversation. `before` (ISO) enables loading
 * older pages; `limit` caps each source (merged result may be up to 2x before dedup).
 */
export async function loadConversationThread(
  conversationId: number,
  options: { limit?: number; before?: string | null } = {}
): Promise<ConversationThreadResult> {
  const limit = options.limit && options.limit > 0 ? Math.min(options.limit, 500) : DEFAULT_THREAD_LIMIT;
  // Accept ISO or MySQL datetime cursors; normalize to MySQL DATETIME for comparison.
  const before = options.before ? options.before.slice(0, 19).replace("T", " ") : null;
  const beforeSql = before ? " AND created_at < ?" : "";
  const beforeParams = before ? [before] : [];

  const [messagesResult, outboxResult] = await Promise.all([
    safeQueryRows<ConversationMessageRow>(
      `SELECT id, public_id, provider, provider_message_id, direction, sender_type, message_type, body, status, provider_timestamp, created_at
       FROM conversation_message
       WHERE conversation_id = ?${beforeSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [conversationId, ...beforeParams, limit]
    ),
    safeQueryRows<ConversationOutboxRow>(
      `SELECT id, dedupe_key, status, source, source_agent_name, message_text, provider_message_id, error_code, created_at, planned_at, sent_at, failed_at
       FROM brain_message_outbox
       WHERE conversation_case_id = ?${beforeSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [conversationId, ...beforeParams, limit]
    )
  ]);

  // conversation_message is the authoritative timeline; a failure there is a real error.
  if (!messagesResult.ok) {
    return { messages: [], error: messagesResult.error, truncated: false };
  }

  const messageRows = messagesResult.rows;
  // Outbox is best-effort enrichment; degrade silently to persisted-only if it fails.
  const outboxRows = outboxResult.ok ? outboxResult.rows : [];

  return {
    messages: mergeConversationThread(messageRows, outboxRows),
    error: null,
    truncated: messageRows.length >= limit || outboxRows.length >= limit
  };
}

export type AiControlMode = "ai_autonomous" | "human" | "paused";

/** Header control mode: human ownership wins, then paused (AI disabled), else autonomous. */
export function deriveAiControlMode(aiEnabled: boolean, humanOwnerActive: boolean): AiControlMode {
  if (humanOwnerActive) return "human";
  if (!aiEnabled) return "paused";
  return "ai_autonomous";
}
