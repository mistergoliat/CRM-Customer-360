import type { PersistAgentActionResult, CrmAgentAction } from "../action-queue";
import type { SandboxAutonomyEvaluationResult } from "../autonomy-sandbox";
import type { ExecutionGateResult } from "../execution-gate";

export type CommercialExecutionBridgeFeatureFlags = {
  actionQueueEnabled: boolean;
  actionPersistenceEnabled: boolean;
  executionGateEnabled: boolean;
  outboxBridgeEnabled: boolean;
  sandboxEnabled: boolean;
  autonomousReplyEnabled: boolean;
  sandboxModeRequired: boolean;
};

export type CommercialExecutionBridgeStatus =
  | "disabled"
  | "skipped"
  | "action_persisted"
  | "internal_action_planned"
  | "outbox_planned"
  | "blocked"
  | "failed";

export type CommercialExecutionBridgeResult = {
  status: CommercialExecutionBridgeStatus;
  enabled: boolean;
  action: CrmAgentAction | null;
  actionPersistence: PersistAgentActionResult | null;
  sandboxEvaluation: SandboxAutonomyEvaluationResult | null;
  executionGate: ExecutionGateResult | null;
  warnings: string[];
  error: string | null;
  sideEffects: {
    actionWritten: boolean;
    outboxWritten: boolean;
    messageSent: false;
    metaCalled: false;
    workerTriggered: false;
  };
};
