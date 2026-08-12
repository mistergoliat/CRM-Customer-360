import { AGENT_STEP_TYPES, type AgentStep, type AgentStepType, type PendingCatalogActionStep } from "./agentStepTypes";

const MAX_MESSAGE_LENGTH = 2000;
const MAX_REASON_LENGTH = 500;
const MAX_ARGUMENTS_BYTES = 4096;
const MAX_TOOL_NAME_LENGTH = 100;
const MAX_CANDIDATE_PRODUCT_IDS = 20;
const MAX_PRODUCT_ID_LENGTH = 100;

/**
 * Lenient by design: an optional companion field on `respond` never fails
 * the whole (otherwise valid) step over its own shape - a malformed
 * pendingCatalogAction is simply dropped (treated as "none this turn"),
 * same tolerance the rest of this validator gives to any single malformed
 * optional value.
 */
function parsePendingCatalogAction(raw: unknown): PendingCatalogActionStep | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.actionType !== "send_product_link") return undefined;
  if (!Array.isArray(raw.candidateProductIds)) return undefined;

  const candidateProductIds = raw.candidateProductIds
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0 && id.trim().length <= MAX_PRODUCT_ID_LENGTH)
    .map((id) => id.trim())
    .slice(0, MAX_CANDIDATE_PRODUCT_IDS);

  return candidateProductIds.length > 0 ? { actionType: "send_product_link", candidateProductIds } : undefined;
}

/**
 * LLM-R1-T04. Fixed, bounded classification of why validation rejected the
 * raw output - the only thing a guided-repair retry prompt is ever allowed
 * to reference (see buildAgentStepPromptPackage.ts's priorAttemptFailure).
 * Assigned at the exact same call site as the free-text `reason` below, so
 * the two can never drift apart - never inferred later by pattern-matching
 * the free-text message, which would be fragile and would have to guess at
 * a message that might change independently of this file.
 */
export const AGENT_STEP_VALIDATION_REASON_CODES = [
  /** raw is not even a plain object (e.g. an array, a primitive, null). */
  "invalid_agent_step_shape",
  /** raw.type is missing or not one of use_tool/respond/handoff. */
  "missing_or_invalid_type",
  /** raw.type is a valid AgentStep type, but not one this phase allows (e.g. use_tool during finalization). */
  "type_not_allowed_in_phase",
  /** A required field for this step type is missing/empty (tool, message, or handoff reason). */
  "missing_required_field",
  /** A field has the wrong shape/type (e.g. use_tool.arguments not a small plain object). */
  "invalid_type"
] as const;
export type AgentStepValidationReasonCode = (typeof AGENT_STEP_VALIDATION_REASON_CODES)[number];

export type AgentStepValidationResult =
  | { status: "valid"; step: AgentStep }
  | { status: "invalid"; reason: string; reasonCode: AgentStepValidationReasonCode };

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
    return { status: "invalid", reason: "AgentStep root must be a plain object.", reasonCode: "invalid_agent_step_shape" };
  }

  const type = raw.type;
  if (type !== "use_tool" && type !== "respond" && type !== "handoff") {
    return { status: "invalid", reason: "AgentStep.type must be use_tool, respond, or handoff.", reasonCode: "missing_or_invalid_type" };
  }
  if (!allowedTypes.includes(type)) {
    return {
      status: "invalid",
      reason: `AgentStep.type "${type}" is not allowed in this context (allowed: ${allowedTypes.join(", ")}).`,
      reasonCode: "type_not_allowed_in_phase"
    };
  }

  if (type === "use_tool") {
    const tool = raw.tool;
    if (typeof tool !== "string" || !tool.trim() || tool.length > MAX_TOOL_NAME_LENGTH) {
      return { status: "invalid", reason: "AgentStep.tool is required for use_tool.", reasonCode: "missing_required_field" };
    }
    const args = raw.arguments;
    if (args !== undefined && !isPlainObject(args)) {
      return { status: "invalid", reason: "AgentStep.arguments must be a small plain object.", reasonCode: "invalid_type" };
    }
    return { status: "valid", step: { type: "use_tool", tool: tool.trim(), arguments: (args as Record<string, unknown>) ?? {} } };
  }

  if (type === "respond") {
    const message = raw.message;
    if (typeof message !== "string" || !message.trim()) {
      return { status: "invalid", reason: "AgentStep.message is required for respond.", reasonCode: "missing_required_field" };
    }
    const trimmed = message.trim().slice(0, MAX_MESSAGE_LENGTH);
    const pendingCatalogAction = parsePendingCatalogAction(raw.pendingCatalogAction);
    return { status: "valid", step: { type: "respond", message: trimmed, ...(pendingCatalogAction ? { pendingCatalogAction } : {}) } };
  }

  const reason = raw.reason;
  if (typeof reason !== "string" || !reason.trim()) {
    return { status: "invalid", reason: "AgentStep.reason is required for handoff.", reasonCode: "missing_required_field" };
  }
  return { status: "valid", step: { type: "handoff", reason: reason.trim().slice(0, MAX_REASON_LENGTH) } };
}
