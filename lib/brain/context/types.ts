import type { BrainChannel, BrainCustomerRef, BrainError, BrainInboundSource } from "../inbound/types";
import type { CustomerIdentityResolutionResult } from "../../customer-identity";

export type BrainContextResolveOptions = {
  dryRun: boolean;
  maxMessages: number;
  maxAgentRuns: number;
  maxCases: number;
  includePostventa: boolean;
  includeAgentRuns: boolean;
  debug: boolean;
};

export const DEFAULT_BRAIN_CONTEXT_RESOLVE_OPTIONS: BrainContextResolveOptions = {
  dryRun: true,
  maxMessages: 12,
  maxAgentRuns: 5,
  maxCases: 5,
  includePostventa: true,
  includeAgentRuns: true,
  debug: false
};

export type BrainContextResolveRequest = {
  channel: BrainChannel;
  source: BrainInboundSource;
  waId: string;
  phoneNumberId: string;
  messageId: string;
  messageText: string;
  conversationCaseId?: string | number;
  idOrder?: string | number;
  idCustomer?: string | number;
  invoiceNumber?: string | number;
  email?: string;
  phone?: string;
  sourceWorkflow?: string;
  sourceNode?: string;
  customerRef?: BrainCustomerRef;
  options: BrainContextResolveOptions;
};

export type BrainLegacyCaseSummary = {
  conversation_case_id: string | number | null;
  active_case_key: string | null;
  status: string | null;
  lifecycle_status: string | null;
  department: string | null;
  service_code: string | null;
  priority: string | null;
  requires_human: boolean;
  bot_replied: boolean;
  final_action: string | null;
  ai_blocked: boolean;
  wa_id: string | null;
  phone_number_id: string | null;
  id_order: string | number | null;
  id_customer: string | number | null;
  invoice_number: string | number | null;
  source_table: string | null;
  source_id: string | number | null;
  whatsapp_window_open: boolean | null;
  last_message_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  closed_at: string | null;
  raw_status: string | null;
};

export type BrainLegacyMessageSummary = {
  message_id: string | number | null;
  conversation_case_id: string | number | null;
  wa_id: string | null;
  phone_number_id: string | null;
  direction: "inbound" | "outbound" | "manual" | "system" | null;
  message_type: string | null;
  message_text: string | null;
  final_action: string | null;
  status: string | null;
  intent: string | null;
  department: string | null;
  occurred_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  source_table: string | null;
  source_id: string | number | null;
  technical_origin: string | null;
};

export type BrainLegacyAgentRunSummary = {
  agent_name: string | null;
  agent_version: string | null;
  status: string | null;
  intent: string | null;
  confidence: number | null;
  risk_level: string | null;
  requires_human: boolean | null;
  target_agent: string | null;
  source_table: string | null;
  source_id: string | number | null;
  customer_id: string | number | null;
  case_id: string | number | null;
  conversation_message_id: string | number | null;
  created_at: string | null;
  updated_at: string | null;
};

export type BrainLegacySuppressionSummary = {
  wa_id: string | null;
  phone_number_id: string | null;
  contact_id: string | number | null;
  id_customer: string | number | null;
  id_order: string | number | null;
  invoice_number: string | number | null;
  suppression_active: boolean;
  hard_suppression: boolean;
  suppression_reason: string | null;
  blocked_until: string | null;
  created_at: string | null;
  updated_at: string | null;
  source_table: string | null;
};

export type BrainLegacyOrderSummary = {
  id_order: string | number | null;
  id_customer: string | number | null;
  invoice_number: string | number | null;
  reference: string | null;
  status: string | null;
  total_paid: string | number | null;
  customer_name: string | null;
  payment: string | null;
  created_at: string | null;
  updated_at: string | null;
  source_table: string | null;
};

export type BrainLegacyQueueSummary = {
  source_table: string | null;
  source_domain: string | null;
  source_id: string | number | null;
  id_order: string | number | null;
  id_customer: string | number | null;
  invoice_number: string | number | null;
  phone_normalized: string | null;
  status: string | null;
  estado_caso: string | null;
  last_intent: string | null;
  requires_human: boolean | null;
  canal_derivacion: string | null;
  last_inbound_text: string | null;
  last_inbound_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type BrainInputEvent = {
  channel: BrainChannel;
  source: BrainInboundSource;
  wa_id: string;
  phone_number_id: string;
  message_id: string;
  message_text: string;
  conversation_case_id?: string | number;
  id_order?: string | number;
  id_customer?: string | number;
  invoice_number?: string | number;
  source_workflow?: string;
  source_node?: string;
  received_at?: string;
  dry_run: boolean;
};

export type BrainResolverIdentity = {
  provisional: true;
  identity_type: "wa_id" | "conversation_case_id" | "id_order" | "id_customer" | "invoice_number" | "mixed" | "unknown";
  identity_key: string;
  confidence: number;
  wa_id: string;
  phone_number_id: string;
  conversation_case_id: string | number | null;
  id_order: string | number | null;
  id_customer: string | number | null;
  invoice_number: string | number | null;
  notes: string[];
};

export type BrainCustomerContext = {
  wa_id: string;
  phone_number_id: string;
  contact_name: string | null;
  email: string | null;
  contact_id: string | number | null;
  id_customer: string | number | null;
  id_order: string | number | null;
  invoice_number: string | number | null;
  suppression_active: boolean;
  hard_suppression: boolean;
  suppression_reason: string | null;
  blocked_until: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  last_manual_reply_at: string | null;
  open_cases_count: number;
  active_case_id: string | number | null;
  active_case_status: string | null;
  latest_case_status: string | null;
  customer_candidate: CustomerIdentityResolutionResult | null;
};

export type BrainCaseContext = {
  active_case: BrainLegacyCaseSummary | null;
  latest_case: BrainLegacyCaseSummary | null;
  open_cases: BrainLegacyCaseSummary[];
  case_count: number;
  waiting_human_case: boolean;
  closed_or_rejected_case: boolean;
  manual_operator_lock: boolean;
  last_case_status: string | null;
  last_case_final_action: string | null;
};

export type BrainConversationContext = {
  recent_messages: BrainLegacyMessageSummary[];
  recent_inbound_messages: BrainLegacyMessageSummary[];
  recent_outbound_messages: BrainLegacyMessageSummary[];
  recent_manual_replies: BrainLegacyMessageSummary[];
  recent_agent_runs: BrainLegacyAgentRunSummary[];
  message_count: number;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  last_manual_reply_at: string | null;
};

export type BrainBusinessContext = {
  ps_orders: BrainLegacyOrderSummary[];
  postventa_queue: BrainLegacyQueueSummary | null;
  mantenciones_queue: BrainLegacyQueueSummary | null;
  context_mode: string;
  dry_run: boolean;
  include_postventa: boolean;
  include_agent_runs: boolean;
};

export type BrainServiceContext = {
  primary_service: "sales" | "sac" | "postventa_armado" | "postventa_mantencion" | "postventa_general" | "knowledge" | "campaign" | "unknown";
  service_code: string;
  source_domain: string | null;
  source_table: string | null;
  source_id: string | number | null;
  source_status: string | null;
  source_priority: string | null;
  suggested_agent: string | null;
  signals: string[];
};

export type BrainBotEligibilitySignals = {
  manual_operator_lock: boolean;
  active_human_case: boolean;
  suppression_active: boolean;
  recent_manual_reply: boolean;
  open_case_waiting_human: boolean;
  closed_or_rejected_case: boolean;
  ambiguous_positive_reply_with_service_context: boolean;
};

export type BrainBotEligibility = {
  eligible: boolean;
  recommended_mode: "bot" | "human" | "review";
  confidence: number;
  reason: string;
  blockers: string[];
  can_auto_reply: boolean;
  can_human_handoff: boolean;
  can_case_mutation: boolean;
  signals: BrainBotEligibilitySignals;
};

export type BrainContextPack = {
  agent: string;
  available: boolean;
  confidence: number;
  reason: string;
  signals: string[];
  recommended_action: string;
  related_case_id: string | number | null;
  related_order_id: string | number | null;
};

export type BrainContextPacks = {
  sales: BrainContextPack;
  sac: BrainContextPack;
  postventa: BrainContextPack;
  knowledge: BrainContextPack;
  campaign: BrainContextPack;
};

export type BrainContextResolveResponse = {
  ok: boolean;
  request_id: string;
  partial_context: boolean;
  input_event: BrainInputEvent;
  resolver_identity: BrainResolverIdentity;
  customer_context: BrainCustomerContext;
  case_context: BrainCaseContext;
  conversation_context: BrainConversationContext;
  business_context: BrainBusinessContext;
  service_context: BrainServiceContext;
  bot_eligibility: BrainBotEligibility;
  context_packs: BrainContextPacks;
  warnings: string[];
  errors: BrainError[];
  metadata: {
    version: string;
    generatedAt: string;
    processingMs: number;
    dryRun: boolean;
    maxMessages: number;
    maxAgentRuns: number;
    maxCases: number;
    includePostventa: boolean;
    includeAgentRuns: boolean;
    sourceWorkflow?: string;
    sourceNode?: string;
  };
};
