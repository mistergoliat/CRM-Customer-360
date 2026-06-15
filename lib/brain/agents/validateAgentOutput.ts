import type { BrainError, BrainValidationResult } from "../inbound/types";
import type { BrainAgentDefinition, BrainAgentOutputEnvelope } from "./types";
import { BRAIN_TOOL_NAMES } from "../tools/types";

function error(message: string, details?: Record<string, unknown>): BrainError {
  return {
    code: "INVALID_INPUT",
    message,
    retryable: true,
    details
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDecision(value: unknown): value is BrainAgentOutputEnvelope["decision"] {
  return value === "reply" || value === "research" || value === "handoff" || value === "no_action" || value === "blocked";
}

export function validateBrainAgentOutput(
  definition: BrainAgentDefinition,
  output: BrainAgentOutputEnvelope
): BrainValidationResult<BrainAgentOutputEnvelope> {
  const errors: BrainError[] = [];

  if (!isRecord(output)) {
    return { ok: false, value: null, errors: [error("Agent output must be an object.")] };
  }

  if (output.outputSchema !== definition.outputSchema) {
    errors.push(error("outputSchema does not match the agent definition.", { expected: definition.outputSchema, received: output.outputSchema }));
  }

  if (output.agentName !== definition.name) {
    errors.push(error("agentName does not match the agent definition.", { expected: definition.name, received: output.agentName }));
  }

  if (output.agentVersion !== definition.version) {
    errors.push(error("agentVersion does not match the agent definition.", { expected: definition.version, received: output.agentVersion }));
  }

  if (!isDecision(output.decision)) {
    errors.push(error("decision is not supported by the agent runtime.", { received: output.decision }));
  }

  if (typeof output.message !== "string") {
    errors.push(error("message must be a string."));
  }

  if (typeof output.confidence !== "number" || Number.isNaN(output.confidence) || output.confidence < 0 || output.confidence > 1) {
    errors.push(error("confidence must be a number between 0 and 1.", { received: output.confidence }));
  }

  if (!Array.isArray(output.safetyFlags) || output.safetyFlags.some((item) => typeof item !== "string")) {
    errors.push(error("safetyFlags must be a string array."));
  }

  if (!Array.isArray(output.toolRequests)) {
    errors.push(error("toolRequests must be an array."));
  } else {
    for (const toolRequest of output.toolRequests) {
      if (!isRecord(toolRequest)) {
        errors.push(error("toolRequests entries must be objects."));
        continue;
      }

      if (!BRAIN_TOOL_NAMES.includes(toolRequest.toolName as (typeof BRAIN_TOOL_NAMES)[number])) {
        errors.push(error("toolRequest references an unknown tool.", { toolName: toolRequest.toolName }));
      }

      if (toolRequest.status !== "planned" && toolRequest.status !== "blocked" && toolRequest.status !== "noop") {
        errors.push(error("toolRequest status is invalid.", { toolName: toolRequest.toolName, status: toolRequest.status }));
      }

      if (!Array.isArray(toolRequest.blockedReasons) || toolRequest.blockedReasons.some((item) => typeof item !== "string")) {
        errors.push(error("toolRequest.blockedReasons must be a string array.", { toolName: toolRequest.toolName }));
      }
    }
  }

  return errors.length > 0 ? { ok: false, value: null, errors } : { ok: true, value: output, errors: [] };
}
