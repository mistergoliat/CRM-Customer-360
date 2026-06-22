"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const review_1 = require("../../lib/brain/commercial/review");
const evaluation_1 = require("../../lib/brain/commercial/evaluation");
const providers_1 = require("../../lib/brain/commercial/sales-agent/providers");
const runCommercialShadowEvaluation_1 = require("../../lib/brain/commercial/shadow/runCommercialShadowEvaluation");
const fixtures_1 = require("./fixtures");
const IDENTIFIERS = {
    correlationId: "corr-review-001",
    processInboundRunId: "process-inbound-001",
    salesAgentRunId: "sales-agent-001",
    caseId: 4821,
    conversationCaseId: 4821,
    waId: "56912345678",
    email: "cliente@example.com",
    phone: "+56912345678",
    idCustomer: 10045,
    idOrder: 20001,
    invoiceNumber: 30001
};
async function buildAvailableReview(behavior = "valid") {
    const result = await (0, runCommercialShadowEvaluation_1.runCommercialShadowEvaluation)({
        ...(0, fixtures_1.makeCommercialShadowInput)({
            correlationId: IDENTIFIERS.correlationId,
            executionId: "exec-review-001",
            provider: (0, providers_1.createFakeSalesAgentProvider)({ behavior }),
            shadowFlags: (0, fixtures_1.makeCommercialShadowFlags)()
        }),
        metadata: {
            safeTraceId: "trace-review-001",
            token: "secret-token",
            rawWebhook: { hidden: true }
        }
    });
    const shadowResult = structuredClone(result);
    const context = shadowResult.context;
    const runtimeResult = context?.runtimeResult;
    const policyResult = context?.policyResult;
    if (behavior === "invalid") {
        shadowResult.status = "failed_safe";
        if (runtimeResult) {
            runtimeResult.status = "validation_failed_safe";
            const resultPayload = runtimeResult.result;
            if (resultPayload) {
                resultPayload.outcome = "failed_safe";
                const decision = resultPayload.decision;
                if (decision)
                    decision.requiresApproval = "blocked";
            }
            const validation = runtimeResult.validation;
            if (validation)
                validation.status = "failed_safe";
        }
        if (policyResult?.governedResult && typeof policyResult.governedResult === "object") {
            policyResult.governedResult.outcome = "failed_safe";
        }
    }
    if (behavior === "hard_blocked_action" && policyResult) {
        policyResult.status = "blocked";
        policyResult.overallDecision = "blocked";
        policyResult.riskLevel = "blocked";
        policyResult.requiresApproval = "blocked";
        policyResult.appliedRules = ["POLICY-HARD-BLOCK"];
        policyResult.claimAssessments = [];
        policyResult.actionAssessments = [
            {
                status: "blocked",
                action: {
                    type: "create_lead",
                    reason: "Blocked for review coverage",
                    confidence: "low",
                    riskLevel: "blocked",
                    requiresApproval: "blocked"
                },
                reason: "Hard blocked action"
            }
        ];
        policyResult.toolRequestAssessments = [];
        policyResult.entityProposalAssessments = [];
        policyResult.governedResult = {
            ...policyResult.governedResult,
            outcome: "blocked_by_policy",
            proposedActions: [
                {
                    type: "create_lead",
                    reason: "Blocked for review coverage",
                    confidence: "low",
                    riskLevel: "blocked",
                    requiresApproval: "blocked"
                }
            ]
        };
    }
    if (behavior === "sensitive_claim_without_evidence" && policyResult) {
        policyResult.status = "blocked";
        policyResult.overallDecision = "blocked";
        policyResult.riskLevel = "blocked";
        policyResult.requiresApproval = "blocked";
        policyResult.appliedRules = ["POLICY-CLAIM-BLOCK"];
        policyResult.claimAssessments = [
            {
                status: "blocked",
                claim: {
                    type: "price",
                    value: "999",
                    evidence: [],
                    evidenceSource: "customer_message",
                    confidence: "low"
                },
                reason: "Sensitive claim without evidence",
                ruleIds: ["POLICY-CLAIM-BLOCK"]
            }
        ];
    }
    if (behavior === "valid_tool_request") {
        const toolRequest = {
            tool: "searchKnowledge",
            purpose: "lookup product details",
            status: "planned",
            requiredInputs: {},
            optionalInputs: {},
            urgency: "normal",
            blocking: false,
            reason: "Tool request coverage",
            expectedEvidence: ["knowledge_base"],
            fallbackDecision: "respond_now"
        };
        if (runtimeResult) {
            runtimeResult.toolRequests = [toolRequest];
        }
        if (policyResult) {
            policyResult.governedResult = {
                ...policyResult.governedResult,
                toolRequests: [toolRequest]
            };
        }
    }
    return (0, review_1.buildCommercialShadowReview)({
        status: "available",
        identifiers: IDENTIFIERS,
        observedAt: result.observedAt,
        correlationId: IDENTIFIERS.correlationId,
        processInboundRunId: IDENTIFIERS.processInboundRunId,
        salesAgentRunId: IDENTIFIERS.salesAgentRunId,
        shadowResult: shadowResult,
        evaluationResult: (0, evaluation_1.evaluateCommercialShadowResult)({
            sampleId: IDENTIFIERS.salesAgentRunId,
            timestamp: result.observedAt,
            scenario: "commercial-shadow-review",
            expectedTags: [],
            shadowResult: shadowResult
        }),
        warnings: ["review_fixture"],
        metadata: {
            safeTraceId: "trace-review-001",
            token: "secret-token",
            rawWebhook: { hidden: true }
        }
    });
}
(0, node_test_1.default)("maps a complete available observation", async () => {
    const review = await buildAvailableReview("valid");
    strict_1.default.equal(review.status, "available");
    strict_1.default.equal(review.identifiers.correlationId, IDENTIFIERS.correlationId);
    strict_1.default.equal(review.summary?.policyStatus, "requires_review");
    strict_1.default.equal(review.summary?.proposedOutcome, "response_proposed");
    strict_1.default.equal(review.summary?.governedOutcome, "response_proposed");
    strict_1.default.equal(review.summary?.proposedShouldRespondNow, true);
    strict_1.default.equal(review.summary?.governedShouldRespondNow, false);
    strict_1.default.equal(review.observability.provider, "fake-sales-agent-provider");
    strict_1.default.equal(review.invariants.violationDetected, false);
    strict_1.default.ok(review.warnings.includes("review_fixture"));
    strict_1.default.equal(Object.prototype.hasOwnProperty.call(review.metadata, "token"), false);
    strict_1.default.doesNotThrow(() => JSON.stringify(review));
});
(0, node_test_1.default)("marks failed_safe observations explicitly", async () => {
    const review = await buildAvailableReview("invalid");
    strict_1.default.equal(review.status, "available");
    strict_1.default.equal(review.summary?.runtimeStatus, "validation_failed_safe");
    strict_1.default.equal(review.summary?.governedOutcome, "failed_safe");
    strict_1.default.equal(review.evaluation.status, "failed_safe");
    strict_1.default.doesNotThrow(() => JSON.stringify(review));
});
(0, node_test_1.default)("distinguishes the agent proposal from the governed policy result", async () => {
    const review = await buildAvailableReview("hard_blocked_action");
    strict_1.default.equal(review.summary?.proposedOutcome, "response_proposed");
    strict_1.default.equal(review.summary?.policyStatus, "blocked");
    strict_1.default.equal(review.summary?.governedOutcome, "blocked_by_policy");
    strict_1.default.notStrictEqual(review.summary?.governedOutcome, review.summary?.proposedOutcome);
    strict_1.default.ok(review.actions.blocked.length > 0);
});
(0, node_test_1.default)("preserves blocked claims and blocked actions", async () => {
    const blockedClaimsReview = await buildAvailableReview("sensitive_claim_without_evidence");
    const blockedActionsReview = await buildAvailableReview("hard_blocked_action");
    strict_1.default.ok(blockedClaimsReview.claims.blocked.length > 0);
    strict_1.default.ok(blockedClaimsReview.claims.blocked.some((claim) => claim.status === "blocked"));
    strict_1.default.ok(blockedClaimsReview.claims.blocked.some((claim) => claim.type === "price"));
    strict_1.default.ok(blockedActionsReview.actions.blocked.length > 0);
    strict_1.default.ok(blockedActionsReview.actions.blocked.some((action) => action.status === "blocked"));
});
(0, node_test_1.default)("preserves blocked tool requests and tool availability", async () => {
    const review = await buildAvailableReview("valid_tool_request");
    strict_1.default.ok(review.toolRequests.proposed.length > 0);
    strict_1.default.equal(review.toolRequests.proposed[0]?.available, true);
    strict_1.default.ok(review.toolRequests.proposed[0] !== undefined);
    strict_1.default.doesNotThrow(() => JSON.stringify(review));
});
(0, node_test_1.default)("sanitizes metadata and preserves partial metrics", async () => {
    const review = await buildAvailableReview("valid");
    strict_1.default.equal(Object.prototype.hasOwnProperty.call(review.metadata, "rawWebhook"), false);
    strict_1.default.equal(review.observability.inputTokens, 128);
    strict_1.default.equal(review.observability.outputTokens, 256);
    strict_1.default.equal(review.observability.totalTokens, 384);
    strict_1.default.equal(review.observability.estimatedCost, 0);
    strict_1.default.doesNotThrow(() => JSON.stringify(review));
});
(0, node_test_1.default)("keeps undefined as unknown and zero as zero", async () => {
    const source = await (0, runCommercialShadowEvaluation_1.runCommercialShadowEvaluation)({
        ...(0, fixtures_1.makeCommercialShadowInput)({
            correlationId: IDENTIFIERS.correlationId,
            executionId: "exec-review-002",
            provider: (0, providers_1.createFakeSalesAgentProvider)({ behavior: "valid" }),
            shadowFlags: (0, fixtures_1.makeCommercialShadowFlags)()
        })
    });
    const partial = structuredClone(source);
    if (partial.context?.runtimeResult?.result && typeof partial.context.runtimeResult.result === "object") {
        const runtimeResult = partial.context.runtimeResult.result;
        runtimeResult.responseProposal = {
            ...runtimeResult.responseProposal,
            claims: undefined,
            questions: undefined
        };
        runtimeResult.proposedActions = undefined;
        runtimeResult.toolRequests = undefined;
        runtimeResult.entityProposals = undefined;
    }
    if (partial.context?.runtimeResult?.metrics && typeof partial.context.runtimeResult.metrics === "object") {
        const runtimeMetrics = partial.context.runtimeResult.metrics;
        runtimeMetrics.inputTokens = null;
        runtimeMetrics.outputTokens = 0;
    }
    partial.metrics.inputTokens = null;
    partial.metrics.outputTokens = 0;
    const rebuilt = (0, review_1.buildCommercialShadowReview)({
        status: "available",
        identifiers: IDENTIFIERS,
        observedAt: partial.observedAt,
        correlationId: IDENTIFIERS.correlationId,
        processInboundRunId: IDENTIFIERS.processInboundRunId,
        salesAgentRunId: IDENTIFIERS.salesAgentRunId,
        shadowResult: partial,
        evaluationResult: null,
        metadata: { safeTraceId: "trace-review-001" }
    });
    strict_1.default.equal(rebuilt.observability.inputTokens, null);
    strict_1.default.equal(rebuilt.observability.outputTokens, 0);
    strict_1.default.equal(rebuilt.observability.totalTokens, null);
    strict_1.default.equal(rebuilt.claims.detected.length, 0);
    strict_1.default.equal(rebuilt.actions.proposed.length, 0);
    strict_1.default.equal(rebuilt.toolRequests.proposed.length, 0);
});
(0, node_test_1.default)("returns not_found, disabled, and error states", () => {
    const notFound = (0, review_1.buildCommercialShadowReview)({
        status: "not_found",
        identifiers: IDENTIFIERS,
        reason: "No observation"
    });
    const disabled = (0, review_1.buildCommercialShadowReview)({
        status: "disabled",
        identifiers: IDENTIFIERS,
        reason: "Feature flag disabled"
    });
    const error = (0, review_1.buildCommercialShadowReview)({
        status: "error",
        identifiers: IDENTIFIERS,
        reason: "Read failed",
        error: new Error("Authorization: Bearer sk-test-123")
    });
    strict_1.default.equal(notFound.status, "not_found");
    strict_1.default.equal(disabled.status, "disabled");
    strict_1.default.equal(error.status, "error");
    strict_1.default.equal(error.error?.message.includes("sk-test-123"), false);
});
(0, node_test_1.default)("detects side effect invariants and remains deterministic", async () => {
    const first = await buildAvailableReview("valid");
    const second = await buildAvailableReview("valid");
    strict_1.default.deepEqual(first, second);
    strict_1.default.equal(first.invariants.shadow, true);
    strict_1.default.equal(first.invariants.dryRun, true);
    strict_1.default.equal(first.invariants.outboundExecuted, false);
    strict_1.default.equal(first.invariants.toolsExecuted, 0);
    strict_1.default.equal(first.invariants.commercialDbWrites, 0);
    strict_1.default.equal(first.invariants.leadCreated, false);
    strict_1.default.equal(first.invariants.opportunityCreated, false);
    strict_1.default.equal(first.invariants.caseMutated, false);
    strict_1.default.equal(first.invariants.controlsResponsePolicy, false);
});
