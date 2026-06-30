import { createHash } from "node:crypto";
import { buildAgentSystemPrompt } from "./prompt";
import { evaluateProposedAction } from "./policy";
import { loadOrInitAgentConversationState, recordAgentTurn, saveAgentConversationState } from "./state";
import type { AgentProvider, AgentProviderMessage } from "./provider/types";
import { toProviderToolSpecs } from "./tools/registry";
import type { AgentToolContext, AgentToolDefinition } from "./tools/types";
import type {
  AgentCompletedAction,
  AgentConversationState,
  AgentFinalDecision,
  AgentPendingAction,
  AgentToolCallRecord,
  AgentTurnInput,
  AgentTurnResult
} from "./types";

export type AgentLoopDependencies = {
  provider: AgentProvider;
  registry: Map<string, AgentToolDefinition>;
  maxIterations?: number;
};

const DEFAULT_MAX_ITERATIONS = 6;

function stableTurnId(input: AgentTurnInput) {
  const digest = createHash("sha256").update(`${input.conversationId}|${input.messageId ?? ""}|${input.correlationId}`).digest("hex");
  return `turn-${digest.slice(0, 24)}`;
}

function appendPendingOrCompleted(state: AgentConversationState, toolName: string, args: Record<string, unknown>, output: unknown, currentTime: string) {
  if (toolName === "create_follow_up_action") {
    const pending: AgentPendingAction = {
      id: createHash("sha256").update(`${state.conversationId}|follow_up|${currentTime}`).digest("hex").slice(0, 16),
      type: "follow_up",
      summary: typeof args.reason === "string" ? args.reason : "follow up",
      createdAt: currentTime
    };
    state.pendingActions = [...state.pendingActions.filter((action) => action.type !== "follow_up"), pending];
    return;
  }
  if (toolName === "create_or_update_opportunity" || toolName === "request_human_handoff") {
    const completed: AgentCompletedAction = {
      id: createHash("sha256").update(`${state.conversationId}|${toolName}|${currentTime}`).digest("hex").slice(0, 16),
      type: toolName,
      summary: typeof args.summary === "string" ? args.summary : typeof args.reason === "string" ? args.reason : toolName,
      outcome: JSON.stringify(output).slice(0, 500),
      completedAt: currentTime
    };
    state.completedActions = [...state.completedActions, completed];
  }
}

function isQuestion(message: string) {
  return message.trim().endsWith("?");
}

/**
 * The real observe -> reason -> act -> observe -> replan loop. Bounded by
 * maxIterations so a confused provider cannot loop forever; hitting the
 * bound is a safe-exit (ADR-001/ADR-007 pattern: max replanning attempts end
 * in a safe, honest message and a visible incomplete state, never silence).
 */
export async function runCommercialAgentTurn(input: AgentTurnInput, deps: AgentLoopDependencies): Promise<AgentTurnResult> {
  const maxIterations = deps.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const turnId = stableTurnId(input);
  const startedAt = input.currentTime;

  const { state: loadedState } = await loadOrInitAgentConversationState(input.conversationId, { toolset: "sales" });
  const state: AgentConversationState = { ...loadedState };

  const toolSpecs = toProviderToolSpecs(deps.registry);
  const toolContext: AgentToolContext = {
    conversationId: input.conversationId,
    conversationPublicId: input.conversationPublicId,
    customerMasterId: input.customerMasterId,
    waId: null,
    currentTime: input.currentTime,
    correlationId: input.correlationId,
    state
  };

  const messages: AgentProviderMessage[] = [
    { role: "system", content: buildAgentSystemPrompt({ state, currentTime: input.currentTime }) },
    { role: "user", content: input.messageText }
  ];

  const toolCalls: AgentToolCallRecord[] = [];
  const warnings: string[] = [];
  let finalDecision: AgentFinalDecision = "blocked_no_progress";
  let responseText: string | null = null;
  let modelName = deps.provider.name;
  let iterations = 0;

  for (; iterations < maxIterations; iterations += 1) {
    const result = await deps.provider.complete({ messages, tools: toolSpecs, temperature: 0.2 });
    modelName = result.modelName;
    const decision = result.decision;

    if (decision.type === "malformed") {
      warnings.push(`malformed_provider_output:${decision.error}`);
      messages.push({ role: "assistant", content: decision.raw });
      messages.push({ role: "user", content: "Your last response was not valid JSON in the expected shape. Reply again with exactly one valid JSON action." });
      continue;
    }

    if (decision.type === "tool_call") {
      const policyResult = evaluateProposedAction({ toolName: decision.toolName, args: decision.input, state, registry: deps.registry });
      messages.push({ role: "assistant", content: JSON.stringify({ action: "tool_call", tool_name: decision.toolName, input: decision.input, thought: decision.thought }) });

      if (policyResult.status !== "allowed" && policyResult.status !== "allowed_with_constraints") {
        toolCalls.push({ toolName: decision.toolName, input: decision.input, status: "denied", output: { policy: policyResult.status, reason: policyResult.reason }, durationMs: 0 });
        messages.push({ role: "tool", toolName: decision.toolName, content: JSON.stringify({ ok: false, policy: policyResult.status, reason: policyResult.reason, missingFields: policyResult.missingFields }) });
        continue;
      }

      const tool = deps.registry.get(decision.toolName);
      if (!tool) {
        toolCalls.push({ toolName: decision.toolName, input: decision.input, status: "error", output: { error: "tool_not_found" }, durationMs: 0 });
        messages.push({ role: "tool", toolName: decision.toolName, content: JSON.stringify({ ok: false, error: "tool_not_found" }) });
        continue;
      }

      const toolStartedAt = Date.now();
      const toolResult = await tool.execute(decision.input, { ...toolContext, state });
      const durationMs = Date.now() - toolStartedAt;
      toolCalls.push({ toolName: tool.name, input: decision.input, status: toolResult.ok ? "ok" : "error", output: toolResult.output ?? { error: toolResult.error }, durationMs });
      messages.push({ role: "tool", toolName: tool.name, content: JSON.stringify(toolResult.ok ? toolResult.output : { ok: false, error: toolResult.error, warnings: toolResult.warnings }) });

      if (toolResult.ok) {
        appendPendingOrCompleted(state, tool.name, decision.input, toolResult.output, input.currentTime);
        if (tool.name === "request_human_handoff") {
          state.humanOwnerActive = true;
          state.handoffMode = "internal_consultation";
        }
        if (tool.name === "create_or_update_opportunity" && typeof decision.input.summary === "string") {
          state.customerGoal = decision.input.summary;
        }
      }
      continue;
    }

    if (decision.type === "handoff") {
      // The conversation-level handoff flag is this agent's own durable state
      // and is set unconditionally: it must gate future tool calls even when
      // there is no opportunity yet to sync the handoff onto (e.g. a customer
      // asking for a human on their very first message, before any
      // commercial intent has been established).
      state.humanOwnerActive = true;
      state.handoffMode = decision.mode;
      const tool = deps.registry.get("request_human_handoff");
      if (tool) {
        const toolResult = await tool.execute({ reason: decision.reason }, { ...toolContext, state });
        toolCalls.push({ toolName: "request_human_handoff", input: { reason: decision.reason }, status: toolResult.ok ? "ok" : "error", output: toolResult.ok ? toolResult.output : { error: toolResult.error }, durationMs: 0 });
        if (toolResult.ok) {
          appendPendingOrCompleted(state, "request_human_handoff", { reason: decision.reason }, toolResult.output, input.currentTime);
        } else {
          warnings.push(`handoff_opportunity_sync_failed:${toolResult.error}`);
        }
      }
      finalDecision = "handoff";
      responseText = decision.message;
      break;
    }

    // decision.type === "respond"
    finalDecision = toolCalls.some((call) => call.status === "ok" && deps.registry.get(call.toolName)?.sideEffectLevel !== "read") ? "respond_and_act" : "respond";
    responseText = decision.message;
    if (!isQuestion(decision.message)) {
      state.unresolvedQuestions = state.unresolvedQuestions.filter((question) => question !== decision.message);
    } else if (!state.unresolvedQuestions.includes(decision.message)) {
      state.unresolvedQuestions = [...state.unresolvedQuestions, decision.message];
    }
    break;
  }

  if (!responseText) {
    warnings.push("max_iterations_reached");
    responseText = "Sigo trabajando en tu consulta y necesito un poco más de información para avanzar. ¿Puedes contarme un poco más sobre lo que buscas?";
    finalDecision = "blocked_no_progress";
  }

  state.turnCount += 1;
  state.lastTurnCorrelationId = input.correlationId;
  const completedAt = new Date().toISOString();

  await saveAgentConversationState(state, completedAt);
  await recordAgentTurn({
    turnId,
    conversationId: input.conversationId,
    inboundMessageId: input.messageId,
    correlationId: input.correlationId,
    iterations,
    toolCalls,
    finalDecision,
    responseText,
    grounded: true,
    evaluation: null,
    modelName,
    startedAt,
    completedAt
  });

  return {
    turnId,
    conversationId: input.conversationId,
    correlationId: input.correlationId,
    iterations,
    toolCalls,
    finalDecision,
    responseText,
    state,
    actionsCreated: state.completedActions.map((action) => action.id),
    modelName,
    warnings
  };
}
