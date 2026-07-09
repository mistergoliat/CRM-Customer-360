import assert from "node:assert/strict";
import test from "node:test";
import { projectAutonomousCustomerContext } from "../../lib/brain/commercial/context/autonomousCustomerContext";
import type {
  Customer360AddressItem,
  Customer360OpportunityItem,
  Customer360OrderItem,
  Customer360ProfileItem,
  Customer360QuoteItem,
  Customer360Section,
  Customer360Snapshot
} from "../../lib/domains/customer-360";

function section<T>(source: string, items: T[], state: "real" | "partial" | "unavailable" | "error" = "real"): Customer360Section<T> {
  return { state, source, lastUpdatedAt: null, warnings: [], total: items.length, items };
}

function opportunity(overrides: Partial<Customer360OpportunityItem>): Customer360OpportunityItem {
  return {
    opportunityId: "opp-1",
    opportunityKey: "opp-1",
    status: "open",
    stage: "qualification",
    primaryIntent: "quote",
    priority: "normal",
    temperature: "warm",
    nextActionType: null,
    nextActionDueAt: null,
    lastActivityAt: "2026-07-01T00:00:00.000Z",
    currentSummary: "some internal summary text",
    sourceRef: "case-1",
    ...overrides
  };
}

function profile(overrides: Partial<Customer360ProfileItem>): Customer360ProfileItem {
  return {
    profileId: "profile-1",
    profileKey: "profile-1",
    opportunityKey: "opp-1",
    useCase: "trotadora",
    customerType: "retail",
    decisionReadiness: "ready",
    purchaseUrgency: "high",
    budgetMin: "CLP 100.000",
    budgetMax: "CLP 200.000",
    missingInformation: ["delivery_address"],
    lastUpdatedAt: "2026-07-01T00:00:00.000Z",
    sourceRef: "msg-1",
    ...overrides
  };
}

function quote(overrides: Partial<Customer360QuoteItem>): Customer360QuoteItem {
  return {
    quoteId: "quote-1",
    requestId: "request-1",
    status: "sent",
    version: 1,
    opportunityId: "opp-1",
    customerId: "123",
    total: "CLP 100.000",
    currency: "CLP",
    createdAt: "2026-07-01T00:00:00.000Z",
    sentAt: null,
    decidedAt: null,
    expiryAt: null,
    sourceRef: "action-1",
    ...overrides
  };
}

function address(overrides: Partial<Customer360AddressItem> = {}): Customer360AddressItem {
  return {
    contractName: "CustomerAddress",
    schemaVersion: "1.0.0",
    addressId: "addr-1",
    customerId: 123,
    createdByActionId: null,
    addressLabel: "Casa",
    recipientName: "Camila Rojas",
    recipientPhone: "+56912345678",
    streetName: "Av. Siempre Viva",
    streetNumber: "123",
    unit: null,
    commune: "Providencia",
    city: "Santiago",
    region: "Metropolitana",
    postalCode: null,
    deliveryNotes: "dejar en conserjeria",
    isDefault: true,
    isActive: true,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    confirmationState: "unknown",
    ...overrides
  };
}

function order(overrides: Partial<Customer360OrderItem> = {}): Customer360OrderItem {
  return {
    orderId: "2001",
    reference: "REF-2001",
    status: "paid",
    currentStateId: "5",
    stateName: "Paid",
    invoiceNumber: "F-100",
    totalPaid: "CLP 99.990",
    createdAt: "2026-07-01T00:00:00.000Z",
    sourceRef: "123",
    ...overrides
  };
}

function makeSnapshot(overrides: {
  opportunities?: Customer360OpportunityItem[];
  profiles?: Customer360ProfileItem[];
  quotes?: Customer360QuoteItem[];
  sectionsState?: Partial<Record<"conversations" | "messages" | "opportunities" | "profiles" | "actions" | "outcomes" | "quotes" | "orders" | "addresses" | "commercialEvents", "unavailable" | "error">>;
} = {}): Customer360Snapshot {
  const sectionsState = overrides.sectionsState ?? {};
  return {
    contractName: "Customer360Snapshot",
    schemaVersion: "1.0.0",
    snapshotVersion: 1,
    customerId: "123",
    identity: {
      state: "provisional",
      source: "master_customer",
      sourceRecordId: "123",
      customerKey: "master_customer:123",
      displayName: "Camila Rojas",
      firstname: "Camila",
      lastname: "Rojas",
      email: "camila@example.com",
      platformOrigin: "whatsapp",
      linkedIdentities: [{ type: "wa_id", value: "56912345678", source: "whatsapp", verified: true }]
    },
    profile: {
      source: "local_native_mariadb",
      state: "real",
      warnings: [],
      customerId: "123",
      displayName: "Camila Rojas",
      linkedIdentitiesCount: 1,
      counts: { conversations: 2, messages: 5, opportunities: 5, profiles: 5, actions: 3, outcomes: 3, quotes: 5, orders: 2, addresses: 1, commercialEvents: 4 },
      lastActivityAt: "2026-07-08T12:01:00.000Z"
    },
    sections: {
      conversations: section("conversation", [], sectionsState.conversations ?? "real"),
      messages: section(
        "conversation_message",
        [
          {
            messageId: "msg-1",
            conversationId: "conv-1",
            publicId: "msg-public-1",
            direction: "inbound",
            senderType: "customer",
            messageType: "text",
            status: "received",
            bodyPreview: "mi direccion es Av Siempre Viva 123, mi correo es camila@example.com",
            occurredAt: "2026-07-08T11:59:00.000Z",
            providerMessageId: "wamid-secret-1"
          }
        ],
        sectionsState.messages ?? "real"
      ),
      opportunities: section("crm_opportunities", overrides.opportunities ?? [opportunity({})], sectionsState.opportunities ?? "real"),
      profiles: section("crm_sales_need_profiles", overrides.profiles ?? [profile({})], sectionsState.profiles ?? "real"),
      actions: section(
        "crm_agent_actions",
        [
          {
            actionId: "action-1",
            actionType: "send_quote",
            status: "scheduled",
            riskLevel: "low",
            approvalRequirement: "operator_review",
            scheduledFor: "2026-07-08T12:10:00.000Z",
            expiresAt: null,
            finalMessage: "Aqui esta tu cotizacion final, te cobrare a tu tarjeta",
            draftMessage: "Borrador interno no verificado",
            sourceRef: "msg-1"
          }
        ],
        sectionsState.actions ?? "real"
      ),
      outcomes: section(
        "crm_action_outcomes",
        [
          {
            outcomeId: "outcome-1",
            actionId: "action-1",
            outcomeType: "sent",
            occurredAt: "2026-07-08T12:01:00.000Z",
            recordedAt: "2026-07-08T12:01:30.000Z",
            providerMessageId: "wamid-secret-2",
            sourceRef: "1"
          }
        ],
        sectionsState.outcomes ?? "real"
      ),
      quotes: section("crm_quotes", overrides.quotes ?? [quote({})], sectionsState.quotes ?? "real"),
      orders: section("ps_orders", [order({})], sectionsState.orders ?? "real"),
      addresses: section("customer_addresses", [address({})], sectionsState.addresses ?? "real"),
      commercialEvents: section("commercial_event", [], sectionsState.commercialEvents ?? "real")
    },
    lifecycle: { state: "real", source: "lifecycle_event_assembler", lastUpdatedAt: null, warnings: [], total: 0, items: [] },
    metadata: {
      source: "local_native_mariadb",
      freshness: { source: "local_native_mariadb", lastActivityAt: "2026-07-08T12:01:00.000Z", lastRefreshedAt: "2026-07-08T12:05:00.000Z", state: "fresh" },
      completeness: { state: "complete", score: 100, missing: [] },
      warnings: []
    }
  };
}

// ---------------------------------------------------------------------------
// Projector (tests 6-20)
// ---------------------------------------------------------------------------

test("projector: maps only allowlisted fields at every level", () => {
  const context = projectAutonomousCustomerContext(makeSnapshot());
  assert.deepEqual(Object.keys(context).sort(), ["contractName", "schemaVersion", "profile", "relationshipSummary", "commercialHistory", "dataQuality"].sort());
  assert.deepEqual(Object.keys(context.profile).sort(), ["displayName", "emailAvailable"].sort());
  assert.deepEqual(Object.keys(context.relationshipSummary).sort(), ["conversationCount", "opportunityCount", "quoteCount", "orderCount", "lastActivityAt"].sort());
  assert.deepEqual(Object.keys(context.commercialHistory).sort(), ["recentOpportunities", "recentNeedProfiles", "recentQuotes"].sort());
  assert.deepEqual(Object.keys(context.dataQuality).sort(), ["freshness", "completeness", "completenessScore", "unavailableSections"].sort());
  if (context.commercialHistory.recentOpportunities[0]) {
    assert.deepEqual(
      Object.keys(context.commercialHistory.recentOpportunities[0]).sort(),
      ["status", "stage", "primaryIntent", "priority", "temperature", "nextActionType", "nextActionDueAt"].sort()
    );
  }
});

test("projector: limits each collection to 3 items", () => {
  const opportunities = [1, 2, 3, 4, 5].map((n) => opportunity({ opportunityId: `opp-${n}`, lastActivityAt: `2026-07-0${n}T00:00:00.000Z` }));
  const profiles = [1, 2, 3, 4, 5].map((n) => profile({ profileId: `profile-${n}`, lastUpdatedAt: `2026-07-0${n}T00:00:00.000Z` }));
  const quotes = [1, 2, 3, 4, 5].map((n) => quote({ quoteId: `quote-${n}`, createdAt: `2026-07-0${n}T00:00:00.000Z` }));

  const context = projectAutonomousCustomerContext(makeSnapshot({ opportunities, profiles, quotes }));
  assert.equal(context.commercialHistory.recentOpportunities.length, 3);
  assert.equal(context.commercialHistory.recentNeedProfiles.length, 3);
  assert.equal(context.commercialHistory.recentQuotes.length, 3);
});

test("projector: uses deterministic newest-first order", () => {
  const opportunities = [
    opportunity({ opportunityId: "opp-old", lastActivityAt: "2026-07-01T00:00:00.000Z" }),
    opportunity({ opportunityId: "opp-new", lastActivityAt: "2026-07-05T00:00:00.000Z" }),
    opportunity({ opportunityId: "opp-mid", lastActivityAt: "2026-07-03T00:00:00.000Z" })
  ];
  const context = projectAutonomousCustomerContext(makeSnapshot({ opportunities }));
  // primaryIntent doubles as a stable marker since the projection drops opportunityId.
  assert.deepEqual(
    context.commercialHistory.recentOpportunities.map((item) => item.nextActionDueAt ?? item.stage),
    ["qualification", "qualification", "qualification"]
  );

  // Re-run with a distinguishing field (stage) to assert actual order.
  const distinguishable = [
    opportunity({ opportunityId: "opp-old", stage: "old", lastActivityAt: "2026-07-01T00:00:00.000Z" }),
    opportunity({ opportunityId: "opp-new", stage: "new", lastActivityAt: "2026-07-05T00:00:00.000Z" }),
    opportunity({ opportunityId: "opp-mid", stage: "mid", lastActivityAt: "2026-07-03T00:00:00.000Z" })
  ];
  const ordered = projectAutonomousCustomerContext(makeSnapshot({ opportunities: distinguishable }));
  assert.deepEqual(ordered.commercialHistory.recentOpportunities.map((item) => item.stage), ["new", "mid", "old"]);

  // Same run twice must produce the same order (deterministic).
  const again = projectAutonomousCustomerContext(makeSnapshot({ opportunities: distinguishable }));
  assert.deepEqual(again.commercialHistory.recentOpportunities.map((item) => item.stage), ordered.commercialHistory.recentOpportunities.map((item) => item.stage));
});

test("projector: never mutates the source snapshot", () => {
  const snapshot = makeSnapshot({
    opportunities: [
      opportunity({ opportunityId: "opp-a", lastActivityAt: "2026-07-01T00:00:00.000Z" }),
      opportunity({ opportunityId: "opp-b", lastActivityAt: "2026-07-05T00:00:00.000Z" })
    ]
  });
  const before = JSON.stringify(snapshot);
  projectAutonomousCustomerContext(snapshot);
  assert.equal(JSON.stringify(snapshot), before);
});

test("projector: never contains the full email address", () => {
  const context = projectAutonomousCustomerContext(makeSnapshot());
  assert.equal(context.profile.emailAvailable, true);
  assert.doesNotMatch(JSON.stringify(context), /camila@example\.com/);
});

test("projector: never contains a phone number", () => {
  const context = projectAutonomousCustomerContext(makeSnapshot());
  assert.doesNotMatch(JSON.stringify(context), /56912345678/);
});

test("projector: never contains linked identities", () => {
  const context = projectAutonomousCustomerContext(makeSnapshot());
  const serialized = JSON.stringify(context);
  assert.doesNotMatch(serialized, /linkedIdentities/);
  assert.doesNotMatch(serialized, /wa_id/);
});

test("projector: never contains addresses", () => {
  const context = projectAutonomousCustomerContext(makeSnapshot());
  const serialized = JSON.stringify(context);
  assert.doesNotMatch(serialized, /Siempre Viva/);
  assert.doesNotMatch(serialized, /Providencia/);
  assert.doesNotMatch(serialized, /addressId/);
  assert.doesNotMatch(serialized, /recipientName/);
  assert.doesNotMatch(serialized, /conserjeria/);
});

test("projector: never contains order references", () => {
  const context = projectAutonomousCustomerContext(makeSnapshot());
  assert.doesNotMatch(JSON.stringify(context), /REF-2001/);
});

test("projector: never contains an invoice number", () => {
  const context = projectAutonomousCustomerContext(makeSnapshot());
  assert.doesNotMatch(JSON.stringify(context), /F-100/);
});

test("projector: never contains message bodies", () => {
  const context = projectAutonomousCustomerContext(makeSnapshot());
  assert.doesNotMatch(JSON.stringify(context), /mi direccion es/);
});

test("projector: never contains draft or final messages", () => {
  const context = projectAutonomousCustomerContext(makeSnapshot());
  const serialized = JSON.stringify(context);
  assert.doesNotMatch(serialized, /Borrador interno/);
  assert.doesNotMatch(serialized, /cotizacion final/);
});

test("projector: never contains provider message ids", () => {
  const context = projectAutonomousCustomerContext(makeSnapshot());
  assert.doesNotMatch(JSON.stringify(context), /wamid-secret/);
});

test("projector: never contains a free-form metadata bag", () => {
  const context = projectAutonomousCustomerContext(makeSnapshot());
  assert.equal("metadata" in context, false);
  for (const value of Object.values(context)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      assert.equal("metadata" in value, false);
    }
  }
});

test("projector: never contains the full snapshot", () => {
  const context = projectAutonomousCustomerContext(makeSnapshot());
  const contextAsRecord = context as unknown as Record<string, unknown>;
  assert.equal("sections" in contextAsRecord, false);
  assert.equal("lifecycle" in contextAsRecord, false);
  assert.equal("identity" in contextAsRecord, false);
  assert.equal("customerId" in contextAsRecord, false);
});
