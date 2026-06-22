export type FollowUpSchedulingDecision = "ready" | "wait" | "cancel" | "expire" | "replan" | "block" | "invalid";

export type FollowUpSchedulingReason =
  | "scheduled_time_reached"
  | "scheduled_time_not_reached"
  | "customer_replied"
  | "customer_replied_after_action_created"
  | "human_owner_active"
  | "ai_blocked"
  | "case_closed"
  | "case_requires_human"
  | "opportunity_closed_won"
  | "opportunity_closed_lost"
  | "opportunity_paused"
  | "opportunity_stage_changed"
  | "follow_up_not_allowed"
  | "policy_blocked"
  | "risk_too_high"
  | "approval_required"
  | "action_expired"
  | "max_attempts_reached"
  | "cooldown_active"
  | "conflicting_action"
  | "duplicate_action"
  | "missing_schedule"
  | "missing_expiry"
  | "missing_action_id"
  | "missing_idempotency_key"
  | "unsupported_action_type"
  | "invalid_action_status"
  | "invalid_timestamp"
  | "outside_business_hours"
  | "replanned_for_business_hours"
  | "replanned_after_cooldown"
  | "replanned_after_recent_outbound"
  | "stale_action_context";

export type FollowUpSchedulingActionType = "schedule_followup" | "send_followup_message" | "request_more_context";

export type FollowUpSchedulingActionStatus = "proposed" | "approved" | "planned" | "scheduled";

export type FollowUpSchedulingInput = {
  now: string;

  action: {
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

    blockReasons: string[];
    cancelReason: string | null;
  };

  activity: {
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
    lastHumanMessageAt: string | null;
    lastAiMessageAt: string | null;
  };

  context: {
    caseStatus: string | null;
    lifecycleStatus: string | null;

    humanOwnerActive: boolean;
    aiBlocked: boolean;
    requiresHuman: boolean;

    opportunityStatus: string | null;
    opportunityStage: string | null;
    opportunityStageChangedAt: string | null;

    policyStatus: string | null;
    conflictingActionExists: boolean;
    duplicateActionExists: boolean;
  };

  policy: {
    followUpEnabled: boolean;

    allowedActionTypes: string[];
    maxRiskLevel: string;

    cooldownMinutesAfterInbound: number;
    cooldownMinutesAfterOutbound: number;

    businessHoursEnabled: boolean;
    businessTimezone: string;
    businessDays: number[];
    businessStartHour: number;
    businessEndHour: number;

    replanOutsideBusinessHours: boolean;
    replanAfterCooldown: boolean;

    requireExpiry: boolean;
    maxFutureDays: number;
  };
};

export type FollowUpSchedulingTiming = {
  evaluatedAt: string;
  due: boolean;
  expired: boolean;
  cooldownUntil: string | null;
  outsideBusinessHours: boolean;
};

export type FollowUpSchedulingRetry = {
  attemptCount: number;
  maxAttempts: number;
  attemptsRemaining: number;
};

export type FollowUpSchedulingSideEffects = {
  actionUpdated: false;
  actionInserted: false;
  outboxWritten: false;
  messageSent: false;
  workerTriggered: false;
};

export type FollowUpSchedulingResult = {
  decision: FollowUpSchedulingDecision;
  actionable: boolean;

  actionId: string;
  reasons: FollowUpSchedulingReason[];
  warnings: string[];

  originalScheduledFor: string | null;
  effectiveScheduledFor: string | null;
  nextScheduledFor: string | null;

  timing: FollowUpSchedulingTiming;

  retry: FollowUpSchedulingRetry;

  sideEffects: FollowUpSchedulingSideEffects;
};

export type FollowUpSchedulingCandidate = {
  now: string;
  nowMs: number;

  actionId: string;
  idempotencyKey: string;
  actionType: FollowUpSchedulingActionType;
  status: FollowUpSchedulingActionStatus;

  createdAt: string;
  createdAtMs: number;
  updatedAt: string | null;
  updatedAtMs: number | null;

  scheduledFor: string | null;
  scheduledForMs: number | null;
  expiresAt: string | null;
  expiresAtMs: number | null;

  attemptCount: number;
  maxAttempts: number;

  riskLevel: string;
  approvalRequirement: string;

  opportunityId: number | string | null;
  conversationCaseId: number | string | null;
  waId: string | null;

  blockReasons: string[];
  cancelReason: string | null;

  activity: {
    lastInboundAt: string | null;
    lastInboundAtMs: number | null;
    lastOutboundAt: string | null;
    lastOutboundAtMs: number | null;
    lastHumanMessageAt: string | null;
    lastHumanMessageAtMs: number | null;
    lastAiMessageAt: string | null;
    lastAiMessageAtMs: number | null;
  };

  context: {
    caseStatus: string | null;
    lifecycleStatus: string | null;
    humanOwnerActive: boolean;
    aiBlocked: boolean;
    requiresHuman: boolean;
    opportunityStatus: string | null;
    opportunityStage: string | null;
    opportunityStageChangedAt: string | null;
    opportunityStageChangedAtMs: number | null;
    policyStatus: string | null;
    conflictingActionExists: boolean;
    duplicateActionExists: boolean;
  };

  policy: FollowUpSchedulingInput["policy"];
};

export type FollowUpSchedulingCandidateValidationResult = {
  valid: boolean;
  reason: FollowUpSchedulingReason;
  candidate: FollowUpSchedulingCandidate | null;
  warnings: string[];
};

export type FollowUpScheduleComputation = {
  originalScheduledFor: string | null;
  effectiveScheduledFor: string | null;
  cooldownUntil: string | null;
  outsideBusinessHours: boolean;
  reasons: FollowUpSchedulingReason[];
  scheduleChanged: boolean;
  scheduleImpossible: boolean;
};
