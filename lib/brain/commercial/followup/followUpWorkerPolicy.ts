// ACS-R1-05-T03: pure worker-recovery policy for schedule_followup rows.
// No DB access here - the worker (runFollowupTick.ts) enforces the same
// conditions atomically via CAS UPDATE...WHERE. Kept separate from
// lib/brain/messaging/outboxWorker.ts's isStaleLockedTimestamp: same concept
// (a lock/timestamp comparison), independent domain, no shared import.

// A worker crash can strand a row in 'executing' forever (no reaper existed
// before T03). 5 minutes is well above the ~30s default poll interval
// (scripts/autonomous-followup-worker.ts) and above a realistic single
// runNativeAutonomousCycle call (LLM-backed), so a live worker's own row is
// never mistaken for abandoned.
export const FOLLOW_UP_STALE_EXECUTING_LOCK_SECONDS = 300;

// Statuses the worker may attempt to claim (each via its own CAS):
// - planned: the normal due follow-up.
// - executing: only recoverable when stale + attempts remain (P0-2).
// - failed: only retryable when attempts remain (P0-3).
export const FOLLOW_UP_CLAIMABLE_STATUSES = ["planned", "executing", "failed"] as const;
export type FollowUpClaimableStatus = (typeof FOLLOW_UP_CLAIMABLE_STATUSES)[number];

export function isClaimableFollowUpStatus(status: string): status is FollowUpClaimableStatus {
  return (FOLLOW_UP_CLAIMABLE_STATUSES as readonly string[]).includes(status);
}

// Statuses cancelFollowUp may transition out of (P1-1). executing/executed/
// cancelled/requires_review are never overwritten by this precondition -
// executing is owned by whichever claim CAS won, executed/cancelled are
// terminal, and requires_review is a distinct operator-facing state.
export const FOLLOW_UP_CANCELABLE_STATUSES = ["planned", "failed"] as const;
export type FollowUpCancelableStatus = (typeof FOLLOW_UP_CANCELABLE_STATUSES)[number];

export function isCancelableFollowUpStatus(status: string): status is FollowUpCancelableStatus {
  return (FOLLOW_UP_CANCELABLE_STATUSES as readonly string[]).includes(status);
}

export function hasAttemptsRemaining(attemptNumber: number, maxAttempts: number): boolean {
  return attemptNumber < maxAttempts;
}

export function nextAttemptNumber(attemptNumber: number): number {
  return attemptNumber + 1;
}

export function isStaleExecutingLock(
  updatedAtMs: number,
  nowMs: number,
  staleLockSeconds: number = FOLLOW_UP_STALE_EXECUTING_LOCK_SECONDS
): boolean {
  return nowMs - updatedAtMs > staleLockSeconds * 1000;
}

// ACS-R1-05-T03.1: fixed, short, PII-free failure_reason for a stale
// 'executing' row that has exhausted max_attempts. Never the raw error that
// stranded the row (that already lived on a prior 'failed' row, if any) -
// this code means specifically "recovered past the lock window with zero
// attempts left", not a cycleRunner error.
export const FOLLOW_UP_STALE_EXECUTION_EXHAUSTED_REASON = "follow_up_stale_execution_exhausted";
