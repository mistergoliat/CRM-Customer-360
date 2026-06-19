import type { CommercialActionStatus } from "../action-lifecycle";
import type {
  CommercialAgentActionQueueFeatureFlags,
  PersistAgentActionStatus,
  LoadAgentActionsStatus,
  AgentActionQueueValidationCode,
  CommercialAgentActionType,
  CommercialAgentActionApprovalRequirement,
  CommercialAgentActionRiskLevel,
  CommercialAgentActionChannel
} from "./types";

export const COMMERCIAL_AGENT_ACTION_QUEUE_VERSION = "brain.commercial.action-queue.v1" as const;
export const CRM_AGENT_ACTIONS_TABLE = "crm_agent_actions" as const;

export const BRAIN_AGENT_ACTION_QUEUE_ENABLED = "BRAIN_AGENT_ACTION_QUEUE_ENABLED" as const;
export const BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED = "BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED" as const;

export const COMMERCIAL_AGENT_ACTION_QUEUE_DEFAULT_FEATURE_FLAGS: CommercialAgentActionQueueFeatureFlags = {
  queueEnabled: false,
  persistenceEnabled: false
};

export const COMMERCIAL_AGENT_ACTION_TYPES = [
  "send_whatsapp_reply",
  "schedule_followup",
  "create_internal_task",
  "prepare_quote_draft",
  "take_over_case",
  "pause_ai",
  "request_more_context",
  "mark_lost_candidate",
  "no_action"
] as const satisfies readonly CommercialAgentActionType[];

export const COMMERCIAL_AGENT_ACTION_STATUSES = [
  "draft",
  "proposed",
  "requires_review",
  "approved",
  "rejected",
  "edited",
  "blocked",
  "planned",
  "scheduled",
  "executing",
  "executed",
  "failed",
  "cancelled",
  "expired"
] as const satisfies readonly CommercialActionStatus[];

export const COMMERCIAL_AGENT_ACTION_APPROVAL_REQUIREMENTS = [
  "none",
  "operator_review",
  "manager_review",
  "blocked",
  "explicit_operator_approval"
] as const satisfies readonly CommercialAgentActionApprovalRequirement[];

export const COMMERCIAL_AGENT_ACTION_RISK_LEVELS = ["low", "medium", "high", "critical", "unknown", "blocked"] as const satisfies readonly CommercialAgentActionRiskLevel[];

export const COMMERCIAL_AGENT_ACTION_CHANNELS = ["whatsapp", "email", "web", "phone", "pos", "hub", "campaign", "legacy", "internal", "unknown"] as const satisfies readonly CommercialAgentActionChannel[];

export const COMMERCIAL_AGENT_ACTION_QUEUE_VALIDATION_CODES = [
  "valid",
  "invalid_root",
  "missing_required_field",
  "invalid_enum_value",
  "invalid_iso_timestamp",
  "invalid_number",
  "invalid_boolean",
  "invalid_channel",
  "invalid_state",
  "execution_not_enabled_in_p1k_012a",
  "outbox_not_allowed",
  "unknown_issue"
] as const satisfies readonly AgentActionQueueValidationCode[];

export const COMMERCIAL_AGENT_ACTION_QUEUE_PERSIST_STATUS = [
  "skipped_by_flag",
  "dry_run",
  "inserted",
  "updated_existing",
  "duplicate_ignored",
  "failed"
] as const satisfies readonly PersistAgentActionStatus[];

export const COMMERCIAL_AGENT_ACTION_QUEUE_LOAD_STATUS = ["loaded", "unavailable", "error"] as const satisfies readonly LoadAgentActionsStatus[];

export const COMMERCIAL_AGENT_ACTION_QUEUE_TERMINAL_STATUSES = ["blocked", "rejected", "cancelled", "expired", "executed", "failed"] as const;
export const COMMERCIAL_AGENT_ACTION_QUEUE_EXECUTION_BLOCKED_STATUSES = ["executing", "executed"] as const;

export const COMMERCIAL_AGENT_ACTION_QUEUE_MAX_LIMIT = 100;
export const COMMERCIAL_AGENT_ACTION_QUEUE_DEFAULT_LIMIT = 50;
export const COMMERCIAL_AGENT_ACTION_QUEUE_VIEW_MODEL_MAX_ITEMS = 12;
export const COMMERCIAL_AGENT_ACTION_QUEUE_MAX_TEXT_LENGTH = 2000;
export const COMMERCIAL_AGENT_ACTION_QUEUE_MAX_NOTES = 12;
export const COMMERCIAL_AGENT_ACTION_QUEUE_MAX_BLOCK_REASONS = 8;
