import { executeGovernedCapability } from "../capability-gateway/executeCapability";
import { resolveCapabilityGatewayDefinition } from "../capability-gateway/registry";
import type { CapabilityGatewayContext } from "../capability-gateway/types";
import type { NativeCustomerSessionExecutionContext } from "../native-cycle/customer-session/types";
import { SALES_AGENT_CONFIGURATION_SAFE_DEFAULT, type SalesAgentPromptConfiguration } from "../sales-agent-configuration";
import { buildAgentStepPromptPackage, type AgentLoopToolDescription } from "./buildAgentStepPromptPackage";
import { buildToolObservation } from "./buildToolObservation";
import { validateAgentStep } from "./validateAgentStep";
import type { AgentLoopProvider } from "./agentLoopProviderTypes";
import { GET_PRODUCT_DETAILS_PENDING_CATALOG_BLOCKED_REASON } from "./agentStepTypes";
import type { AgentLoopProviderFailure, AgentLoopResult, AgentLoopStepRecord, AgentLoopTerminalReason, AgentStepRespond, AgentStepUseTool, PendingCatalogActionStep, ToolObservation } from "./agentStepTypes";
import type { RecentCatalogContext } from "./recentCatalogContext";
import { classifyAgentLoopProviderFailure, logAgentLoopProviderFailure } from "./providers/providerFailureClassification";
import { buildPendingCatalogActionFromRecommendation, collectAllowedProductIds, matchesPendingCatalogActionCandidate, normalizePendingCatalogActionForEvidence } from "./pendingCatalogAction";
import { resolveObservedRecommendationSourceProduct } from "./resolveObservedRecommendationSourceProduct";

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
 */
export const AGENT_LOOP_TOOL_POOL = [
  "search_products",
  "get_product_details",
  "search_company_knowledge",
  "explore_catalog",
  "recommend_catalog_products",
  "set_shipping_destination",
  "select_products",
  "calculate_shipping"
] as const;
export type AgentLoopToolName = (typeof AGENT_LOOP_TOOL_POOL)[number];

const DEFAULT_MAX_DECISIONS = 3;
const DEFAULT_MAX_TOOL_EXECUTIONS = 2;
const DEFAULT_TIMEOUT_MS = 20000;
/** One initial attempt + one format retry - see dispatchAgentLoopResponse.ts for the fallback this feeds when both fail. */
const FINALIZATION_MAX_ATTEMPTS = 2;
const FINALIZATION_ALLOWED_TYPES = ["respond", "handoff"] as const;

export type RunAgentToolLoopInput = {
  correlationId: string;
  conversationId: number | null;
  opportunityId: number | null;
  currentTime: string;
  customerMessage: string;
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

async function invokeProviderWithDeadline(
  provider: AgentLoopProvider,
  messages: { role: "system" | "user"; content: string }[],
  correlationId: string,
  deadlineMs: number,
  externalSignal: AbortSignal | null | undefined
): Promise<{ kind: "success"; rawOutput: unknown } | { kind: "timeout" } | { kind: "error"; error: unknown; elapsedMs: number }> {
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
    return { kind: "success", rawOutput: response.rawOutput };
  } catch (error) {
    if (controller.signal.aborted) return { kind: "timeout" };
    return { kind: "error", error, elapsedMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", onAbort);
  }
}

/** Requirement 1-2 (see task doc): captures the sanitized cause before it collapses into "provider_unavailable", logs it, and hands it back to be preserved on the loop's terminal result. */
function captureProviderFailure(provider: AgentLoopProvider, correlationId: string, error: unknown, elapsedMs: number): AgentLoopProviderFailure {
  const cause = classifyAgentLoopProviderFailure(error);
  const providerFailure: AgentLoopProviderFailure = { provider: provider.name ?? null, elapsedMs, ...cause };
  logAgentLoopProviderFailure(correlationId, providerFailure);
  return providerFailure;
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
  continuity: {
    recentCatalogContext: RecentCatalogContext | null;
    toolObservationsThisTurn: ToolObservation[];
    /** CP-R1-T10B8D. Already null when consumed - callers only ever pass an action still active for this exact call. */
    activeRecommendationPendingAction: PendingCatalogActionStep | null;
  }
): Promise<{ step: AgentStepUseTool; governance: "authorized" | "blocked_unregistered" | "blocked_duplicate"; observation: ToolObservation; executed: boolean }> {
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

  const gatewayResult = await executeGovernedCapability(step.tool, effectiveArguments, gatewayContext);

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
  const deadline = Date.now() + timeoutMs;
  const warnings: string[] = [];

  if (!input.provider) {
    return { ran: false, terminalReason: "provider_unavailable", steps: [], toolExecutionCount: 0, finalMessage: null, handoffReason: null, warnings: ["provider_unavailable"], finalPendingCatalogAction: null };
  }

  const toolDescriptions = buildToolDescriptions();
  const gatewayContext: CapabilityGatewayContext = {
    correlationId: input.correlationId,
    conversationId: input.conversationId,
    opportunityId: input.opportunityId,
    trustedCustomerSession: input.trustedCustomerSession ?? null
  };

  const steps: AgentLoopStepRecord[] = [];
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
    finalPendingCatalogAction: null
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
    const normalizedPendingCatalogAction = normalizePendingCatalogActionForEvidence({
      pendingCatalogAction: step.pendingCatalogAction ?? null,
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

    return { ran: true, terminalReason: "responded", steps, toolExecutionCount, finalMessage: step.message, handoffReason: null, warnings, finalPendingCatalogAction };
  };

  // ---- Phase 1: gathering ----
  let decisionIndex = 0;
  let gatheringRetryUsed = false;
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
      identityConfiguration
    });

    const invoked = await invokeProviderWithDeadline(input.provider, promptPackage.messages, input.correlationId, deadline, input.abortSignal);
    if (invoked.kind === "timeout") {
      warnings.push("agent_loop_timeout");
      return finalize("timeout");
    }
    if (invoked.kind === "error") {
      const providerFailure = captureProviderFailure(input.provider, input.correlationId, invoked.error, invoked.elapsedMs);
      warnings.push(`agent_loop_provider_error:${providerFailure.normalizedReason}`);
      return finalize("provider_unavailable", providerFailure);
    }

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
      continue;
    }

    const step = validation.step;

    if (step.type === "respond") {
      steps.push({ stepIndex: decisionIndex, step, governance: null, observation: null, phase: "gathering" });
      return respondedResult(step);
    }

    if (step.type === "handoff") {
      steps.push({ stepIndex: decisionIndex, step, governance: null, observation: null, phase: "gathering" });
      return { ran: true, terminalReason: "handoff", steps, toolExecutionCount, finalMessage: null, handoffReason: step.reason, warnings, finalPendingCatalogAction: null };
    }

    const toolObservationsThisTurn = steps.map((record) => record.observation).filter((observation): observation is ToolObservation => observation !== null);
    const result = await processUseToolStep(step, input.commercialContextSummary, executedCalls, gatewayContext, warnings, {
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
  }

  // ---- Phase 2: finalization (spec points 3-6) ----
  warnings.push("agent_loop_finalization_entered");
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
      identityConfiguration
    });

    const invoked = await invokeProviderWithDeadline(input.provider, promptPackage.messages, input.correlationId, deadline, input.abortSignal);
    if (invoked.kind === "timeout") {
      warnings.push("agent_loop_timeout");
      return finalize("timeout");
    }
    if (invoked.kind === "error") {
      const providerFailure = captureProviderFailure(input.provider, input.correlationId, invoked.error, invoked.elapsedMs);
      warnings.push(`agent_loop_provider_error:${providerFailure.normalizedReason}`);
      return finalize("provider_unavailable", providerFailure);
    }

    const validation = validateAgentStep(invoked.rawOutput, FINALIZATION_ALLOWED_TYPES);
    if (validation.status === "invalid") {
      warnings.push(`agent_step_invalid:${validation.reason}`);
      if (attempt < FINALIZATION_MAX_ATTEMPTS - 1) continue;
      warnings.push("agent_loop_finalization_failed");
      return finalize("invalid_output");
    }

    const step = validation.step;
    steps.push({ stepIndex: steps.length, step, governance: null, observation: null, phase: "finalization" });

    if (step.type === "respond") {
      return respondedResult(step);
    }
    if (step.type === "handoff") {
      return { ran: true, terminalReason: "handoff", steps, toolExecutionCount, finalMessage: null, handoffReason: step.reason, warnings, finalPendingCatalogAction: null };
    }
  }

  // Unreachable (the loop above always returns), kept as a safe terminal state.
  return finalize("invalid_output");
}
