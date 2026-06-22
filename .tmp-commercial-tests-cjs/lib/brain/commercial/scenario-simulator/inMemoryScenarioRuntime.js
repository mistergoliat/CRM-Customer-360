"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryScenarioRuntime = void 0;
const autonomous_loop_1 = require("../autonomous-loop");
function normalizeSnapshot(snapshot = {}) {
    return {
        ...(0, autonomous_loop_1.createEmptyAutonomousLoopRuntimeSnapshot)(),
        ...(0, autonomous_loop_1.cloneDeep)(snapshot),
        opportunities: Array.isArray(snapshot.opportunities) ? (0, autonomous_loop_1.cloneDeep)(snapshot.opportunities) : [],
        decisions: Array.isArray(snapshot.decisions) ? (0, autonomous_loop_1.cloneDeep)(snapshot.decisions) : [],
        actions: Array.isArray(snapshot.actions) ? (0, autonomous_loop_1.cloneDeep)(snapshot.actions) : [],
        outbox: Array.isArray(snapshot.outbox) ? (0, autonomous_loop_1.cloneDeep)(snapshot.outbox) : [],
        deliveryResults: Array.isArray(snapshot.deliveryResults) ? (0, autonomous_loop_1.cloneDeep)(snapshot.deliveryResults) : [],
        followUpMutationPlans: Array.isArray(snapshot.followUpMutationPlans) ? (0, autonomous_loop_1.cloneDeep)(snapshot.followUpMutationPlans) : [],
        auditEvents: Array.isArray(snapshot.auditEvents) ? (0, autonomous_loop_1.cloneDeep)(snapshot.auditEvents) : [],
        processedCorrelationIds: Array.isArray(snapshot.processedCorrelationIds) ? [...new Set(snapshot.processedCorrelationIds)] : [],
        processedProviderMessageIds: Array.isArray(snapshot.processedProviderMessageIds)
            ? [...new Set(snapshot.processedProviderMessageIds)]
            : [],
        updatedAt: typeof snapshot.updatedAt === "string" ? snapshot.updatedAt : null
    };
}
function hasNewOutbox(before, after) {
    return after.outbox.length > before.outbox.length;
}
function hasNewDelivery(before, after) {
    return after.deliveryResults.length > before.deliveryResults.length;
}
function hasNewFollowUpMutation(before, after) {
    return after.followUpMutationPlans.length > before.followUpMutationPlans.length;
}
function hasNewAudit(before, after) {
    return after.auditEvents.length > before.auditEvents.length;
}
class InMemoryScenarioRuntime {
    state;
    failureMode;
    constructor(initialState = {}, failureMode = "none") {
        this.state = normalizeSnapshot(initialState);
        this.failureMode = failureMode;
    }
    replaceSnapshot(snapshot) {
        this.state = normalizeSnapshot(snapshot);
    }
    getSnapshot() {
        return normalizeSnapshot(this.state);
    }
    async runAtomic(operation) {
        const staged = normalizeSnapshot(this.state);
        const before = normalizeSnapshot(this.state);
        const result = await operation(staged);
        if (this.failureMode === "after_outbox" && hasNewOutbox(before, staged)) {
            throw new Error("scenario_rollback_after_outbox");
        }
        if (this.failureMode === "after_delivery" && hasNewDelivery(before, staged)) {
            throw new Error("scenario_rollback_after_delivery");
        }
        if (this.failureMode === "after_follow_up" && hasNewFollowUpMutation(before, staged)) {
            throw new Error("scenario_rollback_after_follow_up");
        }
        if (this.failureMode === "after_audit" && hasNewAudit(before, staged)) {
            throw new Error("scenario_rollback_after_audit");
        }
        this.state = normalizeSnapshot(staged);
        return result;
    }
    async hasProcessedCorrelationId(correlationId) {
        return this.state.processedCorrelationIds.includes(correlationId);
    }
    async hasProcessedProviderMessageId(providerMessageId) {
        return this.state.processedProviderMessageIds.includes(providerMessageId);
    }
}
exports.InMemoryScenarioRuntime = InMemoryScenarioRuntime;
