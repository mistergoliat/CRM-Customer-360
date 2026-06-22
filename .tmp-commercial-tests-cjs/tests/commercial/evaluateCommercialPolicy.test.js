"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const policy_1 = require("../../lib/brain/commercial/policy");
const validationTypes_1 = require("../../lib/brain/commercial/sales-agent/validationTypes");
const FIXED_TIME = "2026-06-17T12:00:00.000Z";
function makeEvidence(overrides = {}) {
    return {
        source: "customer_message",
        summary: "Mensaje base del cliente.",
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
            summary: "Consulta comercial segura.",
            qualificationState: "qualified",
            customerReadiness: "ready",
            productFit: "good",
            confidence: "high",
            riskLevel: "low",
            reasonCodes: ["customer_message_present"]
        },
        decision: {
            type: "respond_now",
            reason: "El caso puede responderse.",
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
            claims: [
                {
                    type: "general",
                    value: "Informacion general.",
                    evidenceSource: "customer_message",
                    evidenceSummary: "Base general del cliente.",
                    verified: true,
                    confidence: "high",
                    expiresAt: null
                }
            ],
            disclaimers: [],
            requiresApproval: "none",
            blockedClaims: [],
            confidence: "high"
        },
        evidence: [makeEvidence()],
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
            summary: "Resumen operacional.",
            evidence: ["Mensaje inbound."],
            counterEvidence: [],
            assumptions: [],
            riskFlags: [],
            missingInformation: [],
            policyRulesApplied: []
        },
        metadata: {
            traceId: "trace-001"
        },
        ...overrides
    };
}
function makePolicyInput(overrides = {}) {
    return {
        salesAgentResult: overrides.salesAgentResult ?? makeBaseResult(),
        currentTime: FIXED_TIME,
        contractVersion: policy_1.COMMERCIAL_POLICY_CONTRACT_VERSION,
        policyVersion: policy_1.COMMERCIAL_POLICY_VERSION,
        allowedCapabilities: ["searchKnowledge", "getConversationHistory", "searchProducts", "getProductStock", "getOrderByInvoice"],
        commercialContext: {
            sourceShape: "sales_agent_input",
            supportedContextShape: true
        },
        customerContext: null,
        opportunityContext: null,
        followUpContext: null,
        channelContext: {
            channel: "whatsapp",
            available: true,
            outboundAllowed: true,
            manualApprovalRequired: false,
            optOut: false,
            quietHoursActive: false,
            humanOwnerActive: false,
            aiBlocked: false,
            identityConflict: false,
            recentCustomerReply: false,
            recentHumanContact: false
        },
        operatorContext: null,
        featureFlags: {
            ...policy_1.COMMERCIAL_POLICY_DEFAULT_FLAGS,
            commercialPolicyEnabled: true,
            allowDraftReplies: true,
            allowToolRequests: true,
            allowEntityProposals: true,
            allowFollowUpEvaluation: true,
            allowInternalTasks: true,
            allowQuoteDraftRequests: true,
            allowOperatorReviewRequests: true,
            allowSensitiveClaims: false,
            allowOutboundProposals: true
        },
        metadata: {
            safeTraceId: "policy-001"
        },
        ...overrides
    };
}
(0, node_test_1.default)("policy disabled fails safe", () => {
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({
        featureFlags: {
            ...policy_1.COMMERCIAL_POLICY_DEFAULT_FLAGS,
            commercialPolicyEnabled: false
        }
    }));
    strict_1.default.equal(result.status, "failed_safe");
    strict_1.default.equal(result.overallDecision, "failed_safe");
    strict_1.default.equal(result.governedResult.outcome, "failed_safe");
});
(0, node_test_1.default)("allows a valid SalesAgentResult with no sensitive claims", () => {
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput());
    strict_1.default.equal(result.status, "allowed");
    strict_1.default.equal(result.overallDecision, "allow");
    strict_1.default.equal(result.blockedClaims.length, 0);
    strict_1.default.equal(result.governedResult.responseProposal?.claims.length, 1);
    strict_1.default.doesNotThrow(() => JSON.stringify(result));
});
(0, node_test_1.default)("keeps a price claim with verified evidence", () => {
    const salesAgentResult = makeBaseResult({
        responseProposal: {
            messageIntent: "quote",
            draftText: "El precio es informativo.",
            language: "es",
            tone: "friendly",
            questions: [],
            claims: [
                {
                    type: "price",
                    value: "Precio referencial.",
                    evidenceSource: "tool_result",
                    evidenceSummary: "Precio desde una fuente autorizada.",
                    verified: true,
                    confidence: "high",
                    expiresAt: "2026-06-18T00:00:00.000Z"
                }
            ],
            disclaimers: [],
            requiresApproval: "none",
            blockedClaims: [],
            confidence: "high"
        },
        evidence: [
            makeEvidence({
                source: "tool_result",
                summary: "Fuente de precio autorizada.",
                expiresAt: "2026-06-18T00:00:00.000Z"
            })
        ]
    });
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({
        salesAgentResult,
        featureFlags: {
            ...makePolicyInput().featureFlags,
            allowSensitiveClaims: true
        }
    }));
    strict_1.default.equal(result.status, "allowed");
    strict_1.default.equal(result.governedResult.responseProposal?.claims[0]?.type, "price");
});
(0, node_test_1.default)("blocks a price claim without evidence", () => {
    const salesAgentResult = makeBaseResult({
        responseProposal: {
            messageIntent: "quote",
            draftText: "El precio es informativo.",
            language: "es",
            tone: "friendly",
            questions: [],
            claims: [
                {
                    type: "price",
                    value: "Precio sin soporte.",
                    evidenceSource: "customer_message",
                    evidenceSummary: "Sin evidencia autorizada.",
                    verified: false,
                    confidence: "high",
                    expiresAt: null
                }
            ],
            disclaimers: [],
            requiresApproval: "none",
            blockedClaims: [],
            confidence: "high"
        }
    });
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({
        salesAgentResult,
        featureFlags: {
            ...makePolicyInput().featureFlags,
            allowSensitiveClaims: true
        }
    }));
    strict_1.default.notEqual(result.status, "allowed");
    strict_1.default.equal(result.blockedClaims.length, 1);
    strict_1.default.ok(result.issues.some((issue) => issue.code === "sensitive_claim_blocked" || issue.code === "evidence_unverified" || issue.code === "claim_source_not_authorized"));
});
(0, node_test_1.default)("downgrades stale stock claims to review", () => {
    const salesAgentResult = makeBaseResult({
        responseProposal: {
            messageIntent: "quote",
            draftText: "Hay stock.",
            language: "es",
            tone: "friendly",
            questions: [],
            claims: [
                {
                    type: "stock",
                    value: "Hay stock.",
                    evidenceSource: "tool_result",
                    evidenceSummary: "Stock antiguo.",
                    verified: true,
                    confidence: "high",
                    expiresAt: "2026-06-16T00:00:00.000Z"
                }
            ],
            disclaimers: [],
            requiresApproval: "none",
            blockedClaims: [],
            confidence: "high"
        },
        evidence: [
            makeEvidence({
                source: "tool_result",
                summary: "Stock antiguo.",
                capturedAt: "2026-06-10T00:00:00.000Z",
                expiresAt: "2026-06-16T00:00:00.000Z"
            })
        ]
    });
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({
        salesAgentResult,
        featureFlags: {
            ...makePolicyInput().featureFlags,
            allowSensitiveClaims: true
        }
    }));
    strict_1.default.equal(result.status, "requires_review");
    strict_1.default.equal(result.governedResult.policyAssessment.status, "review");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "evidence_stale"));
});
(0, node_test_1.default)("keeps a delivery claim with explicit approval", () => {
    const salesAgentResult = makeBaseResult({
        responseProposal: {
            messageIntent: "answer",
            draftText: "La entrega es estimada.",
            language: "es",
            tone: "friendly",
            questions: [],
            claims: [
                {
                    type: "delivery",
                    value: "Entrega estimada.",
                    evidenceSource: "operator_input",
                    evidenceSummary: "Estimacion aprobada por operador.",
                    verified: true,
                    confidence: "high",
                    expiresAt: "2026-06-18T00:00:00.000Z"
                }
            ],
            disclaimers: [],
            requiresApproval: "none",
            blockedClaims: [],
            confidence: "high"
        },
        evidence: [
            makeEvidence({
                source: "operator_input",
                summary: "Estimacion aprobada por operador.",
                capturedAt: FIXED_TIME
            })
        ]
    });
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({
        salesAgentResult,
        featureFlags: {
            ...makePolicyInput().featureFlags,
            allowSensitiveClaims: true
        }
    }));
    strict_1.default.equal(result.status, "requires_review");
    strict_1.default.equal(result.requiresApproval, "explicit_operator_approval");
});
(0, node_test_1.default)("keeps an order status claim supported by tool evidence", () => {
    const salesAgentResult = makeBaseResult({
        responseProposal: {
            messageIntent: "answer",
            draftText: "El estado del pedido es visible.",
            language: "es",
            tone: "friendly",
            questions: [],
            claims: [
                {
                    type: "order_status",
                    value: "Pedido pagado.",
                    evidenceSource: "tool_result",
                    evidenceSummary: "Estado proveniente de herramienta.",
                    verified: true,
                    confidence: "high",
                    expiresAt: "2026-06-18T00:00:00.000Z"
                }
            ],
            disclaimers: [],
            requiresApproval: "none",
            blockedClaims: [],
            confidence: "high"
        },
        evidence: [makeEvidence({ source: "tool_result" })]
    });
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({
        salesAgentResult,
        featureFlags: {
            ...makePolicyInput().featureFlags,
            allowSensitiveClaims: true
        }
    }));
    strict_1.default.equal(result.status, "allowed");
    strict_1.default.equal(result.governedResult.responseProposal?.claims[0]?.type, "order_status");
});
(0, node_test_1.default)("blocks a hard-blocked action", () => {
    const salesAgentResult = makeBaseResult({
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
    });
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({ salesAgentResult }));
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.equal(result.blockedActions.length, 1);
    strict_1.default.ok(result.issues.some((issue) => issue.code === "hard_blocked_action"));
});
(0, node_test_1.default)("allows a low-risk draft response action", () => {
    const salesAgentResult = makeBaseResult({
        proposedActions: [
            {
                type: "draft_response",
                priority: "low",
                confidence: "high",
                riskLevel: "low",
                requiresApproval: "none",
                reason: "Borrador util.",
                payload: {},
                dependencies: [],
                policyTags: [],
                expiresAt: null
            }
        ]
    });
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({ salesAgentResult }));
    strict_1.default.equal(result.status, "allowed");
    strict_1.default.equal(result.governedResult.proposedActions.length, 1);
});
(0, node_test_1.default)("marks a human review action as review", () => {
    const salesAgentResult = makeBaseResult({
        proposedActions: [
            {
                type: "request_human_review",
                priority: "medium",
                confidence: "high",
                riskLevel: "medium",
                requiresApproval: "review",
                reason: "Necesita revision humana.",
                payload: {},
                dependencies: [],
                policyTags: [],
                expiresAt: null
            }
        ]
    });
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({ salesAgentResult }));
    strict_1.default.equal(result.status, "requires_review");
    strict_1.default.equal(result.governedResult.shouldRequestHuman, true);
});
(0, node_test_1.default)("keeps an outbound message proposal with explicit approval", () => {
    const salesAgentResult = makeBaseResult({
        proposedActions: [
            {
                type: "send_whatsapp_message",
                priority: "high",
                confidence: "high",
                riskLevel: "high",
                requiresApproval: "none",
                reason: "Enviar mensaje al cliente.",
                payload: {},
                dependencies: [],
                policyTags: [],
                expiresAt: null
            }
        ]
    });
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({
        salesAgentResult,
        featureFlags: {
            ...makePolicyInput().featureFlags,
            allowOutboundProposals: true
        }
    }));
    strict_1.default.equal(result.status, "requires_review");
    strict_1.default.equal(result.requiresApproval, "explicit_operator_approval");
});
(0, node_test_1.default)("deduplicates equivalent actions", () => {
    const salesAgentResult = makeBaseResult({
        proposedActions: [
            {
                type: "draft_response",
                priority: "low",
                confidence: "high",
                riskLevel: "low",
                requiresApproval: "none",
                reason: "Mismo borrador.",
                payload: {},
                dependencies: [],
                policyTags: [],
                expiresAt: null
            },
            {
                type: "draft_response",
                priority: "low",
                confidence: "high",
                riskLevel: "low",
                requiresApproval: "none",
                reason: "Mismo borrador.",
                payload: {},
                dependencies: [],
                policyTags: [],
                expiresAt: null
            }
        ]
    });
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({ salesAgentResult }));
    strict_1.default.equal(result.governedResult.proposedActions.length, 1);
    strict_1.default.ok(result.issues.some((issue) => issue.code === "duplicate_action"));
});
(0, node_test_1.default)("blocks an expired action", () => {
    const salesAgentResult = makeBaseResult({
        proposedActions: [
            {
                type: "draft_response",
                priority: "low",
                confidence: "high",
                riskLevel: "low",
                requiresApproval: "none",
                reason: "Accion expirada.",
                payload: {},
                dependencies: [],
                policyTags: [],
                expiresAt: "2026-06-16T00:00:00.000Z"
            }
        ]
    });
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({ salesAgentResult }));
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "expired_action"));
});
(0, node_test_1.default)("allows a tool request inside the capability allowlist", () => {
    const salesAgentResult = makeBaseResult({
        shouldRequestTool: true,
        responseProposal: null,
        outcome: "tool_required",
        decision: {
            type: "request_tool",
            reason: "Se requiere una herramienta.",
            confidence: "high",
            riskLevel: "medium",
            requiresApproval: "review",
            errorCode: "none",
            reasonCodes: [],
            policyTags: []
        },
        toolRequests: [
            {
                tool: "searchKnowledge",
                purpose: "Buscar informacion.",
                status: "planned",
                requiredInputs: {},
                optionalInputs: null,
                urgency: "medium",
                blocking: true,
                reason: "Se requiere herramienta.",
                expectedEvidence: [],
                fallbackDecision: "request_human",
                confidence: "high",
                riskLevel: "low"
            }
        ]
    });
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({ salesAgentResult }));
    strict_1.default.equal(result.status, "requires_review");
    strict_1.default.equal(result.toolRequestAssessments[0]?.status, "review");
});
(0, node_test_1.default)("blocks a tool outside the allowlist", () => {
    const salesAgentResult = makeBaseResult({
        shouldRequestTool: true,
        responseProposal: null,
        outcome: "tool_required",
        decision: {
            type: "request_tool",
            reason: "Se requiere una herramienta.",
            confidence: "high",
            riskLevel: "medium",
            requiresApproval: "review",
            errorCode: "none",
            reasonCodes: [],
            policyTags: []
        },
        toolRequests: [
            {
                tool: "searchProducts",
                purpose: "Buscar productos.",
                status: "planned",
                requiredInputs: {},
                optionalInputs: null,
                urgency: "medium",
                blocking: true,
                reason: "Herramienta no permitida.",
                expectedEvidence: [],
                fallbackDecision: "request_human",
                confidence: "high",
                riskLevel: "low"
            }
        ]
    });
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({
        salesAgentResult,
        allowedCapabilities: ["getConversationHistory"]
    }));
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "tool_not_allowed"));
});
(0, node_test_1.default)("blocks a blocking tool request when tools are disabled", () => {
    const salesAgentResult = makeBaseResult({
        shouldRequestTool: true,
        responseProposal: null,
        outcome: "tool_required",
        decision: {
            type: "request_tool",
            reason: "Se requiere una herramienta.",
            confidence: "high",
            riskLevel: "medium",
            requiresApproval: "review",
            errorCode: "none",
            reasonCodes: [],
            policyTags: []
        },
        toolRequests: [
            {
                tool: "searchKnowledge",
                purpose: "Buscar informacion.",
                status: "planned",
                requiredInputs: {},
                optionalInputs: null,
                urgency: "medium",
                blocking: true,
                reason: "Herramienta bloqueante no disponible.",
                expectedEvidence: [],
                fallbackDecision: "request_human",
                confidence: "high",
                riskLevel: "low"
            }
        ]
    });
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({
        salesAgentResult,
        featureFlags: {
            ...makePolicyInput().featureFlags,
            allowToolRequests: false
        }
    }));
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "tool_unavailable"));
});
(0, node_test_1.default)("blocks a tool request that claims execution", () => {
    const salesAgentResult = makeBaseResult({
        shouldRequestTool: true,
        responseProposal: null,
        outcome: "tool_required",
        decision: {
            type: "request_tool",
            reason: "Se requiere una herramienta.",
            confidence: "high",
            riskLevel: "medium",
            requiresApproval: "review",
            errorCode: "none",
            reasonCodes: [],
            policyTags: []
        },
        toolRequests: [
            {
                tool: "searchKnowledge",
                purpose: "Herramienta ya ejecutada y completada.",
                status: "planned",
                requiredInputs: {},
                optionalInputs: null,
                urgency: "medium",
                blocking: true,
                reason: "Ya fue ejecutada.",
                expectedEvidence: [],
                fallbackDecision: "request_human",
                confidence: "high",
                riskLevel: "low"
            }
        ]
    });
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({ salesAgentResult }));
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "tool_execution_claimed"));
});
(0, node_test_1.default)("keeps a low-risk entity proposal", () => {
    const salesAgentResult = makeBaseResult({
        entityProposals: [
            {
                entityType: "lead",
                proposedChanges: {
                    notes: "Nota comercial."
                },
                evidence: [makeEvidence()],
                confidence: "high",
                requiresApproval: "none",
                reason: "Propuesta de bajo riesgo.",
                policyTags: [],
                expiresAt: null,
                idempotencyHint: null
            }
        ]
    });
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({ salesAgentResult }));
    strict_1.default.equal(result.status, "allowed");
    strict_1.default.equal(result.governedResult.entityProposals.length, 1);
});
(0, node_test_1.default)("blocks a terminal opportunity transition without evidence", () => {
    const salesAgentResult = makeBaseResult({
        entityProposals: [
            {
                entityType: "opportunity",
                proposedChanges: {
                    status: "won",
                    reason: "Cierre ganado."
                },
                evidence: [],
                confidence: "high",
                requiresApproval: "explicit_operator_approval",
                reason: "Transicion terminal.",
                policyTags: [],
                expiresAt: null,
                idempotencyHint: null
            }
        ]
    });
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({ salesAgentResult }));
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "terminal_transition_requires_evidence"));
});
(0, node_test_1.default)("allows a won proposal with evidence", () => {
    const salesAgentResult = makeBaseResult({
        entityProposals: [
            {
                entityType: "opportunity",
                proposedChanges: {
                    status: "won",
                    reason: "Cierre ganado."
                },
                evidence: [
                    {
                        source: "operator_input",
                        summary: "Operacion aprobada.",
                        verified: true,
                        confidence: "high",
                        reference: "op-001",
                        capturedAt: FIXED_TIME,
                        expiresAt: null
                    }
                ],
                confidence: "high",
                requiresApproval: "explicit_operator_approval",
                reason: "Transicion terminal con evidencia.",
                policyTags: [],
                expiresAt: null,
                idempotencyHint: null
            }
        ]
    });
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({ salesAgentResult }));
    strict_1.default.equal(result.status, "requires_review");
    strict_1.default.equal(result.governedResult.entityProposals.length, 1);
});
(0, node_test_1.default)("blocks customer master mutation attempts", () => {
    const salesAgentResult = makeBaseResult({
        entityProposals: [
            {
                entityType: "lead",
                proposedChanges: {
                    customerMasterId: 1234,
                    notes: "Intento de mutar identidad."
                },
                evidence: [makeEvidence()],
                confidence: "high",
                requiresApproval: "blocked",
                reason: "Mutation de customer master.",
                policyTags: [],
                expiresAt: null,
                idempotencyHint: null
            }
        ]
    });
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({ salesAgentResult }));
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "customer_master_mutation_blocked"));
});
(0, node_test_1.default)("blocks opt-out active outbound proposals", () => {
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({
        channelContext: {
            channel: "whatsapp",
            available: true,
            outboundAllowed: true,
            manualApprovalRequired: false,
            optOut: true,
            quietHoursActive: false,
            humanOwnerActive: false,
            aiBlocked: false,
            identityConflict: false,
            recentCustomerReply: false,
            recentHumanContact: false
        }
    }));
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "opt_out_active"));
});
(0, node_test_1.default)("blocks ai blocked outbound proposals", () => {
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({
        channelContext: {
            channel: "whatsapp",
            available: true,
            outboundAllowed: true,
            manualApprovalRequired: false,
            optOut: false,
            quietHoursActive: false,
            humanOwnerActive: false,
            aiBlocked: true,
            identityConflict: false,
            recentCustomerReply: false,
            recentHumanContact: false
        }
    }));
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "ai_blocked"));
});
(0, node_test_1.default)("marks human owner active as review", () => {
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({
        channelContext: {
            channel: "whatsapp",
            available: true,
            outboundAllowed: true,
            manualApprovalRequired: false,
            optOut: false,
            quietHoursActive: false,
            humanOwnerActive: true,
            aiBlocked: false,
            identityConflict: false,
            recentCustomerReply: false,
            recentHumanContact: false
        }
    }));
    strict_1.default.equal(result.status, "requires_review");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "human_owner_active"));
});
(0, node_test_1.default)("blocks identity conflicts", () => {
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({
        channelContext: {
            channel: "whatsapp",
            available: true,
            outboundAllowed: true,
            manualApprovalRequired: false,
            optOut: false,
            quietHoursActive: false,
            humanOwnerActive: false,
            aiBlocked: false,
            identityConflict: true,
            recentCustomerReply: false,
            recentHumanContact: false
        }
    }));
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "identity_conflict"));
});
(0, node_test_1.default)("marks recent customer reply follow-up as review", () => {
    const salesAgentResult = makeBaseResult({
        shouldEvaluateFollowUp: true,
        proposedActions: [
            {
                type: "follow_up",
                priority: "medium",
                confidence: "high",
                riskLevel: "medium",
                requiresApproval: "review",
                reason: "Seguimiento.",
                payload: {},
                dependencies: [],
                policyTags: [],
                expiresAt: null
            }
        ]
    });
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({
        salesAgentResult,
        channelContext: {
            channel: "whatsapp",
            available: true,
            outboundAllowed: true,
            manualApprovalRequired: false,
            optOut: false,
            quietHoursActive: false,
            humanOwnerActive: false,
            aiBlocked: false,
            identityConflict: false,
            recentCustomerReply: true,
            recentHumanContact: false
        }
    }));
    strict_1.default.equal(result.status, "requires_review");
    strict_1.default.ok(result.issues.some((issue) => issue.code === "recent_customer_reply"));
});
(0, node_test_1.default)("allows follow-up evaluation when not blocked", () => {
    const salesAgentResult = makeBaseResult({
        shouldEvaluateFollowUp: true,
        proposedActions: [
            {
                type: "follow_up",
                priority: "medium",
                confidence: "high",
                riskLevel: "medium",
                requiresApproval: "review",
                reason: "Seguimiento.",
                payload: {},
                dependencies: [],
                policyTags: [],
                expiresAt: null
            }
        ]
    });
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({ salesAgentResult }));
    strict_1.default.notEqual(result.status, "blocked");
    strict_1.default.equal(result.governedResult.proposedActions.length, 1);
});
(0, node_test_1.default)("returns a partial allow with restrictions", () => {
    const salesAgentResult = makeBaseResult({
        proposedActions: [
            {
                type: "create_opportunity",
                priority: "high",
                confidence: "high",
                riskLevel: "high",
                requiresApproval: "blocked",
                reason: "Intento bloqueado.",
                payload: {},
                dependencies: [],
                policyTags: [],
                expiresAt: null
            },
            {
                type: "draft_response",
                priority: "low",
                confidence: "high",
                riskLevel: "low",
                requiresApproval: "none",
                reason: "Borrador valido.",
                payload: {},
                dependencies: [],
                policyTags: [],
                expiresAt: null
            }
        ]
    });
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({ salesAgentResult }));
    strict_1.default.equal(result.status, "allowed_with_restrictions");
    strict_1.default.equal(result.blockedActions.length, 1);
    strict_1.default.equal(result.governedResult.proposedActions.length, 1);
});
(0, node_test_1.default)("blocks when everything is blocked", () => {
    const salesAgentResult = makeBaseResult({
        responseProposal: null,
        shouldRespondNow: false,
        proposedActions: [
            {
                type: "create_lead",
                priority: "high",
                confidence: "high",
                riskLevel: "high",
                requiresApproval: "blocked",
                reason: "Bloqueado.",
                payload: {},
                dependencies: [],
                policyTags: [],
                expiresAt: null
            }
        ],
        toolRequests: [],
        entityProposals: []
    });
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({ salesAgentResult }));
    strict_1.default.equal(result.status, "blocked");
    strict_1.default.equal(result.governedResult.shouldRespondNow, false);
    strict_1.default.equal(result.governedResult.proposedActions.length, 0);
});
(0, node_test_1.default)("fails safe on policy version mismatch", () => {
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({
        policyVersion: "brain.commercial.policy.v9"
    }));
    strict_1.default.equal(result.status, "failed_safe");
    strict_1.default.equal(result.overallDecision, "failed_safe");
});
(0, node_test_1.default)("createCommercialPolicyFailedSafe returns a valid failed-safe result", () => {
    const result = (0, policy_1.createCommercialPolicyFailedSafe)(makePolicyInput(), "invalid_input", [
        {
            code: "invalid_input",
            level: "fatal",
            message: "Invalid input.",
            path: ["salesAgentResult"],
            ruleId: "POLICY-GOVERNANCE-FAIL-CLOSED"
        }
    ]);
    strict_1.default.equal(result.status, "failed_safe");
    strict_1.default.equal(result.governedResult.outcome, "failed_safe");
    strict_1.default.equal(result.requiresApproval, "blocked");
});
(0, node_test_1.default)("result is JSON serializable", () => {
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput());
    strict_1.default.doesNotThrow(() => JSON.stringify(result));
});
(0, node_test_1.default)("input is not mutated and output is deterministic", () => {
    const input = makePolicyInput();
    const before = JSON.stringify(input);
    const first = (0, policy_1.evaluateCommercialPolicy)(input);
    const second = (0, policy_1.evaluateCommercialPolicy)(input);
    strict_1.default.equal(JSON.stringify(input), before);
    strict_1.default.notStrictEqual(first.governedResult, input.salesAgentResult);
    strict_1.default.deepEqual(first, second);
});
(0, node_test_1.default)("sanitizes BigInt, circular and prototype pollution metadata", () => {
    const circular = JSON.parse('{"traceId":"trace-001","__proto__":{"polluted":true}}');
    circular.orderId = 9007199254740993n;
    circular.createdAt = new Date(FIXED_TIME);
    circular.self = circular;
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({
        metadata: circular
    }));
    strict_1.default.equal(result.status !== "failed_safe", true);
    strict_1.default.doesNotThrow(() => JSON.stringify(result));
    strict_1.default.equal(typeof result.metadata.safeMetadata.orderId, "string");
});
(0, node_test_1.default)("feature flags are fail closed", () => {
    const salesAgentResult = makeBaseResult({
        responseProposal: {
            messageIntent: "quote",
            draftText: "Precio.",
            language: "es",
            tone: "friendly",
            questions: [],
            claims: [
                {
                    type: "price",
                    value: "Precio referencial.",
                    evidenceSource: "customer_message",
                    evidenceSummary: "Sin permiso sensible.",
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
    });
    const result = (0, policy_1.evaluateCommercialPolicy)(makePolicyInput({
        salesAgentResult,
        featureFlags: {
            ...policy_1.COMMERCIAL_POLICY_DEFAULT_FLAGS,
            commercialPolicyEnabled: true,
            allowDraftReplies: true,
            allowToolRequests: true,
            allowEntityProposals: false,
            allowFollowUpEvaluation: false,
            allowInternalTasks: false,
            allowQuoteDraftRequests: false,
            allowOperatorReviewRequests: false,
            allowSensitiveClaims: false,
            allowOutboundProposals: false
        }
    }));
    strict_1.default.notEqual(result.status, "allowed");
    strict_1.default.ok(result.issues.length > 0);
});
(0, node_test_1.default)("governed result does not keep direct references to the input", () => {
    const input = makePolicyInput();
    const result = (0, policy_1.evaluateCommercialPolicy)(input);
    strict_1.default.notStrictEqual(result.governedResult, input.salesAgentResult);
    strict_1.default.notStrictEqual(result.governedResult.analysis, input.salesAgentResult.analysis);
    strict_1.default.notStrictEqual(result.governedResult.decision, input.salesAgentResult.decision);
    strict_1.default.notStrictEqual(result.governedResult.metadata, input.salesAgentResult.metadata);
});
