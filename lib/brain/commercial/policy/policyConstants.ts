import { SALES_AGENT_SENSITIVE_CLAIMS } from "../salesAgentConstants";
import type { CommercialPolicyFeatureFlags, CommercialPolicyIssueCode, CommercialPolicyRuleId } from "./policyTypes";

export const COMMERCIAL_POLICY_VERSION = "brain.commercial.policy.v1" as const;
export const COMMERCIAL_POLICY_CONTRACT_VERSION = "brain.commercial.policy.contract.v1" as const;

export const COMMERCIAL_POLICY_STATUSES = [
  "allowed",
  "allowed_with_restrictions",
  "requires_review",
  "blocked",
  "failed_safe"
] as const;

export const COMMERCIAL_POLICY_DECISIONS = [
  "allow",
  "allow_with_approval",
  "block",
  "remove",
  "downgrade_to_review",
  "failed_safe"
] as const;

export const COMMERCIAL_POLICY_APPROVAL_REQUIREMENTS = [
  "none",
  "operator_review",
  "explicit_operator_approval",
  "blocked"
] as const;

export const COMMERCIAL_POLICY_RISK_LEVELS = ["low", "medium", "high", "blocked"] as const;
export const COMMERCIAL_POLICY_ISSUE_LEVELS = ["info", "warning", "error", "fatal"] as const;
export const COMMERCIAL_POLICY_ISSUE_CODES = [
  "sensitive_claim_blocked",
  "evidence_missing",
  "evidence_unverified",
  "evidence_stale",
  "claim_source_not_authorized",
  "hard_blocked_action",
  "action_requires_approval",
  "duplicate_action",
  "expired_action",
  "tool_not_allowed",
  "tool_unavailable",
  "tool_execution_claimed",
  "invalid_entity_proposal",
  "terminal_transition_requires_evidence",
  "customer_master_mutation_blocked",
  "identity_conflict",
  "outbound_blocked",
  "opt_out_active",
  "ai_blocked",
  "human_owner_active",
  "recent_customer_reply",
  "quiet_hours_active",
  "manual_approval_required",
  "policy_context_missing",
  "policy_version_mismatch",
  "failed_safe",
  "policy_disabled",
  "invalid_input",
  "unknown_issue"
] as const satisfies readonly CommercialPolicyIssueCode[];

export const COMMERCIAL_POLICY_RULE_IDS = [
  "POLICY-CLAIM-PRICE-EVIDENCE",
  "POLICY-CLAIM-STOCK-FRESHNESS",
  "POLICY-CLAIM-DELIVERY-COMMITMENT",
  "POLICY-CLAIM-DISCOUNT-APPROVAL",
  "POLICY-CLAIM-ORDER-STATUS-SOURCE",
  "POLICY-ACTION-HARD-BLOCK",
  "POLICY-ACTION-DUPLICATE",
  "POLICY-ACTION-REVIEW",
  "POLICY-ACTION-EXPLICIT-APPROVAL",
  "POLICY-TOOL-CAPABILITY-ALLOWLIST",
  "POLICY-TOOL-NO-EXECUTION",
  "POLICY-ENTITY-TERMINAL-STATE",
  "POLICY-ENTITY-CUSTOMER-MASTER-BLOCK",
  "POLICY-OUTBOUND-OPTOUT",
  "POLICY-OUTBOUND-AI-BLOCKED",
  "POLICY-OUTBOUND-HUMAN-OWNER",
  "POLICY-OUTBOUND-QUIET-HOURS",
  "POLICY-OUTBOUND-MANUAL-APPROVAL",
  "POLICY-OUTBOUND-IDENTITY-CONFLICT",
  "POLICY-FOLLOWUP-RECENT-REPLY",
  "POLICY-GOVERNANCE-APPROVAL",
  "POLICY-GOVERNANCE-FAIL-CLOSED",
  "POLICY-VERSION-MISMATCH",
  "POLICY-DISABLED"
] as const satisfies readonly CommercialPolicyRuleId[];

export const COMMERCIAL_POLICY_AUTHORIZED_EVIDENCE_SOURCES = [
  "tool_result",
  "operator_input",
  "policy_context",
  "order_context",
  "product_service_context"
] as const;

export const COMMERCIAL_POLICY_VOLATILE_CLAIMS = [
  "price",
  "stock",
  "delivery",
  "dispatch",
  "order_status",
  "service_availability",
  "promotion",
  "warranty"
] as const;

export const COMMERCIAL_POLICY_HIGH_IMPACT_ENTITY_FIELDS = [
  "status",
  "stage",
  "amount",
  "currency",
  "probability",
  "expectedCloseAt",
  "nextFollowUpAt",
  "qualificationState",
  "customerReadiness",
  "productFit",
  "score",
  "lastInteractionAt"
] as const;

export const COMMERCIAL_POLICY_ALWAYS_REVIEW_ACTIONS = [
  "request_human_review",
  "follow_up",
  "send_whatsapp_message"
] as const;

export const COMMERCIAL_POLICY_ALWAYS_BLOCKED_CAPABILITIES = [
  "meta_write",
  "db_write",
  "email_send",
  "voice_call",
  "customer_master_mutation"
] as const;

export const COMMERCIAL_POLICY_TERMINAL_OPPORTUNITY_STATUSES = [
  "won",
  "lost",
  "closed_won",
  "closed_lost"
] as const;

export const COMMERCIAL_POLICY_DEFAULT_FLAGS: CommercialPolicyFeatureFlags = {
  commercialPolicyEnabled: false,
  allowDraftReplies: false,
  allowToolRequests: false,
  allowEntityProposals: false,
  allowFollowUpEvaluation: false,
  allowInternalTasks: false,
  allowQuoteDraftRequests: false,
  allowOperatorReviewRequests: false,
  allowSensitiveClaims: false,
  allowOutboundProposals: false
};

export const COMMERCIAL_POLICY_RECENT_EVIDENCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const COMMERCIAL_POLICY_SEMI_VOLATILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const COMMERCIAL_POLICY_CLAIM_VOLATILITY_MAP = {
  general: "stable",
  product: "stable",
  price: "volatile",
  stock: "highly_volatile",
  delivery: "highly_volatile",
  dispatch: "highly_volatile",
  order_status: "highly_volatile",
  service_availability: "semi_volatile",
  promotion: "volatile",
  warranty: "semi_volatile"
} as const;

export const COMMERCIAL_POLICY_SENSITIVE_CLAIMS = SALES_AGENT_SENSITIVE_CLAIMS;
