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

/**
 * SALES-AGENT-R3-CAPABILITY-SEMANTICS-TR-B1-B2. What a capability's own
 * completed output structurally contains, declared once instead of
 * re-derived by each consumer as its own hand-maintained tool-name
 * allowlist (see resolveObservedRecommendationSourceProduct.ts,
 * pendingCatalogAction.ts#collectAllowedProductIds, recentCatalogContext.ts).
 * This types WHAT a capability produced/needs, never WHETHER a specific
 * consumer accepts it as evidence for its own purpose - a consumer may
 * still apply a narrower, consumer-specific provenance rule on top (e.g.
 * recommend_catalog_products produces PRODUCT_IDENTITY but is deliberately
 * excluded as its own recursive source-product evidence).
 */
export const CAPABILITY_EVIDENCE_TYPES = [
  "PRODUCT_IDENTITY",
  "SEMANTIC_ELIGIBILITY",
  "CURRENT_PRODUCT_DETAILS",
  "COMMERCIAL_SELECTION_STATE",
  /**
   * SALES-AGENT-R3-P7.3. Added alongside COMMERCIAL_SELECTION_STATE's
   * existing precedent - declares what set_shipping_destination's own
   * completed execution structurally produced. Purely additive: no existing
   * consumer of CAPABILITY_EVIDENCE_TYPES reads this value, so nothing that
   * filters/renders by evidence type today changes behavior.
   */
  "COMMERCIAL_DESTINATION_STATE",
  "QUOTE_CREATED",
  "QUOTE_ISSUED",
  "QUOTE_DOCUMENT_AVAILABLE",
  "QUOTE_EMAIL_DELIVERY_REQUESTED"
] as const;
export type CapabilityEvidenceType = (typeof CAPABILITY_EVIDENCE_TYPES)[number];

/**
 * SALES-AGENT-R3-CAPABILITY-SEMANTICS-TR-B1-B2. Only values with a real,
 * distinct behavioral meaning a prompt sentence must state - never a
 * restatement of governance.sideEffect ("READ" is deliberately not a
 * member here).
 */
export const CAPABILITY_OPERATION_SEMANTICS = ["FULL_REPLACEMENT", "CREATE_SNAPSHOT"] as const;
export type CapabilityOperationSemantics = (typeof CAPABILITY_OPERATION_SEMANTICS)[number];

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
   * Only create_customer/link_external_identity/resolve_customer read this
   * directly inside their own execute() - every other capability's execute()
   * still ignores it. SALES-AGENT-R3-A02: `.runtimeIdentity` is additionally
   * read generically by executeGovernedCapability itself (identityGate.ts)
   * for every registered mutating capability, before execute() ever runs.
   * Never derived from LLM/tool-request input; always assembled by
   * resolveNativeCustomerSession.
   */
  trustedCustomerSession?: NativeCustomerSessionExecutionContext | null;
  /**
   * SALES-AGENT-R3-P7.1 (Trusted Execution Context). Durable CommercialWork/
   * objective trace context for this turn - assembled by the runtime from
   * the same work the P3.5 kernel already resolved (see
   * salesAgentRuntime.ts), never re-read or re-derived here. Audit/
   * correlation only: no capability's checkAvailability/execute and no
   * Gateway policy (identity gate, availability, retry) reads these fields
   * to decide anything - adding this context does not add authorization.
   * Never supplied or overridable by the model - runAgentToolLoop.ts builds
   * this exclusively from runtime state, never from AgentStepUseTool.arguments.
   * `workId`/`workVersion` null means no durable work exists this turn;
   * `objectiveId`/`objectiveType` null (with work present) means the work
   * has no active objective - never a sentinel string like "unknown"/"none".
   */
  workId?: string | null;
  workVersion?: number | null;
  objectiveId?: string | null;
  objectiveType?: string | null;
};

export type CapabilityGatewayDefinition<TInput = Record<string, unknown>, TOutput = Record<string, unknown>> = {
  capability: string;
  version: string;
  description: string;
  /** Backend-owned governance facts. Policy reads these, never the LLM's self-reported blocking flag. */
  governance: CapabilityGovernanceMetadata;
  /** Bounded, capability-specific retry budget for retryable execution failures. */
  maxRetries: number;
  /**
   * ACS-R1-05.1-T02.6.1. Optional JSON Schema (opaque record - a subset of
   * draft-07: type/properties/required/enum/additionalProperties/minimum/
   * maximum is all this repo's tools currently need) describing this
   * capability's `execute()` input, for agent-facing tools only. This is the
   * single canonical source: the Agent Tool Loop's tool descriptions
   * (runAgentToolLoop.ts#buildToolDescriptions) and the prompt
   * (buildAgentStepPromptPackage.ts) both read it from here - never a second,
   * duplicated schema anywhere else. Absent for capabilities the model never
   * calls directly (e.g. identity capabilities) - never required, never
   * enforced at this layer (the capability's own execute() remains the real
   * runtime validator; this is what the model is told to aim for).
   */
  inputSchema?: Record<string, unknown>;
  /**
   * SALES-AGENT-R3-CAPABILITY-SEMANTICS-TR-B1-B2. Declared evidence
   * relation - see CapabilityEvidenceType. Optional and additive: every
   * capability that omits both fields behaves exactly as before (no
   * evidence relevance). Consumed by resolveObservedRecommendationSourceProduct.ts,
   * pendingCatalogAction.ts#collectAllowedProductIds and
   * recentCatalogContext.ts as the single declared source for "which
   * capabilities produce/require this evidence" - never a second,
   * independently-maintained tool-name list.
   */
  evidenceProduced?: CapabilityEvidenceType[];
  evidenceRequired?: CapabilityEvidenceType[];
  /**
   * SALES-AGENT-R3-CAPABILITY-SEMANTICS-TR-B1-B2. Boundary prose the model
   * reasons over (never a routing rule the runtime executes) - rendered
   * alongside `description` by buildAgentStepPromptPackage.ts's tool-line
   * renderer when present.
   *
   * SALES-AGENT-R3-CAPABILITY-SEMANTICS-COMMERCIAL-POLICY-V1. Every
   * AGENT_LOOP_TOOL_POOL capability now declares both. Each is a BARE
   * CLAUSE - no leading connector, no trailing period - because
   * renderToolLine supplies "Use when: <clause>." / "Do not use when:
   * <clause>." itself; a string repeating the connector rendered as "Use
   * when: Use when ... .". Still structurally optional (the internal,
   * non-agent-facing capabilities declare neither), and asserted for the
   * agent-facing pool in tests/commercial/capabilityEvidenceSemantics.test.ts.
   */
  useWhen?: string;
  doNotUseWhen?: string;
  /**
   * SALES-AGENT-R3-CAPABILITY-SEMANTICS-TR-B1-B2. When present, the tool-line
   * renderer appends one fixed, capability-independent sentence for this
   * class (see CapabilityOperationSemantics) instead of a capability author
   * hand-writing it in `description` or a dedicated prompt-rule block.
   */
  operationSemantics?: CapabilityOperationSemantics;
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
