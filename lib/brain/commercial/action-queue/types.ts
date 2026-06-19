import type { PoolConnection } from "mysql2/promise";
import type {
  CommercialActionApprovalRequirement as BaseCommercialActionApprovalRequirement,
  CommercialActionRiskLevel as BaseCommercialActionRiskLevel,
  CommercialActionStatus
} from "../action-lifecycle";
import type {
  SandboxAutonomyConfig,
  SandboxAutonomyEvaluationResult,
  SandboxAutonomyEligibilityStatus
} from "../autonomy-sandbox";
import type { CommercialChannelReference } from "../types";
import type { CommercialNextAction } from "../operational-loop";
import type { CommercialFollowUpPlan } from "../follow-up-planner";

export type CommercialAgentActionQueueFeatureFlags = {
  queueEnabled: boolean;
  persistenceEnabled: boolean;
};

export type CommercialAgentActionType =
  | "send_whatsapp_reply"
  | "schedule_followup"
  | "create_internal_task"
  | "prepare_quote_draft"
  | "take_over_case"
  | "pause_ai"
  | "request_more_context"
  | "mark_lost_candidate"
  | "no_action";

export type CommercialAgentActionChannel = CommercialChannelReference["channel"] | "internal";

export type CommercialAgentActionApprovalRequirement = BaseCommercialActionApprovalRequirement | "explicit_operator_approval";

export type CommercialAgentActionRiskLevel = BaseCommercialActionRiskLevel | "critical" | "unknown" | "blocked";

export type CrmAgentAction = {
  id: number | null;
  actionId: string;
  idempotencyKey: string;

  opportunityId: number | string | null;
  decisionId: string | null;
  decisionRowId: number | null;

  conversationCaseId: number | string | null;
  messageId: string | null;
  waId: string | null;
  channel: CommercialAgentActionChannel;

  actionType: CommercialAgentActionType;
  status: CommercialActionStatus;

  riskLevel: CommercialAgentActionRiskLevel;
  approvalRequirement: CommercialAgentActionApprovalRequirement;

  draftPayload: unknown | null;
  finalPayload: unknown | null;
  executionPayload: unknown | null;

  draftMessage: string | null;
  finalMessage: string | null;

  scheduledFor: string | null;
  expiresAt: string | null;

  attemptNumber: number;
  maxAttempts: number;

  blockReasons: string[];
  cancelReason: string | null;
  failureReason: string | null;

  policyStatus: string;
  policyNotes: string[];

  source: "ai_sdr" | "operator" | "system";
  createdBy: "ai" | "operator" | "system";
  approvedBy: string | null;
  approvedAt: string | null;

  executedAt: string | null;
  cancelledAt: string | null;

  outboxMessageId: number | null;

  lifecycleVersion: string | null;
  policyVersion: string | null;
  runtimeVersion: string | null;

  createdAt: string | null;
  updatedAt: string | null;
};

export type CrmAgentActionBuildContext = {
  currentTime: string | Date;
  timezone: string;
  opportunityId?: number | string | null;
  decisionId?: string | null;
  decisionRowId?: number | null;
  conversationCaseId?: number | string | null;
  messageId?: string | null;
  waId?: string | null;
  channel?: CommercialAgentActionChannel;
  scheduledFor?: string | Date | null;
  expiresAt?: string | Date | null;
  source?: CrmAgentAction["source"];
  createdBy?: CrmAgentAction["createdBy"];
  policyStatus?: string | null;
  policyVersion?: string | null;
  runtimeVersion?: string | null;
  lifecycleVersion?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | Date | null;
  attemptNumber?: number;
  maxAttempts?: number;
  metadata?: Record<string, unknown> | null;
};

export type BuildAgentActionFromFollowUpPlanInput = {
  plan: CommercialFollowUpPlan;
  context: CrmAgentActionBuildContext;
};

export type BuildAgentActionFromNextActionInput = {
  nextAction: CommercialNextAction;
  context: CrmAgentActionBuildContext;
};

export type AgentActionQueueValidationCode =
  | "valid"
  | "invalid_root"
  | "missing_required_field"
  | "invalid_enum_value"
  | "invalid_iso_timestamp"
  | "invalid_number"
  | "invalid_boolean"
  | "invalid_channel"
  | "invalid_state"
  | "execution_not_enabled_in_p1k_012a"
  | "outbox_not_allowed"
  | "unknown_issue";

export type ValidateAgentActionResult = {
  valid: boolean;
  code: AgentActionQueueValidationCode;
  reason: string;
  action: CrmAgentAction | null;
  warnings: string[];
};

export type PersistAgentActionStatus =
  | "skipped_by_flag"
  | "dry_run"
  | "inserted"
  | "updated_existing"
  | "duplicate_ignored"
  | "failed";

export type PersistAgentActionResult = {
  status: PersistAgentActionStatus;
  action: CrmAgentAction;
  rowId: number | null;
  error: string | null;
  dryRun: boolean;
  warnings: string[];
};

export type LoadAgentActionsInput = {
  opportunityId?: number | string | null;
  conversationCaseId?: number | string | null;
  waId?: string | null;
  status?: string | string[] | null;
  actionType?: string | string[] | null;
  limit?: number;
  queueEnabled?: boolean;
};

export type LoadAgentActionsStatus = "loaded" | "unavailable" | "error";

export type LoadAgentActionsResult = {
  status: LoadAgentActionsStatus;
  actions: CrmAgentAction[];
  warnings: string[];
  error: string | null;
  totalCount: number;
  limit: number;
};

export type AgentActionQueueConnection = Pick<PoolConnection, "execute" | "beginTransaction" | "commit" | "rollback">;

export type AgentActionQueueDatabaseAdapter = {
  hasTable?(tableName: string): Promise<boolean>;
  queryRows?<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  withConnection?<T>(fn: (connection: AgentActionQueueConnection) => Promise<T>): Promise<T>;
};

export const ACTION_QUEUE_VIEW_MODEL_STATUSES = ["available", "preview_only", "empty", "unavailable", "error"] as const;
export type ActionQueueViewModelStatus = (typeof ACTION_QUEUE_VIEW_MODEL_STATUSES)[number];

export const ACTION_QUEUE_VIEW_MODEL_ORIGINS = ["persisted", "preview", "mixed", "none"] as const;
export type ActionQueueViewModelOrigin = (typeof ACTION_QUEUE_VIEW_MODEL_ORIGINS)[number];

export const ACTION_QUEUE_ITEM_SOURCES = ["crm_agent_actions", "next_action_json", "follow_up_planner"] as const;
export type ActionQueueItemSource = (typeof ACTION_QUEUE_ITEM_SOURCES)[number];

export type ActionQueueItemViewModel = {
  actionId: string;
  actionType: string;
  status: string;
  riskLevel: string;
  approvalRequirement: string;
  draftMessage: string | null;
  scheduledFor: string | null;
  blockReasons: string[];
  cancelReason: string | null;
  rationale: string | null;
  idempotencyKey: string | null;
  persisted: boolean;
  executable: false;
  source: ActionQueueItemSource;
  sandboxAutonomy: SandboxAutonomyEvaluationResult;
};

export type ActionQueueViewModelDiagnostics = {
  tableAvailable: boolean | null;
  permissionError: boolean;
  usedPreviewFallback: boolean;
  source: string;
};

export type ActionQueueViewModel = {
  status: ActionQueueViewModelStatus;
  origin: ActionQueueViewModelOrigin;
  actions: ActionQueueItemViewModel[];
  diagnostics: ActionQueueViewModelDiagnostics;
  sandboxAutonomy: {
    status: SandboxAutonomyEligibilityStatus;
    note: string;
  };
  disabledReason: string | null;
  error: string | null;
  observedAt: string | null;
};

export type ActionQueueBuildInput = {
  caseId: string | number;
  caseRow: Record<string, unknown>;
  sourceQueue?: Record<string, unknown> | null;
  commercialOperationalResult?: unknown;
  commercialShadowReview?: unknown;
  currentTime?: string | Date | null;
  timezone?: string | null;
  limit?: number;
  adapter?: AgentActionQueueDatabaseAdapter | null;
  sandboxAutonomyConfig?: SandboxAutonomyConfig | null;
};
