import assert from "node:assert/strict";
import test from "node:test";
import { CAPABILITY_GATEWAY_REGISTRY, resolveCapabilitiesProducingEvidence, resolveCapabilityGatewayDefinition } from "@/lib/brain/commercial/capability-gateway/registry";

// SALES-AGENT-R3-CAPABILITY-SEMANTICS-TR-B1-B2. Registry metadata tests:
// the 5 optional CapabilityGatewayDefinition fields this task adds
// (evidenceProduced/evidenceRequired/useWhen/doNotUseWhen/operationSemantics)
// are declared correctly for the capabilities this task's Section 2/5
// requires, and every other registered capability remains valid with none
// of them (fully optional, no capability is forced to declare anything).

test("search_products declares evidenceProduced: PRODUCT_IDENTITY only", () => {
  const definition = resolveCapabilityGatewayDefinition("search_products");
  assert.deepEqual(definition?.evidenceProduced, ["PRODUCT_IDENTITY"]);
  assert.equal(definition?.evidenceRequired, undefined);
});

test("get_product_details declares evidenceProduced: PRODUCT_IDENTITY and CURRENT_PRODUCT_DETAILS", () => {
  const definition = resolveCapabilityGatewayDefinition("get_product_details");
  assert.deepEqual(definition?.evidenceProduced, ["PRODUCT_IDENTITY", "CURRENT_PRODUCT_DETAILS"]);
});

test("explore_catalog declares evidenceProduced: PRODUCT_IDENTITY only", () => {
  const definition = resolveCapabilityGatewayDefinition("explore_catalog");
  assert.deepEqual(definition?.evidenceProduced, ["PRODUCT_IDENTITY"]);
});

test("recommend_catalog_products declares evidenceProduced: PRODUCT_IDENTITY (structural fact, never a recursive-source grant on its own)", () => {
  const definition = resolveCapabilityGatewayDefinition("recommend_catalog_products");
  assert.deepEqual(definition?.evidenceProduced, ["PRODUCT_IDENTITY"]);
});

test("select_products declares evidenceRequired: PRODUCT_IDENTITY, evidenceProduced: COMMERCIAL_SELECTION_STATE, operationSemantics: FULL_REPLACEMENT", () => {
  const definition = resolveCapabilityGatewayDefinition("select_products");
  assert.deepEqual(definition?.evidenceRequired, ["PRODUCT_IDENTITY"]);
  assert.deepEqual(definition?.evidenceProduced, ["COMMERCIAL_SELECTION_STATE"]);
  assert.equal(definition?.operationSemantics, "FULL_REPLACEMENT");
});

test("create_quote declares evidenceProduced: QUOTE_CREATED, operationSemantics: CREATE_SNAPSHOT", () => {
  const definition = resolveCapabilityGatewayDefinition("create_quote");
  assert.deepEqual(definition?.evidenceProduced, ["QUOTE_CREATED"]);
  assert.equal(definition?.operationSemantics, "CREATE_SNAPSHOT");
});

test("every registered capability that does not declare evidence/operation-semantics fields remains a valid definition (fully additive/optional)", () => {
  const untouched = ["batch_get_products", "search_company_knowledge", "set_shipping_destination", "calculate_shipping", "select_shipping_option"];
  for (const capability of untouched) {
    const definition = resolveCapabilityGatewayDefinition(capability);
    assert.ok(definition, `${capability} must still be registered`);
    assert.equal(definition?.evidenceProduced, undefined, `${capability} must not have gained evidenceProduced`);
    assert.equal(definition?.evidenceRequired, undefined, `${capability} must not have gained evidenceRequired`);
    assert.equal(definition?.operationSemantics, undefined, `${capability} must not have gained operationSemantics`);
    assert.equal(definition?.useWhen, undefined, `${capability} must not have gained useWhen`);
    assert.equal(definition?.doNotUseWhen, undefined, `${capability} must not have gained doNotUseWhen`);
  }
});

// Evidence producer classification tests: resolveCapabilitiesProducingEvidence
// is the single declared source consumed by resolveObservedRecommendationSourceProduct.ts/
// pendingCatalogAction.ts/recentCatalogContext.ts.

test("resolveCapabilitiesProducingEvidence('PRODUCT_IDENTITY') returns exactly the 5 catalog discovery capabilities, including recommend_catalog_products and search_products_by_semantics", () => {
  const producers = resolveCapabilitiesProducingEvidence("PRODUCT_IDENTITY");
  assert.deepEqual(
    new Set(producers),
    new Set(["search_products", "get_product_details", "explore_catalog", "recommend_catalog_products", "search_products_by_semantics"])
  );
});

test("resolveCapabilitiesProducingEvidence('COMMERCIAL_SELECTION_STATE') returns exactly select_products", () => {
  assert.deepEqual(resolveCapabilitiesProducingEvidence("COMMERCIAL_SELECTION_STATE"), ["select_products"]);
});

test("resolveCapabilitiesProducingEvidence('QUOTE_CREATED') returns exactly create_quote", () => {
  assert.deepEqual(resolveCapabilitiesProducingEvidence("QUOTE_CREATED"), ["create_quote"]);
});

test("resolveCapabilitiesProducingEvidence('SEMANTIC_ELIGIBILITY') returns exactly search_products_by_semantics (TR-B4's producer)", () => {
  assert.deepEqual(resolveCapabilitiesProducingEvidence("SEMANTIC_ELIGIBILITY"), ["search_products_by_semantics"]);
});

test("declaring evidenceProduced/evidenceRequired never changes governance, inputSchema, or execute() - additive fields only", () => {
  const definition = resolveCapabilityGatewayDefinition("select_products");
  assert.equal(definition?.governance.sideEffect, "mutating");
  assert.equal(definition?.governance.authority, "autonomous");
  assert.ok(definition?.inputSchema, "inputSchema must be unchanged/present");
});

test("CAPABILITY_GATEWAY_REGISTRY has no duplicate capability names (sanity: resolveCapabilitiesProducingEvidence never double-counts)", () => {
  const names = CAPABILITY_GATEWAY_REGISTRY.map((definition) => definition.capability);
  assert.deepEqual(names.length, new Set(names).size);
});
