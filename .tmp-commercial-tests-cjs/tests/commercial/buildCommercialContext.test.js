"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const constants_1 = require("../../lib/brain/commercial/constants");
const buildCommercialContext_1 = require("../../lib/brain/commercial/context/buildCommercialContext");
const FIXED_TIME = "2026-06-17T12:00:00.000Z";
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
(0, node_test_1.default)("builds commercial context for a general product question", () => {
    const result = (0, buildCommercialContext_1.buildCommercialContext)({
        brainContext: makeBrainContext(),
        inboundMessage: makeInboundMessage(),
        requestedMode: "standard",
        currentTime: FIXED_TIME,
        timezone: "America/Santiago",
        availableCapabilities: ["searchKnowledge", "getConversationHistory"]
    });
    strict_1.default.equal(result.status, "success");
    strict_1.default.equal(result.salesAgentInput?.messages.latestInboundMessage?.text, "Hola, quiero saber precio y stock de una trotadora");
    strict_1.default.ok(result.salesAgentInput?.structuralSignals.includes("customer_message_present"));
    strict_1.default.equal(result.salesAgentInput?.structuralSignals.some((signal) => String(signal) === "high_intent"), false);
    strict_1.default.ok(result.warnings.includes("missing_commercial_entity"));
    strict_1.default.equal(result.completeness, "complete");
});
(0, node_test_1.default)("builds commercial context for a price request", () => {
    const result = (0, buildCommercialContext_1.buildCommercialContext)({
        brainContext: makeBrainContext(),
        inboundMessage: makeInboundMessage({ message_text: "¿Cuál es el precio de la caminadora?" }),
        requestedMode: "standard",
        currentTime: FIXED_TIME,
        timezone: "America/Santiago",
        availableCapabilities: ["searchProducts", "getProductStock"]
    });
    strict_1.default.equal(result.status, "success");
    strict_1.default.ok(result.salesAgentInput?.structuralSignals.includes("customer_message_present"));
    strict_1.default.ok(result.salesAgentInput?.messages.latestInboundMessage?.text?.includes("precio"));
    strict_1.default.equal(result.salesAgentInput?.structuralSignals.some((signal) => String(signal) === "objection_price"), false);
});
(0, node_test_1.default)("keeps customer candidate when present and does not invent lead or opportunity", () => {
    const result = (0, buildCommercialContext_1.buildCommercialContext)({
        brainContext: makeBrainContext({
            case_context: {
                conversation_case_id: 4821,
                status: "open",
                lifecycle_status: "open",
                department: "ventas",
                lead_id: 999,
                opportunity_id: 1234
            },
            conversation_context: {
                recent_messages: [makeRecentMessage(1)],
                lead_id: 999,
                opportunity_id: 1234
            }
        }),
        inboundMessage: makeInboundMessage(),
        requestedMode: "recovery",
        currentTime: FIXED_TIME,
        timezone: "America/Santiago",
        availableCapabilities: ["getConversationHistory"]
    });
    strict_1.default.equal(result.salesAgentInput?.identity.customerCandidate !== null, true);
    strict_1.default.equal(result.salesAgentInput?.commercial.lead, undefined);
    strict_1.default.equal(result.salesAgentInput?.commercial.opportunity, undefined);
    strict_1.default.ok(result.warnings.includes("missing_commercial_entity"));
});
(0, node_test_1.default)("marks missing customer candidate without failing closed", () => {
    const result = (0, buildCommercialContext_1.buildCommercialContext)({
        brainContext: makeBrainContext({
            customer_context: {
                wa_id: "56912345678",
                phone_number_id: "phone-001"
            }
        }),
        inboundMessage: makeInboundMessage(),
        requestedMode: "minimal",
        currentTime: FIXED_TIME,
        timezone: "America/Santiago",
        availableCapabilities: ["getConversationHistory"]
    });
    strict_1.default.equal(result.status, "success");
    strict_1.default.equal(result.salesAgentInput?.identity.customerCandidate, null);
    strict_1.default.ok(result.warnings.includes("missing_customer_reference") === false);
});
(0, node_test_1.default)("marks ai blocked and human owner active", () => {
    const result = (0, buildCommercialContext_1.buildCommercialContext)({
        brainContext: makeBrainContext({
            case_context: {
                conversation_case_id: 4821,
                status: "waiting_human",
                lifecycle_status: "waiting_human",
                department: "ventas",
                requires_human: true,
                ai_blocked: true,
                manual_operator_lock: true,
                bot_replied: false,
                final_action: "manual_operator_reply",
                updated_at: "2026-06-17T11:55:00.000Z"
            }
        }),
        inboundMessage: makeInboundMessage(),
        requestedMode: "standard",
        currentTime: FIXED_TIME,
        timezone: "America/Santiago",
        availableCapabilities: ["getConversationHistory"]
    });
    strict_1.default.ok(result.warnings.includes("ai_blocked"));
    strict_1.default.ok(result.warnings.includes("human_owner_active"));
    strict_1.default.ok(result.salesAgentInput?.structuralSignals.includes("ai_blocked"));
    strict_1.default.ok(result.salesAgentInput?.structuralSignals.includes("human_owner_active"));
});
(0, node_test_1.default)("marks missing conversation history when no history exists", () => {
    const result = (0, buildCommercialContext_1.buildCommercialContext)({
        brainContext: makeBrainContext({
            conversation_context: {
                recent_messages: []
            }
        }),
        inboundMessage: makeInboundMessage(),
        requestedMode: "standard",
        currentTime: FIXED_TIME,
        timezone: "America/Santiago",
        availableCapabilities: ["getConversationHistory"]
    });
    strict_1.default.ok(result.warnings.includes("missing_conversation_history"));
    strict_1.default.ok(result.salesAgentInput?.structuralSignals.includes("conversation_history_available") === false);
});
(0, node_test_1.default)("returns insufficient context for minimal unsupported shape", () => {
    const result = (0, buildCommercialContext_1.buildCommercialContext)({
        brainContext: {},
        inboundMessage: {},
        requestedMode: "minimal",
        currentTime: FIXED_TIME,
        timezone: "America/Santiago",
        availableCapabilities: []
    });
    strict_1.default.equal(result.status, "insufficient_context");
    strict_1.default.equal(result.completeness, "insufficient");
    strict_1.default.ok(result.warnings.includes("unsupported_context_shape"));
    strict_1.default.ok(result.warnings.includes("missing_latest_customer_message"));
});
(0, node_test_1.default)("serializes bigint and numeric ids safely", () => {
    const result = (0, buildCommercialContext_1.buildCommercialContext)({
        brainContext: makeBrainContext({
            customer_context: {
                wa_id: "56912345678",
                phone_number_id: "phone-001",
                id_customer: 9007199254740993n,
                id_order: 70001,
                invoice_number: 80001n,
                contact_id: 90001n
            }
        }),
        inboundMessage: makeInboundMessage({
            id: 1234n,
            conversation_case_id: 5678n
        }),
        requestedMode: "standard",
        currentTime: FIXED_TIME,
        timezone: "America/Santiago",
        availableCapabilities: ["getOrderByInvoice"]
    });
    strict_1.default.equal(typeof result.salesAgentInput?.identity.idCustomer, "string");
    strict_1.default.equal(typeof result.salesAgentInput?.identity.idOrder, "number");
    strict_1.default.equal(typeof result.salesAgentInput?.identity.invoiceNumber, "string");
    strict_1.default.doesNotThrow(() => JSON.stringify(result));
});
(0, node_test_1.default)("sanitizes sensitive payloads and metadata", () => {
    const result = (0, buildCommercialContext_1.buildCommercialContext)({
        brainContext: makeBrainContext({
            metadata: {
                sourceWorkflow: "wa-webhook",
                headers: {
                    authorization: "Bearer hidden"
                },
                token: "secret-token",
                rawWebhook: { should: "not-leak" },
                safeField: "kept"
            }
        }),
        inboundMessage: makeInboundMessage({
            headers: {
                authorization: "Bearer hidden"
            },
            rawWebhook: { leaked: true },
            token: "should-not-appear",
            credentials: {
                secret: true
            }
        }),
        requestedMode: "standard",
        currentTime: FIXED_TIME,
        timezone: "America/Santiago",
        availableCapabilities: ["searchKnowledge"],
        metadata: {
            token: "top-level-secret",
            safeTraceId: "trace-001"
        }
    });
    strict_1.default.ok(result.warnings.includes("sanitization_applied"));
    strict_1.default.ok(result.metadata.safeMetadata.safeField === "kept" || result.metadata.safeMetadata.safeTraceId === "trace-001");
    strict_1.default.equal(Object.prototype.hasOwnProperty.call(result.metadata.safeMetadata, "token"), false);
    strict_1.default.equal(Object.prototype.hasOwnProperty.call(result.salesAgentInput?.messages.latestInboundMessage ?? {}, "rawWebhook"), false);
});
(0, node_test_1.default)("is deterministic for the same input", () => {
    const input = {
        brainContext: makeBrainContext(),
        inboundMessage: makeInboundMessage(),
        requestedMode: "standard",
        currentTime: FIXED_TIME,
        timezone: "America/Santiago",
        availableCapabilities: ["searchKnowledge", "getConversationHistory"],
        metadata: {
            safeTraceId: "trace-001"
        }
    };
    const first = (0, buildCommercialContext_1.buildCommercialContext)(input);
    const second = (0, buildCommercialContext_1.buildCommercialContext)(input);
    strict_1.default.deepEqual(first, second);
});
(0, node_test_1.default)("limits recent messages to the safe constant", () => {
    const result = (0, buildCommercialContext_1.buildCommercialContext)({
        brainContext: {
            conversation_context: {
                recent_messages: Array.from({ length: constants_1.COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES + 5 }, (_, index) => makeRecentMessage(index))
            }
        },
        inboundMessage: makeInboundMessage(),
        requestedMode: "standard",
        currentTime: FIXED_TIME,
        timezone: "America/Santiago",
        availableCapabilities: ["getConversationHistory"]
    });
    strict_1.default.ok((result.salesAgentInput?.messages.recentMessages.length ?? 0) <= constants_1.COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES);
});
