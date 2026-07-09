import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import { createCustomer360QueryService, createLifecycleEventAssembler, type AddressBookPortResult, type Customer360AddressItem, type Customer360ProfileProjection, type Customer360Section, type CustomerProfilePortResult, type Customer360Snapshot } from "../../lib/domains/customer-360";
import { createCustomer360GetHandler } from "../../app/api/customers/[id]/360/route";

function section<T>(source: string, items: T[], state: "real" | "partial" | "unavailable" | "error" = "real"): Customer360Section<T> {
  return {
    state,
    source,
    lastUpdatedAt: items.length > 0 ? "2026-07-08T12:00:00.000Z" : null,
    warnings: state === "real" ? [] : [`${source}_degraded`],
    total: items.length,
    items
  };
}

function makeProfileProjection(overrides: Partial<Customer360ProfileProjection> = {}): Customer360ProfileProjection {
  const conversations = section("conversation", [
    {
      conversationId: "conv-1",
      publicId: "conv-public-1",
      channel: "whatsapp",
      provider: "meta",
      externalContactId: "56912345678",
      status: "open",
      aiEnabled: true,
      humanOwnerActive: false,
      lastMessageAt: "2026-07-08T11:59:00.000Z",
      lastInboundAt: "2026-07-08T11:59:00.000Z",
      lastOutboundAt: null,
      lastMessagePreview: "Hola",
      messageCount: 1
    }
  ]);
  const messages = section("conversation_message", [
    {
      messageId: "msg-1",
      conversationId: "conv-1",
      publicId: "msg-public-1",
      direction: "inbound",
      senderType: "customer",
      messageType: "text",
      status: "received",
      bodyPreview: "Hola",
      occurredAt: "2026-07-08T11:59:00.000Z",
      providerMessageId: "wamid-1"
    }
  ]);
  const opportunities = section("crm_opportunities", [
    {
      opportunityId: "opp-1",
      opportunityKey: "opp-1",
      status: "open",
      stage: "qualification",
      primaryIntent: "quote",
      priority: "normal",
      temperature: "warm",
      nextActionType: "follow_up",
      nextActionDueAt: "2026-07-08T12:30:00.000Z",
      lastActivityAt: "2026-07-08T11:58:00.000Z",
      currentSummary: "Need summary",
      sourceRef: "case-1"
    }
  ]);
  const profiles = section("crm_sales_need_profiles", [
    {
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
      lastUpdatedAt: "2026-07-08T11:57:00.000Z",
      sourceRef: "msg-1"
    }
  ]);
  const actions = section("crm_agent_actions", [
    {
      actionId: "action-1",
      actionType: "send_quote",
      status: "scheduled",
      riskLevel: "low",
      approvalRequirement: "operator_review",
      scheduledFor: "2026-07-08T12:10:00.000Z",
      expiresAt: null,
      finalMessage: "Te envio la cotizacion",
      draftMessage: "Draft",
      sourceRef: "msg-1"
    }
  ]);
  const outcomes = section("crm_action_outcomes", [
    {
      outcomeId: "outcome-1",
      actionId: "action-1",
      outcomeType: "sent",
      occurredAt: "2026-07-08T12:01:00.000Z",
      recordedAt: "2026-07-08T12:01:30.000Z",
      providerMessageId: "wamid-1",
      sourceRef: "1"
    }
  ]);
  const quotes = section("crm_quotes", [
    {
      quoteId: "quote-1",
      requestId: "request-1",
      status: "sent",
      version: 1,
      opportunityId: "opp-1",
      customerId: "123",
      total: "CLP 100.000",
      currency: "CLP",
      createdAt: "2026-07-08T11:55:00.000Z",
      sentAt: "2026-07-08T11:56:00.000Z",
      decidedAt: null,
      expiryAt: null,
      sourceRef: "action-1"
    }
  ]);
  const orders = section("ps_orders", [
    {
      orderId: "2001",
      reference: "REF-2001",
      status: "paid",
      currentStateId: "5",
      stateName: "Paid",
      invoiceNumber: "F-100",
      totalPaid: "CLP 99.990",
      createdAt: "2026-07-08T11:50:00.000Z",
      sourceRef: "123"
    }
  ]);
  const commercialEvents = section("commercial_event", [
    {
      eventId: "event-1",
      eventType: "customer_message_received",
      source: "meta_whatsapp",
      occurredAt: "2026-07-08T11:59:00.000Z",
      correlationId: "corr-1",
      conversationId: "conv-1",
      opportunityId: "opp-1",
      sourceRef: "wamid-1",
      summary: "Inbound message"
    }
  ]);

  return {
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
      linkedIdentities: [
        { type: "wa_id", value: "56912345678", source: "whatsapp", verified: true }
      ]
    },
    profile: {
      source: "local_native_mariadb",
      state: "real",
      warnings: [],
      customerId: "123",
      displayName: "Camila Rojas",
      linkedIdentitiesCount: 1,
      counts: {
        conversations: 1,
        messages: 1,
        opportunities: 1,
        profiles: 1,
        actions: 1,
        outcomes: 1,
        quotes: 1,
        orders: 1,
        addresses: 0,
        commercialEvents: 1
      },
      lastActivityAt: "2026-07-08T12:01:00.000Z"
    },
    sections: {
      conversations,
      messages,
      opportunities,
      profiles,
      actions,
      outcomes,
      quotes,
      orders,
      commercialEvents
    },
    freshness: {
      source: "local_native_mariadb",
      lastActivityAt: "2026-07-08T12:01:00.000Z",
      lastRefreshedAt: "2026-07-08T12:05:00.000Z",
      state: "fresh"
    },
    completeness: {
      state: "complete",
      score: 100,
      missing: []
    },
    warnings: [],
    ...overrides
  };
}

function makeSnapshot(overrides: Partial<Customer360Snapshot> = {}): Customer360Snapshot {
  const projection = makeProfileProjection();
  return {
    contractName: "Customer360Snapshot",
    schemaVersion: "1.0.0",
    snapshotVersion: 1,
    customerId: "123",
    identity: projection.identity,
    profile: projection.profile,
    sections: {
      ...projection.sections,
      addresses: section("customer_addresses", [
        {
          contractName: "CustomerAddress",
          schemaVersion: "1.0.0",
          addressId: "addr-1",
          customerId: 123,
          createdByActionId: null,
          addressLabel: "Casa",
          recipientName: "Camila Rojas",
          recipientPhone: null,
          streetName: "Av. Siempre Viva",
          streetNumber: "123",
          unit: null,
          commune: "Providencia",
          city: "Santiago",
          region: "Metropolitana",
          postalCode: null,
          deliveryNotes: null,
          isDefault: true,
          isActive: true,
          createdAt: "2026-07-08T11:00:00.000Z",
          updatedAt: "2026-07-08T11:00:00.000Z",
          confirmationState: "unknown"
        }
      ])
    },
    lifecycle: {
      state: "partial",
      source: "test",
      lastUpdatedAt: null,
      warnings: [],
      total: 0,
      items: []
    },
    metadata: {
      source: "test",
      freshness: projection.freshness,
      completeness: projection.completeness,
      warnings: []
    },
    ...overrides
  };
}

test("Customer360QueryService composes a snapshot from injected ports only", async () => {
  let profilePortCalled = false;
  let addressBookPortCalled = false;
  const service = createCustomer360QueryService({
    profilePort: {
      async loadCustomerProfile(customerId: string): Promise<CustomerProfilePortResult> {
        profilePortCalled = true;
        assert.equal(customerId, "123");
        return {
          state: "real",
          source: "fake-profile-port",
          warnings: [],
          profile: makeProfileProjection()
        };
      }
    },
    addressBookPort: {
      async loadAddressBook(customerId: string): Promise<AddressBookPortResult> {
        addressBookPortCalled = true;
        assert.equal(customerId, "123");
        const addresses = section<Customer360AddressItem>("customer_addresses", [
          {
            contractName: "CustomerAddress",
            schemaVersion: "1.0.0",
            addressId: "addr-1",
            customerId: 123,
            createdByActionId: null,
            addressLabel: "Casa",
            recipientName: "Camila Rojas",
            recipientPhone: null,
            streetName: "Av. Siempre Viva",
            streetNumber: "123",
            unit: null,
            commune: "Providencia",
            city: "Santiago",
            region: "Metropolitana",
            postalCode: null,
            deliveryNotes: null,
            isDefault: true,
            isActive: true,
            createdAt: "2026-07-08T11:00:00.000Z",
            updatedAt: "2026-07-08T11:00:00.000Z",
            confirmationState: "unknown"
          }
        ]);
        return {
          state: "real",
          source: "fake-address-port",
          warnings: [],
          addresses
        };
      }
    },
    lifecycleEventAssembler: createLifecycleEventAssembler(),
    now: () => new Date("2026-07-08T12:05:00.000Z")
  });

  const snapshot = await service.getByCustomerId("123");
  assert.ok(snapshot);
  assert.equal(profilePortCalled, true);
  assert.equal(addressBookPortCalled, true);
  assert.equal(snapshot?.identity.displayName, "Camila Rojas");
  assert.equal(snapshot?.sections.addresses.total, 1);
  assert.equal(snapshot?.lifecycle.total > 0, true);
  assert.equal(snapshot?.metadata.completeness.state, "complete");
});

test("Customer360QueryService degrades when address source is unavailable", async () => {
  const service = createCustomer360QueryService({
    profilePort: {
      async loadCustomerProfile(): Promise<CustomerProfilePortResult> {
        return {
          state: "real",
          source: "fake-profile-port",
          warnings: ["profile_warning"],
          profile: makeProfileProjection()
        };
      }
    },
    addressBookPort: {
      async loadAddressBook(): Promise<AddressBookPortResult> {
        return {
          state: "unavailable",
          source: "fake-address-port",
          warnings: ["address_source_down"],
          addresses: null
        };
      }
    },
    now: () => new Date("2026-07-08T12:05:00.000Z")
  });

  const snapshot = await service.getByCustomerId("123");
  assert.ok(snapshot);
  assert.equal(snapshot?.sections.addresses.state, "unavailable");
  assert.equal(snapshot?.metadata.completeness.state, "partial");
  assert.ok(snapshot?.metadata.warnings.includes("address_source_down"));
});

// ---------------------------------------------------------------------------
// loadByCustomerId (ACS-R1-04-T05, tests 1-5): found/not_found/unavailable.
// ---------------------------------------------------------------------------

test("loadByCustomerId: customer found returns status found with the snapshot", async () => {
    const service = createCustomer360QueryService({
      profilePort: {
        async loadCustomerProfile(): Promise<CustomerProfilePortResult> {
          return { state: "real", source: "fake-profile-port", warnings: [], profile: makeProfileProjection() };
        }
      },
      addressBookPort: {
        async loadAddressBook(): Promise<AddressBookPortResult> {
          return { state: "real", source: "fake-address-port", warnings: [], addresses: section("customer_addresses", []) };
        }
      },
      now: () => new Date("2026-07-08T12:05:00.000Z")
    });

    const result = await service.loadByCustomerId("123");
    assert.equal(result.status, "found");
    assert.ok(result.snapshot);
    assert.equal(result.snapshot?.customerId, "123");
  });

  test("loadByCustomerId: a genuinely nonexistent customer returns status not_found", async () => {
    const service = createCustomer360QueryService({
      profilePort: {
        async loadCustomerProfile(): Promise<CustomerProfilePortResult> {
          // Query succeeded, zero rows - only the not_found marker, no infra warning.
          return { state: "unavailable", source: "fake-profile-port", warnings: ["customer_not_found"], profile: null };
        }
      },
      addressBookPort: {
        async loadAddressBook(): Promise<AddressBookPortResult> {
          return { state: "real", source: "fake-address-port", warnings: [], addresses: section("customer_addresses", []) };
        }
      }
    });

    const result = await service.loadByCustomerId("999");
    assert.equal(result.status, "not_found");
    assert.equal(result.snapshot, null);
  });

  test("loadByCustomerId: a table/query/profile failure returns status unavailable, never not_found", async () => {
    const service = createCustomer360QueryService({
      profilePort: {
        async loadCustomerProfile(): Promise<CustomerProfilePortResult> {
          return { state: "partial", source: "fake-profile-port", warnings: ["master_customer_unavailable", "customer_not_found"], profile: null };
        }
      },
      addressBookPort: {
        async loadAddressBook(): Promise<AddressBookPortResult> {
          return { state: "real", source: "fake-address-port", warnings: [], addresses: section("customer_addresses", []) };
        }
      }
    });

    const result = await service.loadByCustomerId("123");
    assert.equal(result.status, "unavailable");
    assert.equal(result.snapshot, null);
  });

  test("loadByCustomerId: getByCustomerId stays backward compatible for both found and missing cases", async () => {
    const foundService = createCustomer360QueryService({
      profilePort: { async loadCustomerProfile() { return { state: "real", source: "p", warnings: [], profile: makeProfileProjection() }; } },
      addressBookPort: { async loadAddressBook() { return { state: "real", source: "a", warnings: [], addresses: section("customer_addresses", []) }; } }
    });
    assert.ok(await foundService.getByCustomerId("123"));

    const missingService = createCustomer360QueryService({
      profilePort: { async loadCustomerProfile() { return { state: "unavailable", source: "p", warnings: ["customer_not_found"], profile: null }; } },
      addressBookPort: { async loadAddressBook() { return { state: "real", source: "a", warnings: [], addresses: section("customer_addresses", []) }; } }
    });
    assert.equal(await missingService.getByCustomerId("999"), null);
  });

  test("loadByCustomerId: the found snapshot keeps the exact same shape as before this change", async () => {
    const service = createCustomer360QueryService({
      profilePort: { async loadCustomerProfile() { return { state: "real", source: "p", warnings: [], profile: makeProfileProjection() }; } },
      addressBookPort: { async loadAddressBook() { return { state: "real", source: "a", warnings: [], addresses: section("customer_addresses", []) }; } },
      now: () => new Date("2026-07-08T12:05:00.000Z")
    });

    const result = await service.loadByCustomerId("123");
    assert.equal(result.status, "found");
    assert.deepEqual(
      Object.keys(result.snapshot ?? {}).sort(),
      ["contractName", "schemaVersion", "snapshotVersion", "customerId", "identity", "profile", "sections", "lifecycle", "metadata"].sort()
    );
    assert.equal(result.snapshot?.contractName, "Customer360Snapshot");
    assert.equal(result.snapshot?.identity.displayName, "Camila Rojas");
});

test("Customer360 route enforces operator auth", async () => {
  const handler = createCustomer360GetHandler({
    requireOperator: async () => ({ ok: false as const, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) }),
    service: {
      async getByCustomerId() {
        return makeProfileProjection() as never;
      }
    }
  });

  const response = await handler(new Request("http://localhost/api/customers/123/360"), { params: Promise.resolve({ id: "123" }) });
  assert.equal(response.status, 401);
});

test("Customer360 route returns the snapshot when authorized", async () => {
  const handler = createCustomer360GetHandler({
    requireOperator: async () => ({ ok: true as const }),
    service: {
      async getByCustomerId(customerId: string) {
        assert.equal(customerId, "123");
        return makeSnapshot();
      }
    }
  });

  const response = await handler(new Request("http://localhost/api/customers/123/360"), { params: Promise.resolve({ id: "123" }) });
  assert.equal(response.status, 200);
  const body = await response.json() as { customerId: string; identity: { displayName: string } };
  assert.equal(body.customerId, "123");
  assert.equal(body.identity.displayName, "Camila Rojas");
});
