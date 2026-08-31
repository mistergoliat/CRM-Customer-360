// SALES-AGENT-R3-A05.

import { buildFollowUpWakeId } from "../agent-session/dedupe";
import type { FollowUpWakeEvent, FollowUpWakeReason } from "../agent-runtime-event/types";

/**
 * Derives the wake reason and the attempt number this wake actually
 * represents from the candidate's PRE-claim status (runFollowupTick.ts
 * already documents that candidate.status holds the pre-claim value - see
 * claimFollowUpCandidate). 'executing'/'failed' claims bump attempt_number
 * by exactly 1 as part of their own CAS UPDATE (claimStaleExecutingFollowUp/
 * claimFailedFollowUpRetry) - this mirrors that arithmetic rather than
 * re-reading the row, so the wakeId this produces matches what is actually
 * persisted after the claim commits.
 */
function deriveReasonAndAttempt(input: { statusPreClaim: string; attemptNumberPreClaim: number }): {
  reason: FollowUpWakeReason;
  attempt: number;
} {
  if (input.statusPreClaim === "executing") return { reason: "stale_recovery", attempt: input.attemptNumberPreClaim + 1 };
  if (input.statusPreClaim === "failed") return { reason: "retry", attempt: input.attemptNumberPreClaim + 1 };
  return { reason: "scheduled_due", attempt: input.attemptNumberPreClaim };
}

export function buildFollowUpWakeEvent(input: {
  actionPublicId: string;
  statusPreClaim: string;
  attemptNumberPreClaim: number;
  conversationId: number;
  opportunityId: number | null;
  correlationId: string;
  causationId?: string | null;
  scheduledFor: string | null;
  firedAt: string;
}): FollowUpWakeEvent {
  const { reason, attempt } = deriveReasonAndAttempt(input);
  return {
    type: "FOLLOWUP_WAKE",
    wakeId: buildFollowUpWakeId(input.actionPublicId, attempt),
    actionPublicId: input.actionPublicId,
    attempt,
    conversationId: input.conversationId,
    opportunityId: input.opportunityId,
    correlationId: input.correlationId,
    causationId: input.causationId ?? null,
    scheduledFor: input.scheduledFor,
    firedAt: input.firedAt,
    reason
  };
}
