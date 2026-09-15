import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentTurnInput,
  type AgentCapabilityExposure,
  type AgentConversationContext,
  type AgentExecutionPolicy
} from "@/lib/brain/commercial/agent-turn-input";
import { makeCommercialFreshness, type CommercialDomainReadModel } from "@/lib/brain/commercial/domain-read-model";

const CURRENT = "2026-09-15T12:00:00.000Z";

function model(overrides: Partial<CommercialDomainReadModel> = {}): CommercialDomainReadModel {
  return {
    case: {
      caseId: "commercial-case-1",
      conversationId: 83,
      opportunityId: 7001,
      workId: "cw-public-1",
      workVersion: 4,
      status: "ACTIVE",
      blockers: [],
      freshness: makeCommercialFreshness({ state: "CURRENT", source: "crm_commercial_work", sourceVersion: 4 })
    },
    objective: {
      objectiveId: "objective-1",
      type: "CREATE_QUOTE",
      status: "IN_PROGRESS",
      missingRequirements: [],
      blockers: [],
      freshness: makeCommercialFreshness({ state: "CURRENT", source: "crm_commercial_work", sourceVersion: 4 })
    },
    cart: {
      factId: "cart-fact-1",
      updatedAt: "2026-09-15T11:00:00.000Z",
      items: [
        {
          productId: "kong",
          combinationId: null,
          quantity: 1,
          product: {
            productId: "kong",
            name: "Kong",
            sku: "SKU-KONG",
            price: { amount: 10000, currency: "CLP", taxIncluded: true, taxRate: 0.19, discountApplied: false },
            availability: "in_stock",
            stockQuantity: 10,
            weightKg: 15,
            retrievedAt: "2026-09-15T11:05:00.000Z",
            provenance: { source: "catalog_service_http", retrievedAt: "2026-09-15T11:05:00.000Z", cached: false },
            freshness: makeCommercialFreshness({ state: "CURRENT", source: "catalog_service", capturedAt: "2026-09-15T11:05:00.000Z" })
          },
          freshness: makeCommercialFreshness({ state: "CURRENT", source: "crm_request_facts:commercial_line_items" })
        },
        {
          productId: "plates-15kg",
          combinationId: null,
          quantity: 2,
          product: null,
          freshness: makeCommercialFreshness({ state: "UNKNOWN", source: "catalog_service", reason: "catalog_unavailable" })
        }
      ],
      freshness: makeCommercialFreshness({ state: "CURRENT", source: "crm_request_facts:commercial_line_items" })
    },
    destination: {
      factId: "destination-fact-1",
      communeId: 134,
      canonicalName: "San Bernardo",
      updatedAt: "2026-09-15T11:01:00.000Z",
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
      identityLevel: null,
      hasResolvedCustomer: false,
      verificationRequired: false,
      profile: null
    },
    conversation: { conversationId: 83, sessionVersion: "session-v1" },
    evidence: [
      { kind: "case", status: "CURRENT", source: "crm_commercial_work", capturedAt: CURRENT, reference: "cw-public-1", summary: "commercial_work_current" },
      { kind: "cart", status: "CURRENT", source: "crm_request_facts:commercial_line_items", capturedAt: "2026-09-15T11:00:00.000Z", reference: "cart-fact-1", summary: "cart_current" },
      { kind: "catalog_product", status: "CURRENT", source: "catalog_service", capturedAt: "2026-09-15T11:05:00.000Z", reference: "kong", summary: "catalog_product_hydrated" }
    ],
    ...overrides
  };
}

function conversationContext(overrides: Partial<AgentConversationContext> = {}): AgentConversationContext {
  return {
    compactSummary: "Customer is continuing a commercial conversation.",
    recentMessages: [{ role: "assistant", text: "¿Qué producto necesitas?", occurredAt: "2026-09-15T11:59:00.000Z" }],
    sessionVersion: "session-v1",
    continuity: { isFirstConversationalTurn: false, hasPriorAssistantMessages: true, hasPriorCustomerMessages: true },
    ...overrides
  };
}

function policy(overrides: Partial<AgentExecutionPolicy> = {}): AgentExecutionPolicy {
  return {
    identityLevel: "LEVEL_2_MASTER_RESOLVED",
    humanOwner: false,
    aiBlocked: false,
    allowedSensitiveActions: ["create_quote"],
    handoff: { allowedReasons: ["customer_requested", "policy_blocked"] },
    ...overrides
  };
}

function capabilities(): AgentCapabilityExposure[] {
  return [
    {
      name: "create_quote",
      sideEffect: true,
      availability: "AVAILABLE",
      useWhen: "the purchase selection is sufficiently established",
      preconditions: ["commercial selection is current"]
    }
  ];
}

function build(overrides: {
  readModel?: CommercialDomainReadModel;
  turnText?: string;
  capabilities?: readonly AgentCapabilityExposure[];
  executionPolicy?: AgentExecutionPolicy;
  conversation?: AgentConversationContext;
} = {}) {
  return buildAgentTurnInput({
    domainReadModel: overrides.readModel ?? model(),
    currentTurn: {
      inboundMessageId: "inbound-1",
      channel: "whatsapp",
      text: overrides.turnText ?? "Sí, cotízame esa opción con el despacho más económico.",
      occurredAt: CURRENT,
      correlationId: "correlation-1"
    },
    conversationContext: overrides.conversation ?? conversationContext(),
    capabilities: overrides.capabilities ?? capabilities(),
    executionPolicy: overrides.executionPolicy ?? policy()
  });
}

test("A: golden CREATE_QUOTE input projects current cart/destination and missing shipping", () => {
  const input = build();

  assert.equal(input.activeObjective?.type, "CREATE_QUOTE");
  assert.equal(input.commercialState.cart.freshness, "CURRENT");
  assert.deepEqual(
    input.commercialState.cart.items.map((item) => [item.productId, item.quantity]),
    [["kong", 1], ["plates-15kg", 2]]
  );
  assert.equal(input.commercialState.destination?.canonicalName, "San Bernardo");
  assert.equal(input.commercialState.destination?.freshness, "CURRENT");
  assert.equal(input.commercialState.shipping.status, "MISSING");
  assert.equal(input.commercialState.shipping.freshness, "MISSING");
  assert.equal(input.commercialState.quote, null);
  assert.equal(input.currentTurn.text, "Sí, cotízame esa opción con el despacho más económico.");
});

test("B: stale shipping is explicit and its old selection is not projected as current", () => {
  const input = build({
    readModel: model({
      shipping: {
        state: "STALE",
        selection: {
          factId: "selection-1",
          shippingQuoteExecutionId: "shipping-execution-1",
          selectionFactId: "old-cart",
          destinationFactId: "destination-fact-1",
          optionIndex: 0,
          carrierName: "Chilexpress",
          serviceType: "normal",
          totalCost: 5990,
          estimatedDelivery: "2-3 días hábiles",
          calculatedAt: CURRENT,
          selectedAt: CURRENT
        },
        calculation: null,
        freshness: makeCommercialFreshness({ state: "STALE", source: "crm_request_facts:selected_shipping_option" })
      }
    })
  });

  assert.equal(input.commercialState.shipping.status, "STALE");
  assert.equal(input.commercialState.shipping.freshness, "STALE");
  assert.equal(input.commercialState.shipping.selectedOption, null);
});

test("C: stale quote preserves grounding and freshness without becoming current", () => {
  const input = build({
    readModel: model({
      quote: {
        quoteId: "quote-1",
        quoteNumber: "COT-1",
        status: "draft",
        currency: "CLP",
        total: "159990",
        validUntil: "2026-09-30T23:59:59.000Z",
        version: 3,
        selectionFactId: "old-cart",
        freshness: makeCommercialFreshness({ state: "STALE", source: "quote_service", sourceVersion: 3, reason: "selection_changed" }),
        grounding: "STALE"
      }
    })
  });

  assert.equal(input.commercialState.quote?.grounding, "STALE");
  assert.equal(input.commercialState.quote?.freshness, "STALE");
  assert.equal(input.commercialState.quote?.total, "159990");
});

test("D: unavailable Customer Profile does not erase identity or case", () => {
  const input = build({ readModel: model({ customer: { status: "identified", identityLevel: "LEVEL_2_MASTER_RESOLVED", hasResolvedCustomer: true, verificationRequired: false, profile: { status: "UNAVAILABLE", retrievedAt: null, relationshipSummary: null } } }) });

  assert.deepEqual(input.customerContext.identity, {
    status: "identified",
    identityLevel: "LEVEL_2_MASTER_RESOLVED",
    hasResolvedCustomer: true,
    verificationRequired: false
  });
  assert.equal(input.customerContext.profile, null);
  assert.equal(input.caseState.status, "ACTIVE");
});

test("E: unavailable Catalog hydration preserves product identity and quantity", () => {
  const input = build();
  const missingHydration = input.commercialState.cart.items.find((item) => item.productId === "plates-15kg");

  assert.deepEqual(
    { productId: missingHydration?.productId, combinationId: missingHydration?.combinationId, quantity: missingHydration?.quantity },
    { productId: "plates-15kg", combinationId: null, quantity: 2 }
  );
  assert.equal(missingHydration?.product, null);
  assert.equal(missingHydration?.freshness, "UNKNOWN");
});

test("F: historical evidence remains evidence and never enters current commercial state", () => {
  const historical = {
    kind: "old_quote",
    status: "HISTORICAL" as const,
    source: "quote_service",
    capturedAt: "2026-08-01T12:00:00.000Z",
    reference: "old-quote-internal-ref",
    summary: "historical_quote_available"
  };
  const input = build({ readModel: model({ evidence: [...model().evidence, historical] }) });

  assert.equal(input.relevantEvidence.at(-1)?.status, "HISTORICAL");
  assert.equal(input.relevantEvidence.at(-1)?.summary, "historical_quote_available");
  assert.equal(input.commercialState.quote, null);
  assert.equal(input.commercialState.shipping.selectedOption, null);
  assert.equal(JSON.stringify(input.commercialState).includes("old-quote-internal-ref"), false);
});

test("G: PII firewall excludes raw external identity, payload and secret-shaped fields", () => {
  const input = build();
  const serialized = JSON.stringify(input);

  for (const forbidden of ["wa_id", "phoneNumberId", "phone", "email", "authorization", "Bearer", "token", "rawPayload", "customerProfilePayload", "rawQuote", "rawMeta"]) {
    assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()), false, `forbidden value/key leaked: ${forbidden}`);
  }
  assert.equal("wa_id" in input.currentTurn, false);
  assert.equal("phoneNumberId" in input.customerContext, false);
  assert.equal("selectionFactId" in (input.commercialState.quote ?? {}), false);
});

test("H: same inputs produce deep-equal output", () => {
  assert.deepEqual(build(), build());
});

test("I: empty capabilities are represented without invented actions", () => {
  const input = build({ capabilities: [] });

  assert.deepEqual(input.capabilities, []);
});

test("J: human owner and AI blocked are reflected only in execution policy", () => {
  const input = build({ executionPolicy: policy({ humanOwner: true, aiBlocked: true, allowedSensitiveActions: [] }) });

  assert.equal(input.executionPolicy.humanOwner, true);
  assert.equal(input.executionPolicy.aiBlocked, true);
  assert.deepEqual(input.executionPolicy.allowedSensitiveActions, []);
  assert.equal(input.caseState.status, "ACTIVE");
  assert.equal(input.activeObjective?.type, "CREATE_QUOTE");
});

test("objective is not inferred from the current turn or session context", () => {
  const input = build({
    readModel: model({ objective: null }),
    turnText: "CREATE_QUOTE: cotízame todo",
    conversation: conversationContext({ compactSummary: "CREATE_QUOTE was discussed previously." })
  });

  assert.equal(input.activeObjective, null);
});
