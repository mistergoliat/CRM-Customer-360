import type { ExecutionGateBlockReason, ExecutionGateStatus } from "./types";

export const COMMERCIAL_EXECUTION_GATE_VERSION = "brain.commercial.execution-gate.v1" as const;

export const EXECUTION_GATE_STATUSES = [
  "allowed",
  "blocked",
  "disabled",
  "duplicate",
  "expired",
  "invalid",
  "failed"
] as const satisfies readonly ExecutionGateStatus[];

export const EXECUTION_GATE_BLOCK_REASONS = [
  "execution_gate_disabled",
  "sandbox_not_eligible",
  "action_not_found",
  "action_not_ready",
  "unsupported_action_type",
  "invalid_lifecycle_transition",
  "risk_not_allowed",
  "approval_not_satisfied",
  "human_owner_active",
  "ai_blocked",
  "case_closed",
  "missing_idempotency_key",
  "missing_recipient",
  "missing_message",
  "unsafe_message",
  "action_expired",
  "duplicate_execution",
  "conflicting_action",
  "policy_blocked",
  "outbox_command_invalid",
  "repository_failure",
  "transaction_failure"
] as const satisfies readonly ExecutionGateBlockReason[];

export const EXECUTION_GATE_SUPPORTED_ACTION_TYPES = [
  "send_whatsapp_reply",
  "request_more_context"
] as const;

export const EXECUTION_GATE_ALLOWED_ACTION_STATUSES = ["approved", "planned", "proposed"] as const;

export const EXECUTION_GATE_SUPPORTED_CHANNEL = "whatsapp" as const;
export const EXECUTION_GATE_SUPPORTED_COMMAND_TYPE = "whatsapp_text" as const;
export const EXECUTION_GATE_ALLOWED_RISK_LEVEL = "low" as const;
export const EXECUTION_GATE_ALLOWED_APPROVAL_REQUIREMENT = "none" as const;
export const EXECUTION_GATE_ALLOWED_LIFECYCLE_TRANSITIONS = [
  "proposed->planned",
  "approved->planned"
] as const;
