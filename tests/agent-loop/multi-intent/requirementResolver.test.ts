import assert from "node:assert/strict";
import test from "node:test";
import { resolveCommercialIntentPlan } from "@/lib/brain/commercial/multi-intent/requirementResolver";
import type { RequirementResolverContext } from "@/lib/brain/commercial/multi-intent/requirementResolver";
import type { RecentCatalogContext } from "@/lib/brain/commercial/agent-loop/recentCatalogContext";

function catalogContext(products: Array<{ productId: string; name: string }>): RecentCatalogContext {
  return { interactions: [{ inboundMessageId: "m1", completedAt: new Date().toISOString(), sourceTool: "search_products", products }] };
}

function baseContext(overrides: Partial<RequirementResolverContext> = {}): RequirementResolverContext {
  return { commercialContextSummary: {}, recentCatalogContext: null, ...overrides };
}

test("[MI-Resolve-1] select_products with an exact RecentCatalogContext match resolves PRODUCT and QUANTITY", () => {
  const context = baseContext({ recentCatalogContext: catalogContext([{ productId: "31", name: "Barra Olimpica Classic 20kg" }]) });
  const [resolved] = resolveCommercialIntentPlan([{ type: "select_products", productReference: "Classic", quantity: 2 }], context);
  assert.equal(resolved.status, "ready");
  const product = resolved.requirements.find((r) => r.type === "PRODUCT");
  assert.equal(product?.status, "resolved");
  if (product?.status === "resolved") assert.deepEqual(product.value, { productId: "31", name: "Barra Olimpica Classic 20kg" });
});

// Part 21 test 7: producto ausente.
// LLM-R1-T09B real bug (WA01 live smoke): the planner returned "la classic"
// for "quiero 2 de la classic" - a leading Spanish article that made neither
// direction of the old pure-substring match succeed against the real
// product name. Regression test for the fix (stripLeadingFillerWords).
test("[MI-Resolve-1b] a productReference with a leading Spanish article (\"la classic\") still resolves against the real product name", () => {
  const context = baseContext({ recentCatalogContext: catalogContext([{ productId: "31", name: "Barra Olimpica Classic 20kg" }]) });
  const [resolved] = resolveCommercialIntentPlan([{ type: "select_products", productReference: "la classic", quantity: 2 }], context);
  assert.equal(resolved.status, "ready");
  const product = resolved.requirements.find((r) => r.type === "PRODUCT");
  assert.equal(product?.status, "resolved");
  if (product?.status === "resolved") assert.equal((product.value as { productId: string }).productId, "31");
});

test("[MI-Resolve-1c] a leading filler word is never stripped from a real product name that starts with one (e.g. a hypothetical \"La Roca\")", () => {
  const context = baseContext({ recentCatalogContext: catalogContext([{ productId: "99", name: "La Roca 24kg" }, { productId: "31", name: "Barra Olimpica Classic 20kg" }]) });
  const [resolved] = resolveCommercialIntentPlan([{ type: "select_products", productReference: "la roca", quantity: 1 }], context);
  const product = resolved.requirements.find((r) => r.type === "PRODUCT");
  assert.equal(product?.status, "resolved");
  if (product?.status === "resolved") assert.equal((product.value as { productId: string }).productId, "99", "matches La Roca, not Classic");
});

// LLM-R1-T09B real bug (WA03/WA05 live smoke): the Catalog Service's own
// "no variant" sentinel (combinationId 0, PrestaShop convention) was being
// carried forward as if it were a real, specific variant id - persisted,
// then rejected by calculate_shipping's batch round-trip. "0" must never
// survive as a resolved combinationId.
test("[MI-Resolve-1d] a RecentCatalogContext product with combinationId \"0\" (Catalog Service's \"no variant\" sentinel) resolves without a combinationId", () => {
  const context: RequirementResolverContext = {
    commercialContextSummary: {},
    recentCatalogContext: { interactions: [{ inboundMessageId: "m1", completedAt: new Date().toISOString(), sourceTool: "search_products", products: [{ productId: "31", name: "Barra Olimpica Classic 20kg", combinationId: "0" }] }] }
  };
  const [resolved] = resolveCommercialIntentPlan([{ type: "select_products", productReference: "Classic", quantity: 1 }], context);
  const product = resolved.requirements.find((r) => r.type === "PRODUCT");
  assert.equal(product?.status, "resolved");
  if (product?.status === "resolved") assert.equal((product.value as { combinationId?: string }).combinationId, undefined);
});

test("[MI-Resolve-1e] a durable line item with combinationId \"0\" resolves without a combinationId", () => {
  const context = baseContext({ commercialContextSummary: { commercialLineItems: { items: [{ productId: "31", combinationId: "0", quantity: 1 }] } } });
  const [resolved] = resolveCommercialIntentPlan([{ type: "select_products", quantity: 2 }], context);
  const product = resolved.requirements.find((r) => r.type === "PRODUCT");
  assert.equal(product?.status, "resolved");
  if (product?.status === "resolved") assert.equal((product.value as { combinationId?: string }).combinationId, undefined);
});

test("[MI-Resolve-2] select_products with no matching evidence leaves PRODUCT missing, never invented", () => {
  const context = baseContext({ recentCatalogContext: catalogContext([{ productId: "31", name: "Barra Olimpica Classic 20kg" }]) });
  const [resolved] = resolveCommercialIntentPlan([{ type: "select_products", productReference: "mancuerna", quantity: 1 }], context);
  assert.equal(resolved.status, "waiting_for_information");
  assert.deepEqual(resolved.requirements.find((r) => r.type === "PRODUCT")?.status, "missing");
});

// Part 21 test 6: producto ambiguo.
test("[MI-Resolve-3] select_products matching two distinct catalog products is ambiguous, never silently picked", () => {
  const context = baseContext({
    recentCatalogContext: catalogContext([
      { productId: "31", name: "Barra Olimpica Classic 20kg" },
      { productId: "32", name: "Barra Olimpica Pro 20kg" }
    ])
  });
  const [resolved] = resolveCommercialIntentPlan([{ type: "select_products", productReference: "barra", quantity: 1 }], context);
  assert.equal(resolved.status, "needs_clarification");
  const product = resolved.requirements.find((r) => r.type === "PRODUCT");
  assert.equal(product?.status, "ambiguous");
  if (product?.status === "ambiguous") assert.equal(product.candidates.length, 2);
});

test("[MI-Resolve-4] a bare deictic reference (esa) never fuzzy-matches a candidate - the planner should have resolved it, not the resolver", () => {
  const context = baseContext({ recentCatalogContext: catalogContext([{ productId: "31", name: "Barra Olimpica Classic 20kg" }]) });
  const [resolved] = resolveCommercialIntentPlan([{ type: "select_products", productReference: "esa", quantity: 1 }], context);
  assert.equal(resolved.requirements.find((r) => r.type === "PRODUCT")?.status, "missing");
});

test("[MI-Resolve-5] no productReference at all with exactly one durable line item resolves PRODUCT from durable state", () => {
  const context = baseContext({ commercialContextSummary: { commercialLineItems: { items: [{ productId: "31", combinationId: null, quantity: 2 }] } } });
  const [resolved] = resolveCommercialIntentPlan([{ type: "select_products", quantity: 5 }], context);
  const product = resolved.requirements.find((r) => r.type === "PRODUCT");
  assert.equal(product?.status, "resolved");
  if (product?.status === "resolved") assert.equal((product.value as { productId: string }).productId, "31");
});

test("[MI-Resolve-6] no productReference with two or more durable line items leaves PRODUCT missing - never guesses which one", () => {
  const context = baseContext({
    commercialContextSummary: { commercialLineItems: { items: [{ productId: "31", combinationId: null, quantity: 1 }, { productId: "32", combinationId: null, quantity: 1 }] } }
  });
  const [resolved] = resolveCommercialIntentPlan([{ type: "select_products" }], context);
  assert.equal(resolved.requirements.find((r) => r.type === "PRODUCT")?.status, "missing");
});

test("[MI-Resolve-7] select_products with no quantity stated leaves QUANTITY missing, never defaulted", () => {
  const context = baseContext({ recentCatalogContext: catalogContext([{ productId: "31", name: "Classic" }]) });
  const [resolved] = resolveCommercialIntentPlan([{ type: "select_products", productReference: "Classic" }], context);
  assert.equal(resolved.status, "waiting_for_information");
  assert.equal(resolved.requirements.find((r) => r.type === "QUANTITY")?.status, "missing");
});

test("[MI-Resolve-8] get_shipping_quote with an explicit destination and a same-turn ready select_products resolves fully", () => {
  const context = baseContext({ recentCatalogContext: catalogContext([{ productId: "31", name: "Classic" }]) });
  const resolved = resolveCommercialIntentPlan(
    [
      { type: "select_products", productReference: "Classic", quantity: 2 },
      { type: "get_shipping_quote", destination: "Ñuñoa" }
    ],
    context
  );
  assert.equal(resolved[0].status, "ready");
  assert.equal(resolved[1].status, "ready");
  const productSelection = resolved[1].requirements.find((r) => r.type === "PRODUCT_SELECTION");
  assert.equal(productSelection?.status, "resolved");
  if (productSelection?.status === "resolved") assert.equal(productSelection.source, "same_turn_intent");
  const destination = resolved[1].requirements.find((r) => r.type === "DESTINATION");
  if (destination?.status === "resolved") assert.equal(destination.source, "explicit");
});

// Part 4 example: destination missing, product selection already durable -> only DESTINATION missing, product is never re-asked.
test("[MI-Resolve-9] get_shipping_quote with durable product selection but no destination stated is waiting only on DESTINATION", () => {
  const context = baseContext({ commercialContextSummary: { commercialLineItems: { items: [{ productId: "31", combinationId: null, quantity: 1 }] } } });
  const [resolved] = resolveCommercialIntentPlan([{ type: "get_shipping_quote" }], context);
  assert.equal(resolved.status, "waiting_for_information");
  assert.equal(resolved.requirements.find((r) => r.type === "PRODUCT_SELECTION")?.status, "resolved");
  assert.equal(resolved.requirements.find((r) => r.type === "DESTINATION")?.status, "missing");
});

test("[MI-Resolve-10] get_shipping_quote with a durable shipping destination reuses it - never asked again", () => {
  const context = baseContext({
    commercialContextSummary: {
      commercialLineItems: { items: [{ productId: "31", combinationId: null, quantity: 1 }] },
      shippingDestination: { communeId: 99, canonicalName: "Ñuñoa" }
    }
  });
  const [resolved] = resolveCommercialIntentPlan([{ type: "get_shipping_quote" }], context);
  assert.equal(resolved.status, "ready");
  const destination = resolved.requirements.find((r) => r.type === "DESTINATION");
  if (destination?.status === "resolved") assert.equal(destination.source, "durable_state");
});

test("[MI-Resolve-11] an unsupported intent is always needs_clarification with no requirements", () => {
  const [resolved] = resolveCommercialIntentPlan([{ type: "unsupported", description: "arriendo por una semana" }], baseContext());
  assert.equal(resolved.status, "needs_clarification");
  assert.deepEqual(resolved.requirements, []);
});

test("[MI-Resolve-12] get_shipping_quote with neither product selection nor destination is missing both", () => {
  const [resolved] = resolveCommercialIntentPlan([{ type: "get_shipping_quote" }], baseContext());
  assert.equal(resolved.status, "waiting_for_information");
  const missing = resolved.requirements.filter((r) => r.status === "missing").map((r) => r.type);
  assert.deepEqual(missing.sort(), ["DESTINATION", "PRODUCT_SELECTION"]);
});

// SALES-AGENT-R2-A11.4. select_shipping_option is deliberately a
// presence-check only at this layer - real matching against calculate_shipping
// evidence happens downstream in buildCommercialWorkProjection.ts's
// applyObjectiveState, never here (no RecentShippingQuoteContext exists on
// this contract at all).
test("[MI-Resolve-13] select_shipping_option with a raw reference resolves SHIPPING_OPTION as explicit, unresolved by this layer", () => {
  const [resolved] = resolveCommercialIntentPlan([{ type: "select_shipping_option", optionReference: "la segunda" }], baseContext());
  assert.equal(resolved.status, "ready");
  assert.deepEqual(resolved.requirements, [{ type: "SHIPPING_OPTION", status: "resolved", source: "explicit", value: "la segunda" }]);
});

// SHIP16 (multi-intent layer): no optionReference at all is missing, never invents.
test("[MI-Resolve-14] SHIP16: select_shipping_option with no optionReference leaves SHIPPING_OPTION missing", () => {
  const [resolved] = resolveCommercialIntentPlan([{ type: "select_shipping_option" }], baseContext());
  assert.equal(resolved.status, "waiting_for_information");
  assert.deepEqual(resolved.requirements, [{ type: "SHIPPING_OPTION", status: "missing" }]);
});

// SALES-AGENT-R2-ID-R2-A11. repeat_purchase declares no requirement at this
// layer at all - identity (LEVEL_3) is a CommercialWork-level gate
// (commercialIdentityGate.ts), never a semantic-planning-layer requirement;
// this layer only resolves catalog/destination-shaped requirements. Always
// "ready", regardless of whether productHint is present.
test("[MI-Resolve-15] repeat_purchase is always ready with no requirements, with or without a productHint", () => {
  const [withHint] = resolveCommercialIntentPlan([{ type: "repeat_purchase", productHint: "discos" }], baseContext());
  assert.equal(withHint.status, "ready");
  assert.deepEqual(withHint.requirements, []);

  const [withoutHint] = resolveCommercialIntentPlan([{ type: "repeat_purchase" }], baseContext());
  assert.equal(withoutHint.status, "ready");
  assert.deepEqual(withoutHint.requirements, []);
});

// SALES-AGENT-R2-ID-R2-A12.

test("[MI-Resolve-16] customer_aware_recommendation is always ready with no requirements, with or without a queryHint", () => {
  const [withHint] = resolveCommercialIntentPlan([{ type: "customer_aware_recommendation", queryHint: "discos" }], baseContext());
  assert.equal(withHint.status, "ready");
  assert.deepEqual(withHint.requirements, []);

  const [withoutHint] = resolveCommercialIntentPlan([{ type: "customer_aware_recommendation" }], baseContext());
  assert.equal(withoutHint.status, "ready");
  assert.deepEqual(withoutHint.requirements, []);
});
