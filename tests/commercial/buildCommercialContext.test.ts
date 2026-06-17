import assert from "node:assert/strict";
import test from "node:test";
import { COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES } from "../../lib/brain/commercial/constants";
import { buildCommercialContext } from "../../lib/brain/commercial/context/buildCommercialContext";

const FIXED_TIME = "2026-06-17T12:00:00.000Z";

function makeRecentMessage(index: number) {
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

function makeBrainContext(overrides: Record<string, unknown> = {}) {
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

function makeInboundMessage(overrides: Record<string, unknown> = {}) {
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

test("builds commercial context for a general product question", () => {
  const result = buildCommercialContext({
    brainContext: makeBrainContext(),
    inboundMessage: makeInboundMessage(),
    requestedMode: "standard",
    currentTime: FIXED_TIME,
    timezone: "America/Santiago",
    availableCapabilities: ["searchKnowledge", "getConversationHistory"]
  });

  assert.equal(result.status, "success");
  assert.equal(result.salesAgentInput?.messages.latestInboundMessage?.text, "Hola, quiero saber precio y stock de una trotadora");
  assert.ok(result.salesAgentInput?.structuralSignals.includes("customer_message_present"));
  assert.equal(result.salesAgentInput?.structuralSignals.some((signal) => String(signal) === "high_intent"), false);
  assert.ok(result.warnings.includes("missing_commercial_entity"));
  assert.equal(result.completeness, "complete");
});

test("builds commercial context for a price request", () => {
  const result = buildCommercialContext({
    brainContext: makeBrainContext(),
    inboundMessage: makeInboundMessage({ message_text: "¿Cuál es el precio de la caminadora?" }),
    requestedMode: "standard",
    currentTime: FIXED_TIME,
    timezone: "America/Santiago",
    availableCapabilities: ["searchProducts", "getProductStock"]
  });

  assert.equal(result.status, "success");
  assert.ok(result.salesAgentInput?.structuralSignals.includes("customer_message_present"));
  assert.ok(result.salesAgentInput?.messages.latestInboundMessage?.text?.includes("precio"));
  assert.equal(result.salesAgentInput?.structuralSignals.some((signal) => String(signal) === "objection_price"), false);
});

test("keeps customer candidate when present and does not invent lead or opportunity", () => {
  const result = buildCommercialContext({
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

  assert.equal(result.salesAgentInput?.identity.customerCandidate !== null, true);
  assert.equal(result.salesAgentInput?.commercial.lead, undefined);
  assert.equal(result.salesAgentInput?.commercial.opportunity, undefined);
  assert.ok(result.warnings.includes("missing_commercial_entity"));
});

test("marks missing customer candidate without failing closed", () => {
  const result = buildCommercialContext({
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

  assert.equal(result.status, "success");
  assert.equal(result.salesAgentInput?.identity.customerCandidate, null);
  assert.ok(result.warnings.includes("missing_customer_reference") === false);
});

test("marks ai blocked and human owner active", () => {
  const result = buildCommercialContext({
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

  assert.ok(result.warnings.includes("ai_blocked"));
  assert.ok(result.warnings.includes("human_owner_active"));
  assert.ok(result.salesAgentInput?.structuralSignals.includes("ai_blocked"));
  assert.ok(result.salesAgentInput?.structuralSignals.includes("human_owner_active"));
});

test("marks missing conversation history when no history exists", () => {
  const result = buildCommercialContext({
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

  assert.ok(result.warnings.includes("missing_conversation_history"));
  assert.ok(result.salesAgentInput?.structuralSignals.includes("conversation_history_available") === false);
});

test("returns insufficient context for minimal unsupported shape", () => {
  const result = buildCommercialContext({
    brainContext: {},
    inboundMessage: {},
    requestedMode: "minimal",
    currentTime: FIXED_TIME,
    timezone: "America/Santiago",
    availableCapabilities: []
  });

  assert.equal(result.status, "insufficient_context");
  assert.equal(result.completeness, "insufficient");
  assert.ok(result.warnings.includes("unsupported_context_shape"));
  assert.ok(result.warnings.includes("missing_latest_customer_message"));
});

test("serializes bigint and numeric ids safely", () => {
  const result = buildCommercialContext({
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

  assert.equal(typeof result.salesAgentInput?.identity.idCustomer, "string");
  assert.equal(typeof result.salesAgentInput?.identity.idOrder, "number");
  assert.equal(typeof result.salesAgentInput?.identity.invoiceNumber, "string");
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("sanitizes sensitive payloads and metadata", () => {
  const result = buildCommercialContext({
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

  assert.ok(result.warnings.includes("sanitization_applied"));
  assert.ok(result.metadata.safeMetadata.safeField === "kept" || result.metadata.safeMetadata.safeTraceId === "trace-001");
  assert.equal(Object.prototype.hasOwnProperty.call(result.metadata.safeMetadata, "token"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.salesAgentInput?.messages.latestInboundMessage ?? {}, "rawWebhook"), false);
});

test("is deterministic for the same input", () => {
  const input = {
    brainContext: makeBrainContext(),
    inboundMessage: makeInboundMessage(),
    requestedMode: "standard" as const,
    currentTime: FIXED_TIME,
    timezone: "America/Santiago",
    availableCapabilities: ["searchKnowledge", "getConversationHistory"] as const,
    metadata: {
      safeTraceId: "trace-001"
    }
  };

  const first = buildCommercialContext(input);
  const second = buildCommercialContext(input);

  assert.deepEqual(first, second);
});

test("limits recent messages to the safe constant", () => {
  const result = buildCommercialContext({
    brainContext: {
      conversation_context: {
        recent_messages: Array.from({ length: COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES + 5 }, (_, index) => makeRecentMessage(index))
      }
    },
    inboundMessage: makeInboundMessage(),
    requestedMode: "standard",
    currentTime: FIXED_TIME,
    timezone: "America/Santiago",
    availableCapabilities: ["getConversationHistory"]
  });

  assert.ok((result.salesAgentInput?.messages.recentMessages.length ?? 0) <= COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES);
});
