import { queryRows } from "@/lib/db";
import { getCommercialWorkByPublicId } from "../repository";
import { settleCommercialWorkProjection } from "../settleCommercialWorkProjection";
import { dispatchCommercialWorkResponse, type DispatchCommercialWorkResponseResult } from "../dispatchCommercialWorkResponse";
import type { PersistedCommercialWork } from "../persistenceTypes";
import type { CommercialWorkStatus } from "../statuses";
import { recordCommercialWorkAsyncDeliveryEvaluatedEvent } from "../../events/service";
import { isBeforeActivationCutoff, isWaIdAllowedByAccessGate, type WhatsAppAccessGateConfig } from "@/lib/brain/runtime/autonomousRuntimeConfig";

/**
 * SALES-AGENT-R3 COMMERCIAL WORK ASYNC RESULT DELIVERY V1.
 *
 * A CommercialWork step that completes inside a live customer turn
 * (runCommercialWorkInboundCycle.ts) already reaches dispatchCommercialWorkResponse
 * synchronously. A step that completes later - claimed and executed by
 * commercialWorkWorker.ts's runCommercialWorkTick, after the original turn
 * already ended - had no such call: executeCommercialWork only persists
 * durable state, it never finalizes or dispatches anything. This module is
 * the seam that closes that gap, reusing the exact same finalizer/dispatch
 * path the synchronous turn already uses - no new finalizer, no new outbox,
 * no new retry engine, no LLM re-entry.
 */

/**
 * There is no real inboundMessageId for a worker-triggered evaluation (no
 * customer message started this attempt) - this fixed discriminator plays
 * that role inside dispatchCommercialWorkResponse's own idempotency key.
 * Uniqueness across repeated evaluations of the SAME delivered result still
 * comes from work.publicId + work.version, an optimistic-concurrency
 * identity only one caller can ever legitimately reach for a given version
 * (see commercialWorkExecutor.ts's expectedVersion check) - never from this
 * string, and never a random UUID.
 */
export const ASYNC_COMMERCIAL_WORK_DELIVERY_SENTINEL = "async-worker-completion";

/**
 * A CommercialWork has "stopped" - nothing will auto-progress it further
 * this tick - only at these statuses. ACTIVE (more READY steps) and
 * WAITING_SYSTEM (a scheduled retry owns it, Harness section 8: worker retry
 * owns it, never a premature customer message) are deliberately excluded.
 * SUPERSEDED is also excluded: current durable truth invalidating a stale
 * objective/step must never be announced as if it were current.
 */
const ASYNC_DELIVERY_DISPATCHABLE_STATUSES = new Set<CommercialWorkStatus>(["COMPLETED", "WAITING_CUSTOMER", "FAILED", "CANCELLED", "HANDOFF"]);

/**
 * "recovery_sweep" is the only source today: sweepUndeliveredCommercialWorkDeliveries
 * runs once at the end of every tick (after the due-step loop), so a work
 * that just settled to a terminal status THIS tick and a work that reached
 * that status in an earlier tick (worker crash recovery) go through the
 * exact same evaluation path - there is no separate "immediate" trigger to
 * distinguish. Kept as a named union (not a bare string) so a future
 * caller-specific trigger can be added without reshaping the observability
 * payload.
 */
export type AsyncCommercialWorkDeliveryTriggerSource = "recovery_sweep";

export type AsyncCommercialWorkDeliveryResult = {
  workPublicId: string;
  status: CommercialWorkStatus | null;
  version: number | null;
  dispatchWorthy: boolean;
  dispatched: boolean;
  outboxWritten: boolean;
  reason: string;
  dispatch: DispatchCommercialWorkResponseResult | null;
};

function skipped(workPublicId: string, reason: string, work?: PersistedCommercialWork | null): AsyncCommercialWorkDeliveryResult {
  return {
    workPublicId,
    status: work?.status ?? null,
    version: work?.version ?? null,
    dispatchWorthy: false,
    dispatched: false,
    outboxWritten: false,
    reason,
    dispatch: null
  };
}

type DispatchContextRow = {
  external_contact_id: string | null;
  status: string | null;
  human_owner_active: number | boolean;
  ai_enabled: number | boolean;
};

/**
 * Read fresh, right before dispatch - never a value captured earlier in this
 * tick. This is what lets a human handoff (or ai_enabled=false) that becomes
 * active AFTER a capability already succeeded still block the autonomous
 * customer-visible send (Harness requirement: no AI message races the human
 * owner). The actual blocking decision is made by the existing execution
 * gate (evaluateExecutionGate.ts), not duplicated here - this only supplies
 * it fresh input.
 */
async function loadFreshDispatchContext(conversationId: number): Promise<{ waId: string | null; conversationStatus: string | null; humanOwnerActive: boolean; aiEnabled: boolean }> {
  const rows = await queryRows<DispatchContextRow>(
    `SELECT external_contact_id, status, human_owner_active, ai_enabled FROM conversation WHERE id = ? LIMIT 1`,
    [conversationId]
  );
  const row = rows[0];
  return {
    waId: row?.external_contact_id ?? null,
    conversationStatus: row?.status ?? null,
    humanOwnerActive: Boolean(row?.human_owner_active),
    aiEnabled: row ? Boolean(row.ai_enabled) : true
  };
}

async function loadOpportunityStatus(opportunityId: number | null): Promise<string | null> {
  if (opportunityId === null) return null;
  const rows = await queryRows<{ status: string | null }>(`SELECT status FROM crm_opportunities WHERE id = ? LIMIT 1`, [opportunityId]);
  return rows[0]?.status ?? null;
}

async function safeRecordEvaluatedEvent(input: {
  triggerSource: AsyncCommercialWorkDeliveryTriggerSource;
  correlationId: string;
  work: PersistedCommercialWork;
  dispatchWorthy: boolean;
  dispatch: DispatchCommercialWorkResponseResult | null;
}): Promise<void> {
  try {
    await recordCommercialWorkAsyncDeliveryEvaluatedEvent({
      triggerSource: input.triggerSource,
      workPublicId: input.work.publicId,
      workVersion: input.work.version,
      workStatus: input.work.status,
      dispatchWorthy: input.dispatchWorthy,
      dispatched: input.dispatch?.attempted ?? false,
      outboxWritten: input.dispatch?.outboxWritten ?? false,
      disposition: input.dispatch?.disposition ?? null,
      suppressionReason: input.dispatch ? (input.dispatch.executionGate?.blockReasons[0] ?? null) : null,
      actionPersistenceStatus: input.dispatch?.actionPersistence?.status ?? null,
      correlationId: input.correlationId,
      conversationId: input.work.conversationId,
      opportunityId: input.work.opportunityId
    });
  } catch {
    // Observability must never block delivery - the dispatch call above (or
    // the skip decision) already happened and is the real source of truth.
  }
}

/**
 * Reload current durable truth, settle it to a stable point (the same
 * projection cascade the synchronous turn already runs after its own
 * executeCommercialWork call), and - only if that settled state is one this
 * customer has not already been told about - dispatch through the existing
 * action-queue -> execution-gate -> outbox path. Safe to call repeatedly for
 * the same work: a settled work that is not dispatch-worthy is a no-op, and
 * a dispatch-worthy one reuses dispatchCommercialWorkResponse's own
 * idempotency (keyed on work.publicId + work.version), so a duplicate call
 * for an already-delivered version never sends a second message.
 */
export async function evaluateAndDispatchAsyncCommercialWorkDelivery(input: {
  workPublicId: string;
  correlationId: string;
  currentTime: string;
  triggerSource: AsyncCommercialWorkDeliveryTriggerSource;
}): Promise<AsyncCommercialWorkDeliveryResult> {
  let work = await getCommercialWorkByPublicId(input.workPublicId);
  if (!work) return skipped(input.workPublicId, "commercial_work_not_found");
  if (typeof work.opportunityId !== "number") return skipped(input.workPublicId, "missing_opportunity", work);

  work = await settleCommercialWorkProjection({
    work,
    conversationId: work.conversationId,
    opportunityId: work.opportunityId,
    correlationId: input.correlationId,
    now: new Date(input.currentTime)
  });

  const dispatchWorthy = ASYNC_DELIVERY_DISPATCHABLE_STATUSES.has(work.status);
  if (!dispatchWorthy) {
    await safeRecordEvaluatedEvent({ triggerSource: input.triggerSource, correlationId: input.correlationId, work, dispatchWorthy, dispatch: null });
    return skipped(work.publicId, `not_dispatch_worthy:${work.status}`, work);
  }

  const [context, opportunityStatus] = await Promise.all([loadFreshDispatchContext(work.conversationId), loadOpportunityStatus(work.opportunityId)]);
  if (!context.waId) {
    await safeRecordEvaluatedEvent({ triggerSource: input.triggerSource, correlationId: input.correlationId, work, dispatchWorthy, dispatch: null });
    return skipped(work.publicId, "missing_wa_id", work);
  }

  const dispatch = await dispatchCommercialWorkResponse({
    conversationId: work.conversationId,
    // PersistedCommercialWork carries no separate case id - reusing
    // conversationId as the case id is the same substitute
    // followup/objectiveAwareFollowUp.ts's buildScheduleAction already uses
    // for this exact type.
    conversationCaseId: work.conversationId,
    opportunityId: work.opportunityId,
    waId: context.waId,
    inboundMessageId: ASYNC_COMMERCIAL_WORK_DELIVERY_SENTINEL,
    currentTime: input.currentTime,
    humanOwnerActive: context.humanOwnerActive,
    aiBlocked: !context.aiEnabled,
    caseStatus: opportunityStatus ?? context.conversationStatus,
    work
  });

  await safeRecordEvaluatedEvent({ triggerSource: input.triggerSource, correlationId: input.correlationId, work, dispatchWorthy, dispatch });

  return {
    workPublicId: work.publicId,
    status: work.status,
    version: work.version,
    dispatchWorthy,
    dispatched: dispatch.attempted,
    outboxWritten: dispatch.outboxWritten,
    reason: dispatch.attempted ? `dispatched:${dispatch.disposition}` : `dispatch_not_attempted:${dispatch.warnings[0] ?? "unknown"}`,
    dispatch
  };
}

function toMysqlDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return (Number.isNaN(date.getTime()) ? new Date() : date).toISOString().slice(0, 23).replace("T", " ");
}

function subtractMinutes(value: string | Date, minutes: number): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Date((Number.isNaN(date.getTime()) ? Date.now() : date.getTime()) - minutes * 60_000).toISOString();
}

type UndeliveredCommercialWorkCandidateRow = {
  work_public_id: string;
  wa_id: string | null;
  work_created_at: string | null;
};

async function selectUndeliveredCommercialWorkCandidates(input: {
  lookbackMinutes: number;
  limit: number;
  workPublicIds?: string[];
}): Promise<UndeliveredCommercialWorkCandidateRow[]> {
  // Deliberately real wall-clock time, never the caller's (possibly
  // fictional/test) `now` - crm_commercial_work.updated_at is populated by
  // MariaDB's own ON UPDATE CURRENT_TIMESTAMP(3) (migrations/029), a real
  // server timestamp, so "how far back to look for undelivered rows" is
  // fundamentally about real elapsed recovery time, not business-logic time.
  const since = toMysqlDateTime(subtractMinutes(new Date(), input.lookbackMinutes));
  const scopedIds = [...new Set((input.workPublicIds ?? []).filter((value) => typeof value === "string" && value.trim()))];
  const scopeSql = scopedIds.length > 0 ? `AND w.public_id IN (${scopedIds.map(() => "?").join(",")})` : "";
  return queryRows<UndeliveredCommercialWorkCandidateRow>(
    `SELECT w.public_id AS work_public_id, c.external_contact_id AS wa_id, w.created_at AS work_created_at
      FROM crm_commercial_work w
      LEFT JOIN conversation c ON c.id = w.conversation_id
      WHERE w.status IN ('COMPLETED', 'WAITING_CUSTOMER', 'FAILED', 'CANCELLED', 'HANDOFF')
        AND w.updated_at >= ?
        ${scopeSql}
      ORDER BY w.updated_at DESC
      LIMIT ?`,
    [since, ...scopedIds, input.limit]
  );
}

export type SweepUndeliveredCommercialWorkDeliveriesInput = {
  now: string | Date;
  lookbackMinutes: number;
  batchSize: number;
  workPublicIds?: string[];
  activationCutoff?: string | null;
  whatsAppAccessGate?: WhatsAppAccessGateConfig | null;
  isWaIdEligibleForCommercialWork?: (waId: string | null | undefined) => boolean;
  correlationPrefix?: string;
};

export type SweepUndeliveredCommercialWorkDeliveriesResult = {
  candidates: number;
  evaluated: number;
  dispatched: number;
  skipped: Array<{ workPublicId: string; reason: string }>;
};

/**
 * Crash-recovery counterpart to the immediate per-step evaluation: catches a
 * CommercialWork that reached a dispatch-worthy status but was never
 * confirmed delivered (worker process crash between capability success and
 * dispatch, or between action creation and outbox completion). Bounded to a
 * recent window so a freshly-restarted worker never re-scans the entire
 * historical backlog. Every candidate is re-evaluated through the exact same
 * evaluateAndDispatchAsyncCommercialWorkDelivery function above, so repeated
 * sweeps over an already-delivered work are the same safe no-op a duplicate
 * immediate call would be.
 * ponytail: revisits already-delivered rows every tick within the lookback
 * window rather than tracking a "last swept" watermark - cheap at this
 * pilot's scale (idempotent, indexed query); add a watermark if sweep volume
 * ever becomes measurable.
 */
export async function sweepUndeliveredCommercialWorkDeliveries(input: SweepUndeliveredCommercialWorkDeliveriesInput): Promise<SweepUndeliveredCommercialWorkDeliveriesResult> {
  const candidates = await selectUndeliveredCommercialWorkCandidates({
    lookbackMinutes: input.lookbackMinutes,
    limit: input.batchSize,
    workPublicIds: input.workPublicIds
  });

  const result: SweepUndeliveredCommercialWorkDeliveriesResult = { candidates: candidates.length, evaluated: 0, dispatched: 0, skipped: [] };
  const currentTimeIso = input.now instanceof Date ? input.now.toISOString() : new Date(input.now).toISOString();

  for (const candidate of candidates) {
    if (isBeforeActivationCutoff(candidate.work_created_at, input.activationCutoff ?? null)) {
      result.skipped.push({ workPublicId: candidate.work_public_id, reason: "skipped_before_activation_cutoff" });
      continue;
    }
    if (input.whatsAppAccessGate && !isWaIdAllowedByAccessGate(candidate.wa_id, input.whatsAppAccessGate)) {
      result.skipped.push({ workPublicId: candidate.work_public_id, reason: "skipped_access_gate" });
      continue;
    }
    if (input.isWaIdEligibleForCommercialWork && !input.isWaIdEligibleForCommercialWork(candidate.wa_id)) {
      result.skipped.push({ workPublicId: candidate.work_public_id, reason: "skipped_r2_ineligible" });
      continue;
    }

    const outcome = await evaluateAndDispatchAsyncCommercialWorkDelivery({
      workPublicId: candidate.work_public_id,
      correlationId: `${input.correlationPrefix ?? "commercial-work-async-delivery-sweep"}:${candidate.work_public_id}`,
      currentTime: currentTimeIso,
      triggerSource: "recovery_sweep"
    });
    result.evaluated += 1;
    if (outcome.dispatched && outcome.outboxWritten) result.dispatched += 1;
    else result.skipped.push({ workPublicId: candidate.work_public_id, reason: outcome.reason });
  }

  return result;
}
