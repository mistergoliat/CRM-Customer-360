import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test, { after } from "node:test";
import { getPool, safeQueryRows } from "@/lib/db";
import { createCustomer360QueryService } from "@/lib/domains/customer-360";
import type { Customer360LoadResult, Customer360Snapshot } from "@/lib/domains/customer-360";
import { processNativeWhatsAppInbound } from "@/lib/brain/native-whatsapp";
import { runNativeAutonomousCycle } from "@/lib/brain/commercial/native-cycle/runNativeAutonomousCycle";
import { projectAutonomousCustomerContext } from "@/lib/brain/commercial/context/autonomousCustomerContext";
import { loadAutonomousCustomerContext } from "@/lib/brain/commercial/context/loadAutonomousCustomerContext";

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "main_management",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "main_management",
  DATABASE_USER: "crm_app",
  DATABASE_PASSWORD: "una_clave_local",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true"
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

const REPO_ROOT = join(__dirname, "..", "..");

// Only the two modules this boundary actually governs - not the whole
// commercial context folder, which legitimately touches other domains
// (catalog, conversations) unrelated to this boundary.
const OWN_FILES = ["lib/brain/commercial/context/autonomousCustomerContext.ts", "lib/brain/commercial/context/loadAutonomousCustomerContext.ts"];

function readOwnFiles(): string {
  return OWN_FILES.map((relativePath) => readFileSync(join(REPO_ROOT, relativePath), "utf8")).join("\n");
}

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function uniqueConversationId() {
  return 900000000 + Math.floor(Math.random() * 99999999);
}

function makeSnapshot(overrides: Partial<Pick<Customer360Snapshot, "customerId">> & { displayName?: string; email?: string | null } = {}): Customer360Snapshot {
  const customerId = overrides.customerId ?? "123";
  const emptySection = <T,>(source: string) => ({ state: "real" as const, source, lastUpdatedAt: null, warnings: [], total: 0, items: [] as T[] });
  return {
    contractName: "Customer360Snapshot",
    schemaVersion: "1.0.0",
    snapshotVersion: 1,
    customerId,
    identity: {
      state: "provisional",
      source: "master_customer",
      sourceRecordId: customerId,
      customerKey: `master_customer:${customerId}`,
      displayName: overrides.displayName ?? `Customer ${customerId}`,
      firstname: null,
      lastname: null,
      email: overrides.email ?? null,
      platformOrigin: "whatsapp",
      linkedIdentities: []
    },
    profile: {
      source: "local_native_mariadb",
      state: "real",
      warnings: [],
      customerId,
      displayName: overrides.displayName ?? `Customer ${customerId}`,
      linkedIdentitiesCount: 0,
      counts: { conversations: 0, messages: 0, opportunities: 0, profiles: 0, actions: 0, outcomes: 0, quotes: 0, orders: 0, addresses: 1, commercialEvents: 0 },
      lastActivityAt: null
    },
    sections: {
      conversations: emptySection("conversation"),
      messages: emptySection("conversation_message"),
      opportunities: emptySection("crm_opportunities"),
      profiles: emptySection("crm_sales_need_profiles"),
      actions: emptySection("crm_agent_actions"),
      outcomes: emptySection("crm_action_outcomes"),
      quotes: emptySection("crm_quotes"),
      orders: emptySection("ps_orders"),
      addresses: {
        state: "real",
        source: "customer_addresses",
        lastUpdatedAt: null,
        warnings: [],
        total: 1,
        items: [
          {
            contractName: "CustomerAddress",
            schemaVersion: "1.0.0",
            addressId: "addr-1",
            customerId: Number(customerId) || 0,
            createdByActionId: null,
            addressLabel: "Casa",
            recipientName: "Someone",
            recipientPhone: "+56900000000",
            streetName: "Some Street",
            streetNumber: "1",
            unit: null,
            commune: "Some Commune",
            city: "Some City",
            region: "Some Region",
            postalCode: null,
            deliveryNotes: null,
            isDefault: true,
            isActive: true,
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
            confirmationState: "unknown" as const
          }
        ]
      },
      commercialEvents: emptySection("commercial_event")
    },
    lifecycle: emptySection("lifecycle_event_assembler"),
    metadata: {
      source: "local_native_mariadb",
      freshness: { source: "local_native_mariadb", lastActivityAt: null, lastRefreshedAt: "2026-07-08T12:05:00.000Z", state: "unknown" },
      completeness: { state: "complete", score: 100, missing: [] },
      warnings: []
    }
  };
}

async function seedRealCustomer() {
  const waId = `5699${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
  const result = await processNativeWhatsAppInbound({
    providerMessageId: `wamid.${uniqueSuffix("boundary")}`,
    phoneNumberId: `phone-${uniqueSuffix("pnid")}`,
    externalSenderId: waId,
    senderPhone: waId,
    senderName: "Cliente Boundary",
    messageType: "text",
    text: "Hola",
    occurredAt: new Date().toISOString(),
    rawPayload: {}
  });
  assert.ok(result.customerId, "seeding must resolve a real customerId");
  return result.customerId as number;
}

const MULTI_REQUEST_ENV = {
  BRAIN_MULTI_REQUEST_RUNTIME_ENABLED: "true",
  BRAIN_REQUEST_TRACKING_ENABLED: "true",
  BRAIN_TURN_PLAN_PERSISTENCE_ENABLED: "true"
};

function withEnv<T>(overrides: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) previous[key] = process.env[key];
  Object.assign(process.env, overrides);
  return fn().finally(() => {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

// ---------------------------------------------------------------------------
// Durable T05 boundary invariants (no Git history, no frozen T06-absence claims).
// ---------------------------------------------------------------------------

test("boundary invariant 1: the projector only reflects the snapshot it is given, never resolves identity itself", () => {
  const a = projectAutonomousCustomerContext(makeSnapshot({ customerId: "111", displayName: "Ana", email: "ana@example.com" }));
  const b = projectAutonomousCustomerContext(makeSnapshot({ customerId: "222", displayName: "Beto", email: null }));

  assert.equal(a.profile.displayName, "Ana");
  assert.equal(a.profile.emailAvailable, true);
  assert.equal(b.profile.displayName, "Beto");
  assert.equal(b.profile.emailAvailable, false);
  // Purely a function of its argument - the same snapshot always yields the same projection.
  assert.deepEqual(projectAutonomousCustomerContext(makeSnapshot({ customerId: "111", displayName: "Ana", email: "ana@example.com" })), a);
});

test("boundary invariant 2: the loader's result depends exclusively on the injected loadCustomer360 function", async () => {
  const found: Customer360LoadResult = { status: "found", snapshot: makeSnapshot({ customerId: "1" }), warnings: [] };
  const unavailable: Customer360LoadResult = { status: "unavailable", snapshot: null, warnings: [] };

  const first = await loadAutonomousCustomerContext({ customerId: "1", loadCustomer360: async () => found });
  const second = await loadAutonomousCustomerContext({ customerId: "1", loadCustomer360: async () => unavailable });

  assert.equal(first.state, "available");
  assert.equal(second.state, "unavailable");
  // Same customerId, only the injected dependency changed - proves there is no other data source in play.
  assert.notEqual(first.state, second.state);
});

test("boundary invariant 3: the T05 modules never import identity resolution, onboarding, Customer Service or the Capability Gateway", () => {
  const source = readOwnFiles();
  assert.doesNotMatch(source, /customer-identity/);
  assert.doesNotMatch(source, /customer-onboarding/);
  assert.doesNotMatch(source, /customer-service/);
  assert.doesNotMatch(source, /capability-gateway/);
});

test("boundary invariant 4: runNativeAutonomousCycle hands the loader exactly String(customerMasterId), never wa_id/phone/email", async () => {
  await withEnv(MULTI_REQUEST_ENV, async () => {
    let receivedCustomerId: string | null = null;
    await runNativeAutonomousCycle({
      conversationId: uniqueConversationId(),
      conversationPublicId: uniqueSuffix("conv-pub"),
      customerMasterId: 4242,
      waId: "56900000000",
      phoneNumberId: "phone-boundary",
      messageId: uniqueSuffix("cm"),
      messageText: "Hola",
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      loadCustomer360: async (customerId) => {
        receivedCustomerId = customerId;
        return { status: "not_found", snapshot: null, warnings: [] };
      }
    });
    assert.equal(receivedCustomerId, "4242");
    assert.notEqual(receivedCustomerId, "56900000000");
  });
});

test("boundary invariant 5: customerMasterId = null produces zero Customer 360 loads", async () => {
  await withEnv(MULTI_REQUEST_ENV, async () => {
    let calls = 0;
    await runNativeAutonomousCycle({
      conversationId: uniqueConversationId(),
      conversationPublicId: uniqueSuffix("conv-pub"),
      customerMasterId: null,
      waId: "56900000001",
      phoneNumberId: "phone-boundary",
      messageId: uniqueSuffix("cm"),
      messageText: "Hola",
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      loadCustomer360: async () => {
        calls += 1;
        return { status: "not_found", snapshot: null, warnings: [] };
      }
    });
    assert.equal(calls, 0);
  });
});

test("boundary invariant 6: reading Customer 360 for a real customer never writes to master_customer", async () => {
  const customerId = await seedRealCustomer();
  const before = await safeQueryRows<{ total: number }>("SELECT COUNT(*) AS total FROM master_customer", []);
  const beforeRow = await safeQueryRows<Record<string, unknown>>("SELECT * FROM master_customer WHERE id = ?", [customerId]);

  const service = createCustomer360QueryService();
  await service.loadByCustomerId(String(customerId));
  await service.loadByCustomerId(String(customerId));

  const after = await safeQueryRows<{ total: number }>("SELECT COUNT(*) AS total FROM master_customer", []);
  const afterRow = await safeQueryRows<Record<string, unknown>>("SELECT * FROM master_customer WHERE id = ?", [customerId]);

  assert.equal(after.ok && before.ok ? after.rows[0]?.total : null, before.ok ? before.rows[0]?.total : null);
  assert.deepEqual(afterRow.ok ? afterRow.rows[0] : null, beforeRow.ok ? beforeRow.rows[0] : null);
});

test("boundary invariant 7: the projection never contains address confirmation data", () => {
  const context = projectAutonomousCustomerContext(makeSnapshot({ customerId: "9", displayName: "Con Direccion" }));
  const serialized = JSON.stringify(context);
  assert.doesNotMatch(serialized, /addressId/);
  assert.doesNotMatch(serialized, /confirmationState/);
  assert.doesNotMatch(serialized, /recipientPhone/);
  assert.doesNotMatch(serialized, /Some Street/);
});

test("boundary invariant 8: a loader failure degrades to unavailable and never stops the runtime", async () => {
  await withEnv(MULTI_REQUEST_ENV, async () => {
    const result = await runNativeAutonomousCycle({
      conversationId: uniqueConversationId(),
      conversationPublicId: uniqueSuffix("conv-pub"),
      customerMasterId: 4343,
      waId: "56900000002",
      phoneNumberId: "phone-boundary",
      messageId: uniqueSuffix("cm"),
      messageText: "Hola",
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      loadCustomer360: async () => {
        throw new Error("customer 360 exploded");
      }
    });
    assert.equal(result.ran, true);
    assert.equal(result.customerContextState, "unavailable");
  });
});
