import { executeGovernedCapability } from "../capability-gateway/executeCapability";
import { resolveCapabilityGatewayDefinition } from "../capability-gateway/registry";
import type { CapabilityGatewayContext, CapabilityGatewayResult } from "../capability-gateway/types";
import { resolveAgentCapabilityExposure } from "../agent-capability-exposure/types";
import { buildReadToolRequestFromAtlStep } from "../read-tool-request/atlAdapter";
import { executeReadTool } from "../read-tool-request/executeReadTool";
import type { NativeCustomerSessionExecutionContext } from "../native-cycle/customer-session/types";
import { SALES_AGENT_CONFIGURATION_SAFE_DEFAULT, type SalesAgentPromptConfiguration } from "../sales-agent-configuration";
import { buildAgentStepPromptPackage, type AgentLoopPriorAttemptFailure, type AgentLoopToolDescription } from "./buildAgentStepPromptPackage";
import { buildToolObservation } from "./buildToolObservation";
import { validateAgentStep } from "./validateAgentStep";
import type { AgentLoopProvider, AgentLoopProviderMessage } from "./agentLoopProviderTypes";
import { GET_PRODUCT_DETAILS_PENDING_CATALOG_BLOCKED_REASON } from "./agentStepTypes";
import type { AgentLoopInferenceRecord, AgentLoopProviderFailure, AgentLoopResult, AgentLoopStepRecord, AgentLoopStepPhase, AgentLoopTerminalReason, AgentStepRespond, AgentStepUseTool, PendingCatalogActionStep, ToolObservation } from "./agentStepTypes";
import type { RecentCatalogContext } from "./recentCatalogContext";
import { classifyAgentLoopProviderFailure, logAgentLoopProviderFailure } from "./providers/providerFailureClassification";
import { buildPendingCatalogActionFromRecommendation, collectAllowedProductIds, matchesPendingCatalogActionCandidate, normalizePendingCatalogActionForEvidence } from "./pendingCatalogAction";
import { resolveObservedRecommendationSourceProduct } from "./resolveObservedRecommendationSourceProduct";
import { checkUnbackedCommercialMutationClaim } from "./commercialMutationClaims";
import { buildCommercialActionRequestFromAtlStep } from "../commercial-action-request/atlAdapter";
import { executeCommercialActionRequest } from "../commercial-action-request/executeCommercialActionRequest";
import { ensureCommercialActionOpportunity } from "../commercial-action-request/ensureCommercialActionOpportunity";
import type { EnsureCommercialActionOpportunityInput, EnsureCommercialActionOpportunityResult } from "../commercial-action-request/ensureCommercialActionOpportunity";

/**
 * ACS-R1-05.1-T02.1 (spec section 5). Fixed, backend-owned pool - never
 * derived from LLM output, never a second registry. batch_get_products is
 * deliberately excluded: it is internal, deterministic hydration, never a
 * decision the agent makes for itself.
 *
 * ACS-R1-05.1-T02.6 added `explore_catalog` (extremes/top-N/rankings/filtered
 * browse) alongside the original three - an intentional expansion of this
 * pool, not a replacement; every pre-existing tool name is preserved.
 *
 * CP-R1-T10B8C added `recommend_catalog_products` - the capability was
 * already registered in the Capability Gateway (CP-R1-T10B8B) but excluded
 * from this pool until now. sourceProduct is not yet validated against
 * recentCatalogContext (CP-R1-T10B8D) and no continuity to
 * get_product_details is wired yet (also CP-R1-T10B8D) - see
 * docs/integrations/recommend-catalog-products-agent-tool.md.
 *
 * CRM-R1-T13D added `set_shipping_destination` - resolves a customer-stated
 * destination commune (free text only) against the canonical pc_pos.comuna
 * catalog (T13C) and persists it as the current opportunity's durable
 * shipping destination. See lib/brain/commercial/capability-gateway/
 * shippingDestinationCapability.ts.
 *
 * CRM-R1-T13E.2 added `select_products` (records an evidence-grounded
 * product selection as the opportunity's durable commercial line items -
 * see selectProductsCapability.ts and the evidence gate in
 * processUseToolStep below) and `calculate_shipping` (real shipping
 * alternatives via Carrier MS, the sole authority over coverage/carriers/
 * rates - takes no arguments, everything is backend state - see
 * calculateShippingCapability.ts).
 *
 * SALES-AGENT-R1-T2.1 added `select_shipping_option` (records the customer's
 * chosen shipping option as the opportunity's durable selected_shipping_option -
 * only an optionIndex observed in a real calculate_shipping response this
 * conversation, never a carrier name/service type/price from the model; its
 * evidence gate lives inside selectShippingOptionCapability.ts itself, not
 * in processUseToolStep below - see that file's own docstring for why).
 *
 * SALES-AGENT-R1-T3 added `create_quote` (creates a real draft quote via the
 * external Quote Service from the durable commercial_line_items selection -
 * takes no arguments, everything is backend state; never includes shipping,
 * a pre-existing contract gap - see createQuoteCapability.ts and
 * docs/audits/SALES-AGENT-R1-T3-create-quote-wiring-audit.md).
 */
export const AGENT_LOOP_TOOL_POOL = [
  "search_products",
  "get_product_details",
  "search_company_knowledge",
  "explore_catalog",
  "recommend_catalog_products",
  "set_shipping_destination",
  "select_products",
  "calculate_shipping",
  "select_shipping_option",
  "create_quote"
] as const;
export type AgentLoopToolName = (typeof AGENT_LOOP_TOOL_POOL)[number];

export const DEFAULT_MAX_DECISIONS = 3;
export const DEFAULT_MAX_TOOL_EXECUTIONS = 2;
export const DEFAULT_TIMEOUT_MS = 20000;
/** One initial attempt + one format retry - see dispatchAgentLoopResponse.ts for the fallback this feeds when both fail. */
const FINALIZATION_MAX_ATTEMPTS = 2;
const FINALIZATION_ALLOWED_TYPES = ["respond", "handoff"] as const;
/**
 * LLM-R1-T08D, Parte 5 (Commercial Mutation Execution Guard). Fixed, honest,
 * backend-authored fallback - never invents that anything was persisted,
 * never a partial rewrite of the model's own (untrusted, in this exact case)
 * message. Spanish, matching every other fixed customer-facing string this
 * loop already emits verbatim (e.g. buildAgentStepPromptPackage.ts's
 * COMMERCIAL_CLOSING_RULE_LINES).
 */
export const MUTATION_CLAIM_GUARD_FALLBACK_MESSAGE =
  "Necesito un momento mas para confirmar tu seleccion antes de continuar - ¿puedes confirmarme nuevamente que producto y cantidad quieres?";

export type RunAgentToolLoopInput = {
  correlationId: string;
  conversationId: number | null;
  opportunityId: number | null;
  currentTime: string;
  customerMessage: string;
  /** SALES-AGENT-R3-A03: the causation id a mutating tool call's CommercialActionRequest is built from. Optional/additive - absent means causationId is null, never a routing change. */
  inboundMessageId?: string | null;
  /** Already-sanitized, already-reduced context - never raw PII, never a full domain snapshot. */
  commercialContextSummary: Record<string, unknown>;
  /** Ephemeral recent catalog product identity context. Never a source of current price, stock, availability or URLs. */
  recentCatalogContext?: RecentCatalogContext | null;
  /** ACS-R1-05.1-T02.7. A catalog action this conversation's immediately preceding turn left open - see buildAgentStepPromptPackage.ts. */
  pendingCatalogAction?: PendingCatalogActionStep | null;
  provider: AgentLoopProvider | null;
  trustedCustomerSession?: NativeCustomerSessionExecutionContext | null;
  maxDecisions?: number;
  maxToolExecutions?: number;
  timeoutMs?: number;
  abortSignal?: AbortSignal | null;
  /** Defaults to the generic safe default (no PesasChile branding) - production callers always resolve and pass the effective one (ACS-R1-05.1-T02.3B). */
  identityConfiguration?: SalesAgentPromptConfiguration;
  /** SALES-AGENT-R3-V1.2. Test-only injection point; production callers never set this (defaults to the real, MariaDB-backed ensureCommercialActionOpportunity). */
  ensureOpportunity?: (input: EnsureCommercialActionOpportunityInput) => Promise<EnsureCommercialActionOpportunityResult>;
  /**
   * SALES-AGENT-R3-V1.8-D5. Resolved once per turn by the caller
   * (salesAgentRuntime.ts, via resolvePersistentSessionCognitionContext) -
   * never re-loaded per loop iteration. Passed through unchanged to every
   * buildAgentStepPromptPackage call this turn (gathering and finalization
   * alike) so the historical prefix stays byte-stable across iterations
   * (Section K) - see buildAgentStepPromptPackage.ts's own comment for the
   * assembly this triggers. `null`/absent is the exact legacy path.
   */
  persistentSessionHistoricalMessages?: AgentLoopProviderMessage[] | null;
};

/**
 * ACS-R1-05.1-T02.6.1. `inputSchema` is read from CapabilityGatewayDefinition
 * - the single canonical source (registry.ts) - never redefined here or in
 * the provider. Exported so it can be tested directly (spec section 8, test
 * 1: "buildToolDescriptions incluye inputSchema").
 */
export function buildToolDescriptions(): AgentLoopToolDescription[] {
  return AGENT_LOOP_TOOL_POOL.map((name) => {
    const definition = resolveCapabilityGatewayDefinition(name);
    return { name, description: definition?.description ?? name, inputSchema: definition?.inputSchema };
  });
}

/**
 * LLM-R1-T02. The safe, bounded subset of AgentLoopProviderResponse this loop is allowed to retain - never rawOutput, never a prompt.
 * LLM-R1-T09A: exported so runCommercialMultiIntentLoop.ts (the backend
 * multi-intent planner) can reuse the exact same provider-invocation/
 * observability mechanics for its own planner/finalizer calls, instead of a
 * second, parallel implementation of deadline/timeout/error-classification.
 */
export type AgentLoopProviderCallMetadata = {
  model: string | null;
  providerRequestId: string | null;
  finishReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** LLM-R1-T08B. Numeric count only - never reasoning_content text. */
  reasoningTokens: number | null;
};

export async function invokeProviderWithDeadline(
  provider: AgentLoopProvider,
  // SALES-AGENT-R3-V1.8-D3. Widened from an inline { role: "system"|"user" }
  // duplicate to the real, now-wider AgentLoopProviderMessage (agent
  // LoopProviderTypes.ts gained "assistant") - purely mechanical, no
  // behavior change: every real caller here still only ever constructs
  // "system"/"user" messages (buildAgentStepPromptPackage.ts is unchanged).
  messages: AgentLoopProviderMessage[],
  correlationId: string,
  deadlineMs: number,
  externalSignal: AbortSignal | null | undefined
): Promise<
  | { kind: "success"; rawOutput: unknown; elapsedMs: number; metadata: AgentLoopProviderCallMetadata }
  | { kind: "timeout"; elapsedMs: number }
  | { kind: "error"; error: unknown; elapsedMs: number }
> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onAbort, { once: true });
  }

  const remainingMs = Math.max(1, deadlineMs - Date.now());
  const timer = setTimeout(() => controller.abort(), remainingMs);
  const startedAt = Date.now();

  try {
    const response = await provider.invoke({ messages, correlationId }, { signal: controller.signal, timeoutMs: remainingMs });
    return {
      kind: "success",
      rawOutput: response.rawOutput,
      // LLM-R1-T02. Previously discarded here - only rawOutput ever left
      // this function on success, so elapsedMs/model/tokens/finishReason/
      // providerRequestId for a call that worked were never observable
      // anywhere (see docs/audits/SALES-AGENT-LLM-PROVIDER-LATENCY-STRUCTURED-OUTPUT-AUDIT.md
      // observability gaps). Purely additive - does not change what is
      // returned to callers deciding the next AgentStep.
      elapsedMs: Date.now() - startedAt,
      metadata: {
        model: response.model ?? null,
        providerRequestId: response.providerRequestId ?? null,
        finishReason: response.finishReason ?? null,
        inputTokens: response.inputTokens ?? null,
        outputTokens: response.outputTokens ?? null,
        reasoningTokens: response.reasoningTokens ?? null
      }
    };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    if (controller.signal.aborted) return { kind: "timeout", elapsedMs };
    return { kind: "error", error, elapsedMs };
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", onAbort);
  }
}

/** Requirement 1-2 (see task doc): captures the sanitized cause before it collapses into "provider_unavailable", logs it, and hands it back to be preserved on the loop's terminal result. LLM-R1-T09A: exported, see AgentLoopProviderCallMetadata above. */
export function captureProviderFailure(provider: AgentLoopProvider, correlationId: string, error: unknown, elapsedMs: number): AgentLoopProviderFailure {
  const cause = classifyAgentLoopProviderFailure(error);
  const providerFailure: AgentLoopProviderFailure = { provider: provider.name ?? null, elapsedMs, ...cause };
  logAgentLoopProviderFailure(correlationId, providerFailure);
  return providerFailure;
}

/**
 * LLM-R1-T02. Builds one AgentLoopInferenceRecord per real provider
 * invocation - success, failure or loop-level timeout - so every attempt
 * (including one later recovered from by LLM-R1-T01's structured recovery,
 * or the pre-existing schema-invalid AgentStep retry) leaves its own
 * observable evidence, never collapsed into just the turn's final outcome.
 * LLM-R1-T09A: exported, see AgentLoopProviderCallMetadata above.
 */
export function buildSuccessInferenceRecord(input: {
  phase: AgentLoopStepPhase;
  attempt: number;
  decisionIndex: number | null;
  elapsedMs: number;
  metadata: AgentLoopProviderCallMetadata;
}): AgentLoopInferenceRecord {
  return {
    phase: input.phase,
    attempt: input.attempt,
    decisionIndex: input.decisionIndex,
    elapsedMs: input.elapsedMs,
    model: input.metadata.model,
    providerRequestId: input.metadata.providerRequestId,
    finishReason: input.metadata.finishReason,
    inputTokens: input.metadata.inputTokens,
    outputTokens: input.metadata.outputTokens,
    reasoningTokens: input.metadata.reasoningTokens,
    outcome: "success"
  };
}

export function buildFailureInferenceRecord(input: {
  phase: AgentLoopStepPhase;
  attempt: number;
  decisionIndex: number | null;
  elapsedMs: number;
  providerFailure: AgentLoopProviderFailure;
}): AgentLoopInferenceRecord {
  return {
    phase: input.phase,
    attempt: input.attempt,
    decisionIndex: input.decisionIndex,
    elapsedMs: input.elapsedMs,
    model: input.providerFailure.model,
    providerRequestId: input.providerFailure.providerRequestId ?? null,
    finishReason: input.providerFailure.finishReason ?? null,
    inputTokens: input.providerFailure.inputTokens ?? null,
    outputTokens: input.providerFailure.outputTokens ?? null,
    reasoningTokens: input.providerFailure.reasoningTokens ?? null,
    outcome: input.providerFailure.normalizedReason
  };
}

/** The loop's own external deadline fired (distinct from httpAgentLoopProvider's internal per-attempt timeout, which already surfaces as a classified "error" with normalizedReason provider_timeout) - no response envelope was ever obtained, so every metadata field is genuinely unknown. LLM-R1-T09A: exported, see AgentLoopProviderCallMetadata above. */
export function buildTimeoutInferenceRecord(input: { phase: AgentLoopStepPhase; attempt: number; decisionIndex: number | null; elapsedMs: number }): AgentLoopInferenceRecord {
  return {
    phase: input.phase,
    attempt: input.attempt,
    decisionIndex: input.decisionIndex,
    elapsedMs: input.elapsedMs,
    model: null,
    providerRequestId: null,
    finishReason: null,
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    outcome: "provider_timeout"
  };
}

/** Recursively sorts object keys so two semantically identical argument sets (keys in a different order) always produce the same dedupe key. */
function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalJson((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

function buildDedupeKey(tool: string, args: Record<string, unknown>) {
  return `${tool}:${JSON.stringify(canonicalJson(args))}`;
}

function extractBudgetMax(commercialContextSummary: Record<string, unknown>): number | null {
  const needProfile = commercialContextSummary.needProfile;
  if (!needProfile || typeof needProfile !== "object") return null;
  const budgetMax = (needProfile as Record<string, unknown>).budgetMax;
  return typeof budgetMax === "number" && Number.isFinite(budgetMax) ? budgetMax : null;
}

function asComparableProductId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function getPendingCatalogActionTerminalFailure(input: {
  step: AgentStepUseTool;
  observation: ToolObservation;
  pendingCatalogAction?: PendingCatalogActionStep | null;
}): "failed" | "blocked" | null {
  if (input.step.tool !== "get_product_details") return null;
  if (input.observation.status !== "failed" && input.observation.status !== "blocked") return null;
  const pendingCatalogAction = input.pendingCatalogAction;
  if (!pendingCatalogAction || pendingCatalogAction.actionType !== "send_product_link") return null;

  const requestedProductId = asComparableProductId(input.step.arguments.productId);
  if (!requestedProductId) return null;
  const candidateProductIds = new Set(pendingCatalogAction.candidateProductIds.map(asComparableProductId).filter((productId): productId is string => productId !== null));
  return candidateProductIds.has(requestedProductId) ? input.observation.status : null;
}

function pendingCatalogActionWarningSuffix(input: {
  actionType: string;
  candidateCountBefore: number;
  candidateCountAfter: number;
  correlationId: string;
}) {
  return [
    input.actionType,
    `candidateCountBefore=${input.candidateCountBefore}`,
    `candidateCountAfter=${input.candidateCountAfter}`,
    `correlationId=${input.correlationId}`
  ].join(":");
}

/**
 * ACS-R1-05.1-T02.1 (post-smoke fix, point 7). Backend-owned enrichment
 * only - never a routing decision. Does not decide to call search_products;
 * only fills in a budgetMax the model omitted, when one is already known
 * from durable context. Never overrides a value the model itself supplied.
 */
function enrichToolArguments(tool: string, args: Record<string, unknown>, commercialContextSummary: Record<string, unknown>): Record<string, unknown> {
  if (tool !== "search_products") return args;
  if (args.budgetMax !== undefined) return args;
  const budgetMax = extractBudgetMax(commercialContextSummary);
  return budgetMax === null ? args : { ...args, budgetMax };
}

/**
 * CP-R1-T10B8D. The "evidencia valida existente del flujo previo" fallback
 * for get_product_details must never include recommend_catalog_products
 * observations - those are exactly what candidateProducts (checked first,
 * strictly, with variant precision) already governs. Reusing them here too
 * would let a wrong-variant request for an otherwise-recommended product
 * slip through this permissive, productId-only fallback, defeating the
 * variant check entirely. Independent corroboration only: search_products,
 * get_product_details, explore_catalog - same allowlist philosophy as
 * resolveObservedRecommendationSourceProduct.ts, applied here to a flat
 * productId-only check (reusing collectAllowedProductIds, never a second
 * evidence collector).
 */
function collectNonRecommendationEvidenceProductIds(input: { recentCatalogContext: RecentCatalogContext | null; toolObservationsThisTurn: ToolObservation[] }): string[] {
  const filteredContext: RecentCatalogContext | null = input.recentCatalogContext
    ? { interactions: input.recentCatalogContext.interactions.filter((interaction) => interaction.sourceTool !== "recommend_catalog_products") }
    : null;
  const filteredObservations = input.toolObservationsThisTurn.filter((observation) => observation.tool !== "recommend_catalog_products");
  return collectAllowedProductIds({ recentCatalogContext: filteredContext, toolObservations: filteredObservations });
}

/**
 * Runs one governed use_tool decision: dedup, registry/authorization check,
 * execution, observation. Shared by the gathering and finalization phases
 * would be overkill (finalization never allows use_tool), so this is called
 * only from the gathering phase - kept as its own function for readability.
 */
async function processUseToolStep(
  step: AgentStepUseTool,
  commercialContextSummary: Record<string, unknown>,
  executedCalls: Set<string>,
  gatewayContext: CapabilityGatewayContext,
  warnings: string[],
  inboundMessageId: string | null,
  currentTime: string,
  ensureOpportunity: (input: EnsureCommercialActionOpportunityInput) => Promise<EnsureCommercialActionOpportunityResult>,
  continuity: {
    recentCatalogContext: RecentCatalogContext | null;
    toolObservationsThisTurn: ToolObservation[];
    /** CP-R1-T10B8D. Already null when consumed - callers only ever pass an action still active for this exact call. */
    activeRecommendationPendingAction: PendingCatalogActionStep | null;
  }
): Promise<{ step: AgentStepUseTool; governance: "authorized" | "blocked_unregistered" | "blocked_duplicate" | "blocked_not_exposed"; observation: ToolObservation; executed: boolean }> {
  const effectiveArguments = enrichToolArguments(step.tool, step.arguments, commercialContextSummary);
  const enrichedStep: AgentStepUseTool = { ...step, arguments: effectiveArguments };
  const dedupeKey = buildDedupeKey(step.tool, effectiveArguments);

  if (!AGENT_LOOP_TOOL_POOL.includes(step.tool as AgentLoopToolName) || !resolveCapabilityGatewayDefinition(step.tool)) {
    warnings.push(`agent_loop_tool_blocked_unregistered:${step.tool}`);
    return { step: enrichedStep, governance: "blocked_unregistered", observation: { tool: step.tool, status: "blocked", errorCode: "capability_not_registered" }, executed: false };
  }

  if (executedCalls.has(dedupeKey)) {
    warnings.push(`agent_loop_tool_blocked_duplicate:${step.tool}`);
    return { step: enrichedStep, governance: "blocked_duplicate", observation: { tool: step.tool, status: "blocked", errorCode: "duplicate_tool_call" }, executed: false };
  }

  executedCalls.add(dedupeKey);

  // CP-R1-T10B8D. Evidence must be checked before the Gateway is ever called
  // (spec section 7) - a sourceProduct this conversation never observed must
  // produce zero HTTP calls to the Catalog Service, not a failed/skipped
  // execution from T10B6/T10B7/T10B8B. A rejected-before-any-real-work call
  // never consumes maxToolExecutions budget, same as invalid_arguments below.
  if (step.tool === "recommend_catalog_products") {
    const evidence = resolveObservedRecommendationSourceProduct({
      requestedSourceProduct: effectiveArguments.sourceProduct as { productId?: unknown; combinationId?: unknown } | null | undefined,
      recentCatalogContext: continuity.recentCatalogContext,
      toolObservations: continuity.toolObservationsThisTurn
    });
    if (evidence.status === "blocked") {
      warnings.push(`agent_loop_tool_blocked_evidence:${step.tool}:${evidence.reason}`);
      return { step: enrichedStep, governance: "authorized", observation: { tool: step.tool, status: "blocked", errorCode: evidence.reason }, executed: false };
    }
  }

  // CRM-R1-T13E.2. Every item's (productId, combinationId) must have been
  // actually observed this conversation - reuses the same evidence
  // machinery as recommend_catalog_products' sourceProduct above (only the
  // function name is recommendation-flavored; its logic is generic: "was
  // this product+variant observed"). resolveObservedRecommendationSourceProduct
  // requires a numeric productId/combinationId (recommend_catalog_products'
  // own schema types them `number`) while select_products' schema - like
  // every other catalog tool (search_products/get_product_details) - types
  // them `string`; both ultimately name the same real, numeric Catalog
  // Service ids, so converting via Number() here is a safe, local shape
  // adapter, never a semantic change (a non-numeric string correctly fails
  // evidence, since no real productId is ever non-numeric). Fails the WHOLE
  // call closed on the first unevidenced item - never a partial selection
  // persisted from a mix of real and fabricated items. Quantity is not
  // evidence-checked here (evidence only concerns product identity) -
  // selectProductsCapability's own execute() validates quantity.
  if (step.tool === "select_products") {
    const items = Array.isArray(effectiveArguments.items) ? effectiveArguments.items : [];
    for (const item of items) {
      const record = item as { productId?: unknown; combinationId?: unknown };
      const evidence = resolveObservedRecommendationSourceProduct({
        requestedSourceProduct: {
          productId: typeof record.productId === "string" ? Number(record.productId) : record.productId,
          combinationId: typeof record.combinationId === "string" ? Number(record.combinationId) : record.combinationId
        },
        recentCatalogContext: continuity.recentCatalogContext,
        toolObservations: continuity.toolObservationsThisTurn
      });
      if (evidence.status === "blocked") {
        warnings.push(`agent_loop_tool_blocked_evidence:${step.tool}:${evidence.reason}`);
        return { step: enrichedStep, governance: "authorized", observation: { tool: step.tool, status: "blocked", errorCode: evidence.reason }, executed: false };
      }
    }
  }

  // CP-R1-T10B8D. get_product_details keeps its pre-existing, unconditioned
  // authorization whenever no recommendation continuity is open
  // (activeRecommendationPendingAction null) - this block never runs then,
  // so every pre-T10B8D flow (search -> details, or details with zero
  // evidence at all) is unaffected. Only while a recommendation's candidates
  // are the active continuity window does an unmatched, unevidenced product
  // get rejected before the Gateway - "evidencia valida existente del flujo
  // previo" (recentCatalogContext/this turn's own observations) still
  // authorizes it even then, so a model that legitimately moved on to a
  // different, already-observed product is never blocked.
  if (step.tool === "get_product_details" && continuity.activeRecommendationPendingAction) {
    const requestedProductId = asComparableProductId(effectiveArguments.productId);
    const requestedCombinationId = asComparableProductId(effectiveArguments.combinationId) ?? undefined;
    const matchesCandidate = requestedProductId
      ? (continuity.activeRecommendationPendingAction.candidateProducts ?? []).some((candidate) =>
          matchesPendingCatalogActionCandidate(candidate, { productId: requestedProductId, combinationId: requestedCombinationId })
        )
      : false;

    if (!matchesCandidate) {
      const observedElsewhere = requestedProductId
        ? collectNonRecommendationEvidenceProductIds({ recentCatalogContext: continuity.recentCatalogContext, toolObservationsThisTurn: continuity.toolObservationsThisTurn }).includes(requestedProductId)
        : false;
      if (!observedElsewhere) {
        warnings.push(`agent_loop_tool_blocked_pending_catalog:${step.tool}`);
        return {
          step: enrichedStep,
          governance: "authorized",
          observation: { tool: step.tool, status: "blocked", errorCode: GET_PRODUCT_DETAILS_PENDING_CATALOG_BLOCKED_REASON },
          executed: false
        };
      }
    }
  }

  // SALES-AGENT-R3-A04. Explicit classification replaces the former
  // "CommercialActionRequest, else call the Gateway directly" fallback: every
  // agent-visible tool now resolves deterministically to exactly one of the
  // two structurally disjoint surfaces (agent-capability-exposure/types.ts),
  // or is failed closed before ever reaching the Gateway.
  //
  // NOT_AGENT_EXPOSED is structurally unreachable today (AGENT_LOOP_TOOL_POOL
  // above already only contains capabilities classified READ_TOOL or
  // COMMERCIAL_ACTION), kept as defense in depth - never trusted implicitly,
  // still tested (agentCapabilityExposure.test.ts) so a future pool addition
  // without a classification entry fails closed instead of silently calling
  // the Gateway.
  const exposure = resolveAgentCapabilityExposure(step.tool);
  if (exposure === "NOT_AGENT_EXPOSED") {
    warnings.push(`agent_loop_tool_blocked_not_exposed:${step.tool}`);
    return {
      step: enrichedStep,
      governance: "blocked_not_exposed",
      observation: { tool: step.tool, status: "blocked", errorCode: "capability_not_agent_exposed" },
      executed: false
    };
  }

  let gatewayResult: CapabilityGatewayResult;
  if (exposure === "COMMERCIAL_ACTION") {
    // SALES-AGENT-R3-V1.2. Lazy opportunity resolution: the one shared seam
    // for every mutating tool, ahead of building the CommercialActionRequest.
    // An already-known opportunityId is reused as-is (no DB round trip); a
    // missing one is resolved/created exactly once via resolveRuntimeOpportunity
    // (R3-V1.1) - never inside a capability, never inside the Capability
    // Gateway. The READ_TOOL branch below never reaches this code, so a pure
    // browsing turn never creates an opportunity.
    const ensuredOpportunity = await ensureOpportunity({
      conversationId: gatewayContext.conversationId ?? null,
      existingOpportunityId: typeof gatewayContext.opportunityId === "number" ? gatewayContext.opportunityId : null,
      trustedCustomerSession: gatewayContext.trustedCustomerSession,
      correlationId: gatewayContext.correlationId,
      currentTime
    });

    if (!ensuredOpportunity.ok) {
      // Infrastructure failure, never a fabricated business denial - a
      // distinct errorCode from the capability's own "no_active_opportunity"
      // (which means the resolver ran successfully and genuinely found
      // nothing active). Never reaches executeCommercialActionRequest/the
      // Gateway - the request is never built, so it cannot execute.
      // executed:true (unlike the evidence-gate/dedupe blocks above, which
      // are pure client-side gating with zero backend interaction): a real
      // resolution attempt was made and failed, the same budget-accounting
      // treatment this loop already gives a capability-level "denied" -
      // matches the pre-existing convention that only a call rejected before
      // any real attempt (invalid_arguments, duplicate, unregistered,
      // evidence-blocked) is free of budget cost.
      warnings.push(`agent_loop_opportunity_unavailable:${step.tool}:${ensuredOpportunity.reason}`);
      return {
        step: enrichedStep,
        governance: "authorized",
        observation: { tool: step.tool, status: "failed", errorCode: "opportunity_unavailable" },
        executed: true
      };
    }

    // Propagated onto the shared, turn-scoped gatewayContext: this is what
    // executeCommercialActionRequest -> executeGovernedCapability actually
    // reads as context.opportunityId (never re-derived from the request
    // object), and what a second mutating tool call later in the SAME turn
    // will see as `existingOpportunityId` above - one resolution per turn.
    gatewayContext.opportunityId = ensuredOpportunity.opportunityId;

    // Never a rewrite of this function, only this branch's call site: every
    // check above (dedupe, catalog/selection evidence) still runs first,
    // unchanged, and executeGovernedCapability remains the one place a side
    // effect can occur either way.
    const commercialActionRequest = buildCommercialActionRequestFromAtlStep({
      step: enrichedStep,
      conversationId: gatewayContext.conversationId ?? null,
      opportunityId: ensuredOpportunity.opportunityId,
      correlationId: gatewayContext.correlationId,
      inboundMessageId
    });
    gatewayResult = commercialActionRequest
      ? (await executeCommercialActionRequest(commercialActionRequest, gatewayContext)).gatewayResult
      : await executeGovernedCapability(step.tool, effectiveArguments, gatewayContext);
  } else {
    // exposure === "READ_TOOL"
    const readToolRequest = buildReadToolRequestFromAtlStep({
      step: enrichedStep,
      conversationId: gatewayContext.conversationId ?? null,
      opportunityId: typeof gatewayContext.opportunityId === "number" ? gatewayContext.opportunityId : null,
      correlationId: gatewayContext.correlationId,
      inboundMessageId
    });
    gatewayResult = readToolRequest
      ? (await executeReadTool(readToolRequest, gatewayContext)).gatewayResult
      : await executeGovernedCapability(step.tool, effectiveArguments, gatewayContext);
  }

  // ACS-R1-05.1-T02.6.1 (spec section 7). A call rejected before any real
  // work happened (bad shape, never reached the Catalog Service) never
  // consumed maxToolExecutions budget - only a call that actually attempted
  // something does. This is what lets the model correct its arguments and
  // retry within budget instead of the tool budget silently exhausting on a
  // single malformed call and forcing a premature handoff.
  // ACS-R1-05.1-T02.6.1. Fold the capability's own sanitized warnings (fixed
  // string codes only, e.g. explore_catalog_legacy_sort_alias_used) into
  // this turn's aggregated warning list - the internal-only observability
  // channel every other technical signal in this loop already uses. Never a
  // second, independent recording path (ACS-R1-04-T08.1's stated intent for
  // CapabilityExecutionOutcome.warnings).
  for (const warning of gatewayResult.warnings) {
    warnings.push(`agent_loop_tool_warning:${step.tool}:${warning}`);
  }

  if (gatewayResult.status === "invalid_arguments") {
    warnings.push(`agent_loop_tool_invalid_arguments:${step.tool}:${gatewayResult.errorCode ?? "unknown"}`);
    return { step: enrichedStep, governance: "authorized", observation: buildToolObservation(step.tool, gatewayResult), executed: false };
  }

  return { step: enrichedStep, governance: "authorized", observation: buildToolObservation(step.tool, gatewayResult), executed: true };
}

/**
 * The native read-only agent tool loop (ACS-R1-05.1-T02.1), two phases with
 * independent, non-competing budgets (post-smoke fix - see release spec):
 *
 * 1. Gathering: up to `maxDecisions` model decisions, up to
 *    `maxToolExecutions` governed tool executions. Ends the moment either
 *    budget is spent, or earlier if the model itself responds/hands off.
 * 2. Finalization: exactly `FINALIZATION_MAX_ATTEMPTS` attempts (one format
 *    retry), respond/handoff only - no tools offered or accepted. Only a
 *    finalization failure (both attempts invalid) reaches the customer-
 *    facing fallback; a full/exhausted gathering phase always gets this
 *    dedicated, simpler last chance first.
 */
export async function runAgentToolLoop(input: RunAgentToolLoopInput): Promise<AgentLoopResult> {
  const maxDecisions = input.maxDecisions ?? DEFAULT_MAX_DECISIONS;
  const maxToolExecutions = input.maxToolExecutions ?? DEFAULT_MAX_TOOL_EXECUTIONS;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const identityConfiguration = input.identityConfiguration ?? SALES_AGENT_CONFIGURATION_SAFE_DEFAULT;
  const ensureOpportunity = input.ensureOpportunity ?? ensureCommercialActionOpportunity;
  const deadline = Date.now() + timeoutMs;
  const warnings: string[] = [];

  if (!input.provider) {
    return { ran: false, terminalReason: "provider_unavailable", steps: [], toolExecutionCount: 0, finalMessage: null, handoffReason: null, warnings: ["provider_unavailable"], finalPendingCatalogAction: null, llmCalls: [] };
  }

  const toolDescriptions = buildToolDescriptions();
  const gatewayContext: CapabilityGatewayContext = {
    correlationId: input.correlationId,
    conversationId: input.conversationId,
    opportunityId: input.opportunityId,
    trustedCustomerSession: input.trustedCustomerSession ?? null
  };

  const steps: AgentLoopStepRecord[] = [];
  /** LLM-R1-T02. One entry per real provider invocation this turn - see AgentLoopInferenceRecord. */
  const llmCalls: AgentLoopInferenceRecord[] = [];
  const executedCalls = new Set<string>();
  let toolExecutionCount = 0;
  let pendingCatalogActionTerminalFailure: "failed" | "blocked" | null = null;

  // CP-R1-T10B8D. Recommendation-origin continuity, tracked separately from
  // pendingCatalogActionTerminalFailure above (which only ever concerns the
  // model-emitted send_product_link mechanism keyed off input.pendingCatalogAction
  // as originally carried into this turn). Seeded from input.pendingCatalogAction
  // only when it already carries candidateProducts (i.e. it really is a
  // recommendation action persisted by a prior turn) - a plain, legacy, or
  // model-emitted send_product_link action never sets this, so it never gates
  // get_product_details (spec: "no reducir autorizaciones existentes").
  let activeRecommendationPendingAction: PendingCatalogActionStep | null =
    input.pendingCatalogAction?.candidateProducts?.length ? input.pendingCatalogAction : null;
  let recommendationPendingActionConsumed = false;

  const finalize = (terminalReason: AgentLoopTerminalReason, providerFailure?: AgentLoopProviderFailure | null): AgentLoopResult => ({
    ran: true,
    terminalReason,
    steps,
    toolExecutionCount,
    finalMessage: null,
    handoffReason: null,
    warnings,
    providerFailure: providerFailure ?? null,
    finalPendingCatalogAction: null,
    llmCalls
  });

  // ACS-R1-05.1-T02.7. Observability only - functional continuity comes
  // entirely from what this turn's own terminal respond step does or does
  // not carry (see the two "responded" branches below). A turn that started
  // with a pending action but ends in handoff/timeout/provider_unavailable/
  // invalid_output never re-persists it (no code path below sets a
  // pendingCatalogAction from those branches), which is what actually
  // expires it for the next turn - this warning just makes that visible in
  // the same channel every other technical signal in this loop already uses.
  if (input.pendingCatalogAction) {
    warnings.push(`pending_catalog_action_active:${input.pendingCatalogAction.actionType}:${input.pendingCatalogAction.candidateProductIds.length}`);
  }

  /**
   * Both phases finalize a "responded" terminal outcome identically: same
   * warning bookkeeping (was a pending action carried into this turn, and
   * did this turn's own respond step renew or drop it), same result shape.
   * Kept as one shared closure instead of duplicating it at both call sites.
   */
  const respondedResult = (step: AgentStepRespond): AgentLoopResult => {
    // LLM-R1-T08D, Parte 5 (Commercial Mutation Execution Guard). Fail
    // closed: a response can never reach the customer claiming a product
    // selection/quantity/order is done unless this turn's own steps show a
    // select_products observation actually completing it. `backed` is pure
    // structural evidence (steps this turn) - never regex; the pattern match
    // only decides whether step.message reads as a completion claim at all,
    // per commercialMutationClaims.ts's own discipline. When it fires, the
    // model's own message AND any pendingCatalogAction it attached are both
    // discarded - once one claim in a step is untrusted, nothing else in
    // that same step is selectively trusted either.
    const mutationClaimCheck = checkUnbackedCommercialMutationClaim({ terminalReason: "responded", finalMessage: step.message, steps });
    if (mutationClaimCheck.unbacked) {
      warnings.push(`agent_loop_mutation_claim_blocked:${mutationClaimCheck.matchedPattern ?? "unknown"}`);
    }
    const finalMessage = mutationClaimCheck.unbacked ? MUTATION_CLAIM_GUARD_FALLBACK_MESSAGE : step.message;

    const normalizedPendingCatalogAction = normalizePendingCatalogActionForEvidence({
      pendingCatalogAction: mutationClaimCheck.unbacked ? null : (step.pendingCatalogAction ?? null),
      recentCatalogContext: input.recentCatalogContext ?? null,
      toolObservations: steps.map((record) => record.observation),
      correlationId: input.correlationId
    });
    warnings.push(...normalizedPendingCatalogAction.warnings);
    if (pendingCatalogActionTerminalFailure && normalizedPendingCatalogAction.pendingCatalogAction) {
      warnings.push(
        `pendingCatalogAction_model_renewal_suppressed:${pendingCatalogActionWarningSuffix({
          actionType: normalizedPendingCatalogAction.pendingCatalogAction.actionType,
          candidateCountBefore: normalizedPendingCatalogAction.pendingCatalogAction.candidateProductIds.length,
          candidateCountAfter: 0,
          correlationId: input.correlationId
        })}`
      );
    }
    const modelPendingCatalogAction = pendingCatalogActionTerminalFailure ? null : (normalizedPendingCatalogAction.pendingCatalogAction ?? null);
    if (input.pendingCatalogAction) {
      warnings.push(
        modelPendingCatalogAction
          ? `pending_catalog_action_renewed:${modelPendingCatalogAction.actionType}:${modelPendingCatalogAction.candidateProductIds.length}`
          : `pending_catalog_action_consumed:${input.pendingCatalogAction.actionType}`
      );
    }

    // CP-R1-T10B8D. The model's own explicit respond.pendingCatalogAction
    // always wins when present (zero change to any pre-existing
    // send_product_link behavior/test). Only when the model left it out does
    // an active, unconsumed recommendation continuity survive automatically -
    // the model never has to know about candidateProducts to keep it open.
    const recommendationPendingCatalogAction = recommendationPendingActionConsumed ? null : activeRecommendationPendingAction;
    if (!modelPendingCatalogAction && recommendationPendingCatalogAction) {
      warnings.push(`recommendation_pending_catalog_action_carried_forward:candidateCount=${recommendationPendingCatalogAction.candidateProductIds.length}`);
    }
    const finalPendingCatalogAction = modelPendingCatalogAction ?? recommendationPendingCatalogAction;

    return { ran: true, terminalReason: "responded", steps, toolExecutionCount, finalMessage, handoffReason: null, warnings, finalPendingCatalogAction, llmCalls };
  };

  // ---- Phase 1: gathering ----
  let decisionIndex = 0;
  let gatheringRetryUsed = false;
  // LLM-R1-T01. Deliberately a separate flag from gatheringRetryUsed above -
  // never conflated. gatheringRetryUsed repairs a well-formed-but-invalid
  // AgentStep (a model/contract problem); this repairs a provider-level
  // structural failure (empty_response/invalid_model_json/invalid_json_response,
  // normalizedReason "invalid_response" - a transport-adjacent problem the
  // model never got a chance to answer at all). Each gets its own one-shot
  // budget for the whole gathering phase, never per decision slot - see the
  // `invoked.kind === "error"` branch below and
  // docs/audits/SALES-AGENT-LLM-PROVIDER-LATENCY-STRUCTURED-OUTPUT-AUDIT.md P0-1.
  let gatheringStructuredRecoveryUsed = false;
  /** LLM-R1-T02. Counts provider calls within the current decisionIndex slot (0 = first call, 1+ = a retry of that same slot) - reset to 0 every time decisionIndex actually advances, below. */
  let gatheringAttemptIndex = 0;
  /**
   * LLM-R1-T04. What to tell the model went wrong on the immediately
   * preceding call, for the very next call only - set right before a
   * structured-recovery or schema-invalid `continue` below, always consumed
   * (read into promptPackage, then reset to null) at the very top of the
   * next iteration, regardless of how that iteration turns out. Never
   * survives past the one call it was set for - a success, a different
   * failure, decisionIndex advancing, or falling through to finalization
   * all leave it null again.
   */
  let gatheringPendingRepairSignal: AgentLoopPriorAttemptFailure | null = null;
  while (decisionIndex < maxDecisions && toolExecutionCount < maxToolExecutions) {
    if (Date.now() > deadline) {
      warnings.push("agent_loop_timeout");
      return finalize("timeout");
    }

    const promptPackage = buildAgentStepPromptPackage({
      currentTime: input.currentTime,
      customerMessage: input.customerMessage,
      commercialContextSummary: input.commercialContextSummary,
      recentCatalogContext: input.recentCatalogContext ?? null,
      pendingCatalogAction: input.pendingCatalogAction ?? null,
      availableTools: toolDescriptions,
      priorSteps: steps,
      stepsRemaining: maxDecisions - decisionIndex,
      phase: "gathering",
      identityConfiguration,
      priorAttemptFailure: gatheringPendingRepairSignal,
      persistentSessionHistoricalMessages: input.persistentSessionHistoricalMessages ?? null
    });
    // LLM-R1-T04. Consumed immediately - this exact signal is for this one
    // call only, never for whatever call happens next.
    gatheringPendingRepairSignal = null;

    const invoked = await invokeProviderWithDeadline(input.provider, promptPackage.messages, input.correlationId, deadline, input.abortSignal);
    // LLM-R1-T02. Captured once, before branching, so every branch below
    // (timeout/error/success) records the same attempt index for this call,
    // and the counter always advances exactly once per real provider call.
    const gatheringCallAttempt = gatheringAttemptIndex;
    gatheringAttemptIndex += 1;

    if (invoked.kind === "timeout") {
      llmCalls.push(buildTimeoutInferenceRecord({ phase: "gathering", attempt: gatheringCallAttempt, decisionIndex, elapsedMs: invoked.elapsedMs }));
      warnings.push("agent_loop_timeout");
      return finalize("timeout");
    }
    if (invoked.kind === "error") {
      const providerFailure = captureProviderFailure(input.provider, input.correlationId, invoked.error, invoked.elapsedMs);
      llmCalls.push(buildFailureInferenceRecord({ phase: "gathering", attempt: gatheringCallAttempt, decisionIndex, elapsedMs: invoked.elapsedMs, providerFailure }));
      warnings.push(`agent_loop_provider_error:${providerFailure.normalizedReason}`);
      // LLM-R1-T01. `invalid_response` is the one normalizedReason where the
      // request itself was fine and only this one structural attempt at
      // producing AgentStep JSON was bad (empty_response/invalid_model_json/
      // invalid_json_response - never a retryable-at-transport concept like
      // timeout/rate_limited/network_error, and never an unrecoverable one
      // like authentication_error/model_unavailable). Exactly one same-slot
      // recovery attempt (same prompt, no guided repair yet - that is
      // LLM-R1-T04), then fail closed like every other reason.
      if (providerFailure.normalizedReason === "invalid_response" && !gatheringStructuredRecoveryUsed) {
        gatheringStructuredRecoveryUsed = true;
        // LLM-R1-T04. The one-shot recovery call T01 already grants gets a
        // guided repair instruction instead of a blind resend.
        gatheringPendingRepairSignal = { kind: "invalid_response" };
        warnings.push("agent_loop_structured_recovery_attempted:gathering");
        continue;
      }
      return finalize("provider_unavailable", providerFailure);
    }

    llmCalls.push(buildSuccessInferenceRecord({ phase: "gathering", attempt: gatheringCallAttempt, decisionIndex, elapsedMs: invoked.elapsedMs, metadata: invoked.metadata }));

    const validation = validateAgentStep(invoked.rawOutput);
    if (validation.status === "invalid") {
      warnings.push(`agent_step_invalid:${validation.reason}`);
      if (gatheringRetryUsed) {
        // Gathering's own retry is spent - fall through to finalization
        // instead of failing safe directly (spec point 6: fallback only
        // after finalization also fails).
        warnings.push("agent_loop_gathering_failed");
        break;
      }
      gatheringRetryUsed = true;
      // LLM-R1-T04. Guided repair: the retry sees validateAgentStep's own
      // bounded reasonCode, never the free-text `reason` above (that string
      // is only ever logged internally, in `warnings`) and never the raw
      // rawOutput that failed validation.
      gatheringPendingRepairSignal = { kind: "invalid_agent_step", reasonCode: validation.reasonCode };
      continue;
    }

    const step = validation.step;

    if (step.type === "respond") {
      steps.push({ stepIndex: decisionIndex, step, governance: null, observation: null, phase: "gathering" });
      return respondedResult(step);
    }

    if (step.type === "handoff") {
      steps.push({ stepIndex: decisionIndex, step, governance: null, observation: null, phase: "gathering" });
      return { ran: true, terminalReason: "handoff", steps, toolExecutionCount, finalMessage: null, handoffReason: step.reason, warnings, finalPendingCatalogAction: null, llmCalls };
    }

    const toolObservationsThisTurn = steps.map((record) => record.observation).filter((observation): observation is ToolObservation => observation !== null);
    const result = await processUseToolStep(step, input.commercialContextSummary, executedCalls, gatewayContext, warnings, input.inboundMessageId ?? null, input.currentTime, ensureOpportunity, {
      recentCatalogContext: input.recentCatalogContext ?? null,
      toolObservationsThisTurn,
      activeRecommendationPendingAction: recommendationPendingActionConsumed ? null : activeRecommendationPendingAction
    });
    if (result.executed) toolExecutionCount += 1;
    steps.push({ stepIndex: decisionIndex, step: result.step, governance: result.governance, observation: result.observation, phase: "gathering" });
    const terminalFailure = getPendingCatalogActionTerminalFailure({
      step: result.step,
      observation: result.observation,
      pendingCatalogAction: input.pendingCatalogAction ?? null
    });
    if (!pendingCatalogActionTerminalFailure && terminalFailure) {
      pendingCatalogActionTerminalFailure = terminalFailure;
      warnings.push(
        `pendingCatalogAction_tool_${terminalFailure}_consumed:${pendingCatalogActionWarningSuffix({
          actionType: input.pendingCatalogAction?.actionType ?? "send_product_link",
          candidateCountBefore: input.pendingCatalogAction?.candidateProductIds.length ?? 0,
          candidateCountAfter: 0,
          correlationId: input.correlationId
        })}`
      );
    }

    // CP-R1-T10B8D. Renewal: a completed recommend_catalog_products result
    // this turn always wins over whatever was active before (latest
    // successful recommendation wins) - empty candidates invalidate a prior
    // active recommendation action instead of leaving a stale one open.
    // skipped/failed/blocked (evidence-blocked or otherwise) never touch it -
    // no result to render latest, so the prior action (if any) stays intact.
    if (result.step.tool === "recommend_catalog_products" && result.observation.status === "completed") {
      const renewed = buildPendingCatalogActionFromRecommendation(result.observation);
      if (renewed) {
        activeRecommendationPendingAction = renewed;
        warnings.push(`recommendation_pending_catalog_action_set:candidateCount=${renewed.candidateProductIds.length}`);
      } else if (activeRecommendationPendingAction) {
        warnings.push("recommendation_pending_catalog_action_invalidated_empty");
        activeRecommendationPendingAction = null;
      }
      recommendationPendingActionConsumed = false;
    }

    // CP-R1-T10B8D. Consumption: only for a get_product_details request that
    // actually matched a recommendation candidate (never "producto no
    // candidato", never another tool, never twice for an already-consumed
    // action) - completed/failed/blocked all consume, mirroring the
    // historical failed/blocked rule above and extending it to completed,
    // which send_product_link never auto-consumed on (the model decides
    // there) but this runtime-managed continuity always does.
    if (result.step.tool === "get_product_details" && activeRecommendationPendingAction && !recommendationPendingActionConsumed) {
      const requestedProductId = asComparableProductId(result.step.arguments.productId);
      const requestedCombinationId = asComparableProductId(result.step.arguments.combinationId) ?? undefined;
      const matchedCandidate = requestedProductId
        ? (activeRecommendationPendingAction.candidateProducts ?? []).some((candidate) =>
            matchesPendingCatalogActionCandidate(candidate, { productId: requestedProductId, combinationId: requestedCombinationId })
          )
        : false;
      if (matchedCandidate && (result.observation.status === "completed" || result.observation.status === "failed" || result.observation.status === "blocked")) {
        recommendationPendingActionConsumed = true;
        warnings.push(`recommendation_pending_catalog_action_consumed:${result.observation.status}`);
      }
    }

    decisionIndex += 1;
    // LLM-R1-T02. A new decision slot starts at attempt 0 again.
    gatheringAttemptIndex = 0;
  }

  // ---- Phase 2: finalization (spec points 3-6) ----
  warnings.push("agent_loop_finalization_entered");
  /**
   * LLM-R1-T04. Same one-shot-consumption discipline as
   * gatheringPendingRepairSignal above - set right before a `continue`
   * below, always consumed (read into promptPackage, then reset to null) at
   * the top of the very next attempt, never surviving past it.
   */
  let finalizationPendingRepairSignal: AgentLoopPriorAttemptFailure | null = null;
  for (let attempt = 0; attempt < FINALIZATION_MAX_ATTEMPTS; attempt += 1) {
    if (Date.now() > deadline) {
      warnings.push("agent_loop_timeout");
      return finalize("timeout");
    }

    const promptPackage = buildAgentStepPromptPackage({
      currentTime: input.currentTime,
      customerMessage: input.customerMessage,
      commercialContextSummary: input.commercialContextSummary,
      recentCatalogContext: input.recentCatalogContext ?? null,
      pendingCatalogAction: input.pendingCatalogAction ?? null,
      availableTools: [],
      priorSteps: steps,
      stepsRemaining: 1,
      phase: "finalization",
      identityConfiguration,
      priorAttemptFailure: finalizationPendingRepairSignal,
      persistentSessionHistoricalMessages: input.persistentSessionHistoricalMessages ?? null
    });
    // LLM-R1-T04. Consumed immediately - see the matching comment in gathering above.
    finalizationPendingRepairSignal = null;

    const invoked = await invokeProviderWithDeadline(input.provider, promptPackage.messages, input.correlationId, deadline, input.abortSignal);
    if (invoked.kind === "timeout") {
      llmCalls.push(buildTimeoutInferenceRecord({ phase: "finalization", attempt, decisionIndex: null, elapsedMs: invoked.elapsedMs }));
      warnings.push("agent_loop_timeout");
      return finalize("timeout");
    }
    if (invoked.kind === "error") {
      const providerFailure = captureProviderFailure(input.provider, input.correlationId, invoked.error, invoked.elapsedMs);
      llmCalls.push(buildFailureInferenceRecord({ phase: "finalization", attempt, decisionIndex: null, elapsedMs: invoked.elapsedMs, providerFailure }));
      warnings.push(`agent_loop_provider_error:${providerFailure.normalizedReason}`);
      // LLM-R1-T01. Same structural-recovery class as gathering above,
      // expressed here as "one more finalization attempt remains" instead of
      // a second counter (reuses FINALIZATION_MAX_ATTEMPTS, never a parallel
      // budget). Any other normalizedReason keeps failing fast on this exact
      // attempt, unchanged from before this task - this branch only ever
      // widens what happens for "invalid_response", nothing else.
      if (providerFailure.normalizedReason === "invalid_response" && attempt < FINALIZATION_MAX_ATTEMPTS - 1) {
        // LLM-R1-T04. Guided repair for the one remaining attempt.
        finalizationPendingRepairSignal = { kind: "invalid_response" };
        warnings.push("agent_loop_structured_recovery_attempted:finalization");
        continue;
      }
      return finalize("provider_unavailable", providerFailure);
    }

    llmCalls.push(buildSuccessInferenceRecord({ phase: "finalization", attempt, decisionIndex: null, elapsedMs: invoked.elapsedMs, metadata: invoked.metadata }));

    const validation = validateAgentStep(invoked.rawOutput, FINALIZATION_ALLOWED_TYPES);
    if (validation.status === "invalid") {
      warnings.push(`agent_step_invalid:${validation.reason}`);
      if (attempt < FINALIZATION_MAX_ATTEMPTS - 1) {
        // LLM-R1-T04. Guided repair: bounded reasonCode only, never the
        // free-text reason or the raw rawOutput that failed validation.
        finalizationPendingRepairSignal = { kind: "invalid_agent_step", reasonCode: validation.reasonCode };
        continue;
      }
      warnings.push("agent_loop_finalization_failed");
      return finalize("invalid_output");
    }

    const step = validation.step;
    steps.push({ stepIndex: steps.length, step, governance: null, observation: null, phase: "finalization" });

    if (step.type === "respond") {
      return respondedResult(step);
    }
    if (step.type === "handoff") {
      return { ran: true, terminalReason: "handoff", steps, toolExecutionCount, finalMessage: null, handoffReason: step.reason, warnings, finalPendingCatalogAction: null, llmCalls };
    }
  }

  // Unreachable (the loop above always returns), kept as a safe terminal state.
  return finalize("invalid_output");
}
