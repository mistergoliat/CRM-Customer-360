import { validateActionLifecycleTransition } from "../action-lifecycle";
import { EXECUTION_GATE_ALLOWED_ACTION_STATUSES, EXECUTION_GATE_ALLOWED_APPROVAL_REQUIREMENT, EXECUTION_GATE_ALLOWED_RISK_LEVEL, EXECUTION_GATE_SUPPORTED_ACTION_TYPES } from "./constants";
import type { ExecutionGateBlockReason, ExecutionGateEvaluationResult, ExecutionGateInput } from "./types";

function asText(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStatus(value: string | null | undefined) {
  return asText(value)?.toLowerCase() ?? "";
}

function normalizeRisk(value: string | null | undefined) {
  return asText(value)?.toLowerCase() ?? "";
}

function normalizeApproval(value: string | null | undefined) {
  return asText(value)?.toLowerCase() ?? "";
}

function uniqueReasons(reasons: ExecutionGateBlockReason[]) {
  return [...new Set(reasons)];
}

function asIso(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function isSafeMessageCandidate(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function mapSandboxBlockReasons(input: ExecutionGateInput): ExecutionGateBlockReason[] {
  const reasons = input.sandboxEvaluation.blockReasons;
  const mapped: ExecutionGateBlockReason[] = [];

  if (reasons.includes("missing_recipient")) mapped.push("missing_recipient");
  if (reasons.includes("missing_idempotency_key")) mapped.push("missing_idempotency_key");
  if (reasons.includes("action_expired")) mapped.push("action_expired");
  if (reasons.includes("unsafe_message") || reasons.includes("unsafe_payload")) mapped.push("unsafe_message");
  if (reasons.includes("duplicate_or_conflicting_action")) mapped.push("conflicting_action");
  if (reasons.includes("approval_required")) mapped.push("approval_not_satisfied");
  if (reasons.includes("risk_too_high")) mapped.push("risk_not_allowed");
  if (reasons.includes("unsupported_action_type")) mapped.push("unsupported_action_type");
  if (reasons.includes("action_not_ready")) mapped.push("action_not_ready");
  if (reasons.includes("policy_blocked")) mapped.push("policy_blocked");
  if (reasons.includes("human_owner_active")) mapped.push("human_owner_active");
  if (reasons.includes("ai_blocked")) mapped.push("ai_blocked");
  if (reasons.includes("case_closed")) mapped.push("case_closed");
  if (reasons.includes("sandbox_disabled") || reasons.includes("autonomous_reply_disabled") || reasons.includes("recipient_not_whitelisted")) {
    mapped.push("sandbox_not_eligible");
  }

  return uniqueReasons(mapped);
}

function lifecycleTransitionIsAllowed(input: ExecutionGateInput) {
  const status = normalizeStatus(input.action.status);
  if (status === "planned") return true;
  if (status !== "proposed" && status !== "approved") return false;

  const transition = validateActionLifecycleTransition({
    fromStatus: status,
    toStatus: "planned",
    actionType: input.action.actionType,
    reviewDecision: "approve",
    currentTime: input.now,
    metadata: {
      actionId: input.action.actionId,
      sandboxModeRequired: input.config.sandboxModeRequired
    }
  });

  return transition.allowed;
}

export function evaluateExecutionGate(input: ExecutionGateInput): ExecutionGateEvaluationResult {
  const status = normalizeStatus(input.action.status);
  const actionType = asText(input.action.actionType);
  const evaluatedAt = asIso(input.now) ?? input.now;
  const warnings: string[] = [];

  if (!input.config.executionGateEnabled || !input.config.outboxBridgeEnabled) {
    warnings.push("execution_gate_or_bridge_disabled");
    return {
      status: "disabled",
      allowed: false,
      blockReasons: ["execution_gate_disabled"],
      warnings
    };
  }

  if (!asText(input.action.actionId)) {
    return {
      status: "invalid",
      allowed: false,
      blockReasons: ["action_not_found"],
      warnings
    };
  }

  if (!asText(input.action.idempotencyKey)) {
    return {
      status: "invalid",
      allowed: false,
      blockReasons: ["missing_idempotency_key"],
      warnings
    };
  }

  if (!actionType || !EXECUTION_GATE_SUPPORTED_ACTION_TYPES.includes(actionType as (typeof EXECUTION_GATE_SUPPORTED_ACTION_TYPES)[number])) {
    return {
      status: "blocked",
      allowed: false,
      blockReasons: ["unsupported_action_type"],
      warnings
    };
  }

  if (status === "expired" || (input.action.expiresAt && asIso(input.action.expiresAt) && evaluatedAt >= asIso(input.action.expiresAt)!)) {
    return {
      status: "expired",
      allowed: false,
      blockReasons: ["action_expired"],
      warnings
    };
  }

  if (status === "draft" || status === "scheduled") {
    return {
      status: "blocked",
      allowed: false,
      blockReasons: ["action_not_ready"],
      warnings
    };
  }

  if (status === "requires_review") {
    return {
      status: "blocked",
      allowed: false,
      blockReasons: ["approval_not_satisfied"],
      warnings
    };
  }

  if (["rejected", "blocked", "cancelled", "executing", "executed", "failed"].includes(status)) {
    return {
      status: "blocked",
      allowed: false,
      blockReasons: ["invalid_lifecycle_transition"],
      warnings
    };
  }

  if (input.config.sandboxModeRequired && input.sandboxEvaluation.status !== "eligible") {
    return {
      status: input.sandboxEvaluation.status === "expired" ? "expired" : "blocked",
      allowed: false,
      blockReasons: mapSandboxBlockReasons(input),
      warnings: [...input.sandboxEvaluation.warnings]
    };
  }

  if (input.context.policyStatus?.trim().toLowerCase() === "blocked" || input.context.policyStatus?.trim().toLowerCase() === "failed" || input.context.policyStatus?.trim().toLowerCase() === "failed_safe") {
    return {
      status: "blocked",
      allowed: false,
      blockReasons: ["policy_blocked"],
      warnings
    };
  }

  if (!EXECUTION_GATE_ALLOWED_ACTION_STATUSES.includes(status as (typeof EXECUTION_GATE_ALLOWED_ACTION_STATUSES)[number])) {
    return {
      status: "blocked",
      allowed: false,
      blockReasons: ["action_not_ready"],
      warnings
    };
  }

  const riskLevel = normalizeRisk(input.action.riskLevel);
  const sandboxRisk = normalizeRisk(input.sandboxEvaluation.riskLevel);
  const approvalRequirement = normalizeApproval(input.action.approvalRequirement);
  const sandboxApproval = normalizeApproval(input.sandboxEvaluation.approvalRequirement);

  if (riskLevel !== EXECUTION_GATE_ALLOWED_RISK_LEVEL || sandboxRisk !== EXECUTION_GATE_ALLOWED_RISK_LEVEL) {
    return {
      status: "blocked",
      allowed: false,
      blockReasons: ["risk_not_allowed"],
      warnings
    };
  }

  if (approvalRequirement !== EXECUTION_GATE_ALLOWED_APPROVAL_REQUIREMENT || sandboxApproval !== EXECUTION_GATE_ALLOWED_APPROVAL_REQUIREMENT) {
    return {
      status: "blocked",
      allowed: false,
      blockReasons: ["approval_not_satisfied"],
      warnings
    };
  }

  if (input.context.humanOwnerActive || input.context.requiresHuman) {
    return {
      status: "blocked",
      allowed: false,
      blockReasons: ["human_owner_active"],
      warnings
    };
  }

  if (input.context.aiBlocked) {
    return {
      status: "blocked",
      allowed: false,
      blockReasons: ["ai_blocked"],
      warnings
    };
  }

  if (input.context.caseStatus?.trim().toLowerCase() === "closed" || input.context.lifecycleStatus?.trim().toLowerCase() === "closed") {
    return {
      status: "blocked",
      allowed: false,
      blockReasons: ["case_closed"],
      warnings
    };
  }

  if (input.context.conflictingActionExists) {
    return {
      status: "blocked",
      allowed: false,
      blockReasons: ["conflicting_action"],
      warnings
    };
  }

  if (!input.sandboxEvaluation.recipientMasked) {
    return {
      status: "blocked",
      allowed: false,
      blockReasons: ["missing_recipient"],
      warnings
    };
  }

  if (!isSafeMessageCandidate(input.sandboxEvaluation.executionPreview.messagePreview)) {
    return {
      status: "blocked",
      allowed: false,
      blockReasons: ["unsafe_message"],
      warnings
    };
  }

  if (!lifecycleTransitionIsAllowed(input)) {
    return {
      status: "blocked",
      allowed: false,
      blockReasons: ["invalid_lifecycle_transition"],
      warnings
    };
  }

  if (input.action.outboxMessageId !== null) {
    return {
      status: "duplicate",
      allowed: false,
      blockReasons: ["duplicate_execution"],
      warnings
    };
  }

  if (status === "proposed") {
    warnings.push("proposed_transition_to_planned");
  }

  return {
    status: "allowed",
    allowed: true,
    blockReasons: [],
    warnings
  };
}
