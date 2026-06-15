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
