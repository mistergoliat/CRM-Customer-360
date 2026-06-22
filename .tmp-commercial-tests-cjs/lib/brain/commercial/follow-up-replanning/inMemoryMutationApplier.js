"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyFollowUpMutationPlanInMemory = applyFollowUpMutationPlanInMemory;
const validateMutationPlan_1 = require("./validateMutationPlan");
function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
}
function normalizeState(state) {
    return {
        actions: Array.isArray(state.actions) ? state.actions.map((action) => ({ ...action, blockReasons: [...action.blockReasons] })) : [],
        auditEvents: Array.isArray(state.auditEvents) ? state.auditEvents.map((event) => ({ ...event, metadata: { ...event.metadata } })) : [],
        appliedPlanKeys: Array.isArray(state.appliedPlanKeys) ? [...state.appliedPlanKeys] : []
    };
}
function findActionIndex(actions, actionId) {
    return actions.findIndex((action) => action.actionId === actionId);
}
function isDuplicateActionId(state, actionId) {
    return state.actions.some((action) => action.actionId === actionId);
}
function isDuplicateIdempotencyKey(state, idempotencyKey) {
    return state.actions.some((action) => action.idempotencyKey !== null && action.idempotencyKey === idempotencyKey);
}
function applyFollowUpMutationPlanInMemory(state, plan) {
    const previousState = normalizeState(cloneState(state));
    const validation = (0, validateMutationPlan_1.validateFollowUpMutationPlan)(plan);
    if (!validation.valid || !validation.plan) {
        return {
            applied: false,
            duplicate: false,
            conflict: false,
            rolledBack: false,
            previousState,
            nextState: previousState,
            appliedOperationCount: 0,
            error: validation.reason
        };
    }
    const working = normalizeState(cloneState(previousState));
    if (working.appliedPlanKeys.includes(plan.idempotency.planKey)) {
        return {
            applied: false,
            duplicate: true,
            conflict: false,
            rolledBack: false,
            previousState,
            nextState: previousState,
            appliedOperationCount: 0,
            error: "duplicate_plan_key"
        };
    }
    let appliedOperationCount = 0;
    try {
        for (const operation of plan.operations) {
            if (operation.type === "update_existing_action") {
                const index = findActionIndex(working.actions, operation.patch.actionId);
                if (index < 0) {
                    throw new Error("conflict_missing_action");
                }
                const current = working.actions[index];
                if (!operation.patch.expectedStatuses.includes(current.status)) {
                    throw new Error("optimistic_status_conflict");
                }
                if (operation.patch.nextStatus === "scheduled" || operation.patch.nextStatus === "planned") {
                    if (["cancelled", "expired", "executed", "rejected", "blocked", "failed"].includes(current.status)) {
                        throw new Error("terminal_action_immutable");
                    }
                }
                working.actions[index] = {
                    ...current,
                    status: operation.patch.nextStatus,
                    scheduledFor: operation.patch.scheduledFor !== undefined ? operation.patch.scheduledFor : current.scheduledFor,
                    expiresAt: operation.patch.expiresAt !== undefined ? operation.patch.expiresAt : current.expiresAt,
                    cancelReason: operation.patch.cancelReason !== undefined ? operation.patch.cancelReason : current.cancelReason,
                    blockReasons: operation.patch.blockReasons !== undefined ? [...operation.patch.blockReasons] : current.blockReasons,
                    supersededByActionId: operation.patch.supersededByActionId !== undefined ? operation.patch.supersededByActionId : current.supersededByActionId,
                    updatedAt: operation.patch.updatedAt
                };
                appliedOperationCount += 1;
                continue;
            }
            if (operation.type === "create_replacement_action") {
                if (isDuplicateActionId(working, operation.action.actionId)) {
                    throw new Error("duplicate_action_id");
                }
                if (isDuplicateIdempotencyKey(working, operation.action.idempotencyKey)) {
                    throw new Error("duplicate_idempotency_key");
                }
                working.actions.push({
                    rowId: null,
                    actionId: operation.action.actionId,
                    idempotencyKey: operation.action.idempotencyKey,
                    actionType: operation.action.actionType,
                    status: operation.action.status,
                    scheduledFor: operation.action.scheduledFor,
                    expiresAt: operation.action.expiresAt,
                    attemptCount: operation.action.attemptCount,
                    maxAttempts: operation.action.maxAttempts,
                    riskLevel: operation.action.riskLevel,
                    approvalRequirement: operation.action.approvalRequirement,
                    opportunityId: operation.action.opportunityId,
                    conversationCaseId: operation.action.conversationCaseId,
                    waId: operation.action.waId,
                    draftMessage: operation.action.draftMessage,
                    finalMessage: operation.action.finalMessage,
                    blockReasons: [],
                    cancelReason: null,
                    supersededByActionId: null,
                    parentActionId: operation.action.parentActionId,
                    generation: operation.action.generation,
                    lifecycleVersion: operation.action.lifecycleVersion,
                    policyVersion: operation.action.policyVersion,
                    runtimeVersion: operation.action.runtimeVersion,
                    createdAt: operation.action.createdAt,
                    updatedAt: operation.action.updatedAt
                });
                appliedOperationCount += 1;
                continue;
            }
            if (operation.type === "append_audit_event") {
                if (working.auditEvents.some((event) => event.eventId === operation.event.eventId)) {
                    throw new Error("duplicate_audit_event_id");
                }
                working.auditEvents.push({
                    ...operation.event,
                    metadata: { ...operation.event.metadata }
                });
                appliedOperationCount += 1;
            }
        }
        working.appliedPlanKeys.push(plan.idempotency.planKey);
        return {
            applied: true,
            duplicate: false,
            conflict: false,
            rolledBack: false,
            previousState,
            nextState: working,
            appliedOperationCount,
            error: null
        };
    }
    catch (error) {
        return {
            applied: false,
            duplicate: String(error instanceof Error ? error.message : error).includes("duplicate"),
            conflict: !String(error instanceof Error ? error.message : error).includes("duplicate"),
            rolledBack: true,
            previousState,
            nextState: previousState,
            appliedOperationCount: 0,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
