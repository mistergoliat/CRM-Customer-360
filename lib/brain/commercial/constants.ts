import type {
  CommercialIntent,
  CommercialPriority,
  CommercialSignal,
  CommercialTemperature,
  LeadSource,
  LeadStatus,
  OpportunityLostReason,
  OpportunityStage,
  OpportunityStatus,
  OpportunityObjectionType,
  OpportunityStateTransition,
} from "./types";

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "engaged",
  "qualifying",
  "qualified",
  "unqualified",
  "converted",
  "dormant",
  "archived",
] as const satisfies readonly LeadStatus[];

export const OPPORTUNITY_STATUSES = [
  "new",
  "engaged",
  "qualifying",
  "quote_pending",
  "quote_ready_for_review",
  "quote_sent",
  "waiting_customer",
  "followup_scheduled",
  "negotiation",
  "stalled",
  "won",
  "lost",
  "cancelled",
  "archived",
] as const satisfies readonly OpportunityStatus[];

export const OPPORTUNITY_STAGES = [
  "discovery",
  "qualification",
  "solution_fit",
  "quotation",
  "negotiation",
  "closing",
  "post_sale_handoff",
] as const satisfies readonly OpportunityStage[];

export const LEAD_SOURCES = [
  "whatsapp_inbound",
  "whatsapp_outbound",
  "ecommerce",
  "pos",
  "manual_hub",
  "referral",
  "campaign",
  "email",
  "phone_call",
  "appsheet_import",
  "legacy_import",
  "unknown",
] as const satisfies readonly LeadSource[];

export const COMMERCIAL_INTENTS = [
  "product_inquiry",
  "product_recommendation",
  "price_request",
  "stock_request",
  "quote_request",
  "delivery_request",
  "discount_request",
  "bulk_purchase",
  "equipment_project",
  "maintenance_request",
  "assembly_request",
  "post_sale_request",
  "general_information",
  "unknown",
] as const satisfies readonly CommercialIntent[];

export const COMMERCIAL_SIGNALS = [
  "replied",
  "no_reply",
  "left_on_seen",
  "high_intent",
  "medium_intent",
  "low_intent",
  "asks_price",
  "asks_stock",
  "asks_delivery",
  "asks_discount",
  "asks_quote",
  "shares_requirements",
  "shares_budget",
  "shares_deadline",
  "objection_price",
  "objection_timing",
  "objection_trust",
  "objection_product_fit",
  "human_requested",
  "purchase_confirmed",
  "rejection_explicit",
  "conversation_inactive",
] as const satisfies readonly CommercialSignal[];

export const COMMERCIAL_PRIORITIES = [
  "low",
  "normal",
  "high",
  "urgent",
] as const satisfies readonly CommercialPriority[];

export const COMMERCIAL_TEMPERATURES = [
  "cold",
  "warm",
  "hot",
  "unknown",
] as const satisfies readonly CommercialTemperature[];

export const OPPORTUNITY_LOST_REASONS = [
  "price",
  "no_response",
  "chose_competitor",
  "unavailable_stock",
  "delivery_timing",
  "product_not_suitable",
  "budget_unavailable",
  "postponed",
  "duplicate",
  "invalid_lead",
  "explicit_rejection",
  "unknown",
] as const satisfies readonly OpportunityLostReason[];

export const OPPORTUNITY_OBJECTION_TYPES = [
  "price",
  "timing",
  "trust",
  "stock",
  "delivery",
  "product_fit",
  "approval_required",
  "competitor",
  "unknown",
] as const satisfies readonly OpportunityObjectionType[];

export const TERMINAL_OPPORTUNITY_STATUSES = [
  "won",
  "lost",
  "cancelled",
  "archived",
] as const satisfies readonly OpportunityStatus[];

export const INITIAL_ALLOWED_OPPORTUNITY_TRANSITIONS = [
  {
    from: "new",
    to: "engaged",
    reason: "reply_or_clear_interest",
    source: "whatsapp_inbound",
    detectedAt: "",
    requiresEvidence: false,
    requiresApproval: false,
  },
  {
    from: "engaged",
    to: "qualifying",
    reason: "need_more_information",
    source: "brain",
    detectedAt: "",
    requiresEvidence: false,
    requiresApproval: false,
  },
  {
    from: "qualifying",
    to: "quote_pending",
    reason: "ready_for_quote_draft",
    source: "brain",
    detectedAt: "",
    requiresEvidence: false,
    requiresApproval: false,
  },
  {
    from: "quote_sent",
    to: "waiting_customer",
    reason: "quote_shared_waiting_reply",
    source: "brain",
    detectedAt: "",
    requiresEvidence: false,
    requiresApproval: false,
  },
  {
    from: "waiting_customer",
    to: "followup_scheduled",
    reason: "follow_up_planned",
    source: "brain",
    detectedAt: "",
    requiresEvidence: false,
    requiresApproval: false,
  },
  {
    from: "followup_scheduled",
    to: "negotiation",
    reason: "customer_reengaged",
    source: "brain",
    detectedAt: "",
    requiresEvidence: false,
    requiresApproval: false,
  },
  {
    from: "stalled",
    to: "engaged",
    reason: "reactivated",
    source: "brain",
    detectedAt: "",
    requiresEvidence: false,
    requiresApproval: false,
  },
  {
    from: "stalled",
    to: "lost",
    reason: "lost_due_to_no_progress_or_evidence",
    source: "brain",
    detectedAt: "",
    requiresEvidence: true,
    requiresApproval: true,
  },
] as const satisfies readonly OpportunityStateTransition[];

