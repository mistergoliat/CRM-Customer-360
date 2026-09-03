// SALES-AGENT-R3-V1.8.1. Durable persistence for pending/settling inbound
// turns. Mirrors this codebase's existing worker-claim conventions
// (runFollowupTick.ts / commercialWorkWorker.ts): safeExecute + affectedRows
// for every CAS, never affectedRows off safeQueryRows (see
// [[db-conventions-and-pitfalls]]).

import { getPool, safeExecute, safeQueryRows, sanitizeDbError } from "@/lib/db";
import { TURN_SETTLE_STALE_PROCESSING_LOCK_SECONDS } from "./config";
import type { TurnSettlementRow, UpsertPendingTurnInput, UpsertPendingTurnResult } from "./types";

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ER_DUP_ENTRY";
}

async function tryExtendPendingTurn(input: UpsertPendingTurnInput): Promise<boolean> {
  const result = await safeExecute(
    `UPDATE crm_inbound_turn_settlements
       SET latest_inbound_message_id = ?,
           latest_inbound_provider_message_id = ?,
           fragment_count = fragment_count + 1,
           last_inbound_at = CURRENT_TIMESTAMP(3),
           settle_after = LEAST(DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MICROSECOND), max_settle_at),
           last_correlation_id = ?,
           updated_at = CURRENT_TIMESTAMP(3)
     WHERE conversation_id = ? AND status = 'PENDING'`,
    [input.inboundMessageId, input.providerMessageId, input.settleDelayMs * 1000, input.correlationId, input.conversationId]
  );
  return result.ok && result.affectedRows > 0;
}

async function tryInsertPendingTurn(input: UpsertPendingTurnInput): Promise<"inserted" | "duplicate"> {
  try {
    await getPool().execute(
      `INSERT INTO crm_inbound_turn_settlements
         (conversation_id, wa_id, phone_number_id, first_inbound_message_id, latest_inbound_message_id,
          latest_inbound_provider_message_id, fragment_count, first_inbound_at, last_inbound_at,
          settle_after, max_settle_at, status, last_correlation_id)
       VALUES
         (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3),
          DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MICROSECOND),
          DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MICROSECOND),
          'PENDING', ?)`,
      [
        input.conversationId,
        input.waId,
        input.phoneNumberId,
        input.inboundMessageId,
        input.inboundMessageId,
        input.providerMessageId,
        input.settleDelayMs * 1000,
        input.maxSettleMs * 1000,
        input.correlationId
      ]
    );
    return "inserted";
  } catch (error) {
    if (isDuplicateKeyError(error)) return "duplicate";
    throw error;
  }
}

/**
 * Extend-or-create, race-safe (Section H: at most one active PENDING turn
 * per conversation, enforced at the DB level by the pending_scope_key
 * generated column - see the migration). Bounded retry: a concurrent webhook
 * delivery for the same conversation can make either branch lose a single
 * race, never more than that, so 3 attempts is generous headroom, not a
 * magic number tuned to a specific timing.
 */
export async function upsertPendingTurn(input: UpsertPendingTurnInput): Promise<UpsertPendingTurnResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await tryExtendPendingTurn(input)) return { ok: true, created: false };
    try {
      const outcome = await tryInsertPendingTurn(input);
      if (outcome === "inserted") return { ok: true, created: true };
      // "duplicate": a concurrent request won the insert race between our
      // failed UPDATE and this INSERT - loop back and extend its row instead.
    } catch (error) {
      return { ok: false, error: sanitizeDbError(error) };
    }
  }
  return { ok: false, error: "turn_settlement_upsert_exhausted_retries" };
}

export async function selectDuePendingTurns(limit: number): Promise<TurnSettlementRow[]> {
  const result = await safeQueryRows<TurnSettlementRow>(
    `SELECT * FROM crm_inbound_turn_settlements WHERE status = 'PENDING' AND settle_after <= CURRENT_TIMESTAMP(3) ORDER BY settle_after ASC LIMIT ?`,
    [limit]
  );
  return result.ok ? result.rows : [];
}

/** A worker crash between claim and terminal write leaves a row stuck PROCESSING - recoverable once it has been stale longer than TURN_SETTLE_STALE_PROCESSING_LOCK_SECONDS (Section S). */
export async function selectStaleProcessingTurns(limit: number): Promise<TurnSettlementRow[]> {
  const result = await safeQueryRows<TurnSettlementRow>(
    `SELECT * FROM crm_inbound_turn_settlements
      WHERE status = 'PROCESSING' AND updated_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND)
      ORDER BY updated_at ASC LIMIT ?`,
    [TURN_SETTLE_STALE_PROCESSING_LOCK_SECONDS, limit]
  );
  return result.ok ? result.rows : [];
}

/** Atomic compare-and-swap: only claims a row still PENDING (prevents a second concurrent poller/tick from double-running the same turn). */
export async function claimPendingTurn(id: number): Promise<boolean> {
  const result = await safeExecute(`UPDATE crm_inbound_turn_settlements SET status = 'PROCESSING', updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND status = 'PENDING'`, [id]);
  return result.ok && result.affectedRows > 0;
}

/** Re-verifies staleness at claim time (not just at selection time), same discipline as claimStaleExecutingFollowUp - two concurrent reclaims on the same row can never both win. */
export async function reclaimStaleProcessingTurn(id: number): Promise<boolean> {
  const result = await safeExecute(
    `UPDATE crm_inbound_turn_settlements
        SET updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ? AND status = 'PROCESSING' AND updated_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND)`,
    [id, TURN_SETTLE_STALE_PROCESSING_LOCK_SECONDS]
  );
  return result.ok && result.affectedRows > 0;
}

export async function completeTurn(id: number): Promise<boolean> {
  const result = await safeExecute(`UPDATE crm_inbound_turn_settlements SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND status = 'PROCESSING'`, [id]);
  return result.ok && result.affectedRows > 0;
}

export async function supersedeTurn(id: number, supersededByMessageId: number): Promise<boolean> {
  const result = await safeExecute(
    `UPDATE crm_inbound_turn_settlements SET status = 'SUPERSEDED', superseded_by_message_id = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND status = 'PROCESSING'`,
    [supersededByMessageId, id]
  );
  return result.ok && result.affectedRows > 0;
}
