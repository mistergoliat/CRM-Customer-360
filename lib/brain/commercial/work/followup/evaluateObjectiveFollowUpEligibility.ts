import type { CommercialObjective, CommercialOpportunityProjection, CommercialConversationProjection, CommercialWork } from "../types";
import {
  deriveObjectiveWaitingReason,
  getObjectiveFollowUpPolicyDefinition,
  mapObjectiveToFollowUpPolicy,
  type ObjectiveFollowUpPolicy
} from "./objectiveFollowUpPolicies";

export type ObjectiveFollowUpExistingAction = {
  policy: ObjectiveFollowUpPolicy;
  commercialWorkPublicId: string;
  commercialObjectivePublicId: string;
  attempt: number;
  status: string;
};

export type ObjectiveFollowUpEligibilityStatus = "ELIGIBLE" | "NOT_ELIGIBLE" | "ALREADY_SCHEDULED" | "STOPPED";

export type ObjectiveFollowUpEligibilityReason =
  | "eligible"
  | "work_not_waiting_customer"
  | "objective_not_found"
  | "objective_not_waiting_customer"
  | "objective_cancelled"
  | "objective_superseded"
  | "work_cancelled"
  | "work_superseded"
  | "work_completed"
  | "work_terminal"
  | "conversation_handoff"
  | "conversation_ai_disabled"
  | "conversation_closed"
  | "opportunity_terminal"
  | "customer_opted_out"
  | "policy_not_found"
  | "policy_does_not_apply"
  | "duplicate_active_followup"
  | "max_attempts_reached";

export type ObjectiveFollowUpEligibilityResult = {
  status: ObjectiveFollowUpEligibilityStatus;
  reason: ObjectiveFollowUpEligibilityReason;
  policy: ObjectiveFollowUpPolicy | null;
  waitingReason: string | null;
  nextAttempt: number | null;
  maxAttempts: number | null;
};

const ACTIVE_FOLLOW_UP_STATUSES = new Set(["planned", "requires_review", "executing"]);
const ATTEMPT_CONSUMING_STATUSES = new Set(["executing", "executed", "failed"]);
const TERMINAL_OPPORTUNITY_STATUSES = new Set(["won", "lost", "closed", "cancelled", "archived"]);

function terminalResult(reason: ObjectiveFollowUpEligibilityReason, policy: ObjectiveFollowUpPolicy | null, waitingReason: string | null): ObjectiveFollowUpEligibilityResult {
  return { status: "STOPPED", reason, policy, waitingReason, nextAttempt: null, maxAttempts: policy ? getObjectiveFollowUpPolicyDefinition(policy).maxAttempts : null };
}

function notEligible(reason: ObjectiveFollowUpEligibilityReason, policy: ObjectiveFollowUpPolicy | null, waitingReason: string | null): ObjectiveFollowUpEligibilityResult {
  return { status: "NOT_ELIGIBLE", reason, policy, waitingReason, nextAttempt: null, maxAttempts: policy ? getObjectiveFollowUpPolicyDefinition(policy).maxAttempts : null };
}

function isClosedConversation(conversation: CommercialConversationProjection) {
  return ["closed", "resolved", "done", "archived"].includes(String(conversation.status ?? "").toLowerCase());
}

function isTerminalOpportunity(opportunity: CommercialOpportunityProjection | null | undefined) {
  return TERMINAL_OPPORTUNITY_STATUSES.has(String(opportunity?.status ?? "").toLowerCase());
}

export function evaluateObjectiveFollowUpEligibility(input: {
  work: CommercialWork;
  objective: CommercialObjective | null;
  conversation: CommercialConversationProjection;
  opportunity?: CommercialOpportunityProjection | null;
  existingFollowUpActions?: ObjectiveFollowUpExistingAction[];
  currentTime: string | Date;
  customerOptedOut?: boolean;
  policy?: ObjectiveFollowUpPolicy | null;
  commercialWorkPublicId?: string | null;
}): ObjectiveFollowUpEligibilityResult {
  const objective = input.objective;
  const policy = input.policy ?? (objective ? mapObjectiveToFollowUpPolicy(objective) : null);
  const waitingReason = objective ? deriveObjectiveWaitingReason(objective) : null;

  if (!objective) return notEligible("objective_not_found", policy, waitingReason);
  if (!policy) return notEligible("policy_not_found", null, waitingReason);

  if (input.work.status === "COMPLETED") return terminalResult("work_completed", policy, waitingReason);
  if (input.work.status === "CANCELLED") return terminalResult("work_cancelled", policy, waitingReason);
  if (input.work.status === "SUPERSEDED") return terminalResult("work_superseded", policy, waitingReason);
  if (input.work.status === "FAILED" || input.work.status === "HANDOFF") return terminalResult("work_terminal", policy, waitingReason);
  if (input.work.status !== "WAITING_CUSTOMER") return notEligible("work_not_waiting_customer", policy, waitingReason);

  if (objective.status === "CANCELLED") return terminalResult("objective_cancelled", policy, waitingReason);
  if (objective.status === "SUPERSEDED") return terminalResult("objective_superseded", policy, waitingReason);
  if (objective.status !== "WAITING_CUSTOMER") return terminalResult("objective_not_waiting_customer", policy, waitingReason);

  const definition = getObjectiveFollowUpPolicyDefinition(policy);
  if (!definition.eligibleObjectiveTypes.includes(objective.type) || !definition.waitingReasons.includes(waitingReason!)) {
    return notEligible("policy_does_not_apply", policy, waitingReason);
  }

  if (input.conversation.humanOwnerActive) return terminalResult("conversation_handoff", policy, waitingReason);
  if (!input.conversation.aiEnabled) return terminalResult("conversation_ai_disabled", policy, waitingReason);
  if (isClosedConversation(input.conversation)) return terminalResult("conversation_closed", policy, waitingReason);
  if (isTerminalOpportunity(input.opportunity)) return terminalResult("opportunity_terminal", policy, waitingReason);
  if (input.customerOptedOut) return terminalResult("customer_opted_out", policy, waitingReason);

  const related = (input.existingFollowUpActions ?? []).filter(
    (action) =>
      action.policy === policy &&
      action.commercialWorkPublicId === (input.commercialWorkPublicId ?? input.work.id) &&
      action.commercialObjectivePublicId === objective.objectiveId
  );
  if (related.some((action) => ACTIVE_FOLLOW_UP_STATUSES.has(action.status))) {
    return { status: "ALREADY_SCHEDULED", reason: "duplicate_active_followup", policy, waitingReason, nextAttempt: null, maxAttempts: definition.maxAttempts };
  }

  const maxConsumedAttempt = related.reduce(
    (max, action) => (ATTEMPT_CONSUMING_STATUSES.has(action.status) ? Math.max(max, action.attempt) : max),
    0
  );
  const nextAttempt = maxConsumedAttempt + 1;
  if (nextAttempt > definition.maxAttempts) {
    return { status: "STOPPED", reason: "max_attempts_reached", policy, waitingReason, nextAttempt, maxAttempts: definition.maxAttempts };
  }

  return { status: "ELIGIBLE", reason: "eligible", policy, waitingReason, nextAttempt, maxAttempts: definition.maxAttempts };
}
