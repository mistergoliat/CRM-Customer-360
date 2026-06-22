"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryExecutionUnitOfWork = exports.InMemoryOutboxRepository = exports.InMemoryAgentActionRepository = void 0;
function clone(value) {
    return structuredClone(value);
}
function asText(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function normalizeAction(action, rowId) {
    return {
        ...clone(action),
        id: typeof action.id === "number" && Number.isFinite(action.id) ? action.id : rowId
    };
}
class InMemoryAgentActionRepository {
    store;
    failureFlags;
    constructor(initialActions = [], options = {}) {
        const normalizedActions = initialActions.map((action, index) => normalizeAction(action, index + 1));
        this.store = {
            actions: normalizedActions.map((action) => clone(action)),
            outbox: [],
            nextActionRowId: Math.max(options.nextRowId ?? normalizedActions.length + 1, normalizedActions.length + 1),
            nextOutboxRowId: 1
        };
        this.failureFlags = { ...(options.failureFlags ?? {}) };
    }
    static fromStore(store, failureFlags = {}) {
        const repo = new InMemoryAgentActionRepository([], { failureFlags, nextRowId: store.nextActionRowId });
        repo.store.actions = store.actions.map((action) => clone(action));
        repo.store.outbox = store.outbox.map((record) => clone(record));
        repo.store.nextOutboxRowId = store.nextOutboxRowId;
        return repo;
    }
    snapshot() {
        return this.store.actions.map((action) => clone(action));
    }
    snapshotStore() {
        return clone(this.store);
    }
    snapshotFailureFlags() {
        return clone(this.failureFlags);
    }
    replaceWith(other) {
        this.store.actions = other.snapshot();
        this.store.nextActionRowId = other.store.nextActionRowId;
    }
    seed(action) {
        const rowId = typeof action.id === "number" && Number.isFinite(action.id) ? action.id : this.store.nextActionRowId++;
        this.store.actions.push(normalizeAction(action, rowId));
    }
    setFailureFlags(flags) {
        this.failureFlags.failNextFindByActionId = flags.failNextFindByActionId ?? this.failureFlags.failNextFindByActionId;
        this.failureFlags.failNextFindByIdempotencyKey = flags.failNextFindByIdempotencyKey ?? this.failureFlags.failNextFindByIdempotencyKey;
        this.failureFlags.failNextMarkPlanned = flags.failNextMarkPlanned ?? this.failureFlags.failNextMarkPlanned;
    }
    async findByActionId(actionId) {
        if (this.failureFlags.failNextFindByActionId) {
            this.failureFlags.failNextFindByActionId = false;
            throw new Error("in-memory agent action lookup failed");
        }
        const row = this.store.actions.find((action) => action.actionId === actionId);
        return row ? clone(row) : null;
    }
    async findByIdempotencyKey(idempotencyKey) {
        if (this.failureFlags.failNextFindByIdempotencyKey) {
            this.failureFlags.failNextFindByIdempotencyKey = false;
            throw new Error("in-memory agent action idempotency lookup failed");
        }
        const row = this.store.actions.find((action) => action.idempotencyKey === idempotencyKey);
        return row ? clone(row) : null;
    }
    async markPlanned(input) {
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
exports.InMemoryAgentActionRepository = InMemoryAgentActionRepository;
class InMemoryOutboxRepository {
    store;
    failureFlags;
    constructor(initialOutbox = [], options = {}) {
        this.store = {
            actions: [],
            outbox: initialOutbox.map((record) => clone(record)),
            nextActionRowId: 1,
            nextOutboxRowId: Math.max(options.nextRowId ?? initialOutbox.length + 1, initialOutbox.length + 1)
        };
        this.failureFlags = { ...(options.failureFlags ?? {}) };
    }
    static fromStore(store, failureFlags = {}) {
        const repo = new InMemoryOutboxRepository([], { failureFlags, nextRowId: store.nextOutboxRowId });
        repo.store.actions = store.actions.map((action) => clone(action));
        repo.store.outbox = store.outbox.map((record) => clone(record));
        repo.store.nextActionRowId = store.nextActionRowId;
        return repo;
    }
    snapshot() {
        return this.store.outbox.map((record) => clone(record));
    }
    snapshotStore() {
        return clone(this.store);
    }
    snapshotFailureFlags() {
        return clone(this.failureFlags);
    }
    replaceWith(other) {
        this.store.outbox = other.snapshot();
        this.store.nextOutboxRowId = other.store.nextOutboxRowId;
    }
    seed(record) {
        const id = typeof record.id === "number" && Number.isFinite(record.id) ? record.id : this.store.nextOutboxRowId++;
        this.store.outbox.push({
            id,
            status: record.status,
            command: clone(record.command)
        });
    }
    setFailureFlags(flags) {
        this.failureFlags.failNextInsert = flags.failNextInsert ?? this.failureFlags.failNextInsert;
    }
    async findByIdempotencyKey(idempotencyKey) {
        const row = this.store.outbox.find((record) => record.command.idempotencyKey === idempotencyKey);
        return row ? { id: row.id, status: row.status } : null;
    }
    async insertCommand(command) {
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
exports.InMemoryOutboxRepository = InMemoryOutboxRepository;
class InMemoryExecutionUnitOfWork {
    agentActions;
    outbox;
    failureFlags;
    constructor(agentActions, outbox, options = {}) {
        this.agentActions = agentActions;
        this.outbox = outbox;
        this.failureFlags = { failNextCommit: options.failNextCommit };
    }
    async run(operation) {
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
exports.InMemoryExecutionUnitOfWork = InMemoryExecutionUnitOfWork;
