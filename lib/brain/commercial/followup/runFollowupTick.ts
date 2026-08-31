import { safeExecute, safeQueryRows } from "@/lib/db";
import { redactErrorMessage } from "@/lib/brain/commercial/redactErrorMessage";
import { runAgentRuntimeEvent } from "@/lib/brain/commercial/agent-runtime-event";
import { buildFollowUpWakeEvent } from "@/lib/brain/commercial/followup-wake/buildFollowUpWakeEvent";
import { recordFollowUpWake } from "@/lib/brain/commercial/followup-wake/sessionEvents";
import { dispatchDraftedFollowUpMessage } from "@/lib/brain/commercial/followup-wake/dispatchDraftedFollowUpMessage";
import type { FollowUpWakeDisposition, FollowUpWakeEvent } from "@/lib/brain/commercial/followup-wake/types";
import {
  loadAutonomousPilotAllowlist,
  isWaIdAuthorizedForPilot,
  loadWhatsAppAccessGateConfig,
  isWaIdAllowedByAccessGate,
  loadAutonomousResponsesEnabled,
  loadCommercialWorkFollowUpEnabled,
  loadCommercialWorkFollowUpActivationCutoff,
  isBeforeActivationCutoff
} from "@/lib/brain/runtime/autonomousRuntimeConfig";
import { shouldRouteToCommercialWork } from "@/lib/brain/commercial/config/commercialCycleConfig";
import { checkCustomerOptOutStatus } from "@/lib/brain/commercial/optOutStore";
import { resolveSalesAgentConfiguration } from "@/lib/brain/commercial/sales-agent-configuration";
import { findNextAllowedWindowStartIso, isInstantWithinAllowedWindow } from "./computeFollowUpSchedule";
import { FOLLOW_UP_STALE_EXECUTING_LOCK_SECONDS, FOLLOW_UP_STALE_EXECUTION_EXHAUSTED_REASON, hasAttemptsRemaining } from "./followUpWorkerPolicy";

/**
 * One follow-up polling tick, shared by the worker script, tests and the E2E
 * harness (the dispatch function is injectable so no real WhatsApp send is
 * needed to exercise selection, cancellation and idempotency).
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
 * longer applies -> only then dispatch. Revalidation always runs after the
 * claim, uniformly for planned/failed/recovered rows - a claim only reserves
 * the row, it never certifies the commercial state is still safe to act on.
 *
 * Cancellation rules (checked after claim, before dispatch):
 *  - customer replied since the follow-up was scheduled → cancel
 *  - human owner active / AI paused / conversation closed → cancel
 *  - opportunity in terminal status → cancel
 * cancelFollowUp (standalone, pre-claim) only overwrites planned/failed rows
 * (P1-1) - it is never called from this tick's own loop, which always aborts
 * an already-claimed row via abortClaimedFollowUp instead.
 *
 * SALES-AGENT-R3-A05: a claimed, still-relevant candidate is a structured
 * FOLLOWUP_WAKE system event, never a fabricated customer message. It
 * dispatches its own already-drafted message directly through the canonical
 * outbound path (runAgentRuntimeEvent -> dispatchDraftedFollowUpMessage) -
 * this tick never re-enters runNativeAutonomousCycle with follow-up text
 * posing as something the customer said. Every fired wake is recorded into
 * AgentSessionStore (recordWake) with its final disposition, correlated by a
 * wakeId deterministic from (actionPublicId, attempt) - see
 * docs/releases/SALES-AGENT-R3-A05-structured-followup-wake.md.
 */

export type FollowUpCandidate = {
  id: number;
  action_id: string;
  wa_id: string | null;
  conversation_case_id: string | number | null;
  /** ACS-R1-05.1-T02.3D review correction: the canonical identity for the age check below - never wa_id, which can be shared/reassigned across opportunities. */
  opportunity_id: number | null;
  scheduled_for: string | null;
  draft_message: string | null;
  status: string;
  attempt_number: number;
  max_attempts: number;
  /** ACS-R1-05.1-T02.3D: which Sales Agent Configuration governed this row's scheduling - null for rows created before this task (or seeded outside the config-aware pipeline), which never had one and are never revalidated against a config. */
  followup_configuration_source: string | null;
  /** SALES-AGENT-R2-A11, Part 19/22. Raw payload, inspected only to route to the R2 objective-aware processor - never parsed here beyond the "kind" check below. Optional so existing legacy-shaped test fixtures need no update. */
  draft_payload_json?: unknown;
  /** A11, Part 59/60/61. Used only for the R2 objective-aware branch's optional activation-cutoff check. Optional so existing test fixtures need no update. */
  created_at?: string | null;
};

/**
 * SALES-AGENT-R2-A11, Part 19/22. schedule_followup rows come from two
 * producers sharing the same table/claim primitives (persistAgentAction.ts's
 * legitimate second-persister exception, followUpRuntimeAuthority.test.ts):
 * the native shadow/operational-loop runtime (draft_payload_json shaped
 * {nextAction, ...} - see followup-wake/dispatchDraftedFollowUpMessage.ts,
 * SALES-AGENT-R3-A05) and R2's scheduleObjectiveAwareFollowUp
 * (objectiveAwareFollowUp.ts, payload kind "objective_aware_followup"). This
 * tick's loop must route each due row to the correct processor - neither one
 * ever feeds a follow-up's own reminder text into runNativeAutonomousCycle
 * as if it were a customer message (R3-A05 removed the one path that still
 * did). Deliberately minimal (only the "kind" field) to avoid a circular
 * import with objectiveAwareFollowUp.ts, which already imports this file's
 * claim primitives - the actual full parse/revalidation still happens once,
 * inside processObjectiveAwareFollowUpDue itself.
 */
export function isObjectiveAwareFollowUpPayload(value: unknown): boolean {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return false;
    }
  }
  if (typeof parsed !== "object" || parsed === null) return false;
  return (parsed as Record<string, unknown>).kind === "objective_aware_followup";
}

export type FollowupTickResult = {
  processed: number;
  cancelled: Array<{ actionId: string; reason: string }>;
  executed: string[];
  failed: string[];
  /** ACS-R1-05-T06.1: candidates skipped for pilot isolation - row and attempt_number left untouched, never claimed. */
  skippedUnauthorized: string[];
  /** SALES-AGENT-R2-A11, Part 3/27/36. Blocked by the WhatsApp access gate (BRAIN_WHATSAPP_TEST_MODE_ENABLED) - row untouched, never claimed, retriable once the wa_id is allowlisted or TEST_MODE is turned off. */
  skippedAccessGate: string[];
  /** A11, Part 4/21/36. Blocked by the global autonomy killswitch (BRAIN_AUTONOMOUS_RESPONSES_ENABLED=false) - row untouched, never claimed, retriable once autonomy is re-enabled. */
  skippedAutonomyDisabled: string[];
  /** A11, Part 20/22. An R2 objective-aware row, but BRAIN_COMMERCIAL_WORK_FOLLOW_UP_ENABLED is false or this wa_id is no longer R2-eligible - row untouched, never claimed. Never applies to legacy rows. */
  skippedCommercialWorkFollowUpIneligible: string[];
  /** A11, Part 59/60/61. An R2 objective-aware row created before the configured activation cutoff - row untouched, never claimed. */
  skippedBeforeActivationCutoff: string[];
  /** ACS-R1-05.1-T02.3D: due, but outside the CURRENT allowed window - moved forward to the next window start, never executed or cancelled. */
  rescheduled: Array<{ actionId: string; scheduledFor: string }>;
  /**
   * ACS-R1-05.1-T02.3D review correction: a TECHNICAL failure (opt-out
   * status unavailable, configuration resolver failure, window computation
   * failure) - returned to 'planned' with a short bounded backoff, its
   * attempt_number never advanced. Distinct from `failed` (a real cycle-
   * runner/business failure, which does consume an attempt).
   */
  /** scheduledFor is null when the backoff itself failed to persist (see applyTechnicalFailureBackoff) - persisted distinguishes that case from a genuine reschedule. */
  technicalFailures: Array<{ actionId: string; reason: string; scheduledFor: string | null; persisted: boolean }>;
};

export type FollowupTickOptions = {
  limit: number;
  dryRun?: boolean;
  /** Restrict the tick to these action_ids (tests/harness isolation). */
  actionIds?: string[];
  /**
   * SALES-AGENT-R3-A05. Test/DI seam for the deterministic follow-up
   * dispatch (a durable draft_message, dispatched through the canonical
   * outbound path) - defaults to the real dispatchDraftedFollowUpMessage.
   * Replaces the pre-A05 `cycleRunner` seam: a follow-up wake no longer
   * re-enters runNativeAutonomousCycle with a fabricated customer message,
   * so there is nothing left for a "cycle runner" to inject.
   */
  dispatchDraftedFollowUpMessage?: typeof dispatchDraftedFollowUpMessage;
  log?: (message: string) => void;
  /**
   * Test-only determinism hook. Defaults to the real wall clock
   * (new Date().toISOString()) for the actual worker. Overriding this lets
   * a test pin the instant used for opt-out/configuration/allowed-window
   * revalidation to a known-safe value, instead of depending on whatever
   * real local hour the allowed window's boundary happens to fall on when
   * the test actually runs.
   */
  now?: string;
  /**
   * Test-only synchronization hook: invoked immediately after a successful
   * claim, before revalidation. Lets tests deterministically simulate a race
   * window (an inbound reply, an opportunity turning terminal, a takeover)
   * between claim and re-entry, without relying on real elapsed time.
   */
  onAfterClaim?: (candidate: FollowUpCandidate) => Promise<void> | void;
  /** A11, Part 20. Test-only injection point; production callers default to the real env-backed reader. Only gates the R2 objective-aware branch. */
  commercialWorkFollowUpEnabled?: boolean;
  /** A11, Part 14/20. Test-only injection point; production callers default to the real shouldRouteToCommercialWork. Only gates the R2 objective-aware branch. */
  isWaIdEligibleForCommercialWork?: (waId: string | null | undefined) => boolean;
  /** A11, Part 59/60/61. Test-only injection point; production callers default to the real env-backed reader (null = no cutoff configured). Only gates the R2 objective-aware branch. */
  commercialWorkFollowUpActivationCutoff?: string | null;
};

export async function selectDueFollowUps(limit: number, actionIds?: string[]): Promise<FollowUpCandidate[]> {
  // The actionIds scope must live in the SQL: older due follow-ups would
  // otherwise consume the LIMIT before an in-memory filter could apply.
  const scope = actionIds && actionIds.length > 0 ? ` AND action_id IN (${actionIds.map(() => "?").join(",")})` : "";
  const result = await safeQueryRows<FollowUpCandidate>(
    `SELECT id, action_id, wa_id, conversation_case_id, opportunity_id, scheduled_for, draft_message, status, attempt_number, max_attempts, followup_configuration_source, draft_payload_json, created_at
      FROM crm_agent_actions
      WHERE action_type = 'schedule_followup'
        AND (
          (status = 'planned' AND scheduled_for <= UTC_TIMESTAMP())
          OR (status = 'executing' AND updated_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND))
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

function toMysqlDateTime(iso: string): string {
  return iso.slice(0, 19).replace("T", " ");
}

// ACS-R1-05.1-T02.3D: a row this tick already claimed ('executing') turns
// out to be due at an instant outside the CURRENT allowed window (the
// window changed since scheduling, or scheduled_for landed exactly on a
// boundary) - moved forward, never discarded, same "no se descarta, se
// mueve" rule computeFollowUpSchedule.ts already applies at creation time.
// Goes back to 'planned' (not a terminal state) with the new scheduled_for -
// distinct from abortClaimedFollowUp, which is always terminal.
async function rescheduleClaimedFollowUp(actionId: string, scheduledForIso: string): Promise<boolean> {
  const result = await safeExecute(
    `UPDATE crm_agent_actions SET status = 'planned', scheduled_for = ?, updated_at = CURRENT_TIMESTAMP(3)
      WHERE action_id = ? AND status = 'executing'`,
    [toMysqlDateTime(scheduledForIso), actionId]
  );
  return result.ok && result.affectedRows > 0;
}

/** Bounded, fixed delay - never unlimited/growing backoff. */
const FOLLOW_UP_TECHNICAL_BACKOFF_MINUTES = 5;

/**
 * ACS-R1-05.1-T02.3D review correction. A TECHNICAL failure (opt-out status
 * unavailable, configuration resolver failure, window computation failure)
 * is never a business decision - it must never consume a commercial
 * attempt, and must stay retryable rather than landing in 'failed' (which
 * FOLLOW_UP_ATTEMPT_CONSUMING_STATUSES treats as a real, consumed try).
 *
 * The claim CAS that won this row already incremented attempt_number
 * atomically for two of the three possible origins - claimStaleExecutingFollowUp
 * (recovered-stale) and claimFailedFollowUpRetry (retry) both bump it as
 * part of winning the claim; claimPlannedFollowUp does not. candidate.status
 * still holds the PRE-claim status (the row as selectDueFollowUps read it,
 * before this tick's own claim ran), so it is exactly what's needed to know
 * whether to undo that bump here - a technical failure must leave
 * attempt_number exactly where it was before this tick ever touched the row.
 *
 * Review correction (post-close): the UPDATE's own safeExecute result used
 * to be discarded outright - a failed write (or a write that matched zero
 * rows, e.g. a concurrent process already moved the row off 'executing')
 * still reported the computed scheduledFor as if it had been persisted,
 * which could log/report a reschedule that never actually happened. Success
 * now requires affectedRows === 1 exactly; anything else is an explicit,
 * logged persistence failure with no fabricated scheduledFor. The row is
 * deliberately left in 'executing' when this happens - never forced to
 * 'planned' through some other path - so it is still picked up later by the
 * existing stale-executing recovery (claimStaleExecutingFollowUp /
 * terminalizeExhaustedStaleFollowUp) once the DB accepts writes again.
 */
export type ApplyTechnicalFailureBackoffResult = { persisted: true; scheduledFor: string } | { persisted: false; scheduledFor: null };

async function applyTechnicalFailureBackoff(
  candidate: FollowUpCandidate,
  now: string,
  log: (message: string) => void
): Promise<ApplyTechnicalFailureBackoffResult> {
  const scheduledForIso = new Date(new Date(now).getTime() + FOLLOW_UP_TECHNICAL_BACKOFF_MINUTES * 60_000).toISOString();
  const attemptWasBumpedAtClaim = candidate.status === "executing" || candidate.status === "failed";
  const result = await safeExecute(
    `UPDATE crm_agent_actions
      SET status = 'planned',
          scheduled_for = ?,
          attempt_number = ${attemptWasBumpedAtClaim ? "GREATEST(attempt_number - 1, 1)" : "attempt_number"},
          updated_at = CURRENT_TIMESTAMP(3)
      WHERE action_id = ? AND status = 'executing'`,
    [toMysqlDateTime(scheduledForIso), candidate.action_id]
  );
  if (!result.ok || result.affectedRows !== 1) {
    const detail = result.ok ? `unexpected_affected_rows:${result.affectedRows}` : result.error;
    log(
      `[worker:followup] failed to persist technical-failure backoff for action ${candidate.action_id} (${detail}) - row left in 'executing' for stale-execution recovery`
    );
    return { persisted: false, scheduledFor: null };
  }
  return { persisted: true, scheduledFor: scheduledForIso };
}

/**
 * ACS-R1-05.1-T02.3D review correction. opportunity_id is the canonical
 * identity for the age check - never wa_id (shared/reassignable across
 * opportunities, and matched via an unrelated ORDER BY updated_at DESC
 * heuristic before this correction). conversation_case_id is only used as a
 * fallback, and only when it resolves to EXACTLY one opportunity - zero or
 * multiple matches means there is no unambiguous canonical relation, so the
 * age check is skipped entirely rather than guessing.
 */
export type OpportunityCreatedAtLookup =
  | { status: "found"; createdAt: string }
  | { status: "not_found" }
  | { status: "ambiguous" }
  /** A real DB read failure - distinct from "no canonical relation" above. The caller must never treat this as "skip the age check". */
  | { status: "unavailable" };

/**
 * Review correction (post-close): a real query failure used to collapse
 * into the same `null` as "no row found" (result.ok ? ... : null), which
 * made revalidateFollowUpConfiguration silently skip the max-age check on a
 * transient DB error - failing OPEN exactly when the check could not be
 * trusted. found/not_found/ambiguous/unavailable are now distinct outcomes;
 * only `unavailable` (a genuine read failure) is required to block.
 */
async function loadOpportunityCreatedAtForCandidate(candidate: FollowUpCandidate): Promise<OpportunityCreatedAtLookup> {
  if (candidate.opportunity_id !== null && candidate.opportunity_id !== undefined) {
    const result = await safeQueryRows<{ created_at: string }>(`SELECT created_at FROM crm_opportunities WHERE id = ? LIMIT 1`, [
      candidate.opportunity_id
    ]);
    if (!result.ok) return { status: "unavailable" };
    const row = result.rows[0];
    return row ? { status: "found", createdAt: row.created_at } : { status: "not_found" };
  }

  if (candidate.conversation_case_id !== null && candidate.conversation_case_id !== undefined) {
    const result = await safeQueryRows<{ created_at: string }>(
      `SELECT created_at FROM crm_opportunities WHERE conversation_case_id = ? LIMIT 2`,
      [String(candidate.conversation_case_id)]
    );
    if (!result.ok) return { status: "unavailable" };
    if (result.rows.length === 0) return { status: "not_found" };
    if (result.rows.length > 1) return { status: "ambiguous" };
    return { status: "found", createdAt: result.rows[0].created_at };
  }

  return { status: "not_found" };
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
// ACS-R1-05-T03.2: the cutoff uses CURRENT_TIMESTAMP(3), the same session
// clock that writes updated_at - never UTC_TIMESTAMP(), which is a distinct
// (always-UTC) clock. updated_at is a plain DATETIME with no timezone of its
// own, so comparing a session-clock write against a UTC-clock cutoff only
// worked by accident when the session happened to run in UTC.
export async function claimStaleExecutingFollowUp(actionId: string): Promise<boolean> {
  const result = await safeExecute(
    `UPDATE crm_agent_actions
      SET attempt_number = attempt_number + 1, updated_at = CURRENT_TIMESTAMP(3)
      WHERE action_id = ?
        AND action_type = 'schedule_followup'
        AND status = 'executing'
        AND attempt_number < max_attempts
        AND updated_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND)`,
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
// other claim in this file. ACS-R1-05-T03.2: same CURRENT_TIMESTAMP(3)
// cutoff as claimStaleExecutingFollowUp above, for the same reason.
export async function terminalizeExhaustedStaleFollowUp(actionId: string): Promise<boolean> {
  const result = await safeExecute(
    `UPDATE crm_agent_actions
      SET status = 'failed', failure_reason = ?, updated_at = CURRENT_TIMESTAMP(3)
      WHERE action_id = ?
        AND action_type = 'schedule_followup'
        AND status = 'executing'
        AND attempt_number >= max_attempts
        AND updated_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND)`,
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

/**
 * SALES-AGENT-R3-A05. Records the fired wake into AgentSessionStore -
 * shadow/additive (recordFollowUpWake never throws); a failure here is
 * logged the same way every other technical, non-blocking signal in this
 * file already is, never fatal to the tick.
 */
async function recordWake(event: FollowUpWakeEvent, disposition: FollowUpWakeDisposition, log: (message: string) => void): Promise<void> {
  const recorded = await recordFollowUpWake(event, disposition);
  if (!recorded.ok) {
    log(`[worker:followup] agent_session_followup_wake_write_failed for action ${event.actionPublicId}: ${recorded.warning}`);
  }
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

export type FollowUpRevalidationOutcome =
  | { outcome: "proceed" }
  | { outcome: "cancel"; reason: string }
  | { outcome: "reschedule"; reason: string; scheduledFor: string }
  | { outcome: "technical_failure"; reason: string };

/**
 * ACS-R1-05.1-T02.3D, decision 13. Re-checks a claimed row against the
 * CURRENT published Sales Agent Configuration - never the snapshot recorded
 * at scheduling time (followup_configuration_*), which only exists for
 * audit/attribution, not as authority at execution time. A configuration
 * that changed between scheduling and now (disabled, tightened maxAttempts,
 * shortened maxOpportunityAgeDays, moved the window) must take effect on
 * the very next tick, not wait for a fresh schedule.
 *
 * Resolver failure is a TECHNICAL problem, never a business decision -
 * mirrors execution-bridge's own resolveFollowUpSchedulingContext
 * (configuration_unavailable): the caller routes this outcome through
 * applyTechnicalFailureBackoff (bounded backoff, 'planned', attempt_number
 * never advanced), never a customer-facing cancellation and never the
 * attempt-consuming 'failed' status a real cycle-runner exception uses.
 */
export async function revalidateFollowUpConfiguration(
  candidate: FollowUpCandidate,
  now: string = new Date().toISOString()
): Promise<FollowUpRevalidationOutcome> {
  let resolved;
  try {
    resolved = await resolveSalesAgentConfiguration();
  } catch {
    return { outcome: "technical_failure", reason: "configuration_unavailable" };
  }
  const config = resolved.effectiveFollowUpConfiguration;

  if (!config.enabled) return { outcome: "cancel", reason: "follow_up_disabled" };
  if (candidate.attempt_number > config.maxAttempts) return { outcome: "cancel", reason: "max_attempts_reached" };

  const opportunityLookup = await loadOpportunityCreatedAtForCandidate(candidate);
  // unavailable = the age check could not be trusted this tick - never
  // executed as if the opportunity were within range (fail-closed), never
  // cancelled as a business decision (this is a technical problem).
  if (opportunityLookup.status === "unavailable") {
    return { outcome: "technical_failure", reason: "opportunity_age_lookup_unavailable" };
  }
  if (opportunityLookup.status === "found") {
    const createdMs = new Date(opportunityLookup.createdAt).getTime();
    const nowMs = new Date(now).getTime();
    if (!Number.isNaN(createdMs) && !Number.isNaN(nowMs)) {
      const ageDays = (nowMs - createdMs) / 86_400_000;
      if (ageDays > config.maxOpportunityAgeDays) return { outcome: "cancel", reason: "opportunity_too_old" };
    }
  }
  // not_found / ambiguous: no unambiguous canonical relation - the age
  // check is skipped, same as before this correction.

  if (!isInstantWithinAllowedWindow(now, config.allowedWindow)) {
    const nextWindowStart = findNextAllowedWindowStartIso(now, config.allowedWindow);
    if (!nextWindowStart) return { outcome: "technical_failure", reason: "window_unreachable" };
    return { outcome: "reschedule", reason: "outside_allowed_window", scheduledFor: nextWindowStart };
  }

  return { outcome: "proceed" };
}

export async function runFollowupTick(options: FollowupTickOptions): Promise<FollowupTickResult> {
  const log = options.log ?? (() => void 0);
  const result: FollowupTickResult = {
    processed: 0,
    cancelled: [],
    executed: [],
    failed: [],
    skippedUnauthorized: [],
    skippedAccessGate: [],
    skippedAutonomyDisabled: [],
    skippedCommercialWorkFollowUpIneligible: [],
    skippedBeforeActivationCutoff: [],
    rescheduled: [],
    technicalFailures: []
  };

  const candidates = await selectDueFollowUps(options.limit, options.actionIds);
  if (candidates.length === 0) return result;

  // ACS-R1-05-T06.1 (P1-5 pilot isolation): read once per tick, never mutates
  // process.env. A candidate whose wa_id isn't allowlisted is skipped before
  // any claim CAS runs - the row and its attempt_number stay exactly as they
  // were, never touched, unlike a cancellation (which writes cancel_reason).
  const pilotAllowlist = loadAutonomousPilotAllowlist();
  // SALES-AGENT-R2-A11, Part 21/27. Read once per tick, applies uniformly to
  // both legacy and R2 rows below - neither gate is specific to one payload
  // shape.
  const accessGate = loadWhatsAppAccessGateConfig();
  const autonomyEnabled = loadAutonomousResponsesEnabled();
  // A11 Part 20/59-61: only ever consulted for the R2 objective-aware
  // branch below - never affects legacy dispatch.
  const commercialWorkFollowUpEnabled = options.commercialWorkFollowUpEnabled ?? loadCommercialWorkFollowUpEnabled();
  const eligibleForCommercialWork = options.isWaIdEligibleForCommercialWork ?? shouldRouteToCommercialWork;
  const commercialWorkFollowUpCutoff =
    options.commercialWorkFollowUpActivationCutoff !== undefined ? options.commercialWorkFollowUpActivationCutoff : loadCommercialWorkFollowUpActivationCutoff();

  for (const candidate of candidates) {
    if (!isWaIdAuthorizedForPilot(candidate.wa_id, pilotAllowlist)) {
      log(`[worker:followup] skipping unauthorized wa_id for action ${candidate.action_id} (pilot allowlist)`);
      result.skippedUnauthorized.push(candidate.action_id);
      continue;
    }

    // A11 Part 3/27: WHO-may-access, checked before any claim - row and
    // attempt_number left untouched, retriable once eligible.
    if (!isWaIdAllowedByAccessGate(candidate.wa_id, accessGate)) {
      log(`[worker:followup] skipping action ${candidate.action_id}: blocked by WhatsApp access gate`);
      result.skippedAccessGate.push(candidate.action_id);
      continue;
    }
    // A11 Part 4/21/28: the independent global autonomy killswitch - checked
    // before any claim, applies to both legacy re-entry and the R2
    // objective-aware processor below.
    if (!autonomyEnabled) {
      log(`[worker:followup] skipping action ${candidate.action_id}: autonomous responses disabled`);
      result.skippedAutonomyDisabled.push(candidate.action_id);
      continue;
    }

    if (options.dryRun) {
      log(`[worker:followup] DRY RUN — would process action ${candidate.action_id} (origin status=${candidate.status})`);
      result.processed++;
      continue;
    }

    // SALES-AGENT-R2-A11, Part 19/22. R2's own objective-aware follow-up
    // (scheduleObjectiveAwareFollowUp) shares this table/action_type with the
    // native shadow/operational-loop scheduler - delegate entirely to its
    // own processor (which does its own claim/revalidation/canonical-outbox
    // dispatch, and since SALES-AGENT-R3-A05 its own FOLLOWUP_WAKE session
    // recording) rather than falling through to the generalized dispatch
    // below, which is built around the OTHER payload shape's fields. Dynamic
    // import avoids a circular dependency (objectiveAwareFollowUp.ts already
    // imports this file's claim primitives).
    if (isObjectiveAwareFollowUpPayload(candidate.draft_payload_json)) {
      // A11 Part 20: the R2 follow-up worker's own enablement flag, plus
      // Part 14's "still currently R2-eligible" revalidation, applied here
      // (never to the legacy branch, which has no notion of R2 eligibility).
      if (!commercialWorkFollowUpEnabled || !eligibleForCommercialWork(candidate.wa_id)) {
        log(`[worker:followup] skipping objective-aware follow-up ${candidate.action_id}: R2 follow-up disabled or wa_id no longer R2-eligible`);
        result.skippedCommercialWorkFollowUpIneligible.push(candidate.action_id);
        continue;
      }
      // A11 Part 59/60/61: never autonomously send a reminder for an
      // objective-aware follow-up scheduled before the configured rollout
      // cutoff.
      if (isBeforeActivationCutoff(candidate.created_at, commercialWorkFollowUpCutoff)) {
        log(`[worker:followup] skipping objective-aware follow-up ${candidate.action_id}: created before activation cutoff`);
        result.skippedBeforeActivationCutoff.push(candidate.action_id);
        continue;
      }
      const { processObjectiveAwareFollowUpDue } = await import("../work/followup/objectiveAwareFollowUp");
      const outcome = await processObjectiveAwareFollowUpDue({ actionId: candidate.action_id, now: options.now });
      log(`[worker:followup] objective-aware follow-up ${candidate.action_id}: ${outcome.status}`);
      if (outcome.status === "sent") {
        result.executed.push(candidate.action_id);
        result.processed++;
      } else if (outcome.status === "cancelled") {
        result.cancelled.push({ actionId: candidate.action_id, reason: outcome.reason });
      } else if (outcome.status === "failed") {
        result.failed.push(candidate.action_id);
      }
      // "skipped" (not due / already claimed) and "legacy_unaffected"
      // (payload turned out not to parse after all) need no bucket - neither
      // mutated anything.
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
    const nowIso = options.now ?? new Date().toISOString();
    // SALES-AGENT-R3-A05. One correlationId per fired wake, shared by the
    // AgentSession FOLLOWUP_WAKE event and (if this wake proceeds) the
    // outbound message it dispatches. wakeEvent is built from the candidate
    // row alone (conversation_case_id not yet confirmed to resolve to a real
    // row) - null-guarded until the conversation lookup below confirms it;
    // every disposition before that point still records a wake when the id
    // parses, since the row was genuinely claimed and evaluated regardless
    // of whether the conversation happens to still exist.
    const correlationId = `followup:${candidate.action_id}:${Date.now()}`;
    const conversationIdForWake =
      candidate.conversation_case_id === null || candidate.conversation_case_id === undefined
        ? null
        : Number(candidate.conversation_case_id);
    const wakeEvent =
      conversationIdForWake !== null && Number.isFinite(conversationIdForWake)
        ? buildFollowUpWakeEvent({
            actionPublicId: candidate.action_id,
            statusPreClaim: candidate.status,
            attemptNumberPreClaim: candidate.attempt_number,
            conversationId: conversationIdForWake,
            opportunityId: candidate.opportunity_id,
            correlationId,
            scheduledFor: candidate.scheduled_for,
            firedAt: nowIso
          })
        : null;

    if (!candidate.wa_id) {
      await abortClaimedFollowUp(candidate.action_id, "missing_wa_id");
      result.cancelled.push({ actionId: candidate.action_id, reason: "missing_wa_id" });
      if (wakeEvent) await recordWake(wakeEvent, { status: "cancelled", reason: "missing_wa_id" }, log);
      continue;
    }

    // ACS-R1-05.1-T02.3D, decision 11: checked before the business-state
    // checks below and before any configuration resolution - an opt-out is
    // definitive and cheap to check, same "before anything else" placement
    // as native-cycle Step 0.5.
    //
    // Review correction (post-close): checkCustomerOptOutStatus never fails
    // open. "unavailable" (a real DB read failure) is a TECHNICAL problem,
    // never treated as "not opted out" - routed through the same bounded,
    // non-attempt-consuming backoff as a configuration resolver failure.
    const optOutStatus = await checkCustomerOptOutStatus(candidate.wa_id);
    if (optOutStatus === "unavailable") {
      const backoff = await applyTechnicalFailureBackoff(candidate, nowIso, log);
      log(`[worker:followup] technical failure checking opt-out status for action ${candidate.action_id}: opt_out_status_unavailable`);
      result.technicalFailures.push({
        actionId: candidate.action_id,
        reason: "opt_out_status_unavailable",
        scheduledFor: backoff.scheduledFor,
        persisted: backoff.persisted
      });
      if (wakeEvent) await recordWake(wakeEvent, { status: "technical_failure", reason: "opt_out_status_unavailable" }, log);
      continue;
    }
    if (optOutStatus === "opted_out") {
      await abortClaimedFollowUp(candidate.action_id, "customer_opted_out");
      log(`[worker:followup] cancelling action ${candidate.action_id}: customer_opted_out`);
      result.cancelled.push({ actionId: candidate.action_id, reason: "customer_opted_out" });
      if (wakeEvent) await recordWake(wakeEvent, { status: "cancelled", reason: "customer_opted_out" }, log);
      continue;
    }

    const { cancel, reason } = await shouldCancelFollowUp(candidate);
    if (cancel) {
      await abortClaimedFollowUp(candidate.action_id, reason);
      log(`[worker:followup] cancelling action ${candidate.action_id}: ${reason}`);
      result.cancelled.push({ actionId: candidate.action_id, reason });
      if (wakeEvent) await recordWake(wakeEvent, { status: "cancelled", reason }, log);
      continue;
    }

    // ACS-R1-05.1-T02.3D, decision 13: re-validated against the CURRENT
    // configuration, never the snapshot recorded at scheduling time - but
    // only for rows that actually went through the config-aware scheduling
    // pipeline (followup_configuration_source is set). A row with no
    // recorded source predates this feature (or was seeded directly outside
    // it, e.g. by a test harness) and never had a config governing it in
    // the first place - it keeps exactly the pre-T02.3D worker behavior
    // (business-state checks only). This is also what keeps a deployment
    // that has never published a followUpConfiguration from having every
    // legitimately-scheduled row cancelled here: nothing gets scheduled at
    // all while disabled (execution-bridge's own gate), so this check only
    // ever fires for rows a real, enabled configuration actually produced.
    if (candidate.followup_configuration_source !== null) {
      const revalidation = await revalidateFollowUpConfiguration(candidate, nowIso);
      if (revalidation.outcome === "technical_failure") {
        // Review correction: never a business-consuming 'failed' - a
        // resolver/window failure is technical, stays retryable, never
        // advances attempt_number.
        const backoff = await applyTechnicalFailureBackoff(candidate, nowIso, log);
        log(`[worker:followup] technical failure revalidating action ${candidate.action_id}: ${revalidation.reason}`);
        result.technicalFailures.push({
          actionId: candidate.action_id,
          reason: revalidation.reason,
          scheduledFor: backoff.scheduledFor,
          persisted: backoff.persisted
        });
        if (wakeEvent) await recordWake(wakeEvent, { status: "technical_failure", reason: revalidation.reason }, log);
        continue;
      }
      if (revalidation.outcome === "cancel") {
        await abortClaimedFollowUp(candidate.action_id, revalidation.reason);
        log(`[worker:followup] cancelling action ${candidate.action_id}: ${revalidation.reason}`);
        result.cancelled.push({ actionId: candidate.action_id, reason: revalidation.reason });
        if (wakeEvent) await recordWake(wakeEvent, { status: "cancelled", reason: revalidation.reason }, log);
        continue;
      }
      if (revalidation.outcome === "reschedule") {
        await rescheduleClaimedFollowUp(candidate.action_id, revalidation.scheduledFor);
        log(`[worker:followup] rescheduling action ${candidate.action_id} to ${revalidation.scheduledFor}: ${revalidation.reason}`);
        result.rescheduled.push({ actionId: candidate.action_id, scheduledFor: revalidation.scheduledFor });
        if (wakeEvent) {
          await recordWake(wakeEvent, { status: "rescheduled", reason: revalidation.reason, scheduledFor: revalidation.scheduledFor }, log);
        }
        continue;
      }
    }

    const convRows = await safeQueryRows<{ id: number; public_id: string; status: string | null; human_owner_active: number; ai_enabled: number }>(
      `SELECT id, public_id, status, human_owner_active, ai_enabled FROM conversation WHERE id = ? LIMIT 1`,
      [candidate.conversation_case_id]
    );
    const conversation = convRows.ok ? convRows.rows[0] ?? null : null;
    if (!conversation) {
      await abortClaimedFollowUp(candidate.action_id, "conversation_not_found");
      result.cancelled.push({ actionId: candidate.action_id, reason: "conversation_not_found" });
      if (wakeEvent) await recordWake(wakeEvent, { status: "cancelled", reason: "conversation_not_found" }, log);
      continue;
    }

    // SALES-AGENT-R3-A05. This row's draft_message was already decided when
    // it was scheduled (buildAgentActionFromNextAction.ts, at the moment the
    // native shadow/operational-loop runtime chose propose_followup) - the
    // wake dispatches it directly through the canonical outbound path
    // (runAgentRuntimeEvent -> dispatchDraftedFollowUpMessage -> execution
    // gate -> outbox). It never re-enters runNativeAutonomousCycle with this
    // text posing as a customer message - that fabricated-inbound path is
    // exactly what this task removes (see
    // docs/releases/SALES-AGENT-R3-A05-structured-followup-wake.md).
    // conversation.id is guaranteed to be the same numeric id
    // conversationIdForWake already parsed above (the SELECT above matched
    // on it), so a fresh, definitely-non-null wake event is safe here.
    const confirmedWakeEvent = buildFollowUpWakeEvent({
      actionPublicId: candidate.action_id,
      statusPreClaim: candidate.status,
      attemptNumberPreClaim: candidate.attempt_number,
      conversationId: conversation.id,
      opportunityId: candidate.opportunity_id,
      correlationId,
      scheduledFor: candidate.scheduled_for,
      firedAt: nowIso
    });

    try {
      const dispatchOutcome = await runAgentRuntimeEvent(confirmedWakeEvent, {
        followUpDispatcher: options.dispatchDraftedFollowUpMessage,
        followUpDispatch: {
          waId: candidate.wa_id,
          draftMessage: candidate.draft_message,
          caseStatus: conversation.status,
          humanOwnerActive: Number(conversation.human_owner_active) === 1,
          aiEnabled: Number(conversation.ai_enabled) === 1
        }
      });
      // runAgentRuntimeEvent's return type is a union over BOTH event kinds
      // (event.type doesn't narrow its own return type at the call site) -
      // confirmedWakeEvent is always FOLLOWUP_WAKE, so this branch is always
      // taken; the check itself is what lets TypeScript narrow
      // dispatchOutcome.result to DispatchDraftedFollowUpMessageResult below.
      if (dispatchOutcome.type !== "FOLLOWUP_WAKE") {
        throw new Error(`agent_runtime_event_unexpected_result_type:${dispatchOutcome.type}`);
      }
      const dispatch = dispatchOutcome.result;

      if (dispatch.status === "sent") {
        log(`[worker:followup] dispatched follow-up for ${candidate.wa_id} via the canonical outbound path`);

        // CAS guard: only this claim's own 'executing' row may complete it, so a
        // concurrent cancellation (e.g. an operator taking control mid-flight)
        // is never silently clobbered by a late completion write.
        await safeQueryRows(
          `UPDATE crm_agent_actions SET status = 'executed', executed_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3) WHERE action_id = ? AND status = 'executing'`,
          [candidate.action_id]
        );
        result.executed.push(candidate.action_id);
        result.processed++;
        await recordWake(confirmedWakeEvent, { status: "executed" }, log);
      } else {
        log(`[worker:followup] follow-up dispatch blocked for action ${candidate.action_id}: ${dispatch.reason}`);
        await abortClaimedFollowUp(candidate.action_id, `dispatch_blocked:${dispatch.reason}`);
        result.cancelled.push({ actionId: candidate.action_id, reason: `dispatch_blocked:${dispatch.reason}` });
        await recordWake(confirmedWakeEvent, { status: "cancelled", reason: `dispatch_blocked:${dispatch.reason}` }, log);
      }
    } catch (error) {
      const safeMessage = redactErrorMessage(error) || "unknown";
      log(`[worker:followup] error for action ${candidate.action_id}: ${safeMessage}`);
      // Terminal vs retryable is decided at the next claim attempt (P0-3's
      // attempt_number < max_attempts precondition), not by a distinct status
      // here - a row that ran out of attempts simply never matches that
      // precondition again.
      await safeQueryRows(
        `UPDATE crm_agent_actions SET status = 'failed', failure_reason = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE action_id = ? AND status = 'executing'`,
        [safeMessage, candidate.action_id]
      );
      result.failed.push(candidate.action_id);
      await recordWake(confirmedWakeEvent, { status: "technical_failure", reason: safeMessage }, log);
    }
  }

  return result;
}
