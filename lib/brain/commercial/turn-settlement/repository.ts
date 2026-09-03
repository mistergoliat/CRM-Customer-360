// SALES-AGENT-R3-V1.8.1. Durable persistence for pending/settling inbound
// turns. Mirrors this codebase's existing worker-claim conventions
// (runFollowupTick.ts / commercialWorkWorker.ts): safeExecute + affectedRows
// for every CAS, never affectedRows off safeQueryRows (see
// [[db-conventions-and-pitfalls]]).

import type { PoolConnection, ResultSetHeader } from "mysql2/promise";
import { getPool, safeExecute, safeQueryRows, sanitizeDbError } from "@/lib/db";
import { TURN_SETTLE_STALE_PROCESSING_LOCK_SECONDS } from "./config";
import type { TurnSettlementRow, UpsertPendingTurnInput, UpsertPendingTurnResult } from "./types";

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ER_DUP_ENTRY";
}

async function tryExtendPendingTurn(input: UpsertPendingTurnInput, connection?: PoolConnection): Promise<boolean> {
  const sql = `UPDATE crm_inbound_turn_settlements
       SET latest_inbound_message_id = ?,
           latest_inbound_provider_message_id = ?,
           fragment_count = fragment_count + 1,
           last_inbound_at = CURRENT_TIMESTAMP(3),
           settle_after = LEAST(DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MICROSECOND), max_settle_at),
           last_correlation_id = ?,
           updated_at = CURRENT_TIMESTAMP(3)
     WHERE conversation_id = ? AND status = 'PENDING'`;
  const params = [input.inboundMessageId, input.providerMessageId, input.settleDelayMs * 1000, input.correlationId, input.conversationId];
  if (connection) {
    const [header] = await connection.execute<ResultSetHeader>(sql, params);
    return header.affectedRows > 0;
  }
  const result = await safeExecute(sql, params);
  return result.ok && result.affectedRows > 0;
}

async function tryInsertPendingTurn(input: UpsertPendingTurnInput, connection?: PoolConnection): Promise<"inserted" | "duplicate"> {
  const sql = `INSERT INTO crm_inbound_turn_settlements
         (conversation_id, wa_id, phone_number_id, first_inbound_message_id, latest_inbound_message_id,
          latest_inbound_provider_message_id, fragment_count, first_inbound_at, last_inbound_at,
          settle_after, max_settle_at, status, last_correlation_id)
       VALUES
         (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3),
          DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MICROSECOND),
          DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MICROSECOND),
          'PENDING', ?)`;
  const params = [
    input.conversationId,
    input.waId,
    input.phoneNumberId,
    input.inboundMessageId,
    input.inboundMessageId,
    input.providerMessageId,
    input.settleDelayMs * 1000,
    input.maxSettleMs * 1000,
    input.correlationId
  ];
  try {
    if (connection) {
      await connection.execute(sql, params);
    } else {
      await getPool().execute(sql, params);
    }
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
 *
 * SALES-AGENT-R3-V1.8.1a (Fix 1). Accepts an optional transaction connection
 * so the webhook can create/extend this row in the SAME transaction as the
 * canonical inbound persist (lib/brain/native-whatsapp/service.ts) - a
 * committed inbound must never exist without durable processing
 * responsibility. Standalone callers (tests, and delay=0 which never calls
 * this at all) keep using the pool directly by omitting the connection.
 */
export async function upsertPendingTurn(input: UpsertPendingTurnInput, connection?: PoolConnection): Promise<UpsertPendingTurnResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await tryExtendPendingTurn(input, connection)) return { ok: true, created: false };
    try {
      const outcome = await tryInsertPendingTurn(input, connection);
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

/**
 * Atomic compare-and-swap: only claims a row still PENDING (prevents a
 * second concurrent poller/tick from double-running the same turn).
 *
 * SALES-AGENT-R3-V1.8.1b (Objetivo B - conversation-scoped ownership). The
 * NOT EXISTS guard additionally refuses the claim while ANY other row for
 * the SAME conversation is already PROCESSING - without it, a fragment that
 * arrives while a turn is mid-cognition opens its own new PENDING row
 * (unchanged, see upsertPendingTurn's own comment) that a later tick could
 * claim and run CONCURRENTLY with the still-in-flight turn for the same
 * conversation. This is a pure narrowing of an existing CAS condition: it
 * can only ever refuse a claim that was always a correctness bug (two
 * simultaneous cognitive runs for one conversation), never one that was
 * previously safe. A losing claim is not an error - the row stays PENDING
 * and is retried on a later tick, once the conversation frees up (mirrors
 * the pre-existing `if (!claimed) continue` idiom in runTurnSettleTick.ts).
 * A DIFFERENT conversation's claim is entirely unaffected - the subquery is
 * scoped by conversation_id.
 */
export async function claimPendingTurn(id: number): Promise<boolean> {
  const result = await safeExecute(
    `UPDATE crm_inbound_turn_settlements t1
        SET status = 'PROCESSING', updated_at = CURRENT_TIMESTAMP(3)
      WHERE t1.id = ?
        AND t1.status = 'PENDING'
        AND NOT EXISTS (
          SELECT 1 FROM crm_inbound_turn_settlements t2
           WHERE t2.conversation_id = t1.conversation_id
             AND t2.status = 'PROCESSING'
        )`,
    [id]
  );
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

/**
 * SALES-AGENT-R3-V1.8.1b-A. Accepts an optional transaction connection, same
 * precedent as upsertPendingTurn's own Fix 1 - so live assimilation's
 * dispatch transaction (dispatchGovernedSalesAgentMessage.ts) can complete
 * this row in the SAME commit as the outbox insert and sibling reconciliation
 * below, instead of a separate, non-atomic call. The pre-existing standalone
 * caller (runTurnSettleTick.ts's own unconditional post-dispatch call) keeps
 * using the pool directly and stays a safe, idempotent no-op when the
 * transaction already completed this row (affectedRows=0, WHERE no longer
 * matches).
 */
export async function completeTurn(id: number, connection?: PoolConnection): Promise<boolean> {
  const sql = `UPDATE crm_inbound_turn_settlements SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND status = 'PROCESSING'`;
  if (connection) {
    const [header] = await connection.execute<ResultSetHeader>(sql, [id]);
    return header.affectedRows > 0;
  }
  const result = await safeExecute(sql, [id]);
  return result.ok && result.affectedRows > 0;
}

export async function supersedeTurn(id: number, supersededByMessageId: number): Promise<boolean> {
  const result = await safeExecute(
    `UPDATE crm_inbound_turn_settlements SET status = 'SUPERSEDED', superseded_by_message_id = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND status = 'PROCESSING'`,
    [supersededByMessageId, id]
  );
  return result.ok && result.affectedRows > 0;
}

type SiblingRow = { id: number; first_inbound_message_id: number; latest_inbound_message_id: number };

/**
 * SALES-AGENT-R3-V1.8.1b-A (Objetivo A - settlement responsibility
 * reconciliation, Sections 14-15/23 of the task brief). MUST be called on a
 * connection that is inside the same open transaction as the outbox insert
 * that consumed this range (dispatchGovernedSalesAgentMessage.ts) - never
 * standalone, never on the pool. A crash before that transaction commits
 * rolls this back too (nothing reconciled); a crash after commits both
 * together. See migration 036 and repository.ts's own module header for why
 * ASSIMILATED is a distinct status from COMPLETED/SUPERSEDED.
 *
 * Only PENDING siblings are ever touched - Objetivo B's claimPendingTurn
 * guard already guarantees no OTHER row for this conversation can be
 * PROCESSING while selfSettlementId is (mutual exclusion), so a sibling seen
 * here is always PENDING by construction; the WHERE clause enforces that
 * invariant rather than assuming it silently.
 *
 * - Full coverage (sibling's entire range already <= finalAssimilatedAnchor):
 *   status -> ASSIMILATED, superseded_by_message_id records the covering
 *   anchor (reused column - see migration 036).
 * - Partial coverage (sibling range straddles the anchor): first_inbound_message_id
 *   advances to finalAssimilatedAnchor + 1, status stays PENDING - its own
 *   future assembleTurnFragments call then only re-reads the genuinely
 *   unconsumed tail, never reprocessing already-answered content.
 * - No overlap at all (sibling's entire range is newer than the anchor):
 *   untouched.
 */
export async function reconcileAssimilatedSiblings(
  connection: PoolConnection,
  conversationId: number,
  selfSettlementId: number,
  finalAssimilatedAnchor: number
): Promise<{ assimilatedIds: number[]; advancedIds: number[] }> {
  const [rows] = await connection.query(
    `SELECT id, first_inbound_message_id, latest_inbound_message_id
       FROM crm_inbound_turn_settlements
      WHERE conversation_id = ? AND status = 'PENDING' AND id != ?
      FOR UPDATE`,
    [conversationId, selfSettlementId]
  );

  const assimilatedIds: number[] = [];
  const advancedIds: number[] = [];

  for (const row of rows as SiblingRow[]) {
    if (row.latest_inbound_message_id <= finalAssimilatedAnchor) {
      await connection.execute(
        `UPDATE crm_inbound_turn_settlements
            SET status = 'ASSIMILATED', superseded_by_message_id = ?, updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ? AND status = 'PENDING'`,
        [finalAssimilatedAnchor, row.id]
      );
      assimilatedIds.push(row.id);
    } else if (row.first_inbound_message_id <= finalAssimilatedAnchor) {
      await connection.execute(
        `UPDATE crm_inbound_turn_settlements
            SET first_inbound_message_id = ?, updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ? AND status = 'PENDING'`,
        [finalAssimilatedAnchor + 1, row.id]
      );
      advancedIds.push(row.id);
    }
  }

  return { assimilatedIds, advancedIds };
}
