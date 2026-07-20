import type { CommercialPolicyApprovalRequirement } from "../policy";
import type { OpportunityStage, OpportunityStatus } from "../types";
import type { CommercialOperationalTransitionValidation, CommercialOperationalTransitionValidationInput } from "./types";

function deriveExpectedStage(status: OpportunityStatus): OpportunityStage | null {
  if (status === "new" || status === "engaged" || status === "stalled") return "discovery";
  if (status === "qualifying") return "qualification";
  if (status === "quote_pending" || status === "quote_ready_for_review" || status === "quote_sent") return "quotation";
  if (status === "waiting_customer" || status === "followup_scheduled") return "solution_fit";
  if (status === "negotiation") return "negotiation";
  if (status === "won" || status === "lost" || status === "cancelled" || status === "archived") return "closing";
  return null;
}

function isTerminal(status: OpportunityStatus) {
  return status === "won" || status === "lost" || status === "cancelled" || status === "archived";
}

function allowedTransitions(previous: OpportunityStatus | null): OpportunityStatus[] {
  switch (previous) {
    case null:
    case "new":
      return ["new", "engaged", "qualifying", "stalled"];
    case "engaged":
      return ["engaged", "qualifying", "quote_pending", "waiting_customer", "stalled"];
    case "qualifying":
      return ["qualifying", "quote_pending", "waiting_customer", "stalled"];
    case "quote_pending":
      return ["quote_pending", "waiting_customer", "quote_ready_for_review", "stalled"];
    case "quote_ready_for_review":
      return ["quote_ready_for_review", "quote_sent", "waiting_customer", "stalled"];
    case "quote_sent":
      return ["quote_sent", "waiting_customer", "negotiation", "stalled"];
    case "waiting_customer":
      return ["waiting_customer", "engaged", "qualifying", "followup_scheduled", "stalled"];
    case "followup_scheduled":
      return ["followup_scheduled", "engaged", "negotiation", "stalled"];
    case "negotiation":
      return ["negotiation", "stalled"];
    case "stalled":
      return ["stalled", "engaged", "qualifying", "waiting_customer", "lost"];
    case "won":
    case "lost":
    case "cancelled":
    case "archived":
      return [previous];
    default:
      return [previous];
  }
}

function blockedReasonList(
  input: CommercialOperationalTransitionValidationInput,
  reasons: string[],
  approvalRequirement: CommercialPolicyApprovalRequirement
) {
  const output = [...reasons];
  if (input.identityResolution.isTerminal && input.previousState && input.previousState.status !== input.resultingState.status) output.push("terminal_state");
  if (input.resultingState.aiBlocked) output.push("ai_blocked");
  if (input.resultingState.humanOwnerActive) output.push("human_owner_active");
  if (input.commercialPolicyResult?.status === "blocked") output.push("policy_blocked");
  if (approvalRequirement === "blocked") output.push("approval_blocked");
  return [...new Set(output)];
}

export function validateCommercialTransition(input: CommercialOperationalTransitionValidationInput): CommercialOperationalTransitionValidation {
  const previousStatus = input.previousState?.status ?? null;
  const nextStatus = input.resultingState.status;
  const allowedNextStatuses = allowedTransitions(previousStatus);
  const expectedStage = deriveExpectedStage(nextStatus);
  const approvalRequirement = input.nextAction.approvalRequirement;
  const reasons: string[] = [];

  if (input.identityResolution.status === "blocked" || input.identityResolution.isAmbiguous) {
    // ACS-R1-05.1-T02: an ambiguous identity resolution must fail closed on
    // its own - it must never rely on some OTHER unrelated reason (a policy
    // block, a bad stage transition) to happen to also trip this turn, or a
    // "clean" ambiguous turn (nothing else wrong with it) silently falls
    // through to persistence and creates a third opportunity.
    reasons.push("identity_conflict");
  }
  if (!allowedNextStatuses.includes(nextStatus)) {
    reasons.push("transition_blocked");
  }
  if (input.previousState && isTerminal(input.previousState.status) && input.previousState.status !== nextStatus) {
    reasons.push("terminal_state");
  }
  if (expectedStage !== input.resultingState.stage) {
    reasons.push("stage_mismatch");
  }
  if (input.commercialPolicyResult?.status === "blocked" && input.nextAction.type !== "no_action" && input.nextAction.type !== "escalate_to_operator") {
    reasons.push("policy_blocked");
  }
  if (input.nextAction.type === "prepare_quote" && nextStatus !== "quote_pending" && nextStatus !== "quote_ready_for_review") {
    reasons.push("quote_transition_mismatch");
  }
  if (input.nextAction.type === "close_as_lost_candidate" && nextStatus === "won") {
    reasons.push("terminal_transition_blocked");
  }

  const requiresHumanReview =
    approvalRequirement !== "none" ||
    input.resultingState.humanOwnerActive ||
    input.resultingState.aiBlocked ||
    input.identityResolution.requiresHumanReview ||
    input.commercialPolicyResult?.requiresApproval === "operator_review" ||
    input.commercialPolicyResult?.requiresApproval === "explicit_operator_approval";

  const evidenceRequired =
    input.nextAction.type === "prepare_quote" ||
    input.nextAction.type === "close_as_lost_candidate" ||
    nextStatus === "won" ||
    nextStatus === "lost";

  if (reasons.length > 0) {
    return {
      status: "blocked",
      allowed: false,
      fromStatus: previousStatus,
      toStatus: nextStatus,
      fromStage: input.previousState?.stage ?? null,
      toStage: input.resultingState.stage,
      reason: reasons[0] === "stage_mismatch" ? "Resulting stage does not match the derived status." : "Commercial transition is not allowed.",
      blockedReasons: blockedReasonList(input, reasons, approvalRequirement),
      warnings: input.identityResolution.warnings,
      requiresHumanReview,
      evidenceRequired
    };
  }

  return {
    status: "allowed",
    allowed: true,
    fromStatus: previousStatus,
    toStatus: nextStatus,
    fromStage: input.previousState?.stage ?? null,
    toStage: input.resultingState.stage,
    reason: "Commercial transition is allowed.",
    blockedReasons: [],
    warnings: input.identityResolution.warnings,
    requiresHumanReview,
    evidenceRequired
  };
}
