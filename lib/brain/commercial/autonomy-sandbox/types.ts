import type { CrmAgentAction } from "../action-queue";

export const SANDBOX_AUTONOMY_ELIGIBILITY_STATUSES = ["eligible", "blocked", "disabled", "invalid", "expired", "requires_review"] as const;
export type SandboxAutonomyEligibilityStatus = (typeof SANDBOX_AUTONOMY_ELIGIBILITY_STATUSES)[number];

export const SANDBOX_AUTONOMY_BLOCK_REASONS = [
  "sandbox_disabled",
  "autonomous_reply_disabled",
  "recipient_not_whitelisted",
  "missing_recipient",
  "unsupported_channel",
  "unsupported_action_type",
  "risk_too_high",
  "approval_required",
  "human_owner_active",
  "ai_blocked",
  "case_closed",
  "action_expired",
  "missing_idempotency_key",
  "unsafe_payload",
  "unsafe_message",
  "unsupported_commercial_commitment",
  "duplicate_or_conflicting_action",
  "action_not_ready",
  "policy_blocked"
] as const;
export type SandboxAutonomyBlockReason = (typeof SANDBOX_AUTONOMY_BLOCK_REASONS)[number];

export type SandboxAutonomyConfig = {
  sandboxEnabled: boolean;
  autonomousReplyEnabled: boolean;
  whitelistedWaIds: string[];
  allowedActionTypes: string[];
  maxRiskLevel: string;
};

export type SandboxAutonomyEvaluationInput = {
  now: string;

  config: {
    sandboxEnabled: boolean;
    autonomousReplyEnabled: boolean;
    whitelistedWaIds: string[];
    allowedActionTypes: string[];
    maxRiskLevel: string;
  };

  action: {
    actionId: string;
    idempotencyKey: string | null;
    actionType: string;
    status: string;
    channel: string;
    waId: string | null;
    riskLevel: string;
    approvalRequirement: string;
    draftMessage: string | null;
    finalMessage: string | null;
    scheduledFor: string | null;
    expiresAt: string | null;
    blockReasons: string[];
    cancelReason: string | null;
  };

  context: {
    caseId: string | null;
    caseStatus: string | null;
    lifecycleStatus: string | null;
    humanOwnerActive: boolean;
    aiBlocked: boolean;
    requiresHuman: boolean;
    policyStatus: string | null;
    conflictingActionExists: boolean;
  };
};

export type SandboxAutonomyExecutionPreview = {
  canExecute: false;
  channel: string;
  recipientMasked: string | null;
  messagePreview: string | null;
  idempotencyKey: string | null;
};

export type SandboxAutonomyEvaluationResult = {
  status: SandboxAutonomyEligibilityStatus;
  eligible: boolean;

  actionId: string;
  recipientMasked: string | null;

  blockReasons: SandboxAutonomyBlockReason[];
  warnings: string[];

  actionType: string;
  riskLevel: string;
  approvalRequirement: string;

  executionPreview: SandboxAutonomyExecutionPreview;

  evaluatedAt: string;
};

export type SandboxAutonomyAgentActionContext = {
  now: string;
  caseId: string | null;
  caseStatus: string | null;
  lifecycleStatus: string | null;
  humanOwnerActive: boolean;
  aiBlocked: boolean;
  requiresHuman: boolean;
  policyStatus: string | null;
  conflictingActionExists: boolean;
};

export type SandboxAutonomyValidationResult = {
  status: SandboxAutonomyEligibilityStatus;
  eligible: boolean;
  actionId: string;
  recipientMasked: string | null;
  blockReasons: SandboxAutonomyBlockReason[];
  warnings: string[];
  actionType: string;
  riskLevel: string;
  approvalRequirement: string;
  messagePreview: string | null;
  evaluatedAt: string;
};

export const COMMERCIAL_SANDBOX_AUTONOMY_ALLOWED_ACTION_TYPES = [
  "send_whatsapp_reply",
  "request_more_context"
] as const;

export const COMMERCIAL_SANDBOX_AUTONOMY_ALLOWED_RISK_LEVEL = "low" as const;
export const COMMERCIAL_SANDBOX_AUTONOMY_ALLOWED_CHANNEL = "whatsapp" as const;
export const COMMERCIAL_SANDBOX_AUTONOMY_DEFAULT_MESSAGE_LIMIT = 800;

function normalizeDigits(value: string) {
  return value.replace(/\D+/g, "");
}

export function maskWaId(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const digits = normalizeDigits(value.trim());
  if (!digits) return null;
  if (digits.length <= 6) {
    if (digits.length <= 2) return "*".repeat(digits.length);
    return `${digits.slice(0, 1)}${"*".repeat(Math.max(0, digits.length - 2))}${digits.slice(-1)}`;
  }
  return `${digits.slice(0, 3)}${"*".repeat(Math.max(0, digits.length - 6))}${digits.slice(-3)}`;
}

export function normalizeWaIdDigits(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const digits = normalizeDigits(trimmed);
  return digits.length > 0 ? digits : null;
}

export function buildSandboxAutonomyConfig(overrides: Partial<SandboxAutonomyConfig> = {}): SandboxAutonomyConfig {
  return {
    sandboxEnabled: false,
    autonomousReplyEnabled: false,
    whitelistedWaIds: [],
    allowedActionTypes: [...COMMERCIAL_SANDBOX_AUTONOMY_ALLOWED_ACTION_TYPES],
    maxRiskLevel: COMMERCIAL_SANDBOX_AUTONOMY_ALLOWED_RISK_LEVEL,
    ...overrides
  };
}

export function isSandboxAutonomyAction(action: Pick<CrmAgentAction, "actionType">) {
  return (COMMERCIAL_SANDBOX_AUTONOMY_ALLOWED_ACTION_TYPES as readonly string[]).includes(action.actionType);
}
