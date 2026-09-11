import assert from "node:assert/strict";
import test from "node:test";
import {
  addBuilderChild,
  compileAudienceDefinition,
  createEmptyAffinityCondition,
  createEmptyAudienceBuilderState,
  createEmptyGroup,
  createEmptyScalarCondition,
  hashAudienceDefinition,
  isPlausibleAudienceDefinition,
  removeBuilderNode,
  updateBuilderNode,
  type AudienceCapabilitySchema,
  type AudienceBuilderState
} from "@/lib/marketing/customerIntelligenceAudience";

// Mirrors MS-pesaschile-customer-profile's GET /v1/customer-intelligence/audiences/schema
// (src/application/customer-intelligence-audience/schema.ts) - a small fixture, not the full
// ~30-field registry, since the compiler only needs field/operator/limit lookups.
const TEST_SCHEMA: AudienceCapabilitySchema = {
  capabilityVersion: "customer-intelligence-audience-capability-v1",
  schemaVersion: "customer-intelligence-audience-schema-v1",
  definitionVersion: "customer-intelligence-audience-definition-v1",
  fields: [
    { fieldId: "rfm.segmentCode", displayDescription: "RFM segment", scalarType: "string", component: "rfm", nullable: true, allowedOperators: ["EQ", "NEQ", "IN", "NOT_IN", "IS_NULL", "IS_NOT_NULL"] },
    { fieldId: "commercial.validOrders", displayDescription: "Valid orders", scalarType: "integer", component: "feature", nullable: false, allowedOperators: ["EQ", "NEQ", "IN", "NOT_IN", "GT", "GTE", "LT", "LTE", "BETWEEN", "IS_NULL", "IS_NOT_NULL"] },
    { fieldId: "commercial.totalSpentTaxIncl", displayDescription: "Total spent", scalarType: "decimal", component: "feature", nullable: false, allowedOperators: ["GT", "GTE", "LT", "LTE", "BETWEEN"], unit: "CLP" },
    { fieldId: "cluster.clusterId", displayDescription: "Cluster id", scalarType: "integer", component: "cluster", nullable: true, allowedOperators: ["EQ", "NEQ"] }
  ],
  specialConditions: { hasAffinity: { allowedAxes: ["PRODUCT_FAMILY", "DISCIPLINE", "USE_CONTEXT"] } },
  limits: { maxFilterDepth: 5, maxConditions: 20, maxInValues: 500, defaultPreviewLimit: 50, maxPreviewLimit: 100 }
};

test("a lone scalar condition compiles to a bare SCALAR root (no AND wrapper)", () => {
  const state = withScalar(createEmptyAudienceBuilderState(), { field: "commercial.validOrders", operator: "GT", value: "3" });
  const result = compileAudienceDefinition(state, TEST_SCHEMA);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.definition, {
      definitionVersion: "customer-intelligence-audience-definition-v1",
      root: { kind: "SCALAR", field: "commercial.validOrders", operator: "GT", value: 3 }
    });
  }
});

test("the validated HOME_GYM affinity example compiles exactly as observed operationally", () => {
  const state: AudienceBuilderState = { root: createEmptyGroup("AND", [{ ...createEmptyAffinityCondition(), axis: "USE_CONTEXT", code: "HOME_GYM", minScore: "0.30" }]) };
  const result = compileAudienceDefinition(state, TEST_SCHEMA);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.definition.root, { kind: "HAS_AFFINITY", axis: "USE_CONTEXT", code: "HOME_GYM", minScore: "0.30" });
  }
});

test("AND/OR groups with multiple conditions compile with a children array (not nodes)", () => {
  let state = createEmptyAudienceBuilderState();
  state = { root: { ...state.root, kind: "OR" } };
  state = withScalar(state, { field: "commercial.validOrders", operator: "GT", value: "3" });
  state = { root: addBuilderChild(state.root, state.root.id, { ...createEmptyScalarCondition(), field: "rfm.segmentCode", operator: "EQ", value: "champions" }) };

  const result = compileAudienceDefinition(state, TEST_SCHEMA);
  assert.equal(result.ok, true);
  if (result.ok && result.definition.root.kind === "OR") {
    assert.equal(result.definition.root.children.length, 2);
  } else {
    assert.fail("expected OR root with children");
  }
});

test("a negated group compiles to a NOT wrapper using 'child' (not 'node')", () => {
  let state = withScalar(createEmptyAudienceBuilderState(), { field: "commercial.validOrders", operator: "GT", value: "3" });
  state = { root: { ...state.root, negate: true } };
  const result = compileAudienceDefinition(state, TEST_SCHEMA);
  assert.equal(result.ok, true);
  if (result.ok && result.definition.root.kind === "NOT") {
    assert.deepEqual(result.definition.root.child, { kind: "SCALAR", field: "commercial.validOrders", operator: "GT", value: 3 });
  } else {
    assert.fail("expected NOT root");
  }
});

test("nested groups compile recursively", () => {
  const inner = createEmptyGroup("OR", [{ ...createEmptyScalarCondition(), field: "cluster.clusterId", operator: "EQ", value: "4" }]);
  const state: AudienceBuilderState = { root: createEmptyGroup("AND", [{ ...createEmptyScalarCondition(), field: "commercial.validOrders", operator: "GT", value: "3" }, inner]) };
  const result = compileAudienceDefinition(state, TEST_SCHEMA);
  assert.equal(result.ok, true);
  if (result.ok && result.definition.root.kind === "AND") {
    assert.equal(result.definition.root.children[1].kind, "SCALAR");
  }
});

test("NOT_IN compiles to an array value, mirroring IN", () => {
  const state = withScalar(createEmptyAudienceBuilderState(), { field: "rfm.segmentCode", operator: "NOT_IN", value: "champions, loyal" });
  const result = compileAudienceDefinition(state, TEST_SCHEMA);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.definition.root, { kind: "SCALAR", field: "rfm.segmentCode", operator: "NOT_IN", value: ["champions", "loyal"] });
});

test("BETWEEN compiles to a two-element array [min, max], not an object", () => {
  let state = withScalar(createEmptyAudienceBuilderState(), { field: "commercial.totalSpentTaxIncl", operator: "BETWEEN", value: "100" });
  state = { root: updateBuilderNode(state.root, state.root.children[0].id, (node) => (node.type === "SCALAR" ? { ...node, valueTo: "500" } : node)) };
  const result = compileAudienceDefinition(state, TEST_SCHEMA);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.definition.root, { kind: "SCALAR", field: "commercial.totalSpentTaxIncl", operator: "BETWEEN", value: [100, 500] });
});

test("an empty root group is rejected locally", () => {
  const state: AudienceBuilderState = { root: createEmptyGroup("AND", []) };
  const result = compileAudienceDefinition(state, TEST_SCHEMA);
  assert.equal(result.ok, false);
});

test("removing the only condition leaves an empty group that is rejected", () => {
  let state = withScalar(createEmptyAudienceBuilderState(), { field: "commercial.validOrders", operator: "GT", value: "3" });
  const conditionId = state.root.children[0].id;
  state = { root: removeBuilderNode(state.root, conditionId) };
  const result = compileAudienceDefinition(state, TEST_SCHEMA);
  assert.equal(result.ok, false);
});

test("an incomplete condition (missing operator) is rejected locally", () => {
  const state = withScalar(createEmptyAudienceBuilderState(), { field: "commercial.validOrders", operator: null, value: "3" });
  const result = compileAudienceDefinition(state, TEST_SCHEMA);
  assert.equal(result.ok, false);
});

test("an unsupported field/operator combination is rejected locally (cluster.clusterId has no BETWEEN)", () => {
  const state = withScalar(createEmptyAudienceBuilderState(), { field: "cluster.clusterId", operator: "BETWEEN", value: "1" });
  const result = compileAudienceDefinition(state, TEST_SCHEMA);
  assert.equal(result.ok, false);
});

test("IN beyond the schema-reported cap is rejected", () => {
  const many = Array.from({ length: TEST_SCHEMA.limits.maxInValues + 5 }, (_, index) => `v${index}`).join(",");
  const state = withScalar(createEmptyAudienceBuilderState(), { field: "rfm.segmentCode", operator: "IN", value: many });
  const result = compileAudienceDefinition(state, TEST_SCHEMA);
  assert.equal(result.ok, false);
});

test("an integer field rejects a non-integer value", () => {
  const state = withScalar(createEmptyAudienceBuilderState(), { field: "commercial.validOrders", operator: "GT", value: "3.5" });
  const result = compileAudienceDefinition(state, TEST_SCHEMA);
  assert.equal(result.ok, false);
});

test("a decimal field accepts a fractional value", () => {
  const state = withScalar(createEmptyAudienceBuilderState(), { field: "commercial.totalSpentTaxIncl", operator: "GT", value: "99.5" });
  const result = compileAudienceDefinition(state, TEST_SCHEMA);
  assert.equal(result.ok, true);
});

test("BETWEEN with an inverted range is rejected", () => {
  let state = withScalar(createEmptyAudienceBuilderState(), { field: "commercial.totalSpentTaxIncl", operator: "BETWEEN", value: "100" });
  state = { root: updateBuilderNode(state.root, state.root.children[0].id, (node) => (node.type === "SCALAR" ? { ...node, valueTo: "10" } : node)) };
  const result = compileAudienceDefinition(state, TEST_SCHEMA);
  assert.equal(result.ok, false);
});

test("an out-of-range minScore is rejected locally", () => {
  const state: AudienceBuilderState = { root: createEmptyGroup("AND", [{ ...createEmptyAffinityCondition(), axis: "USE_CONTEXT", code: "HOME_GYM", minScore: "1.5" }]) };
  const result = compileAudienceDefinition(state, TEST_SCHEMA);
  assert.equal(result.ok, false);
});

test("an affinity code is accepted as an opaque string (not forced to UPPER_SNAKE_CASE)", () => {
  const state: AudienceBuilderState = { root: createEmptyGroup("AND", [{ ...createEmptyAffinityCondition(), axis: "USE_CONTEXT", code: "home-gym-mixed_Case", minScore: "0.5" }]) };
  const result = compileAudienceDefinition(state, TEST_SCHEMA);
  assert.equal(result.ok, true);
  if (result.ok && result.definition.root.kind === "HAS_AFFINITY") assert.equal(result.definition.root.code, "home-gym-mixed_Case");
});

test("compilation is deterministic regardless of object construction order (checksum)", () => {
  const state = withScalar(createEmptyAudienceBuilderState(), { field: "commercial.validOrders", operator: "GT", value: "3" });
  const result = compileAudienceDefinition(state, TEST_SCHEMA);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const reordered = { root: result.definition.root, definitionVersion: result.definition.definitionVersion };
  assert.equal(hashAudienceDefinition(result.definition), hashAudienceDefinition(reordered as typeof result.definition));
});

test("isPlausibleAudienceDefinition accepts a real compiled definition and rejects malformed shapes", () => {
  const state: AudienceBuilderState = { root: createEmptyGroup("AND", [{ ...createEmptyAffinityCondition(), axis: "USE_CONTEXT", code: "HOME_GYM", minScore: "0.30" }]) };
  const result = compileAudienceDefinition(state, TEST_SCHEMA);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(isPlausibleAudienceDefinition(result.definition), true);
  assert.equal(isPlausibleAudienceDefinition({ ...result.definition, definitionVersion: "wrong-version" }), false);
  assert.equal(isPlausibleAudienceDefinition({ definitionVersion: result.definition.definitionVersion, root: { kind: "SCALAR" } }), false);
  assert.equal(isPlausibleAudienceDefinition({ definitionVersion: result.definition.definitionVersion, root: { kind: "AND", nodes: [] } }), false);
  assert.equal(isPlausibleAudienceDefinition(null), false);
});

function withScalar(
  state: AudienceBuilderState,
  overrides: { readonly field: string | null; readonly operator: string | null; readonly value: string }
): AudienceBuilderState {
  const conditionId = state.root.children[0]?.id;
  if (!conditionId) return { root: addBuilderChild(state.root, state.root.id, { ...createEmptyScalarCondition(), ...overrides } as never) };
  return { root: updateBuilderNode(state.root, conditionId, () => ({ ...createEmptyScalarCondition(), id: conditionId, ...overrides } as never)) };
}
