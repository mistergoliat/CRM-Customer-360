"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const constants_1 = require("../../lib/brain/commercial/constants");
const salesAgentConstants_1 = require("../../lib/brain/commercial/salesAgentConstants");
const validationTypes_1 = require("../../lib/brain/commercial/sales-agent/validationTypes");
const createFailedSafeResult_1 = require("../../lib/brain/commercial/sales-agent/createFailedSafeResult");
const validateSalesAgentOutput_1 = require("../../lib/brain/commercial/sales-agent/validateSalesAgentOutput");
const FIXED_TIME = "2026-06-17T12:00:00.000Z";
const ALL_CAPABILITIES = [...salesAgentConstants_1.SALES_AGENT_TOOL_NAMES];
function makeContext(overrides = {}) {
    return {
        expectedRunId: "run-001",
        contractVersion: validationTypes_1.SALES_AGENT_OUTPUT_CONTRACT_VERSION,
        allowedCapabilities: ALL_CAPABILITIES,
        requestedMode: "standard",
        commercialContextSummary: {
            sourceShape: "brain_context",
            supportedContextShape: true,
            channel: "whatsapp",
            platform: "meta",
            department: "ventas",
            conversationCaseId: 1001,
            waId: "56912345678",
            email: "cliente@example.com",
            phone: "+56912345678",
            idCustomer: 10,
            idOrder: 20,
            invoiceNumber: 30,
            contactId: 40,
            caseStatus: "open",
            caseLifecycleStatus: "open",
            humanOwnershipActive: false,
            aiBlocked: false,
            manualReplyActive: false,
            hasCustomerCandidate: true,
            hasCustomerReference: true,
            hasConversationHistory: true,
            hasLatestCustomerMessage: true,
            hasLatestOutboundMessage: true,
            leadAvailable: false,
            opportunityAvailable: false,
            hasCommercialEntity: true,
            commercialIntentLegacy: "quote_requested",
            orderContextAvailable: true,
            productServiceContextAvailable: true,
            latestInboundAt: FIXED_TIME,
            latestOutboundAt: FIXED_TIME,
            recentMessagesCount: 2,
            recentMessagesLimit: constants_1.COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES
        },
        currentTime: FIXED_TIME,
        strictMode: false,
        metadata: {
            safeTraceId: "trace-001"
        },
        ...overrides
    };
}
function makeEvidence(overrides = {}) {
    return {
        source: "customer_message",
        summary: "El cliente preguntó por el producto.",
        verified: true,
        confidence: "high",
        reference: "msg-001",
        capturedAt: FIXED_TIME,
        expiresAt: null,
        ...overrides
    };
}
function makeBaseResult(overrides = {}) {
    return {
        runId: "run-001",
        contractVersion: validationTypes_1.SALES_AGENT_OUTPUT_CONTRACT_VERSION,
        outcome: "response_proposed",
        analysis: {
            summary: "Consulta de producto con intención comercial explícita.",
            qualificationState: "qualified",
            customerReadiness: "ready",
            productFit: "good",
            confidence: "high",
            riskLevel: "low",
            reasonCodes: ["customer_message_present"]
        },
        decision: {
            type: "respond_now",
            reason: "El resultado puede responder ahora.",
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
        evidence: [makeEvidence()],
        policyAssessment: {
            status: "allowed",
            blocked: false,
            reason: "Sin bloqueo de policy.",
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
(0, node_test_1.default)("accepts a fully valid SalesAgentResult", () => {
    const input = makeBaseResult();
    const before = JSON.stringify(input);
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(input, makeContext());
    strict_1.default.equal(result.status, "valid");
    strict_1.default.equal(result.result?.runId, "run-001");
    strict_1.default.equal(result.result?.outcome, "response_proposed");
    strict_1.default.equal(result.result?.responseProposal?.messageIntent, "answer");
    strict_1.default.equal(result.result?.metadata.traceId, "trace-001");
    strict_1.default.equal(JSON.stringify(input), before);
    strict_1.default.notStrictEqual(result.result, input);
    strict_1.default.doesNotThrow(() => JSON.stringify(result));
});
(0, node_test_1.default)("rejects null root", () => {
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(null, makeContext());
    strict_1.default.equal(result.status, "failed_safe");
    strict_1.default.equal(result.result.outcome, "failed_safe");
});
(0, node_test_1.default)("rejects array root", () => {
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)([], makeContext());
    strict_1.default.equal(result.status, "failed_safe");
    strict_1.default.equal(result.result.outcome, "failed_safe");
});
(0, node_test_1.default)("rejects invalid enum values", () => {
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(makeBaseResult({ outcome: "not_supported" }), makeContext());
    strict_1.default.equal(result.status, "invalid");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "invalid_enum_value"));
});
(0, node_test_1.default)("rejects missing required fields", () => {
    const input = makeBaseResult();
    delete input.decision;
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(input, makeContext());
    strict_1.default.equal(result.status, "failed_safe");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "missing_required_field" || issue.code === "contract_incomplete"));
});
(0, node_test_1.default)("rejects runId mismatch", () => {
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(makeBaseResult({ runId: "run-xyz" }), makeContext());
    strict_1.default.equal(result.status, "failed_safe");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "run_id_mismatch"));
});
(0, node_test_1.default)("rejects circular output metadata", () => {
    const metadata = { traceId: "trace-001" };
    metadata.self = metadata;
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(makeBaseResult({ metadata }), makeContext());
    strict_1.default.equal(result.status, "failed_safe");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "non_serializable_value"));
});
(0, node_test_1.default)("sanitizes BigInt in metadata", () => {
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(makeBaseResult({
        metadata: {
            traceId: "trace-001",
            orderId: 9007199254740993n
        }
    }), makeContext());
    strict_1.default.equal(result.status, "valid");
    strict_1.default.equal(typeof result.result?.metadata.orderId, "string");
    strict_1.default.doesNotThrow(() => JSON.stringify(result));
});
(0, node_test_1.default)("rejects prototype pollution keys", () => {
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(makeBaseResult({
        metadata: JSON.parse('{"__proto__":{"polluted":true}}')
    }), makeContext());
    strict_1.default.equal(result.status, "failed_safe");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "forbidden_key"));
});
(0, node_test_1.default)("rejects excessive proposedActions", () => {
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(makeBaseResult({
        proposedActions: Array.from({ length: 10 }, (_, index) => ({
            type: "draft_response",
            priority: "medium",
            confidence: "high",
            riskLevel: "low",
            requiresApproval: "none",
            reason: `Action ${index}`,
            payload: {},
            dependencies: [],
            policyTags: [],
            expiresAt: null
        }))
    }), makeContext());
    strict_1.default.equal(result.status, "invalid");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "excessive_array_length"));
});
(0, node_test_1.default)("rejects unknown tool requests", () => {
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(makeBaseResult({
        outcome: "tool_required",
        shouldRespondNow: false,
        shouldRequestTool: true,
        responseProposal: null,
        toolRequests: [
            {
                tool: "unknown_tool",
                purpose: "Buscar datos",
                status: "planned",
                requiredInputs: {},
                optionalInputs: null,
                urgency: "high",
                blocking: false,
                reason: "Se requiere una herramienta.",
                expectedEvidence: [],
                fallbackDecision: null
            }
        ]
    }), makeContext());
    strict_1.default.equal(result.status, "failed_safe");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "invalid_enum_value" || issue.code === "contract_incomplete"));
});
(0, node_test_1.default)("rejects tool requests outside allowedCapabilities", () => {
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(makeBaseResult({
        toolRequests: [
            {
                tool: "searchProducts",
                purpose: "Buscar productos",
                status: "planned",
                requiredInputs: {},
                optionalInputs: null,
                urgency: "high",
                blocking: false,
                reason: "Herramienta no disponible en este contexto.",
                expectedEvidence: [],
                fallbackDecision: null
            }
        ]
    }), makeContext({ allowedCapabilities: ["getConversationHistory"] }));
    strict_1.default.equal(result.status, "invalid");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "invalid_tool_request"));
});
(0, node_test_1.default)("fails safe when a blocking tool is unavailable", () => {
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(makeBaseResult({
        toolRequests: [
            {
                tool: "searchProducts",
                purpose: "Buscar productos",
                status: "planned",
                requiredInputs: {},
                optionalInputs: null,
                urgency: "high",
                blocking: true,
                reason: "Herramienta bloqueante no disponible.",
                expectedEvidence: [],
                fallbackDecision: null
            }
        ]
    }), makeContext({ allowedCapabilities: ["getConversationHistory"] }));
    strict_1.default.equal(result.status, "failed_safe");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "invalid_tool_request"));
});
(0, node_test_1.default)("rejects price claims without evidence", () => {
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(makeBaseResult({
        responseProposal: {
            messageIntent: "quote",
            draftText: "El precio es 10",
            language: "es",
            tone: "friendly",
            questions: [],
            claims: [
                {
                    type: "price",
                    value: "El precio es 10",
                    evidenceSource: "customer_message",
                    evidenceSummary: "El modelo afirma un precio.",
                    verified: true,
                    confidence: "high",
                    expiresAt: FIXED_TIME
                }
            ],
            disclaimers: [],
            requiresApproval: "none",
            blockedClaims: [],
            confidence: "high"
        },
        evidence: []
    }), makeContext());
    strict_1.default.equal(result.status, "failed_safe");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "sensitive_claim_without_evidence"));
});
(0, node_test_1.default)("rejects stock claims without verification", () => {
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(makeBaseResult({
        responseProposal: {
            messageIntent: "quote",
            draftText: "Hay stock.",
            language: "es",
            tone: "friendly",
            questions: [],
            claims: [
                {
                    type: "stock",
                    value: "Hay stock",
                    evidenceSource: "customer_message",
                    evidenceSummary: "Afirmacion de stock sin verificacion.",
                    verified: false,
                    confidence: "high",
                    expiresAt: FIXED_TIME
                }
            ],
            disclaimers: [],
            requiresApproval: "none",
            blockedClaims: [],
            confidence: "high"
        }
    }), makeContext());
    strict_1.default.equal(result.status, "failed_safe");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "sensitive_claim_without_evidence"));
});
(0, node_test_1.default)("accepts a general claim with valid evidence", () => {
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(makeBaseResult({
        responseProposal: {
            messageIntent: "answer",
            draftText: "Respuesta general.",
            language: "es",
            tone: "friendly",
            questions: [],
            claims: [
                {
                    type: "general",
                    value: "Informacion general del producto.",
                    evidenceSource: "customer_message",
                    evidenceSummary: "Se apoya en el mensaje del cliente.",
                    verified: true,
                    confidence: "high",
                    expiresAt: null
                }
            ],
            disclaimers: [],
            requiresApproval: "none",
            blockedClaims: [],
            confidence: "high"
        }
    }), makeContext());
    strict_1.default.equal(result.status, "valid");
    strict_1.default.equal(result.result?.responseProposal?.claims[0]?.type, "general");
});
(0, node_test_1.default)("rejects hard-blocked actions", () => {
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(makeBaseResult({
        proposedActions: [
            {
                type: "create_lead",
                priority: "high",
                confidence: "high",
                riskLevel: "high",
                requiresApproval: "blocked",
                reason: "Intento de crear lead.",
                payload: {},
                dependencies: [],
                policyTags: [],
                expiresAt: null
            }
        ]
    }), makeContext());
    strict_1.default.equal(result.status, "failed_safe");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "hard_blocked_action"));
});
(0, node_test_1.default)("rejects forbidden entity proposal changes", () => {
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(makeBaseResult({
        entityProposals: [
            {
                entityType: "lead",
                proposedChanges: {
                    forbiddenField: "x"
                },
                evidence: [makeEvidence()],
                confidence: "high",
                requiresApproval: "operator_review",
                reason: "Propuesta invalida.",
                policyTags: [],
                expiresAt: null
            }
        ]
    }), makeContext());
    strict_1.default.equal(result.status, "invalid");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "invalid_entity_proposal"));
});
(0, node_test_1.default)("rejects tool_required without toolRequests", () => {
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(makeBaseResult({
        outcome: "tool_required",
        shouldRespondNow: false,
        shouldRequestTool: true,
        responseProposal: null,
        toolRequests: []
    }), makeContext());
    strict_1.default.equal(result.status, "failed_safe");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "contract_incomplete"));
});
(0, node_test_1.default)("rejects response_proposed without responseProposal", () => {
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(makeBaseResult({
        responseProposal: null
    }), makeContext());
    strict_1.default.equal(result.status, "failed_safe");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "contract_incomplete"));
});
(0, node_test_1.default)("rejects no_commercial_action with executable actions", () => {
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(makeBaseResult({
        outcome: "no_commercial_action",
        decision: {
            type: "no_commercial_action",
            reason: "No hay accion comercial.",
            confidence: "low",
            riskLevel: "low",
            requiresApproval: "none",
            errorCode: "none",
            reasonCodes: [],
            policyTags: []
        },
        shouldRespondNow: false,
        proposedActions: [
            {
                type: "draft_response",
                priority: "medium",
                confidence: "high",
                riskLevel: "low",
                requiresApproval: "none",
                reason: "Accion ejecutable no permitida.",
                payload: {},
                dependencies: [],
                policyTags: [],
                expiresAt: null
            }
        ]
    }), makeContext());
    strict_1.default.equal(result.status, "failed_safe");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "contradictory_decision"));
});
(0, node_test_1.default)("rejects blocked_by_policy without a blocked policy assessment", () => {
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(makeBaseResult({
        outcome: "blocked_by_policy",
        decision: {
            type: "blocked_by_policy",
            reason: "Bloqueado por policy.",
            confidence: "low",
            riskLevel: "blocked",
            requiresApproval: "blocked",
            errorCode: "blocked_by_policy",
            reasonCodes: [],
            policyTags: []
        },
        policyAssessment: {
            status: "allowed",
            blocked: false,
            reason: "No bloqueado.",
            confidence: "low",
            riskLevel: "blocked",
            approvalRequirement: "blocked",
            errorCode: "blocked_by_policy",
            reasonCodes: [],
            policyTags: []
        }
    }), makeContext());
    strict_1.default.equal(result.status, "failed_safe");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "contradictory_decision"));
});
(0, node_test_1.default)("flags excessive rationale arrays", () => {
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(makeBaseResult({
        rationale: {
            summary: "Razonamiento demasiado largo.",
            evidence: Array.from({ length: 25 }, (_, index) => `Evidencia ${index}`),
            counterEvidence: [],
            assumptions: [],
            riskFlags: [],
            missingInformation: [],
            policyRulesApplied: []
        }
    }), makeContext());
    strict_1.default.equal(result.status, "valid");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "excessive_array_length"));
});
(0, node_test_1.default)("trims excessive draftText without breaking the contract", () => {
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(makeBaseResult({
        responseProposal: {
            messageIntent: "answer",
            draftText: "a".repeat(5000),
            language: "es",
            tone: "friendly",
            questions: [],
            claims: [],
            disclaimers: [],
            requiresApproval: "none",
            blockedClaims: [],
            confidence: "high"
        }
    }), makeContext());
    strict_1.default.equal(result.status, "valid");
    strict_1.default.equal((result.result?.responseProposal?.draftText?.length ?? 0) <= 2000, true);
    strict_1.default.ok(result.issues.some((issue) => issue.code === "excessive_string_length"));
});
(0, node_test_1.default)("accepts a valid failed_safe result", () => {
    const safeResult = (0, createFailedSafeResult_1.createFailedSafeResult)(makeContext(), {
        issues: [
            {
                code: "missing_required_field",
                level: "fatal",
                message: "Missing field.",
                path: ["runId"]
            }
        ],
        reason: "Missing field."
    });
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(safeResult, makeContext());
    strict_1.default.equal(result.status, "valid");
    strict_1.default.equal(result.result?.outcome, "failed_safe");
    strict_1.default.equal(result.result?.shouldRequestHuman, true);
});
(0, node_test_1.default)("is JSON serializable", () => {
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(makeBaseResult(), makeContext());
    strict_1.default.equal(result.status, "valid");
    strict_1.default.doesNotThrow(() => JSON.stringify(result));
});
(0, node_test_1.default)("is deterministic for the same input", () => {
    const input = makeBaseResult();
    const context = makeContext();
    const first = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(input, context);
    const second = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(input, context);
    strict_1.default.deepEqual(first, second);
});
(0, node_test_1.default)("sanitizes control values, Date, Map, Set, function and symbol in metadata", () => {
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(makeBaseResult({
        metadata: {
            safeTraceId: "trace-001",
            when: new Date(FIXED_TIME),
            map: new Map([["x", 1]]),
            set: new Set(["x"]),
            fn: () => "noop",
            sym: Symbol("x")
        }
    }), makeContext());
    strict_1.default.notEqual(result.status, "valid");
    strict_1.default.doesNotThrow(() => JSON.stringify(result));
});
(0, node_test_1.default)("rejects nested prototype pollution keys", () => {
    const result = (0, validateSalesAgentOutput_1.validateSalesAgentOutput)(makeBaseResult({
        metadata: {
            constructor: {
                prototype: {
                    polluted: true
                }
            }
        }
    }), makeContext());
    strict_1.default.equal(result.status, "failed_safe");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "forbidden_key"));
});
