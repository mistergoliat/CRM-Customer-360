/**
 * Capability Gateway v1 (ACS-R1-01 / ADR-006). Single contract every governed
 * capability must implement. The gateway informs availability, executes,
 * persists and returns evidence - it never decides commercial strategy.
 */
import type { NativeCustomerSessionExecutionContext } from "../native-cycle/customer-session/types";

export const CAPABILITY_AVAILABILITY_STATUSES = [
  "available",
  "unavailable",
  "denied",
  "requires_approval",
  "temporarily_blocked"
] as const;
export type CapabilityAvailabilityStatus = (typeof CAPABILITY_AVAILABILITY_STATUSES)[number];

export const CAPABILITY_GATEWAY_EXECUTION_STATUSES = [
  "completed",
  "missing_information",
  "denied",
  "requires_approval",
  "temporarily_blocked",
  "invalid_arguments",
  "failed"
] as const;
export type CapabilityGatewayExecutionStatus = (typeof CAPABILITY_GATEWAY_EXECUTION_STATUSES)[number];

export type CapabilityEvidence = {
  source: string;
  summary: string;
  capturedAt: string;
};

/** Whether the capability mutates state. Never inferred from LLM output. */
export const CAPABILITY_SIDE_EFFECTS = ["read_only", "mutating"] as const;
export type CapabilitySideEffect = (typeof CAPABILITY_SIDE_EFFECTS)[number];

/**
 * Backend-owned authority: does this capability run autonomously, or does
 * every invocation require operator approval regardless of what the sales
 * agent's own output claims? Policy derives approval from this, never from
 * the LLM-reported `toolRequest.blocking` flag (ACS-R1-01.1).
 */
export const CAPABILITY_AUTHORITY_LEVELS = ["autonomous", "requires_approval"] as const;
export type CapabilityAuthorityLevel = (typeof CAPABILITY_AUTHORITY_LEVELS)[number];

export const CAPABILITY_RISK_CLASSES = ["low", "medium", "high"] as const;
export type CapabilityRiskClass = (typeof CAPABILITY_RISK_CLASSES)[number];

export type CapabilityGovernanceMetadata = {
  sideEffect: CapabilitySideEffect;
  authority: CapabilityAuthorityLevel;
  riskClass: CapabilityRiskClass;
};

export type CapabilityAvailabilityResult = {
  status: CapabilityAvailabilityStatus;
  reason: string | null;
};

export type CapabilityExecutionOutcome<TOutput = Record<string, unknown>> = {
  status: CapabilityGatewayExecutionStatus;
  data: TOutput | null;
  errorCode: string | null;
  retryable: boolean;
  evidence: CapabilityEvidence[];
  /**
   * ACS-R1-04-T08.1. Optional structured warning codes (e.g.
   * customer_master_projection_unavailable) the capability's own execute()
   * wants its caller to fold into that turn's aggregated, deduped warning
   * list and persist once via the existing T07 recorder - never a second,
   * independent recording path. Absent/empty for every capability that has
   * nothing to report (the default for all capabilities predating T08.1).
   */
  warnings?: string[];
};

export type CapabilityGatewayContext = {
  correlationId: string;
  conversationId?: number | null;
  opportunityId?: number | null;
  decisionId?: string | null;
  actionId?: string | null;
  requestId?: string | null;
  /**
   * ACS-R1-04-T06. Server-side trusted session (identity, onboarding,
   * trusted inbound, this-turn consent, fresh resolve_customer evidence).
   * Only create_customer/link_external_identity/resolve_customer read this -
   * every other capability ignores it. Never derived from LLM/tool-request
   * input; always assembled by resolveNativeCustomerSession.
   */
  trustedCustomerSession?: NativeCustomerSessionExecutionContext | null;
};

export type CapabilityGatewayDefinition<TInput = Record<string, unknown>, TOutput = Record<string, unknown>> = {
  capability: string;
  version: string;
  description: string;
  /** Backend-owned governance facts. Policy reads these, never the LLM's self-reported blocking flag. */
  governance: CapabilityGovernanceMetadata;
  /** Bounded, capability-specific retry budget for retryable execution failures. */
  maxRetries: number;
  checkAvailability(context: CapabilityGatewayContext): Promise<CapabilityAvailabilityResult>;
  execute(input: TInput, context: CapabilityGatewayContext): Promise<CapabilityExecutionOutcome<TOutput>>;
  /**
   * ACS-R1-04-T07. Optional allowlisted redaction for what gets persisted as
   * request_summary_json/response_summary_json in crm_capability_executions.
   * When absent, executeCapability falls back to today's behavior (the raw
   * input / outcome.data) - this keeps every other capability (search_products,
   * etc.) byte-for-byte unchanged. Only the identity capabilities
   * (customerIdentityCapabilities.ts) supply these, since their raw input/
   * output can carry phone/email/wa_id.
   */
  buildRequestSummary?(input: TInput, context: CapabilityGatewayContext): Record<string, unknown>;
  buildResponseSummary?(outcome: CapabilityExecutionOutcome<TOutput>, context: CapabilityGatewayContext): Record<string, unknown> | null;
};

export type CapabilityGatewayResult<TOutput = Record<string, unknown>> = {
  capability: string;
  version: string;
  availability: CapabilityAvailabilityStatus;
  status: CapabilityGatewayExecutionStatus;
  data: TOutput | null;
  errorCode: string | null;
  retryable: boolean;
  evidence: CapabilityEvidence[];
  /** ACS-R1-04-T08.1. See CapabilityExecutionOutcome.warnings - always an array (empty when the capability reported none). */
  warnings: string[];
  retryCount: number;
  startedAt: string;
  completedAt: string;
  executionPublicId: string | null;
};
