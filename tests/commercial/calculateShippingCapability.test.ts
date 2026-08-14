import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool } from "@/lib/db";
import { resolveCapabilityGatewayDefinition } from "@/lib/brain/commercial/capability-gateway/registry";
import { AGENT_LOOP_TOOL_POOL, buildToolDescriptions } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";
import {
  CALCULATE_SHIPPING_INPUT_SCHEMA,
  calculateShippingCapability
} from "@/lib/brain/commercial/capability-gateway/calculateShippingCapability";
import { setShippingDestinationForOpportunity } from "@/lib/domains/shipping-destination";
import { createCommuneResolver } from "@/lib/domains/commune-resolution";
import { comparisonKey } from "@/lib/domains/commune-resolution/normalize";
import type { CommuneCatalogEntry } from "@/lib/domains/commune-resolution/types";
import type { CommuneCatalogPort } from "@/lib/domains/commune-resolution/ports";
import { setCommercialLineItemsForOpportunity } from "@/lib/domains/commercial-line-items";
import type { CapabilityGatewayContext } from "@/lib/brain/commercial/capability-gateway/types";
import type { CatalogBatchItemInput, CatalogBatchItemResult, CatalogPort, CatalogProduct } from "@/lib/catalog";
import type { CarrierQuoteInput, CarrierQuoteResult, CarrierService } from "@/lib/domains/carrier-service";

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
  return 830000000 + Math.floor(Math.random() * 9999999);
}

const NUNOA: CommuneCatalogEntry = { communeId: 99, canonicalName: "Ñuñoa" };
function fakeCommuneCatalog(): CommuneCatalogPort {
  return { async findByNormalizedName(normalizedName) { return { ok: true, entries: [NUNOA].filter((entry) => comparisonKey(entry.canonicalName) === normalizedName) }; } };
}

async function confirmDestination(opportunityId: number) {
  const result = await setShippingDestinationForOpportunity({ opportunityId, inputText: "Ñuñoa" }, { resolver: createCommuneResolver(fakeCommuneCatalog()) });
  assert.equal(result.ok, true);
}

async function confirmItems(opportunityId: number, items: Array<{ productId: string; combinationId?: string | null; quantity: number }>) {
  const result = await setCommercialLineItemsForOpportunity({ opportunityId, items: items.map((item) => ({ productId: item.productId, combinationId: item.combinationId ?? null, quantity: item.quantity })) });
  assert.equal(result.ok, true);
}

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    productId: "7",
    name: "Producto",
    sku: null,
    shortDescription: null,
    longDescription: null,
    active: true,
    selectedVariant: null,
    variants: [],
    price: { amount: 10000, currency: "CLP", taxIncluded: true, taxRate: 0.19, discountApplied: false },
    availability: "in_stock",
    stockQuantity: 5,
    weightKg: 10,
    provenance: { source: "catalog_service_http", retrievedAt: "2026-08-10T00:00:00.000Z", cached: false },
    ...overrides
  };
}

function fakeCatalogPort(resolve: (input: CatalogBatchItemInput) => CatalogBatchItemResult): CatalogPort {
  return {
    async searchProducts() { throw new Error("not used"); },
    async getProductDetails() { throw new Error("not used"); },
    async batchGetProducts(input) {
      return { ok: true, value: { items: input.items.map(resolve), provenance: { source: "catalog_service_http", retrievedAt: "2026-08-10T00:00:00.000Z", cached: false } } };
    },
    async exploreCatalog() { throw new Error("not used"); }
  };
}

function unavailableCatalogPort(): CatalogPort {
  return {
    async searchProducts() { throw new Error("not used"); },
    async getProductDetails() { throw new Error("not used"); },
    async batchGetProducts() { return { ok: false, error: { code: "unavailable", message: "down", retryable: true } }; },
    async exploreCatalog() { throw new Error("not used"); }
  };
}

function fakeCarrierService(handler: (input: CarrierQuoteInput) => CarrierQuoteResult): CarrierService & { calls: CarrierQuoteInput[] } {
  const calls: CarrierQuoteInput[] = [];
  return {
    calls,
    async quoteAll(input) {
      calls.push(input);
      return handler(input);
    }
  };
}

function successOptions(): CarrierQuoteResult {
  return { ok: true, options: [{ carrierName: "Blue Express", serviceType: "EXPRESS", totalCost: 5351, estimatedDelivery: "12-08-2026" }] };
}

function context(opportunityId: number | null): CapabilityGatewayContext {
  return { correlationId: "corr-1", opportunityId };
}

test("registered in the Capability Gateway and exposed to the Native Agent Tool Loop with an empty-object schema (no model-supplied arguments accepted)", () => {
  assert.ok(AGENT_LOOP_TOOL_POOL.includes("calculate_shipping"));
  const tool = buildToolDescriptions().find((t) => t.name === "calculate_shipping");
  assert.ok(tool);
  assert.deepEqual(tool!.inputSchema, CALCULATE_SHIPPING_INPUT_SCHEMA);
  assert.deepEqual(CALCULATE_SHIPPING_INPUT_SCHEMA.properties, {});
  assert.equal(CALCULATE_SHIPPING_INPUT_SCHEMA.additionalProperties, false);
});

test("M: calculate_shipping is also directly registered in the Gateway with the exact same schema (belt and suspenders)", () => {
  const def = resolveCapabilityGatewayDefinition("calculate_shipping");
  assert.ok(def);
  assert.deepEqual(def!.inputSchema, { type: "object", properties: {}, additionalProperties: false });
});

test("B/available: full pipeline - destination + two products hydrated from Catalog Service produce the exact aggregates sent to Carrier MS, and its real options are returned", async () => {
  const opportunityId = uniqueOpportunityId();
  await confirmDestination(opportunityId);
  await confirmItems(opportunityId, [
    { productId: "1", quantity: 2 },
    { productId: "2", quantity: 3 }
  ]);

  const catalogPort = fakeCatalogPort((input) =>
    input.productId === "1"
      ? { ok: true, input, product: product({ productId: "1", weightKg: 10, price: { amount: 50000, currency: "CLP", taxIncluded: true, taxRate: 0.19, discountApplied: false } }) }
      : { ok: true, input, product: product({ productId: "2", weightKg: 5, price: { amount: 20000, currency: "CLP", taxIncluded: true, taxRate: 0.19, discountApplied: false } }) }
  );
  const carrierService = fakeCarrierService(() => successOptions());

  const outcome = await calculateShippingCapability(
    () => catalogPort,
    () => carrierService
  ).execute({}, context(opportunityId));

  assert.equal(outcome.status, "completed");
  assert.equal(carrierService.calls.length, 1);
  // 10kg x 2 + 5kg x 3 = 35kg ; 50.000 x 2 + 20.000 x 3 = 160.000
  assert.equal(carrierService.calls[0].totalWeightKg, 35);
  assert.equal(carrierService.calls[0].totalBoleta, 160000);
  assert.equal(carrierService.calls[0].destination, "Ñuñoa");
  assert.deepEqual(outcome.data, {
    status: "available",
    destination: { communeId: 99, canonicalName: "Ñuñoa" },
    totalWeightKg: 35,
    totalBoleta: 160000,
    options: [{ carrierName: "Blue Express", serviceType: "EXPRESS", totalCost: 5351, estimatedDelivery: "12-08-2026" }]
  });
});

test("D: destination sent to Carrier MS is exactly shippingDestination.canonicalName from T13D, never derived any other way", async () => {
  const opportunityId = uniqueOpportunityId();
  await confirmDestination(opportunityId);
  await confirmItems(opportunityId, [{ productId: "1", quantity: 1 }]);
  const catalogPort = fakeCatalogPort((input) => ({ ok: true, input, product: product({ productId: "1" }) }));
  const carrierService = fakeCarrierService(() => successOptions());

  await calculateShippingCapability(() => catalogPort, () => carrierService).execute({}, context(opportunityId));
  assert.equal(carrierService.calls[0].destination, "Ñuñoa");
});

test("F: a product with weightKg null -> weight_unavailable, Carrier MS never called", async () => {
  const opportunityId = uniqueOpportunityId();
  await confirmDestination(opportunityId);
  await confirmItems(opportunityId, [{ productId: "1", quantity: 1 }]);
  const catalogPort = fakeCatalogPort((input) => ({ ok: true, input, product: product({ productId: "1", weightKg: null }) }));
  const carrierService = fakeCarrierService(() => successOptions());

  const outcome = await calculateShippingCapability(() => catalogPort, () => carrierService).execute({}, context(opportunityId));
  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.data, { status: "weight_unavailable" });
  assert.equal(carrierService.calls.length, 0);
});

test("price_unavailable: a product with no resolvable price never invents total_boleta, Carrier MS never called", async () => {
  const opportunityId = uniqueOpportunityId();
  await confirmDestination(opportunityId);
  await confirmItems(opportunityId, [{ productId: "1", quantity: 1 }]);
  const catalogPort = fakeCatalogPort((input) => ({ ok: true, input, product: product({ productId: "1", price: null }) }));
  const carrierService = fakeCarrierService(() => successOptions());

  const outcome = await calculateShippingCapability(() => catalogPort, () => carrierService).execute({}, context(opportunityId));
  assert.deepEqual(outcome.data, { status: "price_unavailable" });
  assert.equal(carrierService.calls.length, 0);
});

test("catalog_product_unavailable: a batch item that failed to resolve stops the whole calculation, Carrier MS never called", async () => {
  const opportunityId = uniqueOpportunityId();
  await confirmDestination(opportunityId);
  await confirmItems(opportunityId, [{ productId: "1", quantity: 1 }]);
  const catalogPort = fakeCatalogPort((input) => ({ ok: false, input, error: { code: "not_found", message: "gone", retryable: false } }));
  const carrierService = fakeCarrierService(() => successOptions());

  const outcome = await calculateShippingCapability(() => catalogPort, () => carrierService).execute({}, context(opportunityId));
  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.data, { status: "catalog_product_unavailable", productId: "1" });
  assert.equal(carrierService.calls.length, 0);
});

test("G: Catalog Service unavailable -> technical failure, Carrier MS never called", async () => {
  const opportunityId = uniqueOpportunityId();
  await confirmDestination(opportunityId);
  await confirmItems(opportunityId, [{ productId: "1", quantity: 1 }]);
  const carrierService = fakeCarrierService(() => successOptions());

  const outcome = await calculateShippingCapability(() => unavailableCatalogPort(), () => carrierService).execute({}, context(opportunityId));
  assert.equal(outcome.status, "temporarily_blocked");
  assert.equal(outcome.errorCode, "catalog_unavailable");
  assert.equal(outcome.retryable, true);
  assert.equal(carrierService.calls.length, 0);
});

test("catalog port not configured at all -> technical failure, Carrier MS never called", async () => {
  const opportunityId = uniqueOpportunityId();
  await confirmDestination(opportunityId);
  await confirmItems(opportunityId, [{ productId: "1", quantity: 1 }]);
  const carrierService = fakeCarrierService(() => successOptions());

  const outcome = await calculateShippingCapability(() => null, () => carrierService).execute({}, context(opportunityId));
  assert.equal(outcome.status, "temporarily_blocked");
  assert.equal(outcome.errorCode, "catalog_unavailable");
  assert.equal(carrierService.calls.length, 0);
});

test("H: no confirmed shipping destination -> shipping_destination_required, Carrier MS never called", async () => {
  const opportunityId = uniqueOpportunityId();
  await confirmItems(opportunityId, [{ productId: "1", quantity: 1 }]);
  const catalogPort = fakeCatalogPort((input) => ({ ok: true, input, product: product({ productId: "1" }) }));
  const carrierService = fakeCarrierService(() => successOptions());

  const outcome = await calculateShippingCapability(() => catalogPort, () => carrierService).execute({}, context(opportunityId));
  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.data, { status: "shipping_destination_required" });
  assert.equal(carrierService.calls.length, 0);
});

test("I: no confirmed commercial line items -> commercial_items_required, Carrier MS never called", async () => {
  const opportunityId = uniqueOpportunityId();
  await confirmDestination(opportunityId);
  const catalogPort = fakeCatalogPort((input) => ({ ok: true, input, product: product({ productId: "1" }) }));
  const carrierService = fakeCarrierService(() => successOptions());

  const outcome = await calculateShippingCapability(() => catalogPort, () => carrierService).execute({}, context(opportunityId));
  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.data, { status: "commercial_items_required" });
  assert.equal(carrierService.calls.length, 0);
});

test("no_active_opportunity: denied before any lookup", async () => {
  const catalogPort = fakeCatalogPort((input) => ({ ok: true, input, product: product({ productId: "1" }) }));
  const carrierService = fakeCarrierService(() => successOptions());
  const outcome = await calculateShippingCapability(() => catalogPort, () => carrierService).execute({}, context(null));
  assert.equal(outcome.status, "denied");
  assert.equal(outcome.errorCode, "no_active_opportunity");
  assert.equal(carrierService.calls.length, 0);
});

test("J: Carrier MS timeout -> structured technical failure, retryable", async () => {
  const opportunityId = uniqueOpportunityId();
  await confirmDestination(opportunityId);
  await confirmItems(opportunityId, [{ productId: "1", quantity: 1 }]);
  const catalogPort = fakeCatalogPort((input) => ({ ok: true, input, product: product({ productId: "1" }) }));
  const carrierService = fakeCarrierService(() => ({ ok: false, reason: "carrier_service_timeout", detail: "timed out" }));

  const outcome = await calculateShippingCapability(() => catalogPort, () => carrierService).execute({}, context(opportunityId));
  assert.equal(outcome.status, "temporarily_blocked");
  assert.equal(outcome.errorCode, "carrier_service_timeout");
  assert.equal(outcome.retryable, true);
});

test("K: Carrier MS malformed response -> fail closed, not retryable", async () => {
  const opportunityId = uniqueOpportunityId();
  await confirmDestination(opportunityId);
  await confirmItems(opportunityId, [{ productId: "1", quantity: 1 }]);
  const catalogPort = fakeCatalogPort((input) => ({ ok: true, input, product: product({ productId: "1" }) }));
  const carrierService = fakeCarrierService(() => ({ ok: false, reason: "carrier_invalid_response", detail: "malformed" }));

  const outcome = await calculateShippingCapability(() => catalogPort, () => carrierService).execute({}, context(opportunityId));
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.errorCode, "carrier_invalid_response");
  assert.equal(outcome.retryable, false);
});

test("L: Carrier MS returns zero options -> business no_shipping_options, never fabricated coverage", async () => {
  const opportunityId = uniqueOpportunityId();
  await confirmDestination(opportunityId);
  await confirmItems(opportunityId, [{ productId: "1", quantity: 1 }]);
  const catalogPort = fakeCatalogPort((input) => ({ ok: true, input, product: product({ productId: "1", weightKg: 10 }) }));
  const carrierService = fakeCarrierService(() => ({ ok: true, options: [] }));

  const outcome = await calculateShippingCapability(() => catalogPort, () => carrierService).execute({}, context(opportunityId));
  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.data, { status: "no_shipping_options", destination: { communeId: 99, canonicalName: "Ñuñoa" }, totalWeightKg: 10 });
});

test("weightKg: 0 is preserved literally and does not block the calculation", async () => {
  const opportunityId = uniqueOpportunityId();
  await confirmDestination(opportunityId);
  await confirmItems(opportunityId, [{ productId: "1", quantity: 3 }]);
  const catalogPort = fakeCatalogPort((input) => ({ ok: true, input, product: product({ productId: "1", weightKg: 0 }) }));
  const carrierService = fakeCarrierService(() => successOptions());

  const outcome = await calculateShippingCapability(() => catalogPort, () => carrierService).execute({}, context(opportunityId));
  assert.equal(outcome.status, "completed");
  assert.equal(carrierService.calls[0].totalWeightKg, 0);
});
