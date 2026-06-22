"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFollowUpMutationPlan = buildFollowUpMutationPlan;
const constants_1 = require("../action-lifecycle/constants");
const buildBlockingPlan_1 = require("./buildBlockingPlan");
const buildCancellationPlan_1 = require("./buildCancellationPlan");
const buildExpirationPlan_1 = require("./buildExpirationPlan");
const buildReplanningPlan_1 = require("./buildReplanningPlan");
const constants_2 = require("./constants");
function isTerminalActionStatus(status) {
    return [...constants_2.COMMERCIAL_FOLLOW_UP_MUTATION_TERMINAL_STATUSES, ...constants_1.COMMERCIAL_ACTION_TERMINAL_STATUSES].includes(status);
}
function isAllowedSchedulingStatus(status) {
    return [...constants_2.COMMERCIAL_FOLLOW_UP_MUTATION_ALLOWED_MUTABLE_STATUSES].includes(status);
}
function isCustomerReplyAfterActionCreated(input) {
    const inbound = (0, constants_2.asIso)(input.currentContext.lastInboundAt);
    const createdAt = (0, constants_2.asIso)(input.originalAction.createdAt);
    if (!inbound || !createdAt)
        return false;
    return new Date(inbound).getTime() > new Date(createdAt).getTime();
}
function buildInvalidPlan(input, reason) {
    return {
        planId: `followup-mutation-plan-invalid:${reason}:${(0, constants_2.asText)(input.originalAction.actionId) ?? "unknown"}`,
        planType: "no_change",
        actionId: input.originalAction.actionId,
        replacementActionId: null,
        operations: [],
        reasons: [reason],
        warnings: [reason],
        idempotency: {
            planKey: `followup-mutation:${input.originalAction.actionId}:no_change:${reason}`,
            deterministic: true
        },
        sideEffects: {
            databaseWritten: false,
            actionMutated: false,
            actionInserted: false,
            outboxWritten: false,
            messageSent: false,
            workerTriggered: false
        },
        createdAt: input.now
    };
}
function buildFollowUpMutationPlan(input) {
    if (!(0, constants_2.isRecord)(input)) {
        throw new Error("Invalid follow-up mutation input.");
    }
    const actionId = (0, constants_2.asText)(input.originalAction?.actionId);
    const idempotencyKey = (0, constants_2.asText)(input.originalAction?.idempotencyKey);
    const actionType = (0, constants_2.asText)(input.originalAction?.actionType);
    const status = (0, constants_2.asText)(input.originalAction?.status);
    const now = (0, constants_2.asIso)(input.now);
    if (!actionId || !idempotencyKey || !actionType || !status || !now) {
        return buildInvalidPlan(input, "invalid_scheduling_result");
    }
    if (isTerminalActionStatus(status) || !isAllowedSchedulingStatus(status)) {
        return buildInvalidPlan(input, "terminal_action_immutable");
    }
    const schedulingDecision = input.schedulingResult?.decision;
    const schedulingReasons = Array.isArray(input.schedulingResult?.reasons) ? input.schedulingResult.reasons : [];
    const primaryReason = (0, constants_2.resolvePrimaryMutationReason)((0, constants_2.normalizePlanReasons)(schedulingReasons));
    if (schedulingDecision === "invalid") {
        return buildInvalidPlan(input, "invalid_scheduling_result");
    }
    if (schedulingDecision === "wait" || schedulingDecision === "ready") {
        return {
            planId: `followup-mutation-plan:${actionId}:${schedulingDecision}:${now.slice(0, 19).replace(/[:.]/g, "")}`,
            planType: "no_change",
            actionId,
            replacementActionId: null,
            operations: [],
            reasons: [],
            warnings: [],
            idempotency: {
                planKey: `followup-mutation:${actionId}:no_change:${schedulingDecision}:${now}`,
                deterministic: true
            },
            sideEffects: {
                databaseWritten: false,
                actionMutated: false,
                actionInserted: false,
                outboxWritten: false,
                messageSent: false,
                workerTriggered: false
            },
            createdAt: now
        };
    }
    if (schedulingDecision === "cancel") {
        if (isCustomerReplyAfterActionCreated(input)) {
            return (0, buildCancellationPlan_1.buildCancellationPlan)(input);
        }
        return (0, buildCancellationPlan_1.buildCancellationPlan)({
            ...input,
            schedulingResult: {
                ...input.schedulingResult,
                reasons: [...input.schedulingResult.reasons]
            }
        });
    }
    if (schedulingDecision === "expire") {
        return (0, buildExpirationPlan_1.buildExpirationPlan)(input);
    }
    if (schedulingDecision === "block") {
        return (0, buildBlockingPlan_1.buildBlockingPlan)(input);
    }
    if (schedulingDecision === "replan") {
        if (!input.schedulingResult.nextScheduledFor) {
            return buildInvalidPlan(input, "missing_next_schedule");
        }
        return (0, buildReplanningPlan_1.buildReplanningPlan)(input);
    }
    return buildInvalidPlan(input, primaryReason === "invalid_scheduling_result" ? "invalid_scheduling_result" : primaryReason);
}
