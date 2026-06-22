import type { BrainCanonicalOutboxCommand } from "../types";

export const OUTBOX_MESSAGE_STATUSES = [
  "pending",
  "claimed",
  "processing",
  "retry_scheduled",
  "delivered",
  "failed",
  "dead_letter",
  "cancelled"
] as const;

export type OutboxMessageStatus = (typeof OUTBOX_MESSAGE_STATUSES)[number];

export const OUTBOX_MESSAGE_TERMINAL_STATUSES = ["delivered", "dead_letter", "cancelled"] as const;

export type OutboxWorkerPlanType =
  | "no_change"
  | "mark_processing"
  | "mark_delivered"
  | "schedule_retry"
  | "mark_failed"
  | "move_to_dead_letter"
  | "expire_message"
  | "release_claim";

export type OutboxWorkerPlanReason =
  | "worker_disabled"
  | "transport_disabled"
  | "sandbox_required"
  | "missing_command_id"
  | "missing_idempotency_key"
  | "missing_action_id"
  | "unsupported_channel"
  | "unsupported_command_type"
  | "status_not_reclaimable"
  | "terminal_status"
  | "not_yet_available"
  | "message_expired"
  | "attempts_exhausted"
  | "missing_recipient"
  | "missing_message"
  | "wrong_worker_claim"
  | "lease_not_recoverable"
  | "active_lease"
  | "processing_plan_failure"
  | "final_plan_failure"
  | "transport_accepted"
  | "transport_duplicate_accepted"
  | "transport_temporary_failure"
  | "transport_rate_limited"
  | "transport_timeout"
  | "transport_permanent_failure"
  | "retry_exhausted"
  | "duplicate_plan_key"
  | "duplicate_idempotency_key"
  | "repository_failure"
  | "expired"
  | "idempotent_plan_reused";

export type OutboxWorkerMutationOperationType = "update_existing_record" | "append_audit_event";

export type OutboxMessageRecord = {
  rowId: number | string;

  commandId: string;
  idempotencyKey: string;
  actionId: string;

  channel: "whatsapp";
  commandType: "whatsapp_text";

  recipient: string;
  messageText: string;

  status: OutboxMessageStatus;

  attemptCount: number;
  maxAttempts: number;

  availableAt: string;
  expiresAt: string | null;

  claimedBy: string | null;
  claimedAt: string | null;
  leaseExpiresAt: string | null;

  lastAttemptAt: string | null;
  deliveredAt: string | null;

  providerMessageId: string | null;

  lastErrorCode: string | null;
  lastErrorMessageSafe: string | null;

  metadata: {
    source: string;
    sandbox: boolean;
    riskLevel: string;
    approvalRequirement: string;
  };

  createdAt: string;
  updatedAt: string;
};

export type OutboxWorkerConfig = {
  workerEnabled: boolean;
  transportEnabled: boolean;

  workerId: string;

  batchSize: number;
  leaseSeconds: number;

  defaultMaxAttempts: number;

  baseRetrySeconds: number;
  maxRetrySeconds: number;

  retryJitterEnabled: false;

  recoverExpiredLeases: boolean;
  sandboxRequired: boolean;
};

export type MessageTransportResultStatus =
  | "accepted"
  | "temporary_failure"
  | "permanent_failure"
  | "rate_limited"
  | "timeout"
  | "duplicate_accepted";

export type MessageTransportErrorCode =
  | "none"
  | "network_error"
  | "timeout"
  | "rate_limited"
  | "provider_unavailable"
  | "invalid_recipient"
  | "invalid_payload"
  | "authentication_error"
  | "permission_error"
  | "policy_rejected"
  | "provider_duplicate"
  | "unknown";

export type MessageTransportResult = {
  status: MessageTransportResultStatus;

  providerMessageId: string | null;
  providerRequestId: string | null;

  errorCode: MessageTransportErrorCode;
  errorMessageSafe: string | null;

  retryAfterSeconds: number | null;

  acceptedAt: string | null;
  completedAt: string;

  metadata: {
    provider: string;
    sandbox: boolean;
    simulated: boolean;
  };
};

export type OutboxCandidateDecision = "process" | "skip" | "expire" | "dead_letter" | "invalid";

export type OutboxCandidateEvaluation = {
  decision: OutboxCandidateDecision;
  actionable: boolean;
  reasons: OutboxWorkerPlanReason[];
  warnings: string[];

  recordId: number | string;
  commandId: string;
  idempotencyKey: string;
  actionId: string;
  status: OutboxMessageStatus;
  channel: "whatsapp";
  commandType: "whatsapp_text";

  recipientMasked: string | null;

  availableAt: string;
  expiresAt: string | null;
  leaseExpiresAt: string | null;

  claimedBy: string | null;
  claimOwnedByWorker: boolean;
  leaseExpired: boolean;
  claimRecoverable: boolean;

  attemptCount: number;
  maxAttempts: number;
  attemptsRemaining: number;

  sandbox: boolean;
  transportEnabled: boolean;
  workerEnabled: boolean;
  workerId: string;
  now: string;
};

export type OutboxWorkerAuditEventType =
  | "outbox_processing_started"
  | "outbox_delivered"
  | "outbox_retry_scheduled"
  | "outbox_failed"
  | "outbox_dead_lettered"
  | "outbox_expired"
  | "outbox_claim_released";

export type OutboxWorkerAuditEventDraft = {
  eventId: string;
  eventType: OutboxWorkerAuditEventType;

  reason: OutboxWorkerPlanReason;
  metadata: Record<string, unknown>;

  createdAt: string;
};

export type OutboxWorkerMutationPlan = {
  planId: string;
  planKey: string;
  planType: OutboxWorkerPlanType;

  rowId: number | string;
  commandId: string;
  idempotencyKey: string;

  expectedStatuses: OutboxMessageStatus[];

  patch: {
    nextStatus: OutboxMessageStatus;

    attemptCount?: number;
    availableAt?: string;

    claimedBy?: string | null;
    claimedAt?: string | null;
    leaseExpiresAt?: string | null;

    lastAttemptAt?: string | null;
    deliveredAt?: string | null;

    providerMessageId?: string | null;

    lastErrorCode?: string | null;
    lastErrorMessageSafe?: string | null;

    updatedAt: string;
  };

  auditEvent:
    | {
        eventId: string;
        eventType: OutboxWorkerAuditEventType;

        reason: OutboxWorkerPlanReason;
        metadata: Record<string, unknown>;

        createdAt: string;
      }
    | null;

  transportResultSummary: {
    status: MessageTransportResultStatus | null;
    providerMessageId: string | null;
    errorCode: string | null;
  };

  sideEffects: {
    databaseWritten: false;
    messageTransportCalled: boolean;
    externalMessageSent: false;
    metaCalled: false;
  };

  createdAt: string;
};

export type OutboxWorkerProcessResult = {
  status: "processed" | "skipped" | "retry_scheduled" | "delivered" | "dead_letter" | "expired" | "invalid" | "failed";

  recordId: number | string;
  commandId: string;

  candidateEvaluation: OutboxCandidateEvaluation;

  processingPlan: OutboxWorkerMutationPlan | null;
  finalPlan: OutboxWorkerMutationPlan | null;

  transportResult: MessageTransportResult | null;

  warnings: string[];

  sideEffects: {
    databaseWritten: false;
    messageTransportCalled: boolean;
    externalMessageSent: false;
    metaCalled: false;
  };

  processedAt: string;
};

export type OutboxWorkerBatchItemResult = OutboxWorkerProcessResult;

export type OutboxWorkerBatchResult = {
  claimed: number;
  processed: number;
  delivered: number;
  retryScheduled: number;
  deadLettered: number;
  expired: number;
  skipped: number;
  failed: number;
  results: OutboxWorkerBatchItemResult[];
  processedAt: string;
  sideEffects: {
    databaseWritten: false;
    messageTransportCalled: boolean;
    externalMessageSent: false;
    metaCalled: false;
  };
};

export type OutboxWorkerMemoryState = {
  records: OutboxMessageRecord[];
  auditEvents: OutboxWorkerAuditEventDraft[];
  appliedPlanKeys: string[];
};

export type OutboxWorkerApplyResult = {
  applied: boolean;
  duplicate: boolean;
  conflict: boolean;
  rowId: number | string | null;
};

export type OutboxWorkerRepositorySnapshot = OutboxWorkerMemoryState & {
  nextRowId: number;
};

export type OutboxWorkerInput = {
  now: string;
  record: OutboxMessageRecord;
  config: OutboxWorkerConfig;
};

export type OutboxWorkerBatchInput = {
  now: string;
  config: OutboxWorkerConfig;
};

export type OutboxWorkerDependencies = {
  transport: import("./transport").MessageTransport;
};

export type OutboxWorkerBatchDependencies = {
  transport: import("./transport").MessageTransport;
  unitOfWork: import("./repositories").OutboxWorkerUnitOfWork;
};

export type OutboxWorkerPlanInput = {
  now: string;
  record: OutboxMessageRecord;
  config: OutboxWorkerConfig;
  evaluation: OutboxCandidateEvaluation;
  transportResult: MessageTransportResult | null;
  phase: "processing" | "final" | "skip";
};

export type BrainCanonicalOutboxCommandAlias = BrainCanonicalOutboxCommand;
