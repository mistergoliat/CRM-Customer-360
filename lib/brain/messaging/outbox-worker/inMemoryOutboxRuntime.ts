import { evaluateOutboxCandidate } from "./evaluateOutboxCandidate";
import { clone, normalizeIsoTimestamp } from "./constants";
import type {
  OutboxMessageRecord,
  OutboxWorkerApplyResult,
  OutboxWorkerMutationPlan,
  OutboxWorkerRepositorySnapshot
} from "./types";
import type { OutboxWorkerRepository, OutboxWorkerRepositoryFailureFlags, OutboxWorkerUnitOfWork } from "./repositories";

type InMemoryOutboxWorkerState = OutboxWorkerRepositorySnapshot;

function buildInitialState(initialRecords: OutboxMessageRecord[] = [], nextRowId?: number): InMemoryOutboxWorkerState {
  return {
    records: initialRecords.map((record) => clone(record)),
    auditEvents: [],
    appliedPlanKeys: [],
    nextRowId: nextRowId ?? initialRecords.length + 1
  };
}

function normalizeRowId(rowId: number | string | null) {
  if (typeof rowId === "number" && Number.isFinite(rowId)) return rowId;
  if (typeof rowId === "string" && rowId.trim()) return rowId;
  return null;
}

function sameRowId(a: number | string | null, b: number | string | null) {
  if (a === null || b === null) return false;
  return String(a) === String(b);
}

function hasOtherRecordWithSameIdempotencyKey(records: OutboxMessageRecord[], candidate: OutboxMessageRecord) {
  return records.some((record) => !sameRowId(record.rowId, candidate.rowId) && record.idempotencyKey === candidate.idempotencyKey);
}

function listIncludes<T extends string>(values: readonly T[] | T[] | T | undefined, candidate: string) {
  if (!values) return false;
  if (typeof values === "string") return values === candidate;
  return (values as readonly string[]).includes(candidate);
}

export class InMemoryOutboxWorkerRepository implements OutboxWorkerRepository {
  private state: InMemoryOutboxWorkerState;
  private readonly failureFlags: OutboxWorkerRepositoryFailureFlags;

  constructor(initialRecords: OutboxMessageRecord[] = [], options: { failureFlags?: OutboxWorkerRepositoryFailureFlags; nextRowId?: number } = {}) {
    this.state = buildInitialState(initialRecords, options.nextRowId);
    this.failureFlags = { ...(options.failureFlags ?? {}) };
  }

  static fromState(state: OutboxWorkerRepositorySnapshot, failureFlags: OutboxWorkerRepositoryFailureFlags = {}) {
    const repo = new InMemoryOutboxWorkerRepository([], { failureFlags, nextRowId: state.nextRowId });
    repo.state = clone(state);
    return repo;
  }

  snapshot(): OutboxMessageRecord[] {
    return this.state.records.map((record) => clone(record));
  }

  snapshotState(): InMemoryOutboxWorkerState {
    return clone(this.state);
  }

  snapshotFailureFlags(): OutboxWorkerRepositoryFailureFlags {
    return clone(this.failureFlags);
  }

  replaceWith(other: InMemoryOutboxWorkerRepository) {
    this.state = other.snapshotState();
  }

  seed(record: OutboxMessageRecord) {
    const rowId = normalizeRowId(record.rowId) ?? this.state.nextRowId++;
    this.state.records.push({ ...clone(record), rowId });
  }

  setFailureFlags(flags: Partial<OutboxWorkerRepositoryFailureFlags>) {
    this.failureFlags.failNextFindByIdempotencyKey = flags.failNextFindByIdempotencyKey ?? this.failureFlags.failNextFindByIdempotencyKey;
    this.failureFlags.failNextClaimAvailable = flags.failNextClaimAvailable ?? this.failureFlags.failNextClaimAvailable;
    this.failureFlags.failNextApplyWorkerPlan = flags.failNextApplyWorkerPlan ?? this.failureFlags.failNextApplyWorkerPlan;
    this.failureFlags.failOnPlanType = flags.failOnPlanType ?? this.failureFlags.failOnPlanType;
    this.failureFlags.failOnEventType = flags.failOnEventType ?? this.failureFlags.failOnEventType;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<OutboxMessageRecord | null> {
    if (this.failureFlags.failNextFindByIdempotencyKey) {
      this.failureFlags.failNextFindByIdempotencyKey = false;
      throw new Error("in-memory outbox idempotency lookup failed");
    }
    const row = this.state.records.find((record) => record.idempotencyKey === idempotencyKey);
    return row ? clone(row) : null;
  }

  async claimAvailable(input: {
    now: string;
    workerId: string;
    batchSize: number;
    leaseExpiresAt: string;
    recoverExpiredLeases: boolean;
  }): Promise<OutboxMessageRecord[]> {
    if (this.failureFlags.failNextClaimAvailable) {
      this.failureFlags.failNextClaimAvailable = false;
      throw new Error("in-memory outbox claim failed");
    }

    const now = normalizeIsoTimestamp(input.now);
    const leaseExpiresAt = normalizeIsoTimestamp(input.leaseExpiresAt);
    if (!now || !leaseExpiresAt) return [];

    const sorted = this.state.records
      .map((record) => clone(record))
      .sort((a, b) => {
        const byAvailable = String(a.availableAt).localeCompare(String(b.availableAt));
        if (byAvailable !== 0) return byAvailable;
        const byCreated = String(a.createdAt).localeCompare(String(b.createdAt));
        if (byCreated !== 0) return byCreated;
        return String(a.rowId).localeCompare(String(b.rowId));
      });

    const claimed: OutboxMessageRecord[] = [];
    const seenIdempotencyKeys = new Set<string>();

    for (const candidate of sorted) {
      if (claimed.length >= input.batchSize) break;
      if (seenIdempotencyKeys.has(candidate.idempotencyKey)) continue;
      seenIdempotencyKeys.add(candidate.idempotencyKey);
      if (hasOtherRecordWithSameIdempotencyKey(this.state.records, candidate)) continue;

      const evaluation = evaluateOutboxCandidate({
        now,
        record: candidate,
        config: {
          workerEnabled: true,
          transportEnabled: true,
          workerId: input.workerId,
          batchSize: input.batchSize,
          leaseSeconds: Math.max(1, Math.ceil((new Date(leaseExpiresAt).getTime() - new Date(now).getTime()) / 1000)),
          defaultMaxAttempts: candidate.maxAttempts,
          baseRetrySeconds: 30,
          maxRetrySeconds: 3600,
          retryJitterEnabled: false,
          recoverExpiredLeases: input.recoverExpiredLeases,
          sandboxRequired: false
        }
      });

      if (evaluation.decision !== "process") continue;

      const index = this.state.records.findIndex((record) => sameRowId(record.rowId, candidate.rowId));
      if (index < 0) continue;

      const claimedRecord = {
        ...clone(this.state.records[index]),
        status: "claimed" as const,
        claimedBy: input.workerId,
        claimedAt: now,
        leaseExpiresAt,
        updatedAt: now
      };

      this.state.records[index] = claimedRecord;
      claimed.push(clone(claimedRecord));
    }

    return claimed;
  }

  async applyWorkerPlan(plan: OutboxWorkerMutationPlan): Promise<OutboxWorkerApplyResult> {
    if (this.failureFlags.failNextApplyWorkerPlan) {
      this.failureFlags.failNextApplyWorkerPlan = false;
      throw new Error("in-memory outbox plan application failed");
    }

    if (listIncludes(this.failureFlags.failOnPlanType, plan.planType)) {
      throw new Error(`in-memory outbox plan application failed for ${plan.planType}`);
    }

    if (plan.auditEvent && listIncludes(this.failureFlags.failOnEventType, plan.auditEvent.eventType)) {
      throw new Error(`in-memory outbox audit append failed for ${plan.auditEvent.eventType}`);
    }

    const index = this.state.records.findIndex((record) => sameRowId(record.rowId, plan.rowId));
    if (index < 0) {
      return { applied: false, duplicate: false, conflict: false, rowId: null };
    }

    const current = this.state.records[index];
    const currentStatus = current.status;
    if (this.state.appliedPlanKeys.includes(plan.planKey)) {
      return { applied: false, duplicate: true, conflict: false, rowId: current.rowId };
    }

    if (hasOtherRecordWithSameIdempotencyKey(this.state.records, current)) {
      return { applied: false, duplicate: true, conflict: false, rowId: current.rowId };
    }

    if (!plan.expectedStatuses.includes(currentStatus)) {
      return { applied: false, duplicate: false, conflict: true, rowId: current.rowId };
    }

    const record: OutboxMessageRecord = {
      ...clone(current),
      status: plan.patch.nextStatus,
      attemptCount: plan.patch.attemptCount ?? current.attemptCount,
      availableAt: plan.patch.availableAt ?? current.availableAt,
      claimedBy: plan.patch.claimedBy ?? current.claimedBy,
      claimedAt: plan.patch.claimedAt ?? current.claimedAt,
      leaseExpiresAt: plan.patch.leaseExpiresAt ?? current.leaseExpiresAt,
      lastAttemptAt: plan.patch.lastAttemptAt ?? current.lastAttemptAt,
      deliveredAt: plan.patch.deliveredAt ?? current.deliveredAt,
      providerMessageId: plan.patch.providerMessageId ?? current.providerMessageId,
      lastErrorCode: plan.patch.lastErrorCode ?? current.lastErrorCode,
      lastErrorMessageSafe: plan.patch.lastErrorMessageSafe ?? current.lastErrorMessageSafe,
      updatedAt: plan.patch.updatedAt
    };

    this.state.records[index] = record;
    this.state.appliedPlanKeys.push(plan.planKey);
    if (plan.auditEvent) {
      this.state.auditEvents.push(clone(plan.auditEvent));
    }

    return { applied: true, duplicate: false, conflict: false, rowId: record.rowId };
  }
}

export class InMemoryOutboxWorkerUnitOfWork implements OutboxWorkerUnitOfWork {
  private readonly failureFlags: { failNextCommit?: boolean };

  constructor(private readonly repository: InMemoryOutboxWorkerRepository, options: { failNextCommit?: boolean } = {}) {
    this.failureFlags = { failNextCommit: options.failNextCommit };
  }

  async run<T>(operation: (repositories: { outbox: OutboxWorkerRepository }) => Promise<T>): Promise<T> {
    const staged = InMemoryOutboxWorkerRepository.fromState(this.repository.snapshotState(), this.repository.snapshotFailureFlags());
    const result = await operation({ outbox: staged });
    if (this.failureFlags.failNextCommit) {
      this.failureFlags.failNextCommit = false;
      throw new Error("in-memory outbox commit failed");
    }
    this.repository.replaceWith(staged);
    return result;
  }
}
