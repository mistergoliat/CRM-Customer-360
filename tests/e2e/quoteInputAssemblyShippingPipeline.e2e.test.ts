import assert from "node:assert/strict";
import test from "node:test";
import { assembleQuoteInput, checkShippingSelectionReadiness } from "@/lib/brain/commercial/quote-assembly";
import type { AssembleQuoteInputDependencies, OpportunityCoreForQuoteAssembly } from "@/lib/brain/commercial/quote-assembly";
import type { CommercialLineItemSelection } from "@/lib/domains/commercial-line-items";
import type { ShippingDestination } from "@/lib/domains/shipping-destination";
import type { SelectedShippingOption } from "@/lib/domains/selected-shipping-option";
import type { CatalogBatchItemInput, CatalogBatchItemResult, CatalogPort, CatalogProduct } from "@/lib/catalog";
import type { MasterCustomerRow } from "@/lib/integrations/customer-master/types";
import type { QuoteServiceActorRef, QuoteServiceSourceRef } from "@/lib/domains/quote-service";

/**
 * SALES-AGENT-R1-T2.1, task section 21: one DB-free fixture test walking the
 * full real pipeline -
 *   select_products -> commercial_line_items ->
 *   set_shipping_destination -> calculate_shipping -> select_shipping_option ->
 *   selected_shipping_option -> Quote Input Assembler
 * - as one internally-consistent fixture (same opportunity, same
 * selectionFactId/destinationFactId anchors throughout), not the many
 * independent minimal fixtures in assembleQuoteInput.test.ts.
 *
 * requireShipping fails closed BEFORE any product line is assembled (see
 * assembleQuoteInput.ts) - Quote Service has no shipping line-item
 * representation at all, so a request can never legitimately mix a real
 * product line with a shipping line today. The two calls below use the exact
 * same fixture to demonstrate both real, independent outcomes of that one
 * pipeline: the product-only Quote succeeds end-to-end, and the
 * shipping-formal-quote attempt fails closed on the documented Carrier MS tax
 * gap - never a fabricated mixed result.
 */

const OPPORTUNITY_ID = 1;
const SELECTION_FACT_ID = "commercial-line-items-fact-1";
const DESTINATION_FACT_ID = "shipping-destination-fact-1";

const ACTOR: QuoteServiceActorRef = { type: "sales_agent", id: "agent-1" };
const SOURCE: QuoteServiceSourceRef = { system: "crm_customer_360", correlationId: "corr-e2e-1" };

const OPPORTUNITY: OpportunityCoreForQuoteAssembly = { id: OPPORTUNITY_ID, customerMasterId: "77", waId: "56912345678" };
const CUSTOMER: MasterCustomerRow = { id: 77, firstname: "Jane", lastname: "Doe", email: "jane@example.com", platform_origin: "whatsapp" };

// select_products -> commercial_line_items: product 545, no variant, qty 2.
const COMMERCIAL_SELECTION: CommercialLineItemSelection = {
  items: [{ productId: "545", combinationId: null, quantity: 2 }],
  factId: SELECTION_FACT_ID,
  updatedAt: "2026-08-14T00:00:00.000Z"
};

// Catalog Service rehydration for productId 545 - amount 99990, tax-included, CLP.
const PRODUCT: CatalogProduct = {
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
  ...{}
};

// set_shipping_destination -> shipping_destination: Ñuñoa.
const DESTINATION: ShippingDestination = {
  communeId: 99,
  canonicalName: "Ñuñoa",
  matchedVia: "direct",
  factId: DESTINATION_FACT_ID,
  updatedAt: "2026-08-14T00:00:00.000Z"
};

// calculate_shipping (Carrier MS, option index 0) -> select_shipping_option ->
// selected_shipping_option: evidenced against the exact selection/destination
// facts above, so checkShippingSelectionFreshness reports fresh.
const SELECTED_SHIPPING_OPTION: SelectedShippingOption = {
  carrierName: "Chilexpress",
  serviceType: "standard",
  totalCost: 5990,
  estimatedDelivery: "3-5 dias habiles",
  optionIndex: 0,
  shippingQuoteExecutionId: "exec-e2e-1",
  shippingQuoteCorrelationId: "corr-e2e-shipping-1",
  selectionFactId: SELECTION_FACT_ID,
  destinationFactId: DESTINATION_FACT_ID,
  calculatedAt: "2026-08-14T00:00:00.000Z",
  selectedAt: "2026-08-14T00:00:05.000Z",
  factId: "selected-shipping-option-fact-1",
  updatedAt: "2026-08-14T00:00:05.000Z"
};

function fakeCatalogPort(): CatalogPort {
  return {
    async searchProducts() { throw new Error("not used"); },
    async getProductDetails() { throw new Error("not used"); },
    async batchGetProducts(input: { items: CatalogBatchItemInput[] }) {
      const items: CatalogBatchItemResult[] = input.items.map((item) => ({ ok: true, input: item, product: PRODUCT }));
      return { ok: true, value: { items, provenance: PRODUCT.provenance } };
    },
    async exploreCatalog() { throw new Error("not used"); },
    async resolveProductIntent() { throw new Error("not used"); }
  };
}

function pipelineDeps(): AssembleQuoteInputDependencies {
  return {
    getOpportunityCore: async () => OPPORTUNITY,
    getCommercialLineItems: async () => COMMERCIAL_SELECTION,
    getShippingDestination: async () => DESTINATION,
    getSelectedShippingOption: async () => SELECTED_SHIPPING_OPTION,
    getCatalogPort: () => fakeCatalogPort(),
    getMasterCustomer: async () => CUSTOMER,
    now: () => new Date("2026-08-14T00:00:00.000Z")
  };
}

test("E2E pipeline fixture: product-only Quote assembles with exact values from the same commercial_line_items/Catalog state", async () => {
  const result = await assembleQuoteInput({ opportunityId: OPPORTUNITY_ID, correlationId: "corr-e2e-1", actor: ACTOR, source: SOURCE }, pipelineDeps());

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.request.items, [
    {
      type: "product",
      externalSource: "catalog_service",
      externalItemId: "545",
      externalVariantId: null,
      sku: "BAR-OLY-20",
      description: "Barra Olimpica 20kg",
      quantity: "2",
      unitPrice: "99990",
      taxIncluded: true,
      taxRate: "0.19"
    }
  ]);
  assert.equal(result.request.currency, "CLP");
  assert.equal(result.request.customerId, "77");
  assert.equal(result.request.customerSnapshot.name, "Jane Doe");
  assert.equal(result.request.customerSnapshot.phone, "56912345678");
  assert.equal(result.evidence.selection.factId, SELECTION_FACT_ID);
});

test("E2E pipeline fixture: the SAME selected_shipping_option is fresh (selectionFactId/destinationFactId both match), but a formal quote WITH shipping still fails closed on the documented Carrier MS tax gap - never a fabricated shipping line", async () => {
  const result = await assembleQuoteInput(
    { opportunityId: OPPORTUNITY_ID, correlationId: "corr-e2e-2", actor: ACTOR, source: SOURCE, requireShipping: true },
    pipelineDeps()
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "shipping_tax_metadata_missing");
  assert.deepEqual(result.error.details, { opportunityId: OPPORTUNITY_ID, carrierName: "Chilexpress", serviceType: "standard" });
});

test("E2E pipeline fixture: checkShippingSelectionReadiness agrees - never claims readiness the real contract cannot deliver", async () => {
  const readiness = await checkShippingSelectionReadiness(OPPORTUNITY_ID, pipelineDeps());
  assert.deepEqual(readiness, { ready: false, reason: "shipping_tax_metadata_missing", carrierName: "Chilexpress", serviceType: "standard" });
});

test("E2E pipeline fixture: if the destination changes after the shipping calculation (customer moves), the SAME selection becomes stale and is never silently reused", async () => {
  const movedDestination: ShippingDestination = { ...DESTINATION, canonicalName: "Providencia", communeId: 96, factId: "shipping-destination-fact-2" };
  const deps = { ...pipelineDeps(), getShippingDestination: async () => movedDestination };

  const result = await assembleQuoteInput(
    { opportunityId: OPPORTUNITY_ID, correlationId: "corr-e2e-3", actor: ACTOR, source: SOURCE, requireShipping: true },
    deps
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "shipping_selection_stale");
  assert.deepEqual(result.error.details, { opportunityId: OPPORTUNITY_ID, reason: "destination_changed" });
});
