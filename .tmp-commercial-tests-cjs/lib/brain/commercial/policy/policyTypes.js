"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMMERCIAL_POLICY_CHANNEL_CONTEXT_KEYS = exports.COMMERCIAL_POLICY_CLAIM_VOLATILITY = exports.COMMERCIAL_POLICY_EVIDENCE_FRESHNESS = exports.COMMERCIAL_POLICY_FAILED_SAFE_REASONS = exports.COMMERCIAL_POLICY_RULE_IDS = exports.COMMERCIAL_POLICY_ISSUE_CODES = exports.COMMERCIAL_POLICY_ISSUE_LEVELS = exports.COMMERCIAL_POLICY_RISK_LEVELS = exports.COMMERCIAL_POLICY_APPROVAL_REQUIREMENTS = exports.COMMERCIAL_POLICY_DECISIONS = exports.COMMERCIAL_POLICY_STATUSES = void 0;
exports.COMMERCIAL_POLICY_STATUSES = [
    "allowed",
    "allowed_with_restrictions",
    "requires_review",
    "blocked",
    "failed_safe"
];
exports.COMMERCIAL_POLICY_DECISIONS = [
    "allow",
    "allow_with_approval",
    "block",
    "remove",
    "downgrade_to_review",
    "failed_safe"
];
exports.COMMERCIAL_POLICY_APPROVAL_REQUIREMENTS = [
    "none",
    "operator_review",
    "explicit_operator_approval",
    "blocked"
];
exports.COMMERCIAL_POLICY_RISK_LEVELS = ["low", "medium", "high", "blocked"];
exports.COMMERCIAL_POLICY_ISSUE_LEVELS = ["info", "warning", "error", "fatal"];
exports.COMMERCIAL_POLICY_ISSUE_CODES = [
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
    "policy_context_missing",
    "policy_version_mismatch",
    "failed_safe",
    "policy_disabled",
    "invalid_input",
    "unknown_issue"
];
exports.COMMERCIAL_POLICY_RULE_IDS = [
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
    "POLICY-OUTBOUND-IDENTITY-CONFLICT",
    "POLICY-FOLLOWUP-RECENT-REPLY",
    "POLICY-GOVERNANCE-APPROVAL",
    "POLICY-GOVERNANCE-FAIL-CLOSED",
    "POLICY-VERSION-MISMATCH",
    "POLICY-DISABLED"
];
exports.COMMERCIAL_POLICY_FAILED_SAFE_REASONS = [
    "invalid_input",
    "policy_version_mismatch",
    "policy_disabled",
    "policy_context_missing",
    "exception",
    "unsafe_output",
    "unknown_issue"
];
exports.COMMERCIAL_POLICY_EVIDENCE_FRESHNESS = ["fresh", "recent", "stale", "unknown"];
exports.COMMERCIAL_POLICY_CLAIM_VOLATILITY = ["stable", "semi_volatile", "volatile", "highly_volatile"];
exports.COMMERCIAL_POLICY_CHANNEL_CONTEXT_KEYS = [
    "channel",
    "available",
    "outboundAllowed",
    "manualApprovalRequired",
    "optOut",
    "quietHoursActive",
    "humanOwnerActive",
    "aiBlocked",
    "identityConflict",
    "recentCustomerReply",
    "recentHumanContact"
];
