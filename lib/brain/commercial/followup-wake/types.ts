// SALES-AGENT-R3-A05.

import type { FollowUpWakeEvent } from "../agent-runtime-event/types";

export type { FollowUpWakeEvent, FollowUpWakeReason } from "../agent-runtime-event/types";

/**
 * What a fired wake actually resolved to, once eligibility/revalidation ran.
 * Deliberately reuses the outcome shape runFollowupTick.ts/
 * objectiveAwareFollowUp.ts already compute (proceed/cancel/reschedule/
 * technical_failure, sent/cancelled/failed) - this is the AgentSession-
 * observable projection of that existing decision, not a second taxonomy.
 */
export type FollowUpWakeDisposition =
  | { status: "executed" }
  | { status: "cancelled"; reason: string }
  | { status: "rescheduled"; reason: string; scheduledFor: string }
  | { status: "technical_failure"; reason: string }
  | { status: "skipped"; reason: string };

export type FollowUpWakeSessionEventInput = {
  event: FollowUpWakeEvent;
  disposition: FollowUpWakeDisposition;
};
