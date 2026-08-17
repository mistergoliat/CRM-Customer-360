import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, queryRows, safeExecute } from "@/lib/db";
import { resolveCapabilityGatewayDefinition } from "@/lib/brain/commercial/capability-gateway/registry";
import { AGENT_LOOP_TOOL_POOL, buildToolDescriptions } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";
import { createQuoteCapability, CREATE_QUOTE_INPUT_SCHEMA } from "@/lib/brain/commercial/capability-gateway/createQuoteCapability";
import { setCommercialLineItemsForOpportunity } from "@/lib/domains/commercial-line-items";
import { getActiveCreatedQuoteForOpportunity } from "@/lib/domains/created-quote";
import type { CapabilityGatewayContext } from "@/lib/brain/commercial/capability-gateway/types";
import type { CatalogBatchItemInput, CatalogBatchItemResult, CatalogPort, CatalogProduct } from "@/lib/catalog";
import type { QuoteServicePort, QuoteServiceQuote } from "@/lib/domains/quote-service";
import type { QuoteServiceError, QuoteServiceResult } from "@/lib/domains/quote-service";

/**
 * SALES-AGENT-R1-T3. Capability-level tests for create_quote - requires a
 * live DB (crm_opportunities/master_customer real rows,
 * commercial_line_items/created_quote real crm_request_facts rows), same
 * environment dependency already accepted by
 * selectShippingOptionCapability.test.ts/calculateShippingCapability.test.ts
 * - not runnable in this sandbox (no MariaDB/Docker), verified via
 * typecheck only. QuoteServicePort itself is injected as a fake (same
 * injection point calculateShippingCapability.test.ts uses for
 * CatalogPort/CarrierService), so no real Quote Service HTTP call is ever
 * needed here.
 */

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "main_management",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_URL: ""
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

function uniqueSuffix(label = "t3") {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function seedCustomer(): Promise<number> {
  const email = `${uniqueSuffix("t3-customer")}@example.com`;
  await queryRows(
    "INSERT INTO master_customer (firstname, lastname, email, platform_origin) VALUES ('Jane', 'Doe', ?, 'hub')",
    [email]
  );
  const rows = await queryRows<{ id: number }>("SELECT id FROM master_customer WHERE email = ? LIMIT 1", [email]);
  return Number(rows[0].id);
}

async function seedOpportunity(customerMasterId: number | null): Promise<number> {
  const key = `sales-agent-r1-t3-${uniqueSuffix()}`;
  const waId = `5691${String(Date.now()).slice(-8)}`;
  await safeExecute(
    `INSERT INTO crm_opportunities (opportunity_key, requirements_json, missing_requirements_json, product_interests_json, objections_json, signals_json, customer_master_id, wa_id)
     VALUES (?, '{}', '[]', '[]', '[]', '[]', ?, ?)`,
    [key, customerMasterId !== null ? String(customerMasterId) : null, waId]
  );
  const rows = await queryRows<{ id: number }>(`SELECT id FROM crm_opportunities WHERE opportunity_key = ? LIMIT 1`, [key]);
  return rows[0].id;
}

function context(opportunityId: number | null): CapabilityGatewayContext {
  return { correlationId: `corr-${uniqueSuffix()}`, opportunityId, conversationId: null };
}

function fakeQuoteServicePort(overrides: Partial<QuoteServicePort> = {}): QuoteServicePort {
  return {
    async createQuote() {
      throw new Error("createQuote not stubbed for this test");
    },
    async updateDraft() {
      throw new Error("not used");
    },
    async issueQuote() {
      throw new Error("not used");
    },
    async sendQuoteEmail() {
      throw new Error("not used");
    },
    async getQuote() {
      throw new Error("not used");
    },
    async getQuoteByNumber() {
      throw new Error("not used");
    },
    async getQuoteDelivery() {
      throw new Error("not used");
    },
    async listQuoteDeliveries() {
      throw new Error("not used");
    },
    ...overrides
  };
}

function fakeQuote(overrides: Partial<QuoteServiceQuote> = {}): QuoteServiceQuote {
  return {
    quoteId: "quote-1",
    quoteNumber: "Q-0001",
    opportunityId: "1",
    customerId: "1",
    conversationId: null,
    actor: { type: "sales_agent", id: "native_agent_tool_loop" },
    source: { system: "crm_customer_360", correlationId: null },
    status: "draft",
    currency: "CLP",
    customerSnapshot: { name: "Jane Doe", businessName: null, email: "jane@example.com", phone: null, address: null, district: null, region: null },
    items: [],
    pricing: { subtotal: "99990", taxAmount: "18998", total: "118988" },
    validUntil: "2026-08-20T00:00:00.000Z",
    version: 1,
    revision: { rootId: "quote-1", previousRevisionId: null, supersedesQuoteId: null, supersededByQuoteId: null },
    issuedDocument: { available: false, contentHash: null, renderVersion: null, generatedAt: null, pdf: { documentRef: null, sha256: null }, html: { documentRef: null, sha256: null } },
    timestamps: { createdAt: "2026-08-15T00:00:00.000Z", updatedAt: "2026-08-15T00:00:00.000Z", issuedAt: null, acceptedAt: null, paidAt: null, cancelledAt: null, expiredAt: null },
    ...overrides
  };
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
    provenance: { source: "catalog_service_http", retrievedAt: "2026-08-15T00:00:00.000Z", cached: false },
    ...overrides
  };
}

function fakeCatalogPort(resolve: (input: CatalogBatchItemInput) => CatalogBatchItemResult): CatalogPort {
  return {
    async searchProducts() { throw new Error("not used"); },
    async getProductDetails() { throw new Error("not used"); },
    async batchGetProducts(input) {
      return { ok: true, value: { items: input.items.map(resolve), provenance: { source: "catalog_service_http", retrievedAt: "2026-08-15T00:00:00.000Z", cached: false } } };
    },
    async exploreCatalog() { throw new Error("not used"); }
  };
}

function capabilityWithCatalog(port: QuoteServicePort) {
  return createQuoteCapability(
    () => port,
    () => ({
      getCatalogPort: () => fakeCatalogPort((input) => ({ ok: true, input, product: product({ productId: input.productId }) })),
      now: () => new Date("2026-08-15T00:00:00.000Z")
    })
  );
}

function conflictError(code: string): QuoteServiceError {
  return { class: "conflict", code, message: "conflict", httpStatus: 409, retryable: false };
}

test("registered in the Capability Gateway and exposed to the Native Agent Tool Loop; takes no arguments", () => {
  assert.ok(AGENT_LOOP_TOOL_POOL.includes("create_quote"));
  const tool = buildToolDescriptions().find((t) => t.name === "create_quote");
  assert.ok(tool);
  assert.deepEqual(tool!.inputSchema, CREATE_QUOTE_INPUT_SCHEMA);

  const def = resolveCapabilityGatewayDefinition("create_quote");
  assert.ok(def, "create_quote must be registered in the Capability Gateway");
});

test("no active opportunity: denied, never assembles or calls Quote Service", async () => {
  const outcome = await createQuoteCapability(() => fakeQuoteServicePort()).execute({}, context(null));
  assert.equal(outcome.status, "denied");
  assert.equal(outcome.errorCode, "no_active_opportunity");
});

test("Quote Service not configured: unavailable at checkAvailability, technical failure at execute", async () => {
  const capability = createQuoteCapability(() => null);
  const availability = await capability.checkAvailability(context(1));
  assert.equal(availability.status, "unavailable");
  assert.equal(availability.reason, "quote_service_not_configured");

  const outcome = await capability.execute({}, context(1));
  assert.equal(outcome.status, "temporarily_blocked");
  assert.equal(outcome.retryable, true);
  assert.equal(outcome.errorCode, "quote_service_not_configured");
});

test("no commercial_line_items yet: completed with an informational status, no Quote Service call", async () => {
  const customerId = await seedCustomer();
  const opportunityId = await seedOpportunity(customerId);

  const outcome = await createQuoteCapability(() => fakeQuoteServicePort()).execute({}, context(opportunityId));
  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.data, { status: "no_commercial_line_items", opportunityId });
});

test("resolved: assembles from real commercial_line_items, creates via Quote Service, persists the reference", async () => {
  const customerId = await seedCustomer();
  const opportunityId = await seedOpportunity(customerId);
  const lineItems = await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "545", combinationId: null, quantity: 2 }] });
  assert.equal(lineItems.ok, true);

  let createCallCount = 0;
  const port = fakeQuoteServicePort({
    async createQuote(): Promise<QuoteServiceResult<QuoteServiceQuote>> {
      createCallCount += 1;
      return { ok: true, value: fakeQuote() };
    }
  });

  const outcome = await capabilityWithCatalog(port).execute({}, context(opportunityId));
  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.data, {
    status: "created",
    quoteId: "quote-1",
    quoteNumber: "Q-0001",
    quoteStatus: "draft",
    currency: "CLP",
    total: "118988",
    validUntil: "2026-08-20T00:00:00.000Z"
  });
  assert.equal(createCallCount, 1);

  const persisted = await getActiveCreatedQuoteForOpportunity(opportunityId);
  assert.equal(persisted?.quoteId, "quote-1");
  assert.equal(persisted?.selectionFactId, lineItems.ok ? lineItems.selection.factId : null);
});

test("resolved: a second call with the UNCHANGED selection reuses the existing quote - Quote Service is called at most once", async () => {
  const customerId = await seedCustomer();
  const opportunityId = await seedOpportunity(customerId);
  await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "545", combinationId: null, quantity: 2 }] });

  let createCallCount = 0;
  const port = fakeQuoteServicePort({
    async createQuote(): Promise<QuoteServiceResult<QuoteServiceQuote>> {
      createCallCount += 1;
      return { ok: true, value: fakeQuote() };
    }
  });
  const capability = capabilityWithCatalog(port);

  const first = await capability.execute({}, context(opportunityId));
  assert.equal(first.status, "completed");
  assert.equal((first.data as { status?: string } | null)?.status, "created");

  const second = await capability.execute({}, context(opportunityId));
  assert.equal(second.status, "completed");
  assert.equal((second.data as { status?: string } | null)?.status, "reused");
  assert.equal(createCallCount, 1, "a second call for the same unchanged selection must never call Quote Service again");

  const persisted = await getActiveCreatedQuoteForOpportunity(opportunityId);
  assert.equal(persisted?.quoteId, "quote-1");
});

test("Quote Service returns a conflict: mapped to a non-retryable failure, nothing persisted", async () => {
  const customerId = await seedCustomer();
  const opportunityId = await seedOpportunity(customerId);
  await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "545", combinationId: null, quantity: 2 }] });

  const port = fakeQuoteServicePort({
    async createQuote(): Promise<QuoteServiceResult<QuoteServiceQuote>> {
      return { ok: false, error: conflictError("idempotency_key_reused_with_different_payload") };
    }
  });

  const outcome = await capabilityWithCatalog(port).execute({}, context(opportunityId));
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.retryable, false);
  assert.equal(outcome.errorCode, "idempotency_key_reused_with_different_payload");

  const persisted = await getActiveCreatedQuoteForOpportunity(opportunityId);
  assert.equal(persisted, null);
});
