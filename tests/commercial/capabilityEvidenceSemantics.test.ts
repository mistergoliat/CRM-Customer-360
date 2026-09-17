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

// SALES-AGENT-R3-P7.3. set_shipping_destination previously declared no
// evidence relation (see the "without evidence relation" list below, which
// this task removes it from) - closing a real registry gap that blocked
// deriveInTurnEvidence.ts from ever correlating MISSING_DESTINATION with a
// completed set_shipping_destination call, the same way select_products/
// create_quote already do for their own reason codes.
test("set_shipping_destination declares evidenceProduced: COMMERCIAL_DESTINATION_STATE", () => {
  const definition = resolveCapabilityGatewayDefinition("set_shipping_destination");
  assert.deepEqual(definition?.evidenceProduced, ["COMMERCIAL_DESTINATION_STATE"]);
  assert.equal(definition?.evidenceRequired, undefined);
});

test("quote lifecycle capabilities declare their evidence and expose no email-sent claim", () => {
  assert.deepEqual(resolveCapabilityGatewayDefinition("issue_quote")?.evidenceProduced, ["QUOTE_ISSUED", "QUOTE_DOCUMENT_AVAILABLE"]);
  assert.deepEqual(resolveCapabilityGatewayDefinition("send_quote_email")?.evidenceProduced, ["QUOTE_EMAIL_DELIVERY_REQUESTED"]);
  assert.equal(resolveCapabilitiesProducingEvidence("QUOTE_ISSUED").includes("issue_quote"), true);
  assert.equal(resolveCapabilitiesProducingEvidence("QUOTE_EMAIL_DELIVERY_REQUESTED").includes("send_quote_email"), true);
  assert.equal((resolveCapabilityGatewayDefinition("send_quote_email")?.evidenceProduced ?? []).includes("EMAIL_SENT" as never), false);
});

test("evidence/operation-semantics fields stay fully optional - a capability with no evidence relation declares none", () => {
  // SALES-AGENT-R3-CAPABILITY-SEMANTICS-COMMERCIAL-POLICY-V1 narrowed this
  // test. useWhen/doNotUseWhen are no longer part of it: every
  // AGENT_LOOP_TOOL_POOL capability now declares both (asserted in
  // tests/commercial/capabilityCommercialPolicySemantics.test.ts), so
  // asserting their ABSENCE here would contradict that contract. What stays
  // asserted is the invariant that did not change: these five declare no
  // evidence relation and no operation semantics, proving the fields are
  // still optional rather than mandatory boilerplate.
  const withoutEvidenceRelation = ["batch_get_products", "search_company_knowledge", "calculate_shipping", "select_shipping_option"];
  for (const capability of withoutEvidenceRelation) {
    const definition = resolveCapabilityGatewayDefinition(capability);
    assert.ok(definition, `${capability} must still be registered`);
    assert.equal(definition?.evidenceProduced, undefined, `${capability} must not have gained evidenceProduced`);
    assert.equal(definition?.evidenceRequired, undefined, `${capability} must not have gained evidenceRequired`);
    assert.equal(definition?.operationSemantics, undefined, `${capability} must not have gained operationSemantics`);
  }
});

test("boundary prose stays structurally optional - batch_get_products is registered, internal, and declares none", () => {
  // The one registered capability that is deliberately never exposed to the
  // model (not in AGENT_LOOP_TOOL_POOL, no tool alias): proof that
  // useWhen/doNotUseWhen are a model-facing concern, not a Gateway
  // requirement every capability must satisfy.
  const definition = resolveCapabilityGatewayDefinition("batch_get_products");
  assert.ok(definition, "batch_get_products must still be registered");
  assert.equal(definition?.useWhen, undefined);
  assert.equal(definition?.doNotUseWhen, undefined);
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

test("resolveCapabilitiesProducingEvidence('COMMERCIAL_DESTINATION_STATE') returns exactly set_shipping_destination", () => {
  assert.deepEqual(resolveCapabilitiesProducingEvidence("COMMERCIAL_DESTINATION_STATE"), ["set_shipping_destination"]);
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
