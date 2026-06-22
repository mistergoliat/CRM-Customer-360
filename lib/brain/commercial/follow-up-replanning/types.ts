import type { FollowUpSchedulingReason, FollowUpSchedulingResult } from "../follow-up-scheduling";

export type FollowUpMutationPlanType =
  | "no_change"
  | "cancel_action"
  | "expire_action"
  | "block_action"
  | "replan_action"
  | "supersede_action"
  | "cancel_and_create_replacement";

export type FollowUpMutationOperationType = "update_existing_action" | "create_replacement_action" | "append_audit_event";

export type FollowUpMutationReason =
  | "customer_replied"
  | "customer_replied_after_action_created"
  | "human_owner_active"
  | "case_closed"
  | "case_requires_human"
  | "opportunity_closed_won"
  | "opportunity_closed_lost"
  | "opportunity_paused"
  | "opportunity_stage_changed"
  | "stale_action_context"
  | "follow_up_disabled"
  | "policy_blocked"
  | "risk_too_high"
  | "approval_required"
  | "action_expired"
  | "max_attempts_reached"
  | "duplicate_action"
  | "conflicting_action"
  | "cooldown_replan"
  | "business_hours_replan"
  | "recent_outbound_replan"
  | "schedule_changed"
  | "replacement_required"
  | "terminal_action_immutable"
  | "invalid_scheduling_result"
  | "missing_next_schedule"
  | "replacement_would_exceed_expiry"
  | "idempotent_plan_reused";

export type FollowUpActionPatch = {
  actionId: string;
  expectedStatuses: string[];

  nextStatus: "cancelled" | "expired" | "blocked" | "planned" | "scheduled";

  scheduledFor?: string | null;
  expiresAt?: string | null;

  cancelReason?: string | null;
  blockReasons?: string[];
  supersededByActionId?: string | null;

  updatedAt: string;
};

export type FollowUpReplacementActionDraft = {
  actionId: string;
  idempotencyKey: string;

  actionType: string;
  status: "proposed" | "planned" | "scheduled";

  opportunityId: number | string | null;
  conversationCaseId: number | string | null;
  waId: string | null;

  scheduledFor: string;
  expiresAt: string | null;

  attemptCount: number;
  maxAttempts: number;

  riskLevel: string;
  approvalRequirement: string;

  draftMessage: string | null;
  finalMessage: string | null;

  parentActionId: string;
  generation: number;

  lifecycleVersion: string | null;
  policyVersion: string | null;
  runtimeVersion: string | null;

  createdAt: string;
  updatedAt: string;
};

export type FollowUpAuditEventDraft = {
  eventId: string;
  eventType:
    | "follow_up_cancelled"
    | "follow_up_expired"
    | "follow_up_blocked"
    | "follow_up_replanned"
    | "follow_up_superseded"
    | "follow_up_replacement_created";

  actionId: string;
  replacementActionId: string | null;

  reason: FollowUpMutationReason;
  metadata: Record<string, unknown>;

  createdAt: string;
};

export type FollowUpMutationInput = {
  now: string;

  originalAction: {
    rowId: number | null;
    actionId: string;
    idempotencyKey: string | null;
    actionType: string;
    status: string;

    createdAt: string;
    updatedAt: string | null;
    scheduledFor: string | null;
    expiresAt: string | null;

    attemptCount: number;
    maxAttempts: number;

    riskLevel: string;
    approvalRequirement: string;

    opportunityId: number | string | null;
    conversationCaseId: number | string | null;
    waId: string | null;

    draftMessage: string | null;
    finalMessage: string | null;

    blockReasons: string[];
    cancelReason: string | null;

    parentActionId: string | null;
    supersededByActionId: string | null;

    lifecycleVersion: string | null;
    policyVersion: string | null;
    runtimeVersion: string | null;
  };

  schedulingResult: FollowUpSchedulingResult;

  currentContext: {
    caseStatus: string | null;
    lifecycleStatus: string | null;

    humanOwnerActive: boolean;
    aiBlocked: boolean;
    requiresHuman: boolean;

    opportunityStatus: string | null;
    opportunityStage: string | null;
    opportunityStageChangedAt: string | null;

    policyStatus: string | null;

    lastInboundAt: string | null;
    lastOutboundAt: string | null;

    conflictingActionId: string | null;
    duplicateActionId: string | null;
  };

  policy: {
    allowReplacementOnReplan: boolean;
    allowInPlaceScheduleUpdate: boolean;
    preserveOriginalAction: boolean;
    requireAuditEvent: boolean;
    resetAttemptsOnStageChange: boolean;
    incrementGenerationOnReplacement: boolean;
  };
};

export type FollowUpMutationPlan = {
  planId: string;
  planType: FollowUpMutationPlanType;

  actionId: string;
  replacementActionId: string | null;

  operations: Array<
    | {
        type: "update_existing_action";
        patch: FollowUpActionPatch;
      }
    | {
        type: "create_replacement_action";
        action: FollowUpReplacementActionDraft;
      }
    | {
        type: "append_audit_event";
        event: FollowUpAuditEventDraft;
      }
  >;

  reasons: FollowUpMutationReason[];
  warnings: string[];

  idempotency: {
    planKey: string;
    deterministic: true;
  };

  sideEffects: {
    databaseWritten: false;
    actionMutated: false;
    actionInserted: false;
    outboxWritten: false;
    messageSent: false;
    workerTriggered: false;
  };

  createdAt: string;
};

export type FollowUpMutationValidationResult = {
  valid: boolean;
  reason: string;
  warnings: string[];
  plan: FollowUpMutationPlan | null;
};

export type FollowUpMutationMemoryAction = {
  rowId: number | null;
  actionId: string;
  idempotencyKey: string | null;
  actionType: string;
  status: string;
  scheduledFor: string | null;
  expiresAt: string | null;
  attemptCount: number;
  maxAttempts: number;
  riskLevel: string;
  approvalRequirement: string;
  opportunityId: number | string | null;
  conversationCaseId: number | string | null;
  waId: string | null;
  draftMessage: string | null;
  finalMessage: string | null;
  blockReasons: string[];
  cancelReason: string | null;
  supersededByActionId: string | null;
  parentActionId: string | null;
  generation: number | null;
  lifecycleVersion: string | null;
  policyVersion: string | null;
  runtimeVersion: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export type FollowUpMutationMemoryState = {
  actions: FollowUpMutationMemoryAction[];
  auditEvents: FollowUpAuditEventDraft[];
  appliedPlanKeys: string[];
};

export type FollowUpMutationApplyResult = {
  applied: boolean;
  duplicate: boolean;
  conflict: boolean;
  rolledBack: boolean;

  previousState: FollowUpMutationMemoryState;
  nextState: FollowUpMutationMemoryState;

  appliedOperationCount: number;
  error: string | null;
};

export type FollowUpMutationReasonSource = FollowUpSchedulingReason | "invalid";
