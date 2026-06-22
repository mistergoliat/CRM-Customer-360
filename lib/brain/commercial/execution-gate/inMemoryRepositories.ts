import type { CrmAgentAction } from "../action-queue";
import type { CanonicalOutboxCommand } from "./types";
import type { AgentActionRepository, ExecutionUnitOfWork, OutboxRepository } from "./repositories";

type InMemoryActionRecord = CrmAgentAction;

type InMemoryOutboxRecord = {
  id: number;
  status: string;
  command: CanonicalOutboxCommand;
};

type InMemoryExecutionStore = {
  actions: InMemoryActionRecord[];
  outbox: InMemoryOutboxRecord[];
  nextActionRowId: number;
  nextOutboxRowId: number;
};

type InMemoryFailureFlags = {
  failNextFindByActionId?: boolean;
  failNextFindByIdempotencyKey?: boolean;
  failNextMarkPlanned?: boolean;
  failNextInsert?: boolean;
  failNextCommit?: boolean;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeAction(action: CrmAgentAction, rowId: number): CrmAgentAction {
  return {
    ...clone(action),
    id: typeof action.id === "number" && Number.isFinite(action.id) ? action.id : rowId
  };
}

export class InMemoryAgentActionRepository implements AgentActionRepository {
  private store: InMemoryExecutionStore;
  private readonly failureFlags: InMemoryFailureFlags;

  constructor(initialActions: CrmAgentAction[] = [], options: { failureFlags?: InMemoryFailureFlags; nextRowId?: number } = {}) {
    const normalizedActions = initialActions.map((action, index) => normalizeAction(action, index + 1));
    this.store = {
      actions: normalizedActions.map((action) => clone(action)),
      outbox: [],
      nextActionRowId: Math.max(options.nextRowId ?? normalizedActions.length + 1, normalizedActions.length + 1),
      nextOutboxRowId: 1
    };
    this.failureFlags = { ...(options.failureFlags ?? {}) };
  }

  static fromStore(store: InMemoryExecutionStore, failureFlags: InMemoryFailureFlags = {}) {
    const repo = new InMemoryAgentActionRepository([], { failureFlags, nextRowId: store.nextActionRowId });
    repo.store.actions = store.actions.map((action) => clone(action));
    repo.store.outbox = store.outbox.map((record) => clone(record));
    repo.store.nextOutboxRowId = store.nextOutboxRowId;
    return repo;
  }

  snapshot(): CrmAgentAction[] {
    return this.store.actions.map((action) => clone(action));
  }

  snapshotStore(): InMemoryExecutionStore {
    return clone(this.store);
  }

  snapshotFailureFlags(): InMemoryFailureFlags {
    return clone(this.failureFlags);
  }

  replaceWith(other: InMemoryAgentActionRepository) {
    this.store.actions = other.snapshot();
    this.store.nextActionRowId = other.store.nextActionRowId;
  }

  seed(action: CrmAgentAction) {
    const rowId = typeof action.id === "number" && Number.isFinite(action.id) ? action.id : this.store.nextActionRowId++;
    this.store.actions.push(normalizeAction(action, rowId));
  }

  setFailureFlags(flags: Partial<InMemoryFailureFlags>) {
    this.failureFlags.failNextFindByActionId = flags.failNextFindByActionId ?? this.failureFlags.failNextFindByActionId;
    this.failureFlags.failNextFindByIdempotencyKey = flags.failNextFindByIdempotencyKey ?? this.failureFlags.failNextFindByIdempotencyKey;
    this.failureFlags.failNextMarkPlanned = flags.failNextMarkPlanned ?? this.failureFlags.failNextMarkPlanned;
  }

  async findByActionId(actionId: string): Promise<CrmAgentAction | null> {
    if (this.failureFlags.failNextFindByActionId) {
      this.failureFlags.failNextFindByActionId = false;
      throw new Error("in-memory agent action lookup failed");
    }

    const row = this.store.actions.find((action) => action.actionId === actionId);
    return row ? clone(row) : null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<CrmAgentAction | null> {
    if (this.failureFlags.failNextFindByIdempotencyKey) {
      this.failureFlags.failNextFindByIdempotencyKey = false;
      throw new Error("in-memory agent action idempotency lookup failed");
    }

    const row = this.store.actions.find((action) => action.idempotencyKey === idempotencyKey);
    return row ? clone(row) : null;
  }

  async markPlanned(input: {
    actionId: string;
    expectedCurrentStatuses: string[];
    outboxMessageId: number | null;
    updatedAt: string;
  }): Promise<{
    updated: boolean;
    rowId: number | null;
    conflict: boolean;
  }> {
    if (this.failureFlags.failNextMarkPlanned) {
      this.failureFlags.failNextMarkPlanned = false;
      throw new Error("in-memory agent action update failed");
    }

    const index = this.store.actions.findIndex((action) => action.actionId === input.actionId);
    if (index < 0) {
      return { updated: false, rowId: null, conflict: false };
    }

    const current = this.store.actions[index];
    const currentStatus = asText(current.status)?.toLowerCase() ?? "";
    if (!input.expectedCurrentStatuses.includes(currentStatus)) {
      return { updated: false, rowId: current.id ?? null, conflict: true };
    }

    const alreadyLinked = current.status === "planned" && current.outboxMessageId === input.outboxMessageId;
    if (alreadyLinked) {
      return { updated: false, rowId: current.id ?? null, conflict: false };
    }

    this.store.actions[index] = {
      ...current,
      status: "planned",
      outboxMessageId: input.outboxMessageId,
      updatedAt: input.updatedAt
    };

    return { updated: true, rowId: this.store.actions[index].id ?? null, conflict: false };
  }
}

export class InMemoryOutboxRepository implements OutboxRepository {
  private store: InMemoryExecutionStore;
  private readonly failureFlags: InMemoryFailureFlags;

  constructor(initialOutbox: Array<{ id: number; status: string; command: CanonicalOutboxCommand }> = [], options: { failureFlags?: InMemoryFailureFlags; nextRowId?: number } = {}) {
    this.store = {
      actions: [],
      outbox: initialOutbox.map((record) => clone(record)),
      nextActionRowId: 1,
      nextOutboxRowId: Math.max(options.nextRowId ?? initialOutbox.length + 1, initialOutbox.length + 1)
    };
    this.failureFlags = { ...(options.failureFlags ?? {}) };
  }

  static fromStore(store: InMemoryExecutionStore, failureFlags: InMemoryFailureFlags = {}) {
    const repo = new InMemoryOutboxRepository([], { failureFlags, nextRowId: store.nextOutboxRowId });
    repo.store.actions = store.actions.map((action) => clone(action));
    repo.store.outbox = store.outbox.map((record) => clone(record));
    repo.store.nextActionRowId = store.nextActionRowId;
    return repo;
  }

  snapshot(): Array<{ id: number; status: string; command: CanonicalOutboxCommand }> {
    return this.store.outbox.map((record) => clone(record));
  }

  snapshotStore(): InMemoryExecutionStore {
    return clone(this.store);
  }

  snapshotFailureFlags(): InMemoryFailureFlags {
    return clone(this.failureFlags);
  }

  replaceWith(other: InMemoryOutboxRepository) {
    this.store.outbox = other.snapshot();
    this.store.nextOutboxRowId = other.store.nextOutboxRowId;
  }

  seed(record: { id?: number; status: string; command: CanonicalOutboxCommand }) {
    const id = typeof record.id === "number" && Number.isFinite(record.id) ? record.id : this.store.nextOutboxRowId++;
    this.store.outbox.push({
      id,
      status: record.status,
      command: clone(record.command)
    });
  }

  setFailureFlags(flags: Partial<InMemoryFailureFlags>) {
    this.failureFlags.failNextInsert = flags.failNextInsert ?? this.failureFlags.failNextInsert;
  }

  async findByIdempotencyKey(
    idempotencyKey: string
  ): Promise<{
    id: number;
    status: string;
  } | null> {
    const row = this.store.outbox.find((record) => record.command.idempotencyKey === idempotencyKey);
    return row ? { id: row.id, status: row.status } : null;
  }

  async insertCommand(
    command: CanonicalOutboxCommand
  ): Promise<{
    inserted: boolean;
    duplicate: boolean;
    rowId: number | null;
  }> {
    if (this.failureFlags.failNextInsert) {
      this.failureFlags.failNextInsert = false;
      throw new Error("in-memory outbox insert failed");
    }

    const existing = this.store.outbox.find((record) => record.command.idempotencyKey === command.idempotencyKey);
    if (existing) {
      return { inserted: false, duplicate: true, rowId: existing.id };
    }

    const rowId = this.store.nextOutboxRowId++;
    this.store.outbox.push({
      id: rowId,
      status: "planned",
      command: clone(command)
    });

    return { inserted: true, duplicate: false, rowId };
  }
}

export class InMemoryExecutionUnitOfWork implements ExecutionUnitOfWork {
  private readonly failureFlags: { failNextCommit?: boolean };

  constructor(
    private readonly agentActions: InMemoryAgentActionRepository,
    private readonly outbox: InMemoryOutboxRepository,
    options: { failNextCommit?: boolean } = {}
  ) {
    this.failureFlags = { failNextCommit: options.failNextCommit };
  }

  async run<T>(
    operation: (repositories: {
      agentActions: AgentActionRepository;
      outbox: OutboxRepository;
    }) => Promise<T>
  ): Promise<T> {
    const stagedAgentActions = InMemoryAgentActionRepository.fromStore(this.agentActions.snapshotStore(), this.agentActions.snapshotFailureFlags());
    const stagedOutbox = InMemoryOutboxRepository.fromStore(this.outbox.snapshotStore(), this.outbox.snapshotFailureFlags());

    const result = await operation({ agentActions: stagedAgentActions, outbox: stagedOutbox });
    if (this.failureFlags.failNextCommit) {
      this.failureFlags.failNextCommit = false;
      throw new Error("in-memory transaction commit failed");
    }

    this.agentActions.replaceWith(stagedAgentActions);
    this.outbox.replaceWith(stagedOutbox);
    return result;
  }
}
