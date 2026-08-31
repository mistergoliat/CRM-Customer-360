import type { AgentStepUseTool } from "../agent-loop/agentStepTypes";
import { resolveAgentCapabilityExposure } from "../agent-capability-exposure/types";
import { buildReadToolRequestId } from "./requestIdentity";
import type { ReadToolRequest } from "./types";

// SALES-AGENT-R3-A04, Phase 7. Adapts an already-authorized ATL use_tool step
// into a ReadToolRequest - mirrors commercial-action-request/atlAdapter.ts
// exactly. Returns null when this boundary does not apply: conversationId is
// unavailable (matches the existing CommercialActionRequest fallback - the
// caller keeps calling executeGovernedCapability directly, e.g. a benchmark/
// test harness with no real conversation), or the tool is not classified
// READ_TOOL (a COMMERCIAL_ACTION tool routes through the other adapter; a
// NOT_AGENT_EXPOSED tool must never reach this function at all - the caller
// fails it closed before either adapter is consulted).
//
// Runs strictly AFTER processUseToolStep's own dedupe/evidence checks, same
// as the CommercialActionRequest adapter - preserves existing customer-
// visible behavior exactly.

export type AtlReadToolRequestSourceInput = {
  step: AgentStepUseTool;
  conversationId: number | null;
  opportunityId: number | null;
  correlationId: string;
  inboundMessageId: string | null;
  now?: () => Date;
};

export function buildReadToolRequestFromAtlStep(input: AtlReadToolRequestSourceInput): ReadToolRequest | null {
  if (input.conversationId === null) return null;
  if (resolveAgentCapabilityExposure(input.step.tool) !== "READ_TOOL") return null;

  const causationId = input.inboundMessageId ?? null;
  const createdAt = (input.now ?? (() => new Date()))().toISOString();

  return {
    requestId: buildReadToolRequestId({ conversationId: input.conversationId, causationId, tool: input.step.tool, input: input.step.arguments }),
    conversationId: input.conversationId,
    opportunityId: input.opportunityId,
    correlationId: input.correlationId,
    causationId,
    tool: input.step.tool,
    input: input.step.arguments,
    createdAt
  };
}
