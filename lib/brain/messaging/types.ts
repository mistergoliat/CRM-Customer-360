import type { BrainError } from "../inbound/types";

export const BRAIN_EXECUTE_SOURCES = ["brain", "n8n", "operator"] as const;
export type BrainExecutionSource = (typeof BRAIN_EXECUTE_SOURCES)[number];

export const BRAIN_EXECUTION_ACTION_TYPES = [
  "send_whatsapp_message",
  "update_case",
  "handoff",
  "close_case",
  "no_action"
] as const;
export type BrainExecutionActionType = (typeof BRAIN_EXECUTION_ACTION_TYPES)[number];

export const BRAIN_EXECUTION_STATUSES = ["planned", "blocked", "noop"] as const;
export type BrainExecutionStatus = (typeof BRAIN_EXECUTION_STATUSES)[number];

export const BRAIN_OUTBOX_STATUSES = ["planned", "pending", "locked", "sending", "sent", "failed", "cancelled", "blocked"] as const;
export type BrainOutboxStatus = (typeof BRAIN_OUTBOX_STATUSES)[number];

export type BrainExecutionBlockReason = {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export type BrainExecutionActionPolicy = {
  allowedToAutoReply?: boolean;
  can_auto_reply?: boolean;
  requiresHuman?: boolean;
  requires_human?: boolean;
  blockedReasons?: string[];
  blocked_reasons?: string[];
  canAutoReply?: boolean;
  canHumanHandoff?: boolean;
  canCaseMutation?: boolean;
  continueLegacyFlow?: boolean;
  reason?: string;
};

export type BrainExecutionBotEligibility = {
  canAutoReply?: boolean;
  can_auto_reply?: boolean;
  requiresHuman?: boolean;
  requires_human?: boolean;
  blockedReasons?: string[];
  blocked_reasons?: string[];
  suppressionActive?: boolean;
  suppression_active?: boolean;
  recentManualReply?: boolean;
  recent_manual_reply?: boolean;
  activeHumanLock?: boolean;
  active_human_lock?: boolean;
  manualOperatorLock?: boolean;
  manual_operator_lock?: boolean;
  activeHumanCase?: boolean;
  active_human_case?: boolean;
  openCaseWaitingHuman?: boolean;
  open_case_waiting_human?: boolean;
  activeCaseId?: string | number | null;
};

export type BrainExecuteAction = {
  type: BrainExecutionActionType;
  payload?: Record<string, unknown>;
  source?: BrainExecutionSource;
};

export type BrainMetaWhatsAppTextPayloadPreview = {
  messaging_product: "whatsapp";
  to: string;
  type: "text";
  text: {
    body: string;
  };
};

export const BRAIN_META_SEND_ADAPTER_STATUSES = ["disabled", "configured", "missing_credentials"] as const;
export type BrainMetaSendAdapterStatus = (typeof BRAIN_META_SEND_ADAPTER_STATUSES)[number];

export const BRAIN_META_SEND_ERROR_CODES = [
  "disabled",
  "missing_credentials",
  "invalid_payload",
  "blocked_by_policy",
  "meta_http_error",
  "meta_network_error"
] as const;
export type BrainMetaSendErrorCode = (typeof BRAIN_META_SEND_ERROR_CODES)[number];

export const BRAIN_META_SEND_OUTCOME_STATUSES = [
  "disabled",
  "missing_credentials",
  "invalid_payload",
  "blocked_by_policy",
  "sent",
  "failed"
] as const;
export type BrainMetaSendOutcomeStatus = (typeof BRAIN_META_SEND_OUTCOME_STATUSES)[number];

export type BrainMetaSendRequest = {
  waId: string;
  phoneNumberId: string;
  messageText: string;
  timeoutMs?: number;
  source?: BrainExecutionSource;
  sourceRequestId?: string | null;
  conversationCaseId?: string | number | null;
  actionPolicy?: BrainExecutionActionPolicy;
  botEligibility?: BrainExecutionBotEligibility;
  metadata?: Record<string, unknown>;
};

export type MetaSendRequest = BrainMetaSendRequest;

export type BrainMetaSendGuardResult = {
  ok: boolean;
  adapterStatus: BrainMetaSendAdapterStatus;
  blockedReasons: string[];
  warnings: string[];
  errorCode: BrainMetaSendErrorCode | null;
  errorMessage: string | null;
  metaPayloadPreview: BrainMetaWhatsAppTextPayloadPreview | null;
};

export type BrainMetaSendResponse = {
  ok: boolean;
  status: BrainMetaSendOutcomeStatus;
  error_code?: BrainMetaSendErrorCode | null;
  error_message?: string | null;
  blocked_reasons: string[];
  warnings: string[];
  http_status?: number | null;
  provider_message_id?: string | null;
  meta_payload_preview?: BrainMetaWhatsAppTextPayloadPreview | null;
  response_body?: Record<string, unknown> | null;
  adapter_status?: BrainMetaSendAdapterStatus;
};

export type MetaSendResponse = BrainMetaSendResponse;

export type MetaSendGuardResult = BrainMetaSendGuardResult;

export type MetaSendAdapterStatus = BrainMetaSendAdapterStatus;

export type MetaSendErrorCode = BrainMetaSendErrorCode;

export type MetaSendOutcomeStatus = BrainMetaSendOutcomeStatus;

export type BrainOutboxPreview = {
  dedupe_key: string;
  channel: "whatsapp";
  status: BrainExecutionStatus;
  action_type: BrainExecutionActionType;
  duplicate_detected: boolean;
  reason: string;
};

export type BrainOutboxResult = {
  persisted: boolean;
  existing: boolean;
  status: BrainOutboxStatus;
  dedupe_key: string;
  outbox_id: number | null;
  warning?: string;
  error?: string;
};

export const BRAIN_OUTBOX_WORKER_STATUSES = ["disabled", "planned", "locked", "sending", "sent", "noop", "blocked", "failed"] as const;
export type BrainOutboxWorkerStatus = (typeof BRAIN_OUTBOX_WORKER_STATUSES)[number];

export const BRAIN_OUTBOX_WORKER_MODES = ["disabled", "dry_run", "lock_only", "send_locked", "noop", "blocked", "failed"] as const;
export type BrainOutboxWorkerMode = (typeof BRAIN_OUTBOX_WORKER_MODES)[number];

export type BrainOutboxWorkerRequest = {
  requestId?: string;
  dryRun?: boolean;
  lockOnly?: boolean;
  sendLocked?: boolean;
  outboxId?: number | string | null;
  limit?: number;
  debug?: boolean;
  metadata?: Record<string, unknown>;
};

export type BrainOutboxWorkerCandidate = {
  id: number | null;
  dedupe_key: string;
  status: BrainOutboxStatus;
  source: string | null;
  wa_id: string | null;
  phone_number_id: string | null;
  conversation_case_id: string | number | null;
  message_text_preview: string | null;
  message_text_length: number | null;
  planned_at: string | null;
  locked_at: string | null;
  failed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  stale_locked: boolean;
};

export type BrainOutboxWorkerLockedRecord = {
  id: number | null;
  previous_status: "planned";
  status: "locked";
  dedupe_key: string;
  locked_at: string | null;
};

export type BrainOutboxWorkerSkippedRecord = {
  id: number | null;
  previous_status: BrainOutboxStatus;
  status: BrainOutboxStatus;
  dedupe_key: string;
  reason: string;
  stale_locked: boolean;
};

export const BRAIN_CANONICAL_OUTBOUND_PERSIST_STATUSES = [
  "skipped_by_flag",
  "skipped",
  "persisted",
  "existing",
  "warning"
] as const;
export type BrainCanonicalOutboundPersistStatus = (typeof BRAIN_CANONICAL_OUTBOUND_PERSIST_STATUSES)[number];

export type BrainCanonicalOutboundPersistResult = {
  status: BrainCanonicalOutboundPersistStatus;
  message_id: number | null;
  warning?: string | null;
};

export const BRAIN_CASE_UPDATE_STATUSES = [
  "skipped_by_flag",
  "skipped_no_case_id",
  "skipped_no_canonical_message",
  "updated",
  "warning"
] as const;
export type BrainCaseUpdateStatus = (typeof BRAIN_CASE_UPDATE_STATUSES)[number];

export type BrainCaseUpdateResult = {
  status: BrainCaseUpdateStatus;
  case_id: string | number | null;
  updated_fields: string[];
  warning?: string | null;
};

export type BrainOutboxWorkerSentRecord = {
  outbox_id: number | null;
  previous_status: "sending";
  status: "sent";
  dedupe_key: string;
  provider_message_id: string | null;
  sent_at: string | null;
  error_code: null;
  error_message: null;
  stale_locked: boolean;
  canonical_persist_result?: BrainCanonicalOutboundPersistResult | null;
  case_update_result?: BrainCaseUpdateResult | null;
};

export type BrainOutboxWorkerFailedRecord = {
  outbox_id: number | null;
  previous_status: "locked" | "sending";
  status: "failed";
  dedupe_key: string;
  provider_message_id: string | null;
  sent_at: string | null;
  failed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  stale_locked: boolean;
};

export type BrainOutboxTransitionResult = {
  outbox_id: number | null;
  dedupe_key: string;
  from_status: BrainOutboxStatus;
  to_status: BrainOutboxStatus;
  allowed: boolean;
  applied: boolean;
  simulated: boolean;
  retryable: boolean;
  reason: string;
  blocked_reasons: string[];
  warnings: string[];
  locked_at?: string | null;
  failed_at?: string | null;
  metadata?: Record<string, unknown>;
};

export type BrainOutboxWorkerPlan = {
  mode: BrainOutboxWorkerMode;
  enabled: boolean;
  allowRealSend: boolean;
  dryRun: boolean;
  lockOnly?: boolean;
  sendLocked?: boolean;
  outboxId?: number | string | null;
  debug?: boolean;
  limit: number;
  batchSize: number;
  lockSeconds: number;
  candidateCount: number;
  lockedCount: number;
  skippedCount: number;
  selectedCount: number;
  sentCount?: number;
  failedCount?: number;
  candidates: BrainOutboxWorkerCandidate[];
  lockedRecords: BrainOutboxWorkerLockedRecord[];
  skippedRecords: BrainOutboxWorkerSkippedRecord[];
  sentRecords?: BrainOutboxWorkerSentRecord[];
  failedRecords?: BrainOutboxWorkerFailedRecord[];
  transitionResults: BrainOutboxTransitionResult[];
  blocked_reasons: string[];
  warnings: string[];
  notes: string[];
};

export type BrainOutboxWorkerResponse = {
  ok: boolean;
  disabled: boolean;
  status: BrainOutboxWorkerStatus;
  reason?: string | null;
  dryRun: boolean;
  lockOnly: boolean;
  sendLocked: boolean;
  debug: boolean;
  locked_count: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  candidates: BrainOutboxWorkerCandidate[];
  locked_records: BrainOutboxWorkerLockedRecord[];
  skipped_records: BrainOutboxWorkerSkippedRecord[];
  sent_records: BrainOutboxWorkerSentRecord[];
  failed_records: BrainOutboxWorkerFailedRecord[];
  error_code?: "disabled" | "invalid_payload" | "real_send_disabled" | "invalid_send_request" | "blocked" | "failed" | null;
  error_message?: string | null;
  blocked_reasons: string[];
  warnings: string[];
  plan: BrainOutboxWorkerPlan;
  metadata: {
    version: string;
    generatedAt: string;
    processingMs: number;
    enabled: boolean;
    allowRealSend: boolean;
    dryRun: boolean;
    lockOnly: boolean;
    sendLocked: boolean;
    debug: boolean;
    limit: number;
    batchSize: number;
    lockSeconds: number;
    outboxId: number | string | null;
  };
};

export type BrainExecutionPlan = {
  type: BrainExecutionActionType;
  status: BrainExecutionStatus;
  executable: false;
  requires_human: boolean;
  reason: string;
  source: BrainExecutionSource;
  blocked_reasons: string[];
  block_reasons: BrainExecutionBlockReason[];
  meta_payload_preview?: BrainMetaWhatsAppTextPayloadPreview | null;
  outbox_preview?: BrainOutboxPreview | null;
};

export type BrainExecuteRequest = {
  requestId?: string;
  source: BrainExecutionSource;
  dryRun: boolean;
  executeActions: boolean;
  persistOutboxPlan?: boolean;
  action: BrainExecuteAction;
  actionPolicy?: BrainExecutionActionPolicy;
  botEligibility?: BrainExecutionBotEligibility;
  context?: {
    waId?: string;
    phoneNumberId?: string;
    messageId?: string;
    conversationCaseId?: string | number;
    messageText?: string;
    sourceWorkflow?: string;
    sourceNode?: string;
  };
  metadata?: Record<string, unknown>;
  warnings?: string[];
};

export type BrainExecuteResponse = {
  ok: boolean;
  dryRun: boolean;
  executable: boolean;
  requires_human: boolean;
  execution_plan: BrainExecutionPlan;
  outbox_result?: BrainOutboxResult | null;
  blocked_reasons: string[];
  block_reasons: BrainExecutionBlockReason[];
  meta_payload_preview?: BrainMetaWhatsAppTextPayloadPreview | null;
  outbox_preview?: BrainOutboxPreview | null;
  warnings: string[];
  errors: BrainError[];
  metadata: {
    version: string;
    generatedAt: string;
    processingMs: number;
    source: BrainExecutionSource;
    dryRun: boolean;
    executeActions: boolean;
    send_adapter_status?: BrainMetaSendAdapterStatus;
  };
};
