import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, queryRows, safeQueryRows } from "@/lib/db";
import {
  confirmAddressForRequest,
  createAddressSnapshot,
  createCustomerAddress,
  deactivateCustomerAddress,
  getCustomerAddress,
  listCustomerAddresses,
  selectAddressForRequest,
  setDefaultCustomerAddress,
  updateCustomerAddress,
  validateAddressReadyForPhysicalAction,
  CUSTOMER_ADDRESS_TABLE,
  DELIVERY_ADDRESS_FACT_KEY
} from "@/lib/domains/customer-addresses";
import { createConversationRequest } from "@/lib/brain/commercial/conversation-request";
import { getActiveRequestFact } from "@/lib/brain/commercial/request-facts";

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
  const email = `${uniqueSuffix("addr-test")}@example.com`;
  await queryRows(
    "INSERT INTO master_customer (firstname, lastname, email, platform_origin) VALUES ('Test', 'Addresses', ?, 'hub')",
    [email]
  );
  const rows = await queryRows<{ id: number }>("SELECT id FROM master_customer WHERE email = ? LIMIT 1", [email]);
  return Number(rows[0].id);
}

async function makeRequest() {
  const created = await createConversationRequest({
    creationKey: uniqueSuffix("creation"),
    conversationId: 900000000 + Math.floor(Math.random() * 99999999),
    intentType: "product_quote",
    intentDomain: "sales",
    createdFromMessageId: uniqueSuffix("cm")
  });
  assert.equal(created.ok, true);
  return created.request!;
}

function makeAddressInput(customerId: number, overrides: Record<string, unknown> = {}) {
  return {
    customerId,
    streetName: "Avenida Example",
    streetNumber: "123",
    commune: "Providencia",
    region: "Metropolitana",
    addressLabel: "Casa",
    ...overrides
  };
}

test("createCustomerAddress is idempotent per agent action: a retry never creates a second address", async () => {
  const customerId = await makeCustomer();
  const actionId = uniqueSuffix("action");

  const first = await createCustomerAddress(makeAddressInput(customerId, { createdByActionId: actionId }));
  assert.equal(first.ok, true);
  assert.equal(first.status, "created");

  const retry = await createCustomerAddress(makeAddressInput(customerId, { createdByActionId: actionId }));
  assert.equal(retry.ok, true);
  assert.equal(retry.status, "duplicate");
  assert.equal(retry.address?.addressId, first.address?.addressId);

  const count = await safeQueryRows<{ total: number }>(
    `SELECT COUNT(*) AS total FROM ${CUSTOMER_ADDRESS_TABLE} WHERE created_by_action_id = ?`,
    [actionId]
  );
  assert.equal(Number(count.ok ? count.rows[0]?.total : -1), 1);
});

test("a customer holds several addresses and setDefault keeps exactly one default", async () => {
  const customerId = await makeCustomer();
  const casa = await createCustomerAddress(makeAddressInput(customerId, { addressLabel: "Casa" }));
  const bodega = await createCustomerAddress(makeAddressInput(customerId, { addressLabel: "Bodega", streetName: "Camino Industrial", streetNumber: "555", commune: "Quilicura" }));

  const setCasa = await setDefaultCustomerAddress(customerId, casa.address!.addressId);
  assert.equal(setCasa.ok, true);
  assert.equal(setCasa.address?.isDefault, true);

  const setBodega = await setDefaultCustomerAddress(customerId, bodega.address!.addressId);
  assert.equal(setBodega.ok, true);

  const all = await listCustomerAddresses(customerId);
  assert.equal(all.length, 2);
  assert.equal(all.filter((address) => address.isDefault).length, 1);
  assert.equal(all.find((address) => address.isDefault)?.addressId, bodega.address?.addressId);
});

test("an address of another customer or an inactive one is rejected for selection", async () => {
  const owner = await makeCustomer();
  const intruder = await makeCustomer();
  const request = await makeRequest();

  const address = await createCustomerAddress(makeAddressInput(owner));

  const foreign = await selectAddressForRequest({ requestId: request.requestId, customerId: intruder, addressId: address.address!.addressId });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.status, "not_owner");

  await deactivateCustomerAddress(owner, address.address!.addressId);
  const inactive = await selectAddressForRequest({ requestId: request.requestId, customerId: owner, addressId: address.address!.addressId });
  assert.equal(inactive.ok, false);
  assert.equal(inactive.status, "inactive");
});

test("select -> confirm flow gates physical actions; selection alone is never enough", async () => {
  const customerId = await makeCustomer();
  const request = await makeRequest();
  const address = await createCustomerAddress(makeAddressInput(customerId));
  const addressId = address.address!.addressId;

  const before = await validateAddressReadyForPhysicalAction({ requestId: request.requestId, customerId });
  assert.equal(before.ready, false);
  assert.deepEqual(before.reasons, ["no_address_selected"]);

  const selected = await selectAddressForRequest({ requestId: request.requestId, customerId, addressId });
  assert.equal(selected.ok, true);
  assert.equal((await getActiveRequestFact(request.requestId, DELIVERY_ADDRESS_FACT_KEY))?.status, "inferred");

  const notConfirmed = await validateAddressReadyForPhysicalAction({ requestId: request.requestId, customerId });
  assert.equal(notConfirmed.ready, false);
  assert.deepEqual(notConfirmed.reasons, ["address_not_confirmed"]);

  const confirmed = await confirmAddressForRequest({ requestId: request.requestId, customerId, addressId });
  assert.equal(confirmed.ok, true);
  assert.equal((await getActiveRequestFact(request.requestId, DELIVERY_ADDRESS_FACT_KEY))?.status, "confirmed");

  const ready = await validateAddressReadyForPhysicalAction({ requestId: request.requestId, customerId });
  assert.equal(ready.ready, true);
  assert.equal(ready.address?.addressId, addressId);
});

test("confirming without selection, or confirming a different address, fails explicitly", async () => {
  const customerId = await makeCustomer();
  const request = await makeRequest();
  const casa = await createCustomerAddress(makeAddressInput(customerId));
  const bodega = await createCustomerAddress(makeAddressInput(customerId, { streetName: "Otra Calle", streetNumber: "99", commune: "Quilicura" }));

  const noSelection = await confirmAddressForRequest({ requestId: request.requestId, customerId, addressId: casa.address!.addressId });
  assert.equal(noSelection.ok, false);
  assert.equal(noSelection.status, "no_selection");

  await selectAddressForRequest({ requestId: request.requestId, customerId, addressId: casa.address!.addressId });
  const mismatch = await confirmAddressForRequest({ requestId: request.requestId, customerId, addressId: bodega.address!.addressId });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.status, "selection_mismatch");
});

test("two requests of the same customer confirm different addresses without contamination", async () => {
  const customerId = await makeCustomer();
  const quoteA = await makeRequest();
  const quoteB = await makeRequest();
  const casa = await createCustomerAddress(makeAddressInput(customerId));
  const bodega = await createCustomerAddress(makeAddressInput(customerId, { streetName: "Camino Industrial", streetNumber: "555", commune: "Quilicura", addressLabel: "Bodega" }));

  await selectAddressForRequest({ requestId: quoteA.requestId, customerId, addressId: casa.address!.addressId });
  await confirmAddressForRequest({ requestId: quoteA.requestId, customerId, addressId: casa.address!.addressId });

  // Quote B never inherits A's confirmation.
  const untouched = await validateAddressReadyForPhysicalAction({ requestId: quoteB.requestId, customerId });
  assert.equal(untouched.ready, false);

  await selectAddressForRequest({ requestId: quoteB.requestId, customerId, addressId: bodega.address!.addressId });
  await confirmAddressForRequest({ requestId: quoteB.requestId, customerId, addressId: bodega.address!.addressId });

  assert.equal((await getActiveRequestFact(quoteA.requestId, DELIVERY_ADDRESS_FACT_KEY))?.value, casa.address!.addressId);
  assert.equal((await getActiveRequestFact(quoteB.requestId, DELIVERY_ADDRESS_FACT_KEY))?.value, bodega.address!.addressId);
});

test("snapshots stay immutable when the master address changes afterwards", async () => {
  const customerId = await makeCustomer();
  const created = await createCustomerAddress(makeAddressInput(customerId));
  const snapshot = createAddressSnapshot(created.address!);

  const updated = await updateCustomerAddress(customerId, created.address!.addressId, { streetName: "Calle Cambiada", streetNumber: "777" });
  assert.equal(updated.ok, true);
  assert.equal(updated.address?.streetName, "Calle Cambiada");

  assert.equal(snapshot.streetName, "Avenida Example");
  assert.equal(snapshot.streetNumber, "123");
  assert.equal((await getCustomerAddress(created.address!.addressId))?.streetName, "Calle Cambiada");
});
