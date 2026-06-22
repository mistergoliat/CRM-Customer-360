import { cloneDeep } from "./constants";
import type { AutonomousLoopRuntimeSnapshot, AutonomousLoopRuntimeState } from "./types";
import type { AutonomousLoopRuntime } from "./repositories";
import type { AutonomousLoopAuditEvent } from "./types";

function createEmptyState(): AutonomousLoopRuntimeState {
  return {
    opportunities: [],
    decisions: [],
    actions: [],
    outbox: [],
    deliveryResults: [],
    followUpMutationPlans: [],
    auditEvents: [],
    processedCorrelationIds: [],
    processedProviderMessageIds: [],
    updatedAt: null
  };
}

function normalizeState(state: AutonomousLoopRuntimeState): AutonomousLoopRuntimeState {
  return {
    opportunities: Array.isArray(state.opportunities) ? state.opportunities.map((item: (typeof state.opportunities)[number]) => ({ ...item })) : [],
    decisions: Array.isArray(state.decisions) ? state.decisions.map((item: (typeof state.decisions)[number]) => ({ ...item })) : [],
    actions: Array.isArray(state.actions) ? state.actions.map((item: (typeof state.actions)[number]) => ({ ...item })) : [],
    outbox: Array.isArray(state.outbox) ? state.outbox.map((item: (typeof state.outbox)[number]) => cloneDeep(item)) : [],
    deliveryResults: Array.isArray(state.deliveryResults) ? state.deliveryResults.map((item: (typeof state.deliveryResults)[number]) => ({ ...item })) : [],
    followUpMutationPlans: Array.isArray(state.followUpMutationPlans) ? state.followUpMutationPlans.map((item: (typeof state.followUpMutationPlans)[number]) => cloneDeep(item)) : [],
    auditEvents: Array.isArray(state.auditEvents) ? state.auditEvents.map((item: (typeof state.auditEvents)[number]) => cloneDeep(item)) : [],
    processedCorrelationIds: Array.isArray(state.processedCorrelationIds) ? [...new Set(state.processedCorrelationIds)] : [],
    processedProviderMessageIds: Array.isArray(state.processedProviderMessageIds) ? [...new Set(state.processedProviderMessageIds)] : [],
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : null
  };
}

function snapshotState(state: AutonomousLoopRuntimeState): AutonomousLoopRuntimeSnapshot {
  return {
    ...normalizeState(state)
  };
}

export class InMemoryAutonomousCommercialRuntime implements AutonomousLoopRuntime {
  private state: AutonomousLoopRuntimeState;

  constructor(initialState: Partial<AutonomousLoopRuntimeState> = {}) {
    this.state = normalizeState({
      ...createEmptyState(),
      ...initialState
    });
  }

  seedSnapshot(snapshot: Partial<AutonomousLoopRuntimeSnapshot>) {
    this.state = normalizeState({
      ...createEmptyState(),
      ...snapshot
    });
  }

  snapshotState(): AutonomousLoopRuntimeState {
    return normalizeState(this.state);
  }

  async runAtomic<T>(operation: (state: AutonomousLoopRuntimeState) => Promise<T>): Promise<T> {
    const staged = normalizeState(cloneDeep(this.state));
    const result = await operation(staged);
    this.state = normalizeState(staged);
    return result;
  }

  async hasProcessedCorrelationId(correlationId: string): Promise<boolean> {
    return this.state.processedCorrelationIds.includes(correlationId);
  }

  async hasProcessedProviderMessageId(providerMessageId: string): Promise<boolean> {
    return this.state.processedProviderMessageIds.includes(providerMessageId);
  }

  getSnapshot(): AutonomousLoopRuntimeSnapshot {
    return snapshotState(this.state);
  }

  recordAuditEvent(event: AutonomousLoopAuditEvent) {
    this.state.auditEvents.push(cloneDeep(event));
    this.state.updatedAt = event.createdAt;
  }
}

export function createEmptyAutonomousLoopRuntimeSnapshot(): AutonomousLoopRuntimeSnapshot {
  return snapshotState(createEmptyState());
}
