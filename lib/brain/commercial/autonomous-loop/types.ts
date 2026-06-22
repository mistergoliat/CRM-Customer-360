import type {
  CanonicalOutboxCommand,
  ExecutionGateEvaluationResult
} from "../execution-gate";
import type {
  FollowUpMutationApplyResult,
  FollowUpMutationMemoryState,
  FollowUpMutationPlan
} from "../follow-up-replanning";
import type { FollowUpSchedulingResult } from "../follow-up-scheduling";
import type { CommercialOperationalLoopResult } from "../operational-loop";
import type { SandboxAutonomyEvaluationResult } from "../autonomy-sandbox";
import type {
  MessageTransportResult,
  OutboxMessageRecord,
  OutboxWorkerProcessResult
} from "../../messaging/outbox-worker";

export type AutonomousLoopMode = "observe" | "simulate" | "execute_fake";

export type AutonomousLoopStatus =
  | "completed"
  | "blocked"
  | "waiting"
  | "cancelled"
  | "expired"
  | "requires_human"
  | "delivered"
  | "retry_scheduled"
  | "dead_letter"
  | "invalid"
  | "failed";

export type AutonomousLoopStage =
  | "context"
  | "operational_loop"
  | "decision"
  | "action"
  | "sandbox"
  | "execution_gate"
  | "outbox"
  | "worker"
  | "transport"
  | "delivery_reconciliation"
  | "follow_up_scheduling"
  | "follow_up_replanning"
  | "audit"
  | "complete";

export type AutonomousLoopSafeError = {
  stage: AutonomousLoopStage;
  code: string;
  messageSafe: string;
  retryable: boolean;
};

export type AutonomousLoopAuditEvent = {
  eventId: string;
  runId: string;
  stage: AutonomousLoopStage;
  eventType: string;
  entityType: "message" | "opportunity" | "decision" | "action" | "outbox" | "delivery" | "follow_up" | "runtime";
  entityId: string | null;
  status: string;
  reason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AutonomousCommercialLoopInput = {
  now: string;
  mode: AutonomousLoopMode;

  correlationId: string;
  tenantId: string;

  inbound: {
    messageId: string;
    providerMessageId: string | null;
    waId: string;
    contactName: string | null;
    text: string;
    receivedAt: string;
    channel: "whatsapp";
  };

  caseContext: {
    caseId: number | string | null;
    status: string | null;
    lifecycleStatus: string | null;
    department: string | null;
    priority: string | null;

    humanOwnerActive: boolean;
    aiBlocked: boolean;
    requiresHuman: boolean;
  };

  commercialContext: {
    opportunityId: number | string | null;
    opportunityKey: string | null;
    opportunityStatus: string | null;
    opportunityStage: string | null;
    opportunityStageChangedAt: string | null;

    lastInboundAt: string | null;
    lastOutboundAt: string | null;
    lastHumanMessageAt: string | null;
    lastAiMessageAt: string | null;
  };

  configuration: {
    operationalLoopEnabled: boolean;

    sandboxAutonomyEnabled: boolean;
    autonomousReplyEnabled: boolean;
    whitelistedWaIds: string[];

    executionGateEnabled: boolean;
    outboxBridgeEnabled: boolean;

    outboxWorkerEnabled: boolean;
    messageTransportEnabled: boolean;

    followUpEnabled: boolean;

    sandboxRequired: boolean;
  };

  scenario: {
    transportScenario:
      | "accepted"
      | "temporary_failure"
      | "permanent_failure"
      | "rate_limited"
      | "timeout"
      | "duplicate_accepted";

    forceRiskLevel?: string | null;
    forceApprovalRequirement?: string | null;
    forceActionType?: string | null;
    forceDecision?: string | null;
  };
};

export type AutonomousCommercialLoopReconciliation = {
  actionStatusBefore: string | null;
  actionStatusAfter: string | null;
  deliveryStatus: string | null;
  providerMessageId: string | null;
  followUpRequired: boolean;
};

export type AutonomousCommercialLoopResult = {
  runId: string;
  correlationId: string;
  tenantId: string;

  mode: AutonomousLoopMode;
  status: AutonomousLoopStatus;
  finalStage: AutonomousLoopStage;

  opportunity: unknown | null;
  decision: unknown | null;
  action: unknown | null;

  sandboxEvaluation: SandboxAutonomyEvaluationResult | null;
  executionGateResult: ExecutionGateEvaluationResult | null;

  outbox: {
    command: CanonicalOutboxCommand | null;
    record: OutboxMessageRecord | null;
    workerResult: OutboxWorkerProcessResult | null;
    transportResult: MessageTransportResult | null;
  };

  followUp: {
    schedulingResult: FollowUpSchedulingResult | null;
    mutationPlan: FollowUpMutationPlan | null;
    mutationApplyResult: FollowUpMutationApplyResult | null;
  };

  reconciliation: AutonomousCommercialLoopReconciliation;

  auditTrail: AutonomousLoopAuditEvent[];

  warnings: string[];
  errors: AutonomousLoopSafeError[];

  sideEffects: {
    realDatabaseWritten: false;
    realOutboxWritten: false;
    realMessageSent: false;
    metaCalled: false;
    schedulerTriggered: false;

    inMemoryStateChanged: boolean;
    fakeTransportCalled: boolean;
  };

  startedAt: string;
  completedAt: string;
};

export type AutonomousLoopOpportunityRecord = {
  opportunityId: string | number | null;
  opportunityKey: string;
  status: string | null;
  stage: string | null;
  updatedAt: string;
  source: unknown;
};

export type AutonomousLoopDecisionRecord = {
  decisionId: string;
  opportunityKey: string;
  status: string;
  actionType: string;
  createdAt: string;
  source: unknown;
};

export type AutonomousLoopActionRecord = {
  actionId: string;
  status: string;
  createdAt: string;
  updatedAt: string | null;
  source: unknown;
};

export type AutonomousLoopDeliveryRecord = {
  reconciliationId: string;
  outboxRowId: number | string | null;
  status: string;
  createdAt: string;
  source: unknown;
};

export type AutonomousLoopRuntimeState = {
  opportunities: AutonomousLoopOpportunityRecord[];
  decisions: AutonomousLoopDecisionRecord[];
  actions: AutonomousLoopActionRecord[];
  outbox: OutboxMessageRecord[];
  deliveryResults: AutonomousLoopDeliveryRecord[];
  followUpMutationPlans: FollowUpMutationPlan[];
  auditEvents: AutonomousLoopAuditEvent[];
  processedCorrelationIds: string[];
  processedProviderMessageIds: string[];
  updatedAt: string | null;
};

export type AutonomousLoopRuntimeSnapshot = AutonomousLoopRuntimeState & {
  updatedAt: string | null;
};

export type AutonomousLoopContext = {
  commercialOperationalInput: CommercialOperationalLoopResult extends never ? never : unknown;
  commercialOperationalLoopInput: import("../operational-loop").CommercialOperationalLoopInput;
  brainContext: unknown;
  inboundMessage: unknown;
  commercialContext: unknown;
  salesAgentResult: unknown;
  commercialPolicyResult: unknown;
  commercialEvaluationResult: unknown;
  commercialShadowResult: unknown;
  sandboxContext: import("../autonomy-sandbox").SandboxAutonomyAgentActionContext;
  sandboxConfig: import("../autonomy-sandbox").SandboxAutonomyConfig;
  executionGateConfig: import("../execution-gate").ExecutionGateConfig;
  outboxConfig: import("../../messaging/outbox-worker").OutboxWorkerConfig;
  transportConfig: import("../../messaging/whatsapp-transport").WhatsAppTransportConfig;
};
