import type { CrmAgentAction } from "../action-queue";
import type { CanonicalOutboxCommand } from "./types";

export interface AgentActionRepository {
  findByActionId(actionId: string): Promise<CrmAgentAction | null>;

  findByIdempotencyKey(idempotencyKey: string): Promise<CrmAgentAction | null>;

  markPlanned(input: {
    actionId: string;
    expectedCurrentStatuses: string[];
    outboxMessageId: number | null;
    updatedAt: string;
  }): Promise<{
    updated: boolean;
    rowId: number | null;
    conflict: boolean;
  }>;
}

export interface OutboxRepository {
  findByIdempotencyKey(
    idempotencyKey: string
  ): Promise<{
    id: number;
    status: string;
  } | null>;

  insertCommand(
    command: CanonicalOutboxCommand
  ): Promise<{
    inserted: boolean;
    duplicate: boolean;
    rowId: number | null;
  }>;
}

export interface ExecutionUnitOfWork {
  run<T>(
    operation: (repositories: {
      agentActions: AgentActionRepository;
      outbox: OutboxRepository;
    }) => Promise<T>
  ): Promise<T>;
}
