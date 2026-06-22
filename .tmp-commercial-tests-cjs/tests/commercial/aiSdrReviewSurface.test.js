"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const react_1 = require("react");
const server_1 = require("react-dom/server");
const review_1 = require("../../lib/brain/commercial/review");
const evaluation_1 = require("../../lib/brain/commercial/evaluation");
const providers_1 = require("../../lib/brain/commercial/sales-agent/providers");
const runCommercialShadowEvaluation_1 = require("../../lib/brain/commercial/shadow/runCommercialShadowEvaluation");
const fixtures_1 = require("./fixtures");
const AiSdrReviewPanel_1 = require("../../components/cases/ai-sdr/AiSdrReviewPanel");
const AiSdrHumanEvaluationDraft_1 = require("../../components/cases/ai-sdr/AiSdrHumanEvaluationDraft");
const IDENTIFIERS = {
    correlationId: "corr-ui-001",
    processInboundRunId: "process-ui-001",
    salesAgentRunId: "sales-ui-001",
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
            executionId: "exec-ui-001",
            provider: (0, providers_1.createFakeSalesAgentProvider)({ behavior }),
            shadowFlags: (0, fixtures_1.makeCommercialShadowFlags)()
        })
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
        policyResult.actionAssessments = [
            {
                status: "blocked",
                action: {
                    type: "create_lead",
                    reason: "Blocked for UI coverage",
                    confidence: "low",
                    riskLevel: "blocked",
                    requiresApproval: "blocked"
                },
                reason: "Hard blocked action"
            }
        ];
        policyResult.governedResult = {
            ...policyResult.governedResult,
            outcome: "blocked_by_policy"
        };
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
            scenario: "commercial-shadow-review-ui",
            expectedTags: [],
            shadowResult: shadowResult
        }),
        metadata: {
            safeTraceId: "trace-ui-001"
        }
    });
}
(0, node_test_1.default)("renders the available AI SDR surface", async () => {
    const review = await buildAvailableReview("valid");
    const markup = (0, server_1.renderToStaticMarkup)((0, react_1.createElement)(AiSdrReviewPanel_1.AiSdrReviewPanel, { caseId: IDENTIFIERS.caseId, review }));
    strict_1.default.ok(markup.includes("AI SDR"));
    strict_1.default.ok(markup.includes("Claims"));
    strict_1.default.ok(markup.includes("Acciones y tools"));
    strict_1.default.ok(markup.includes("Policy y trazabilidad"));
    strict_1.default.ok(markup.includes("Observabilidad"));
    strict_1.default.ok(markup.includes("Side effects"));
    strict_1.default.ok(markup.includes("Borrador local no guardado"));
    strict_1.default.ok(markup.includes("Preparar evaluación"));
});
(0, node_test_1.default)("renders empty, disabled, and error states", () => {
    const notFound = (0, review_1.buildCommercialShadowReview)({
        status: "not_found",
        identifiers: IDENTIFIERS
    });
    const disabled = (0, review_1.buildCommercialShadowReview)({
        status: "disabled",
        identifiers: IDENTIFIERS
    });
    const error = (0, review_1.buildCommercialShadowReview)({
        status: "error",
        identifiers: IDENTIFIERS,
        reason: "Read failed",
        error: new Error("Authorization: Bearer sk-test-123")
    });
    const notFoundMarkup = (0, server_1.renderToStaticMarkup)((0, react_1.createElement)(AiSdrReviewPanel_1.AiSdrReviewPanel, { caseId: IDENTIFIERS.caseId, review: notFound }));
    const disabledMarkup = (0, server_1.renderToStaticMarkup)((0, react_1.createElement)(AiSdrReviewPanel_1.AiSdrReviewPanel, { caseId: IDENTIFIERS.caseId, review: disabled }));
    const errorMarkup = (0, server_1.renderToStaticMarkup)((0, react_1.createElement)(AiSdrReviewPanel_1.AiSdrReviewPanel, { caseId: IDENTIFIERS.caseId, review: error }));
    strict_1.default.ok(notFoundMarkup.includes("No existe una observación AI SDR"));
    strict_1.default.ok(disabledMarkup.includes("AI SDR deshabilitado"));
    strict_1.default.ok(errorMarkup.includes("Error seguro"));
    strict_1.default.ok(errorMarkup.includes("sk-test-123") === false);
});
(0, node_test_1.default)("renders failed_safe and policy blocked distinctions", async () => {
    const failedSafeReview = await buildAvailableReview("invalid");
    const blockedReview = await buildAvailableReview("hard_blocked_action");
    const failedSafeMarkup = (0, server_1.renderToStaticMarkup)((0, react_1.createElement)(AiSdrReviewPanel_1.AiSdrReviewPanel, { caseId: IDENTIFIERS.caseId, review: failedSafeReview }));
    const blockedMarkup = (0, server_1.renderToStaticMarkup)((0, react_1.createElement)(AiSdrReviewPanel_1.AiSdrReviewPanel, { caseId: IDENTIFIERS.caseId, review: blockedReview }));
    strict_1.default.ok(failedSafeMarkup.includes("failed_safe"));
    strict_1.default.ok(blockedMarkup.includes("Policy bloqueó la salida"));
});
(0, node_test_1.default)("builds a local evaluation preview without persistence", async () => {
    const review = await buildAvailableReview("valid");
    const preview = (0, AiSdrHumanEvaluationDraft_1.buildCommercialHumanEvaluationDraftPreview)({
        caseId: IDENTIFIERS.caseId,
        review,
        preparedAt: "2026-06-17T12:00:00.000Z",
        form: {
            responseUseful: "yes",
            responseCorrect: "no",
            policyTooRestrictive: "unreviewed",
            missingContext: "yes",
            expectedOutcome: "Respuesta útil y segura",
            comments: "Sin persistencia"
        }
    });
    strict_1.default.equal(preview.caseId, IDENTIFIERS.caseId);
    strict_1.default.equal(preview.responseUseful, true);
    strict_1.default.equal(preview.responseCorrect, false);
    strict_1.default.equal(preview.policyTooRestrictive, null);
    strict_1.default.equal(preview.missingContext, true);
    strict_1.default.equal(preview.reviewSummary.policyStatus, "requires_review");
    strict_1.default.doesNotThrow(() => JSON.stringify(preview));
    const markup = (0, server_1.renderToStaticMarkup)((0, react_1.createElement)(AiSdrHumanEvaluationDraft_1.AiSdrHumanEvaluationDraft, { caseId: IDENTIFIERS.caseId, review }));
    strict_1.default.ok(markup.includes("Respuesta útil"));
    strict_1.default.ok(markup.includes("Respuesta correcta"));
    strict_1.default.ok(markup.includes("policy too restrictive") === false);
});
