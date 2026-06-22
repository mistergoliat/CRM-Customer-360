"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryAutonomousCommercialRuntime = void 0;
exports.createEmptyAutonomousLoopRuntimeSnapshot = createEmptyAutonomousLoopRuntimeSnapshot;
const constants_1 = require("./constants");
function createEmptyState() {
    return {
        opportunities: [],
        decisions: [],
        actions: [],
        outbox: [],
        deliveryResults: [],
        followUpMutationPlans: [],
        auditEvents: [],
        processedCorrelationIds: [],
        processedProviderMessageIds: [],
        updatedAt: null
    };
}
function normalizeState(state) {
    return {
        opportunities: Array.isArray(state.opportunities) ? state.opportunities.map((item) => ({ ...item })) : [],
        decisions: Array.isArray(state.decisions) ? state.decisions.map((item) => ({ ...item })) : [],
        actions: Array.isArray(state.actions) ? state.actions.map((item) => ({ ...item })) : [],
        outbox: Array.isArray(state.outbox) ? state.outbox.map((item) => (0, constants_1.cloneDeep)(item)) : [],
        deliveryResults: Array.isArray(state.deliveryResults) ? state.deliveryResults.map((item) => ({ ...item })) : [],
        followUpMutationPlans: Array.isArray(state.followUpMutationPlans) ? state.followUpMutationPlans.map((item) => (0, constants_1.cloneDeep)(item)) : [],
        auditEvents: Array.isArray(state.auditEvents) ? state.auditEvents.map((item) => (0, constants_1.cloneDeep)(item)) : [],
        processedCorrelationIds: Array.isArray(state.processedCorrelationIds) ? [...new Set(state.processedCorrelationIds)] : [],
        processedProviderMessageIds: Array.isArray(state.processedProviderMessageIds) ? [...new Set(state.processedProviderMessageIds)] : [],
        updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : null
    };
}
function snapshotState(state) {
    return {
        ...normalizeState(state)
    };
}
class InMemoryAutonomousCommercialRuntime {
    state;
    constructor(initialState = {}) {
        this.state = normalizeState({
            ...createEmptyState(),
            ...initialState
        });
    }
    seedSnapshot(snapshot) {
        this.state = normalizeState({
            ...createEmptyState(),
            ...snapshot
        });
    }
    snapshotState() {
        return normalizeState(this.state);
    }
    async runAtomic(operation) {
        const staged = normalizeState((0, constants_1.cloneDeep)(this.state));
        const result = await operation(staged);
        this.state = normalizeState(staged);
        return result;
    }
    async hasProcessedCorrelationId(correlationId) {
        return this.state.processedCorrelationIds.includes(correlationId);
    }
    async hasProcessedProviderMessageId(providerMessageId) {
        return this.state.processedProviderMessageIds.includes(providerMessageId);
    }
    getSnapshot() {
        return snapshotState(this.state);
    }
    recordAuditEvent(event) {
        this.state.auditEvents.push((0, constants_1.cloneDeep)(event));
        this.state.updatedAt = event.createdAt;
    }
}
exports.InMemoryAutonomousCommercialRuntime = InMemoryAutonomousCommercialRuntime;
function createEmptyAutonomousLoopRuntimeSnapshot() {
    return snapshotState(createEmptyState());
}
