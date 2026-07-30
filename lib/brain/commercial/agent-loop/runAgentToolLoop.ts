import { executeGovernedCapability } from "../capability-gateway/executeCapability";
import { resolveCapabilityGatewayDefinition } from "../capability-gateway/registry";
import type { CapabilityGatewayContext } from "../capability-gateway/types";
import type { NativeCustomerSessionExecutionContext } from "../native-cycle/customer-session/types";
import { SALES_AGENT_CONFIGURATION_SAFE_DEFAULT, type SalesAgentPromptConfiguration } from "../sales-agent-configuration";
import { buildAgentStepPromptPackage, type AgentLoopToolDescription } from "./buildAgentStepPromptPackage";
import { buildToolObservation } from "./buildToolObservation";
import { validateAgentStep } from "./validateAgentStep";
import type { AgentLoopProvider } from "./agentLoopProviderTypes";
import type { AgentLoopProviderFailure, AgentLoopResult, AgentLoopStepRecord, AgentLoopTerminalReason, AgentStepRespond, AgentStepUseTool, PendingCatalogActionStep, ToolObservation } from "./agentStepTypes";
import type { RecentCatalogContext } from "./recentCatalogContext";
import { classifyAgentLoopProviderFailure, logAgentLoopProviderFailure } from "./providers/providerFailureClassification";
import { normalizePendingCatalogActionForEvidence } from "./pendingCatalogAction";

/**
 * ACS-R1-05.1-T02.1 (spec section 5). Fixed, backend-owned pool - never
 * derived from LLM output, never a second registry. batch_get_products is
 * deliberately excluded: it is internal, deterministic hydration, never a
 * decision the agent makes for itself.
 *
 * ACS-R1-05.1-T02.6 added `explore_catalog` (extremes/top-N/rankings/filtered
 * browse) alongside the original three - an intentional expansion of this
 * pool, not a replacement; every pre-existing tool name is preserved.
 */
export const AGENT_LOOP_TOOL_POOL = ["search_products", "get_product_details", "search_company_knowledge", "explore_catalog"] as const;
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
  warnings: string[]
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
    const finalPendingCatalogAction = pendingCatalogActionTerminalFailure ? null : (normalizedPendingCatalogAction.pendingCatalogAction ?? null);
    if (input.pendingCatalogAction) {
      warnings.push(
        finalPendingCatalogAction
          ? `pending_catalog_action_renewed:${finalPendingCatalogAction.actionType}:${finalPendingCatalogAction.candidateProductIds.length}`
          : `pending_catalog_action_consumed:${input.pendingCatalogAction.actionType}`
      );
    }
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

    const result = await processUseToolStep(step, input.commercialContextSummary, executedCalls, gatewayContext, warnings);
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
