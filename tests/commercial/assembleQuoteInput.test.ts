import assert from "node:assert/strict";
import test from "node:test";
import { assembleQuoteInput, checkShippingSelectionReadiness } from "@/lib/brain/commercial/quote-assembly";
import type { AssembleQuoteInputDependencies, OpportunityCoreForQuoteAssembly } from "@/lib/brain/commercial/quote-assembly";
import type { CommercialLineItem, CommercialLineItemSelection } from "@/lib/domains/commercial-line-items";
import type { ShippingDestination } from "@/lib/domains/shipping-destination";
import type { SelectedShippingOption } from "@/lib/domains/selected-shipping-option";
import type { CatalogBatchItemInput, CatalogBatchItemResult, CatalogPort, CatalogProduct } from "@/lib/catalog";
import type { MasterCustomerRow } from "@/lib/integrations/customer-master/types";
import type { QuoteServiceActorRef, QuoteServiceSourceRef } from "@/lib/domains/quote-service";

// ---- fixtures ----

const ACTOR: QuoteServiceActorRef = { type: "sales_agent", id: "agent-1" };
const SOURCE: QuoteServiceSourceRef = { system: "crm_customer_360", correlationId: "corr-1" };

function selection(items: CommercialLineItem[], overrides: Partial<CommercialLineItemSelection> = {}): CommercialLineItemSelection {
  return { items, factId: "fact-1", updatedAt: "2026-08-14T00:00:00.000Z", ...overrides };
}

function opportunityCore(overrides: Partial<OpportunityCoreForQuoteAssembly> = {}): OpportunityCoreForQuoteAssembly {
  return { id: 1, customerMasterId: "77", waId: "56912345678", ...overrides };
}

function masterCustomer(overrides: Partial<MasterCustomerRow> = {}): MasterCustomerRow {
  return { id: 77, firstname: "Jane", lastname: "Doe", email: "jane@example.com", platform_origin: "whatsapp", ...overrides };
}

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    productId: "545",
    name: "Barra Olimpica 20kg",
    sku: "BAR-OLY-20",
    shortDescription: null,
    longDescription: null,
    active: true,
    selectedVariant: null,
    variants: [],
    price: { amount: 99990, currency: "CLP", taxIncluded: true, taxRate: 0.19, discountApplied: false },
    availability: "in_stock",
    stockQuantity: 5,
    weightKg: 20,
    provenance: { source: "catalog_service_http", retrievedAt: "2026-08-14T00:00:00.000Z", cached: false },
    ...overrides
  };
}

function fakeCatalogPort(resolve: (input: CatalogBatchItemInput) => CatalogBatchItemResult): CatalogPort {
  return {
    async searchProducts() { throw new Error("not used"); },
    async getProductDetails() { throw new Error("not used"); },
    async batchGetProducts(input) {
      return { ok: true, value: { items: input.items.map(resolve), provenance: { source: "catalog_service_http", retrievedAt: "2026-08-14T00:00:00.000Z", cached: false } } };
    },
    async exploreCatalog() { throw new Error("not used"); },
    async resolveProductIntent() { throw new Error("not used"); }
  };
}

function unavailableCatalogPort(): CatalogPort {
  return {
    async searchProducts() { throw new Error("not used"); },
    async getProductDetails() { throw new Error("not used"); },
    async batchGetProducts() { return { ok: false, error: { code: "unavailable", message: "down", retryable: true } }; },
    async exploreCatalog() { throw new Error("not used"); },
    async resolveProductIntent() { throw new Error("not used"); }
  };
}

/** Default happy-path dependency set - each test overrides only what it needs. */
function baseDeps(overrides: Partial<AssembleQuoteInputDependencies> = {}): AssembleQuoteInputDependencies {
  return {
    getOpportunityCore: async () => opportunityCore(),
    getCommercialLineItems: async () => selection([{ productId: "545", combinationId: "31", quantity: 2 }]),
    getShippingDestination: async () => null,
    getSelectedShippingOption: async () => null,
    getCatalogPort: () => fakeCatalogPort((input) => ({ ok: true, input, product: product({ productId: input.productId, ...(input.combinationId ? { selectedVariant: { variantId: input.combinationId, sku: null, label: null, attributes: [], priceImpact: null, stockQuantity: 5, availability: "in_stock", isDefault: false } } : {}) }) })),
    getMasterCustomer: async () => masterCustomer(),
    now: () => new Date("2026-08-14T00:00:00.000Z"),
    ...overrides
  };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return { opportunityId: 1, correlationId: "corr-1", actor: ACTOR, source: SOURCE, ...overrides };
}

// ---- section 28: happy path ----

test("happy path: productId=545/combinationId=31/quantity=2, Catalog amount=99990/taxIncluded=true/taxRate=0.19 -> exact Quote line, unitPrice stays 99990", async () => {
  const result = await assembleQuoteInput(baseInput(), baseDeps());
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.request.items, [
    {
      type: "product",
      externalSource: "catalog_service",
      externalItemId: "545",
      externalVariantId: "31",
      sku: "BAR-OLY-20",
      description: "Barra Olimpica 20kg",
      quantity: "2",
      unitPrice: "99990",
      taxIncluded: true,
      taxRate: "0.19"
    }
  ]);
  assert.notEqual(result.request.items[0].unitPrice, "118988");
  assert.notEqual(result.request.items[0].unitPrice, "118989");
  assert.equal(result.request.currency, "CLP");
  assert.equal(result.request.customerId, "77");
  assert.equal(result.request.customerSnapshot.name, "Jane Doe");
});

test("happy path: a variant label is appended to the canonical name deterministically", async () => {
  const deps = baseDeps({
    getCatalogPort: () => fakeCatalogPort((input) => ({
      ok: true,
      input,
      product: product({ selectedVariant: { variantId: "31", sku: "BAR-OLY-20-BLK", label: "Negra", attributes: [], priceImpact: 0, stockQuantity: 5, availability: "in_stock", isDefault: false } })
    }))
  });
  const result = await assembleQuoteInput(baseInput(), deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.request.items[0].description, "Barra Olimpica 20kg - Negra");
});

// ---- section 29: identity ----

test("identity: base product with no combination - externalVariantId stays null", async () => {
  const deps = baseDeps({
    getCommercialLineItems: async () => selection([{ productId: "545", combinationId: null, quantity: 1 }]),
    getCatalogPort: () => fakeCatalogPort((input) => ({ ok: true, input, product: product({ productId: input.productId }) }))
  });
  const result = await assembleQuoteInput(baseInput(), deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.request.items[0].externalItemId, "545");
  assert.equal(result.request.items[0].externalVariantId, null);
});

test("identity: several products preserve each product's own identity", async () => {
  const deps = baseDeps({
    getCommercialLineItems: async () => selection([
      { productId: "545", combinationId: "31", quantity: 2 },
      { productId: "9", combinationId: null, quantity: 4 }
    ]),
    getCatalogPort: () => fakeCatalogPort((input) => ({ ok: true, input, product: product({ productId: input.productId, name: `Producto ${input.productId}` }) }))
  });
  const result = await assembleQuoteInput(baseInput(), deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.request.items.map((item) => [item.externalItemId, item.externalVariantId, item.quantity]), [
    ["545", "31", "2"],
    ["9", null, "4"]
  ]);
});

test("section 25 - order: batch returns items in a different order than the durable selection - output follows selection order", async () => {
  const deps = baseDeps({
    getCommercialLineItems: async () => selection([
      { productId: "1", combinationId: null, quantity: 1 },
      { productId: "2", combinationId: null, quantity: 1 },
      { productId: "3", combinationId: null, quantity: 1 }
    ]),
    getCatalogPort: () => ({
      async searchProducts() { throw new Error("not used"); },
      async getProductDetails() { throw new Error("not used"); },
      // Deliberately reversed response order vs. the request.
      async batchGetProducts(input) {
        const reversed = [...input.items].reverse();
        return { ok: true, value: { items: reversed.map((item) => ({ ok: true, input: item, product: product({ productId: item.productId }) })), provenance: { source: "catalog_service_http", retrievedAt: "x", cached: false } } };
      },
      async exploreCatalog() { throw new Error("not used"); },
      async resolveProductIntent() { throw new Error("not used"); }
    })
  });
  const result = await assembleQuoteInput(baseInput(), deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.request.items.map((item) => item.externalItemId), ["1", "2", "3"]);
});

test("identity: missing product (no combination) -> catalog_product_not_found", async () => {
  const deps = baseDeps({
    getCommercialLineItems: async () => selection([{ productId: "545", combinationId: null, quantity: 2 }]),
    getCatalogPort: () => fakeCatalogPort((input) => ({ ok: false, input, error: { code: "not_found", message: "gone", retryable: false } }))
  });
  const result = await assembleQuoteInput(baseInput(), deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "catalog_product_not_found");
});

test("identity: missing combination (variant) -> catalog_variant_not_found, distinct from a missing base product", async () => {
  const deps = baseDeps({
    getCommercialLineItems: async () => selection([{ productId: "545", combinationId: "999", quantity: 1 }]),
    getCatalogPort: () => fakeCatalogPort((input) => ({ ok: false, input, error: { code: "not_found", message: "gone", retryable: false } }))
  });
  const result = await assembleQuoteInput(baseInput(), deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "catalog_variant_not_found");
});

test("identity: a corrupted durable selection with a duplicate (productId, combinationId) fails closed, never silently duplicates a line", async () => {
  const deps = baseDeps({
    getCommercialLineItems: async () => selection([
      { productId: "545", combinationId: "31", quantity: 2 },
      { productId: "545", combinationId: "31", quantity: 3 }
    ])
  });
  const result = await assembleQuoteInput(baseInput(), deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "invalid_quantity");
});

// ---- section 30: pricing / anti-double-IVA ----

test("pricing: amount=null -> catalog_price_missing", async () => {
  const deps = baseDeps({ getCatalogPort: () => fakeCatalogPort((input) => ({ ok: true, input, product: product({ price: { amount: null, currency: "CLP", taxIncluded: true, taxRate: 0.19, discountApplied: false } }) })) });
  const result = await assembleQuoteInput(baseInput(), deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "catalog_price_missing");
});

test("pricing: taxIncluded=null -> catalog_tax_metadata_missing", async () => {
  const deps = baseDeps({ getCatalogPort: () => fakeCatalogPort((input) => ({ ok: true, input, product: product({ price: { amount: 99990, currency: "CLP", taxIncluded: null, taxRate: 0.19, discountApplied: false } }) })) });
  const result = await assembleQuoteInput(baseInput(), deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "catalog_tax_metadata_missing");
});

test("pricing: taxIncluded=false -> catalog_tax_metadata_missing (a not-yet-tax-included price is never accepted for a formal quote line)", async () => {
  const deps = baseDeps({ getCatalogPort: () => fakeCatalogPort((input) => ({ ok: true, input, product: product({ price: { amount: 99990, currency: "CLP", taxIncluded: false, taxRate: 0.19, discountApplied: false } }) })) });
  const result = await assembleQuoteInput(baseInput(), deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "catalog_tax_metadata_missing");
});

test("pricing: taxRate=null -> catalog_tax_metadata_missing", async () => {
  const deps = baseDeps({ getCatalogPort: () => fakeCatalogPort((input) => ({ ok: true, input, product: product({ price: { amount: 99990, currency: "CLP", taxIncluded: true, taxRate: null, discountApplied: false } }) })) });
  const result = await assembleQuoteInput(baseInput(), deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "catalog_tax_metadata_missing");
});

test("pricing: currency mismatch (Catalog reports USD) -> currency_mismatch, never silently coerced to CLP", async () => {
  const deps = baseDeps({ getCatalogPort: () => fakeCatalogPort((input) => ({ ok: true, input, product: product({ price: { amount: 99990, currency: "USD", taxIncluded: true, taxRate: 0.19, discountApplied: false } }) })) });
  const result = await assembleQuoteInput(baseInput(), deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "currency_mismatch");
});

test("anti-double-IVA: unitPrice=99990/taxIncluded=true/taxRate=0.19 never becomes 118988/118989/118990 in the assembled request", async () => {
  const result = await assembleQuoteInput(baseInput(), baseDeps());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const line = result.request.items[0];
  assert.equal(line.unitPrice, "99990");
  assert.notEqual(line.unitPrice, "118988");
  assert.notEqual(line.unitPrice, "118989");
  assert.notEqual(line.unitPrice, "118990");
  assert.equal(line.taxRate, "0.19");
});

test("catalog batch technical failure -> catalog_unavailable, never treated as a business not-found", async () => {
  const deps = baseDeps({ getCatalogPort: () => unavailableCatalogPort() });
  const result = await assembleQuoteInput(baseInput(), deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "catalog_unavailable");
});

test("catalog not configured -> catalog_unavailable", async () => {
  const deps = baseDeps({ getCatalogPort: () => null });
  const result = await assembleQuoteInput(baseInput(), deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "catalog_unavailable");
});

// ---- section 31: quantity ----

for (const badQuantity of [0, -1, 1.5, NaN]) {
  test(`quantity: durable state with quantity=${badQuantity} is rejected as invalid_quantity`, async () => {
    const deps = baseDeps({ getCommercialLineItems: async () => selection([{ productId: "545", combinationId: "31", quantity: badQuantity }]) });
    const result = await assembleQuoteInput(baseInput(), deps);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "invalid_quantity");
  });
}

test("no confirmed commercial selection -> no_commercial_line_items", async () => {
  const deps = baseDeps({ getCommercialLineItems: async () => null });
  const result = await assembleQuoteInput(baseInput(), deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "no_commercial_line_items");
});

test("missing opportunity -> missing_opportunity", async () => {
  const deps = baseDeps({ getOpportunityCore: async () => null });
  const result = await assembleQuoteInput(baseInput(), deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "missing_opportunity");
});

// ---- section 32: customer ----

test("customer: complete snapshot maps name/email/phone(wa_id) - never a placeholder", async () => {
  const result = await assembleQuoteInput(baseInput(), baseDeps());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.request.customerSnapshot, { name: "Jane Doe", email: "jane@example.com", phone: "56912345678" });
});

test("customer: no customer_master_id resolved for the opportunity -> customer_snapshot_incomplete, never a fabricated name", async () => {
  const deps = baseDeps({ getOpportunityCore: async () => opportunityCore({ customerMasterId: null }) });
  const result = await assembleQuoteInput(baseInput(), deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "customer_snapshot_incomplete");
});

test("customer: customer_master_id does not resolve to a real row -> customer_snapshot_incomplete", async () => {
  const deps = baseDeps({ getMasterCustomer: async () => null });
  const result = await assembleQuoteInput(baseInput(), deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "customer_snapshot_incomplete");
});

test("customer: optional phone is entirely omitted (never null/placeholder) when the opportunity has no wa_id", async () => {
  const deps = baseDeps({ getOpportunityCore: async () => opportunityCore({ waId: null }) });
  const result = await assembleQuoteInput(baseInput(), deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal("phone" in result.request.customerSnapshot, false);
  assert.deepEqual(result.request.customerSnapshot, { name: "Jane Doe", email: "jane@example.com" });
});

// ---- section 19 (T2.1): shipping ----

const DESTINATION: ShippingDestination = { communeId: 99, canonicalName: "Ñuñoa", matchedVia: "direct", factId: "dest-fact-1", updatedAt: "2026-08-14T00:00:00.000Z" };

function selectedShippingOption(overrides: Partial<SelectedShippingOption> = {}): SelectedShippingOption {
  return {
    carrierName: "Blue Express",
    serviceType: "EXPRESS",
    totalCost: 5351,
    estimatedDelivery: "17-08-2026",
    optionIndex: 0,
    shippingQuoteExecutionId: "exec-public-id-1",
    shippingQuoteCorrelationId: "corr-shipping-1",
    selectionFactId: "fact-1",
    destinationFactId: "dest-fact-1",
    calculatedAt: "2026-08-14T00:00:00.000Z",
    selectedAt: "2026-08-14T00:00:00.000Z",
    factId: "selected-shipping-fact-1",
    updatedAt: "2026-08-14T00:00:00.000Z",
    ...overrides
  };
}

test("shipping: requireShipping=true with no selected option -> shipping_selection_missing", async () => {
  const deps = baseDeps({ getSelectedShippingOption: async () => null, getShippingDestination: async () => null });
  const result = await assembleQuoteInput(baseInput({ requireShipping: true }), deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "shipping_selection_missing");
});

test("shipping: requireShipping=true, selection exists but commercial_line_items changed since the calculation -> shipping_selection_stale", async () => {
  const deps = baseDeps({
    getSelectedShippingOption: async () => selectedShippingOption({ selectionFactId: "an-older-selection-fact" }),
    getCommercialLineItems: async () => selection([{ productId: "545", combinationId: "31", quantity: 2 }], { factId: "fact-1" }),
    getShippingDestination: async () => DESTINATION
  });
  const result = await assembleQuoteInput(baseInput({ requireShipping: true }), deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "shipping_selection_stale");
  assert.equal(result.error.details?.reason, "selection_changed");
});

test("shipping: requireShipping=true, selection exists but shipping_destination changed since the calculation -> shipping_selection_stale", async () => {
  const deps = baseDeps({
    getSelectedShippingOption: async () => selectedShippingOption({ destinationFactId: "an-older-destination-fact" }),
    getCommercialLineItems: async () => selection([{ productId: "545", combinationId: "31", quantity: 2 }], { factId: "fact-1" }),
    getShippingDestination: async () => DESTINATION
  });
  const result = await assembleQuoteInput(baseInput({ requireShipping: true }), deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "shipping_selection_stale");
  assert.equal(result.error.details?.reason, "destination_changed");
});

test("shipping: requireShipping=true, selection matches current selection/destination exactly -> still blocked, but by shipping_tax_metadata_missing (the real, distinct Carrier MS/Quote Service gap), never silently succeeds", async () => {
  const deps = baseDeps({
    getSelectedShippingOption: async () => selectedShippingOption(),
    getCommercialLineItems: async () => selection([{ productId: "545", combinationId: "31", quantity: 2 }], { factId: "fact-1" }),
    getShippingDestination: async () => DESTINATION
  });
  const result = await assembleQuoteInput(baseInput({ requireShipping: true }), deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "shipping_tax_metadata_missing");
  assert.equal(result.error.details?.carrierName, "Blue Express");
  assert.equal(result.error.details?.serviceType, "EXPRESS");
});

test("shipping: requireShipping omitted (default false) succeeds as a product-only draft even with a confirmed selection present - shipping is never universally mandatory in the Quote Service domain", async () => {
  const deps = baseDeps({
    getSelectedShippingOption: async () => selectedShippingOption(),
    getShippingDestination: async () => DESTINATION
  });
  const result = await assembleQuoteInput(baseInput(), deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.evidence.shipping.requested, false);
  assert.equal(result.evidence.shipping.resolved, false);
});

test("checkShippingSelectionReadiness: no selection -> reason no_selection with destinationConfirmed evidence", async () => {
  const status = await checkShippingSelectionReadiness(1, { getSelectedShippingOption: async () => null, getShippingDestination: async () => null });
  assert.equal(status.ready, false);
  assert.equal(status.reason, "no_selection");
  if (status.reason !== "no_selection") return;
  assert.equal(status.destinationConfirmed, false);
});

test("checkShippingSelectionReadiness: stale selection -> reason selection_stale with the exact stale cause", async () => {
  const status = await checkShippingSelectionReadiness(1, {
    getSelectedShippingOption: async () => selectedShippingOption({ selectionFactId: "stale" }),
    getCommercialLineItems: async () => selection([{ productId: "545", combinationId: "31", quantity: 2 }], { factId: "fact-1" }),
    getShippingDestination: async () => DESTINATION
  });
  assert.equal(status.ready, false);
  assert.equal(status.reason, "selection_stale");
  if (status.reason !== "selection_stale") return;
  assert.equal(status.staleReason, "selection_changed");
});

test("checkShippingSelectionReadiness: valid, fresh selection -> still ready:false, reason shipping_tax_metadata_missing, never claims readiness the contract cannot deliver", async () => {
  const status = await checkShippingSelectionReadiness(1, {
    getSelectedShippingOption: async () => selectedShippingOption(),
    getCommercialLineItems: async () => selection([{ productId: "545", combinationId: "31", quantity: 2 }], { factId: "fact-1" }),
    getShippingDestination: async () => DESTINATION
  });
  assert.equal(status.ready, false);
  assert.equal(status.reason, "shipping_tax_metadata_missing");
});

// ---- section 24: determinism ----

test("determinism: the same commercial_line_items + Catalog response + customer context + shipping state produce byte-identical requests across two independent calls", async () => {
  const deps = baseDeps();
  const first = await assembleQuoteInput(baseInput(), deps);
  const second = await assembleQuoteInput(baseInput(), deps);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.deepEqual(first.request, second.request);
});

// ---- section 27: no side effects ----

test("no side effects: the assembler never calls a write dependency - only the five injected readers are exercised", async () => {
  let reads = 0;
  const deps: AssembleQuoteInputDependencies = {
    getOpportunityCore: async () => { reads += 1; return opportunityCore(); },
    getCommercialLineItems: async () => { reads += 1; return selection([{ productId: "545", combinationId: "31", quantity: 2 }]); },
    getShippingDestination: async () => { reads += 1; return null; },
    getCatalogPort: () => fakeCatalogPort((input) => { reads += 1; return { ok: true, input, product: product({ productId: input.productId }) }; }),
    getMasterCustomer: async () => { reads += 1; return masterCustomer(); },
    now: () => new Date("2026-08-14T00:00:00.000Z")
  };
  const result = await assembleQuoteInput(baseInput(), deps);
  assert.equal(result.ok, true);
  assert.ok(reads >= 4, "every read dependency must have actually been exercised");
});

// ---- external references / evidence ----

test("external references: opportunityId/conversationId/customerId are external string refs, never FKs, and validUntil is derived from the injected clock (5-day policy)", async () => {
  const deps = baseDeps();
  const result = await assembleQuoteInput(baseInput({ conversationId: "conversation-42" }), deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.request.opportunityId, "1");
  assert.equal(result.request.conversationId, "conversation-42");
  assert.equal(result.request.customerId, "77");
  assert.equal(result.request.validUntil, "2026-08-19T00:00:00.000Z");
  assert.equal(result.evidence.correlationId, "corr-1");
  assert.equal(result.evidence.selection.itemCount, 1);
});
