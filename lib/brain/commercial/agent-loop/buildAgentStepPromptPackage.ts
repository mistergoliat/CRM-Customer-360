import { AGENT_STEP_TYPES } from "./agentStepTypes";
import type { AgentLoopStepRecord } from "./agentStepTypes";
import type { AgentLoopProviderMessage } from "./agentLoopProviderTypes";

export type AgentLoopToolDescription = {
  name: string;
  description: string;
};

export type AgentLoopPromptInput = {
  currentTime: string;
  customerMessage: string;
  /** Whatever reduced, already-sanitized commercial context is available this turn (opportunity id/stage, need profile fields, recent messages) - never raw PII, never a full domain snapshot. */
  commercialContextSummary: Record<string, unknown>;
  availableTools: AgentLoopToolDescription[];
  /** This turn's own prior steps/observations only - never cross-turn state. */
  priorSteps: AgentLoopStepRecord[];
  stepsRemaining: number;
};

function summarizeObservation(record: AgentLoopStepRecord) {
  const step = record.step;
  return {
    step:
      step.type === "use_tool"
        ? { type: "use_tool", tool: step.tool, arguments: step.arguments }
        : step.type === "respond"
          ? { type: "respond", message: step.message }
          : { type: "handoff", reason: step.reason },
    observation: record.observation
  };
}

/**
 * ACS-R1-05.1-T02.1 (spec section 7). One question only: "what is the next
 * step?" - never analysis, policy assessment, rationale, a final response,
 * multiple tool requests, entity proposals, or full commercial state in the
 * same call. Deliberately much smaller than buildSalesAgentPromptPackage.ts.
 */
export function buildAgentStepPromptPackage(input: AgentLoopPromptInput): { messages: AgentLoopProviderMessage[] } {
  const systemInstructions = [
    "You are the Sales Agent for PesasChile AI Hub, deciding one step at a time.",
    "You may only: request one read-only tool, respond to the customer, or hand off to a human.",
    "You must never invent product, price, stock, or delivery information not returned by a tool.",
    "You must never claim to have executed anything yourself - the platform executes tools, not you.",
    `Available tools: ${input.availableTools.map((tool) => `${tool.name} - ${tool.description}`).join("; ") || "none"}.`,
    `Steps remaining this turn: ${input.stepsRemaining}.`,
    "Return exactly one JSON object matching AgentStep, nothing else, no markdown fence.",
    'AgentStep shapes: {"type":"use_tool","tool":"<tool name>","arguments":{...}} | {"type":"respond","message":"..."} | {"type":"handoff","reason":"..."}.',
    `type must be one of: ${AGENT_STEP_TYPES.join(", ")}.`
  ].join("\n");

  const userPayload = {
    currentTime: input.currentTime,
    customerMessage: input.customerMessage,
    commercialContext: input.commercialContextSummary,
    priorStepsThisTurn: input.priorSteps.map(summarizeObservation),
    question: "What is the single next AgentStep?"
  };

  return {
    messages: [
      { role: "system", content: systemInstructions },
      { role: "user", content: JSON.stringify(userPayload) }
    ]
  };
}
