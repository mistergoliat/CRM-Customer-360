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
  /** CP-R1-T10B8C. recommend_catalog_products "skipped" observations only - the verbatim BuildSearchProductsV2RequestSkipReason, never retryable, never a handoff signal. */
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
  governance: "authorized" | "blocked_unregistered" | "blocked_duplicate" | null;
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
};
