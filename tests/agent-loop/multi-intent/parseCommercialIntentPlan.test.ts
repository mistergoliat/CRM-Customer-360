import assert from "node:assert/strict";
import test from "node:test";
import { parseCommercialIntentPlan, parseCommercialIntent } from "@/lib/brain/commercial/multi-intent/parseCommercialIntentPlan";

test("[MI-Parse-1] a well-formed plan with both known intent types parses cleanly", () => {
  const result = parseCommercialIntentPlan({
    intents: [
      { type: "select_products", productReference: "Classic", quantity: 2 },
      { type: "get_shipping_quote", destination: "Ñuñoa" }
    ]
  });
  assert.equal(result.status, "valid");
  if (result.status !== "valid") return;
  assert.deepEqual(result.intents, [
    { type: "select_products", productReference: "Classic", quantity: 2 },
    { type: "get_shipping_quote", destination: "Ñuñoa" }
  ]);
  assert.deepEqual(result.droppedDuplicateTypes, []);
});

// Part 21 test 8: unknown intent -> unsupported, never invented as a known type.
test("[MI-Parse-2] an unrecognized intent type degrades to unsupported, never mapped to a known capability", () => {
  const result = parseCommercialIntentPlan({ intents: [{ type: "reserve_for_someone_else", note: "hold it for my brother" }] });
  assert.equal(result.status, "valid");
  if (result.status !== "valid") return;
  assert.equal(result.intents.length, 1);
  assert.equal(result.intents[0].type, "unsupported");
});

test("[MI-Parse-3] a non-object intent entry degrades to unsupported instead of throwing or dropping the whole plan", () => {
  const result = parseCommercialIntentPlan({ intents: ["quiero una barra", null, 42] });
  assert.equal(result.status, "valid");
  if (result.status !== "valid") return;
  assert.equal(result.intents.length, 3);
  assert.ok(result.intents.every((intent) => intent.type === "unsupported"));
});

// Part 21 test 9: malformed planner output (root shape) is a genuine parse failure - the orchestrator is responsible for the repair-once/fail-closed policy on top of this.
test("[MI-Parse-4] a root that is not an object is invalid", () => {
  assert.equal(parseCommercialIntentPlan("not json").status, "invalid");
  assert.equal(parseCommercialIntentPlan(null).status, "invalid");
  assert.equal(parseCommercialIntentPlan(["intents"]).status, "invalid");
});

test("[MI-Parse-5] a missing or empty intents array is invalid", () => {
  assert.equal(parseCommercialIntentPlan({}).status, "invalid");
  assert.equal(parseCommercialIntentPlan({ intents: [] }).status, "invalid");
  assert.equal(parseCommercialIntentPlan({ intents: "select_products" }).status, "invalid");
});

// Part 21 test 10: duplicate intents - first occurrence of a known type wins, the rest are dropped observably.
test("[MI-Parse-6] a duplicate known-type intent is dropped, keeping only the first occurrence", () => {
  const result = parseCommercialIntentPlan({
    intents: [
      { type: "select_products", productReference: "Classic", quantity: 1 },
      { type: "select_products", productReference: "Pro", quantity: 5 }
    ]
  });
  assert.equal(result.status, "valid");
  if (result.status !== "valid") return;
  assert.equal(result.intents.length, 1);
  assert.equal((result.intents[0] as { productReference?: string }).productReference, "Classic");
  assert.deepEqual(result.droppedDuplicateTypes, ["select_products"]);
});

test("[MI-Parse-7] multiple unsupported intents are never deduped - each may describe a different unmet request", () => {
  const result = parseCommercialIntentPlan({ intents: [{ type: "unsupported", description: "a" }, { type: "unsupported", description: "b" }] });
  assert.equal(result.status, "valid");
  if (result.status !== "valid") return;
  assert.equal(result.intents.length, 2);
});

test("[MI-Parse-8] bounded fields: an oversized quantity/text is rejected as that field, never crashes or grows unbounded", () => {
  const hugeText = "x".repeat(10000);
  const result = parseCommercialIntentPlan({ intents: [{ type: "select_products", productReference: hugeText, quantity: 999999 }] });
  assert.equal(result.status, "valid");
  if (result.status !== "valid") return;
  const intent = result.intents[0] as { productReference?: string; quantity?: number };
  assert.ok((intent.productReference?.length ?? 0) <= 200);
  assert.equal(intent.quantity, undefined, "an out-of-range quantity is dropped, never silently clamped to a fabricated value");
});

test("[MI-Parse-9] more intents than the plan bound are truncated, never processed unbounded", () => {
  const intents = Array.from({ length: 20 }, () => ({ type: "unsupported" }));
  const result = parseCommercialIntentPlan({ intents });
  assert.equal(result.status, "valid");
  if (result.status !== "valid") return;
  assert.ok(result.intents.length <= 6);
});

// SALES-AGENT-R2-A08.7, Part 15. Deterministic coverage for the typed cancel
// scope contract itself - whole work, single scope, multi-scope, and the
// fail-closed defaults for malformed input.

test("[MI-Parse-11] cancel with scope 'all' parses cleanly and carries no additionalScopes", () => {
  const result = parseCommercialIntentPlan({ intents: [{ type: "cancel", scope: "all" }] });
  assert.equal(result.status, "valid");
  if (result.status !== "valid") return;
  assert.deepEqual(result.intents, [{ type: "cancel", scope: "all" }]);
});

test("[MI-Parse-12] cancel with a single named scope (shipping/quote) parses cleanly", () => {
  const result = parseCommercialIntentPlan({ intents: [{ type: "cancel", scope: "shipping" }] });
  assert.equal(result.status, "valid");
  if (result.status !== "valid") return;
  assert.deepEqual(result.intents, [{ type: "cancel", scope: "shipping" }]);
});

test("[MI-Parse-13] cancel with additionalScopes parses a multi-scope cancellation, deduped and 'all'-free", () => {
  const result = parseCommercialIntentPlan({
    intents: [{ type: "cancel", scope: "shipping", additionalScopes: ["quote", "shipping", "all", "shipping"] }]
  });
  assert.equal(result.status, "valid");
  if (result.status !== "valid") return;
  assert.deepEqual(result.intents, [{ type: "cancel", scope: "shipping", additionalScopes: ["quote"] }]);
});

test("[MI-Parse-14] cancel with an unrecognized scope degrades to unsupported, never defaults to 'all'", () => {
  const result = parseCommercialIntentPlan({ intents: [{ type: "cancel", scope: "everything_please" }] });
  assert.equal(result.status, "valid");
  if (result.status !== "valid") return;
  assert.equal(result.intents[0].type, "unsupported");
});

test("[MI-Parse-15] cancel with additionalScopes but no other valid entries omits the field entirely", () => {
  const result = parseCommercialIntentPlan({ intents: [{ type: "cancel", scope: "quote", additionalScopes: ["all", "quote", "not_a_scope"] }] });
  assert.equal(result.status, "valid");
  if (result.status !== "valid") return;
  assert.deepEqual(result.intents, [{ type: "cancel", scope: "quote" }]);
});

test("[MI-Parse-10] parseCommercialIntent (single-intent parser reused by pendingIntentState) matches the same rules", () => {
  assert.deepEqual(parseCommercialIntent({ type: "get_shipping_quote", destination: "Las Condes" }), { type: "get_shipping_quote", destination: "Las Condes" });
  assert.equal(parseCommercialIntent({ type: "unknown_thing" }).type, "unsupported");
});

// SALES-AGENT-R2-A11.4.
test("[MI-Parse-16] select_shipping_option parses the customer's raw reference text, never a number", () => {
  const result = parseCommercialIntentPlan({ intents: [{ type: "select_shipping_option", optionReference: "la segunda" }] });
  assert.equal(result.status, "valid");
  if (result.status !== "valid") return;
  assert.deepEqual(result.intents, [{ type: "select_shipping_option", optionReference: "la segunda" }]);
});

test("[MI-Parse-17] select_shipping_option with a numeric optionReference is coerced to unsupported (not a string), never trusted as an index", () => {
  const result = parseCommercialIntentPlan({ intents: [{ type: "select_shipping_option", optionReference: 1 }] });
  assert.equal(result.status, "valid");
  if (result.status !== "valid") return;
  assert.deepEqual(result.intents, [{ type: "select_shipping_option" }]);
});

test("[MI-Parse-18] select_shipping_option with no optionReference at all still parses, field omitted", () => {
  const result = parseCommercialIntentPlan({ intents: [{ type: "select_shipping_option" }] });
  assert.equal(result.status, "valid");
  if (result.status !== "valid") return;
  assert.deepEqual(result.intents, [{ type: "select_shipping_option" }]);
});

// SALES-AGENT-R2-ID-R2-A11.
test("[MI-Parse-19] repeat_purchase with a productHint parses cleanly", () => {
  const result = parseCommercialIntentPlan({ intents: [{ type: "repeat_purchase", productHint: "discos" }] });
  assert.equal(result.status, "valid");
  if (result.status !== "valid") return;
  assert.deepEqual(result.intents, [{ type: "repeat_purchase", productHint: "discos" }]);
});

test("[MI-Parse-20] repeat_purchase with no productHint parses cleanly, field omitted (never invented)", () => {
  const result = parseCommercialIntentPlan({ intents: [{ type: "repeat_purchase" }] });
  assert.equal(result.status, "valid");
  if (result.status !== "valid") return;
  assert.deepEqual(result.intents, [{ type: "repeat_purchase" }]);
});

test("[MI-Parse-21] repeat_purchase never carries a productId/customerId even if the raw JSON tries to smuggle one in - only productHint is ever read", () => {
  const result = parseCommercialIntentPlan({ intents: [{ type: "repeat_purchase", productHint: "barra", productId: "999", customerId: "100" }] });
  assert.equal(result.status, "valid");
  if (result.status !== "valid") return;
  assert.deepEqual(result.intents, [{ type: "repeat_purchase", productHint: "barra" }]);
});

// SALES-AGENT-R2-ID-R2-A12.

test("[MI-Parse-22] customer_aware_recommendation with a queryHint parses cleanly", () => {
  const result = parseCommercialIntentPlan({ intents: [{ type: "customer_aware_recommendation", queryHint: "economico para entrenar" }] });
  assert.equal(result.status, "valid");
  if (result.status !== "valid") return;
  assert.deepEqual(result.intents, [{ type: "customer_aware_recommendation", queryHint: "economico para entrenar" }]);
});

test("[MI-Parse-23] customer_aware_recommendation with no queryHint parses cleanly, field omitted (never invented)", () => {
  const result = parseCommercialIntentPlan({ intents: [{ type: "customer_aware_recommendation" }] });
  assert.equal(result.status, "valid");
  if (result.status !== "valid") return;
  assert.deepEqual(result.intents, [{ type: "customer_aware_recommendation" }]);
});

test("[MI-Parse-24] customer_aware_recommendation never carries a productId/customerId even if the raw JSON tries to smuggle one in - only queryHint is ever read", () => {
  const result = parseCommercialIntentPlan({ intents: [{ type: "customer_aware_recommendation", queryHint: "discos", productId: "999", customerId: "100" }] });
  assert.equal(result.status, "valid");
  if (result.status !== "valid") return;
  assert.deepEqual(result.intents, [{ type: "customer_aware_recommendation", queryHint: "discos" }]);
});

test("[MI-Parse-25] CAR15: a repeat_purchase-shaped plan still parses as repeat_purchase, never blurred with customer_aware_recommendation", () => {
  const result = parseCommercialIntentPlan({ intents: [{ type: "repeat_purchase" }] });
  assert.equal(result.status, "valid");
  if (result.status !== "valid") return;
  assert.deepEqual(result.intents, [{ type: "repeat_purchase" }]);
});
