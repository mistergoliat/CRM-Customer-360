import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentTurnInput } from "@/lib/brain/commercial/agent-turn-input";
import {
  buildAgentTurnInputShadow,
  buildAgentTurnInputShadowConversationContext,
  finalizeAgentTurnInputShadowObservation,
  type AgentTurnInputShadowObservation
} from "@/lib/brain/commercial/agent-turn-input/shadow";
import { normalizeAgentTurnInputShadowBuiltEvent } from "@/lib/brain/commercial/events/normalize";
import { buildAgentTurnInputShadowFeatureFlags } from "@/lib/brain/commercial/config/commercialCycleConfig";
import { runSalesAgentRuntime } from "@/lib/brain/commercial/sales-agent-runtime";
import type { SalesAgentRuntimeInput } from "@/lib/brain/commercial/sales-agent-runtime";
import type { AgentLoopProviderRequest, AgentLoopProviderResponse } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";
import { createInMemoryAgentSessionStore } from "@/lib/brain/commercial/agent-session/inMemoryAgentSessionStore";
import type { CustomerMessageEvent } from "@/lib/brain/commercial/agent-runtime-event/types";
import { makeCommercialFreshness, type CommercialDomainReadModel } from "@/lib/brain/commercial/domain-read-model";

const CURRENT = "2026-09-15T12:00:00.000Z";
const CURRENT_TURN = "Sí, cotízame esa opción con el despacho más económico.";

function domainModel(overrides: Partial<CommercialDomainReadModel> = {}): CommercialDomainReadModel {
  return {
    case: {
      caseId: "commercial-case-83",
      conversationId: 83,
      opportunityId: 7001,
      workId: "cw-83",
      workVersion: 4,
      status: "ACTIVE",
      blockers: [],
      freshness: makeCommercialFreshness({ state: "CURRENT", source: "crm_commercial_work", sourceVersion: 4 })
    },
    objective: {
      objectiveId: "objective-83",
      type: "CREATE_QUOTE",
      status: "IN_PROGRESS",
      missingRequirements: ["SHIPPING"],
      blockers: [],
      freshness: makeCommercialFreshness({ state: "CURRENT", source: "crm_commercial_work", sourceVersion: 4 })
    },
    cart: {
      factId: "cart-83",
      updatedAt: CURRENT,
      items: [
        { productId: "kong", combinationId: null, quantity: 1, product: null, freshness: makeCommercialFreshness({ state: "CURRENT", source: "crm_request_facts:commercial_line_items" }) },
        { productId: "15kg", combinationId: null, quantity: 2, product: null, freshness: makeCommercialFreshness({ state: "CURRENT", source: "crm_request_facts:commercial_line_items" }) }
      ],
      freshness: makeCommercialFreshness({ state: "CURRENT", source: "crm_request_facts:commercial_line_items" })
    },
    destination: {
      factId: "destination-83",
      communeId: 134,
      canonicalName: "San Bernardo",
      updatedAt: CURRENT,
      freshness: makeCommercialFreshness({ state: "CURRENT", source: "crm_request_facts:shipping_destination" })
    },
    shipping: {
      state: "MISSING",
      selection: null,
      calculation: null,
      freshness: makeCommercialFreshness({ state: "UNKNOWN", source: "crm_request_facts:selected_shipping_option", reason: "shipping_calculation_missing" })
    },
    quote: null,
    customer: {
      status: "unknown",
      identityLevel: "LEVEL_2_MASTER_RESOLVED",
      hasResolvedCustomer: true,
      verificationRequired: false,
      profile: null
    },
    conversation: { conversationId: 83, sessionVersion: "session-83" },
    evidence: [],
    ...overrides
  };
}

function shadowInput(overrides: Partial<Parameters<typeof buildAgentTurnInputShadow>[0]> = {}) {
  return {
    domainReadModel: domainModel(),
    opportunityId: 7001,
    currentTurn: {
      inboundMessageId: "inbound-83",
      channel: "whatsapp" as const,
      text: CURRENT_TURN,
      occurredAt: CURRENT,
      correlationId: "corr-83"
    },
    conversationContext: buildAgentTurnInputShadowConversationContext({
      legacySummary: { recentMessages: [{ direction: "outbound", body: "¿Qué producto necesitas?" }] },
      historicalMessages: null,
      continuity: { isFirstConversationalTurn: false, hasPriorAssistantMessages: true, hasPriorCustomerMessages: false }
    }),
    trustedCustomerSession: null,
    humanOwnerActive: false,
    aiBlocked: false,
    correlationId: "corr-83",
    conversationId: "83",
    inboundMessageId: "inbound-83",
    metrics: { dbReads: 4, httpReads: 2 },
    ...overrides
  };
}

function baseEvent(overrides: Partial<CustomerMessageEvent> = {}): CustomerMessageEvent {
  return {
    type: "CUSTOMER_MESSAGE",
    conversationId: 83,
    conversationPublicId: "conversation-83",
    customerMasterId: null,
    waId: "56999999999",
    phoneNumberId: "phone-83",
    messageId: "inbound-83",
    messageText: CURRENT_TURN,
    correlationId: "corr-83",
    currentTime: CURRENT,
    ...overrides
  };
}

function recordingProvider(sink: AgentLoopProviderRequest[]) {
  return {
    name: "p2-recording-provider",
    version: "p2-provider.v1",
    async invoke(request: AgentLoopProviderRequest): Promise<AgentLoopProviderResponse> {
      sink.push(request);
      return {
        rawOutput: { type: "respond", message: "Respuesta estable." },
        model: "p2-test-model",
        inputTokens: 10,
        outputTokens: 5,
        finishReason: "stop"
      };
    }
  };
}

function runtimeInput(overrides: Partial<SalesAgentRuntimeInput> = {}): SalesAgentRuntimeInput {
  return {
    event: baseEvent(),
    opportunityId: 7001,
    provider: null,
    commercialContextSummary: { recentMessages: [{ direction: "outbound", body: "¿Qué producto necesitas?" }] },
    persistentSessionCognitionEnabled: false,
    sessionStore: createInMemoryAgentSessionStore(),
    ...overrides
  };
}

test("P2 A/B: disabled shadow does not build; enabled shadow builds P1 from the conversation-83-like read model", async () => {
  let called = false;
  const off = await runSalesAgentRuntime(
    runtimeInput({
      agentTurnInputShadow: {
        enabled: false,
        buildDomainReadModel: async () => {
          called = true;
          return domainModel();
        }
      },
      provider: recordingProvider([])
    })
  );
  assert.equal(off.status, "responded");
  assert.equal(called, false);
  // Keep the pre-P2 runtime result shape untouched while the feature is off.
  assert.equal(off.agentTurnInputShadow, undefined);

  const prepared = await buildAgentTurnInputShadow(shadowInput());
  assert.equal(prepared.agentTurnInput.activeObjective?.type, "CREATE_QUOTE");
  assert.deepEqual(
    prepared.agentTurnInput.commercialState.cart.items.map((item) => [item.productId, item.quantity]),
    [["kong", 1], ["15kg", 2]]
  );
  assert.equal(prepared.agentTurnInput.commercialState.destination?.canonicalName, "San Bernardo");
  assert.equal(prepared.agentTurnInput.commercialState.shipping.status, "MISSING");
  assert.equal(prepared.observation.buildStatus, "PARTIAL");
  assert.equal(prepared.observation.case.objectiveType, "CREATE_QUOTE");
});

test("P2 C/D: no active work is explicit and durable CREATE_QUOTE mismatches responded/no-tool R3", async () => {
  const absent = await buildAgentTurnInputShadow(
    shadowInput({
      domainReadModel: domainModel({
        case: {
          ...domainModel().case,
          workId: null,
          workVersion: null,
          status: "NOT_CREATED",
          freshness: makeCommercialFreshness({ state: "UNKNOWN", source: "crm_commercial_work", reason: "commercial_work_not_found" })
        },
        objective: null
      })
    })
  );
  assert.equal(absent.observation.buildStatus, "NO_ACTIVE_WORK");
  assert.equal(absent.agentTurnInput.activeObjective, null);
  assert.equal(absent.observation.classification, "NO_ACTIVE_WORK");

  const finalized = finalizeAgentTurnInputShadowObservation({
    observation: (await buildAgentTurnInputShadow(shadowInput())).observation,
    r3CommercialObjective: "discover_need",
    terminalReason: "responded",
    toolExecutionCount: 0,
    outboxWritten: true,
    outboxId: 83
  });
  assert.equal(finalized.classification, "OBJECTIVE_MISMATCH");
  assert.equal(finalized.toolComparison, "OBJECTIVE_REQUIRES_PROGRESS_BUT_NO_TOOL_USED");
  assert.equal(finalized.state.shippingStatus, "MISSING");
});

test("P2 E/F: P0 and P1 failures stay isolated from the provider and customer result", async () => {
  const baselineSink: AgentLoopProviderRequest[] = [];
  const baseline = await runSalesAgentRuntime(runtimeInput({ provider: recordingProvider(baselineSink) }));
  const p0Sink: AgentLoopProviderRequest[] = [];
  const p0 = await runSalesAgentRuntime(
    runtimeInput({
      provider: recordingProvider(p0Sink),
      agentTurnInputShadow: {
        enabled: true,
        buildDomainReadModel: async () => {
          throw new Error("db details never belong in shadow telemetry");
        }
      }
    })
  );
  assert.equal(p0.status, "responded");
  assert.equal(p0.responseText, baseline.responseText);
  assert.equal(p0.agentTurnInputShadow?.buildStatus, "FAILED");
  assert.deepEqual(p0Sink[0]?.messages, baselineSink[0]?.messages);

  const p1Sink: AgentLoopProviderRequest[] = [];
  const p1 = await runSalesAgentRuntime(
    runtimeInput({
      provider: recordingProvider(p1Sink),
      agentTurnInputShadow: {
        enabled: true,
        buildDomainReadModel: async () => domainModel(),
        buildAgentTurnInputFn: (() => {
          throw new Error("simulated P1 failure");
        }) as typeof buildAgentTurnInput
      }
    })
  );
  assert.equal(p1.status, "responded");
  assert.equal(p1.responseText, "Respuesta estable.");
  assert.equal(p1.agentTurnInputShadow?.buildStatus, "FAILED");
  assert.equal(p1.agentTurnInputShadow?.warnings[0], "agent_turn_input_build_failed");
  assert.equal(p1Sink.length, 1);
});

test("P2 G/H/I/J: partial state, deterministic observation and PII-safe durable projection", async () => {
  const first = (await buildAgentTurnInputShadow(shadowInput())).observation;
  const second = (await buildAgentTurnInputShadow(shadowInput())).observation;
  assert.deepEqual(first, second);
  assert.equal(first.buildStatus, "PARTIAL");
  assert.equal(first.state.quoteStatus, null);
  assert.equal(first.state.quoteGrounding, null);

  const event = normalizeAgentTurnInputShadowBuiltEvent({
    inboundMessageId: first.inboundMessageId,
    conversationId: first.conversationId,
    correlationId: first.correlationId,
    payload: first as AgentTurnInputShadowObservation & { schemaVersion: "1" }
  });
  assert.equal(event.eventType, "agent_turn_input_shadow_built");
  assert.equal(event.dedupeKey, "agent-turn-input-shadow-built:inbound-83");
  const serialized = JSON.stringify({ observation: first, event });
  for (const forbidden of ["56999999999", "phone-83", "user@example.com", '"email":', "wa_id", CURRENT_TURN, "db details", "inputTokens", '"prompt":']) {
    assert.equal(serialized.includes(forbidden), false, `shadow contains forbidden value: ${forbidden}`);
  }

  const profileUnavailable = await buildAgentTurnInputShadow(shadowInput({
    domainReadModel: domainModel({
      customer: { ...domainModel().customer, profile: { status: "UNAVAILABLE", retrievedAt: null, relationshipSummary: null } }
    })
  }));
  assert.equal(profileUnavailable.observation.buildStatus, "PARTIAL");
  assert.equal(profileUnavailable.observation.warnings.includes("customer_profile_unavailable"), true);

  const quoteUnavailable = await buildAgentTurnInputShadow(shadowInput({
    domainReadModel: domainModel({
      quote: {
        quoteId: "quote-83",
        quoteNumber: null,
        status: "draft",
        currency: "CLP",
        total: null,
        validUntil: null,
        version: 1,
        selectionFactId: "cart-83",
        freshness: makeCommercialFreshness({ state: "UNKNOWN", source: "quote_service", reason: "quote_service_unavailable" }),
        grounding: "UNKNOWN"
      }
    })
  }));
  assert.equal(quoteUnavailable.observation.state.quoteGrounding, "UNKNOWN");
  assert.equal(quoteUnavailable.observation.warnings.includes("quote_service_unknown"), true);
});

test("P2 provider regression: the exact provider messages remain unchanged with shadow enabled", async () => {
  const offSink: AgentLoopProviderRequest[] = [];
  const off = await runSalesAgentRuntime(
    runtimeInput({ provider: recordingProvider(offSink), agentTurnInputShadow: undefined })
  );
  const onSink: AgentLoopProviderRequest[] = [];
  const on = await runSalesAgentRuntime(
    runtimeInput({
      provider: recordingProvider(onSink),
      agentTurnInputShadow: { enabled: true, buildDomainReadModel: async () => domainModel() }
    })
  );
  assert.equal(off.status, "responded");
  assert.equal(on.status, "responded");
  assert.deepEqual(onSink[0]?.messages, offSink[0]?.messages);
});

test("P2 flag defaults to false and remains independent from R3 routing", () => {
  const previous = process.env.BRAIN_R3_AGENT_TURN_INPUT_SHADOW_ENABLED;
  delete process.env.BRAIN_R3_AGENT_TURN_INPUT_SHADOW_ENABLED;
  try {
    assert.equal(buildAgentTurnInputShadowFeatureFlags().agentTurnInputShadowEnabled, false);
    assert.equal(buildAgentTurnInputShadowFeatureFlags({ agentTurnInputShadowEnabled: true }).agentTurnInputShadowEnabled, true);
  } finally {
    if (previous === undefined) delete process.env.BRAIN_R3_AGENT_TURN_INPUT_SHADOW_ENABLED;
    else process.env.BRAIN_R3_AGENT_TURN_INPUT_SHADOW_ENABLED = previous;
  }
});
