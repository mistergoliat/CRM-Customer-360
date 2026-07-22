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
  | "agent_tool_loop_completed";

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

export type CustomerIdentityCapabilityName = "resolve_customer" | "create_customer" | "link_external_identity";

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
  governance?: "authorized" | "blocked_unregistered" | "blocked_duplicate";
  observationStatus?: "completed" | "failed" | "blocked";
};

// ACS-R1-05.1-T02.3B. Local literal union mirroring
// sales-agent-configuration/types.ts#ResolvedSalesAgentConfigurationSource -
// same no-cross-module-import rationale as the rest of this file.
export type AgentToolLoopConfigurationSource = "published" | "deployment_default" | "safe_default";

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
