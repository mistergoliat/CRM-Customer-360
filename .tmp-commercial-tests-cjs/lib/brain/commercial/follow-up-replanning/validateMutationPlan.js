"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateFollowUpMutationPlan = validateFollowUpMutationPlan;
const constants_1 = require("./constants");
function buildResult(valid, reason, plan, warnings = []) {
    return {
        valid,
        reason,
        warnings: [...new Set(warnings)],
        plan
    };
}
function isPlanType(value) {
    return typeof value === "string" && constants_1.COMMERCIAL_FOLLOW_UP_MUTATION_PLAN_TYPES.includes(value);
}
function isActionPatch(value) {
    return (0, constants_1.isRecord)(value) && typeof value.actionId === "string" && Array.isArray(value.expectedStatuses) && typeof value.nextStatus === "string" && typeof value.updatedAt === "string";
}
function isReplacementDraft(value) {
    return (0, constants_1.isRecord)(value) && typeof value.actionId === "string" && typeof value.idempotencyKey === "string" && typeof value.parentActionId === "string" && typeof value.scheduledFor === "string";
}
function validateFollowUpMutationPlan(value) {
    if (!(0, constants_1.isRecord)(value)) {
        return buildResult(false, "invalid_root", null);
    }
    const plan = value;
    if (!isPlanType(plan.planType))
        return buildResult(false, "invalid_root", null);
    if (typeof plan.planId !== "string" || plan.planId.trim().length === 0)
        return buildResult(false, "invalid_root", null);
    if (typeof plan.actionId !== "string" || plan.actionId.trim().length === 0)
        return buildResult(false, "invalid_root", null);
    if (!plan.idempotency || typeof plan.idempotency.planKey !== "string" || plan.idempotency.planKey.trim().length === 0 || plan.idempotency.deterministic !== true) {
        return buildResult(false, "invalid_root", null);
    }
    if (!Array.isArray(plan.operations))
        return buildResult(false, "invalid_root", null);
    if (!Array.isArray(plan.reasons))
        return buildResult(false, "invalid_root", null);
    if (!Array.isArray(plan.warnings))
        return buildResult(false, "invalid_root", null);
    if (!(0, constants_1.asIso)(plan.createdAt))
        return buildResult(false, "invalid_root", null);
    if (plan.sideEffects.databaseWritten !== false || plan.sideEffects.actionMutated !== false || plan.sideEffects.actionInserted !== false || plan.sideEffects.outboxWritten !== false || plan.sideEffects.messageSent !== false || plan.sideEffects.workerTriggered !== false) {
        return buildResult(false, "invalid_root", null);
    }
    const reasons = (0, constants_1.normalizePlanReasons)(plan.reasons);
    if (reasons.some((reason) => !constants_1.COMMERCIAL_FOLLOW_UP_MUTATION_REASONS.includes(reason))) {
        return buildResult(false, "invalid_root", null);
    }
    if (plan.planType === "no_change") {
        if (plan.operations.length !== 0)
            return buildResult(false, "invalid_root", null);
        if (plan.replacementActionId !== null)
            return buildResult(false, "invalid_root", null);
        return buildResult(true, "valid", plan, plan.warnings);
    }
    let replacementActionId = null;
    let sawUpdate = false;
    let sawReplacement = false;
    let sawAudit = false;
    for (const operation of plan.operations) {
        if (!(0, constants_1.isRecord)(operation) || typeof operation.type !== "string" || !constants_1.COMMERCIAL_FOLLOW_UP_MUTATION_OPERATION_TYPES.includes(operation.type)) {
            return buildResult(false, "invalid_root", null);
        }
        if (operation.type === "update_existing_action") {
            if (sawUpdate)
                return buildResult(false, "invalid_root", null);
            sawUpdate = true;
            if (!isActionPatch(operation.patch))
                return buildResult(false, "invalid_root", null);
            if (operation.patch.actionId !== plan.actionId)
                return buildResult(false, "invalid_root", null);
            if (operation.patch.expectedStatuses.length === 0)
                return buildResult(false, "invalid_root", null);
            if (!(0, constants_1.asIso)(operation.patch.updatedAt))
                return buildResult(false, "invalid_root", null);
        }
        else if (operation.type === "create_replacement_action") {
            if (sawReplacement)
                return buildResult(false, "invalid_root", null);
            sawReplacement = true;
            if (!isReplacementDraft(operation.action))
                return buildResult(false, "invalid_root", null);
            if (operation.action.parentActionId !== plan.actionId)
                return buildResult(false, "invalid_root", null);
            if (!(0, constants_1.asIso)(operation.action.createdAt) || !(0, constants_1.asIso)(operation.action.updatedAt))
                return buildResult(false, "invalid_root", null);
            if (operation.action.actionId === plan.actionId)
                return buildResult(false, "invalid_root", null);
            replacementActionId = operation.action.actionId;
        }
        else if (operation.type === "append_audit_event") {
            sawAudit = true;
            if (!(0, constants_1.isRecord)(operation.event) || typeof operation.event.eventId !== "string" || typeof operation.event.actionId !== "string" || typeof operation.event.createdAt !== "string") {
                return buildResult(false, "invalid_root", null);
            }
            if (operation.event.actionId !== plan.actionId)
                return buildResult(false, "invalid_root", null);
            if (replacementActionId !== null && operation.event.replacementActionId !== null && operation.event.replacementActionId !== replacementActionId) {
                return buildResult(false, "invalid_root", null);
            }
            if (!(0, constants_1.asIso)(operation.event.createdAt))
                return buildResult(false, "invalid_root", null);
        }
    }
    if (!sawUpdate)
        return buildResult(false, "invalid_root", null);
    if ((plan.planType === "supersede_action" || plan.planType === "cancel_and_create_replacement") && !sawReplacement) {
        return buildResult(false, "invalid_root", null);
    }
    if ((plan.planType === "supersede_action" || plan.planType === "cancel_and_create_replacement") && plan.replacementActionId === null) {
        return buildResult(false, "invalid_root", null);
    }
    if ((plan.planType === "replan_action" || plan.planType === "cancel_action" || plan.planType === "expire_action" || plan.planType === "block_action") && plan.replacementActionId !== null) {
        return buildResult(false, "invalid_root", null);
    }
    if ((plan.planType === "replan_action" || plan.planType === "supersede_action" || plan.planType === "cancel_and_create_replacement") && !sawAudit && plan.warnings.length === 0) {
        return buildResult(false, "invalid_root", null);
    }
    return buildResult(true, "valid", plan, plan.warnings);
}
