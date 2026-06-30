import type { AgentToolDefinition } from "./tools/types";
import type { AgentConversationState } from "./types";

export type PolicyAutonomyLevel = 0 | 1 | 2 | 3;

export type PolicyDecisionStatus = "allowed" | "allowed_with_constraints" | "requires_approval" | "denied" | "missing_information" | "capability_unavailable";

export type PolicyEvaluationInput = {
  toolName: string;
  args: Record<string, unknown>;
  state: AgentConversationState;
  registry: Map<string, AgentToolDefinition>;
};

export type PolicyEvaluationResult = {
  status: PolicyDecisionStatus;
  level: PolicyAutonomyLevel | null;
  reason: string;
  missingFields: string[];
  constraints: string[];
};

/**
 * Level 3 (high-impact) actions are not registered as callable tools at all
 * in this MVP (discounts outside range, refunds, irreversible cancellation,
 * compensation, warranty exceptions) -- there is no capability for the agent
 * to request, so they fail closed as capability_unavailable rather than as a
 * policy decision on an action that doesn't exist yet. This list documents
 * the names a future PR would register, kept denied until a real approval
 * workflow exists.
 */
const KNOWN_HIGH_IMPACT_TOOL_NAMES = new Set([
  "apply_discount_out_of_range",
  "issue_refund",
  "cancel_order_irreversible",
  "grant_compensation",
  "grant_warranty_exception"
]);

const TOOL_LEVEL_OVERRIDES: Record<string, PolicyAutonomyLevel> = {
  request_human_handoff: 1
};

function levelForTool(tool: AgentToolDefinition): PolicyAutonomyLevel {
  if (TOOL_LEVEL_OVERRIDES[tool.name] !== undefined) return TOOL_LEVEL_OVERRIDES[tool.name];
  if (tool.sideEffectLevel === "read") return 0;
  if (tool.sideEffectLevel === "durable_write") return 2;
  return 3;
}

function findMissingRequiredFields(tool: AgentToolDefinition, args: Record<string, unknown>): string[] {
  const schema = tool.inputSchema as { required?: string[] };
  const required = Array.isArray(schema.required) ? schema.required : [];
  return required.filter((field) => {
    const value = args[field];
    return value === undefined || value === null || (typeof value === "string" && value.trim().length === 0);
  });
}

/**
 * Evaluates one proposed tool call. Does not decide commercial strategy --
 * it only validates whether this specific action, with these specific
 * arguments, is currently executable.
 */
export function evaluateProposedAction(input: PolicyEvaluationInput): PolicyEvaluationResult {
  if (KNOWN_HIGH_IMPACT_TOOL_NAMES.has(input.toolName)) {
    return {
      status: "capability_unavailable",
      level: 3,
      reason: `${input.toolName} requires a human-approval workflow that does not exist yet in this runtime.`,
      missingFields: [],
      constraints: []
    };
  }

  const tool = input.registry.get(input.toolName);
  if (!tool) {
    return {
      status: "capability_unavailable",
      level: null,
      reason: `No tool named "${input.toolName}" is registered.`,
      missingFields: [],
      constraints: []
    };
  }

  const missingFields = findMissingRequiredFields(tool, input.args);
  if (missingFields.length > 0) {
    return {
      status: "missing_information",
      level: levelForTool(tool),
      reason: `Missing required arguments for ${tool.name}: ${missingFields.join(", ")}.`,
      missingFields,
      constraints: []
    };
  }

  if (input.state.humanOwnerActive && input.state.handoffMode === "exclusive_handoff" && tool.sideEffectLevel !== "read") {
    return {
      status: "denied",
      level: levelForTool(tool),
      reason: "An exclusive human handoff is active; the agent may keep reading but not act.",
      missingFields: [],
      constraints: []
    };
  }

  const level = levelForTool(tool);
  if (level === 3) {
    return {
      status: "requires_approval",
      level,
      reason: `${tool.name} is a high-impact action and requires approval before execution.`,
      missingFields: [],
      constraints: []
    };
  }

  return {
    status: "allowed",
    level,
    reason: `${tool.name} is within the level-${level} autonomous perimeter.`,
    missingFields: [],
    constraints: []
  };
}
