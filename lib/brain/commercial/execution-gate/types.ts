import type { CrmAgentAction } from "../action-queue";
import type { SandboxAutonomyEvaluationResult } from "../autonomy-sandbox";
import type { BrainCanonicalOutboxCommand, BrainOutboxCommandType } from "../../messaging/types";

export type ExecutionGateStatus = "allowed" | "blocked" | "disabled" | "duplicate" | "expired" | "invalid" | "failed";

export type ExecutionGateBlockReason =
  | "execution_gate_disabled"
  | "sandbox_not_eligible"
  | "action_not_found"
  | "action_not_ready"
  | "unsupported_action_type"
  | "invalid_lifecycle_transition"
  | "risk_not_allowed"
  | "approval_not_satisfied"
  | "human_owner_active"
  | "ai_blocked"
  | "case_closed"
  | "missing_idempotency_key"
  | "missing_recipient"
  | "missing_message"
  | "unsafe_message"
  | "action_expired"
  | "duplicate_execution"
  | "conflicting_action"
  | "policy_blocked"
  | "outbox_command_invalid"
  | "repository_failure"
  | "transaction_failure";

export type OutboxCommandType = BrainOutboxCommandType;
export type CanonicalOutboxCommand = BrainCanonicalOutboxCommand;

export type ExecutionGateConfig = {
  executionGateEnabled: boolean;
  outboxBridgeEnabled: boolean;
  sandboxModeRequired: boolean;
};

export type ExecutionGateInput = {
  now: string;

  config: ExecutionGateConfig;

  action: CrmAgentAction;

  context: {
    caseId: string | null;
    caseStatus: string | null;
    lifecycleStatus: string | null;
    humanOwnerActive: boolean;
    aiBlocked: boolean;
    requiresHuman: boolean;
    policyStatus: string | null;
    conflictingActionExists: boolean;
  };

  sandboxEvaluation: SandboxAutonomyEvaluationResult;
};

export type ExecutionGateEvaluationResult = {
  status: ExecutionGateStatus;
  allowed: boolean;
  blockReasons: ExecutionGateBlockReason[];
  warnings: string[];
};

export type ExecutionGateRepositoryResult = {
  actionUpdated: boolean;
  outboxInserted: boolean;
  duplicateDetected: boolean;
  actionRowId: number | null;
  outboxRowId: number | null;
};

export type ExecutionGateSideEffects = {
  messageSent: false;
  metaCalled: false;
  workerTriggered: false;
};

export type ExecutionGateResult = {
  status: ExecutionGateStatus;
  allowed: boolean;

  actionId: string;
  outboxCommand: CanonicalOutboxCommand | null;

  blockReasons: ExecutionGateBlockReason[];
  warnings: string[];

  repositoryResult: ExecutionGateRepositoryResult;

  sideEffects: ExecutionGateSideEffects;

  evaluatedAt: string;
};

export type ExecutionGateRepositorySet = {
  agentActions: import("./repositories").AgentActionRepository;
  outbox: import("./repositories").OutboxRepository;
};

export type ExecutionGateDependencies = {
  unitOfWork: import("./repositories").ExecutionUnitOfWork;
};
