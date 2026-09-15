import assert from "node:assert/strict";
import test from "node:test";
import { buildCommercialWorkProjection, type CommercialObjectiveSeed } from "@/lib/brain/commercial/work";
import { buildCommercialDomainReadModel, makeCommercialFreshness, type CommercialDomainReadModelDependencies } from "@/lib/brain/commercial/domain-read-model";
import type { CatalogPort, CatalogProduct } from "@/lib/catalog";
import type { CommercialLineItemSelection } from "@/lib/domains/commercial-line-items";
import type { CreatedQuote } from "@/lib/domains/created-quote";
import type { SelectedShippingOption } from "@/lib/domains/selected-shipping-option";
import type { ShippingDestination } from "@/lib/domains/shipping-destination";
import type { QuoteServicePort, QuoteServiceQuote } from "@/lib/domains/quote-service";
import type { NativeCustomerSessionExecutionContext } from "@/lib/brain/commercial/native-cycle/customer-session";
import type { PersistedCommercialWork } from "@/lib/brain/commercial/work/persistenceTypes";

const OPPORTUNITY_ID = 7001;
const CONVERSATION_ID = 83;

function persistedWork(objectiveSeeds: readonly CommercialObjectiveSeed[] = []): PersistedCommercialWork {
  const work = buildCommercialWorkProjection({
    trigger: { type: "SYSTEM_EVENT", eventType: "fixture", correlationId: "fixture-correlation", conversationId: CONVERSATION_ID, opportunityId: OPPORTUNITY_ID },
    conversation: { id: CONVERSATION_ID, humanOwnerActive: false, aiEnabled: true },
    opportunity: { id: OPPORTUNITY_ID },
    objectiveSeeds: [...objectiveSeeds],
    now: "2026-09-15T12:00:00.000Z"
  });
  return {
    ...work,
    publicId: "cw-fixture-83",
    correlationKey: "cw-fixture-key",
    version: 4,
    createdAt: "2026-09-15T11:59:00.000Z",
    updatedAt: "2026-09-15T12:00:00.000Z",
    completedAt: null,
    cancelledAt: null,
    cancelReason: null
  };
}

function lineItems(items: CommercialLineItemSelection["items"], factId = "cart-fact-1"): CommercialLineItemSelection {
  return { items, factId, updatedAt: "2026-09-15T11:00:00.000Z" };
}

function destination(factId = "destination-fact-1"): ShippingDestination {
  return { factId, communeId: sanBernardoCommuneId(), canonicalName: "San Bernardo", matchedVia: "direct", updatedAt: "2026-09-15T11:01:00.000Z" };
}

function sanBernardoCommuneId(): number {
  return 134;
}

function selection(overrides: Partial<SelectedShippingOption> = {}): SelectedShippingOption {
  return {
    factId: "shipping-selection-fact-1",
    shippingQuoteExecutionId: "shipping-execution-1",
    shippingQuoteCorrelationId: "corr-shipping",
    selectionFactId: "cart-fact-1",
    destinationFactId: "destination-fact-1",
    optionIndex: 0,
    carrierName: "Chilexpress",
    serviceType: "normal",
    totalCost: 5990,
    estimatedDelivery: "2-3 días hábiles",
    calculatedAt: "2026-09-15T11:02:00.000Z",
    selectedAt: "2026-09-15T11:03:00.000Z",
    updatedAt: "2026-09-15T11:03:00.000Z",
    ...overrides
  };
}

function createdQuote(overrides: Partial<CreatedQuote> = {}): CreatedQuote {
  return {
    factId: "quote-fact-1",
    updatedAt: "2026-09-15T11:04:00.000Z",
    quoteId: "quote-1",
    quoteNumber: "COT-1",
    status: "draft",
    currency: "CLP",
    total: "159990",
    validUntil: "2026-09-30T23:59:59.000Z",
    selectionFactId: "cart-fact-1",
    idempotencyKey: "quote-idempotency-1",
    createdAt: "2026-09-15T11:04:00.000Z",
    ...overrides
  };
}

function shippingExecution(overrides: Record<string, unknown> = {}) {
  return {
    publicId: "shipping-execution-1",
    capabilityName: "calculate_shipping",
    executionStatus: "completed" as const,
    completedAt: "2026-09-15T11:02:00.000Z",
    responseSummaryJson: { status: "available", selectionFactId: "cart-fact-1", destinationFactId: "destination-fact-1", ...overrides }
  };
}

function session(): NativeCustomerSessionExecutionContext {
  return {
    conversationId: String(CONVERSATION_ID),
    opportunityId: String(OPPORTUNITY_ID),
    trustedInbound: { channel: "whatsapp", externalId: "not-used-by-read-model", normalizedPhone: "not-used-by-read-model", messageId: "message-1", receivedAt: "2026-09-15T12:00:00.000Z" },
    identity: { status: "identified", customerId: "customer-1", source: "customer_service", localResolutionOutcome: "resolved", externalResolutionOutcome: "resolved" },
    masterCustomerIdentity: { status: "resolved", masterCustomerId: "customer-1", source: "native_session_verified_projection" },
    runtimeIdentity: { status: "MASTER_RESOLVED", identityLevel: "LEVEL_2_MASTER_RESOLVED", masterCustomerId: "customer-1", prestashopCustomerId: null, verificationRequired: false, requiredEvidence: [], readyToLink: false, conflictCode: null, policyCode: "MASTER_FROM_CUSTOMER_SERVICE", evidenceRefs: [] },
    onboarding: null,
    contextAccess: "commercial_history",
    currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: null },
    freshExternalResolutionEvidence: null
  };
}

function product(productId: string): CatalogProduct {
  return {
    productId,
    name: productId === "kong" ? "Kong" : "Discos compatibles 15kg",
    sku: `SKU-${productId}`,
    shortDescription: null,
    longDescription: null,
    active: true,
    selectedVariant: null,
    variants: [],
    price: { amount: 10000, currency: "CLP", taxIncluded: true, taxRate: 0.19, discountApplied: false },
    availability: "in_stock",
    stockQuantity: 10,
    weightKg: 15,
    provenance: { source: "catalog_service_http", retrievedAt: "2026-09-15T11:05:00.000Z", cached: false }
  };
}

function catalogWith(getProductDetails: CatalogPort["getProductDetails"]): CatalogPort {
  return { getProductDetails } as CatalogPort;
}

function quoteServiceWith(getQuote: QuoteServicePort["getQuote"]): QuoteServicePort {
  return { getQuote } as QuoteServicePort;
}

function quoteServiceQuote(overrides: Partial<QuoteServiceQuote> = {}): QuoteServiceQuote {
  return {
    quoteId: "quote-1",
    quoteNumber: "COT-1",
    opportunityId: String(OPPORTUNITY_ID),
    customerId: null,
    conversationId: String(CONVERSATION_ID),
    actor: { type: "sales_agent", id: "agent" },
    source: { system: "crm_customer_360", correlationId: "corr" },
    status: "draft",
    currency: "CLP",
    customerSnapshot: { name: "Cliente", businessName: null, email: null, phone: null, address: null, district: null, region: null },
    items: [],
    pricing: { subtotal: "159990", taxAmount: "0", total: "159990" },
    validUntil: "2026-09-30T23:59:59.000Z",
    version: 3,
    revision: { rootId: "quote-1", previousRevisionId: null, supersedesQuoteId: null, supersededByQuoteId: null },
    issuedDocument: { available: false, contentHash: null, renderVersion: null, generatedAt: null, pdf: { documentRef: null, sha256: null }, html: { documentRef: null, sha256: null } },
    timestamps: { createdAt: "2026-09-15T11:04:00.000Z", updatedAt: "2026-09-15T11:06:00.000Z", issuedAt: null, acceptedAt: null, paidAt: null, cancelledAt: null, expiredAt: null },
    ...overrides
  };
}

async function build(overrides: {
  readonly work?: PersistedCommercialWork | null;
  readonly cart?: CommercialLineItemSelection | null;
  readonly destination?: ShippingDestination | null;
  readonly selected?: SelectedShippingOption | null;
  readonly quote?: CreatedQuote | null;
  readonly calculations?: readonly ReturnType<typeof shippingExecution>[];
  readonly dependencies?: Partial<CommercialDomainReadModelDependencies>;
  readonly trustedCustomerSession?: NativeCustomerSessionExecutionContext | null;
  readonly objectiveSeeds?: readonly CommercialObjectiveSeed[];
} = {}) {
  const dependencies: CommercialDomainReadModelDependencies = {
    readCart: async () => overrides.cart === undefined ? null : overrides.cart,
    readDestination: async () => overrides.destination === undefined ? null : overrides.destination,
    readSelectedShipping: async () => overrides.selected === undefined ? null : overrides.selected,
    readCreatedQuote: async () => overrides.quote === undefined ? null : overrides.quote,
    readShippingCalculations: async () => overrides.calculations ?? [],
    catalogPort: null,
    quoteServicePort: null,
    ...overrides.dependencies
  };
  return buildCommercialDomainReadModel({
    conversationId: CONVERSATION_ID,
    opportunityId: OPPORTUNITY_ID,
    correlationId: "read-model-test",
    commercialWork: overrides.work === undefined ? persistedWork(overrides.objectiveSeeds) : overrides.work,
    trustedCustomerSession: overrides.trustedCustomerSession,
    dependencies
  });
}

test("A: empty/new commercial case is reconstructed without transcript", async () => {
  const model = await build();
  assert.equal(model.objective, null);
  assert.deepEqual(model.cart.items, []);
  assert.equal(model.destination, null);
  assert.equal(model.shipping.state, "MISSING");
  assert.equal(model.quote, null);
});

test("B: active CREATE_QUOTE keeps durable objective and current facts separate", async () => {
  const model = await build({
    objectiveSeeds: [{ type: "CREATE_QUOTE", inputs: { items: [{ productId: "kong", combinationId: null, quantity: 1 }] } }],
    cart: lineItems([{ productId: "kong", combinationId: null, quantity: 1 }]),
    destination: destination()
  });
  assert.equal(model.objective?.type, "CREATE_QUOTE");
  assert.equal(model.cart.items[0]?.productId, "kong");
  assert.equal(model.destination?.canonicalName, "San Bernardo");
  assert.equal(model.shipping.state, "MISSING");
  assert.equal(model.quote, null);
});

test("C-E: shipping state is current only when both durable anchors match", async () => {
  const current = await build({ cart: lineItems([{ productId: "kong", combinationId: null, quantity: 1 }]), destination: destination(), selected: selection(), calculations: [shippingExecution()] });
  assert.equal(current.shipping.state, "CURRENT");

  const staleCart = await build({ cart: lineItems([{ productId: "kong", combinationId: null, quantity: 2 }], "cart-fact-2"), destination: destination(), selected: selection(), calculations: [shippingExecution()] });
  assert.equal(staleCart.shipping.state, "STALE");
  assert.equal(staleCart.shipping.freshness.reason, "selection_changed");

  const staleDestination = await build({ cart: lineItems([{ productId: "kong", combinationId: null, quantity: 1 }]), destination: destination("destination-fact-2"), selected: selection(), calculations: [shippingExecution()] });
  assert.equal(staleDestination.shipping.state, "STALE");
  assert.equal(staleDestination.shipping.freshness.reason, "destination_changed");
});

test("shipping and quote reads degrade to UNKNOWN without destroying durable state", async () => {
  const model = await build({
    cart: lineItems([{ productId: "kong", combinationId: null, quantity: 1 }]),
    quote: createdQuote(),
    dependencies: {
      readSelectedShipping: async () => ({ ok: false as const, reason: "selected_shipping_read_failed" }),
      readShippingCalculations: async () => ({ ok: false as const, reason: "shipping_execution_read_failed" }),
      quoteServicePort: null
    }
  });
  assert.equal(model.shipping.state, "UNKNOWN");
  assert.equal(model.cart.items[0]?.productId, "kong");
  assert.equal(model.quote?.freshness.state, "UNKNOWN");
  assert.equal(model.quote?.grounding, "UNKNOWN");
});

test("F-G: quote grounding is deterministic and scoped to the known selection anchor", async () => {
  const quoteServicePort = quoteServiceWith(async () => ({ ok: true as const, value: quoteServiceQuote() }));
  const current = await build({ cart: lineItems([{ productId: "kong", combinationId: null, quantity: 1 }]), quote: createdQuote(), dependencies: { quoteServicePort } });
  assert.equal(current.quote?.grounding, "CURRENT_FOR_KNOWN_ANCHORS");
  assert.equal(current.quote?.freshness.state, "CURRENT");

  const stale = await build({ cart: lineItems([{ productId: "kong", combinationId: null, quantity: 1 }], "cart-fact-2"), quote: createdQuote(), dependencies: { quoteServicePort } });
  assert.equal(stale.quote?.grounding, "STALE");
  assert.equal(stale.quote?.freshness.state, "STALE");
});

test("H: Catalog 404 preserves cart identity and degrades only hydration", async () => {
  const catalogPort = catalogWith(async () => ({ ok: false as const, error: { code: "not_found" as const, message: "hidden", retryable: false } }));
  const model = await build({ cart: lineItems([{ productId: "kong", combinationId: null, quantity: 1 }]), dependencies: { catalogPort } });
  assert.equal(model.cart.items[0]?.productId, "kong");
  assert.equal(model.cart.items[0]?.product, null);
  assert.equal(model.cart.freshness.state, "CURRENT");
  assert.equal(model.cart.items[0]?.freshness.state, "UNKNOWN");
});

test("I: profile unavailability does not erase trusted identity or case state", async () => {
  const model = await build({
    trustedCustomerSession: session(),
    dependencies: { customerProfile: { status: "UNAVAILABLE", retrievedAt: null, relationshipSummary: null } }
  });
  assert.equal(model.customer.hasResolvedCustomer, true);
  assert.equal(model.customer.identityLevel, "LEVEL_2_MASTER_RESOLVED");
  assert.equal(model.customer.profile?.status, "UNAVAILABLE");
  assert.notEqual(model.case.status, "FAILED");
});

test("J: only the active destination fact is projected", async () => {
  const model = await build({ destination: destination("destination-current") });
  assert.equal(model.destination?.factId, "destination-current");
  assert.equal(model.destination?.freshness.state, "CURRENT");
  assert.equal(model.evidence.some((item) => item.reference === "destination-superseded"), false);
});

test("golden reconstruction: Kong plus compatible 15kg plates reaches the read model without transcript input", async () => {
  const catalogPort = catalogWith(async ({ productId }) => ({ ok: true as const, value: product(productId) }));
  const model = await build({
    objectiveSeeds: [{ type: "CREATE_QUOTE", inputs: { items: [{ productId: "kong", combinationId: null, quantity: 1 }, { productId: "plates-15kg", combinationId: null, quantity: 2 }] } }],
    cart: lineItems([
      { productId: "kong", combinationId: null, quantity: 1 },
      { productId: "plates-15kg", combinationId: null, quantity: 2 }
    ]),
    destination: destination(),
    dependencies: { catalogPort }
  });
  assert.equal(model.objective?.type, "CREATE_QUOTE");
  assert.deepEqual(model.cart.items.map((item) => [item.productId, item.quantity]), [["kong", 1], ["plates-15kg", 2]]);
  assert.equal(model.cart.items.every((item) => item.product !== null), true);
  assert.equal(model.destination?.canonicalName, "San Bernardo");
  assert.equal(model.shipping.state, "MISSING");
  assert.equal(model.quote, null);
});

test("same durable state and port responses produce byte-equivalent projections", async () => {
  const catalogPort = catalogWith(async ({ productId }) => ({ ok: true as const, value: product(productId) }));
  const dependencies = { catalogPort };
  const first = await build({ cart: lineItems([{ productId: "kong", combinationId: null, quantity: 1 }]), dependencies });
  const second = await build({ cart: lineItems([{ productId: "kong", combinationId: null, quantity: 1 }]), dependencies });
  assert.deepEqual(first, second);
});

test("freshness contract can represent every common state", () => {
  const states = ["CURRENT", "STALE", "SUPERSEDED", "HISTORICAL", "UNKNOWN"] as const;
  assert.deepEqual(
    states.map((state) => makeCommercialFreshness({ state, source: "fixture" }).state),
    states
  );
});
