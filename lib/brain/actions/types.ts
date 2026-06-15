import type { BrainBotEligibility, BrainContextSummary, BrainSuggestedNextStep, BrainInboundSource } from "../inbound/types";
import type { BrainServiceContext } from "../context/types";

export type BrainActionKind = "no_action" | "continue_legacy" | "context_only" | "needs_human_review" | "blocked";

export type BrainActionResolveOptions = {
  dryRun: boolean;
  executeActions: boolean;
  returnInstructionsForN8n: boolean;
  debug: boolean;
};

export const DEFAULT_BRAIN_ACTION_RESOLVE_OPTIONS: BrainActionResolveOptions = {
  dryRun: true,
  executeActions: false,
  returnInstructionsForN8n: true,
  debug: false
};

export type BrainActionDecision = {
  intent?: string;
  department?: string;
  caseTopic?: string;
  finalAction?: string;
  requiresHuman?: boolean;
  shouldReply?: boolean;
  replyText?: string;
  confidence?: number;
};

export type BrainActionResolveRequest = {
  requestId?: string;
  source: BrainInboundSource;
  waId: string;
  phoneNumberId: string;
  messageId: string;
  messageText: string;
  conversationCaseId?: string | number;
  contextSummary: BrainContextSummary;
  botEligibility: BrainBotEligibility | null;
  serviceContext: Pick<
    BrainServiceContext,
    "primary_service" | "service_code" | "source_domain" | "source_table" | "source_id" | "source_status" | "source_priority" | "suggested_agent" | "signals"
  >;
  options: BrainActionResolveOptions;
  decision?: BrainActionDecision;
};

export type BrainActionPolicy = {
  policyId: string;
  decision: BrainActionKind;
  reason: string;
  blocked_reasons: string[];
  can_auto_reply: boolean;
  can_human_handoff: boolean;
  can_case_mutation: boolean;
  continue_legacy_flow: boolean;
  should_reply: boolean;
  requires_human: boolean;
  confidence: number;
  signals: string[];
  suggested_next_step: BrainSuggestedNextStep;
};

export type BrainNormalizedAction = {
  action: BrainActionKind;
  final_action: string;
  should_reply: boolean;
  should_continue_legacy_flow: boolean;
  requires_human: boolean;
  blocked: boolean;
  allow_auto_reply: boolean;
  allow_human_handoff: boolean;
  allow_case_mutation: boolean;
  reason: string;
  blocked_reasons: string[];
  signals: string[];
};

export type BrainInstructionAction = {
  id: string;
  action: BrainActionKind;
  status: "planned" | "blocked" | "noop";
  target: "n8n" | "backend" | "none";
  enabled: boolean;
  reason: string;
  blocked_reasons: string[];
  payload?: Record<string, unknown>;
};

export type BrainActionResolveResponse = {
  ok: boolean;
  request_id: string;
  context_summary: BrainContextSummary;
  bot_eligibility: BrainBotEligibility | null;
  service_context: Pick<
    BrainServiceContext,
    "primary_service" | "service_code" | "source_domain" | "source_table" | "source_id" | "source_status" | "source_priority" | "suggested_agent" | "signals"
  >;
  action_policy: BrainActionPolicy;
  normalized_action: BrainNormalizedAction;
  blocked_reasons: string[];
  warnings: string[];
  errors: {
    code: string;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  }[];
  instructions: {
    version: string;
    dryRun: boolean;
    executeActions: boolean;
    returnInstructionsForN8n: boolean;
    continueLegacyFlow: boolean;
    contextSummary: BrainContextSummary;
    actionPolicy: BrainActionPolicy;
    normalizedAction: BrainNormalizedAction;
    blockedReasons: string[];
    botEligibility: BrainBotEligibility | null;
    contextPacksAvailable: string[];
    suggestedNextStep: BrainSuggestedNextStep;
    actions: BrainInstructionAction[];
    steps: unknown[];
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
