export const COMMERCIAL_EVENT_CONTRACT_NAME = "CommercialEvent" as const;
export const COMMERCIAL_EVENT_SCHEMA_VERSION = "1.0" as const;

export type CommercialEventType =
  | "customer_message_received"
  | "outbound_message_queued"
  | "outbound_message_sent"
  | "outbound_message_delivered"
  | "outbound_message_read"
  | "outbound_message_failed"
  | "follow_up_due"
  | "human_takeover_started"
  | "human_takeover_released"
  | "internal_command_completed"
  | "internal_command_failed"
  // ACS-R1-04-T07. Identity/onboarding audit trail - descriptive evidence
  // only, never authoritative (docs/releases/ACS-R1-04-customer-identity-onboarding.md T07).
  | "customer_identity_resolution_recorded"
  | "customer_onboarding_transition_recorded"
  | "customer_identity_capability_outcome_recorded"
  | "customer_session_warning_recorded"
  // ACS-R1-05-T06.2. Canonical terminal outcome of a sales turn - descriptive
  // audit evidence, never authoritative (the durable state lives in
  // crm_agent_actions/crm_agent_decisions/crm_opportunities).
  | "autonomous_turn_disposition"
  | "autonomous_turn_continuity_failed"
  // ACS-R1-05.1-T02.1. Native read-only agent tool loop - one event per
  // turn, descriptive only. Per-tool-call evidence already lives in
  // crm_capability_executions (via executeGovernedCapability); this event
  // records the loop's own shape (decision/tool counts, terminal reason),
  // never duplicating that per-call detail.
  | "agent_tool_loop_completed"
  // SALES-AGENT-R2-A08.5. Controlled, allowlist-gated CommercialWork
  // production inbound path - one event per turn, descriptive only, same
  // discipline as agent_tool_loop_completed above.
  | "commercial_work_inbound_cycle_completed"
  // SALES-AGENT-R2-ID-R2-A05. One per turn, descriptive only - the durable
  // state (evidence, verification) already lives in
  // crm_customer_identity_evidence/customer_external_identity; this is
  // audit trail on top, same discipline as customer_identity_resolution_recorded.
  | "identity_verification_decision_recorded";

export type CommercialEventSource = "meta_whatsapp" | "system_timer" | "internal_command" | "human_operator";

// ACS-R1-04-T07 payload shapes. Deliberately local literal unions (not
// imported from lib/domains/* or capability-gateway/*) so this leaf module
// never depends on the identity/onboarding domain layer - mirrors the
// existing pattern in this file (e.g. the inline "sent"|"delivered"|...
// status union above), and avoids a possible import cycle back from events/
// into native-cycle/customer-session (which already imports from events/).

export type CustomerIdentityResolutionPhase = "pre_plan" | "post_plan";
export type CustomerIdentityResolver = "local" | "customer_service";
export type CustomerIdentityResolutionOutcome = "identified" | "no_match" | "conflict" | "invalid_input" | "temporarily_unavailable";
export type CustomerIdentityResolutionMatchedBy = "external_identity" | "normalized_phone" | "customer_service" | "onboarding_state" | "none";

export type CustomerIdentityResolutionRecordedPayload = {
  phase: CustomerIdentityResolutionPhase;
  resolver: CustomerIdentityResolver;
  outcome: CustomerIdentityResolutionOutcome;
  matchedBy: CustomerIdentityResolutionMatchedBy;
  hasResolvedCustomer: boolean;
};

export const CUSTOMER_ONBOARDING_TRANSITION_OPERATIONS = [
  "start",
  "collect_fields",
  "mark_resolving",
  "complete",
  "mark_conflict",
  "mark_temporarily_unavailable",
  "retry_resolution",
  "record_verification_failure"
] as const;
export type CustomerOnboardingTransitionOperation = (typeof CUSTOMER_ONBOARDING_TRANSITION_OPERATIONS)[number];

export type CustomerOnboardingTransitionRecordedPayload = {
  operation: CustomerOnboardingTransitionOperation;
  purpose: string;
  previousStatus: string | null;
  nextStatus: string;
  previousVersion: number | null;
  nextVersion: number;
  pendingFields: string[];
  collectedAvailability: {
    firstName: boolean;
    lastName: boolean;
    email: boolean;
    orderReference: boolean;
  };
  hasResolvedCustomer: boolean;
};

export type CustomerIdentityCapabilityName = "resolve_customer" | "create_customer" | "link_external_identity" | "link_prestashop_identity";

export type CustomerIdentityCapabilityOutcomeRecordedPayload = {
  capability: CustomerIdentityCapabilityName;
  executionPublicId: string | null;
  gatewayStatus: string;
  businessOutcome: string;
  retryable: boolean;
  stableErrorCode: string | null;
};

export type CustomerSessionWarningRecordedPayload = {
  warningCode: string;
  phase: CustomerIdentityResolutionPhase;
  executionPublicId: string | null;
};

// SALES-AGENT-R2-ID-R2-A05. Local literal unions mirroring
// lib/brain/commercial/native-cycle/customer-session/runtimeIdentityContext.ts#RuntimeIdentityStatus/RuntimeIdentityLevel -
// same no-cross-module-import rationale as the rest of this file.
export type IdentityVerificationDecisionRuntimeStatus =
  | "ANONYMOUS"
  | "CHANNEL_OBSERVED"
  | "MASTER_RESOLVED"
  | "PRESTASHOP_LINKED"
  | "NEEDS_VERIFICATION"
  | "READY_TO_LINK"
  | "AMBIGUOUS"
  | "CONFLICT"
  | "SYSTEM_UNAVAILABLE";

export type IdentityVerificationDecisionIdentityLevel =
  | "LEVEL_0_ANONYMOUS"
  | "LEVEL_1_CHANNEL_OBSERVED"
  | "LEVEL_2_MASTER_RESOLVED"
  | "LEVEL_3_PRESTASHOP_LINKED";

/**
 * No PII - status/level/policyCode are fixed vocabularies, masterCustomerId/
 * prestashopCustomerId are internal ids (never email/phone/wa_id),
 * evidenceIds are opaque row ids. Mirrors RuntimeIdentityContext exactly,
 * minus evidenceRefs' readonly modifier (JSON payload, always a plain array).
 */
export type IdentityVerificationDecisionRecordedPayload = {
  status: IdentityVerificationDecisionRuntimeStatus;
  identityLevel: IdentityVerificationDecisionIdentityLevel;
  policyCode: string;
  masterCustomerId: string | null;
  prestashopCustomerId: string | null;
  evidenceIds: string[];
  conflictCode: string | null;
};

// ACS-R1-05-T06.2. Canonical vocabulary for the terminal outcome of a sales
// turn (release spec section A2) - defined here (the leaf events module) and
// re-exported by lib/brain/commercial/continuity/ so there is exactly one
// definition, never a duplicate local union in the continuity layer.

export type AutonomousTurnResponseOwner = "ai" | "human" | "none";

// ACS-R1-05-T06.2 (second correction, section 9). Same rationale as
// AutonomousTurnResponseOwner above - defined once here, re-exported by
// continuity/salesTurnDisposition.ts.
export type AutonomousTurnWaitingFor = "customer_response" | "human_response" | "none";

export type AutonomousTurnCommercialObjective =
  | "discover_need"
  | "qualify"
  | "recommend"
  | "compare"
  | "handle_objection"
  | "prepare_quote"
  | "advance_purchase"
  | "retain_interest"
  | "handoff"
  | "none";

export type AutonomousTurnTerminalOutcome =
  | "commercial_response_planned"
  | "catalog_recommendation_planned"
  | "clarification_planned"
  | "quote_progression_planned"
  | "fallback_outbox_planned"
  | "handoff_acknowledgement_planned"
  | "human_response_required"
  | "no_response_required"
  | "channel_delivery_failed"
  | "continuity_failed";

export type AutonomousTurnDispositionRecordedPayload = {
  inboundMessageId: string | null;
  responseOwner: AutonomousTurnResponseOwner;
  commercialObjective: AutonomousTurnCommercialObjective;
  primaryActionId: string | null;
  primaryDisposition: string | null;
  primaryBlockReasons: string[];
  fallbackActionId: string | null;
  outboxId: string | null;
  opportunityAdvanced: boolean;
  nextBestAction: string | null;
  followUpEligible: boolean;
  followUpReason: string | null;
  terminalOutcome: AutonomousTurnTerminalOutcome;
  /** ACS-R1-05-T06.2 (second correction, section 9) - see SalesTurnDisposition for the field-level rationale. */
  acknowledgementSender: AutonomousTurnResponseOwner | null;
  waitingFor: AutonomousTurnWaitingFor;
  handoffCreated: boolean;
};

export type AutonomousTurnContinuityFailedRecordedPayload = {
  inboundMessageId: string | null;
  reason: string;
};

// ACS-R1-05.1-T02.1. Local literal union mirroring
// lib/brain/commercial/agent-loop/agentStepTypes.ts#AgentLoopTerminalReason -
// this leaf module never imports from agent-loop/ (same rationale as the
// identity/onboarding unions above).
export type AgentToolLoopTerminalReason =
  | "responded"
  | "handoff"
  | "max_steps_exceeded"
  | "invalid_output"
  | "provider_unavailable"
  | "timeout";

// ACS-R1-05.1-T02.1 (post-smoke fix, point 8). Bounded, structural summary
// per step - never raw tool arguments, never observation data/PII. Mirrors
// agent-loop/agentStepTypes.ts#AgentLoopStepRecord shape, same
// no-cross-module-import rationale as the rest of this file.
export type AgentToolLoopStepSummary = {
  stepIndex: number;
  type: "use_tool" | "respond" | "handoff";
  phase: "gathering" | "finalization";
  tool?: string;
  // SALES-AGENT-R3-A04 added "blocked_not_exposed" - a tool that IS
  // registered in the Capability Gateway but is classified NOT_AGENT_EXPOSED
  // (agent-capability-exposure/types.ts), distinct from "blocked_unregistered"
  // (no Gateway registration at all).
  governance?: "authorized" | "blocked_unregistered" | "blocked_duplicate" | "blocked_not_exposed";
  // CP-R1-T10B8C added "skipped" - exclusive to recommend_catalog_products,
  // mirrors agent-loop/agentStepTypes.ts#ToolObservationStatus.
  observationStatus?: "completed" | "failed" | "blocked" | "skipped";
};

// ACS-R1-05.1-T02.3B. Local literal union mirroring
// sales-agent-configuration/types.ts#ResolvedSalesAgentConfigurationSource -
// same no-cross-module-import rationale as the rest of this file.
export type AgentToolLoopConfigurationSource = "published" | "deployment_default" | "safe_default";

// LLM provider error observability. Local literal union mirroring
// agent-loop/agentStepTypes.ts#AgentLoopProviderFailureNormalizedReason - same
// no-cross-module-import rationale as the rest of this file.
export type AgentToolLoopProviderFailureNormalizedReason =
  | "authentication_error"
  | "rate_limited"
  | "provider_timeout"
  | "network_error"
  | "model_unavailable"
  | "invalid_response"
  | "provider_server_error"
  | "unknown_provider_error";

/**
 * Sanitized cause of a terminalReason "provider_unavailable" outcome - present
 * only when a real provider error was caught (never fabricated for other
 * terminal reasons). Never a raw error message, stack trace, prompt, API key,
 * header or full provider response - see agent-loop/providers/providerFailureClassification.ts.
 */
export type AgentToolLoopProviderFailurePayload = {
  provider: string | null;
  model: string | null;
  attemptCount: number;
  maxAttempts: number | null;
  httpStatus: number | null;
  errorCode: string | null;
  errorClass: string;
  normalizedReason: AgentToolLoopProviderFailureNormalizedReason;
  retryable: boolean;
  elapsedMs: number | null;
};

// LLM-R1-T02. "success" plus every AgentToolLoopProviderFailureNormalizedReason
// value above - local literal union mirroring
// agent-loop/agentStepTypes.ts#AgentLoopInferenceOutcome, same
// no-cross-module-import rationale as the rest of this file. Never a second,
// parallel taxonomy.
export type AgentToolLoopLlmCallOutcome = "success" | AgentToolLoopProviderFailureNormalizedReason;

/**
 * One row per real LLM provider invocation this turn - including a failed
 * attempt later recovered from (LLM-R1-T02/LLM-R1-T01's structured recovery,
 * or the pre-existing schema-invalid AgentStep retry) and a loop-level
 * deadline timeout. Mirrors agent-loop/agentStepTypes.ts#AgentLoopInferenceRecord,
 * same no-cross-module-import rationale as the rest of this file - except
 * `inputSize`/`outputSize` (never `...Tokens...`): this module's own
 * assertPlainSerializable (normalize.ts) rejects any payload key matching
 * `/token/i` (SENSITIVE_KEY_PATTERN, meant to catch auth tokens) as a
 * forbidden key, so a field literally named `inputTokens`/`outputTokens`
 * cannot be persisted here - the exact same reason `effectiveMaxOutputSize`
 * above is not named `...maxOutputTokens`. Never raw prompt/rawOutput - only
 * counts, ids and enums.
 */
export type AgentToolLoopLlmCallSummary = {
  phase: "gathering" | "finalization";
  /** 0 = the first call for this phase/decision slot this turn; 1+ = a retry of that exact same slot. */
  attempt: number;
  /** gathering only - which decision this call was for; null in finalization. */
  decisionIndex: number | null;
  elapsedMs: number;
  model: string | null;
  providerRequestId: string | null;
  finishReason: string | null;
  inputSize: number | null;
  outputSize: number | null;
  outcome: AgentToolLoopLlmCallOutcome;
};

/**
 * Turn-level LLM rollup. `inputSize`/`outputSize` are the sum of every call's
 * known value only (see AgentToolLoopLlmCallSummary for the naming note) -
 * `null` means no call this turn reported a usable value, never an invented
 * `0`. `usageComplete` is `false` whenever at least one call is missing
 * `inputSize` or `outputSize`, even when the partial sum above is non-null -
 * the only way to know whether the sum reflects every call or just some of
 * them.
 */
export type AgentToolLoopLlmMetricsPayload = {
  callCount: number;
  totalElapsedMs: number;
  inputSize: number | null;
  outputSize: number | null;
  usageComplete: boolean;
  calls: AgentToolLoopLlmCallSummary[];
};

// ACS-R1-05.1-T02.7. Local literal union mirroring
// agent-loop/agentStepTypes.ts#PendingCatalogActionType - same
// no-cross-module-import rationale as the rest of this file.
export type AgentToolLoopPendingCatalogActionType = "send_product_link";

// CP-R1-T10B8D. Local mirror of agent-loop/agentStepTypes.ts#PendingCatalogActionCandidateProduct.
export type AgentToolLoopPendingCatalogActionCandidateProduct = {
  productId: string;
  combinationId?: string;
};

export type AgentToolLoopPendingCatalogActionPayload = {
  actionType: AgentToolLoopPendingCatalogActionType;
  candidateProductIds: string[];
  /** CP-R1-T10B8D. Present only when this action originates from recommend_catalog_products - see PendingCatalogActionStep#candidateProducts. */
  candidateProducts?: AgentToolLoopPendingCatalogActionCandidateProduct[];
};

/**
 * SALES-AGENT-R2-A08.5, Part 27. Descriptive audit trail for the controlled
 * CommercialWork production inbound path - never authoritative (the durable
 * state lives in crm_commercial_work/crm_agent_actions/brain_message_outbox).
 * Bounded structural summary only - no prompt text, no customer message
 * body, no secrets.
 */
export type CommercialWorkInboundCycleCompletedPayload = {
  runtimePath: "commercial_work";
  inboundMessageId: string | null;
  reason: string;
  commercialSequence: number | null;
  workPublicId: string | null;
  workVersion: number | null;
  workStatus: string | null;
  disposition: "FINAL" | "PARTIAL" | "BLOCKED" | "fallback" | null;
  objectiveCount: number | null;
  readyStepCount: number | null;
  llmCallCount: number;
  executedStepCount: number | null;
  outboxWritten: boolean;
};

export type AgentToolLoopCompletedRecordedPayload = {
  inboundMessageId: string | null;
  terminalReason: AgentToolLoopTerminalReason;
  decisionCount: number;
  toolExecutionCount: number;
  toolsUsed: string[];
  finalMessagePresent: boolean;
  handoffReasonPresent: boolean;
  stepsSummary: AgentToolLoopStepSummary[];
  /**
   * ACS-R1-05.1-T02.3B. Which Sales Agent Configuration produced this turn's
   * prompt/model/loop parameters, and the effective (already
   * platform-clamped) values actually used - never just what was requested,
   * never the prompt text itself or any secret.
   */
  configurationSource: AgentToolLoopConfigurationSource;
  configurationRecordId: number | null;
  configurationVersion: number | null;
  configurationHash: string | null;
  effectiveModel: string;
  effectiveTemperature: number;
  /** null when no real maxOutputTokens was configured - never defaulted, see EffectiveSalesAgentModelConfiguration. */
  effectiveMaxOutputSize: number | null;
  effectiveTimeoutMs: number;
  effectiveMaxAgentStepsPerTurn: number;
  effectiveMaxToolCallsPerTurn: number;
  /** Optional - present only for terminalReason "provider_unavailable" when a real cause was captured. */
  providerFailure?: AgentToolLoopProviderFailurePayload | null;
  /** ACS-R1-05.1-T02.7. Present only when this turn's own respond step left a catalog action open for the next customer turn - see PendingCatalogActionStep. */
  pendingCatalogAction?: AgentToolLoopPendingCatalogActionPayload | null;
  /** LLM-R1-T02. Present only when at least one LLM provider call was attempted this turn - absent when the loop never reached the provider at all (e.g. no provider configured). */
  llmMetrics?: AgentToolLoopLlmMetricsPayload | null;
};

export interface CommercialEventV1 {
  contractName: typeof COMMERCIAL_EVENT_CONTRACT_NAME;
  schemaVersion: typeof COMMERCIAL_EVENT_SCHEMA_VERSION;

  id: string;
  eventType: CommercialEventType;
  source: CommercialEventSource;

  sourceEventId: string | null;
  dedupeKey: string;

  correlationId: string;
  causationId: string | null;

  customerId: string | null;
  conversationId: string | null;
  opportunityId: string | null;

  channel: string | null;
  provider: string | null;

  occurredAt: string;
  receivedAt: string;

  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export type CommercialEventPersistStatus = "created" | "duplicate";

export type CommercialEventPersistResult =
  | { ok: true; status: "created"; event: CommercialEventV1 }
  | { ok: true; status: "duplicate"; event: CommercialEventV1 }
  | { ok: false; status: "error"; event: null; warning: string };
