"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMMERCIAL_FOLLOW_UP_MUTATION_TERMINAL_STATUSES = exports.COMMERCIAL_FOLLOW_UP_MUTATION_ALLOWED_MUTABLE_STATUSES = exports.COMMERCIAL_FOLLOW_UP_MUTATION_REASONS = exports.COMMERCIAL_FOLLOW_UP_MUTATION_OPERATION_TYPES = exports.COMMERCIAL_FOLLOW_UP_MUTATION_PLAN_TYPES = exports.COMMERCIAL_FOLLOW_UP_REPLANNING_VERSION = void 0;
exports.asText = asText;
exports.asIso = asIso;
exports.isRecord = isRecord;
exports.dedupeStrings = dedupeStrings;
exports.buildStableDigest = buildStableDigest;
exports.buildFollowUpMutationPlanId = buildFollowUpMutationPlanId;
exports.buildFollowUpMutationPlanKey = buildFollowUpMutationPlanKey;
exports.buildReplacementActionId = buildReplacementActionId;
exports.buildReplacementIdempotencyKey = buildReplacementIdempotencyKey;
exports.buildFollowUpAuditEventId = buildFollowUpAuditEventId;
exports.normalizePlanReasons = normalizePlanReasons;
exports.mapSchedulingReasonToMutationReason = mapSchedulingReasonToMutationReason;
exports.resolvePrimaryMutationReason = resolvePrimaryMutationReason;
const node_crypto_1 = require("node:crypto");
const constants_1 = require("../action-lifecycle/constants");
exports.COMMERCIAL_FOLLOW_UP_REPLANNING_VERSION = "brain.commercial.follow-up-replanning.v1";
exports.COMMERCIAL_FOLLOW_UP_MUTATION_PLAN_TYPES = [
    "no_change",
    "cancel_action",
    "expire_action",
    "block_action",
    "replan_action",
    "supersede_action",
    "cancel_and_create_replacement"
];
exports.COMMERCIAL_FOLLOW_UP_MUTATION_OPERATION_TYPES = [
    "update_existing_action",
    "create_replacement_action",
    "append_audit_event"
];
exports.COMMERCIAL_FOLLOW_UP_MUTATION_REASONS = [
    "customer_replied",
    "customer_replied_after_action_created",
    "human_owner_active",
    "case_closed",
    "case_requires_human",
    "opportunity_closed_won",
    "opportunity_closed_lost",
    "opportunity_paused",
    "opportunity_stage_changed",
    "stale_action_context",
    "follow_up_disabled",
    "policy_blocked",
    "risk_too_high",
    "approval_required",
    "action_expired",
    "max_attempts_reached",
    "duplicate_action",
    "conflicting_action",
    "cooldown_replan",
    "business_hours_replan",
    "recent_outbound_replan",
    "schedule_changed",
    "replacement_required",
    "terminal_action_immutable",
    "invalid_scheduling_result",
    "missing_next_schedule",
    "replacement_would_exceed_expiry",
    "idempotent_plan_reused"
];
exports.COMMERCIAL_FOLLOW_UP_MUTATION_ALLOWED_MUTABLE_STATUSES = ["proposed", "approved", "planned", "scheduled"];
exports.COMMERCIAL_FOLLOW_UP_MUTATION_TERMINAL_STATUSES = [
    "cancelled",
    "expired",
    "executed",
    "rejected",
    ...constants_1.COMMERCIAL_ACTION_TERMINAL_STATUSES
];
function asText(value) {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === "number" && Number.isFinite(value))
        return String(value);
    if (typeof value === "bigint")
        return value.toString();
    return null;
}
function asIso(value) {
    const text = asText(value);
    if (!text)
        return null;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function dedupeStrings(values) {
    return [...new Set(values)];
}
function buildStableDigest(payload) {
    return (0, node_crypto_1.createHash)("sha256").update(JSON.stringify(payload)).digest("hex");
}
function buildFollowUpMutationPlanId(input) {
    const digest = buildStableDigest({
        actionId: input.actionId,
        planType: input.planType,
        createdAt: input.createdAt,
        reasons: [...input.reasons],
        operations: input.operations
    });
    return `followup-mutation-plan:${digest.slice(0, 24)}`;
}
function buildFollowUpMutationPlanKey(input) {
    const digest = buildStableDigest({
        actionId: input.actionId,
        planType: input.planType,
        createdAt: input.createdAt,
        reasons: [...input.reasons],
        operations: input.operations
    });
    return `followup-mutation:${input.actionId}:${input.planType}:${digest.slice(0, 24)}`;
}
function buildReplacementActionId(input) {
    const digest = buildStableDigest(input);
    return `followup-replacement:${input.originalActionId}:g${input.generation}:${digest.slice(0, 20)}`;
}
function buildReplacementIdempotencyKey(input) {
    const digest = buildStableDigest(input);
    return `followup-replacement-idem:${input.originalActionId}:g${input.generation}:${digest.slice(0, 24)}`;
}
function buildFollowUpAuditEventId(input) {
    const digest = buildStableDigest(input);
    return `followup-audit:${input.actionId}:${input.eventType}:${digest.slice(0, 20)}`;
}
function normalizePlanReasons(reasons) {
    return dedupeStrings([...reasons]);
}
function mapSchedulingReasonToMutationReason(schedulingReason, input) {
    switch (schedulingReason) {
        case "customer_replied_after_action_created":
            return "customer_replied_after_action_created";
        case "customer_replied":
            return input.customerRepliedAfterActionCreated ? "customer_replied_after_action_created" : "customer_replied";
        case "human_owner_active":
            return "human_owner_active";
        case "case_closed":
            return "case_closed";
        case "case_requires_human":
            return "case_requires_human";
        case "opportunity_closed_won":
            return "opportunity_closed_won";
        case "opportunity_closed_lost":
            return "opportunity_closed_lost";
        case "opportunity_paused":
            return "opportunity_paused";
        case "opportunity_stage_changed":
            return "opportunity_stage_changed";
        case "follow_up_not_allowed":
            return "follow_up_disabled";
        case "policy_blocked":
            return "policy_blocked";
        case "risk_too_high":
            return "risk_too_high";
        case "approval_required":
            return "approval_required";
        case "action_expired":
            return "action_expired";
        case "max_attempts_reached":
            return "max_attempts_reached";
        case "duplicate_action":
            return "duplicate_action";
        case "conflicting_action":
            return "conflicting_action";
        case "cooldown_active":
            return "cooldown_replan";
        case "outside_business_hours":
            return "business_hours_replan";
        case "replanned_after_cooldown":
            return "cooldown_replan";
        case "replanned_for_business_hours":
            return "business_hours_replan";
        case "replanned_after_recent_outbound":
            return "recent_outbound_replan";
        case "stale_action_context":
            return "stale_action_context";
        default:
            return input.stageChanged ? "schedule_changed" : "replacement_required";
    }
}
function resolvePrimaryMutationReason(reasons) {
    return reasons[0] ?? "invalid_scheduling_result";
}
