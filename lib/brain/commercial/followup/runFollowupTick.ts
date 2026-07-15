import { safeExecute, safeQueryRows } from "@/lib/db";
import { runNativeAutonomousCycle } from "@/lib/brain/commercial/native-cycle";
import { FOLLOW_UP_STALE_EXECUTING_LOCK_SECONDS, FOLLOW_UP_STALE_EXECUTION_EXHAUSTED_REASON, hasAttemptsRemaining } from "./followUpWorkerPolicy";

/**
 * One follow-up polling tick, shared by the worker script, tests and the E2E
 * harness (the cycle runner is injectable so no LLM call is needed to
 * exercise selection, cancellation and idempotency).
 *
 * Candidate selection (selectDueFollowUps) returns three disjoint groups:
 *  - status='planned' and due                     -> claimPlannedFollowUp
 *  - status='executing' and stale-locked           -> either recovered
 *    (attempt_number < max_attempts, claimStaleExecutingFollowUp) or
 *    terminalized (attempt_number >= max_attempts, terminalizeExhaustedStaleFollowUp)
 *  - status='failed' with attempts left            -> claimFailedFollowUpRetry
 * A row with attempt_number >= max_attempts is terminal in every group and
 * is never selected again once it lands on 'failed'.
 *
 * Sequence for every claimable candidate (ACS-R1-05-T03.1): select -> claim
 * CAS -> revalidate the commercial state -> abort (cancelled) if it no
 * longer applies -> only then re-enter runNativeAutonomousCycle. Revalidation
 * always runs after the claim, uniformly for planned/failed/recovered rows -
 * a claim only reserves the row, it never certifies the commercial state is
 * still safe to act on.
 *
 * Cancellation rules (checked after claim, before re-entry):
 *  - customer replied since the follow-up was scheduled → cancel
 *  - human owner active / AI paused / conversation closed → cancel
 *  - opportunity in terminal status → cancel
 * cancelFollowUp (standalone, pre-claim) only overwrites planned/failed rows
 * (P1-1) - it is never called from this tick's own loop, which always aborts
 * an already-claimed row via abortClaimedFollowUp instead.
 */

export type FollowUpCandidate = {
  id: number;
  action_id: string;
  wa_id: string | null;
  conversation_case_id: string | number | null;
  scheduled_for: string | null;
  draft_message: string | null;
  status: string;
  attempt_number: number;
  max_attempts: number;
};

export type FollowupTickResult = {
  processed: number;
  cancelled: Array<{ actionId: string; reason: string }>;
  executed: string[];
  failed: string[];
};

export type FollowupTickOptions = {
  limit: number;
  dryRun?: boolean;
  /** Restrict the tick to these action_ids (tests/harness isolation). */
  actionIds?: string[];
  cycleRunner?: typeof runNativeAutonomousCycle;
  defaultPhoneNumberId?: string;
  log?: (message: string) => void;
  /**
   * Test-only synchronization hook: invoked immediately after a successful
   * claim, before revalidation. Lets tests deterministically simulate a race
   * window (an inbound reply, an opportunity turning terminal, a takeover)
   * between claim and re-entry, without relying on real elapsed time.
   */
  onAfterClaim?: (candidate: FollowUpCandidate) => Promise<void> | void;
};

export async function selectDueFollowUps(limit: number, actionIds?: string[]): Promise<FollowUpCandidate[]> {
  // The actionIds scope must live in the SQL: older due follow-ups would
  // otherwise consume the LIMIT before an in-memory filter could apply.
  const scope = actionIds && actionIds.length > 0 ? ` AND action_id IN (${actionIds.map(() => "?").join(",")})` : "";
  const result = await safeQueryRows<FollowUpCandidate>(
    `SELECT id, action_id, wa_id, conversation_case_id, scheduled_for, draft_message, status, attempt_number, max_attempts
      FROM crm_agent_actions
      WHERE action_type = 'schedule_followup'
        AND (
          (status = 'planned' AND scheduled_for <= UTC_TIMESTAMP())
          OR (status = 'executing' AND updated_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? SECOND))
          OR (status = 'failed' AND attempt_number < max_attempts)
        )
        AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())${scope}
      ORDER BY scheduled_for ASC, id ASC
      LIMIT ?`,
    [FOLLOW_UP_STALE_EXECUTING_LOCK_SECONDS, ...(actionIds && actionIds.length > 0 ? actionIds : []), limit]
  );
  return result.ok ? result.rows : [];
}

// P1-1: explicit status precondition. Only planned/failed rows can be
// cancelled here - executing/executed/cancelled/requires_review are never
// overwritten. Standalone entry point (e.g. a future operator-facing
// cancellation) - runFollowupTick's own loop never calls this, it always
// aborts an already-claimed row via abortClaimedFollowUp below instead.
export async function cancelFollowUp(actionId: string, reason: string): Promise<{ cancelled: boolean }> {
  const result = await safeExecute(
    `UPDATE crm_agent_actions SET status = 'cancelled', cancel_reason = ?, updated_at = CURRENT_TIMESTAMP(3)
      WHERE action_id = ? AND status IN ('planned', 'failed')`,
    [reason, actionId]
  );
  return { cancelled: result.ok && result.affectedRows > 0 };
}

// Cancels a row this tick already owns (status='executing' from its own
// claim, whichever CAS produced it). Distinct from cancelFollowUp: here
// 'executing' is exactly the precondition, not the forbidden state.
async function abortClaimedFollowUp(actionId: string, reason: string): Promise<boolean> {
  const result = await safeExecute(
    `UPDATE crm_agent_actions SET status = 'cancelled', cancel_reason = ?, updated_at = CURRENT_TIMESTAMP(3)
      WHERE action_id = ? AND status = 'executing'`,
    [reason, actionId]
  );
  return result.ok && result.affectedRows > 0;
}

export async function claimPlannedFollowUp(actionId: string): Promise<boolean> {
  // Atomic compare-and-swap: only move if still 'planned' (prevents double-run)
  const result = await safeExecute(
    `UPDATE crm_agent_actions SET status = 'executing', updated_at = CURRENT_TIMESTAMP(3)
      WHERE action_id = ? AND status = 'planned'`,
    [actionId]
  );
  return result.ok && result.affectedRows > 0;
}

// P0-2 / ACS-R1-05-T03.1: recovers a row abandoned mid-flight by a crashed
// worker as a genuine new commercial attempt - attempt_number is incremented
// exactly once, atomically inside the same CAS UPDATE that wins the claim,
// mirroring claimFailedFollowUpRetry below (a recovered row never gets a
// second, separate increment later). status stays 'executing' (it already
// was), only updated_at/attempt_number move - there is no intermediate
// transition through 'planned'. attempt_number < max_attempts and the
// staleness window are both re-verified here (not just at selection time),
// so two concurrent recoveries on the same row can never both win: whichever
// commits first bumps updated_at, and the loser's own WHERE clause (still
// requiring the pre-recovery stale updated_at) no longer matches.
export async function claimStaleExecutingFollowUp(actionId: string): Promise<boolean> {
  const result = await safeExecute(
    `UPDATE crm_agent_actions
      SET attempt_number = attempt_number + 1, updated_at = CURRENT_TIMESTAMP(3)
      WHERE action_id = ?
        AND action_type = 'schedule_followup'
        AND status = 'executing'
        AND attempt_number < max_attempts
        AND updated_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? SECOND)`,
    [actionId, FOLLOW_UP_STALE_EXECUTING_LOCK_SECONDS]
  );
  return result.ok && result.affectedRows > 0;
}

// ACS-R1-05-T03.1: a stale 'executing' row with no attempts left is not a
// candidate to recover - it is dead-lettered to 'failed' with a fixed,
// PII-free failure_reason, never re-entering runNativeAutonomousCycle, never
// incrementing attempt_number, never inserting another crm_agent_actions
// row. Requires the row to still be 'executing', still stale and still
// exhausted at CAS time; once it lands on 'failed' a second call's WHERE no
// longer matches (status != 'executing'), so this is naturally idempotent.
// Two concurrent terminalizations on the same row: only one's UPDATE
// actually changes anything, by the same row-lock CAS mechanism as every
// other claim in this file.
export async function terminalizeExhaustedStaleFollowUp(actionId: string): Promise<boolean> {
  const result = await safeExecute(
    `UPDATE crm_agent_actions
      SET status = 'failed', failure_reason = ?, updated_at = CURRENT_TIMESTAMP(3)
      WHERE action_id = ?
        AND action_type = 'schedule_followup'
        AND status = 'executing'
        AND attempt_number >= max_attempts
        AND updated_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? SECOND)`,
    [FOLLOW_UP_STALE_EXECUTION_EXHAUSTED_REASON, actionId, FOLLOW_UP_STALE_EXECUTING_LOCK_SECONDS]
  );
  return result.ok && result.affectedRows > 0;
}

// P0-3: retries a definitively failed row as a genuine new attempt -
// attempt_number is incremented exactly once, atomically with the claim, so
// a concurrent retry claim on the same row can never double-increment it. A
// row at attempt_number >= max_attempts is terminal and never matches.
export async function claimFailedFollowUpRetry(actionId: string): Promise<boolean> {
  const result = await safeExecute(
    `UPDATE crm_agent_actions SET status = 'executing', attempt_number = attempt_number + 1, updated_at = CURRENT_TIMESTAMP(3)
      WHERE action_id = ? AND status = 'failed' AND attempt_number < max_attempts`,
    [actionId]
  );
  return result.ok && result.affectedRows > 0;
}

async function claimFollowUpCandidate(candidate: FollowUpCandidate): Promise<boolean> {
  if (candidate.status === "planned") return claimPlannedFollowUp(candidate.action_id);
  if (candidate.status === "executing") return claimStaleExecutingFollowUp(candidate.action_id);
  if (candidate.status === "failed") return claimFailedFollowUpRetry(candidate.action_id);
  return false;
}

export async function shouldCancelFollowUp(candidate: FollowUpCandidate): Promise<{ cancel: boolean; reason: string }> {
  // Customer replied since schedule_followup was created → the follow-up is stale.
  if (candidate.conversation_case_id) {
    const recentInbound = await safeQueryRows<{ id: number }>(
      `SELECT cm.id FROM conversation_message cm
        INNER JOIN conversation c ON c.id = cm.conversation_id
        WHERE c.id = ? AND cm.direction = 'inbound'
          AND cm.created_at > (
            SELECT created_at FROM crm_agent_actions WHERE action_id = ? LIMIT 1
          )
        LIMIT 1`,
      [candidate.conversation_case_id, candidate.action_id]
    );
    if (recentInbound.ok && recentInbound.rows.length > 0) {
      return { cancel: true, reason: "customer_replied_since_schedule" };
    }

    // A human owner, paused AI or closed conversation makes it incompatible.
    const conv = await safeQueryRows<{ human_owner_active: number; ai_enabled: number; status: string }>(
      `SELECT human_owner_active, ai_enabled, status FROM conversation WHERE id = ? LIMIT 1`,
      [candidate.conversation_case_id]
    );
    if (conv.ok && conv.rows[0]) {
      const row = conv.rows[0];
      if (Number(row.human_owner_active) === 1) return { cancel: true, reason: "human_owner_active" };
      if (Number(row.ai_enabled) === 0) return { cancel: true, reason: "ai_paused" };
      if (["closed", "resolved", "done", "archived"].includes(String(row.status).toLowerCase())) {
        return { cancel: true, reason: "conversation_closed" };
      }
    }
  }

  // Terminal opportunity → nothing to follow up on.
  if (candidate.wa_id) {
    const opp = await safeQueryRows<{ status: string }>(
      `SELECT status FROM crm_opportunities WHERE wa_id = ? ORDER BY updated_at DESC LIMIT 1`,
      [candidate.wa_id]
    );
    if (opp.ok && opp.rows[0]) {
      const terminal = ["won", "lost", "cancelled", "archived"];
      if (terminal.includes(opp.rows[0].status)) {
        return { cancel: true, reason: `opportunity_terminal_status:${opp.rows[0].status}` };
      }
    }
  }

  return { cancel: false, reason: "" };
}

export async function runFollowupTick(options: FollowupTickOptions): Promise<FollowupTickResult> {
  const log = options.log ?? (() => void 0);
  const cycleRunner = options.cycleRunner ?? runNativeAutonomousCycle;
  const result: FollowupTickResult = { processed: 0, cancelled: [], executed: [], failed: [] };

  const candidates = await selectDueFollowUps(options.limit, options.actionIds);
  if (candidates.length === 0) return result;

  for (const candidate of candidates) {
    if (options.dryRun) {
      log(`[worker:followup] DRY RUN — would process action ${candidate.action_id} (origin status=${candidate.status})`);
      result.processed++;
      continue;
    }

    // A stale 'executing' row with no attempts left is never claimed and
    // never re-enters the cycle - it is dead-lettered directly.
    const isExhaustedStaleExecution = candidate.status === "executing" && !hasAttemptsRemaining(candidate.attempt_number, candidate.max_attempts);
    if (isExhaustedStaleExecution) {
      const terminalized = await terminalizeExhaustedStaleFollowUp(candidate.action_id);
      if (terminalized) {
        log(`[worker:followup] terminalizing exhausted stale-locked action ${candidate.action_id}: ${FOLLOW_UP_STALE_EXECUTION_EXHAUSTED_REASON}`);
        result.failed.push(candidate.action_id);
      }
      continue;
    }

    // Claim CAS — skip if another worker already took this row, or if the
    // preconditions (staleness/attempts remaining) no longer hold.
    const locked = await claimFollowUpCandidate(candidate);
    if (!locked) continue;

    if (options.onAfterClaim) await options.onAfterClaim(candidate);

    // Uniform post-claim revalidation for every origin (planned/failed/
    // recovered-executing alike, ACS-R1-05-T03.1): the claim only reserves
    // the row, it never certifies the commercial state is still safe to act
    // on. A row that no longer qualifies is aborted, never silently executed.
    if (!candidate.wa_id) {
      await abortClaimedFollowUp(candidate.action_id, "missing_wa_id");
      result.cancelled.push({ actionId: candidate.action_id, reason: "missing_wa_id" });
      continue;
    }

    const { cancel, reason } = await shouldCancelFollowUp(candidate);
    if (cancel) {
      await abortClaimedFollowUp(candidate.action_id, reason);
      log(`[worker:followup] cancelling action ${candidate.action_id}: ${reason}`);
      result.cancelled.push({ actionId: candidate.action_id, reason });
      continue;
    }

    const convRows = await safeQueryRows<{ id: number; public_id: string }>(
      `SELECT id, public_id FROM conversation WHERE id = ? LIMIT 1`,
      [candidate.conversation_case_id]
    );
    const conversation = convRows.ok ? convRows.rows[0] ?? null : null;
    if (!conversation) {
      await abortClaimedFollowUp(candidate.action_id, "conversation_not_found");
      result.cancelled.push({ actionId: candidate.action_id, reason: "conversation_not_found" });
      continue;
    }

    const followUpMessage = candidate.draft_message ?? "Hola, ¿en qué puedo ayudarte?";
    const correlationId = `followup:${candidate.action_id}:${Date.now()}`;

    try {
      const cycleResult = await cycleRunner({
        conversationId: conversation.id,
        conversationPublicId: conversation.public_id,
        customerMasterId: null,
        waId: candidate.wa_id,
        phoneNumberId: options.defaultPhoneNumberId ?? process.env.META_WHATSAPP_DEFAULT_PHONE_NUMBER_ID ?? "",
        messageId: null,
        messageText: followUpMessage,
        correlationId,
        currentTime: new Date().toISOString()
      });

      const nextAction = cycleResult.loop?.selectedNextAction?.type ?? "none";
      log(`[worker:followup] executed follow-up for ${candidate.wa_id} → loop decided: ${nextAction}`);

      // CAS guard: only this claim's own 'executing' row may complete it, so a
      // concurrent cancellation (e.g. an operator taking control mid-flight)
      // is never silently clobbered by a late completion write.
      await safeQueryRows(
        `UPDATE crm_agent_actions SET status = 'executed', executed_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3) WHERE action_id = ? AND status = 'executing'`,
        [candidate.action_id]
      );
      result.executed.push(candidate.action_id);
      result.processed++;
    } catch (error) {
      log(`[worker:followup] error for action ${candidate.action_id}: ${error instanceof Error ? error.message : String(error)}`);
      // Terminal vs retryable is decided at the next claim attempt (P0-3's
      // attempt_number < max_attempts precondition), not by a distinct status
      // here - a row that ran out of attempts simply never matches that
      // precondition again.
      await safeQueryRows(
        `UPDATE crm_agent_actions SET status = 'failed', failure_reason = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE action_id = ? AND status = 'executing'`,
        [error instanceof Error ? error.message : "unknown", candidate.action_id]
      );
      result.failed.push(candidate.action_id);
    }
  }

  return result;
}
