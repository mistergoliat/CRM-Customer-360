/**
 * ACS-R1-05.1-T02.1 (Native Read-Only Agent Tool Loop). Minimal per-step
 * contract: the model answers exactly one question per call - "what is the
 * next step?" - never a full commercial document. Kept intentionally small;
 * do not add variants without a demonstrated need from real runtime code
 * (see docs/product/sales-agent-contract.md for why the older, monolithic
 * SalesAgentOutput contract is not extended for this loop).
 */

export const AGENT_STEP_TYPES = ["use_tool", "respond", "handoff"] as const;
export type AgentStepType = (typeof AGENT_STEP_TYPES)[number];

export type AgentStepUseTool = {
  type: "use_tool";
  tool: string;
  arguments: Record<string, unknown>;
};

/**
 * ACS-R1-05.1-T02.7 (catalog action continuity). Structured, extensible
 * record of a catalog action the assistant's reply just offered and is now
 * waiting on the customer to pick a candidate for (e.g. "quieres que te
 * envie el link de alguno de estos productos?"). Emitted by the model
 * alongside `respond` - never inferred by the runtime from the free-text
 * message - so the very next customer turn can resolve/continue it from
 * structured data instead of the model having to re-read and correctly
 * recall its own prior reply. Only `send_product_link` is implemented;
 * `actionType` stays a literal union so a future action (e.g.
 * show_product_details, compare_products) is a type addition, not a shape
 * change.
 */
export const PENDING_CATALOG_ACTION_TYPES = ["send_product_link"] as const;
export type PendingCatalogActionType = (typeof PENDING_CATALOG_ACTION_TYPES)[number];

/**
 * CP-R1-T10B8D. Variant-aware candidate identity - `combinationId` present
 * only when the source (a recommend_catalog_products candidate) carried one.
 */
export type PendingCatalogActionCandidateProduct = {
  productId: string;
  combinationId?: string;
};

export type PendingCatalogActionStep = {
  actionType: PendingCatalogActionType;
  /** productIds the customer may choose between to resolve this action - never invented, sourced from this turn's own catalog evidence. */
  candidateProductIds: string[];
  /**
   * CP-R1-T10B8D. Optional, richer mirror of `candidateProductIds` with
   * variant identity - populated only when this action originates from a
   * completed recommend_catalog_products result (runtime-built, never
   * emitted by the model - AgentStepRespond#pendingCatalogAction never
   * includes it). Absent on model-emitted send_product_link actions and on
   * legacy events persisted before this field existed - both remain fully
   * valid with `candidateProductIds` alone.
   */
  candidateProducts?: PendingCatalogActionCandidateProduct[];
};

export type AgentStepRespond = {
  type: "respond";
  message: string;
  /** Present only when this reply introduces or renews a pending catalog action; absent means none is open after this turn. */
  pendingCatalogAction?: PendingCatalogActionStep;
};

export type AgentStepHandoff = {
  type: "handoff";
  reason: string;
};

export type AgentStep = AgentStepUseTool | AgentStepRespond | AgentStepHandoff;

/**
 * CP-R1-T10B8C added "skipped" - exclusive to recommend_catalog_products, for
 * the Gateway's own "completed with data.status=skipped" mapping (CP-R1-T10B8B).
 * Distinct from "blocked": a skipped request never reached any external
 * service, and is never retryable, never a handoff signal.
 */
export const TOOL_OBSERVATION_STATUSES = ["completed", "failed", "blocked", "skipped"] as const;
export type ToolObservationStatus = (typeof TOOL_OBSERVATION_STATUSES)[number];

/**
 * Structured, bounded and safe to feed back to the model. Never carries
 * credentials, full internal payloads, raw errors, SQL, or unrequested data -
 * see buildToolObservation.ts for the allowlisted projection per capability.
 */
export type ToolObservation = {
  tool: string;
  status: ToolObservationStatus;
  data?: unknown;
  errorCode?: string;
  /**
   * CP-R1-T10B8C. recommend_catalog_products "skipped" observations - the
   * verbatim BuildSearchProductsV2RequestSkipReason, never retryable, never a
   * handoff signal. SALES-AGENT-R1-T2.1.1 reuses this same field for
   * select_shipping_option's "blocked"/shipping_calculation_stale
   * observations - selection_changed/destination_changed, never a fact ID.
   */
  reason?: string;
  /** CP-R1-T10B8C. recommend_catalog_products "failed" observations only - mirrors CapabilityGatewayResult.retryable, safe to surface (no PII). */
  retryable?: boolean;
  /** CP-R1-T10B8C. recommend_catalog_products "failed" observations only - the real service's own closed error code (e.g. SOURCE_PRODUCT_NOT_FOUND) when present, never a raw message/stack/body. */
  providerErrorCode?: string;
  /**
   * ACS-R1-05.1-T02.6.1. Fixed, sanitized string codes only (e.g.
   * explore_catalog_legacy_sort_alias_used) - never raw values, never PII.
   * Sourced from CapabilityExecutionOutcome.warnings via
   * CapabilityGatewayResult.warnings (executeCapability.ts) - present only
   * when the capability itself reported at least one.
   */
  warnings?: string[];
};

/**
 * CP-R1-T10B8D. recommend_catalog_products' sourceProduct must cite a
 * product this conversation actually observed (search_products,
 * get_product_details, explore_catalog, or - across turns -
 * recentCatalogContext) - never an invented or otherwise-sourced productId.
 * Surfaced as ToolObservation.errorCode on a "blocked" observation, the same
 * generic field every other blocked reason in this file already uses (no
 * second, tool-specific field). Reused, never duplicated, by
 * resolveObservedRecommendationSourceProduct.ts.
 */
export const RECOMMENDATION_SOURCE_PRODUCT_BLOCKED_REASONS = [
  "source_product_not_observed",
  "source_product_variant_not_observed",
  "recent_catalog_context_unavailable"
] as const;
export type RecommendationSourceProductBlockedReason = (typeof RECOMMENDATION_SOURCE_PRODUCT_BLOCKED_REASONS)[number];

/**
 * CP-R1-T10B8D. get_product_details is blocked with this reason only when an
 * active recommendation-origin pendingCatalogAction exists (candidateProducts
 * populated) and the requested product matches neither its candidates nor
 * any other observed evidence. No active recommendation pendingCatalogAction
 * means get_product_details is never gated - its pre-existing, unconditioned
 * authorization is unchanged.
 */
export const GET_PRODUCT_DETAILS_PENDING_CATALOG_BLOCKED_REASON = "product_not_in_pending_catalog_candidates" as const;

export const AGENT_LOOP_TERMINAL_REASONS = [
  "responded",
  "handoff",
  "max_steps_exceeded",
  "invalid_output",
  "provider_unavailable",
  "timeout"
] as const;
export type AgentLoopTerminalReason = (typeof AGENT_LOOP_TERMINAL_REASONS)[number];

export const AGENT_LOOP_STEP_PHASES = ["gathering", "finalization"] as const;
export type AgentLoopStepPhase = (typeof AGENT_LOOP_STEP_PHASES)[number];

export type AgentLoopStepRecord = {
  stepIndex: number;
  step: AgentStep;
  /**
   * Governance verdict for use_tool steps only; null for respond/handoff.
   * "blocked_unauthorized" (tool budget already exhausted) cannot occur here
   * by construction: the gathering phase stops asking for a tool decision
   * the moment the budget is spent, and the finalization phase rejects any
   * use_tool attempt at the validation layer (wrong type for that phase)
   * before it ever reaches a governance decision.
   */
  /**
   * SALES-AGENT-R3-A04 added "blocked_not_exposed" - a tool that IS
   * registered in the Capability Gateway but is classified
   * NOT_AGENT_EXPOSED (agent-capability-exposure/types.ts). Distinct from
   * "blocked_unregistered" (no Gateway registration exists at all).
   */
  governance: "authorized" | "blocked_unregistered" | "blocked_duplicate" | "blocked_not_exposed" | null;
  observation: ToolObservation | null;
  /** Which loop phase produced this step - see runAgentToolLoop.ts. */
  phase: AgentLoopStepPhase;
};

export const AGENT_LOOP_PROVIDER_FAILURE_NORMALIZED_REASONS = [
  "authentication_error",
  "rate_limited",
  "provider_timeout",
  "network_error",
  "model_unavailable",
  "invalid_response",
  "provider_server_error",
  "unknown_provider_error"
] as const;
export type AgentLoopProviderFailureNormalizedReason = (typeof AGENT_LOOP_PROVIDER_FAILURE_NORMALIZED_REASONS)[number];

/**
 * Sanitized cause of a "provider_unavailable" terminal outcome - captured at
 * the point the raw provider error is first caught (invokeProviderWithDeadline
 * in runAgentToolLoop.ts), before it collapses into that generic terminal
 * reason. Never a raw error message, stack trace, prompt, API key or full
 * provider response - see providers/providerFailureClassification.ts for
 * what feeds each field.
 */
export type AgentLoopProviderFailure = {
  provider: string | null;
  model: string | null;
  attemptCount: number;
  maxAttempts: number | null;
  httpStatus: number | null;
  errorCode: string | null;
  errorClass: string;
  normalizedReason: AgentLoopProviderFailureNormalizedReason;
  retryable: boolean;
  elapsedMs: number | null;
  /**
   * LLM-R1-T02. Populated only when a parsed provider response envelope was
   * actually obtained before this failure was raised (today: empty_response,
   * invalid_model_json - see httpAgentLoopProvider.ts) - undefined/null
   * whenever the failure happened before any response body could be parsed
   * (network_error, provider_timeout, a non-2xx status, invalid_json_response).
   * Never inferred, estimated, or backfilled - absence means "not available",
   * never "zero"/"stop".
   */
  finishReason?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  /** LLM-R1-T08B. Numeric count only - never reasoning_content text. Same absence discipline as inputTokens/outputTokens above. */
  reasoningTokens?: number | null;
  /** SALES-AGENT-R3-V1.8-D1. Same absence discipline as reasoningTokens above - see AgentLoopProviderResponse.cacheReadTokens for the full provenance note. */
  cacheReadTokens?: number | null;
  cacheMissTokens?: number | null;
  providerRequestId?: string | null;
};

/**
 * LLM-R1-T02. "success" plus every AgentLoopProviderFailureNormalizedReason
 * value above - deliberately not a separate enum, so an inference's outcome
 * always reuses the loop's one existing failure taxonomy instead of a second,
 * parallel one.
 */
export type AgentLoopInferenceOutcome = "success" | AgentLoopProviderFailureNormalizedReason;

/**
 * One record per real invocation of the AgentLoopProvider this turn -
 * including a failed attempt later recovered from (LLM-R1-T01's
 * structured-recovery attempt, or the pre-existing schema-invalid AgentStep
 * retry) and a loop-level deadline timeout. Never raw prompt/rawOutput -
 * only counts, ids and enums, same discipline as AgentLoopProviderFailure.
 * See lib/brain/commercial/events/types.ts#AgentToolLoopLlmCallSummary for
 * the persisted projection of this (renamed inputSize/outputSize - see that
 * type's own comment for why).
 */
export type AgentLoopInferenceRecord = {
  phase: AgentLoopStepPhase;
  /** 0 = the first call for this phase/decision slot this turn; 1 (or more, in the rare worst case) = a retry of that exact same slot - schema-invalid AgentStep retry or LLM-R1-T01 structured recovery. */
  attempt: number;
  /** gathering only - which decision this call was for; null in finalization (finalization is not organized by decision). */
  decisionIndex: number | null;
  elapsedMs: number;
  model: string | null;
  providerRequestId: string | null;
  finishReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** LLM-R1-T08B. Numeric count only - never reasoning_content text. null when this call's provider did not report it (including every timeout/pre-response failure). */
  reasoningTokens: number | null;
  outcome: AgentLoopInferenceOutcome;
};

export type AgentLoopResult = {
  ran: boolean;
  terminalReason: AgentLoopTerminalReason;
  steps: AgentLoopStepRecord[];
  toolExecutionCount: number;
  finalMessage: string | null;
  handoffReason: string | null;
  warnings: string[];
  /** Present only when terminalReason is "provider_unavailable" and a real provider error was caught (never fabricated). */
  providerFailure?: AgentLoopProviderFailure | null;
  /** Mirrors the terminal respond step's own field (null for every other terminalReason, and null when that respond step carried none). */
  finalPendingCatalogAction?: PendingCatalogActionStep | null;
  /** LLM-R1-T02. One entry per real provider invocation this turn (success, structured recovery, schema retry, timeout, or terminal failure) - empty only when the loop never reached the provider at all (no provider configured). */
  llmCalls: AgentLoopInferenceRecord[];
  /**
   * SALES-AGENT-R3-V1.8.1b-A (Objetivo A - live turn assimilation).
   * Observational only, purely additive, and OPTIONAL - runAgentToolLoop.ts
   * itself always populates all four (null/[]/0 whenever live assimilation
   * is disabled or never actually folded in new inbound this turn); every
   * OTHER AgentLoopResult-shaped literal in this codebase (adapters/shims in
   * runNativeAgentToolLoopCycle.ts, runCommercialMultiIntentLoop.ts,
   * runSalesAgentRuntimeCycle.ts's own dispatch shim, and every test fixture)
   * legitimately never went through live assimilation and correctly omits
   * them - never a required-field migration across unrelated runtimes.
   * finalAssimilatedInboundMessageId is the anchor dispatch-time freshness/
   * settlement-reconciliation must use INSTEAD OF the claim-time anchor once
   * assimilation happened this turn - see runAgentToolLoop.ts's own
   * tryAssimilate() and dispatchGovernedSalesAgentMessage.ts.
   */
  finalAssimilatedInboundMessageId?: number | null;
  /** Every conversation_message id folded into this turn's customerMessage mid-run - must also be excluded from persistent-session history, same discipline as additionalInboundMessageIds. */
  assimilatedInboundMessageIds?: number[];
  /** How many times tryAssimilate() actually found and folded in new inbound (not how many times it was merely checked). */
  assimilationCycleCount?: number;
  /** How many respond/handoff/use_tool candidates were discarded as stale before being acted on - see the universal pre-action gate in runAgentToolLoop.ts. */
  invalidatedCandidateCount?: number;
};
