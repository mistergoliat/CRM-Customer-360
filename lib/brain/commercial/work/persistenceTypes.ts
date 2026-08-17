import type { PoolConnection } from "mysql2/promise";
import type { CommercialObjective, CommercialWork, CommercialWorkStep } from "./types";
import type { CommercialObjectiveStatus, CommercialWorkStatus, CommercialWorkStepStatus } from "./statuses";

export const COMMERCIAL_WORK_PAYLOAD_VERSION = "1.0" as const;

export type PersistedCommercialWork = CommercialWork & {
  publicId: string;
  correlationKey: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
};

export type CommercialWorkPersistenceErrorCode =
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "INVALID_TRANSITION"
  | "DUPLICATE_CORRELATION"
  | "PERSISTENCE_FAILURE";

export class CommercialWorkPersistenceError extends Error {
  readonly code: CommercialWorkPersistenceErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: CommercialWorkPersistenceErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "CommercialWorkPersistenceError";
    this.code = code;
    this.details = details;
  }
}

export type PersistCommercialWorkProjectionInput = {
  work: CommercialWork;
  publicId?: string;
  correlationKey?: string;
};

export type PersistCommercialWorkProjectionResult = {
  status: "created" | "duplicate";
  work: PersistedCommercialWork;
};

export type UpdateCommercialWorkAggregateInput = {
  publicId: string;
  expectedVersion: number;
  nextWork: CommercialWork;
  cancelReason?: string | null;
};

export type CommercialWorkStatusTransitionInput = {
  publicId: string;
  expectedVersion: number;
  status: CommercialWorkStatus;
  cancelReason?: string | null;
};

export type CommercialWorkStepStatusTransitionInput = {
  publicId: string;
  expectedVersion: number;
  stepId: string;
  status: CommercialWorkStepStatus;
  evidence?: CommercialWorkStep["evidence"];
  blockers?: CommercialWorkStep["blockers"];
};

export type CommercialObjectiveStatusTransitionInput = {
  publicId: string;
  expectedVersion: number;
  objectiveId: string;
  status: CommercialObjectiveStatus;
  evidence?: CommercialObjective["evidence"];
  blockers?: CommercialObjective["blockers"];
};

export type FindActiveCommercialWorkInput = {
  opportunityId?: number | null;
  conversationId?: number | null;
  limit?: number;
};

export type CommercialWorkSqlConnection = Pick<PoolConnection, "execute" | "beginTransaction" | "commit" | "rollback">;

export type CommercialWorkDatabaseAdapter = {
  withConnection?<T>(fn: (connection: CommercialWorkSqlConnection) => Promise<T>): Promise<T>;
  queryRows?<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
};
