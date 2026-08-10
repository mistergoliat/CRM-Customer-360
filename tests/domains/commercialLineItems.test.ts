import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool } from "@/lib/db";
import { getActiveCommercialLineItemsForOpportunity, setCommercialLineItemsForOpportunity } from "@/lib/domains/commercial-line-items";
import { getActiveRequestFact } from "@/lib/brain/commercial/request-facts";
import { buildCommercialLineItemsRequestAnchor, COMMERCIAL_LINE_ITEMS_FACT_KEY } from "@/lib/domains/commercial-line-items/constants";

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

function uniqueOpportunityId() {
  return 810000000 + Math.floor(Math.random() * 9999999);
}

test("product selected: a single item persists a confirmed, authoritative selection", async () => {
  const opportunityId = uniqueOpportunityId();
  const result = await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "7", combinationId: null, quantity: 2 }] });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.status, "selected");
  assert.equal(result.changed, true);
  assert.deepEqual(result.selection.items, [{ productId: "7", combinationId: null, quantity: 2 }]);

  const fact = await getActiveRequestFact(buildCommercialLineItemsRequestAnchor(opportunityId), COMMERCIAL_LINE_ITEMS_FACT_KEY);
  assert.equal(fact?.status, "confirmed");
  assert.deepEqual(fact?.value, { items: [{ productId: "7", combinationId: null, quantity: 2 }] });
});

test("combination selected: combinationId is preserved distinctly from the base product", async () => {
  const opportunityId = uniqueOpportunityId();
  const result = await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "13", combinationId: "5", quantity: 1 }] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.selection.items[0].combinationId, "5");
});

test("quantity > 0 required: zero is rejected", async () => {
  const opportunityId = uniqueOpportunityId();
  const result = await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "7", combinationId: null, quantity: 0 }] });
  assert.deepEqual(result, { ok: false, status: "invalid_input", reason: "invalid_quantity" });
});

test("quantity > 0 required: negative and non-integer are rejected", async () => {
  const opportunityId = uniqueOpportunityId();
  const negative = await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "7", combinationId: null, quantity: -1 }] });
  assert.equal(negative.ok, false);
  const fractional = await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "7", combinationId: null, quantity: 1.5 }] });
  assert.equal(fractional.ok, false);
});

test("blank productId is rejected", async () => {
  const opportunityId = uniqueOpportunityId();
  const result = await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "", combinationId: null, quantity: 1 }] });
  assert.deepEqual(result, { ok: false, status: "invalid_input", reason: "invalid_product_id" });
});

test("empty items array is rejected", async () => {
  const opportunityId = uniqueOpportunityId();
  const result = await setCommercialLineItemsForOpportunity({ opportunityId, items: [] });
  assert.deepEqual(result, { ok: false, status: "invalid_input", reason: "items_required" });
});

test("repeated identical selection is idempotent (changed: false, no new fact version)", async () => {
  const opportunityId = uniqueOpportunityId();
  const first = await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "7", combinationId: null, quantity: 2 }] });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const second = await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "7", combinationId: null, quantity: 2 }] });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.changed, false);
  assert.equal(second.selection.factId, first.selection.factId);
});

test("repeated selection with items in a different order is still idempotent", async () => {
  const opportunityId = uniqueOpportunityId();
  const first = await setCommercialLineItemsForOpportunity({
    opportunityId,
    items: [
      { productId: "7", combinationId: null, quantity: 2 },
      { productId: "9", combinationId: null, quantity: 1 }
    ]
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const second = await setCommercialLineItemsForOpportunity({
    opportunityId,
    items: [
      { productId: "9", combinationId: null, quantity: 1 },
      { productId: "7", combinationId: null, quantity: 2 }
    ]
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.changed, false);
});

test("change quantity: a new call with a different quantity supersedes the previous fact (new factId)", async () => {
  const opportunityId = uniqueOpportunityId();
  const first = await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "7", combinationId: null, quantity: 1 }] });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const second = await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "7", combinationId: null, quantity: 3 }] });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.changed, true);
  assert.notEqual(second.selection.factId, first.selection.factId);
  assert.equal(second.selection.items[0].quantity, 3);
});

test("change combination: switching combinationId for the same productId replaces the selection", async () => {
  const opportunityId = uniqueOpportunityId();
  await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "13", combinationId: "5", quantity: 1 }] });
  const second = await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "13", combinationId: "9", quantity: 1 }] });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.selection.items.length, 1);
  assert.equal(second.selection.items[0].combinationId, "9");
});

test("selection replaces entirely: a second call with a different item list drops the first item, not merges it", async () => {
  const opportunityId = uniqueOpportunityId();
  await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "7", combinationId: null, quantity: 1 }] });
  const second = await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "9", combinationId: null, quantity: 1 }] });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.deepEqual(
    second.selection.items.map((item) => item.productId),
    ["9"]
  );
});

test("duplicate (productId, combinationId) pairs within one call are merged by summing quantity", async () => {
  const opportunityId = uniqueOpportunityId();
  const result = await setCommercialLineItemsForOpportunity({
    opportunityId,
    items: [
      { productId: "7", combinationId: null, quantity: 2 },
      { productId: "7", combinationId: null, quantity: 3 }
    ]
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.selection.items, [{ productId: "7", combinationId: null, quantity: 5 }]);
});

test("rehydration: getActiveCommercialLineItemsForOpportunity reads back the same durable selection on an independent call", async () => {
  const opportunityId = uniqueOpportunityId();
  const written = await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "7", combinationId: null, quantity: 2 }] });
  assert.equal(written.ok, true);

  const rehydrated = await getActiveCommercialLineItemsForOpportunity(opportunityId);
  assert.ok(rehydrated);
  assert.deepEqual(rehydrated?.items, [{ productId: "7", combinationId: null, quantity: 2 }]);
});

test("rehydration: null for an opportunity with no confirmed selection yet", async () => {
  const opportunityId = uniqueOpportunityId();
  const rehydrated = await getActiveCommercialLineItemsForOpportunity(opportunityId);
  assert.equal(rehydrated, null);
});

test("no inference from RecentCatalogContext alone: this domain has no dependency on it and cannot silently derive a selection from viewed products", async () => {
  const opportunityId = uniqueOpportunityId();
  // Nothing was ever selected for this opportunity - only viewed products
  // would exist elsewhere (RecentCatalogContext), which this domain never reads.
  const rehydrated = await getActiveCommercialLineItemsForOpportunity(opportunityId);
  assert.equal(rehydrated, null);
});
