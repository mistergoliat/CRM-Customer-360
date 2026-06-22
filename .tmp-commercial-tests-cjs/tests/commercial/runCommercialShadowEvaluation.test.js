"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const fakeSalesAgentProvider_1 = require("../../lib/brain/commercial/sales-agent/providers/fakeSalesAgentProvider");
const runCommercialShadowEvaluation_1 = require("../../lib/brain/commercial/shadow/runCommercialShadowEvaluation");
const shadowConstants_1 = require("../../lib/brain/commercial/shadow/shadowConstants");
const fixtures_1 = require("./fixtures");
const runtimeTypes_1 = require("../../lib/brain/commercial/sales-agent/runtimeTypes");
function makeAdvancingClock(stepMs) {
    let current = 0;
    return {
        now: () => {
            current += stepMs;
            return current;
        },
        toISOString: (value) => {
            const date = value instanceof Date ? value : new Date(value);
            return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
        }
    };
}
function makeValidRawOutput(overrides = {}) {
    return {
        runId: "corr-001",
        contractVersion: runtimeTypes_1.SALES_AGENT_CONTRACT_VERSION,
        outcome: "response_proposed",
        analysis: {
            summary: "Consulta de producto con intencion comercial.",
            qualificationState: "qualified",
            customerReadiness: "ready",
            productFit: "good",
            confidence: "high",
            riskLevel: "low",
            reasonCodes: ["customer_message_present"]
        },
        decision: {
            type: "respond_now",
            reason: "Se puede responder.",
            confidence: "high",
            riskLevel: "low",
            requiresApproval: "none",
            errorCode: "none",
            reasonCodes: ["customer_message_present"],
            policyTags: ["commercial_reply"]
        },
        shouldRespondNow: true,
        shouldRequestTool: false,
        shouldRequestHuman: false,
        shouldEvaluateFollowUp: false,
        proposedActions: [],
        toolRequests: [],
        entityProposals: [],
        responseProposal: {
            messageIntent: "answer",
            draftText: "Hola, te comparto la informacion solicitada.",
            language: "es",
            tone: "friendly",
            questions: [],
            claims: [],
            disclaimers: [],
            requiresApproval: "none",
            blockedClaims: [],
            confidence: "high"
        },
        evidence: [
            {
                source: "customer_message",
                summary: "Solicitud comercial explicita.",
                verified: true,
                confidence: "high",
                reference: "msg-001",
                capturedAt: fixtures_1.FIXED_TIME,
                expiresAt: null
            }
        ],
        policyAssessment: {
            status: "allowed",
            blocked: false,
            reason: "Sin bloqueo.",
            confidence: "high",
            riskLevel: "low",
            approvalRequirement: "none",
            errorCode: "none",
            reasonCodes: [],
            policyTags: ["commercial_reply"]
        },
        warnings: [],
        rationale: {
            summary: "Resumen operacional breve.",
            evidence: ["Mensaje inbound del cliente."],
            counterEvidence: [],
            assumptions: [],
            riskFlags: [],
            missingInformation: [],
            policyRulesApplied: ["fail_closed_validation"]
        },
        metadata: {
            traceId: "trace-001"
        },
        ...overrides
    };
}
function makeShadowResult(overrides = {}) {
    return {
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
            startedAt: fixtures_1.FIXED_TIME,
            completedAt: fixtures_1.FIXED_TIME,
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
            contractVersion: runtimeTypes_1.SALES_AGENT_CONTRACT_VERSION,
            promptVersion: runtimeTypes_1.SALES_AGENT_PROMPT_VERSION,
            policyVersion: "brain.commercial.policy.v1",
            runtimeVersion: "sales-agent-runtime-dry-run-v0.1.0"
        },
        metadata: {
            safeTraceId: "trace-001"
        },
        observedAt: fixtures_1.FIXED_TIME,
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
        context: null,
        ...overrides
    };
}
function makeInput(overrides = {}) {
    return (0, fixtures_1.makeCommercialShadowInput)({
        ...overrides,
        shadowFlags: overrides.shadowFlags ?? (0, fixtures_1.makeCommercialShadowFlags)(),
        policyFlags: overrides.policyFlags ?? (0, fixtures_1.makeCommercialPolicyFlags)()
    });
}
function makeStableResult(result) {
    return {
        ...result,
        metadata: {
            ...result.metadata,
            generatedAt: undefined
        },
        telemetry: result.telemetry.map((event) => ({
            ...event,
            durationMs: event.durationMs
        }))
    };
}
(0, node_test_1.default)("shadow disabled does not call the provider", async () => {
    let invoked = 0;
    const provider = {
        name: "spy-provider",
        version: "spy.v1",
        async invoke() {
            invoked += 1;
            return {
                rawOutput: makeValidRawOutput(),
                model: "spy-model",
                inputTokens: 1,
                outputTokens: 1,
                estimatedCost: 0,
                providerRequestId: "spy-request",
                finishReason: "stop",
                metadata: {}
            };
        }
    };
    const result = await (0, runCommercialShadowEvaluation_1.runCommercialShadowEvaluation)(makeInput({
        shadowFlags: {
            ...shadowConstants_1.COMMERCIAL_SHADOW_DEFAULT_FEATURE_FLAGS,
            commercialShadowEnabled: false
        },
        provider: provider
    }));
    strict_1.default.equal(invoked, 0);
    strict_1.default.equal(result.status, "disabled");
    strict_1.default.equal(result.enabled, false);
    strict_1.default.equal(result.executionDisposition, "not_executed");
});
(0, node_test_1.default)("completed shadow keeps zero side effects and stable versions", async () => {
    const result = await (0, runCommercialShadowEvaluation_1.runCommercialShadowEvaluation)(makeInput());
    strict_1.default.equal(result.status, "completed_with_restrictions");
    strict_1.default.equal(result.executionDisposition, "discard_after_observation");
    strict_1.default.deepEqual(result.sideEffects, {
        messagesSent: 0,
        toolsExecuted: 0,
        databaseWrites: 0,
        outboxWrites: 0,
        leadsCreated: 0,
        opportunitiesCreated: 0,
        casesMutated: 0
    });
    strict_1.default.equal(result.runtimeSummary?.status, "completed_valid");
    strict_1.default.equal(result.policySummary?.status !== "failed_safe", true);
    strict_1.default.equal(result.runtimeSummary?.rawOutputCaptured, false);
    strict_1.default.equal(result.runtimeSummary?.promptPreviewIncluded, false);
    strict_1.default.equal(result.versions.shadowVersion, "brain.commercial.shadow.v1");
    strict_1.default.equal(result.versions.contractVersion, runtimeTypes_1.SALES_AGENT_CONTRACT_VERSION);
    strict_1.default.equal(result.versions.promptVersion, runtimeTypes_1.SALES_AGENT_PROMPT_VERSION);
    strict_1.default.equal(result.versions.policyVersion, "brain.commercial.policy.v1");
    strict_1.default.equal(result.versions.runtimeVersion, "sales-agent-runtime-dry-run-v0.1.0");
    strict_1.default.deepEqual(result.stages.map((stage) => stage.stage), ["eligibility", "context_builder", "sales_agent_runtime", "commercial_policy"]);
});
(0, node_test_1.default)("returns context_failed when the builder cannot produce context", async () => {
    const result = await (0, runCommercialShadowEvaluation_1.runCommercialShadowEvaluation)(makeInput({
        brainContext: {},
        requestedMode: "bogus"
    }));
    strict_1.default.equal(result.status, "context_failed");
    strict_1.default.equal(result.eligible, true);
    strict_1.default.equal(result.executionDisposition, "not_executed");
    strict_1.default.equal(result.error?.stage, "context_builder");
});
(0, node_test_1.default)("returns skipped when the inbound is not eligible", async () => {
    const result = await (0, runCommercialShadowEvaluation_1.runCommercialShadowEvaluation)(makeInput({
        inboundMessage: (0, fixtures_1.makeNormalizedInboundMessage)({
            channel: "sms"
        })
    }));
    strict_1.default.equal(result.status, "skipped");
    strict_1.default.equal(result.skipReason, "unsupported_channel");
    strict_1.default.equal(result.executionDisposition, "not_executed");
});
(0, node_test_1.default)("reports review policy outcomes", async () => {
    const commercialEntityContext = {
        ...(0, fixtures_1.makeBrainContextResolveResponse)(),
        lead: {
            id: 1
        },
        opportunity: {
            id: 2
        }
    };
    const allowed = await (0, runCommercialShadowEvaluation_1.runCommercialShadowEvaluation)(makeInput({
        brainContext: commercialEntityContext
    }));
    const review = await (0, runCommercialShadowEvaluation_1.runCommercialShadowEvaluation)(makeInput({
        brainContext: commercialEntityContext,
        provider: (0, fakeSalesAgentProvider_1.createFakeSalesAgentProvider)({ behavior: "valid_tool_request" }),
        shadowFlags: {
            ...(0, fixtures_1.makeCommercialShadowFlags)({ commercialShadowAllowRealProvider: true })
        }
    }));
    strict_1.default.equal(allowed.policySummary?.status, "requires_review");
    strict_1.default.equal(review.policySummary?.status, "requires_review");
});
(0, node_test_1.default)("returns runtime_failed for invalid output and provider unavailable", async () => {
    const invalidOutput = await (0, runCommercialShadowEvaluation_1.runCommercialShadowEvaluation)(makeInput({
        brainContext: {
            ...(0, fixtures_1.makeBrainContextResolveResponse)(),
            lead: {
                id: 1
            },
            opportunity: {
                id: 2
            }
        },
        provider: (0, fakeSalesAgentProvider_1.createFakeSalesAgentProvider)({ behavior: "invalid" }),
        shadowFlags: {
            ...(0, fixtures_1.makeCommercialShadowFlags)({ commercialShadowAllowRealProvider: true })
        }
    }));
    const providerUnavailable = await (0, runCommercialShadowEvaluation_1.runCommercialShadowEvaluation)(makeInput({
        brainContext: {
            ...(0, fixtures_1.makeBrainContextResolveResponse)(),
            lead: {
                id: 1
            },
            opportunity: {
                id: 2
            }
        },
        provider: (0, fakeSalesAgentProvider_1.createFakeSalesAgentProvider)({ behavior: "provider_unavailable" }),
        shadowFlags: {
            ...(0, fixtures_1.makeCommercialShadowFlags)({ commercialShadowAllowRealProvider: true })
        }
    }));
    strict_1.default.equal(invalidOutput.status, "runtime_failed");
    strict_1.default.equal(invalidOutput.runtimeSummary?.status, "validation_failed_safe");
    strict_1.default.equal(providerUnavailable.status, "runtime_failed");
    strict_1.default.equal(providerUnavailable.runtimeSummary?.status, "provider_unavailable");
});
(0, node_test_1.default)("returns policy_failed when policy contract versions mismatch", async () => {
    const result = await (0, runCommercialShadowEvaluation_1.runCommercialShadowEvaluation)(makeInput({
        policyVersion: "brain.commercial.policy.v9"
    }));
    strict_1.default.equal(result.status, "policy_failed");
    strict_1.default.equal(result.policySummary?.status, "failed_safe");
});
(0, node_test_1.default)("times out when the overall budget is exceeded", async () => {
    const result = await (0, runCommercialShadowEvaluation_1.runCommercialShadowEvaluation)(makeInput({
        options: {
            timeoutMs: 1
        },
        clock: makeAdvancingClock(100),
        provider: (0, fakeSalesAgentProvider_1.createFakeSalesAgentProvider)({ behavior: "valid" })
    }));
    strict_1.default.equal(result.status, "timeout");
    strict_1.default.ok(result.warnings.includes("shadow_timeout"));
    strict_1.default.ok(result.warnings.includes("shadow_latency_budget_exceeded"));
});
(0, node_test_1.default)("cancels before executing when the abort signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let invoked = 0;
    const provider = {
        name: "spy-provider",
        async invoke() {
            invoked += 1;
            return {
                rawOutput: makeValidRawOutput(),
                model: "spy-model"
            };
        }
    };
    const result = await (0, runCommercialShadowEvaluation_1.runCommercialShadowEvaluation)(makeInput({
        abortSignal: controller.signal,
        provider: provider
    }));
    strict_1.default.equal(invoked, 0);
    strict_1.default.equal(result.status, "cancelled");
    strict_1.default.equal(result.executionDisposition, "not_executed");
});
(0, node_test_1.default)("blocks a provider when real provider use is disabled", async () => {
    let invoked = 0;
    const spyProvider = {
        name: "spy-provider",
        async invoke() {
            invoked += 1;
            return {
                rawOutput: makeValidRawOutput(),
                model: "spy-model"
            };
        }
    };
    const result = await (0, runCommercialShadowEvaluation_1.runCommercialShadowEvaluation)(makeInput({
        provider: spyProvider,
        shadowFlags: {
            ...(0, fixtures_1.makeCommercialShadowFlags)({ commercialShadowAllowRealProvider: false })
        }
    }));
    strict_1.default.equal(invoked, 0);
    strict_1.default.equal(result.runtimeSummary?.providerName, "fake-sales-agent-provider");
});
(0, node_test_1.default)("sanitizes metadata, remains serializable and deterministic", async () => {
    const metadata = {
        safeTraceId: "trace-001",
        token: "secret-token",
        headers: {
            authorization: "Bearer hidden"
        },
        orderId: 9007199254740993n,
        when: new Date(fixtures_1.FIXED_TIME),
        map: new Map([["k", "v"]]),
        set: new Set(["v"])
    };
    const input = makeInput({
        metadata
    });
    const before = structuredClone(input);
    const first = await (0, runCommercialShadowEvaluation_1.runCommercialShadowEvaluation)(input);
    const second = await (0, runCommercialShadowEvaluation_1.runCommercialShadowEvaluation)(makeInput({ metadata }));
    strict_1.default.deepEqual(input, before);
    strict_1.default.equal(Object.prototype.hasOwnProperty.call(first.metadata, "token"), false);
    strict_1.default.equal(Object.prototype.hasOwnProperty.call(first.metadata, "headers"), false);
    strict_1.default.equal(typeof first.metadata.orderId, "string");
    strict_1.default.equal(first.runtimeSummary?.rawOutputCaptured, false);
    strict_1.default.equal(first.runtimeSummary?.promptPreviewIncluded, false);
    strict_1.default.doesNotThrow(() => JSON.stringify(first));
    strict_1.default.deepEqual(makeStableResult(first), makeStableResult(second));
});
(0, node_test_1.default)("captures safe telemetry and stage metrics", async () => {
    const result = await (0, runCommercialShadowEvaluation_1.runCommercialShadowEvaluation)(makeInput());
    strict_1.default.ok(result.telemetry.length > 0);
    strict_1.default.ok(result.telemetry.every((event) => event.sideEffects.messagesSent === 0 && event.sideEffects.toolsExecuted === 0));
    strict_1.default.ok(result.stages.every((stage) => stage.durationMs >= 0));
});
