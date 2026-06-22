import type {
  OutboxMessageRecord,
  OutboxWorkerApplyResult,
  OutboxWorkerMemoryState,
  OutboxWorkerMutationPlan,
  OutboxWorkerRepositorySnapshot
} from "./types";

export interface OutboxWorkerRepository {
  findByIdempotencyKey(idempotencyKey: string): Promise<OutboxMessageRecord | null>;

  claimAvailable(input: {
    now: string;
    workerId: string;
    batchSize: number;
    leaseExpiresAt: string;
    recoverExpiredLeases: boolean;
  }): Promise<OutboxMessageRecord[]>;

  applyWorkerPlan(plan: OutboxWorkerMutationPlan): Promise<OutboxWorkerApplyResult>;
}

export interface OutboxWorkerUnitOfWork {
  run<T>(operation: (repositories: { outbox: OutboxWorkerRepository }) => Promise<T>): Promise<T>;
}

export type OutboxWorkerRepositoryFailureFlags = {
  failNextFindByIdempotencyKey?: boolean;
  failNextClaimAvailable?: boolean;
  failNextApplyWorkerPlan?: boolean;
  failOnPlanType?: OutboxWorkerMutationPlan["planType"] | OutboxWorkerMutationPlan["planType"][];
  failOnEventType?: string | string[];
};

export type OutboxWorkerRepositoryState = OutboxWorkerMemoryState & {
  nextRowId: number;
};

export type OutboxWorkerRepositoryFactory = {
  fromState(state: OutboxWorkerRepositorySnapshot, failureFlags?: OutboxWorkerRepositoryFailureFlags): OutboxWorkerRepository;
};
