import type { BrainError } from "../../inbound/types";
import type { BrainKnowledgeAgentOutput, BrainKnowledgeAgentValidationResult, BrainKnowledgeAgentDecision } from "./types";

const FORBIDDEN_OPERATIONAL_TERMS = [
  "stock",
  "precio",
  "descuento",
  "garantia",
  "garantía",
  "devolucion",
  "devolución",
  "pedido",
  "armado",
  "mantencion",
  "mantención"
];

function error(message: string, details?: Record<string, unknown>): BrainError {
  return {
    code: "INVALID_INPUT",
    message,
    retryable: true,
    details
  };
}

function isDecision(value: unknown): value is BrainKnowledgeAgentDecision {
  return value === "answer" || value === "abstain" || value === "handoff_recommended" || value === "route_to_sales" || value === "route_to_sac" || value === "route_to_postventa";
}

function containsForbiddenOperationalClaims(text: string) {
  const normalized = text.toLowerCase();
  return FORBIDDEN_OPERATIONAL_TERMS.some((term) => normalized.includes(term));
}

export function validateKnowledgeAgentOutput(output: unknown): BrainKnowledgeAgentValidationResult {
  const errors: BrainError[] = [];

  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return { ok: false, value: null, errors: [error("Knowledge agent output must be an object.")] };
  }

  const draft = output as Partial<BrainKnowledgeAgentOutput>;

  if (!isDecision(draft.decision)) errors.push(error("decision is invalid."));
  if (!draft.answer_type) errors.push(error("answer_type is required."));
  if (typeof draft.confidence !== "number" || Number.isNaN(draft.confidence) || draft.confidence < 0 || draft.confidence > 1) {
    errors.push(error("confidence must be between 0 and 1."));
  }
  if (draft.decision === "answer") {
    if (!draft.message || typeof draft.message !== "string" || !draft.message.trim()) {
      errors.push(error("message is required when decision=answer."));
    }
    if (!Array.isArray(draft.sources_used) || draft.sources_used.length === 0) {
      errors.push(error("sources_used is required when decision=answer."));
    }
    if (typeof draft.message === "string" && containsForbiddenOperationalClaims(draft.message)) {
      errors.push(error("message contains forbidden operational claims."));
    }
  }
  if (!Array.isArray(draft.safety_flags) || draft.safety_flags.some((item) => typeof item !== "string")) {
    errors.push(error("safety_flags must be a string array."));
  }
  if (!Array.isArray(draft.sources_used) || draft.sources_used.some((item) => typeof item !== "string")) {
    errors.push(error("sources_used must be a string array."));
  }
  if (!Array.isArray(draft.tool_requests) || draft.tool_requests.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    errors.push(error("tool_requests must be an array of objects."));
  }
  if (!Array.isArray(draft.warnings) || draft.warnings.some((item) => typeof item !== "string")) {
    errors.push(error("warnings must be a string array."));
  }
  if (draft.confidence !== undefined && draft.confidence < 0.55 && draft.decision === "answer") {
    errors.push(error("Low-confidence output cannot be answer."));
  }

  return errors.length > 0 ? { ok: false, value: null, errors } : { ok: true, value: draft as BrainKnowledgeAgentOutput, errors: [] };
}
