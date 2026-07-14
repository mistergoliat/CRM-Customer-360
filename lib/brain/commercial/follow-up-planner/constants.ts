import type {
  CommercialFollowUpApprovalRequirement,
  CommercialFollowUpBlockReason,
  CommercialFollowUpCancelReason,
  CommercialFollowUpChannel,
  CommercialFollowUpIntent,
  CommercialFollowUpPlanStatus,
  CommercialFollowUpPlanValidationCode,
  CommercialFollowUpRiskLevel
} from "./types";

export const COMMERCIAL_FOLLOW_UP_PLANNER_VERSION = "brain.commercial.follow-up-planner.v1" as const;

export const COMMERCIAL_FOLLOW_UP_INTENTS = [
  "quote_followup",
  "product_interest_followup",
  "missing_information_followup",
  "payment_or_checkout_followup",
  "availability_followup",
  "post_handoff_followup",
  "reactivation_followup",
  "no_followup"
] as const satisfies readonly CommercialFollowUpIntent[];

export const COMMERCIAL_FOLLOW_UP_PLAN_STATUSES = [
  "not_needed",
  "recommended",
  "requires_operator_review",
  "blocked",
  "cancelled",
  "expired",
  "invalid"
] as const satisfies readonly CommercialFollowUpPlanStatus[];

export const COMMERCIAL_FOLLOW_UP_BLOCK_REASONS = [
  "case_closed",
  "ai_blocked",
  "human_owner_active",
  "customer_replied_after_last_agent_message",
  "high_risk_intent",
  "complaint_or_warranty",
  "missing_customer_identity",
  "missing_channel",
  "outside_policy_window",
  "cooldown_active",
  "max_attempts_reached",
  "unsafe_message",
  "no_commercial_opportunity"
] as const satisfies readonly CommercialFollowUpBlockReason[];

export const COMMERCIAL_FOLLOW_UP_CANCEL_REASONS = [
  "customer_replied",
  "case_closed",
  "human_took_over",
  "ai_blocked",
  "opportunity_closed",
  "policy_changed",
  "expired"
] as const satisfies readonly CommercialFollowUpCancelReason[];

export const COMMERCIAL_FOLLOW_UP_RISK_LEVELS = ["low", "medium", "high", "critical", "unknown"] as const satisfies readonly CommercialFollowUpRiskLevel[];

export const COMMERCIAL_FOLLOW_UP_APPROVAL_REQUIREMENTS = [
  "none",
  "operator_review",
  "manager_review",
  "blocked"
] as const satisfies readonly CommercialFollowUpApprovalRequirement[];

export const COMMERCIAL_FOLLOW_UP_CHANNELS = ["whatsapp", "email", "internal", "unknown"] as const satisfies readonly CommercialFollowUpChannel[];

export const COMMERCIAL_FOLLOW_UP_PLAN_VALIDATION_CODES = [
  "valid",
  "invalid_root",
  "missing_required_field",
  "invalid_enum_value",
  "invalid_iso_timestamp",
  "invalid_number",
  "invalid_boolean",
  "invalid_string",
  "invalid_invariant",
  "draft_message_too_long",
  "rationale_too_long",
  "too_many_policy_notes",
  "too_many_block_reasons",
  "unknown_issue"
] as const satisfies readonly CommercialFollowUpPlanValidationCode[];

export const COMMERCIAL_FOLLOW_UP_MAX_DRAFT_MESSAGE_LENGTH = 320;
export const COMMERCIAL_FOLLOW_UP_MAX_RATIONALE_LENGTH = 360;
export const COMMERCIAL_FOLLOW_UP_MAX_POLICY_NOTES = 12;
export const COMMERCIAL_FOLLOW_UP_MAX_BLOCK_REASONS = 8;
export const COMMERCIAL_FOLLOW_UP_MAX_ATTEMPT_NUMBER = 999;

// Default policy.maxAttempts fed to planCommercialFollowUp by callers that do
// not yet have a real configured follow-up policy source (ACS-R1-05-T02 wires
// evaluateCommercialPolicy; until then this is the single named, importable
// default - never re-declare this literal elsewhere). Distinct from
// COMMERCIAL_FOLLOW_UP_MAX_ATTEMPT_NUMBER above, which is the planner's own
// internal ceiling on attemptNumber itself, not a policy default.
export const COMMERCIAL_FOLLOW_UP_DEFAULT_MAX_ATTEMPTS = 3;

export const COMMERCIAL_FOLLOW_UP_ACTIVE_OPPORTUNITY_STATUSES = [
  "new",
  "engaged",
  "qualifying",
  "quote_pending",
  "quote_ready_for_review",
  "quote_sent",
  "waiting_customer",
  "followup_scheduled",
  "negotiation",
  "stalled"
] as const;

export const COMMERCIAL_FOLLOW_UP_TERMINAL_OPPORTUNITY_STATUSES = [
  "won",
  "lost",
  "cancelled",
  "archived"
] as const;

export const COMMERCIAL_FOLLOW_UP_DEFAULT_DRAFTS: Record<Exclude<CommercialFollowUpIntent, "no_followup">, string> = {
  quote_followup:
    "Hola, te escribo para saber si aun quieres que te ayudemos con la cotizacion. Si me confirmas que producto estabas viendo, te puedo orientar mejor.",
  product_interest_followup:
    "Hola, queria confirmar si sigues interesado en el producto que estabas revisando. Te puedo ayudar con disponibilidad o alternativas.",
  missing_information_followup:
    "Hola, para poder ayudarte mejor me falta confirmar un dato de tu solicitud. Me puedes indicar que producto necesitas?",
  payment_or_checkout_followup:
    "Hola, queria confirmar si necesitas ayuda para avanzar con tu solicitud. Si aun te interesa, te acompano con los proximos pasos.",
  availability_followup:
    "Hola, queria confirmar si sigues interesado en el producto. Te puedo ayudar con alternativas o proximos pasos.",
  post_handoff_followup:
    "Hola, queria hacer seguimiento a lo conversado. Si sigue vigente, te ayudo a continuar.",
  reactivation_followup:
    "Hola, retomamos tu solicitud cuando quieras. Si sigue vigente, te puedo ayudar a continuar."
};
