import type {
  CommercialIntent,
  CommercialPriority,
  CommercialSignal,
  CommercialTemperature,
  LeadReadModel,
  LeadSource,
  LeadStatus,
  OpportunityObjection,
  OpportunityStage,
  OpportunityStatus,
} from "./types";

export type FollowUpPlanId = string;

export type FollowUpPlanStatus =
  | "proposed"
  | "pending_approval"
  | "approved"
  | "scheduled"
  | "due"
  | "executed"
  | "skipped"
  | "suppressed"
  | "expired"
  | "cancelled"
  | "completed";

export type FollowUpEligibilityStatus =
  | "eligible"
  | "not_yet_eligible"
  | "suppressed"
  | "blocked"
  | "completed"
  | "insufficient_context";

export type FollowUpDecisionType =
  | "no_action"
  | "wait"
  | "propose_whatsapp_followup"
  | "propose_internal_task"
  | "propose_email_followup"
  | "propose_operator_review"
  | "propose_call"
  | "pause_contact"
  | "mark_stalled_candidate"
  | "mark_lost_candidate"
  | "close_followup_plan";

export type FollowUpReason =
  | "customer_replied"
  | "awaiting_customer_reply"
  | "customer_silent"
  | "left_on_seen"
  | "quote_sent_no_reply"
  | "quote_pending_internal"
  | "clarification_needed"
  | "objection_unresolved"
  | "high_intent_inactive"
  | "delivery_deadline_near"
  | "requested_callback"
  | "requested_later_contact"
  | "operator_requested"
  | "stale_opportunity"
  | "explicit_rejection"
  | "purchase_confirmed"
  | "duplicate_contact_risk"
  | "contact_limit_reached"
  | "manual_block"
  | "insufficient_identity"
  | "insufficient_context"
  | "unknown";

export type FollowUpChannel = "whatsapp" | "internal_task" | "email" | "phone_call" | "none";

export type FollowUpUrgency = "low" | "normal" | "high" | "immediate";

export type FollowUpConfidence = "high" | "medium" | "low";

export type FollowUpApprovalRequirement =
  | "none"
  | "operator_review"
  | "explicit_operator_approval"
  | "blocked";

export type FollowUpSuppressionReason =
  | "customer_opted_out"
  | "explicit_rejection"
  | "manual_block"
  | "contact_limit_reached"
  | "duplicate_active_plan"
  | "recent_customer_reply"
  | "recent_human_contact"
  | "opportunity_terminal"
  | "purchase_confirmed"
  | "invalid_contact"
  | "identity_conflict"
  | "channel_unavailable"
  | "quiet_hours"
  | "insufficient_context"
  | "legal_or_policy_block"
  | "unknown";

export type FollowUpAttemptOutcome =
  | "sent"
  | "delivered"
  | "read"
  | "replied"
  | "no_reply"
  | "failed"
  | "rejected"
  | "skipped"
  | "cancelled"
  | "unknown";

export type FollowUpActorReference = {
  id: string;
  type: "agent" | "operator" | "team" | "queue" | "human" | "system" | "unknown";
  displayName?: string | null;
  metadata?: Record<string, unknown>;
};

export type FollowUpContactAttempt = {
  attemptedAt: string;
  channel: FollowUpChannel;
  actor: FollowUpActorReference;
  outcome: FollowUpAttemptOutcome;
  relatedPlanId?: FollowUpPlanId | null;
  customerResponded: boolean;
  responseAt?: string | null;
  errorCode?: string | null;
  metadata?: Record<string, unknown>;
};

export type FollowUpWindow = {
  minimumDelayMinutes?: number | null;
  preferredDelayMinutes?: number | null;
  maximumDelayMinutes?: number | null;
  quietHours?: {
    start: string;
    end: string;
    timezone?: string | null;
  } | null;
  timezone?: string | null;
  businessHoursOnly?: boolean | null;
  customerRequestedAt?: string | null;
  expiresAfterMinutes?: number | null;
};

export type FollowUpPolicyLimits = {
  maxAttemptsPerOpportunity: number;
  maxAttemptsPerChannel: number;
  minimumIntervalBetweenAttemptsMinutes: number;
  maxAttemptsInRollingWindow: number;
  rollingWindowMinutes: number;
  stopAfterExplicitRejection: boolean;
  stopAfterPurchaseConfirmed: boolean;
  requireHumanAfterAttemptCount: number;
  preventDuplicateActivePlans: boolean;
};

export type FollowUpRationale = {
  summary: string;
  evidence: string[];
  counterEvidence: string[];
  assumptions: string[];
  riskFlags: string[];
  policyRulesApplied: string[];
};

export type FollowUpObservation = {
  signal: CommercialSignal;
  reason?: FollowUpReason | null;
  observedAt: string;
  channel?: FollowUpChannel | null;
  source: LeadSource | "brain" | "operator" | "system" | "unknown";
  confidence: FollowUpConfidence;
  notes?: string | null;
  metadata?: Record<string, unknown>;
};

export type FollowUpEligibility = {
  status: FollowUpEligibilityStatus;
  eligibleAt?: string | null;
  reasons: FollowUpReason[];
  suppressionReasons: FollowUpSuppressionReason[];
  requiresHumanReview: boolean;
  confidence: FollowUpConfidence;
};

export type FollowUpDecision = {
  type: FollowUpDecisionType;
  recommendedChannel: FollowUpChannel;
  urgency: FollowUpUrgency;
  confidence: FollowUpConfidence;
  requiresApproval: FollowUpApprovalRequirement;
  proposedAction: string;
  proposedMessageIntent?: string | null;
  recommendedAt?: string | null;
  expiresAt?: string | null;
  reasonCodes: FollowUpReason[];
};

export type FollowUpCustomerCandidateReference = {
  id: string;
  displayName?: string | null;
  summary?: string | null;
  confidence?: FollowUpConfidence | null;
  source?: LeadSource | "brain" | "system" | "unknown";
  metadata?: Record<string, unknown>;
};

export type FollowUpChannelAvailability = {
  whatsapp: boolean;
  internalTask: boolean;
  email: boolean;
  phoneCall: boolean;
};

export type FollowUpCommercialContext = {
  lead?: LeadReadModel | null;
  opportunity?: {
    id: string;
    status?: OpportunityStatus | null;
    stage?: OpportunityStage | null;
    primaryIntent?: CommercialIntent | null;
    temperature?: CommercialTemperature | null;
    priority?: CommercialPriority | null;
    customerMasterId?: string | null;
    customerCandidateId?: string | null;
  } | null;
  currentLeadStatus?: LeadStatus | null;
  currentOpportunityStatus?: OpportunityStatus | null;
  currentOpportunityStage?: OpportunityStage | null;
  currentIntent?: CommercialIntent | null;
  currentTemperature?: CommercialTemperature | null;
  currentPriority?: CommercialPriority | null;
  source?: LeadSource | "brain" | "operator" | "system" | "unknown";
  quoteSent?: boolean | null;
  terminal?: boolean | null;
  metadata?: Record<string, unknown>;
};

export type FollowUpPolicyOptions = Partial<FollowUpPolicyLimits> & {
  allowWhatsApp?: boolean;
  allowEmail?: boolean;
  allowCall?: boolean;
  debug?: boolean;
};

export type FollowUpDecisionInput = {
  lead?: LeadReadModel | null;
  opportunity?: {
    id: string;
    status?: OpportunityStatus | null;
    stage?: OpportunityStage | null;
    primaryIntent?: CommercialIntent | null;
    temperature?: CommercialTemperature | null;
    priority?: CommercialPriority | null;
    customerMasterId?: string | null;
    customerCandidateId?: string | null;
  } | null;
  customerCandidate?: FollowUpCustomerCandidateReference | null;
  currentTime: string;
  timezone: string;
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
  lastCustomerReplyAt?: string | null;
  lastHumanInteractionAt?: string | null;
  lastQuoteSentAt?: string | null;
  contactAttempts: FollowUpContactAttempt[];
  recentSignals: FollowUpObservation[];
  unresolvedObjections: OpportunityObjection[];
  requestedContactAt?: string | null;
  manualSuppressions?: FollowUpSuppressionReason[];
  channelAvailability: FollowUpChannelAvailability;
  commercialContext: FollowUpCommercialContext;
  policyOptions?: FollowUpPolicyOptions | null;
};

export type FollowUpPlanReadModel = {
  id: FollowUpPlanId;
  leadId?: string | null;
  opportunityId?: string | null;
  customerMasterId?: string | null;
  customerCandidateId?: string | null;
  status: FollowUpPlanStatus;
  decisionType: FollowUpDecisionType;
  channel: FollowUpChannel;
  reason: FollowUpReason;
  urgency: FollowUpUrgency;
  confidence: FollowUpConfidence;
  scheduledFor?: string | null;
  expiresAt?: string | null;
  requiresApproval: boolean;
  approvedAt?: string | null;
  approvedBy?: FollowUpActorReference | null;
  attempts: FollowUpContactAttempt[];
  createdBy: FollowUpActorReference;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
};

export type FollowUpDecisionResult = {
  eligibility: FollowUpEligibility;
  decision: FollowUpDecision;
  proposedPlan?: FollowUpPlanReadModel | null;
  rationale: FollowUpRationale;
  warnings: string[];
  metadata: Record<string, unknown>;
};
