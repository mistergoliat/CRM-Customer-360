"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const processInbound_1 = require("../../lib/brain/processInbound");
const runCommercialShadowEvaluation_1 = require("../../lib/brain/commercial/shadow/runCommercialShadowEvaluation");
const fixtures_1 = require("./fixtures");
function pickComparableResponse(result) {
    return {
        ok: result.ok,
        requestId: result.requestId,
        channel: result.channel,
        source: result.source,
        suggested_next_step: result.suggested_next_step,
        action_policy: result.action_policy,
        normalized_action: result.normalized_action,
        blocked_reasons: result.blocked_reasons,
        instructions: {
            version: result.instructions.version,
            continueLegacyFlow: result.instructions.continueLegacyFlow,
            suggestedNextStep: result.instructions.suggestedNextStep
        },
        warnings: result.warnings,
        errors: result.errors,
        aiOrchestrator: result.adapters.aiOrchestrator.status
    };
}
function makeShadowHookResult(status) {
    return {
        ...awaitedShadowTemplate,
        status,
        executionDisposition: status === "completed" ? "observe_only" : "discard_after_observation"
    };
}
const awaitedShadowTemplate = {
    status: "completed",
    mode: "shadow",
    enabled: true,
    eligible: true,
    skipReason: null,
    correlationId: "corr-001",
    executionId: "exec-001",
    commercialContextSummary: null,
    runtimeSummary: null,
    policySummary: null,
    governedResultSummary: null,
    stages: [],
    metrics: {
        startedAt: "2026-06-17T12:00:00.000Z",
        completedAt: "2026-06-17T12:00:00.000Z",
        durationMs: 0,
        eligibilityDurationMs: 0,
        contextBuilderDurationMs: 0,
        runtimeDurationMs: 0,
        validationDurationMs: 0,
        policyDurationMs: 0,
        overheadMs: 0,
        inputCharacters: 1,
        outputCharacters: 1,
        providerDurationMs: 0,
        model: null,
        inputTokens: null,
        outputTokens: null,
        estimatedCost: null,
        providerRequestId: null,
        timedOut: false,
        warningsCount: 0
    },
    warnings: [],
    error: null,
    versions: {
        shadowVersion: "brain.commercial.shadow.v1",
        contractVersion: "sales-agent-output-contract-v1",
        promptVersion: "sales-agent-runtime-v0.1.0",
        policyVersion: "brain.commercial.policy.v1",
        runtimeVersion: "sales-agent-runtime-dry-run-v0.1.0"
    },
    metadata: {},
    observedAt: "2026-06-17T12:00:00.000Z",
    sideEffects: {
        messagesSent: 0,
        toolsExecuted: 0,
        databaseWrites: 0,
        outboxWrites: 0,
        leadsCreated: 0,
        opportunitiesCreated: 0,
        casesMutated: 0
    },
    executionDisposition: "observe_only",
    telemetry: [],
    context: null
};
function makeProcessInboundDeps(shadowHook) {
    let contextCalls = 0;
    let actionCalls = 0;
    let shadowCalls = 0;
    const resolveBackendBrainContext = async () => {
        contextCalls += 1;
        return (0, fixtures_1.makeBrainContextResolveResponse)();
    };
    const resolveBrainAction = async () => {
        actionCalls += 1;
        return (0, fixtures_1.makeBrainActionResolveResponse)();
    };
    const commercialShadowHook = async (input) => {
        shadowCalls += 1;
        if (shadowHook) {
            return shadowHook(input);
        }
        return (0, runCommercialShadowEvaluation_1.runCommercialShadowEvaluation)(input);
    };
    return {
        resolveBackendBrainContext,
        resolveBrainAction,
        commercialShadow: {
            commercialShadowHook,
            commercialShadowFlags: (0, fixtures_1.makeCommercialShadowFlags)()
        },
        counters: {
            get contextCalls() {
                return contextCalls;
            },
            get actionCalls() {
                return actionCalls;
            },
            get shadowCalls() {
                return shadowCalls;
            }
        }
    };
}
(0, node_test_1.default)("shadow disabled does not invoke the shadow hook", async () => {
    const deps = makeProcessInboundDeps(async () => {
        throw new Error("should not be called");
    });
    const request = (0, fixtures_1.makeInboundRequest)();
    const result = await (0, processInbound_1.processInbound)(request, Date.parse("2026-06-17T12:00:00.000Z"), {
        resolveBackendBrainContext: deps.resolveBackendBrainContext,
        resolveBrainAction: deps.resolveBrainAction,
        commercialShadow: {
            commercialShadowHook: deps.commercialShadow.commercialShadowHook,
            commercialShadowFlags: {
                ...(0, fixtures_1.makeCommercialShadowFlags)(),
                commercialShadowEnabled: false
            }
        }
    });
    strict_1.default.equal(deps.counters.shadowCalls, 0);
    strict_1.default.equal(result.adapters.commercialShadow, null);
    strict_1.default.equal(result.ok, true);
});
(0, node_test_1.default)("shadow enabled observes the commercial result without changing the product response", async () => {
    const deps = makeProcessInboundDeps();
    const request = (0, fixtures_1.makeInboundRequest)();
    const startedAt = Date.parse("2026-06-17T12:00:00.000Z");
    const disabledResult = await (0, processInbound_1.processInbound)(request, startedAt, {
        resolveBackendBrainContext: deps.resolveBackendBrainContext,
        resolveBrainAction: deps.resolveBrainAction,
        commercialShadow: {
            commercialShadowHook: deps.commercialShadow.commercialShadowHook,
            commercialShadowFlags: {
                ...(0, fixtures_1.makeCommercialShadowFlags)(),
                commercialShadowEnabled: false
            }
        }
    });
    const enabledResult = await (0, processInbound_1.processInbound)(request, startedAt, {
        resolveBackendBrainContext: deps.resolveBackendBrainContext,
        resolveBrainAction: deps.resolveBrainAction,
        commercialShadow: {
            commercialShadowHook: deps.commercialShadow.commercialShadowHook,
            commercialShadowFlags: (0, fixtures_1.makeCommercialShadowFlags)()
        }
    });
    strict_1.default.ok(enabledResult.adapters.commercialShadow?.status);
    strict_1.default.equal(deps.counters.shadowCalls > 0, true);
    strict_1.default.deepEqual(pickComparableResponse(enabledResult), pickComparableResponse(disabledResult));
    strict_1.default.equal(enabledResult.adapters.commercialShadow?.correlationId, enabledResult.requestId);
});
(0, node_test_1.default)("shadow hook failures do not break inbound", async () => {
    const deps = makeProcessInboundDeps(async () => {
        throw new Error("Authorization: Bearer sk-test-123");
    });
    const result = await (0, processInbound_1.processInbound)((0, fixtures_1.makeInboundRequest)(), Date.parse("2026-06-17T12:00:00.000Z"), {
        resolveBackendBrainContext: deps.resolveBackendBrainContext,
        resolveBrainAction: deps.resolveBrainAction,
        commercialShadow: {
            commercialShadowHook: deps.commercialShadow.commercialShadowHook,
            commercialShadowFlags: (0, fixtures_1.makeCommercialShadowFlags)()
        }
    });
    strict_1.default.equal(result.ok, true);
    strict_1.default.equal(result.adapters.commercialShadow?.status, "failed_safe");
    strict_1.default.equal(result.adapters.commercialShadow?.error?.message.includes("sk-test-123"), false);
});
(0, node_test_1.default)("shadow timeout summaries do not alter inbound", async () => {
    const deps = makeProcessInboundDeps(async () => makeShadowHookResult("timeout"));
    const result = await (0, processInbound_1.processInbound)((0, fixtures_1.makeInboundRequest)(), Date.parse("2026-06-17T12:00:00.000Z"), {
        resolveBackendBrainContext: deps.resolveBackendBrainContext,
        resolveBrainAction: deps.resolveBrainAction,
        commercialShadow: {
            commercialShadowHook: deps.commercialShadow.commercialShadowHook,
            commercialShadowFlags: (0, fixtures_1.makeCommercialShadowFlags)()
        }
    });
    strict_1.default.equal(result.ok, true);
    strict_1.default.equal(result.adapters.commercialShadow?.status, "timeout");
    strict_1.default.equal(result.adapters.commercialShadow?.sideEffects.messagesSent, 0);
});
