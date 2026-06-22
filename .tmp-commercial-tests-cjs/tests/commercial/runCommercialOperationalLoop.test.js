"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const fakeSalesAgentProvider_1 = require("../../lib/brain/commercial/sales-agent/providers/fakeSalesAgentProvider");
const runtimeTypes_1 = require("../../lib/brain/commercial/sales-agent/runtimeTypes");
const runCommercialShadowEvaluation_1 = require("../../lib/brain/commercial/shadow/runCommercialShadowEvaluation");
const runCommercialOperationalLoop_1 = require("../../lib/brain/commercial/operational-loop/runCommercialOperationalLoop");
const fixtures_1 = require("./fixtures");
function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}
async function buildShadowResult(behavior = "valid") {
    const shadowInput = (0, fixtures_1.makeCommercialShadowInput)({
        provider: (0, fakeSalesAgentProvider_1.createFakeSalesAgentProvider)({ behavior })
    });
    return (0, runCommercialShadowEvaluation_1.runCommercialShadowEvaluation)(shadowInput);
}
function makePersistedStateSummary(state) {
    if (!state) {
        return {
            status: "not_found",
            candidates: [],
            activeState: null,
            latestDecision: null,
            warnings: [],
            metadata: {}
        };
    }
    return {
        status: "loaded",
        candidates: [state],
        activeState: state,
        latestDecision: null,
        warnings: [],
        metadata: {}
    };
}
function makeMemoryStorage(initialState = null, persistMode = "persisted") {
    let currentState = initialState;
    const seenDecisionIds = new Set();
    const calls = {
        load: 0,
        persist: 0
    };
    const storage = {
        async loadCommercialState() {
            calls.load += 1;
            return makePersistedStateSummary(currentState);
        },
        async persistCommercialState(input) {
            calls.persist += 1;
            if (persistMode === "failed_safe") {
                return {
                    status: "failed_safe",
                    opportunityWritten: false,
                    decisionWritten: false,
                    opportunityId: currentState?.opportunityId ?? null,
                    opportunityKey: input.resultingState.opportunityKey,
                    decisionId: input.decisionRecord.decisionId,
                    version: null,
                    createdAt: fixtures_1.FIXED_TIME,
                    warnings: ["commercial_state_persistence_failed"],
                    reason: "Persistence failed."
                };
            }
            if (persistMode === "conflict") {
                return {
                    status: "conflict",
                    opportunityWritten: false,
                    decisionWritten: false,
                    opportunityId: currentState?.opportunityId ?? null,
                    opportunityKey: input.resultingState.opportunityKey,
                    decisionId: input.decisionRecord.decisionId,
                    version: currentState?.version ?? null,
                    createdAt: fixtures_1.FIXED_TIME,
                    warnings: ["commercial_state_conflict"],
                    reason: "Optimistic version conflict."
                };
            }
            if (persistMode === "duplicate") {
                return {
                    status: "duplicate",
                    opportunityWritten: false,
                    decisionWritten: false,
                    opportunityId: currentState?.opportunityId ?? null,
                    opportunityKey: input.resultingState.opportunityKey,
                    decisionId: input.decisionRecord.decisionId,
                    version: currentState?.version ?? input.resultingState.version,
                    createdAt: fixtures_1.FIXED_TIME,
                    warnings: ["commercial_state_retry_reused"],
                    reason: "Duplicate decision id."
                };
            }
            if (seenDecisionIds.has(input.decisionRecord.decisionId)) {
                return {
                    status: "duplicate",
                    opportunityWritten: false,
                    decisionWritten: false,
                    opportunityId: currentState?.opportunityId ?? null,
                    opportunityKey: input.resultingState.opportunityKey,
                    decisionId: input.decisionRecord.decisionId,
                    version: currentState?.version ?? input.resultingState.version,
                    createdAt: fixtures_1.FIXED_TIME,
                    warnings: ["commercial_state_retry_reused"],
                    reason: "Duplicate decision id."
                };
            }
            seenDecisionIds.add(input.decisionRecord.decisionId);
            currentState = input.resultingState;
            return {
                status: "persisted",
                opportunityWritten: true,
                decisionWritten: true,
                opportunityId: currentState?.opportunityId ?? null,
                opportunityKey: input.resultingState.opportunityKey,
                decisionId: input.decisionRecord.decisionId,
                version: input.resultingState.version,
                createdAt: fixtures_1.FIXED_TIME,
                warnings: [],
                reason: null
            };
        }
    };
    return { storage, calls, getCurrentState: () => currentState, seenDecisionIds };
}
async function buildLoopInput(overrides = {}) {
    const shadowResult = overrides.commercialShadowResult !== undefined
        ? overrides.commercialShadowResult
        : await buildShadowResult(overrides.behavior ?? "valid");
    const basePolicyResult = shadowResult?.context?.policyResult ?? null;
    if (!shadowResult) {
        return {
            inboundMessage: (0, fixtures_1.makeCommercialShadowInput)().inboundMessage,
            brainContext: (0, fixtures_1.makeCommercialShadowInput)().brainContext,
            commercialContext: null,
            salesAgentResult: null,
            commercialPolicyResult: overrides.commercialPolicyResult ?? null,
            commercialEvaluationResult: null,
            commercialShadowResult: null,
            currentTime: overrides.currentTime ?? fixtures_1.FIXED_TIME,
            correlationId: overrides.correlationId ?? "corr-001",
            processInboundRunId: overrides.processInboundRunId ?? "pir-001",
            salesAgentRunId: null,
            featureFlags: {
                commercialOperationalLoopEnabled: true,
                commercialStatePersistenceEnabled: false,
                ...(overrides.featureFlags ?? {})
            },
            mode: "shadow",
            contractVersion: runtimeTypes_1.SALES_AGENT_CONTRACT_VERSION,
            policyVersion: "brain.commercial.policy.v1",
            runtimeVersion: runtimeTypes_1.SALES_AGENT_RUNTIME_VERSION,
            promptVersion: runtimeTypes_1.SALES_AGENT_PROMPT_VERSION,
            evaluationVersion: null,
            metadata: {
                safeTraceId: "trace-001"
            },
            abortSignal: null,
            storage: overrides.storage ?? null
        };
    }
    return {
        inboundMessage: shadowResult.context.inboundMessage,
        brainContext: shadowResult.context.brainContext,
        commercialContext: shadowResult.context?.commercialContext ?? null,
        salesAgentResult: shadowResult.context?.runtimeResult?.result ?? null,
        commercialPolicyResult: overrides.commercialPolicyResult ?? basePolicyResult,
        commercialEvaluationResult: null,
        commercialShadowResult: shadowResult,
        currentTime: overrides.currentTime ?? fixtures_1.FIXED_TIME,
        correlationId: overrides.correlationId ?? shadowResult.correlationId,
        processInboundRunId: overrides.processInboundRunId ?? `pir-${shadowResult.correlationId}`,
        salesAgentRunId: shadowResult.context?.runtimeResult?.result?.runId ?? null,
        featureFlags: {
            commercialOperationalLoopEnabled: true,
            commercialStatePersistenceEnabled: false,
            ...(overrides.featureFlags ?? {})
        },
        mode: "shadow",
        contractVersion: shadowResult.versions.contractVersion,
        policyVersion: shadowResult.versions.policyVersion,
        runtimeVersion: shadowResult.versions.runtimeVersion,
        promptVersion: shadowResult.versions.promptVersion,
        evaluationVersion: null,
        metadata: {
            safeTraceId: "trace-001"
        },
        abortSignal: null,
        storage: overrides.storage ?? null
    };
}
function expectCommonLoopInvariants(result) {
    strict_1.default.equal(result.continueLegacyFlow, true);
    strict_1.default.equal(result.sideEffects.outboundExecuted, false);
    strict_1.default.equal(result.sideEffects.toolsExecuted, 0);
    strict_1.default.equal(result.sideEffects.followupScheduled, false);
    strict_1.default.equal(result.sideEffects.quoteCreated, false);
    strict_1.default.equal(result.sideEffects.leadCreated, false);
    strict_1.default.equal(result.sideEffects.caseMutated, false);
    strict_1.default.equal(result.sideEffects.controlsResponsePolicy, false);
    strict_1.default.equal(result.sideEffects.nextActionExecuted, false);
    strict_1.default.equal(result.sideEffects.commercialOpportunityWritten, false);
    strict_1.default.equal(result.sideEffects.commercialDecisionWritten, false);
    strict_1.default.equal(result.selectedNextAction?.executable ?? false, false);
}
(0, node_test_1.default)("loop disabled is skipped and does not touch storage", async () => {
    const storage = makeMemoryStorage();
    const input = await buildLoopInput({
        featureFlags: { commercialOperationalLoopEnabled: false },
        storage: storage.storage
    });
    const result = await (0, runCommercialOperationalLoop_1.runCommercialOperationalLoop)(input);
    strict_1.default.equal(result.status, "skipped");
    strict_1.default.equal(result.skipReason, "skipped_by_flag");
    strict_1.default.equal(storage.calls.load, 0);
    strict_1.default.equal(storage.calls.persist, 0);
    expectCommonLoopInvariants(result);
});
(0, node_test_1.default)("loop skipped when no shadow result exists", async () => {
    const storage = makeMemoryStorage();
    const input = await buildLoopInput({
        commercialShadowResult: null,
        storage: storage.storage
    });
    const result = await (0, runCommercialOperationalLoop_1.runCommercialOperationalLoop)(input);
    strict_1.default.equal(result.status, "skipped");
    strict_1.default.equal(result.skipReason, "no_shadow_result");
    strict_1.default.equal(storage.calls.load, 0);
    strict_1.default.equal(storage.calls.persist, 0);
});
(0, node_test_1.default)("loop completes deterministically for a valid shadow result", async () => {
    const result = await (0, runCommercialOperationalLoop_1.runCommercialOperationalLoop)(await buildLoopInput());
    strict_1.default.equal(result.status, "completed");
    strict_1.default.equal(result.executionDisposition, "observe_only");
    strict_1.default.equal(result.commercialEvaluationSummary?.status !== null, true);
    strict_1.default.equal(result.transitionValidation?.allowed, true);
    strict_1.default.equal(result.decisionRecord?.decisionId.startsWith("commercial-decision-"), true);
    strict_1.default.equal(result.metrics.decisionRecorded, false);
    expectCommonLoopInvariants(result);
});
(0, node_test_1.default)("loop loads and continues an existing opportunity", async () => {
    const seeded = await (0, runCommercialOperationalLoop_1.runCommercialOperationalLoop)(await buildLoopInput());
    const storage = makeMemoryStorage(seeded.resultingState);
    const result = await (0, runCommercialOperationalLoop_1.runCommercialOperationalLoop)(await buildLoopInput({
        storage: storage.storage
    }));
    strict_1.default.equal(result.status, "completed");
    strict_1.default.equal(result.previousState?.opportunityKey, seeded.resultingState?.opportunityKey);
    strict_1.default.equal(result.selectedNextAction?.type, result.selectedNextAction?.type);
    strict_1.default.equal(storage.calls.load, 1);
});
(0, node_test_1.default)("terminal opportunities do not reopen automatically", async () => {
    const seeded = await (0, runCommercialOperationalLoop_1.runCommercialOperationalLoop)(await buildLoopInput());
    const terminalState = {
        ...seeded.resultingState,
        status: "won",
        stage: "closing"
    };
    const storage = makeMemoryStorage(terminalState);
    const result = await (0, runCommercialOperationalLoop_1.runCommercialOperationalLoop)(await buildLoopInput({
        storage: storage.storage
    }));
    strict_1.default.equal(result.status, "completed");
    strict_1.default.equal(result.resultingState?.status, "won");
    strict_1.default.equal(result.selectedNextAction?.type, "no_action");
});
(0, node_test_1.default)("blocked policy keeps the loop read-only", async () => {
    const shadowResult = await buildShadowResult("valid");
    const blockedPolicyResult = {
        ...shadowResult.context.policyResult,
        status: "blocked",
        riskLevel: "blocked",
        requiresApproval: "blocked"
    };
    const result = await (0, runCommercialOperationalLoop_1.runCommercialOperationalLoop)(await buildLoopInput({
        commercialShadowResult: shadowResult,
        commercialPolicyResult: blockedPolicyResult
    }));
    strict_1.default.equal(result.status, "completed");
    strict_1.default.equal(result.selectedNextAction?.type, "no_action");
    strict_1.default.equal(result.transitionValidation?.allowed, true);
});
(0, node_test_1.default)("persistence writes state and decision when enabled", async () => {
    const storage = makeMemoryStorage(null, "persisted");
    const result = await (0, runCommercialOperationalLoop_1.runCommercialOperationalLoop)(await buildLoopInput({
        storage: storage.storage,
        featureFlags: { commercialStatePersistenceEnabled: true }
    }));
    strict_1.default.equal(result.status, "completed");
    strict_1.default.equal(result.persistenceResult?.status, "persisted");
    strict_1.default.equal(result.sideEffects.commercialOpportunityWritten, true);
    strict_1.default.equal(result.sideEffects.commercialDecisionWritten, true);
    strict_1.default.equal(result.executionDisposition, "persisted");
    strict_1.default.equal(storage.calls.persist, 1);
});
(0, node_test_1.default)("duplicate decision ids are not written twice", async () => {
    const storage = makeMemoryStorage(null, "duplicate");
    const result = await (0, runCommercialOperationalLoop_1.runCommercialOperationalLoop)(await buildLoopInput({
        storage: storage.storage,
        featureFlags: { commercialStatePersistenceEnabled: true }
    }));
    strict_1.default.equal(result.persistenceResult?.status, "duplicate");
    strict_1.default.equal(result.sideEffects.commercialOpportunityWritten, false);
    strict_1.default.equal(result.sideEffects.commercialDecisionWritten, false);
});
(0, node_test_1.default)("persistence failures degrade safely", async () => {
    const storage = makeMemoryStorage(null, "failed_safe");
    const result = await (0, runCommercialOperationalLoop_1.runCommercialOperationalLoop)(await buildLoopInput({
        storage: storage.storage,
        featureFlags: { commercialStatePersistenceEnabled: true }
    }));
    strict_1.default.equal(result.status, "persistence_failed");
    strict_1.default.equal(result.persistenceResult?.status, "failed_safe");
    strict_1.default.equal(result.sideEffects.commercialOpportunityWritten, false);
    strict_1.default.equal(result.sideEffects.commercialDecisionWritten, false);
});
(0, node_test_1.default)("operational loop is deterministic and JSON serializable", async () => {
    const input = await buildLoopInput();
    const before = JSON.stringify(input);
    const first = await (0, runCommercialOperationalLoop_1.runCommercialOperationalLoop)(input);
    const second = await (0, runCommercialOperationalLoop_1.runCommercialOperationalLoop)(cloneJson(input));
    strict_1.default.equal(before, JSON.stringify(input));
    strict_1.default.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
    strict_1.default.doesNotThrow(() => JSON.stringify(first));
    strict_1.default.doesNotThrow(() => JSON.stringify(second));
});
