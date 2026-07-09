import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPABILITY_GATEWAY_REGISTRY,
  resolveCapabilityGatewayDefinition,
  resolveCapabilityGovernance,
  resolveCapabilityNameForSalesAgentTool,
  resolveSalesAgentToolForCapabilityName,
  listAliasedSalesAgentToolNames
} from "@/lib/brain/commercial/capability-gateway";

// ACS-R1-04-T06, contract section 15: registration of resolve_customer /
// create_customer / link_external_identity via the same governed Capability
// Gateway every other capability uses, and section 22: record_customer_interest
// stays unregistered (no operational persistence yet).

test("49: resolve_customer, create_customer and link_external_identity are all registered under their canonical snake_case names", () => {
  const names = CAPABILITY_GATEWAY_REGISTRY.map((d) => d.capability);
  assert.ok(names.includes("resolve_customer"));
  assert.ok(names.includes("create_customer"));
  assert.ok(names.includes("link_external_identity"));
});

test("50: record_customer_interest is never registered in the Capability Gateway - no operational persistence exists yet", () => {
  const names = CAPABILITY_GATEWAY_REGISTRY.map((d) => d.capability);
  assert.ok(!names.includes("record_customer_interest"));
  assert.equal(resolveCapabilityGatewayDefinition("record_customer_interest"), null);
});

test("51: governance metadata matches the documented table for all three identity capabilities", () => {
  assert.deepEqual(resolveCapabilityGovernance("resolve_customer"), { sideEffect: "read_only", authority: "autonomous", riskClass: "low" });
  const create = resolveCapabilityGovernance("create_customer");
  assert.equal(create?.sideEffect, "mutating");
  assert.equal(create?.riskClass, "medium");
  const link = resolveCapabilityGovernance("link_external_identity");
  assert.equal(link?.sideEffect, "mutating");
  assert.equal(link?.riskClass, "medium");
});

test("52: createCustomer and linkExternalIdentity have sales-agent tool aliases; resolve_customer has none - it is never a proposable LLM tool", () => {
  assert.equal(resolveCapabilityNameForSalesAgentTool("createCustomer"), "create_customer");
  assert.equal(resolveCapabilityNameForSalesAgentTool("linkExternalIdentity"), "link_external_identity");
  assert.equal(resolveSalesAgentToolForCapabilityName("resolve_customer"), null);
});

test("53: resolveCapabilityGatewayDefinition resolves all three canonical names and rejects unregistered/ad-hoc names", () => {
  assert.ok(resolveCapabilityGatewayDefinition("resolve_customer"));
  assert.ok(resolveCapabilityGatewayDefinition("create_customer"));
  assert.ok(resolveCapabilityGatewayDefinition("link_external_identity"));
  assert.equal(resolveCapabilityGatewayDefinition("resolveCustomer"), null, "camelCase is not a capability name");
  assert.equal(resolveCapabilityGatewayDefinition("create_customer_v2"), null, "no ad-hoc alias outside the canonical table");
});

test("54: the aliased sales-agent tool list includes createCustomer/linkExternalIdentity but no resolve_customer stand-in", () => {
  const tools = listAliasedSalesAgentToolNames();
  assert.ok(tools.includes("createCustomer"));
  assert.ok(tools.includes("linkExternalIdentity"));
  assert.ok(!tools.some((tool) => tool.toLowerCase().includes("resolvecustomer")));
});

test("55: tool <-> capability alias round-trips for createCustomer/linkExternalIdentity, through the single centralized table only", () => {
  assert.equal(resolveSalesAgentToolForCapabilityName(resolveCapabilityNameForSalesAgentTool("createCustomer") as string), "createCustomer");
  assert.equal(resolveSalesAgentToolForCapabilityName(resolveCapabilityNameForSalesAgentTool("linkExternalIdentity") as string), "linkExternalIdentity");
});

test("56: all three identity capabilities set maxRetries to 0 - the Gateway is the sole retry owner (contract section 17)", () => {
  for (const name of ["resolve_customer", "create_customer", "link_external_identity"]) {
    const definition = resolveCapabilityGatewayDefinition(name);
    assert.equal(definition?.maxRetries, 0, name);
  }
});
