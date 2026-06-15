import type { BrainOutboxStatus, BrainOutboxTransitionResult } from "./types";

const ALLOWED_TRANSITIONS: Record<BrainOutboxStatus, BrainOutboxStatus[]> = {
  planned: ["locked", "blocked"],
  pending: [],
  locked: ["sending", "failed"],
  sending: ["sent", "failed"],
  sent: [],
  failed: [],
  cancelled: [],
  blocked: []
};

function isAllowedTransition(fromStatus: BrainOutboxStatus, toStatus: BrainOutboxStatus) {
  return ALLOWED_TRANSITIONS[fromStatus]?.includes(toStatus) ?? false;
}

function buildBaseResult(
  outboxId: number | null,
  dedupeKey: string,
  fromStatus: BrainOutboxStatus,
  toStatus: BrainOutboxStatus,
  simulated: boolean,
  applied: boolean,
  reason: string,
  blockedReasons: string[] = [],
  warnings: string[] = [],
  metadata?: Record<string, unknown>
): BrainOutboxTransitionResult {
  return {
    outbox_id: outboxId,
    dedupe_key: dedupeKey,
    from_status: fromStatus,
    to_status: toStatus,
    allowed: true,
    applied,
    simulated,
    retryable: toStatus === "failed" || toStatus === "sending",
    reason,
    blocked_reasons: blockedReasons,
    warnings,
    metadata
  };
}

export function transitionOutboxStatus(input: {
  outboxId?: number | null;
  dedupeKey: string;
  fromStatus: BrainOutboxStatus;
  toStatus: BrainOutboxStatus;
  simulated?: boolean;
  applied?: boolean;
  reason?: string;
  lockedAt?: string | null;
  failedAt?: string | null;
  warnings?: string[];
  metadata?: Record<string, unknown>;
}): BrainOutboxTransitionResult {
  const simulated = input.simulated ?? false;
  const applied = input.applied ?? false;
  const reason = input.reason ?? `${input.fromStatus} -> ${input.toStatus}`;
  if (!isAllowedTransition(input.fromStatus, input.toStatus)) {
    return {
      outbox_id: input.outboxId ?? null,
      dedupe_key: input.dedupeKey,
      from_status: input.fromStatus,
      to_status: input.toStatus,
      allowed: false,
      applied: false,
      simulated,
      retryable: false,
      reason: `Transition ${input.fromStatus} -> ${input.toStatus} is not allowed.`,
      blocked_reasons: ["invalid_transition"],
      warnings: input.warnings ?? [],
      locked_at: input.lockedAt ?? null,
      failed_at: input.failedAt ?? null,
      metadata: input.metadata
    };
  }

  const transitionWarnings = [...(input.warnings ?? [])];
  if (input.toStatus === "blocked") {
    transitionWarnings.push("Outbox record blocked in skeleton mode.");
  }
  if (input.toStatus === "failed") {
    transitionWarnings.push("Failure transition is reserved for worker handling in a later milestone.");
  }

  return buildBaseResult(
    input.outboxId ?? null,
    input.dedupeKey,
    input.fromStatus,
    input.toStatus,
    simulated,
    applied,
    reason,
    input.toStatus === "blocked" ? ["blocked_by_policy"] : [],
    transitionWarnings,
    {
      ...input.metadata,
      locked_at: input.lockedAt ?? null,
      failed_at: input.failedAt ?? null
    }
  );
}
