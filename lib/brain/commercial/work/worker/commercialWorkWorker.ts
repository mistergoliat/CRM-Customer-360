import { randomUUID } from "node:crypto";
import { safeExecute, queryRows } from "@/lib/db";
import type { CapabilityGatewayContext } from "@/lib/brain/commercial/capability-gateway";
import type { ExecuteCommercialWorkInput } from "../commercialWorkExecutor";
import { executeCommercialWork } from "../commercialWorkExecutor";
import { deriveCommercialWorkMetrics } from "../evaluateCommercialWork";
import type { PersistedCommercialWork } from "../persistenceTypes";
import { getCommercialWorkByPublicId, updateCommercialWorkAggregate } from "../repository";
import { getCommercialWorkRetryPolicy } from "../retryPolicy";
import type { CommercialWork, CommercialWorkBlocker, CommercialWorkStep } from "../types";
import { shouldRouteToCommercialWork } from "../../config/commercialCycleConfig";
import {
  loadAutonomousResponsesEnabled,
  loadWhatsAppAccessGateConfig,
  isWaIdAllowedByAccessGate,
  type WhatsAppAccessGateConfig
} from "@/lib/brain/runtime/autonomousRuntimeConfig";

export const DEFAULT_COMMERCIAL_WORK_WORKER_BATCH_SIZE = 5;
export const DEFAULT_COMMERCIAL_WORK_STEP_LOCK_SECONDS = 60;

export type DueCommercialWorkStepRow = {
  work_public_id: string;
  work_version: number;
  opportunity_id: number | null;
  conversation_id: number;
  step_id: string;
  step_type: CommercialWorkStep["type"];
  step_status: CommercialWorkStep["status"];
  attempt_count: number;
  max_attempts: number | null;
  next_attempt_at: string | null;
  lock_owner: string | null;
  lock_until: string | null;
  /** SALES-AGENT-R2-A11, Part 13/14. The conversation's external contact id - resolved here so the worker can revalidate the WhatsApp access gate and R2 eligibility fresh, before claiming, for a step that may have been created long before this tick runs. Optional so existing test fixtures need no update. */
  wa_id?: string | null;
};

export type CommercialWorkTickOptions = {
  batchSize?: number;
  now?: string | Date;
  workerId?: string;
  lockSeconds?: number;
  executeCommercialWorkFn?: typeof executeCommercialWork;
  context?: Partial<CapabilityGatewayContext>;
  loadCurrentFacts?: ExecuteCommercialWorkInput["loadCurrentFacts"];
  loadConversationControl?: ExecuteCommercialWorkInput["loadConversationControl"];
  executeCapability?: ExecuteCommercialWorkInput["executeCapability"];
  onAfterClaim?: (candidate: DueCommercialWorkStepRow) => Promise<void> | void;
  workPublicIds?: string[];
  /** SALES-AGENT-R2-A09, Part 24. The worker's own CAS-claimed step always executes alone (executeCommercialWork's selectReadyCandidates never widens a claimed step's own round) - these only affect any CASCADE rounds within the same tick, after the claimed step's round completes. Default OFF, same as the executor's own default. */
  parallelExecutionEnabled?: boolean;
  maxParallelSteps?: number;
  /** SALES-AGENT-R2-A11, Part 12. Test-only injection point; production callers default to the real env-backed reader. */
  autonomousResponsesEnabled?: boolean;
  /** A11, Part 13. Test-only injection point; production callers default to the real env-backed reader. */
  whatsAppAccessGate?: WhatsAppAccessGateConfig;
  /**
   * A11, Part 14. Test-only injection point; production callers default to
   * the real shouldRouteToCommercialWork. A pre-A11 test exercising the
   * worker's own retry/claim mechanics (not rollout policy) can pass
   * `() => true` here - it is testing something orthogonal to whether this
   * specific wa_id is currently R2-allowlisted.
   */
  isWaIdEligibleForCommercialWork?: (waId: string | null | undefined) => boolean;
};

export type CommercialWorkTickResult = {
  workerId: string;
  selected: number;
  claimed: number;
  executed: number;
  completed: number;
  retryScheduled: number;
  failed: number;
  staleRecovered: number;
  skipped: Array<{ workPublicId: string; stepId: string; reason: string }>;
  versionConflicts: Array<{ workPublicId: string; stepId: string }>;
};

function toIso(value: string | Date | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }
  return new Date().toISOString();
}

function toMysqlDateTime(value: string | Date): string {
  return toIso(value).slice(0, 23).replace("T", " ");
}

function addSeconds(value: string | Date, seconds: number): string {
  return new Date(new Date(toIso(value)).getTime() + Math.max(1, seconds) * 1000).toISOString();
}

function normalizeBatchSize(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return DEFAULT_COMMERCIAL_WORK_WORKER_BATCH_SIZE;
  return Math.max(1, Math.min(Math.floor(value!), 100));
}

export async function selectDueCommercialWorkSteps(input: { limit: number; now: string | Date; workPublicIds?: string[] }): Promise<DueCommercialWorkStepRow[]> {
  const nowMysql = toMysqlDateTime(input.now);
  const scopedIds = [...new Set((input.workPublicIds ?? []).filter((value) => typeof value === "string" && value.trim()))];
  const scopeSql = scopedIds.length > 0 ? `AND w.public_id IN (${scopedIds.map(() => "?").join(",")})` : "";
  return queryRows<DueCommercialWorkStepRow>(
    `SELECT
        w.public_id AS work_public_id,
        w.version AS work_version,
        w.opportunity_id,
        w.conversation_id,
        s.public_id AS step_id,
        s.step_type,
        s.status AS step_status,
        s.attempt_count,
        s.max_attempts,
        s.next_attempt_at,
        s.lock_owner,
        s.lock_until,
        c.external_contact_id AS wa_id
      FROM crm_commercial_work_steps s
      INNER JOIN crm_commercial_work w ON w.id = s.commercial_work_id
      LEFT JOIN conversation c ON c.id = w.conversation_id
      WHERE w.status IN ('ACTIVE', 'WAITING_SYSTEM')
        ${scopeSql}
        AND (
          s.status = 'READY'
          OR (s.status = 'RETRY_SCHEDULED' AND s.next_attempt_at IS NOT NULL AND s.next_attempt_at <= ?)
          OR (s.status = 'RUNNING' AND (s.lock_until IS NULL OR s.lock_until < ?))
        )
      ORDER BY COALESCE(s.next_attempt_at, s.updated_at) ASC, s.id ASC
      LIMIT ?`,
    [...scopedIds, nowMysql, nowMysql, input.limit]
  );
}

export async function claimDueCommercialWorkStep(candidate: DueCommercialWorkStepRow, input: { workerId: string; now: string | Date; lockSeconds: number }): Promise<boolean> {
  const policy = getCommercialWorkRetryPolicy({ type: candidate.step_type });
  const maxAttempts = candidate.max_attempts ?? policy?.maxAttempts ?? 1;
  const nowMysql = toMysqlDateTime(input.now);
  const lockUntil = toMysqlDateTime(addSeconds(input.now, input.lockSeconds));
  const result = await safeExecute(
    `UPDATE crm_commercial_work_steps s
      INNER JOIN crm_commercial_work w ON w.id = s.commercial_work_id
      SET
        s.status = 'RUNNING',
        s.lock_owner = ?,
        s.lock_until = ?,
        s.started_at = COALESCE(s.started_at, ?),
        s.last_attempt_at = ?,
        s.next_attempt_at = NULL,
        s.max_attempts = COALESCE(s.max_attempts, ?),
        s.attempt_count = s.attempt_count + 1,
        s.retryable = 0,
        s.retry_candidate = 0
      WHERE w.public_id = ?
        AND w.version = ?
        AND w.status IN ('ACTIVE', 'WAITING_SYSTEM')
        AND s.public_id = ?
        AND s.attempt_count < COALESCE(s.max_attempts, ?)
        AND (
          s.status = 'READY'
          OR (s.status = 'RETRY_SCHEDULED' AND s.next_attempt_at IS NOT NULL AND s.next_attempt_at <= ?)
          OR (s.status = 'RUNNING' AND (s.lock_until IS NULL OR s.lock_until < ?))
        )`,
    [
      input.workerId,
      lockUntil,
      nowMysql,
      nowMysql,
      maxAttempts,
      candidate.work_public_id,
      candidate.work_version,
      candidate.step_id,
      maxAttempts,
      nowMysql,
      nowMysql
    ]
  );
  return result.ok && result.affectedRows === 1;
}

function failureBlocker(step: CommercialWorkStep): CommercialWorkBlocker[] {
  return step.objectiveIds.map((objectiveId) => ({ code: "CAPABILITY_UNAVAILABLE", source: "step", objectiveId, stepId: step.stepId }));
}

async function terminalizeExhaustedRetry(candidate: DueCommercialWorkStepRow): Promise<PersistedCommercialWork | null> {
  const work = await getCommercialWorkByPublicId(candidate.work_public_id);
  if (!work || work.version !== candidate.work_version) return null;
  const steps = work.steps.map((step) =>
    step.stepId === candidate.step_id
      ? {
          ...step,
          status: "FAILED" as const,
          retryable: false,
          retryCandidate: false,
          nextAttemptAt: null,
          lockOwner: null,
          lockUntil: null,
          startedAt: null,
          blockers: failureBlocker(step)
        }
      : step
  );
  const objectives = work.objectives.map((objective) =>
    steps.some((step) => step.objectiveIds.includes(objective.objectiveId) && step.status === "FAILED")
      ? { ...objective, status: "FAILED" as const }
      : objective
  );
  const failed = { ...work, status: "FAILED" as const, objectives, steps, blockers: steps.flatMap((step) => step.blockers), derivedAt: new Date().toISOString() };
  const nextWork: CommercialWork = { ...failed, metrics: deriveCommercialWorkMetrics(failed) };
  return updateCommercialWorkAggregate({ publicId: work.publicId, expectedVersion: work.version, nextWork });
}

export async function runCommercialWorkTick(options: CommercialWorkTickOptions = {}): Promise<CommercialWorkTickResult> {
  const batchSize = normalizeBatchSize(options.batchSize);
  const now = options.now ?? new Date();
  const workerId = options.workerId ?? `commercial-work-worker:${randomUUID()}`;
  const lockSeconds = options.lockSeconds ?? DEFAULT_COMMERCIAL_WORK_STEP_LOCK_SECONDS;
  const executeFn = options.executeCommercialWorkFn ?? executeCommercialWork;
  const result: CommercialWorkTickResult = {
    workerId,
    selected: 0,
    claimed: 0,
    executed: 0,
    completed: 0,
    retryScheduled: 0,
    failed: 0,
    staleRecovered: 0,
    skipped: [],
    versionConflicts: []
  };

  const candidates = await selectDueCommercialWorkSteps({ limit: batchSize, now, workPublicIds: options.workPublicIds });
  result.selected = candidates.length;

  // SALES-AGENT-R2-A11, Part 12/13/14. Read once per tick - a claimed step
  // may have been created long before this tick runs, so its eligibility is
  // revalidated fresh here, never assumed from when it was created.
  const autonomyEnabled = options.autonomousResponsesEnabled ?? loadAutonomousResponsesEnabled();
  const accessGate = options.whatsAppAccessGate ?? loadWhatsAppAccessGateConfig();

  for (const candidate of candidates) {
    // A11 Part 4/12: the global autonomy killswitch - checked before any
    // claim, so a disabled worker leaves every due row untouched (retriable
    // once autonomy is re-enabled), never partially claimed.
    if (!autonomyEnabled) {
      result.skipped.push({ workPublicId: candidate.work_public_id, stepId: candidate.step_id, reason: "skipped_autonomy_disabled" });
      continue;
    }
    // A11 Part 13: a work item created for a non-test wa_id must not bypass
    // the access gate merely because it is being resumed by a background
    // worker - resolved and revalidated fresh here (never from creation time).
    if (!isWaIdAllowedByAccessGate(candidate.wa_id, accessGate)) {
      result.skipped.push({ workPublicId: candidate.work_public_id, stepId: candidate.step_id, reason: "skipped_access_gate" });
      continue;
    }
    // A11 Part 14: a stale historical R2 work item must not bypass current
    // rollout policy - re-checked against the live R2 allowlist every tick,
    // never assumed from when the work was created.
    const eligibleForCommercialWork = options.isWaIdEligibleForCommercialWork ?? shouldRouteToCommercialWork;
    if (!eligibleForCommercialWork(candidate.wa_id)) {
      result.skipped.push({ workPublicId: candidate.work_public_id, stepId: candidate.step_id, reason: "skipped_r2_ineligible" });
      continue;
    }

    const policy = getCommercialWorkRetryPolicy({ type: candidate.step_type });
    const maxAttempts = candidate.max_attempts ?? policy?.maxAttempts ?? 1;
    if (candidate.attempt_count >= maxAttempts) {
      const failed = await terminalizeExhaustedRetry(candidate);
      if (failed) result.failed += 1;
      else result.skipped.push({ workPublicId: candidate.work_public_id, stepId: candidate.step_id, reason: "retry_exhaustion_conflict" });
      continue;
    }

    const claimed = await claimDueCommercialWorkStep(candidate, { workerId, now, lockSeconds });
    if (!claimed) {
      result.skipped.push({ workPublicId: candidate.work_public_id, stepId: candidate.step_id, reason: "already_claimed" });
      continue;
    }
    result.claimed += 1;
    if (options.onAfterClaim) await options.onAfterClaim(candidate);

    const execution = await executeFn({
      workPublicId: candidate.work_public_id,
      expectedVersion: candidate.work_version,
      context: {
        correlationId: `commercial-work:${candidate.work_public_id}:${candidate.step_id}:${workerId}`,
        conversationId: candidate.conversation_id,
        opportunityId: candidate.opportunity_id,
        ...options.context
      },
      claimedStepId: candidate.step_id,
      workerId,
      scheduleRetries: true,
      now,
      loadCurrentFacts: options.loadCurrentFacts,
      loadConversationControl: options.loadConversationControl,
      executeCapability: options.executeCapability,
      parallelExecutionEnabled: options.parallelExecutionEnabled,
      maxParallelSteps: options.maxParallelSteps
    });

    if (execution.outcome === "version_conflict") {
      result.versionConflicts.push({ workPublicId: candidate.work_public_id, stepId: candidate.step_id });
      continue;
    }

    if (execution.records.length > 0) result.executed += execution.records.length;
    if (execution.work?.status === "COMPLETED") result.completed += 1;
    if (execution.work?.steps.some((step) => step.status === "RETRY_SCHEDULED")) result.retryScheduled += 1;
    if (execution.work?.steps.some((step) => step.status === "FAILED")) result.failed += 1;
    if (candidate.step_status === "RUNNING" && execution.records.some((record) => record.status === "completed" && !record.gatewayStatus)) {
      result.staleRecovered += 1;
    }
  }

  return result;
}
