export const AI_CONTEXT_MODES = ["minimal", "standard", "recovery"] as const;
export type AiContextMode = (typeof AI_CONTEXT_MODES)[number];

export const AI_SOURCES = ["n8n_meta_webhook", "hub_preview", "manual_test", "system_job"] as const;
export type AiOrchestrationSource = (typeof AI_SOURCES)[number];

export const AI_INTENTS = [
  "sales",
  "postventa",
  "sac",
  "knowledge",
  "followup",
  "close_request",
  "consulta_general",
  "unknown"
] as const;
export type AiIntent = (typeof AI_INTENTS)[number];

export const AI_DEPARTMENTS = ["Ventas", "Postventa", "SAC", "Knowledge", "Operaciones", "Unknown"] as const;
export type AiDepartment = (typeof AI_DEPARTMENTS)[number];

export const AI_COMMERCIAL_STATUSES = [
  "new_lead",
  "quote_requested",
  "quote_sent",
  "purchase_intent",
  "post_sale",
  "followup_needed",
  "not_applicable",
  "unknown"
] as const;
export type AiCommercialStatus = (typeof AI_COMMERCIAL_STATUSES)[number];

export const AI_CUSTOMER_SIGNALS = [
  "asks_price",
  "asks_stock",
  "asks_shipping",
  "asks_human",
  "complaint",
  "post_sale_help",
  "decline",
  "continue",
  "no_signal",
  "unknown"
] as const;
export type AiCustomerSignal = (typeof AI_CUSTOMER_SIGNALS)[number];

export const AI_FINAL_ACTIONS = [
  "reply",
  "handoff_to_human",
  "human_required",
  "no_action",
  "close_case",
  "followup_needed"
] as const;
export type AiFinalAction = (typeof AI_FINAL_ACTIONS)[number];

export const AI_NEXT_ACTIONS = [
  "send_reply",
  "assign_human",
  "mark_human_required",
  "close_case",
  "schedule_followup",
  "noop"
] as const;
export type AiNextAction = (typeof AI_NEXT_ACTIONS)[number];

export const AI_ACTION_TYPES = [
  "send_whatsapp_reply",
  "create_case",
  "update_case",
  "assign_human",
  "close_case",
  "schedule_followup",
  "noop"
] as const;
export type AiActionType = (typeof AI_ACTION_TYPES)[number];

export const AI_ACTION_STATUSES = ["planned", "blocked"] as const;
export type AiActionStatus = (typeof AI_ACTION_STATUSES)[number];

export const AI_ERROR_CODES = [
  "INVALID_INPUT",
  "INVALID_OUTPUT",
  "TIMEOUT",
  "CONTEXT_EXCEEDED",
  "LOW_CONFIDENCE",
  "FEATURE_DISABLED",
  "MODEL_UNAVAILABLE",
  "UNHANDLED_ERROR"
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export type AiCustomerRef = {
  waId?: string;
  phoneNumberId?: string;
  idCustomer?: string | number;
  idOrder?: string | number;
  invoiceNumber?: string | number;
  email?: string;
  contactId?: string | number;
};

export type AiOrchestrationLimits = {
  maxHistoryMessages: number;
  maxContextChars: number;
  maxOutputTokens: number;
  timeoutMs: number;
};

export type AiOrchestrationFeatureFlags = {
  allowAutoReply: boolean;
  allowCaseMutation: boolean;
  allowHumanHandoff: boolean;
  allowCaseClose: boolean;
  allowFollowup: boolean;
  shadowLog: boolean;
  dryRun: boolean;
};

export type AiOrchestrationRequest = {
  source: AiOrchestrationSource;
  contextMode: AiContextMode;
  waId: string;
  phoneNumberId: string;
  messageId: string;
  messageText: string;
  conversationCaseId?: string | number;
  customerRef?: AiCustomerRef;
  limits: AiOrchestrationLimits;
  featureFlags: AiOrchestrationFeatureFlags;
};

export type AiSafetyFlags = {
  invalidOutput: boolean;
  timeout: boolean;
  contextExceeded: boolean;
  lowConfidence: boolean;
  featureDisabled: boolean;
  modelUnavailable: boolean;
};

export type AiDecisionMetadata = {
  contextMode: AiContextMode;
  modelProvider?: string;
  modelName?: string;
  promptVersion?: string;
  validatorVersion: string;
  dryRun: boolean;
  generatedAt: string;
  warnings: string[];
};

export type AiDecisionEnvelope = {
  decisionId: string;
  agentName: string;
  agentVersion: string;
  source: AiOrchestrationSource;
  intent: AiIntent;
  department: AiDepartment;
  caseTopic: string;
  commercialStatus: AiCommercialStatus;
  customerSignal: AiCustomerSignal;
  finalAction: AiFinalAction;
  requiresHuman: boolean;
  shouldReply: boolean;
  replyText: string;
  summaryForOperator: string;
  nextAction: AiNextAction;
  nextActionAt: string | null;
  confidence: number;
  reasonSummary: string;
  safetyFlags: AiSafetyFlags;
  metadata: AiDecisionMetadata;
};

export type AiPlannedAction = {
  type: AiActionType;
  status: AiActionStatus;
  enabled: boolean;
  reason: string;
  payload?: Record<string, unknown>;
};

export type AiUsage = {
  inputChars: number;
  contextChars: number;
  outputChars: number;
  historyMessages: number;
  elapsedMs: number;
  modelInputTokens?: number;
  modelOutputTokens?: number;
};

export type AiError = {
  code: AiErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export type AiOrchestrationResponse = {
  ok: boolean;
  decisionId: string | null;
  envelope: AiDecisionEnvelope | null;
  actions: AiPlannedAction[];
  usage: AiUsage;
  errors: AiError[];
};

export const DEFAULT_AI_ORCHESTRATION_LIMITS: AiOrchestrationLimits = {
  maxHistoryMessages: 12,
  maxContextChars: 24000,
  maxOutputTokens: 900,
  timeoutMs: 12000
};

export const DEFAULT_AI_ORCHESTRATION_FEATURE_FLAGS: AiOrchestrationFeatureFlags = {
  allowAutoReply: false,
  allowCaseMutation: false,
  allowHumanHandoff: true,
  allowCaseClose: false,
  allowFollowup: false,
  shadowLog: false,
  dryRun: true
};
