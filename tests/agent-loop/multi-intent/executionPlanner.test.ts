import assert from "node:assert/strict";
import test from "node:test";
import { planCommercialActions } from "@/lib/brain/commercial/multi-intent/executionPlanner";
import { resolveCommercialIntentPlan } from "@/lib/brain/commercial/multi-intent/requirementResolver";
import type { RequirementResolverContext } from "@/lib/brain/commercial/multi-intent/requirementResolver";
import type { RecentCatalogContext } from "@/lib/brain/commercial/agent-loop/recentCatalogContext";

function catalogContext(products: Array<{ productId: string; name: string }>): RecentCatalogContext {
  return { interactions: [{ inboundMessageId: "m1", completedAt: new Date().toISOString(), sourceTool: "search_products", products }] };
}

test("[MI-Plan-1] single select_products intent plans exactly one select_products step", () => {
  const context: RequirementResolverContext = { commercialContextSummary: {}, recentCatalogContext: catalogContext([{ productId: "31", name: "Classic" }]) };
  const resolved = resolveCommercialIntentPlan([{ type: "select_products", productReference: "Classic", quantity: 2 }], context);
  const steps = planCommercialActions(resolved);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].capability, "select_products");
  assert.deepEqual(steps[0].arguments, { items: [{ productId: "31", quantity: 2 }] });
});

test("[MI-Plan-2] get_shipping_quote alone with a durable selection and an explicit destination plans set_shipping_destination then calculate_shipping (no select_products step)", () => {
  const context: RequirementResolverContext = { commercialContextSummary: { commercialLineItems: { items: [{ productId: "31", combinationId: null, quantity: 1 }] } }, recentCatalogContext: null };
  const resolved = resolveCommercialIntentPlan([{ type: "get_shipping_quote", destination: "Ñuñoa" }], context);
  const steps = planCommercialActions(resolved);
  assert.deepEqual(steps.map((s) => s.capability), ["set_shipping_destination", "calculate_shipping"]);
  assert.equal(steps[0].dependsOnIntentIndex, undefined, "set_shipping_destination never depends on select_products");
});

test("[MI-Plan-3] get_shipping_quote with a durable destination already set plans only calculate_shipping", () => {
  const context: RequirementResolverContext = {
    commercialContextSummary: {
      commercialLineItems: { items: [{ productId: "31", combinationId: null, quantity: 1 }] },
      shippingDestination: { communeId: 99, canonicalName: "Ñuñoa" }
    },
    recentCatalogContext: null
  };
  const resolved = resolveCommercialIntentPlan([{ type: "get_shipping_quote" }], context);
  const steps = planCommercialActions(resolved);
  assert.deepEqual(steps.map((s) => s.capability), ["calculate_shipping"]);
});

// Part 21 test 11: dependency ordering - select_products always precedes the shipping steps, and calculate_shipping's
// dependsOnIntentIndex points at the select_products intent only when PRODUCT_SELECTION came from THIS turn.
test("[MI-Plan-4] select_products + get_shipping_quote (both same-turn) plans select_products, set_shipping_destination, calculate_shipping in that order, with calculate_shipping depending on the select_products intent", () => {
  const context: RequirementResolverContext = { commercialContextSummary: {}, recentCatalogContext: catalogContext([{ productId: "31", name: "Classic" }]) };
  const resolved = resolveCommercialIntentPlan(
    [
      { type: "select_products", productReference: "Classic", quantity: 2 },
      { type: "get_shipping_quote", destination: "Ñuñoa" }
    ],
    context
  );
  const steps = planCommercialActions(resolved);
  assert.deepEqual(steps.map((s) => s.capability), ["select_products", "set_shipping_destination", "calculate_shipping"]);
  const selectStep = steps[0];
  const shippingStep = steps[2];
  assert.equal(shippingStep.dependsOnIntentIndex, selectStep.forIntentIndex);
});

test("[MI-Plan-5] select_products + get_shipping_quote where the SAME-turn selection satisfies PRODUCT_SELECTION but a durable destination already exists never plans set_shipping_destination", () => {
  const context: RequirementResolverContext = {
    commercialContextSummary: { shippingDestination: { communeId: 99, canonicalName: "Ñuñoa" } },
    recentCatalogContext: catalogContext([{ productId: "31", name: "Classic" }])
  };
  const resolved = resolveCommercialIntentPlan(
    [
      { type: "select_products", productReference: "Classic", quantity: 2 },
      { type: "get_shipping_quote" }
    ],
    context
  );
  const steps = planCommercialActions(resolved);
  assert.deepEqual(steps.map((s) => s.capability), ["select_products", "calculate_shipping"]);
  assert.equal(steps[1].dependsOnIntentIndex, steps[0].forIntentIndex, "calculate_shipping still depends on this turn's own selection completing");
});

test("[MI-Plan-6] a waiting_for_information or needs_clarification intent never plans an action for itself", () => {
  const resolvedMissingDestination = resolveCommercialIntentPlan([{ type: "get_shipping_quote" }], { commercialContextSummary: {}, recentCatalogContext: null });
  assert.deepEqual(planCommercialActions(resolvedMissingDestination), []);

  const resolvedAmbiguousProduct = resolveCommercialIntentPlan(
    [{ type: "select_products", productReference: "barra", quantity: 1 }],
    { commercialContextSummary: {}, recentCatalogContext: catalogContext([{ productId: "31", name: "Barra A" }, { productId: "32", name: "Barra B" }]) }
  );
  assert.deepEqual(planCommercialActions(resolvedAmbiguousProduct), []);

  const resolvedUnsupported = resolveCommercialIntentPlan([{ type: "unsupported" }], { commercialContextSummary: {}, recentCatalogContext: null });
  assert.deepEqual(planCommercialActions(resolvedUnsupported), []);
});
