import type {
  FollowUpSchedulingDecision,
  FollowUpSchedulingReason,
  FollowUpSchedulingResult,
  FollowUpSchedulingTiming,
  FollowUpSchedulingRetry
} from "./types";

function uniqueReasons(reasons: FollowUpSchedulingReason[]): FollowUpSchedulingReason[] {
  const output: FollowUpSchedulingReason[] = [];
  for (const reason of reasons) {
    if (!output.includes(reason)) {
      output.push(reason);
    }
  }
  return output;
}

export function buildFollowUpDecision(input: {
  decision: FollowUpSchedulingDecision;
  actionId: string;
  reasons: FollowUpSchedulingReason[];
  warnings?: string[];
  originalScheduledFor: string | null;
  effectiveScheduledFor: string | null;
  nextScheduledFor: string | null;
  timing: FollowUpSchedulingTiming;
  retry: FollowUpSchedulingRetry;
}): FollowUpSchedulingResult {
  const reasons = uniqueReasons(input.reasons);
  const warnings = [...new Set(input.warnings ?? [])];

  return {
    decision: input.decision,
    actionable: input.decision === "ready",
    actionId: input.actionId,
    reasons,
    warnings,
    originalScheduledFor: input.originalScheduledFor,
    effectiveScheduledFor: input.effectiveScheduledFor,
    nextScheduledFor: input.nextScheduledFor,
    timing: input.timing,
    retry: input.retry,
    sideEffects: {
      actionUpdated: false,
      actionInserted: false,
      outboxWritten: false,
      messageSent: false,
      workerTriggered: false
    }
  };
}
