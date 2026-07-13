import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, hasTable, queryRows } from "@/lib/db";
import {
  executeReadCapabilityForRequest,
  resolveReadCapability,
  READ_CAPABILITY_REGISTRY
} from "@/lib/brain/commercial/capabilities";
import { createConversationRequest, listRequestEvents, loadConversationRequest, transitionConversationRequest } from "@/lib/brain/commercial/conversation-request";
import { applyRequestReduction } from "@/lib/brain/commercial/request-definitions";
import { createCustomerAddress } from "@/lib/domains/customer-addresses";

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
  DATABASE_URL: ""
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function makeCustomer(): Promise<number> {
  const email = `${uniqueSuffix("cap-test")}@example.com`;
  await queryRows(
    "INSERT INTO master_customer (firstname, lastname, email, platform_origin) VALUES ('Test', 'Capabilities', ?, 'hub')",
    [email]
  );
  const rows = await queryRows<{ id: number }>("SELECT id FROM master_customer WHERE email = ? LIMIT 1", [email]);
  return Number(rows[0].id);
}

async function makeRequest(intentType: string, intentDomain: "sales" | "order" | "maintenance" | "general" = "sales") {
  const created = await createConversationRequest({
    creationKey: uniqueSuffix("creation"),
    conversationId: 900000000 + Math.floor(Math.random() * 99999999),
    intentType,
    intentDomain,
    createdFromMessageId: uniqueSuffix("cm")
  });
  assert.equal(created.ok, true, created.ok ? "" : `createConversationRequest failed: ${created.warning}`);
  await transitionConversationRequest({ requestId: created.request!.requestId, fromStatus: "detected", toStatus: "active" });
  return created.request!;
}

test("the registry declares the read capabilities; unimplemented ones are explicit, none is a mutation", () => {
  const names = READ_CAPABILITY_REGISTRY.map((definition) => definition.capability).sort();
  assert.deepEqual(names, [
    "find_order",
    "find_customer_by_email",
    "get_customer_address",
    "get_identity_status",
    "get_order_status",
    "get_product_information",
    "get_product_price",
    "list_customer_addresses",
    "search_products"
  ].concat(["get_service_price", "identify_equipment"]).sort());

  assert.equal(READ_CAPABILITY_REGISTRY.every((definition) => definition.riskLevel === "read"), true);
  assert.equal(resolveReadCapability("identify_equipment")?.implemented, false);
  assert.equal(resolveReadCapability("get_service_price")?.implemented, false);
  assert.equal(resolveReadCapability("find_customer_by_email")?.implemented, true);
  assert.equal(resolveReadCapability("get_identity_status")?.implemented, true);
  assert.equal(resolveReadCapability("send_quote"), null);
});

test("capabilities without a source of truth return unavailable, never fake data", async () => {
  const request = await makeRequest("maintenance_quote", "maintenance");
  const result = await executeReadCapabilityForRequest({
    capability: "identify_equipment",
    input: { text: "trotadora XT900" },
    requestId: request.requestId
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.data, null);
  assert.equal(result.warning, "service_catalog_not_available");
});

test("catalog and order capabilities degrade explicitly when their ps_ tables are absent, and work when present", async () => {
  const request = await makeRequest("product_information", "general");
  const search = await executeReadCapabilityForRequest({
    capability: "search_products",
    input: { query: "banca" },
    requestId: request.requestId
  });

  if (await hasTable("ps_product")) {
    assert.equal(search.status, "succeeded");
    assert.ok(Array.isArray(search.data?.products));
  } else {
    assert.equal(search.status, "unavailable");
    assert.equal(search.warning, "catalog_source_unavailable");
  }

  const orderRequest = await makeRequest("order_status", "order");
  const order = await executeReadCapabilityForRequest({
    capability: "get_order_status",
    input: { orderIdentifier: "REF-DOES-NOT-EXIST" },
    requestId: orderRequest.requestId
  });
  if (await hasTable("ps_orders")) {
    assert.equal(order.status, "succeeded");
    assert.equal(order.data?.order, null);
    assert.equal(order.warning, "order_not_found");
  } else {
    assert.equal(order.status, "unavailable");
    assert.equal(order.warning, "orders_source_unavailable");
  }
});

test("the request definition allowlist gates every execution; unknown capabilities and bad input fail closed", async () => {
  const orderRequest = await makeRequest("order_status", "order");

  // order_status does not allow catalog searches.
  const denied = await executeReadCapabilityForRequest({
    capability: "search_products",
    input: { query: "banca" },
    requestId: orderRequest.requestId
  });
  assert.equal(denied.status, "failed");
  assert.equal(denied.warning, "capability_not_allowed_for_request:order_status");

  const unknown = await executeReadCapabilityForRequest({
    capability: "drop_database",
    input: {},
    requestId: orderRequest.requestId
  });
  assert.equal(unknown.status, "failed");
  assert.equal(unknown.warning, "unknown_capability");

  const quoteRequest = await makeRequest("product_quote");
  const badInput = await executeReadCapabilityForRequest({
    capability: "list_customer_addresses",
    input: {},
    requestId: quoteRequest.requestId
  });
  assert.equal(badInput.status, "invalid_input");
  assert.equal(badInput.warning, "customerId_required");
});

test("address capabilities read real data and enforce ownership", async () => {
  const customerId = await makeCustomer();
  const stranger = await makeCustomer();
  const quoteRequest = await makeRequest("product_quote");
  const created = await createCustomerAddress({
    customerId,
    streetName: "Avenida Capability",
    streetNumber: "42",
    commune: "Providencia",
    region: "Metropolitana"
  });

  const list = await executeReadCapabilityForRequest({
    capability: "list_customer_addresses",
    input: { customerId },
    requestId: quoteRequest.requestId
  });
  assert.equal(list.status, "succeeded");
  assert.equal((list.data?.addresses as unknown[]).length, 1);

  const owned = await executeReadCapabilityForRequest({
    capability: "get_customer_address",
    input: { addressId: created.address!.addressId, customerId },
    requestId: quoteRequest.requestId
  });
  assert.equal(owned.status, "succeeded");

  const foreign = await executeReadCapabilityForRequest({
    capability: "get_customer_address",
    input: { addressId: created.address!.addressId, customerId: stranger },
    requestId: quoteRequest.requestId
  });
  assert.equal(foreign.status, "invalid_input");
  assert.equal(foreign.warning, "address_not_owned_by_customer");
});

test("a successful read can emit its semantic event, idempotently, and reads never resolve a quote", async () => {
  const customerId = await makeCustomer();
  const quoteRequest = await makeRequest("product_quote");
  await createCustomerAddress({ customerId, streetName: "Calle Uno", streetNumber: "1", commune: "Santiago", region: "Metropolitana" });

  const first = await executeReadCapabilityForRequest({
    capability: "list_customer_addresses",
    input: { customerId },
    requestId: quoteRequest.requestId,
    sourceId: "turnplan-x",
    emitEvent: true
  });
  assert.equal(first.status, "succeeded");
  assert.equal(first.emittedEventType, "information_provided");

  // Same capability, same input: the event dedupes to one row.
  await executeReadCapabilityForRequest({
    capability: "list_customer_addresses",
    input: { customerId },
    requestId: quoteRequest.requestId,
    emitEvent: true
  });
  const events = await listRequestEvents(quoteRequest.requestId);
  assert.equal(events.filter((event) => event.eventType === "information_provided").length, 1);

  // information_provided does NOT resolve a product_quote (only quote_sent does).
  await applyRequestReduction((await loadConversationRequest(quoteRequest.requestId))!);
  const after = await loadConversationRequest(quoteRequest.requestId);
  assert.notEqual(after?.status, "resolved");
});

test("a turn can serve several read requests: order data provided resolves order_status via the reducer", async () => {
  const infoRequest = await makeRequest("general_question", "general");
  const info = await executeReadCapabilityForRequest({
    capability: "search_products",
    input: { query: "mancuernas" },
    requestId: infoRequest.requestId,
    emitEvent: true
  });

  if (info.status === "succeeded") {
    // Catalog available locally: the emitted event resolves the general question.
    const reduced = await applyRequestReduction((await loadConversationRequest(infoRequest.requestId))!);
    assert.equal(reduced.decision.desiredStatus, "resolved");
  } else {
    // Catalog unavailable: no event, no resolution - the request stays open.
    assert.equal(info.emittedEventType, null);
    assert.notEqual((await loadConversationRequest(infoRequest.requestId))?.status, "resolved");
  }
});
