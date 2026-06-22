"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const buildCommercialContext_1 = require("../../lib/brain/commercial/context/buildCommercialContext");
const promptBuilder_1 = require("../../lib/brain/commercial/sales-agent/promptBuilder");
const fakeSalesAgentProvider_1 = require("../../lib/brain/commercial/sales-agent/providers/fakeSalesAgentProvider");
const runSalesAgentDryRun_1 = require("../../lib/brain/commercial/sales-agent/runSalesAgentDryRun");
const runtimeTypes_1 = require("../../lib/brain/commercial/sales-agent/runtimeTypes");
const FIXED_TIME = "2026-06-17T12:00:00.000Z";
const FIXED_NOW = Date.parse(FIXED_TIME);
const FIXED_CLOCK = {
    now: () => FIXED_NOW,
    toISOString: (value) => {
        const date = value instanceof Date ? value : new Date(value);
        return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
    }
};
function makeRecentMessage(index) {
    const minute = String(index).padStart(2, "0");
    return {
        id: index,
        direction: index % 2 === 0 ? "inbound" : "outbound",
        text: index % 2 === 0 ? `Mensaje inbound ${index}` : `Mensaje outbound ${index}`,
        occurred_at: `2026-06-17T11:${minute}:00.000Z`,
        created_at: `2026-06-17T11:${minute}:00.000Z`,
        updated_at: `2026-06-17T11:${minute}:30.000Z`,
        message_type: "text",
        final_action: index % 2 === 0 ? "customer_reply" : "manual_reply",
        status: "ok",
        intent: index % 2 === 0 ? "sales" : "followup",
        department: "ventas",
        wa_id: "56912345678",
        phone_number_id: "phone-001",
        conversation_case_id: 4821,
        source_table: "n8n_conversation_messages"
    };
}
function makeBrainContext(overrides = {}) {
    return {
        customer_context: {
            wa_id: "56912345678",
            phone_number_id: "phone-001",
            email: "cliente@example.com",
            phone: "+56912345678",
            id_customer: 10045,
            id_order: 20001,
            invoice_number: 30001,
            contact_id: 40001,
            customer_candidate: {
                idCustomer: 10045,
                idOrder: 20001,
                invoiceNumber: 30001,
                email: "cliente@example.com",
                contactId: 40001,
                status: "qualified"
            }
        },
        case_context: {
            conversation_case_id: 4821,
            status: "open",
            lifecycle_status: "open",
            department: "ventas",
            requires_human: false,
            ai_blocked: false,
            bot_replied: false,
            final_action: "continue",
            updated_at: "2026-06-17T11:50:00.000Z"
        },
        conversation_context: {
            recent_messages: [makeRecentMessage(1), makeRecentMessage(2), makeRecentMessage(3)],
            latest_inbound_message: makeRecentMessage(2),
            latest_outbound_message: makeRecentMessage(3)
        },
        business_context: {
            ps_orders: [
                {
                    id_order: 20001,
                    id_customer: 10045,
                    invoice_number: 30001,
                    status: "paid",
                    total_paid: 79990
                }
            ]
        },
        service_context: {
            primary_service: "sales",
            service_code: "quote_requested",
            department: "ventas"
        },
        metadata: {
            sourceWorkflow: "wa-webhook",
            headers: {
                authorization: "Bearer hidden"
            },
            token: "secret-token",
            rawWebhook: { should: "not-leak" }
        },
        ...overrides
    };
}
function makeInboundMessage(overrides = {}) {
    return {
        id: "wamid.general.1",
        message_text: "Hola, quiero saber precio y stock de una trotadora",
        channel: "whatsapp",
        platform: "meta",
        wa_id: "56912345678",
        phone_number_id: "phone-001",
        conversation_case_id: 4821,
        occurred_at: FIXED_TIME,
        headers: {
            authorization: "Bearer hidden"
        },
        rawWebhook: { leaked: true },
        token: "should-not-appear",
        credentials: {
            secret: true
        },
        metadata: {
            nested: "safe"
        },
        ...overrides
    };
}
function makeSalesAgentInput(overrides = {}) {
    const result = (0, buildCommercialContext_1.buildCommercialContext)({
        brainContext: makeBrainContext(overrides.brainContext),
        inboundMessage: makeInboundMessage(overrides.inboundMessage),
        requestedMode: overrides.requestedMode ?? "standard",
        currentTime: FIXED_TIME,
        timezone: "America/Santiago",
        availableCapabilities: overrides.availableCapabilities ?? [
            "searchKnowledge",
            "getConversationHistory",
            "searchProducts",
            "getOrderByInvoice"
        ],
        policyContext: overrides.policyContext,
        metadata: overrides.metadata
    });
    strict_1.default.equal(result.status, "success");
    return result.salesAgentInput;
}
function makeValidRawOutput(overrides = {}) {
    return {
        runId: "corr-001",
        contractVersion: runtimeTypes_1.SALES_AGENT_CONTRACT_VERSION,
        outcome: "response_proposed",
        analysis: {
            summary: "Consulta de producto con intencion comercial explicita.",
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
        evidence: [
            {
                source: "customer_message",
                summary: "El cliente pregunto por producto.",
                verified: true,
                confidence: "high",
                reference: "msg-001",
                capturedAt: FIXED_TIME,
                expiresAt: null
            }
        ],
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
function makeRuntimeInput(overrides = {}) {
    const salesAgentInput = overrides.salesAgentInput ?? makeSalesAgentInput();
    const provider = overrides.provider ?? (0, fakeSalesAgentProvider_1.createFakeSalesAgentProvider)({ behavior: "valid" });
    const enabled = typeof overrides.enabled === "boolean" ? overrides.enabled : false;
    const strictValidation = typeof overrides.strictValidation === "boolean" ? overrides.strictValidation : true;
    const captureRawOutput = typeof overrides.captureRawOutput === "boolean" ? overrides.captureRawOutput : false;
    const includePromptPreview = typeof overrides.includePromptPreview === "boolean" ? overrides.includePromptPreview : false;
    const dryRun = typeof overrides.dryRun === "boolean" ? overrides.dryRun : true;
    const options = {
        enabled,
        mode: overrides.mode ?? "dry_run",
        timeoutMs: overrides.timeoutMs ?? 25,
        maxInputCharacters: overrides.maxInputCharacters ?? runtimeTypes_1.SALES_AGENT_RUNTIME_MAX_INPUT_CHARACTERS,
        maxOutputCharacters: overrides.maxOutputCharacters ?? runtimeTypes_1.SALES_AGENT_RUNTIME_MAX_OUTPUT_CHARACTERS,
        strictValidation,
        allowedCapabilities: overrides.allowedCapabilities ?? salesAgentInput.availableCapabilities,
        captureRawOutput,
        includePromptPreview,
        dryRun,
        abortSignal: overrides.abortSignal ?? null
    };
    return {
        salesAgentInput,
        provider,
        options,
        expectedRunId: overrides.expectedRunId ?? "corr-001",
        contractVersion: overrides.contractVersion ?? runtimeTypes_1.SALES_AGENT_CONTRACT_VERSION,
        promptVersion: overrides.promptVersion ?? runtimeTypes_1.SALES_AGENT_PROMPT_VERSION,
        currentTime: FIXED_TIME,
        correlationId: overrides.correlationId ?? "corr-001",
        metadata: overrides.metadata ?? { safeTraceId: "trace-001" },
        clock: overrides.clock ?? FIXED_CLOCK
    };
}
(0, node_test_1.default)("runtime disabled does not call provider", async () => {
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
    const result = await (0, runSalesAgentDryRun_1.runSalesAgentDryRun)(makeRuntimeInput({
        enabled: false,
        provider
    }));
    strict_1.default.equal(invoked, 0);
    strict_1.default.equal(result.status, "disabled");
    strict_1.default.equal(result.validation.status, "skipped");
    strict_1.default.equal(result.result.outcome, "failed_safe");
});
(0, node_test_1.default)("completes valid output from the fake provider", async () => {
    const result = await (0, runSalesAgentDryRun_1.runSalesAgentDryRun)(makeRuntimeInput({
        enabled: true,
        provider: (0, fakeSalesAgentProvider_1.createFakeSalesAgentProvider)({ behavior: "valid" })
    }));
    strict_1.default.equal(result.status, "completed_valid");
    strict_1.default.equal(result.result.outcome, "response_proposed");
    strict_1.default.equal(result.validation.status, "valid");
    strict_1.default.equal(result.metrics.providerRequestId, "fake-provider-request-id");
    strict_1.default.equal(result.metrics.model, "fake-sales-agent-model");
});
(0, node_test_1.default)("fails safe on invalid provider output", async () => {
    const result = await (0, runSalesAgentDryRun_1.runSalesAgentDryRun)(makeRuntimeInput({
        enabled: true,
        provider: (0, fakeSalesAgentProvider_1.createFakeSalesAgentProvider)({ behavior: "invalid" })
    }));
    strict_1.default.equal(result.status, "validation_failed_safe");
    strict_1.default.equal(result.validation.status, "failed_safe");
    strict_1.default.equal(result.result.outcome, "failed_safe");
});
(0, node_test_1.default)("fails safe when validator rejects a runId mismatch", async () => {
    const result = await (0, runSalesAgentDryRun_1.runSalesAgentDryRun)(makeRuntimeInput({
        enabled: true,
        provider: (0, fakeSalesAgentProvider_1.createFakeSalesAgentProvider)({ behavior: "run_id_mismatch" })
    }));
    strict_1.default.equal(result.status, "validation_failed_safe");
    strict_1.default.ok(result.validation.issues.some((issue) => issue.code === "run_id_mismatch"));
    strict_1.default.equal(result.result.outcome, "failed_safe");
});
(0, node_test_1.default)("fails safe when contractVersion mismatches", async () => {
    const result = await (0, runSalesAgentDryRun_1.runSalesAgentDryRun)(makeRuntimeInput({
        enabled: true,
        provider: (0, fakeSalesAgentProvider_1.createFakeSalesAgentProvider)({
            rawOutput: makeValidRawOutput({
                contractVersion: "brain.sales-agent.output.v0"
            })
        })
    }));
    strict_1.default.equal(result.status, "validation_failed_safe");
    strict_1.default.ok(result.validation.issues.some((issue) => issue.code === "unsupported_contract_version"));
});
(0, node_test_1.default)("fails safe when a tool request is not in allowed capabilities", async () => {
    const result = await (0, runSalesAgentDryRun_1.runSalesAgentDryRun)(makeRuntimeInput({
        enabled: true,
        provider: (0, fakeSalesAgentProvider_1.createFakeSalesAgentProvider)({
            rawOutput: makeValidRawOutput({
                outcome: "tool_required",
                shouldRespondNow: false,
                shouldRequestTool: true,
                responseProposal: null,
                decision: {
                    type: "request_tool",
                    reason: "Se requiere una herramienta.",
                    confidence: "high",
                    riskLevel: "low",
                    requiresApproval: "review",
                    errorCode: "none",
                    reasonCodes: ["customer_message_present"],
                    policyTags: ["commercial_reply"]
                },
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
            })
        }),
        allowedCapabilities: ["getConversationHistory"]
    }));
    strict_1.default.equal(result.status, "validation_failed_safe");
    strict_1.default.ok(result.validation.issues.some((issue) => issue.code === "invalid_tool_request"));
});
(0, node_test_1.default)("fails safe on hard-blocked actions", async () => {
    const result = await (0, runSalesAgentDryRun_1.runSalesAgentDryRun)(makeRuntimeInput({
        enabled: true,
        provider: (0, fakeSalesAgentProvider_1.createFakeSalesAgentProvider)({ behavior: "hard_blocked_action" })
    }));
    strict_1.default.equal(result.status, "validation_failed_safe");
    strict_1.default.ok(result.validation.issues.some((issue) => issue.code === "hard_blocked_action"));
});
(0, node_test_1.default)("fails safe on sensitive claims without evidence", async () => {
    const result = await (0, runSalesAgentDryRun_1.runSalesAgentDryRun)(makeRuntimeInput({
        enabled: true,
        provider: (0, fakeSalesAgentProvider_1.createFakeSalesAgentProvider)({ behavior: "sensitive_claim_without_evidence" })
    }));
    strict_1.default.equal(result.status, "validation_failed_safe");
    strict_1.default.ok(result.validation.issues.some((issue) => issue.code === "sensitive_claim_without_evidence"));
});
(0, node_test_1.default)("fails safe on claim stock without verification", async () => {
    const result = await (0, runSalesAgentDryRun_1.runSalesAgentDryRun)(makeRuntimeInput({
        enabled: true,
        provider: (0, fakeSalesAgentProvider_1.createFakeSalesAgentProvider)({
            rawOutput: makeValidRawOutput({
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
            })
        })
    }));
    strict_1.default.equal(result.status, "validation_failed_safe");
    strict_1.default.ok(result.validation.issues.some((issue) => issue.code === "sensitive_claim_without_evidence"));
});
(0, node_test_1.default)("accepts a general claim with valid evidence", async () => {
    const result = await (0, runSalesAgentDryRun_1.runSalesAgentDryRun)(makeRuntimeInput({
        enabled: true,
        provider: (0, fakeSalesAgentProvider_1.createFakeSalesAgentProvider)({
            rawOutput: makeValidRawOutput({
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
            })
        })
    }));
    strict_1.default.equal(result.status, "completed_valid");
    strict_1.default.equal(result.result.responseProposal?.claims[0]?.type, "general");
});
(0, node_test_1.default)("fails safe when the provider throws with a sensitive error message", async () => {
    const result = await (0, runSalesAgentDryRun_1.runSalesAgentDryRun)(makeRuntimeInput({
        enabled: true,
        provider: (0, fakeSalesAgentProvider_1.createFakeSalesAgentProvider)({ behavior: "provider_error" })
    }));
    strict_1.default.equal(result.status, "provider_error");
    strict_1.default.ok(result.error?.message.includes("sk-test-123") === false);
});
(0, node_test_1.default)("marks provider unavailable", async () => {
    const result = await (0, runSalesAgentDryRun_1.runSalesAgentDryRun)(makeRuntimeInput({
        enabled: true,
        provider: (0, fakeSalesAgentProvider_1.createFakeSalesAgentProvider)({ behavior: "provider_unavailable" })
    }));
    strict_1.default.equal(result.status, "provider_unavailable");
});
(0, node_test_1.default)("times out when the provider exceeds the deadline", async () => {
    const result = await (0, runSalesAgentDryRun_1.runSalesAgentDryRun)(makeRuntimeInput({
        enabled: true,
        timeoutMs: 5,
        provider: (0, fakeSalesAgentProvider_1.createFakeSalesAgentProvider)({ behavior: "timeout" })
    }));
    strict_1.default.equal(result.status, "timeout");
    strict_1.default.equal(result.error?.code, "timeout");
});
(0, node_test_1.default)("cancels when the abort signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await (0, runSalesAgentDryRun_1.runSalesAgentDryRun)(makeRuntimeInput({
        enabled: true,
        abortSignal: controller.signal,
        provider: (0, fakeSalesAgentProvider_1.createFakeSalesAgentProvider)({ behavior: "valid", delayMs: 100 })
    }));
    strict_1.default.equal(result.status, "cancelled");
    strict_1.default.equal(result.error?.code, "cancelled");
});
(0, node_test_1.default)("does not expose rawOutput by default", async () => {
    const result = await (0, runSalesAgentDryRun_1.runSalesAgentDryRun)(makeRuntimeInput({
        enabled: true,
        provider: (0, fakeSalesAgentProvider_1.createFakeSalesAgentProvider)({ behavior: "valid" })
    }));
    strict_1.default.equal(result.rawOutputPreview, undefined);
});
(0, node_test_1.default)("sanitizes rawOutput when captureRawOutput is enabled", async () => {
    const result = await (0, runSalesAgentDryRun_1.runSalesAgentDryRun)(makeRuntimeInput({
        enabled: true,
        captureRawOutput: true,
        provider: (0, fakeSalesAgentProvider_1.createFakeSalesAgentProvider)({
            rawOutput: makeValidRawOutput({
                metadata: {
                    traceId: "trace-001",
                    token: "secret-token",
                    headers: {
                        authorization: "Bearer hidden"
                    }
                }
            })
        })
    }));
    strict_1.default.equal(result.status, "completed_valid");
    strict_1.default.equal(result.rawOutputPreview && typeof result.rawOutputPreview === "object", true);
    strict_1.default.equal(Object.prototype.hasOwnProperty.call(result.rawOutputPreview.metadata, "token"), false);
});
(0, node_test_1.default)("sanitizes runtime metadata and security payloads", async () => {
    const metadata = {
        traceId: "trace-001",
        orderId: 9007199254740993n,
        when: new Date(FIXED_TIME),
        map: new Map([["k", "v"]]),
        set: new Set(["v"]),
        fn: () => "noop",
        sym: Symbol("x"),
        ...JSON.parse('{"__proto__":{"polluted":true}}')
    };
    const result = await (0, runSalesAgentDryRun_1.runSalesAgentDryRun)(makeRuntimeInput({
        enabled: true,
        metadata,
        provider: (0, fakeSalesAgentProvider_1.createFakeSalesAgentProvider)({ behavior: "valid" })
    }));
    strict_1.default.equal(result.status, "completed_valid");
    strict_1.default.equal(typeof result.metadata.safeMetadata.orderId, "string");
    strict_1.default.equal(Object.prototype.hasOwnProperty.call(result.metadata.safeMetadata, "__proto__"), false);
    strict_1.default.doesNotThrow(() => JSON.stringify(result));
});
(0, node_test_1.default)("rejects excessive input length", async () => {
    const oversizedInput = makeSalesAgentInput({
        inboundMessage: {
            message_text: "x".repeat(12000)
        }
    });
    const result = await (0, runSalesAgentDryRun_1.runSalesAgentDryRun)(makeRuntimeInput({
        enabled: true,
        salesAgentInput: oversizedInput,
        maxInputCharacters: 200,
        provider: (0, fakeSalesAgentProvider_1.createFakeSalesAgentProvider)({ behavior: "valid" })
    }));
    strict_1.default.equal(result.status, "invalid_input");
    strict_1.default.equal(result.error?.code, "input_too_large");
});
(0, node_test_1.default)("rejects excessive output length", async () => {
    const result = await (0, runSalesAgentDryRun_1.runSalesAgentDryRun)(makeRuntimeInput({
        enabled: true,
        maxOutputCharacters: 10,
        provider: (0, fakeSalesAgentProvider_1.createFakeSalesAgentProvider)({
            rawOutput: makeValidRawOutput({
                responseProposal: {
                    messageIntent: "answer",
                    draftText: "x".repeat(5000),
                    language: "es",
                    tone: "friendly",
                    questions: [],
                    claims: [],
                    disclaimers: [],
                    requiresApproval: "none",
                    blockedClaims: [],
                    confidence: "high"
                }
            })
        })
    }));
    strict_1.default.equal(result.status, "completed_failed_safe");
    strict_1.default.equal(result.error?.code, "invalid_response");
});
(0, node_test_1.default)("builds a deterministic prompt package", () => {
    const salesAgentInput = makeSalesAgentInput();
    const promptA = (0, promptBuilder_1.buildSalesAgentPromptPackage)({
        salesAgentInput,
        contractVersion: runtimeTypes_1.SALES_AGENT_CONTRACT_VERSION,
        promptVersion: runtimeTypes_1.SALES_AGENT_PROMPT_VERSION,
        runtimeMode: "dry_run",
        currentTime: FIXED_TIME,
        allowedCapabilities: salesAgentInput.availableCapabilities
    });
    const promptB = (0, promptBuilder_1.buildSalesAgentPromptPackage)({
        salesAgentInput,
        contractVersion: runtimeTypes_1.SALES_AGENT_CONTRACT_VERSION,
        promptVersion: runtimeTypes_1.SALES_AGENT_PROMPT_VERSION,
        runtimeMode: "dry_run",
        currentTime: FIXED_TIME,
        allowedCapabilities: salesAgentInput.availableCapabilities
    });
    strict_1.default.deepEqual(promptA, promptB);
    strict_1.default.equal(promptA.promptText.includes("Bearer hidden"), false);
});
(0, node_test_1.default)("does not mutate the salesAgentInput", async () => {
    const runtimeInput = makeRuntimeInput({
        enabled: true,
        provider: (0, fakeSalesAgentProvider_1.createFakeSalesAgentProvider)({ behavior: "valid" })
    });
    const before = JSON.stringify(runtimeInput.salesAgentInput);
    await (0, runSalesAgentDryRun_1.runSalesAgentDryRun)(runtimeInput);
    strict_1.default.equal(JSON.stringify(runtimeInput.salesAgentInput), before);
});
(0, node_test_1.default)("returns deterministic output with a fixed clock and fake provider", async () => {
    const provider = (0, fakeSalesAgentProvider_1.createFakeSalesAgentProvider)({ behavior: "valid" });
    const runtimeInput = makeRuntimeInput({
        enabled: true,
        provider,
        clock: FIXED_CLOCK
    });
    const first = await (0, runSalesAgentDryRun_1.runSalesAgentDryRun)(runtimeInput);
    const second = await (0, runSalesAgentDryRun_1.runSalesAgentDryRun)(makeRuntimeInput({ enabled: true, provider, clock: FIXED_CLOCK }));
    strict_1.default.deepEqual(first, second);
});
