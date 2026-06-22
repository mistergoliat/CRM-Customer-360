import type { AutonomousLoopRuntimeSnapshot, AutonomousLoopRuntimeState } from "./types";

export interface AutonomousLoopRuntime {
  runAtomic<T>(operation: (state: AutonomousLoopRuntimeState) => Promise<T>): Promise<T>;

  hasProcessedCorrelationId(correlationId: string): Promise<boolean>;

  hasProcessedProviderMessageId(providerMessageId: string): Promise<boolean>;

  getSnapshot(): AutonomousLoopRuntimeSnapshot;
}
