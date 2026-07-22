import { executeGovernedCapability } from "../capability-gateway/executeCapability";
import { resolveCapabilityGatewayDefinition } from "../capability-gateway/registry";
import type { CapabilityGatewayContext } from "../capability-gateway/types";
import type { NativeCustomerSessionExecutionContext } from "../native-cycle/customer-session/types";
import { SALES_AGENT_CONFIGURATION_SAFE_DEFAULT, type SalesAgentPromptConfiguration } from "../sales-agent-configuration";
import { buildAgentStepPromptPackage, type AgentLoopToolDescription } from "./buildAgentStepPromptPackage";
import { buildToolObservation } from "./buildToolObservation";
import { validateAgentStep } from "./validateAgentStep";
import type { AgentLoopProvider } from "./agentLoopProviderTypes";
import type { AgentLoopResult, AgentLoopStepRecord, AgentLoopTerminalReason, AgentStepUseTool, ToolObservation } from "./agentStepTypes";

/**
 * ACS-R1-05.1-T02.1 (spec section 5). Fixed, backend-owned pool for this
 * MVP - never derived from LLM output, never a second registry.
 * batch_get_products is deliberately excluded: it is internal, deterministic
 * hydration, never a decision the agent makes for itself.
 */
export const AGENT_LOOP_TOOL_POOL = ["search_products", "get_product_details", "search_company_knowledge"] as const;
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
  provider: AgentLoopProvider | null;
  trustedCustomerSession?: NativeCustomerSessionExecutionContext | null;
  maxDecisions?: number;
  maxToolExecutions?: number;
  timeoutMs?: number;
  abortSignal?: AbortSignal | null;
  /** Defaults to the generic safe default (no PesasChile branding) - production callers always resolve and pass the effective one (ACS-R1-05.1-T02.3B). */
  identityConfiguration?: SalesAgentPromptConfiguration;
};

function buildToolDescriptions(): AgentLoopToolDescription[] {
  return AGENT_LOOP_TOOL_POOL.map((name) => {
    const definition = resolveCapabilityGatewayDefinition(name);
    return { name, description: definition?.description ?? name };
  });
}

async function invokeProviderWithDeadline(
  provider: AgentLoopProvider,
  messages: { role: "system" | "user"; content: string }[],
  correlationId: string,
  deadlineMs: number,
  externalSignal: AbortSignal | null | undefined
): Promise<{ kind: "success"; rawOutput: unknown } | { kind: "timeout" } | { kind: "error"; error: unknown }> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onAbort, { once: true });
  }

  const remainingMs = Math.max(1, deadlineMs - Date.now());
  const timer = setTimeout(() => controller.abort(), remainingMs);

  try {
    const response = await provider.invoke({ messages, correlationId }, { signal: controller.signal, timeoutMs: remainingMs });
    return { kind: "success", rawOutput: response.rawOutput };
  } catch (error) {
    if (controller.signal.aborted) return { kind: "timeout" };
    return { kind: "error", error };
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", onAbort);
  }
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
    return { ran: false, terminalReason: "provider_unavailable", steps: [], toolExecutionCount: 0, finalMessage: null, handoffReason: null, warnings: ["provider_unavailable"] };
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

  const finalize = (terminalReason: AgentLoopTerminalReason): AgentLoopResult => ({
    ran: true,
    terminalReason,
    steps,
    toolExecutionCount,
    finalMessage: null,
    handoffReason: null,
    warnings
  });

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
      warnings.push(`agent_loop_provider_error:${invoked.error instanceof Error ? invoked.error.message : "unknown"}`);
      return finalize("provider_unavailable");
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
      return { ran: true, terminalReason: "responded", steps, toolExecutionCount, finalMessage: step.message, handoffReason: null, warnings };
    }

    if (step.type === "handoff") {
      steps.push({ stepIndex: decisionIndex, step, governance: null, observation: null, phase: "gathering" });
      return { ran: true, terminalReason: "handoff", steps, toolExecutionCount, finalMessage: null, handoffReason: step.reason, warnings };
    }

    const result = await processUseToolStep(step, input.commercialContextSummary, executedCalls, gatewayContext, warnings);
    if (result.executed) toolExecutionCount += 1;
    steps.push({ stepIndex: decisionIndex, step: result.step, governance: result.governance, observation: result.observation, phase: "gathering" });
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
      warnings.push(`agent_loop_provider_error:${invoked.error instanceof Error ? invoked.error.message : "unknown"}`);
      return finalize("provider_unavailable");
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
      return { ran: true, terminalReason: "responded", steps, toolExecutionCount, finalMessage: step.message, handoffReason: null, warnings };
    }
    if (step.type === "handoff") {
      return { ran: true, terminalReason: "handoff", steps, toolExecutionCount, finalMessage: null, handoffReason: step.reason, warnings };
    }
  }

  // Unreachable (the loop above always returns), kept as a safe terminal state.
  return finalize("invalid_output");
}
