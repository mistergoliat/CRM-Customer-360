import type { CrmAgentAction } from "../action-queue";
import type {
  SandboxAutonomyAgentActionContext,
  SandboxAutonomyConfig,
  SandboxAutonomyEvaluationInput,
  SandboxAutonomyEvaluationResult
} from "./types";
import { buildSandboxExecutionPreview } from "./buildSandboxExecutionPreview";
import { validateAutonomousReplyCandidate } from "./validateAutonomousReplyCandidate";

function readString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function toEvaluationInput(
  action: CrmAgentAction,
  context: SandboxAutonomyAgentActionContext,
  config: SandboxAutonomyConfig
): SandboxAutonomyEvaluationInput {
  return {
    now: context.now,
    config: {
      sandboxEnabled: config.sandboxEnabled,
      autonomousReplyEnabled: config.autonomousReplyEnabled,
      whitelistedWaIds: [...config.whitelistedWaIds],
      allowedActionTypes: [...config.allowedActionTypes],
      maxRiskLevel: config.maxRiskLevel
    },
    action: {
      actionId: action.actionId,
      idempotencyKey: readString(action.idempotencyKey),
      actionType: action.actionType,
      status: action.status,
      channel: action.channel,
      waId: readString(action.waId),
      riskLevel: action.riskLevel,
      approvalRequirement: action.approvalRequirement,
      draftMessage: readString(action.draftMessage),
      finalMessage: readString(action.finalMessage),
      scheduledFor: readString(action.scheduledFor),
      expiresAt: readString(action.expiresAt),
      blockReasons: Array.isArray(action.blockReasons) ? [...action.blockReasons] : [],
      cancelReason: readString(action.cancelReason)
    },
    context: {
      caseId: context.caseId,
      caseStatus: context.caseStatus,
      lifecycleStatus: context.lifecycleStatus,
      humanOwnerActive: context.humanOwnerActive,
      aiBlocked: context.aiBlocked,
      requiresHuman: context.requiresHuman,
      policyStatus: context.policyStatus,
      conflictingActionExists: context.conflictingActionExists
    }
  };
}

export function evaluateSandboxAutonomy(input: SandboxAutonomyEvaluationInput): SandboxAutonomyEvaluationResult {
  const validation = validateAutonomousReplyCandidate(input);

  return {
    status: validation.status,
    eligible: validation.eligible,
    actionId: validation.actionId,
    recipientMasked: validation.recipientMasked,
    blockReasons: [...validation.blockReasons],
    warnings: [...validation.warnings],
    actionType: validation.actionType,
    riskLevel: validation.riskLevel,
    approvalRequirement: validation.approvalRequirement,
    executionPreview: buildSandboxExecutionPreview(input, validation),
    evaluatedAt: validation.evaluatedAt
  };
}

export function evaluateAgentActionForSandbox(
  action: CrmAgentAction,
  context: SandboxAutonomyAgentActionContext,
  config: SandboxAutonomyConfig
): SandboxAutonomyEvaluationResult {
  return evaluateSandboxAutonomy(toEvaluationInput(action, context, config));
}
