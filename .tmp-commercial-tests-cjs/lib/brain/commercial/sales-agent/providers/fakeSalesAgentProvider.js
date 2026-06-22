"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SALES_AGENT_FAKE_PROVIDER_BEHAVIORS = void 0;
exports.createFakeSalesAgentProvider = createFakeSalesAgentProvider;
exports.SALES_AGENT_FAKE_PROVIDER_BEHAVIORS = [
    "valid",
    "invalid",
    "timeout",
    "provider_error",
    "provider_unavailable",
    "hard_blocked_action",
    "sensitive_claim_without_evidence",
    "valid_tool_request",
    "run_id_mismatch",
    "malformed"
];
function createAbortError(message = "Provider invocation aborted.") {
    const error = new Error(message);
    error.name = "AbortError";
    return error;
}
function wait(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(createAbortError());
            return;
        }
        const timeout = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);
        const onAbort = () => {
            cleanup();
            reject(createAbortError());
        };
        const cleanup = () => {
            clearTimeout(timeout);
            signal?.removeEventListener("abort", onAbort);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
function firstCapability(request) {
    return request.allowedCapabilities[0] ?? request.salesAgentInput.availableCapabilities[0] ?? null;
}
function buildEvidence(summary) {
    return [
        {
            source: "customer_message",
            summary,
            verified: true,
            confidence: "high",
            reference: "fake-evidence",
            capturedAt: "2026-01-01T00:00:00.000Z",
            expiresAt: null
        }
    ];
}
function buildResponseProposal(messageIntent, draftText, claims = [], blockedClaims = []) {
    return {
        messageIntent,
        draftText,
        language: "es",
        tone: "direct",
        questions: [],
        claims,
        disclaimers: [],
        requiresApproval: "none",
        blockedClaims,
        confidence: "high"
    };
}
function buildBaseResult(request, behavior) {
    const runId = request.requestedMode === "recovery" ? "run-recovery" : request.correlationId ?? "fake-run-id";
    const evidence = buildEvidence("La solicitud del cliente es la fuente base.");
    const sharedMetadata = {
        provider: "fake",
        behavior,
        correlationId: request.correlationId ?? null
    };
    return {
        runId,
        contractVersion: request.contractVersion,
        outcome: "response_proposed",
        analysis: {
            summary: "Respuesta comercial segura y deterministica.",
            qualificationState: "qualified",
            customerReadiness: "ready",
            productFit: "good",
            confidence: "high",
            riskLevel: "low",
            reasonCodes: ["customer_message_present"]
        },
        decision: {
            type: "respond_now",
            reason: "El caso puede responderse con seguridad estructural.",
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
        responseProposal: buildResponseProposal("answer", "Hola, te comparto la informacion solicitada."),
        evidence,
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
        metadata: sharedMetadata
    };
}
function buildBehaviorOutput(request, behavior) {
    if (behavior === "invalid") {
        return {
            ...buildBaseResult(request, behavior),
            outcome: "not_supported",
            decision: {
                ...buildBaseResult(request, behavior).decision,
                type: "respond_now"
            }
        };
    }
    if (behavior === "run_id_mismatch") {
        return {
            ...buildBaseResult(request, behavior),
            runId: "run-mismatch"
        };
    }
    if (behavior === "provider_error") {
        throw new Error("Provider error: Authorization: Bearer sk-test-123");
    }
    if (behavior === "provider_unavailable") {
        throw new Error("Sales provider unavailable.");
    }
    if (behavior === "hard_blocked_action") {
        return {
            ...buildBaseResult(request, behavior),
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
                    policyTags: ["blocked_action"],
                    expiresAt: null,
                    idempotencyHint: "hard-blocked"
                }
            ]
        };
    }
    if (behavior === "sensitive_claim_without_evidence") {
        return {
            ...buildBaseResult(request, behavior),
            responseProposal: buildResponseProposal("quote", "El precio es 10.", [
                {
                    type: "price",
                    value: "El precio es 10.",
                    evidenceSource: "customer_message",
                    evidenceSummary: "Afirmacion sensible sin evidencia.",
                    evidenceReference: null,
                    verified: false,
                    confidence: "high",
                    expiresAt: null
                }
            ], [])
        };
    }
    if (behavior === "valid_tool_request") {
        const tool = firstCapability(request);
        return {
            ...buildBaseResult(request, behavior),
            outcome: "tool_required",
            decision: {
                ...buildBaseResult(request, behavior).decision,
                type: "request_tool",
                reason: "Se requiere una herramienta permitida.",
                requiresApproval: "review"
            },
            shouldRespondNow: false,
            shouldRequestTool: true,
            responseProposal: null,
            toolRequests: tool
                ? [
                    {
                        tool,
                        purpose: "Obtener evidencia permitida.",
                        status: "planned",
                        requiredInputs: {},
                        optionalInputs: null,
                        urgency: "medium",
                        blocking: true,
                        reason: "La solicitud requiere evidencia estructural adicional.",
                        expectedEvidence: ["tool_result"],
                        fallbackDecision: "request_human",
                        confidence: "high",
                        riskLevel: "low"
                    }
                ]
                : []
        };
    }
    if (behavior === "timeout") {
        return buildBaseResult(request, behavior);
    }
    if (behavior === "malformed") {
        return "not an object";
    }
    return buildBaseResult(request, behavior);
}
function createFakeSalesAgentProvider(config = {}) {
    const behavior = config.behavior ?? "valid";
    return {
        name: "fake-sales-agent-provider",
        version: config.version ?? "fake-provider.v1",
        async invoke(request, options) {
            if (behavior === "timeout") {
                await wait(24 * 60 * 60 * 1000, options.signal ?? null);
                throw createAbortError("Provider timed out.");
            }
            if (options.signal?.aborted) {
                throw createAbortError();
            }
            if (typeof config.delayMs === "number" && config.delayMs > 0) {
                await wait(config.delayMs, options.signal ?? null);
            }
            if (options.signal?.aborted) {
                throw createAbortError();
            }
            if (behavior === "provider_error") {
                throw new Error("Provider error: Authorization: Bearer sk-test-123");
            }
            if (behavior === "provider_unavailable") {
                throw new Error("Sales provider unavailable.");
            }
            const rawOutput = config.rawOutput ?? buildBehaviorOutput(request, behavior);
            return {
                rawOutput,
                model: config.model ?? "fake-sales-agent-model",
                inputTokens: 128,
                outputTokens: 256,
                estimatedCost: 0,
                providerRequestId: config.providerRequestId ?? "fake-provider-request-id",
                finishReason: config.finishReason ?? "stop",
                metadata: {
                    ...config.metadata,
                    behavior
                }
            };
        }
    };
}
