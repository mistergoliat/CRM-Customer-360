import { COMMERCIAL_FOLLOW_UP_DEFAULT_MAX_ATTEMPTS, type CommercialFollowUpPlanningInput } from "../follow-up-planner";
import type { SalesConsultativeOpportunity } from "./types";

// ponytail: single de-facto follow-up policy until ACS-R1-05-T02 wires a real
// configured policy source. requireOperatorReview stays false here (unlike the
// read-only case-detail preview's always-review default) so low-risk intents
// (product_interest/availability/reactivation) can reach plan.status =
// "recommended" -> action.status = "planned"; the planner already forces
// operator_review/manager_review for quote/payment/post-handoff/high-risk
// intents regardless of this flag (planFollowUp.ts#deriveApprovalRequirement).
const FOLLOW_UP_TIMEZONE = "America/Santiago";
const FOLLOW_UP_DEFAULT_DELAY_HOURS = 2;
const FOLLOW_UP_DEFAULT_COOLDOWN_HOURS = 24;

// Explicit T01 status classification for schedule_followup rows in
// crm_agent_actions. Never inferred as "anything not terminal" - an unknown
// or future status (e.g. a T02+ addition) must degrade safely by falling
// outside both sets below, not be treated as active or as consuming an
// attempt by default.
export const FOLLOW_UP_ACTIVE_ACTION_STATUSES = ["planned", "requires_review", "executing"] as const;
export type FollowUpActiveActionStatus = (typeof FOLLOW_UP_ACTIVE_ACTION_STATUSES)[number];

// A row only "consumes" a commercial attempt once contact was actually
// attempted: the worker claimed it (executing) or it reached a terminal
// outcome that required claiming it first (executed/failed). Rows that never
// got a real attempt (rejected/blocked/cancelled/expired) must not exhaust
// maxAttempts.
export const FOLLOW_UP_ATTEMPT_CONSUMING_STATUSES = ["executing", "executed", "failed"] as const;
export type FollowUpAttemptConsumingStatus = (typeof FOLLOW_UP_ATTEMPT_CONSUMING_STATUSES)[number];

export function isFollowUpActiveStatus(status: string): status is FollowUpActiveActionStatus {
  return (FOLLOW_UP_ACTIVE_ACTION_STATUSES as readonly string[]).includes(status);
}

export function isFollowUpAttemptConsumingStatus(status: string): status is FollowUpAttemptConsumingStatus {
  return (FOLLOW_UP_ATTEMPT_CONSUMING_STATUSES as readonly string[]).includes(status);
}

function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function hoursBetween(fromIso: string, toIsoValue: string | null): number {
  if (!toIsoValue) return FOLLOW_UP_DEFAULT_DELAY_HOURS;
  const from = new Date(fromIso).getTime();
  const to = new Date(toIsoValue).getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return FOLLOW_UP_DEFAULT_DELAY_HOURS;
  return Math.max(0, (to - from) / (60 * 60 * 1000));
}

// action.status: what crm_agent_actions.status becomes. Only these two plan
// statuses ever produce an executable row; every other plan.status (blocked,
// not_needed, cancelled, expired, invalid) returns null - no row is created.
export function mapFollowUpPlanStatusToActionStatus(status: string): "planned" | "requires_review" | null {
  if (status === "recommended") return "planned";
  if (status === "requires_operator_review") return "requires_review";
  return null;
}

// policy_status: intentionally a separate vocabulary from plan.status
// (crm_agent_actions.policy_status is a general column shared by every action
// type, whose other writers already use "allowed" - see upsertActionRow's
// generic path). plan.status is never persisted verbatim as policy_status.
export function mapFollowUpPlanStatusToPolicyStatus(status: string): "allowed" | "requires_review" | null {
  if (status === "recommended") return "allowed";
  if (status === "requires_operator_review") return "requires_review";
  return null;
}

export type BuildFollowUpPlanningInputArgs = {
  opportunity: SalesConsultativeOpportunity | null;
  draftMessage: string;
  dueAt: string | null;
  currentTime: string;
  priorAttemptNumber: number;
  /**
   * Overrides the canonical COMMERCIAL_FOLLOW_UP_DEFAULT_MAX_ATTEMPTS
   * (follow-up-planner/constants.ts) default. Test-only injection point -
   * production callers should omit this and get the named canonical value.
   */
  maxAttempts?: number;
};

/**
 * Translates the real sales-consultative context (opportunity already loaded
 * this turn, plus the cadence hint it proposed) into the canonical
 * CommercialFollowUpPlanningInput. Does not read the DB itself and does not
 * duplicate planCommercialFollowUp's attempt/cooldown/status calculation -
 * `dueAt` only becomes `policy.defaultDelayHours`, a hint the planner may use
 * or override; `plan.scheduledFor` remains the only persisted schedule.
 */
export function buildFollowUpPlanningInput(input: BuildFollowUpPlanningInputArgs): CommercialFollowUpPlanningInput {
  const now = toIso(input.currentTime) ?? new Date().toISOString();
  const opportunity = input.opportunity;

  return {
    now,
    timezone: FOLLOW_UP_TIMEZONE,
    opportunity: opportunity
      ? {
          id: opportunity.id !== null ? String(opportunity.id) : null,
          status: opportunity.status,
          stage: opportunity.stage,
          temperature: null,
          priority: null,
          primaryIntent: opportunity.primaryIntent,
          currentSummary: opportunity.currentSummary,
          missingRequirements: opportunity.missingRequirements,
          productInterests: opportunity.productInterests,
          objections: opportunity.objections,
          signals: opportunity.signals,
          lastActivityAt: toIso(opportunity.lastActivityAt),
          lastCustomerMessageId: null,
          lastAgentDecisionId: null,
          nextActionType: opportunity.nextActionType,
          humanOwnerActive: opportunity.humanOwnerActive,
          aiBlocked: opportunity.aiBlocked,
          closedAt: toIso(opportunity.closedAt)
        }
      : null,
    // Case-level status/lifecycle is not loaded at this call site and querying
    // it here would be the redundant lookup T01 explicitly avoids; opportunity
    // already carries the humanOwnerActive/aiBlocked/closedAt signals that
    // matter for follow-up gating.
    caseContext: null,
    conversation: {
      waId: opportunity?.waId ?? null,
      channel: "whatsapp",
      lastCustomerMessageAt: null,
      lastAgentMessageAt: null,
      lastInboundText: null,
      lastOutboundText: input.draftMessage || null
    },
    lastDecision: {
      decisionId: null,
      nextActionJson: { attemptNumber: input.priorAttemptNumber },
      policyStatus: null,
      riskLevel: null,
      approvalRequirement: null,
      decisionStatus: null,
      createdAt: null
    },
    policy: {
      maxAttempts: input.maxAttempts ?? COMMERCIAL_FOLLOW_UP_DEFAULT_MAX_ATTEMPTS,
      cooldownHours: FOLLOW_UP_DEFAULT_COOLDOWN_HOURS,
      defaultDelayHours: hoursBetween(now, toIso(input.dueAt)),
      requireOperatorReview: false,
      allowLowRiskAutoApprovalPreview: false
    }
  };
}
