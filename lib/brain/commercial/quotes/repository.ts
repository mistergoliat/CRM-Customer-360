import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { safeExecute, safeQueryRows, withTransaction } from "@/lib/db";
import { appendRequestEvent, loadConversationRequest } from "../conversation-request";
import { applyRequestReduction } from "../request-definitions";
import { QUOTE_STATUSES } from "./types";
import type { CommercialQuote, CreateQuoteDraftInput, CreateQuoteDraftResult, QuoteItem, QuoteMutationResult, QuoteStatus, QuoteTotals } from "./types";

export const QUOTE_TABLE = "crm_quotes";

type DbLikeRow = Record<string, unknown>;

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function asDateTimeIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return asText(value);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "bigint") return Number(value);
  return null;
}

function asJson<T>(value: unknown): T | null {
  if (value && typeof value === "object") return value as T;
  if (typeof value === "string" && value.trim()) {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return null;
}

function rowToQuote(row: DbLikeRow): CommercialQuote {
  const status = asText(row.status);
  return {
    contractName: "CommercialQuote",
    schemaVersion: "1.0.0",
    quoteId: asText(row.quote_id) ?? "",
    requestId: asText(row.request_id) ?? "",
    conversationId: asNumber(row.conversation_id) ?? 0,
    opportunityId: asNumber(row.opportunity_id),
    customerId: asNumber(row.customer_id),
    createdByActionId: asText(row.created_by_action_id),
    version: asNumber(row.version) ?? 1,
    status: status && (QUOTE_STATUSES as readonly string[]).includes(status) ? (status as QuoteStatus) : "draft",
    items: asJson<QuoteItem[]>(row.items_json) ?? [],
    totals: asJson<QuoteTotals>(row.totals_json) ?? { subtotal: 0, shipping: null, total: 0, currency: "CLP" },
    addressSnapshot: asJson(row.address_snapshot_json),
    expiryAt: asDateTimeIso(row.expiry_at),
    createdAt: asDateTimeIso(row.created_at) ?? "",
    updatedAt: asDateTimeIso(row.updated_at) ?? "",
    sentAt: asDateTimeIso(row.sent_at),
    decidedAt: asDateTimeIso(row.decided_at)
  };
}

export async function loadQuote(quoteId: string): Promise<CommercialQuote | null> {
  const result = await safeQueryRows<DbLikeRow>(`SELECT * FROM \`${QUOTE_TABLE}\` WHERE quote_id = ? LIMIT 1`, [quoteId]);
  if (!result.ok || !result.rows[0]) return null;
  return rowToQuote(result.rows[0]);
}

export async function getCurrentQuoteForRequest(requestId: string): Promise<CommercialQuote | null> {
  const result = await safeQueryRows<DbLikeRow>(
    `SELECT * FROM \`${QUOTE_TABLE}\` WHERE request_id = ? AND active_marker = 1 LIMIT 1`,
    [requestId]
  );
  if (!result.ok || !result.rows[0]) return null;
  return rowToQuote(result.rows[0]);
}

export async function listQuoteVersions(requestId: string): Promise<CommercialQuote[]> {
  const result = await safeQueryRows<DbLikeRow>(
    `SELECT * FROM \`${QUOTE_TABLE}\` WHERE request_id = ? ORDER BY version ASC, id ASC`,
    [requestId]
  );
  if (!result.ok) return [];
  return result.rows.map((row) => rowToQuote(row));
}

function validateQuoteContent(items: QuoteItem[], totals: QuoteTotals): string | null {
  if (!Array.isArray(items) || items.length === 0) return "quote_items_required";
  for (const item of items) {
    if (!item.productId?.trim() || !item.name?.trim()) return "quote_item_product_required";
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) return "quote_item_quantity_invalid";
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) return "quote_item_price_invalid";
  }
  if (!Number.isFinite(totals.total) || totals.total < 0) return "quote_total_invalid";
  if (!totals.currency?.trim()) return "quote_currency_required";
  return null;
}

/**
 * Creates a new quote version for the request. Never edits in place: any
 * current draft/sent version is superseded inside the same transaction and a
 * fresh version row is inserted. Idempotent per governed action via
 * created_by_action_id. An ACCEPTED quote is never silently superseded.
 */
export async function createQuoteDraft(input: CreateQuoteDraftInput): Promise<CreateQuoteDraftResult> {
  const request = await loadConversationRequest(input.requestId);
  if (!request) return { ok: false, status: "request_not_found", quote: null, warning: `Request ${input.requestId} does not exist.` };

  const invalid = validateQuoteContent(input.items, input.totals);
  if (invalid) return { ok: false, status: "invalid_input", quote: null, warning: invalid };

  if (input.createdByActionId) {
    const existing = await safeQueryRows<DbLikeRow>(
      `SELECT * FROM \`${QUOTE_TABLE}\` WHERE created_by_action_id = ? LIMIT 1`,
      [input.createdByActionId]
    );
    if (existing.ok && existing.rows[0]) return { ok: true, status: "duplicate", quote: rowToQuote(existing.rows[0]) };
  }

  const current = await getCurrentQuoteForRequest(input.requestId);
  if (current?.status === "accepted") {
    return { ok: false, status: "conflict", quote: null, warning: `Request ${input.requestId} already has an ACCEPTED quote; it cannot be silently replaced.` };
  }

  const quoteId = `quote-${randomUUID()}`;
  try {
    const inserted = await withTransaction(async (connection) => {
      await connection.execute<ResultSetHeader>(
        `UPDATE \`${QUOTE_TABLE}\`
            SET status = 'superseded', updated_at = CURRENT_TIMESTAMP(3)
          WHERE request_id = ? AND status IN ('draft','sent')`,
        [input.requestId]
      );

      const [versionRows] = await connection.execute<RowDataPacket[]>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM \`${QUOTE_TABLE}\` WHERE request_id = ?`,
        [input.requestId]
      );
      const nextVersion = Number(versionRows[0]?.next_version ?? 1);

      await connection.execute<ResultSetHeader>(
        `INSERT INTO \`${QUOTE_TABLE}\` (
            quote_id, request_id, conversation_id, opportunity_id, customer_id,
            created_by_action_id, version, status, items_json, totals_json,
            address_snapshot_json, expiry_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
        [
          quoteId,
          input.requestId,
          request.conversationId,
          input.opportunityId ?? request.opportunityId,
          input.customerId ?? null,
          input.createdByActionId ?? null,
          nextVersion,
          JSON.stringify(input.items),
          JSON.stringify(input.totals),
          input.addressSnapshot ? JSON.stringify(input.addressSnapshot) : null,
          input.expiryAt ? input.expiryAt.slice(0, 23).replace("T", " ") : null
        ]
      );

      const [rows] = await connection.execute<RowDataPacket[]>(`SELECT * FROM \`${QUOTE_TABLE}\` WHERE quote_id = ? LIMIT 1`, [quoteId]);
      return rows[0] as DbLikeRow | undefined;
    });

    if (!inserted) return { ok: false, status: "error", quote: null, warning: "quote_reload_failed" };
    const quote = rowToQuote(inserted);

    await appendRequestEvent({
      dedupeKey: `request:${input.requestId}:quote:${quoteId}:quote_created`,
      requestId: input.requestId,
      eventType: "quote_created",
      sourceType: "system",
      sourceId: input.createdByActionId ?? quoteId,
      payload: { quoteId, version: quote.version, total: input.totals.total, currency: input.totals.currency },
      occurredAt: new Date().toISOString()
    });

    return { ok: true, status: "created", quote };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: /duplicate entry/i.test(message) ? "conflict" : "error", quote: null, warning: message };
  }
}

async function changeQuoteStatus(
  quoteId: string,
  toStatus: QuoteStatus,
  fromStatuses: readonly QuoteStatus[],
  extraSet: string
): Promise<QuoteMutationResult> {
  const placeholders = fromStatuses.map(() => "?").join(",");
  const update = await safeExecute(
    `UPDATE \`${QUOTE_TABLE}\`
        SET status = ?, ${extraSet} updated_at = CURRENT_TIMESTAMP(3)
      WHERE quote_id = ? AND status IN (${placeholders})`,
    [toStatus, quoteId, ...fromStatuses]
  );
  if (!update.ok) return { ok: false, status: "error", quote: null, warning: update.error };

  const quote = await loadQuote(quoteId);
  if (update.affectedRows <= 0) {
    if (!quote) return { ok: false, status: "not_found", quote: null, warning: `Quote ${quoteId} does not exist.` };
    return { ok: false, status: "conflict", quote, warning: `Quote ${quoteId} is in status ${quote.status}, expected one of: ${fromStatuses.join(", ")}.` };
  }
  if (!quote) return { ok: false, status: "error", quote: null, warning: "quote_reload_failed" };
  return { ok: true, quote };
}

/**
 * Marks the quote sent and emits quote_sent - the event the Bloque 7 reducer
 * uses to resolve product_quote/maintenance_quote requests. The actual
 * message transport stays in the outbox pipeline; this records the fact.
 */
export async function markQuoteSent(quoteId: string): Promise<QuoteMutationResult> {
  const result = await changeQuoteStatus(quoteId, "sent", ["draft"], "sent_at = CURRENT_TIMESTAMP(3),");
  if (!result.ok) return result;

  await appendRequestEvent({
    dedupeKey: `request:${result.quote.requestId}:quote:${quoteId}:quote_sent`,
    requestId: result.quote.requestId,
    eventType: "quote_sent",
    sourceType: "system",
    sourceId: quoteId,
    payload: { quoteId, version: result.quote.version, total: result.quote.totals.total },
    occurredAt: new Date().toISOString()
  });

  const request = await loadConversationRequest(result.quote.requestId);
  if (request) await applyRequestReduction(request);

  return result;
}

/** Records the customer's explicit decision on a SENT quote. */
export async function recordQuoteDecision(
  quoteId: string,
  decision: "accepted" | "rejected",
  options: { sourceMessageId?: string | null } = {}
): Promise<QuoteMutationResult> {
  const result = await changeQuoteStatus(quoteId, decision, ["sent"], "decided_at = CURRENT_TIMESTAMP(3),");
  if (!result.ok) return result;

  await appendRequestEvent({
    dedupeKey: `request:${result.quote.requestId}:quote:${quoteId}:quote_${decision}`,
    requestId: result.quote.requestId,
    eventType: decision === "accepted" ? "quote_accepted" : "quote_rejected",
    sourceType: options.sourceMessageId ? "customer_message" : "system",
    sourceId: options.sourceMessageId ?? quoteId,
    payload: { quoteId, version: result.quote.version },
    occurredAt: new Date().toISOString()
  });

  return result;
}

export async function expireQuote(quoteId: string): Promise<QuoteMutationResult> {
  return changeQuoteStatus(quoteId, "expired", ["draft", "sent"], "");
}
