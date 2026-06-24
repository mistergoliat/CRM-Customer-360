import type { BrainBotEligibility } from "../context/types";
import type { BrainAgentRunResponse } from "../agents/types";
import type { BrainActionPolicy, BrainInstructionAction, BrainNormalizedAction } from "../actions/types";
import type { BrainExecutionPlan } from "../messaging/types";
import type { CommercialShadowResult } from "../commercial/shadow";
import type { CommercialOperationalLoopResult } from "../commercial/operational-loop";
import type { CustomerOnboardingRunResult } from "../commercial/customer-onboarding";

export type { BrainBotEligibility };

export const BRAIN_CHANNELS = ["whatsapp"] as const;
export type BrainChannel = (typeof BRAIN_CHANNELS)[number];

export const BRAIN_CONTEXT_MODES = ["minimal", "standard", "recovery"] as const;
export type BrainContextMode = (typeof BRAIN_CONTEXT_MODES)[number];

export const BRAIN_SOURCES = ["n8n_meta_webhook", "hub_preview", "manual_test", "system_job"] as const;
export type BrainInboundSource = (typeof BRAIN_SOURCES)[number];

export type BrainCustomerRef = {
  waId?: string;
  phoneNumberId?: string;
  idCustomer?: string | number;
  idOrder?: string | number;
  invoiceNumber?: string | number;
  email?: string;
  phone?: string;
  contactId?: string | number;
};

export type BrainProcessInboundOptions = {
  dryRun: boolean;
  executeActions: boolean;
  returnInstructionsForN8n: boolean;
  debug: boolean;
  runAgentDryRun: boolean;
  buildExecutionPlanDryRun: boolean;
  persistOutboxPlan?: boolean;
  preferredAgent?: "knowledge";
};

export const DEFAULT_BRAIN_PROCESS_INBOUND_OPTIONS: BrainProcessInboundOptions = {
  dryRun: true,
  executeActions: false,
  returnInstructionsForN8n: true,
  debug: false,
  runAgentDryRun: false,
  buildExecutionPlanDryRun: false,
  preferredAgent: undefined
};

export type BrainProcessInboundRequest = {
  channel: string;
  source?: BrainInboundSource;
  contextMode?: BrainContextMode;
  waId: string;
  phoneNumberId: string;
  messageId: string;
  messageText: string;
  conversationCaseId?: string | number;
  customerRef?: BrainCustomerRef;
  options?: Partial<BrainProcessInboundOptions>;
  receivedAt?: string;
  sourceWorkflow?: string;
  sourceNode?: string;
  metadata?: Record<string, unknown>;
};

export type BrainNormalizedProcessInboundRequest = {
  channel: BrainChannel;
  source: BrainInboundSource;
  contextMode: BrainContextMode;
  waId: string;
  phoneNumberId: string;
  messageId: string;
  messageText: string;
  conversationCaseId?: string | number;
  customerRef?: BrainCustomerRef;
  options: BrainProcessInboundOptions;
  receivedAt?: string;
  sourceWorkflow?: string;
  sourceNode?: string;
  metadata: Record<string, unknown>;
};

export const BRAIN_ERROR_CODES = [
  "INVALID_INPUT",
  "CONTEXT_UNAVAILABLE",
  "ADAPTER_SKIPPED",
  "ACTION_BLOCKED",
  "UNHANDLED_ERROR"
] as const;
export type BrainErrorCode = (typeof BRAIN_ERROR_CODES)[number];

export type BrainError = {
  code: BrainErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export type BrainValidationResult<T> =
  | { ok: true; value: T; errors: [] }
  | { ok: false; value: null; errors: BrainError[] };

export type BrainResolvedContext = {
  status: "noop";
  source: BrainInboundSource;
  contextMode: BrainContextMode;
  traceId: string;
  waId: string;
  phoneNumberId: string;
  messageId: string;
  conversationCaseId?: string | number;
  customerRef?: BrainCustomerRef;
  sourceWorkflow?: string;
  sourceNode?: string;
  confidence: number;
  notes: string[];
  warnings: string[];
};

export type BrainSuggestedNextStep = "legacy_continue" | "context_only" | "blocked_by_bot_eligibility" | "needs_human_review";

export type BrainContextSummary = {
  requestId: string;
  partialContext: boolean;
  waId: string;
  phoneNumberId: string;
  messageId: string;
  conversationCaseId?: string | number;
  identityType: string;
  identityConfidence: number;
  activeCaseId: string | number | null;
  activeCaseStatus: string | null;
  caseCount: number;
  messageCount: number;
  primaryService: string;
  serviceCode: string;
  botEligible: boolean;
  botRecommendedMode: string;
  botReason: string;
  contextPacksAvailable: string[];
  warnings: string[];
};

export const BRAIN_INSTRUCTION_STATUSES = ["planned", "blocked", "noop"] as const;
export type BrainInstructionStatus = (typeof BRAIN_INSTRUCTION_STATUSES)[number];

export const BRAIN_INSTRUCTION_TARGETS = ["n8n", "backend", "none"] as const;
export type BrainInstructionTarget = (typeof BRAIN_INSTRUCTION_TARGETS)[number];

export const BRAIN_INSTRUCTION_KINDS = [
  "continue_legacy_flow",
  "record_observation",
  "shadow_ai_orchestrator_call",
  "noop"
] as const;
export type BrainInstructionKind = (typeof BRAIN_INSTRUCTION_KINDS)[number];

export type BrainInstruction = {
  id: string;
  kind: BrainInstructionKind;
  status: BrainInstructionStatus;
  target: BrainInstructionTarget;
  enabled: boolean;
  reason: string;
  payload?: Record<string, unknown>;
};

export type BrainInstructions = {
  version: string;
  dryRun: boolean;
  executeActions: boolean;
  returnInstructionsForN8n: boolean;
  continueLegacyFlow: boolean;
  contextSummary: BrainContextSummary;
  actionPolicy: BrainActionPolicy;
  normalizedAction: BrainNormalizedAction;
  blockedReasons: string[];
  contextPacksAvailable: string[];
  botEligibility: BrainBotEligibility | null;
  suggestedNextStep: BrainSuggestedNextStep;
  actions: BrainInstructionAction[];
  steps: BrainInstruction[];
};

export const BRAIN_INBOUND_OUTBOX_PLAN_STATUSES = [
  "skipped_by_flag",
  "skipped_by_policy",
  "planned",
  "existing",
  "warning"
] as const;
export type BrainInboundOutboxPlanStatus = (typeof BRAIN_INBOUND_OUTBOX_PLAN_STATUSES)[number];

export type BrainInboundOutboxPlanResult = {
  status: BrainInboundOutboxPlanStatus;
  existing: boolean;
  outbox_id: number | null;
  dedupe_key: string | null;
  reason?: string | null;
  warning?: string | null;
};

export type BrainProcessInboundResponse = {
  ok: boolean;
  requestId: string;
  channel: string;
  source: BrainInboundSource;
  normalized: BrainNormalizedProcessInboundRequest | null;
  context: BrainResolvedContext | null;
  context_summary: BrainContextSummary | null;
  bot_eligibility: BrainBotEligibility | null;
  context_packs_available: string[];
  suggested_next_step: BrainSuggestedNextStep;
  action_policy: BrainActionPolicy | null;
  normalized_action: BrainNormalizedAction | null;
  blocked_reasons: string[];
  context_debug?: unknown;
  agent_draft?: BrainAgentRunResponse["draft"] | null;
  execution_plan?: BrainExecutionPlan | null;
  outbox_plan_result?: BrainInboundOutboxPlanResult | null;
  instructions: BrainInstructions;
  warnings: string[];
  errors: BrainError[];
  adapters: {
    aiOrchestrator: {
      status: "deferred" | "skipped" | "mock";
      decisionId: string | null;
      reason: string;
    };
    commercialShadow?: CommercialShadowResult | null;
    commercialOperationalLoop?: CommercialOperationalLoopResult | null;
    customerOnboarding?: CustomerOnboardingRunResult | null;
  };
  metadata: {
    version: string;
    generatedAt: string;
    processingMs: number;
    dryRun: boolean;
    executeActions: boolean;
    returnInstructionsForN8n: boolean;
    debug: boolean;
  };
};
