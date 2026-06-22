"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIXED_CLOCK = exports.FIXED_NOW = exports.FIXED_TIME = void 0;
exports.makeRecentMessage = makeRecentMessage;
exports.makeBrainContextResolveResponse = makeBrainContextResolveResponse;
exports.makeNormalizedInboundMessage = makeNormalizedInboundMessage;
exports.makeCommercialShadowFlags = makeCommercialShadowFlags;
exports.makeCommercialPolicyFlags = makeCommercialPolicyFlags;
exports.makeBrainContextSummary = makeBrainContextSummary;
exports.makeBrainActionResolveResponse = makeBrainActionResolveResponse;
exports.makeCommercialShadowInput = makeCommercialShadowInput;
exports.makeInboundRequest = makeInboundRequest;
const policy_1 = require("../../lib/brain/commercial/policy");
const shadow_1 = require("../../lib/brain/commercial/shadow");
const runtimeTypes_1 = require("../../lib/brain/commercial/sales-agent/runtimeTypes");
exports.FIXED_TIME = "2026-06-17T12:00:00.000Z";
exports.FIXED_NOW = Date.parse(exports.FIXED_TIME);
exports.FIXED_CLOCK = {
    now: () => exports.FIXED_NOW,
    toISOString: (value) => {
        const date = value instanceof Date ? value : new Date(value);
        return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
    }
};
function makeRecentMessage(index) {
    const minute = String(index).padStart(2, "0");
    return {
        message_id: index,
        direction: index % 2 === 0 ? "inbound" : "outbound",
        message_text: index % 2 === 0 ? `Mensaje inbound ${index}` : `Mensaje outbound ${index}`,
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
        source_table: "n8n_conversation_messages",
        source_id: index,
        technical_origin: null
    };
}
function makeBrainContextResolveResponse(overrides = {}) {
    return {
        ok: true,
        request_id: "context-001",
        partial_context: false,
        input_event: {
            channel: "whatsapp",
            source: "manual_test",
            wa_id: "56912345678",
            phone_number_id: "phone-001",
            message_id: "wamid.general.1",
            message_text: "Hola, quiero saber precio y stock de una trotadora",
            conversation_case_id: 4821,
            id_order: 20001,
            id_customer: 10045,
            invoice_number: 30001,
            source_workflow: "wa-webhook",
            source_node: "incoming",
            received_at: exports.FIXED_TIME,
            dry_run: true
        },
        resolver_identity: {
            provisional: true,
            identity_type: "wa_id",
            identity_key: "56912345678",
            confidence: 0.95,
            wa_id: "56912345678",
            phone_number_id: "phone-001",
            conversation_case_id: 4821,
            id_order: 20001,
            id_customer: 10045,
            invoice_number: 30001,
            notes: ["fixture"]
        },
        customer_context: {
            wa_id: "56912345678",
            phone_number_id: "phone-001",
            contact_name: "Cliente",
            email: "cliente@example.com",
            contact_id: 40001,
            id_customer: 10045,
            id_order: 20001,
            invoice_number: 30001,
            suppression_active: false,
            hard_suppression: false,
            suppression_reason: null,
            blocked_until: null,
            last_inbound_at: exports.FIXED_TIME,
            last_outbound_at: exports.FIXED_TIME,
            last_manual_reply_at: null,
            open_cases_count: 1,
            active_case_id: 4821,
            active_case_status: "open",
            latest_case_status: "open"
        },
        case_context: {
            active_case: {
                conversation_case_id: 4821,
                active_case_key: "case-001",
                status: "open",
                lifecycle_status: "open",
                department: "ventas",
                service_code: "quote_requested",
                priority: "medium",
                requires_human: false,
                bot_replied: false,
                final_action: "continue",
                ai_blocked: false,
                wa_id: "56912345678",
                phone_number_id: "phone-001",
                id_order: 20001,
                id_customer: 10045,
                invoice_number: 30001,
                source_table: "n8n_cases",
                source_id: 4821,
                whatsapp_window_open: true,
                last_message_at: exports.FIXED_TIME,
                created_at: exports.FIXED_TIME,
                updated_at: exports.FIXED_TIME,
                closed_at: null,
                raw_status: "open"
            },
            latest_case: null,
            open_cases: [],
            case_count: 1,
            waiting_human_case: false,
            closed_or_rejected_case: false,
            manual_operator_lock: false,
            last_case_status: "open",
            last_case_final_action: "continue"
        },
        conversation_context: {
            recent_messages: [makeRecentMessage(1), makeRecentMessage(2), makeRecentMessage(3)],
            recent_inbound_messages: [makeRecentMessage(2)],
            recent_outbound_messages: [makeRecentMessage(3)],
            recent_manual_replies: [],
            recent_agent_runs: [],
            message_count: 3,
            last_inbound_at: exports.FIXED_TIME,
            last_outbound_at: exports.FIXED_TIME,
            last_manual_reply_at: null
        },
        business_context: {
            ps_orders: [
                {
                    id_order: 20001,
                    id_customer: 10045,
                    invoice_number: 30001,
                    reference: "order-001",
                    status: "paid",
                    total_paid: 79990,
                    customer_name: "Cliente",
                    payment: "card",
                    created_at: exports.FIXED_TIME,
                    updated_at: exports.FIXED_TIME,
                    source_table: "n8n_orders"
                }
            ],
            postventa_queue: null,
            mantenciones_queue: null,
            context_mode: "standard",
            dry_run: true,
            include_postventa: true,
            include_agent_runs: true
        },
        service_context: {
            primary_service: "sales",
            service_code: "quote_requested",
            source_domain: "sales",
            source_table: "n8n_cases",
            source_id: 4821,
            source_status: "open",
            source_priority: "medium",
            suggested_agent: "sales_agent",
            signals: ["customer_message_present"]
        },
        bot_eligibility: {
            eligible: true,
            recommended_mode: "bot",
            confidence: 0.95,
            reason: "Fixture resolved context.",
            blockers: [],
            can_auto_reply: true,
            can_human_handoff: true,
            can_case_mutation: false,
            signals: {
                manual_operator_lock: false,
                active_human_case: false,
                suppression_active: false,
                recent_manual_reply: false,
                open_case_waiting_human: false,
                closed_or_rejected_case: false,
                ambiguous_positive_reply_with_service_context: false
            }
        },
        context_packs: {
            sales: {
                agent: "sales",
                available: true,
                confidence: 0.95,
                reason: "Fixture",
                signals: ["customer_message_present"],
                recommended_action: "answer",
                related_case_id: 4821,
                related_order_id: 20001
            },
            sac: {
                agent: "sac",
                available: false,
                confidence: 0.1,
                reason: "Fixture",
                signals: [],
                recommended_action: "noop",
                related_case_id: null,
                related_order_id: null
            },
            postventa: {
                agent: "postventa",
                available: false,
                confidence: 0.1,
                reason: "Fixture",
                signals: [],
                recommended_action: "noop",
                related_case_id: null,
                related_order_id: null
            },
            knowledge: {
                agent: "knowledge",
                available: true,
                confidence: 0.8,
                reason: "Fixture",
                signals: [],
                recommended_action: "context_only",
                related_case_id: 4821,
                related_order_id: 20001
            },
            campaign: {
                agent: "campaign",
                available: false,
                confidence: 0.1,
                reason: "Fixture",
                signals: [],
                recommended_action: "noop",
                related_case_id: null,
                related_order_id: null
            }
        },
        warnings: [],
        errors: [],
        metadata: {
            version: "brain.context.resolve.v1",
            generatedAt: exports.FIXED_TIME,
            processingMs: 1,
            dryRun: true,
            maxMessages: 12,
            maxAgentRuns: 5,
            maxCases: 5,
            includePostventa: true,
            includeAgentRuns: true,
            sourceWorkflow: "wa-webhook",
            sourceNode: "incoming"
        },
        ...overrides
    };
}
function makeNormalizedInboundMessage(overrides = {}) {
    return {
        channel: "whatsapp",
        source: "manual_test",
        contextMode: "standard",
        waId: "56912345678",
        phoneNumberId: "phone-001",
        messageId: "wamid.general.1",
        messageText: "Hola, quiero saber precio y stock de una trotadora",
        conversationCaseId: 4821,
        customerRef: {
            waId: "56912345678",
            phoneNumberId: "phone-001",
            idCustomer: 10045,
            idOrder: 20001,
            invoiceNumber: 30001,
            email: "cliente@example.com",
            contactId: 40001
        },
        options: {
            dryRun: true,
            executeActions: false,
            returnInstructionsForN8n: true,
            debug: false,
            runAgentDryRun: false,
            buildExecutionPlanDryRun: false
        },
        receivedAt: exports.FIXED_TIME,
        sourceWorkflow: "wa-webhook",
        sourceNode: "incoming",
        metadata: {
            safeTraceId: "trace-001"
        },
        ...overrides
    };
}
function makeCommercialShadowFlags(overrides = {}) {
    return {
        ...shadow_1.COMMERCIAL_SHADOW_DEFAULT_FEATURE_FLAGS,
        commercialShadowEnabled: true,
        commercialRuntimeEnabled: true,
        commercialPolicyEnabled: true,
        ...overrides
    };
}
function makeCommercialPolicyFlags(overrides = {}) {
    return {
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
        allowOutboundProposals: true,
        ...overrides
    };
}
function makeBrainContextSummary() {
    return {
        requestId: "brain-request-001",
        partialContext: false,
        waId: "56912345678",
        phoneNumberId: "phone-001",
        messageId: "wamid.general.1",
        conversationCaseId: 4821,
        identityType: "wa_id",
        identityConfidence: 0.95,
        activeCaseId: 4821,
        activeCaseStatus: "open",
        caseCount: 1,
        messageCount: 3,
        primaryService: "sales",
        serviceCode: "quote_requested",
        botEligible: true,
        botRecommendedMode: "bot",
        botReason: "Fixture",
        contextPacksAvailable: ["sales", "knowledge"],
        warnings: []
    };
}
function makeBrainActionResolveResponse(overrides = {}) {
    const contextSummary = overrides.context_summary ?? makeBrainContextSummary();
    const actionPolicy = overrides.action_policy ?? {
        policyId: "policy-001",
        decision: "continue_legacy",
        reason: "Fixture action policy.",
        blocked_reasons: [],
        can_auto_reply: true,
        can_human_handoff: true,
        can_case_mutation: false,
        continue_legacy_flow: true,
        should_reply: true,
        requires_human: false,
        confidence: 0.95,
        signals: [],
        suggested_next_step: "context_only"
    };
    const normalizedAction = overrides.normalized_action ?? {
        action: "continue_legacy",
        final_action: "continue_legacy",
        should_reply: true,
        should_continue_legacy_flow: true,
        requires_human: false,
        blocked: false,
        allow_auto_reply: true,
        allow_human_handoff: true,
        allow_case_mutation: false,
        reason: "Fixture normalized action.",
        blocked_reasons: [],
        signals: []
    };
    return {
        ok: true,
        request_id: "action-001",
        context_summary: contextSummary,
        bot_eligibility: contextSummary.botEligible
            ? {
                eligible: true,
                recommended_mode: "bot",
                confidence: 0.95,
                reason: "Fixture action response.",
                blockers: [],
                can_auto_reply: true,
                can_human_handoff: true,
                can_case_mutation: false,
                signals: {
                    manual_operator_lock: false,
                    active_human_case: false,
                    suppression_active: false,
                    recent_manual_reply: false,
                    open_case_waiting_human: false,
                    closed_or_rejected_case: false,
                    ambiguous_positive_reply_with_service_context: false
                }
            }
            : null,
        service_context: {
            primary_service: "sales",
            service_code: "quote_requested",
            source_domain: "sales",
            source_table: "n8n_cases",
            source_id: 4821,
            source_status: "open",
            source_priority: "medium",
            suggested_agent: "sales_agent",
            signals: ["customer_message_present"]
        },
        action_policy: actionPolicy,
        normalized_action: normalizedAction,
        blocked_reasons: [],
        warnings: [],
        errors: [],
        instructions: {
            version: "brain.action.policy.v1",
            dryRun: true,
            executeActions: false,
            returnInstructionsForN8n: true,
            continueLegacyFlow: true,
            contextSummary,
            actionPolicy,
            normalizedAction,
            blockedReasons: [],
            botEligibility: null,
            contextPacksAvailable: contextSummary.contextPacksAvailable,
            suggestedNextStep: "context_only",
            actions: [],
            steps: []
        },
        metadata: {
            version: "brain.action.policy.v1",
            generatedAt: exports.FIXED_TIME,
            processingMs: 1,
            dryRun: true,
            executeActions: false,
            returnInstructionsForN8n: true,
            debug: false
        },
        ...overrides
    };
}
function makeCommercialShadowInput(overrides = {}) {
    return {
        inboundMessage: overrides.inboundMessage ?? makeNormalizedInboundMessage(),
        brainContext: overrides.brainContext ?? makeBrainContextResolveResponse(),
        correlationId: overrides.correlationId ?? "corr-001",
        executionId: overrides.executionId ?? "exec-001",
        currentTime: overrides.currentTime ?? exports.FIXED_TIME,
        timezone: overrides.timezone ?? "America/Santiago",
        requestedMode: overrides.requestedMode ?? "standard",
        policyContext: overrides.policyContext ?? null,
        provider: overrides.provider ?? null,
        runtimeOptions: {
            enabled: true,
            mode: "dry_run",
            timeoutMs: 250,
            maxInputCharacters: 20000,
            maxOutputCharacters: 12000,
            strictValidation: true,
            allowedCapabilities: ["searchKnowledge", "getConversationHistory", "searchProducts", "getProductStock", "getOrderByInvoice"],
            captureRawOutput: false,
            includePromptPreview: false,
            dryRun: true,
            abortSignal: null
        },
        policyFlags: makeCommercialPolicyFlags(),
        shadowFlags: makeCommercialShadowFlags(),
        contractVersion: runtimeTypes_1.SALES_AGENT_CONTRACT_VERSION,
        promptVersion: runtimeTypes_1.SALES_AGENT_PROMPT_VERSION,
        policyVersion: "brain.commercial.policy.v1",
        allowedCapabilities: ["searchKnowledge", "getConversationHistory", "searchProducts", "getProductStock", "getOrderByInvoice"],
        metadata: {
            safeTraceId: "trace-001"
        },
        abortSignal: null,
        ...overrides
    };
}
function makeInboundRequest(overrides = {}) {
    return {
        channel: "whatsapp",
        source: "manual_test",
        contextMode: "standard",
        waId: "56912345678",
        phoneNumberId: "phone-001",
        messageId: "wamid.general.1",
        messageText: "Hola, quiero saber precio y stock de una trotadora",
        conversationCaseId: 4821,
        customerRef: {
            waId: "56912345678",
            phoneNumberId: "phone-001",
            idCustomer: 10045,
            idOrder: 20001,
            invoiceNumber: 30001,
            email: "cliente@example.com",
            contactId: 40001
        },
        options: {
            dryRun: true,
            executeActions: false,
            returnInstructionsForN8n: true,
            debug: false,
            runAgentDryRun: false,
            buildExecutionPlanDryRun: false
        },
        receivedAt: exports.FIXED_TIME,
        sourceWorkflow: "wa-webhook",
        sourceNode: "incoming",
        metadata: {
            safeTraceId: "trace-001"
        },
        ...overrides
    };
}
