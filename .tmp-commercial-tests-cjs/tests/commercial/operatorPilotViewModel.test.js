"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const react_1 = require("react");
const server_1 = require("react-dom/server");
const operator_pilot_1 = require("../../lib/brain/commercial/operator-pilot");
const AiSdrOperatorPilotPanel_1 = require("../../components/cases/ai-sdr/operator-pilot/AiSdrOperatorPilotPanel");
const CASE_ID = 4821;
function makeReview(status, overrides = {}) {
    const base = {
        status,
        observedAt: "2026-06-17T12:00:00.000Z",
        identifiers: {
            correlationId: "corr-operator-pilot-001",
            processInboundRunId: "process-operator-pilot-001",
            salesAgentRunId: "sales-operator-pilot-001",
            caseId: CASE_ID,
            conversationCaseId: CASE_ID,
            waId: "56912345678",
            email: "cliente@example.com",
            phone: "+56912345678",
            idCustomer: 10045,
            idOrder: 20001,
            invoiceNumber: 30001
        },
        summary: status === "available"
            ? {
                shadowStatus: "completed",
                runtimeStatus: "completed_valid",
                validationStatus: "valid",
                proposedOutcome: "response_proposed",
                governedOutcome: "response_proposed",
                proposedConfidence: "high",
                governedConfidence: "high",
                proposedResponse: "Hola, te podemos ayudar.",
                governedResponse: "Hola, te podemos ayudar.",
                proposedShouldRespondNow: true,
                governedShouldRespondNow: true,
                policyStatus: "allowed",
                overallDecision: "allow",
                riskLevel: "low",
                approvalRequirement: "none",
                claimsCount: 0,
                blockedClaimsCount: 0,
                actionsCount: 0,
                blockedActionsCount: 0,
                toolRequestsCount: 0,
                blockedToolRequestsCount: 0,
                entityProposalsCount: 0,
                blockedEntityProposalsCount: 0
            }
            : null,
        claims: { detected: [], allowed: [], blocked: [] },
        actions: { proposed: [], blocked: [] },
        toolRequests: { proposed: [], blocked: [] },
        entityProposals: { proposed: [], blocked: [] },
        policy: {
            appliedRuleIds: ["POLICY-001"],
            hardBlocks: [],
            warnings: [],
            issues: [],
            versions: {
                contractVersion: "commercial.policy.v1",
                policyVersion: "commercial.policy.v1",
                runtimeVersion: "brain.commercial.runtime.v1",
                promptVersion: "sales-agent-runtime-v0.1.0",
                evaluationVersion: "brain.commercial.evaluation.v1"
            }
        },
        observability: {
            totalLatencyMs: 123,
            contextLatencyMs: 10,
            providerLatencyMs: 20,
            runtimeLatencyMs: 30,
            validationLatencyMs: 5,
            policyLatencyMs: 7,
            inputTokens: 111,
            outputTokens: 222,
            totalTokens: 333,
            estimatedCost: 0.12,
            currency: "USD",
            provider: "fake-sales-agent-provider",
            model: "fake-sales-agent",
            timeout: false,
            providerFailure: null,
            readinessStatus: "evaluated",
            readinessDecision: null,
            usefulness: null,
            comparisonStatus: null
        },
        evaluation: {
            status: "evaluated",
            readinessDecision: "READY_FOR_CONTROLLED_PILOT",
            usefulness: "useful",
            comparisonStatus: "aligned",
            reportSummary: "evaluated"
        },
        invariants: {
            shadow: true,
            dryRun: true,
            outboundExecuted: false,
            toolsExecuted: 0,
            commercialDbWrites: 0,
            leadCreated: false,
            opportunityCreated: false,
            caseMutated: false,
            controlsResponsePolicy: false,
            violationDetected: false,
            violations: []
        },
        warnings: [],
        error: null,
        metadata: {
            source: "fixture",
            safeTraceId: "safe-operator-pilot"
        }
    };
    return {
        ...base,
        ...overrides,
        identifiers: overrides.identifiers ?? base.identifiers,
        summary: overrides.summary ?? base.summary,
        claims: overrides.claims ?? base.claims,
        actions: overrides.actions ?? base.actions,
        toolRequests: overrides.toolRequests ?? base.toolRequests,
        entityProposals: overrides.entityProposals ?? base.entityProposals,
        policy: overrides.policy ?? base.policy,
        observability: overrides.observability ?? base.observability,
        evaluation: overrides.evaluation ?? base.evaluation,
        invariants: overrides.invariants ?? base.invariants,
        warnings: overrides.warnings ?? base.warnings,
        error: overrides.error ?? base.error,
        metadata: overrides.metadata ?? base.metadata
    };
}
function makeOperationalResult(overrides = {}) {
    return {
        status: "completed",
        observedAt: "2026-06-17T12:30:00.000Z",
        resultingState: {
            status: "engaged",
            stage: "qualification",
            temperature: "warm",
            priority: "high",
            currentSummary: "Necesita producto y comuna.",
            waitingFor: "customer_reply",
            missingRequirements: ["product", "comuna"]
        },
        selectedNextAction: {
            type: "ask_clarifying_question",
            label: "Pedir contexto",
            reason: "Faltan datos para continuar.",
            confidence: 0.82,
            riskLevel: "low",
            approvalRequirement: "none",
            recommendedChannel: "whatsapp",
            draftMessage: "Hola, para ayudarte, dime que producto necesitas armar y en que comuna estas.",
            executable: false,
            blockedReasons: ["policy_blocked"],
            requiredInformation: ["product", "comuna"]
        },
        decisionRecord: {
            decisionStatus: "recorded",
            nextAction: {
                type: "ask_clarifying_question",
                label: "Pedir contexto"
            }
        },
        warnings: ["operational_loop_fixture"],
        ...overrides
    };
}
(0, node_test_1.default)("maps an available operational result into the operator pilot view model", () => {
    const review = makeReview("available");
    const viewModel = (0, operator_pilot_1.buildAiSdrOperatorPilotViewModel)({
        caseId: CASE_ID,
        caseRow: {
            metadata: {
                token: "secret-token",
                rawWebhook: { hidden: true }
            }
        },
        commercialShadowReview: review,
        commercialOperationalResult: makeOperationalResult()
    });
    strict_1.default.equal(viewModel.status, "available");
    strict_1.default.equal(viewModel.commercialState?.status, "engaged");
    strict_1.default.equal(viewModel.commercialState?.stage, "qualification");
    strict_1.default.equal(viewModel.nextAction?.type, "ask_clarifying_question");
    strict_1.default.equal(viewModel.nextAction?.executable, false);
    strict_1.default.equal(viewModel.operatorControls.canApprove, false);
    strict_1.default.equal(viewModel.operatorControls.canReject, false);
    strict_1.default.ok(viewModel.knownInformation.some((item) => item.label === "Estado comercial"));
    strict_1.default.ok(viewModel.missingInformation.some((item) => item.key === "product"));
    strict_1.default.ok(viewModel.missingInformation.some((item) => item.key === "comuna"));
    strict_1.default.ok((viewModel.nextAction?.draftMessage ?? "").length <= 903);
    strict_1.default.equal(JSON.stringify(viewModel).includes("secret-token"), false);
    strict_1.default.doesNotThrow(() => JSON.stringify(viewModel));
});
(0, node_test_1.default)("maps a partial shadow fallback and keeps executable false", () => {
    const review = makeReview("available");
    const viewModel = (0, operator_pilot_1.buildAiSdrOperatorPilotViewModel)({
        caseId: CASE_ID,
        commercialShadowReview: review
    });
    strict_1.default.equal(viewModel.status, "waiting_for_operational_loop");
    strict_1.default.equal(viewModel.commercialState?.status, "waiting_for_operational_loop");
    strict_1.default.equal(viewModel.nextAction?.executable ?? false, false);
    strict_1.default.ok(viewModel.knownInformation.length > 0);
    strict_1.default.ok(viewModel.missingInformation.length > 0);
});
(0, node_test_1.default)("returns not_found, disabled, and error states", () => {
    const notFound = (0, operator_pilot_1.buildAiSdrOperatorPilotViewModel)({
        caseId: CASE_ID,
        commercialShadowReview: makeReview("not_found")
    });
    const disabled = (0, operator_pilot_1.buildAiSdrOperatorPilotViewModel)({
        caseId: CASE_ID,
        commercialShadowReview: makeReview("disabled")
    });
    const error = (0, operator_pilot_1.buildAiSdrOperatorPilotViewModel)({
        caseId: CASE_ID,
        commercialShadowReview: makeReview("error", {
            error: {
                code: "read_error",
                message: "Authorization: Bearer sk-test-123",
                stage: "read"
            }
        })
    });
    strict_1.default.equal(notFound.status, "not_found");
    strict_1.default.equal(disabled.status, "disabled");
    strict_1.default.equal(error.status, "error");
    strict_1.default.equal(error.error?.includes("sk-test-123"), false);
});
(0, node_test_1.default)("truncates long drafts and preserves blocked reasons", () => {
    const viewModel = (0, operator_pilot_1.buildAiSdrOperatorPilotViewModel)({
        caseId: CASE_ID,
        commercialShadowReview: makeReview("available"),
        commercialOperationalResult: makeOperationalResult({
            selectedNextAction: {
                type: "respond",
                label: "Responder",
                reason: "Long draft coverage",
                confidence: 0.91,
                riskLevel: "low",
                approvalRequirement: "none",
                recommendedChannel: "whatsapp",
                draftMessage: `${"Hola ".repeat(250)}`,
                executable: false,
                blockedReasons: ["policy_blocked", "approval_required"],
                requiredInformation: []
            }
        })
    });
    strict_1.default.equal(viewModel.nextAction?.blockedReasons.includes("policy_blocked"), true);
    strict_1.default.equal(viewModel.nextAction?.executable, false);
    strict_1.default.ok((viewModel.nextAction?.draftMessage ?? "").length <= 903);
});
(0, node_test_1.default)("renders the operator pilot panel and blocked controls", () => {
    const review = makeReview("available");
    const viewModel = (0, operator_pilot_1.buildAiSdrOperatorPilotViewModel)({
        caseId: CASE_ID,
        commercialShadowReview: review,
        commercialOperationalResult: makeOperationalResult()
    });
    const markup = (0, server_1.renderToStaticMarkup)((0, react_1.createElement)(AiSdrOperatorPilotPanel_1.AiSdrOperatorPilotPanel, { caseId: CASE_ID, pilot: viewModel }));
    strict_1.default.ok(markup.includes("AI SDR Operator Pilot"));
    strict_1.default.ok(markup.includes("Borrador local no guardado"));
    strict_1.default.ok(markup.includes("Piloto controlado"));
    strict_1.default.ok(markup.includes("disabled"));
    strict_1.default.ok(markup.includes("Ver diagnostico tecnico"));
});
(0, node_test_1.default)("renders empty, disabled, and error states without breaking the panel", () => {
    const notFound = (0, operator_pilot_1.buildAiSdrOperatorPilotViewModel)({
        caseId: CASE_ID,
        commercialShadowReview: makeReview("not_found")
    });
    const disabled = (0, operator_pilot_1.buildAiSdrOperatorPilotViewModel)({
        caseId: CASE_ID,
        commercialShadowReview: makeReview("disabled")
    });
    const error = (0, operator_pilot_1.buildAiSdrOperatorPilotViewModel)({
        caseId: CASE_ID,
        commercialShadowReview: makeReview("error", {
            error: {
                code: "read_error",
                message: "Authorization: Bearer sk-test-123",
                stage: "read"
            }
        })
    });
    const notFoundMarkup = (0, server_1.renderToStaticMarkup)((0, react_1.createElement)(AiSdrOperatorPilotPanel_1.AiSdrOperatorPilotPanel, { caseId: CASE_ID, pilot: notFound }));
    const disabledMarkup = (0, server_1.renderToStaticMarkup)((0, react_1.createElement)(AiSdrOperatorPilotPanel_1.AiSdrOperatorPilotPanel, { caseId: CASE_ID, pilot: disabled }));
    const errorMarkup = (0, server_1.renderToStaticMarkup)((0, react_1.createElement)(AiSdrOperatorPilotPanel_1.AiSdrOperatorPilotPanel, { caseId: CASE_ID, pilot: error }));
    strict_1.default.ok(notFoundMarkup.includes("No existe una vista operacional AI SDR"));
    strict_1.default.ok(disabledMarkup.includes("Piloto deshabilitado"));
    strict_1.default.ok(errorMarkup.includes("Error seguro"));
    strict_1.default.equal(errorMarkup.includes("sk-test-123"), false);
});
