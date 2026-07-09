import assert from "node:assert/strict";
import test from "node:test";
import { loadAutonomousCustomerContext } from "../../lib/brain/commercial/context/loadAutonomousCustomerContext";
import type { Customer360LoadResult, Customer360Section, Customer360Snapshot } from "../../lib/domains/customer-360";

function emptySection<T>(source: string, state: "real" | "partial" | "unavailable" | "error" = "real"): Customer360Section<T> {
  return { state, source, lastUpdatedAt: null, warnings: [], total: 0, items: [] as T[] };
}

function makeSnapshot(overrides: { completeness?: "complete" | "partial" | "minimal" | "insufficient"; freshness?: "fresh" | "stale" | "unknown" } = {}): Customer360Snapshot {
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
      linkedIdentities: []
    },
    profile: {
      source: "local_native_mariadb",
      state: "real",
      warnings: [],
      customerId: "123",
      displayName: "Camila Rojas",
      linkedIdentitiesCount: 0,
      counts: { conversations: 0, messages: 0, opportunities: 0, profiles: 0, actions: 0, outcomes: 0, quotes: 0, orders: 0, addresses: 0, commercialEvents: 0 },
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
      addresses: emptySection("customer_addresses"),
      commercialEvents: emptySection("commercial_event")
    },
    lifecycle: emptySection("lifecycle_event_assembler"),
    metadata: {
      source: "local_native_mariadb",
      freshness: { source: "local_native_mariadb", lastActivityAt: null, lastRefreshedAt: "2026-07-08T12:05:00.000Z", state: overrides.freshness ?? "fresh" },
      completeness: { state: overrides.completeness ?? "complete", score: overrides.completeness === "complete" ? 100 : 40, missing: overrides.completeness === "complete" ? [] : ["opportunities"] },
      warnings: []
    }
  };
}

function countingLoader(result: Customer360LoadResult | (() => Customer360LoadResult)) {
  const calls: string[] = [];
  return {
    calls,
    async loadCustomer360(customerId: string): Promise<Customer360LoadResult> {
      calls.push(customerId);
      return typeof result === "function" ? result() : result;
    }
  };
}

// ---------------------------------------------------------------------------
// Loader (tests 21-28)
// ---------------------------------------------------------------------------

test("loader: customerId null makes zero calls and returns not_requested", async () => {
  const { calls, loadCustomer360 } = countingLoader({ status: "found", snapshot: makeSnapshot(), warnings: [] });
  const result = await loadAutonomousCustomerContext({ customerId: null, loadCustomer360 });
  assert.equal(result.state, "not_requested");
  assert.equal(result.context, null);
  assert.deepEqual(result.warnings, []);
  assert.equal(calls.length, 0);
});

test("loader: a complete snapshot yields available with no warnings", async () => {
  const { loadCustomer360 } = countingLoader({ status: "found", snapshot: makeSnapshot({ completeness: "complete", freshness: "fresh" }), warnings: [] });
  const result = await loadAutonomousCustomerContext({ customerId: "123", loadCustomer360 });
  assert.equal(result.state, "available");
  assert.ok(result.context);
  assert.deepEqual(result.warnings, []);
});

test("loader: a degraded snapshot yields partial with customer_360_partial", async () => {
  const { loadCustomer360 } = countingLoader({ status: "found", snapshot: makeSnapshot({ completeness: "partial", freshness: "fresh" }), warnings: [] });
  const result = await loadAutonomousCustomerContext({ customerId: "123", loadCustomer360 });
  assert.equal(result.state, "partial");
  assert.ok(result.warnings.includes("customer_360_partial"));
});

test("loader: a stale snapshot adds customer_360_stale without blocking", async () => {
  const { loadCustomer360 } = countingLoader({ status: "found", snapshot: makeSnapshot({ completeness: "complete", freshness: "stale" }), warnings: [] });
  const result = await loadAutonomousCustomerContext({ customerId: "123", loadCustomer360 });
  assert.equal(result.state, "available");
  assert.ok(result.context);
  assert.deepEqual(result.warnings, ["customer_360_stale"]);
});

test("loader: a genuinely nonexistent customer yields not_found", async () => {
  const { loadCustomer360 } = countingLoader({ status: "not_found", snapshot: null, warnings: [] });
  const result = await loadAutonomousCustomerContext({ customerId: "999", loadCustomer360 });
  assert.equal(result.state, "not_found");
  assert.equal(result.context, null);
  assert.deepEqual(result.warnings, ["customer_360_not_found"]);
});

test("loader: an unavailable source yields unavailable", async () => {
  const { loadCustomer360 } = countingLoader({ status: "unavailable", snapshot: null, warnings: [] });
  const result = await loadAutonomousCustomerContext({ customerId: "123", loadCustomer360 });
  assert.equal(result.state, "unavailable");
  assert.equal(result.context, null);
  assert.deepEqual(result.warnings, ["customer_360_unavailable"]);
});

test("loader: a thrown exception yields unavailable, never a crash", async () => {
  const result = await loadAutonomousCustomerContext({
    customerId: "123",
    loadCustomer360: async () => {
      throw new Error("ECONNREFUSED 127.0.0.1:3306 credentials=secret");
    }
  });
  assert.equal(result.state, "unavailable");
  assert.equal(result.context, null);
  assert.deepEqual(result.warnings, ["customer_360_unavailable"]);
});

test("loader: the raw exception message never reaches the result", async () => {
  const result = await loadAutonomousCustomerContext({
    customerId: "123",
    loadCustomer360: async () => {
      throw new Error("super-secret-connection-string");
    }
  });
  assert.doesNotMatch(JSON.stringify(result), /super-secret-connection-string/);
});
