import assert from "node:assert/strict";
import test from "node:test";
import { CAPABILITY_GATEWAY_REGISTRY } from "@/lib/brain/commercial/capability-gateway/registry";
import {
  AGENT_CAPABILITY_EXPOSURE_CLASSIFICATION,
  resolveAgentCapabilityExposure,
  listCapabilitiesByExposure
} from "@/lib/brain/commercial/agent-capability-exposure/types";
import { buildAgentToolCatalog } from "@/lib/brain/commercial/agent-capability-exposure/agentToolCatalog";
import { AGENT_LOOP_TOOL_POOL } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";
import { COMMERCIAL_ACTION_SUPPORTED_CAPABILITIES } from "@/lib/brain/commercial/commercial-action-request/actionCapabilityMapping";

/**
 * SALES-AGENT-R3-A04. Tests for the canonical R3 exposure classification -
 * the single source answering "may an agent see/use this capability, and
 * through which surface?" (agent-capability-exposure/types.ts).
 */

// ---------------------------------------------------------------------------
// [1] every registered capability is classified exactly once, exhaustively
// ---------------------------------------------------------------------------

test("every capability registered in the Capability Gateway has exactly one R3 classification, no gaps, no stale entries", () => {
  const registeredNames = new Set(CAPABILITY_GATEWAY_REGISTRY.map((definition) => definition.capability));
  const classifiedNames = new Set(Object.keys(AGENT_CAPABILITY_EXPOSURE_CLASSIFICATION));

  for (const name of registeredNames) {
    assert.ok(classifiedNames.has(name), `capability "${name}" is registered but has no R3 exposure classification`);
  }
  for (const name of classifiedNames) {
    assert.ok(registeredNames.has(name), `"${name}" has an R3 classification but is not a registered Capability Gateway capability (stale entry)`);
  }
});

// ---------------------------------------------------------------------------
// [2][3] structurally disjoint surfaces
// ---------------------------------------------------------------------------

test("READ_TOOL and COMMERCIAL_ACTION capability sets are disjoint", () => {
  const readTools = new Set(listCapabilitiesByExposure("READ_TOOL"));
  const actions = new Set(listCapabilitiesByExposure("COMMERCIAL_ACTION"));
  const intersection = [...readTools].filter((name) => actions.has(name));
  assert.deepEqual(intersection, []);
});

test("every capability mapped by CommercialActionRequest is classified COMMERCIAL_ACTION, and nothing else is", () => {
  for (const capability of COMMERCIAL_ACTION_SUPPORTED_CAPABILITIES) {
    assert.equal(resolveAgentCapabilityExposure(capability), "COMMERCIAL_ACTION", `${capability} is mapped by CommercialActionRequest but not classified COMMERCIAL_ACTION`);
  }
  const classifiedActions = new Set(listCapabilitiesByExposure("COMMERCIAL_ACTION"));
  assert.equal(classifiedActions.size, COMMERCIAL_ACTION_SUPPORTED_CAPABILITIES.size, "COMMERCIAL_ACTION classification must exactly equal the CommercialActionRequest-supported set");
});

// ---------------------------------------------------------------------------
// [4] unknown capability fails closed
// ---------------------------------------------------------------------------

test("an unregistered/unknown capability name defaults to NOT_AGENT_EXPOSED", () => {
  assert.equal(resolveAgentCapabilityExposure("totally_made_up_capability"), "NOT_AGENT_EXPOSED");
  assert.equal(resolveAgentCapabilityExposure(""), "NOT_AGENT_EXPOSED");
});

// ---------------------------------------------------------------------------
// [8][9][10][11] SALES-AGENT-R3-A03's four mutating actions
// ---------------------------------------------------------------------------

test("SELECT_PRODUCTS/SET_SHIPPING_DESTINATION/SELECT_SHIPPING_OPTION/CREATE_QUOTE capabilities are classified COMMERCIAL_ACTION", () => {
  assert.equal(resolveAgentCapabilityExposure("select_products"), "COMMERCIAL_ACTION");
  assert.equal(resolveAgentCapabilityExposure("set_shipping_destination"), "COMMERCIAL_ACTION");
  assert.equal(resolveAgentCapabilityExposure("select_shipping_option"), "COMMERCIAL_ACTION");
  assert.equal(resolveAgentCapabilityExposure("create_quote"), "COMMERCIAL_ACTION");
});

// ---------------------------------------------------------------------------
// [12][13][14][15] the six live read tools
// ---------------------------------------------------------------------------

test("search_products/get_product_details/explore_catalog/search_company_knowledge classification", () => {
  assert.equal(resolveAgentCapabilityExposure("search_products"), "READ_TOOL");
  assert.equal(resolveAgentCapabilityExposure("get_product_details"), "READ_TOOL");
  assert.equal(resolveAgentCapabilityExposure("explore_catalog"), "READ_TOOL");
  assert.equal(resolveAgentCapabilityExposure("search_company_knowledge"), "READ_TOOL");
});

test("recommend_catalog_products classification (Phase 10 decision: READ_TOOL, preserves current ATL behavior/evidence gating unchanged)", () => {
  assert.equal(resolveAgentCapabilityExposure("recommend_catalog_products"), "READ_TOOL");
});

test("calculate_shipping classification (Phase 8 decision: READ_TOOL, backed by governance.sideEffect=read_only and no persistence in its own execute())", () => {
  assert.equal(resolveAgentCapabilityExposure("calculate_shipping"), "READ_TOOL");
});

// ---------------------------------------------------------------------------
// [18][19] customer history / recommendation signal
// ---------------------------------------------------------------------------

test("get_customer_purchase_history / get_customer_recommendation_signal classification (Phase 9 decision: NOT_AGENT_EXPOSED - never aliased in AGENT_LOOP_TOOL_POOL, CommercialWork-only)", () => {
  assert.equal(resolveAgentCapabilityExposure("get_customer_purchase_history"), "NOT_AGENT_EXPOSED");
  assert.equal(resolveAgentCapabilityExposure("get_customer_recommendation_signal"), "NOT_AGENT_EXPOSED");
});

test("batch_get_products and every identity capability are NOT_AGENT_EXPOSED", () => {
  assert.equal(resolveAgentCapabilityExposure("batch_get_products"), "NOT_AGENT_EXPOSED");
  assert.equal(resolveAgentCapabilityExposure("resolve_customer"), "NOT_AGENT_EXPOSED");
  assert.equal(resolveAgentCapabilityExposure("create_customer"), "NOT_AGENT_EXPOSED");
  assert.equal(resolveAgentCapabilityExposure("link_external_identity"), "NOT_AGENT_EXPOSED");
  assert.equal(resolveAgentCapabilityExposure("link_prestashop_identity"), "NOT_AGENT_EXPOSED");
});

// ---------------------------------------------------------------------------
// every AGENT_LOOP_TOOL_POOL entry is classified READ_TOOL or COMMERCIAL_ACTION,
// never NOT_AGENT_EXPOSED (a pool addition without a classification entry
// must fail a test, not silently reach the Gateway)
// ---------------------------------------------------------------------------

test("every capability in AGENT_LOOP_TOOL_POOL is classified READ_TOOL or COMMERCIAL_ACTION, never NOT_AGENT_EXPOSED", () => {
  for (const tool of AGENT_LOOP_TOOL_POOL) {
    const exposure = resolveAgentCapabilityExposure(tool);
    assert.notEqual(exposure, "NOT_AGENT_EXPOSED", `${tool} is in AGENT_LOOP_TOOL_POOL but classified NOT_AGENT_EXPOSED`);
  }
});

// ---------------------------------------------------------------------------
// [29] provider-neutral catalog contains no internal-only capability
// ---------------------------------------------------------------------------

test("AgentToolCatalog.readTools contains exactly the READ_TOOL subset of AGENT_LOOP_TOOL_POOL, no internal-only capability", () => {
  const catalog = buildAgentToolCatalog();
  const readToolNames: string[] = catalog.readTools.map((tool) => tool.name).sort();
  // Widened to string[] explicitly: assert.deepEqual (node:assert/strict ->
  // deepStrictEqual<T>) has an assertion signature `asserts actual is T`
  // that narrows readToolNames to whatever T infers as - leaving `expected`
  // as AgentLoopToolName[] would silently narrow readToolNames to that
  // literal union for the rest of this test, breaking later plain-string
  // membership checks below (verified via isolated bisection).
  const expected: string[] = AGENT_LOOP_TOOL_POOL.filter((tool) => resolveAgentCapabilityExposure(tool) === "READ_TOOL")
    .slice()
    .sort();
  assert.deepEqual(readToolNames, expected);

  const internalOnlyCapabilities = new Set(["batch_get_products", "get_customer_purchase_history", "get_customer_recommendation_signal", "resolve_customer", "create_customer"]);
  for (const internalOnly of internalOnlyCapabilities) {
    assert.ok(!readToolNames.includes(internalOnly), `${internalOnly} must never appear in the agent-facing read tool catalog`);
  }
});

test("AgentToolCatalog.commercialActions contains exactly the four R3-A03 actions, each with its real capability's inputSchema", () => {
  const catalog = buildAgentToolCatalog();
  assert.deepEqual(
    catalog.commercialActions.map((action) => action.actionType).sort(),
    ["CREATE_QUOTE", "SELECT_PRODUCTS", "SELECT_SHIPPING_OPTION", "SET_SHIPPING_DESTINATION"]
  );
  const selectProducts = catalog.commercialActions.find((action) => action.actionType === "SELECT_PRODUCTS");
  assert.equal(selectProducts?.capability, "select_products");
  assert.ok(selectProducts?.inputSchema, "commercial action descriptors must carry the capability's own real input schema");
});
