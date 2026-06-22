import { cloneDeep, createEmptyAutonomousLoopRuntimeSnapshot } from "../autonomous-loop";
import type { AutonomousLoopRuntime, AutonomousLoopRuntimeSnapshot, AutonomousLoopRuntimeState } from "../autonomous-loop";
import type { ScenarioRuntimeFailureMode } from "./types";

function normalizeSnapshot(snapshot: Partial<AutonomousLoopRuntimeSnapshot> = {}): AutonomousLoopRuntimeSnapshot {
  return {
    ...createEmptyAutonomousLoopRuntimeSnapshot(),
    ...cloneDeep(snapshot),
    opportunities: Array.isArray(snapshot.opportunities) ? cloneDeep(snapshot.opportunities) : [],
    decisions: Array.isArray(snapshot.decisions) ? cloneDeep(snapshot.decisions) : [],
    actions: Array.isArray(snapshot.actions) ? cloneDeep(snapshot.actions) : [],
    outbox: Array.isArray(snapshot.outbox) ? cloneDeep(snapshot.outbox) : [],
    deliveryResults: Array.isArray(snapshot.deliveryResults) ? cloneDeep(snapshot.deliveryResults) : [],
    followUpMutationPlans: Array.isArray(snapshot.followUpMutationPlans) ? cloneDeep(snapshot.followUpMutationPlans) : [],
    auditEvents: Array.isArray(snapshot.auditEvents) ? cloneDeep(snapshot.auditEvents) : [],
    processedCorrelationIds: Array.isArray(snapshot.processedCorrelationIds) ? [...new Set(snapshot.processedCorrelationIds)] : [],
    processedProviderMessageIds: Array.isArray(snapshot.processedProviderMessageIds)
      ? [...new Set(snapshot.processedProviderMessageIds)]
      : [],
    updatedAt: typeof snapshot.updatedAt === "string" ? snapshot.updatedAt : null
  };
}

function hasNewOutbox(before: AutonomousLoopRuntimeSnapshot, after: AutonomousLoopRuntimeState): boolean {
  return after.outbox.length > before.outbox.length;
}

function hasNewDelivery(before: AutonomousLoopRuntimeSnapshot, after: AutonomousLoopRuntimeState): boolean {
  return after.deliveryResults.length > before.deliveryResults.length;
}

function hasNewFollowUpMutation(before: AutonomousLoopRuntimeSnapshot, after: AutonomousLoopRuntimeState): boolean {
  return after.followUpMutationPlans.length > before.followUpMutationPlans.length;
}

function hasNewAudit(before: AutonomousLoopRuntimeSnapshot, after: AutonomousLoopRuntimeState): boolean {
  return after.auditEvents.length > before.auditEvents.length;
}

export class InMemoryScenarioRuntime implements AutonomousLoopRuntime {
  private state: AutonomousLoopRuntimeSnapshot;
  private readonly failureMode: ScenarioRuntimeFailureMode;

  constructor(initialState: Partial<AutonomousLoopRuntimeSnapshot> = {}, failureMode: ScenarioRuntimeFailureMode = "none") {
    this.state = normalizeSnapshot(initialState);
    this.failureMode = failureMode;
  }

  replaceSnapshot(snapshot: Partial<AutonomousLoopRuntimeSnapshot>): void {
    this.state = normalizeSnapshot(snapshot);
  }

  getSnapshot(): AutonomousLoopRuntimeSnapshot {
    return normalizeSnapshot(this.state);
  }

  async runAtomic<T>(operation: (state: AutonomousLoopRuntimeState) => Promise<T>): Promise<T> {
    const staged: AutonomousLoopRuntimeState = normalizeSnapshot(this.state);
    const before = normalizeSnapshot(this.state);
    const result = await operation(staged);

    if (this.failureMode === "after_outbox" && hasNewOutbox(before, staged)) {
      throw new Error("scenario_rollback_after_outbox");
    }
    if (this.failureMode === "after_delivery" && hasNewDelivery(before, staged)) {
      throw new Error("scenario_rollback_after_delivery");
    }
    if (this.failureMode === "after_follow_up" && hasNewFollowUpMutation(before, staged)) {
      throw new Error("scenario_rollback_after_follow_up");
    }
    if (this.failureMode === "after_audit" && hasNewAudit(before, staged)) {
      throw new Error("scenario_rollback_after_audit");
    }

    this.state = normalizeSnapshot(staged);
    return result;
  }

  async hasProcessedCorrelationId(correlationId: string): Promise<boolean> {
    return this.state.processedCorrelationIds.includes(correlationId);
  }

  async hasProcessedProviderMessageId(providerMessageId: string): Promise<boolean> {
    return this.state.processedProviderMessageIds.includes(providerMessageId);
  }
}
