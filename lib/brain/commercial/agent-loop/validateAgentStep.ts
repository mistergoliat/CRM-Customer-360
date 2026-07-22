import { AGENT_STEP_TYPES, type AgentStep, type AgentStepType } from "./agentStepTypes";

const MAX_MESSAGE_LENGTH = 2000;
const MAX_REASON_LENGTH = 500;
const MAX_ARGUMENTS_BYTES = 4096;
const MAX_TOOL_NAME_LENGTH = 100;

export type AgentStepValidationResult =
  | { status: "valid"; step: AgentStep }
  | { status: "invalid"; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  try {
    return JSON.stringify(value).length <= MAX_ARGUMENTS_BYTES;
  } catch {
    return false;
  }
}

/**
 * Validates one raw model output against the AgentStep contract's shape
 * only - each variant is checked independently and completely, and there is
 * no shared "document" a failure in one variant can contaminate, by
 * construction of the discriminated union (see ACS-R1-05.1-T02.1 recon: the
 * older SalesAgentOutput contract lost valid toolRequests to unrelated
 * section failures because it validated one monolithic document; this
 * contract has exactly one active shape per call).
 *
 * Deliberately does NOT check `tool` against the Capability Registry/pool -
 * that is a governance decision, not a shape/format one (spec section 11:
 * an unregistered tool gets a `blocked` observation the model can replan
 * from, never the "invalid output" format-retry path). See
 * runAgentToolLoop.ts for where that check happens.
 *
 * `allowedTypes` restricts which of the three variants are acceptable for
 * this call - used by the loop's finalization phase (tools exhausted) to
 * require `respond`/`handoff` only. A `use_tool` step is then rejected here,
 * as an ordinary format/shape problem consuming the finalization retry -
 * never a separate governance concept.
 */
export function validateAgentStep(raw: unknown, allowedTypes: readonly AgentStepType[] = AGENT_STEP_TYPES): AgentStepValidationResult {
  if (!isRecord(raw)) {
    return { status: "invalid", reason: "AgentStep root must be a plain object." };
  }

  const type = raw.type;
  if (type !== "use_tool" && type !== "respond" && type !== "handoff") {
    return { status: "invalid", reason: "AgentStep.type must be use_tool, respond, or handoff." };
  }
  if (!allowedTypes.includes(type)) {
    return { status: "invalid", reason: `AgentStep.type "${type}" is not allowed in this context (allowed: ${allowedTypes.join(", ")}).` };
  }

  if (type === "use_tool") {
    const tool = raw.tool;
    if (typeof tool !== "string" || !tool.trim() || tool.length > MAX_TOOL_NAME_LENGTH) {
      return { status: "invalid", reason: "AgentStep.tool is required for use_tool." };
    }
    const args = raw.arguments;
    if (args !== undefined && !isPlainObject(args)) {
      return { status: "invalid", reason: "AgentStep.arguments must be a small plain object." };
    }
    return { status: "valid", step: { type: "use_tool", tool: tool.trim(), arguments: (args as Record<string, unknown>) ?? {} } };
  }

  if (type === "respond") {
    const message = raw.message;
    if (typeof message !== "string" || !message.trim()) {
      return { status: "invalid", reason: "AgentStep.message is required for respond." };
    }
    const trimmed = message.trim().slice(0, MAX_MESSAGE_LENGTH);
    return { status: "valid", step: { type: "respond", message: trimmed } };
  }

  const reason = raw.reason;
  if (typeof reason !== "string" || !reason.trim()) {
    return { status: "invalid", reason: "AgentStep.reason is required for handoff." };
  }
  return { status: "valid", step: { type: "handoff", reason: reason.trim().slice(0, MAX_REASON_LENGTH) } };
}
