import { executeGovernedCapability } from "../capability-gateway/executeCapability";
import { resolveCapabilityGatewayDefinition } from "../capability-gateway/registry";
import type { CapabilityGatewayContext } from "../capability-gateway/types";
import type { NativeCustomerSessionExecutionContext } from "../native-cycle/customer-session/types";
import { buildAgentStepPromptPackage, type AgentLoopToolDescription } from "./buildAgentStepPromptPackage";
import { buildToolObservation } from "./buildToolObservation";
import { validateAgentStep } from "./validateAgentStep";
import type { AgentLoopProvider } from "./agentLoopProviderTypes";
import type { AgentLoopResult, AgentLoopStepRecord, AgentLoopTerminalReason, ToolObservation } from "./agentStepTypes";

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

/**
 * The native read-only agent tool loop (ACS-R1-05.1-T02.1). Per turn: the
 * model answers "what is the next step?" up to `maxDecisions` times, may
 * execute at most `maxToolExecutions` read-only, governed capabilities, and
 * must terminate in respond or handoff. Fail-closed on an unregistered/
 * unauthorized/duplicate tool call - the agent gets a `blocked` observation
 * and may replan, never a silent no-op and never a second identical
 * execution.
 */
export async function runAgentToolLoop(input: RunAgentToolLoopInput): Promise<AgentLoopResult> {
  const maxDecisions = input.maxDecisions ?? DEFAULT_MAX_DECISIONS;
  const maxToolExecutions = input.maxToolExecutions ?? DEFAULT_MAX_TOOL_EXECUTIONS;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
  let invalidOutputRetryUsed = false;

  const finalize = (terminalReason: AgentLoopTerminalReason): AgentLoopResult => ({
    ran: true,
    terminalReason,
    steps,
    toolExecutionCount,
    finalMessage: null,
    handoffReason: null,
    warnings
  });

  for (let decisionIndex = 0; decisionIndex < maxDecisions; decisionIndex += 1) {
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
      stepsRemaining: maxDecisions - decisionIndex
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
      if (invalidOutputRetryUsed) {
        return finalize("invalid_output");
      }
      // ACS-R1-05.1-T02.1 (spec section 11): one format retry only, no
      // complex partial-rescue system - re-run this same decision slot once.
      invalidOutputRetryUsed = true;
      decisionIndex -= 1;
      continue;
    }

    const step = validation.step;

    if (step.type === "respond") {
      steps.push({ stepIndex: decisionIndex, step, governance: null, observation: null });
      return { ran: true, terminalReason: "responded", steps, toolExecutionCount, finalMessage: step.message, handoffReason: null, warnings };
    }

    if (step.type === "handoff") {
      steps.push({ stepIndex: decisionIndex, step, governance: null, observation: null });
      return { ran: true, terminalReason: "handoff", steps, toolExecutionCount, finalMessage: null, handoffReason: step.reason, warnings };
    }

    // use_tool
    const dedupeKey = buildDedupeKey(step.tool, step.arguments);
    let observation: ToolObservation;
    let governance: AgentLoopStepRecord["governance"];

    if (!AGENT_LOOP_TOOL_POOL.includes(step.tool as AgentLoopToolName) || !resolveCapabilityGatewayDefinition(step.tool)) {
      governance = "blocked_unregistered";
      observation = { tool: step.tool, status: "blocked", errorCode: "capability_not_registered" };
      warnings.push(`agent_loop_tool_blocked_unregistered:${step.tool}`);
    } else if (executedCalls.has(dedupeKey)) {
      governance = "blocked_duplicate";
      observation = { tool: step.tool, status: "blocked", errorCode: "duplicate_tool_call" };
      warnings.push(`agent_loop_tool_blocked_duplicate:${step.tool}`);
    } else if (toolExecutionCount >= maxToolExecutions) {
      governance = "blocked_unauthorized";
      observation = { tool: step.tool, status: "blocked", errorCode: "max_tool_executions_exceeded" };
      warnings.push("agent_loop_tool_budget_exhausted");
    } else {
      governance = "authorized";
      executedCalls.add(dedupeKey);
      const gatewayResult = await executeGovernedCapability(step.tool, step.arguments, gatewayContext);
      toolExecutionCount += 1;
      observation = buildToolObservation(step.tool, gatewayResult);
    }

    steps.push({ stepIndex: decisionIndex, step, governance, observation });
  }

  warnings.push("agent_loop_max_steps_exceeded");
  return finalize("max_steps_exceeded");
}
