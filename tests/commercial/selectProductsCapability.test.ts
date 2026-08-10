import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool } from "@/lib/db";
import { resolveCapabilityGatewayDefinition } from "@/lib/brain/commercial/capability-gateway/registry";
import { AGENT_LOOP_TOOL_POOL, buildToolDescriptions } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";
import { buildToolObservation } from "@/lib/brain/commercial/agent-loop/buildToolObservation";
import { SELECT_PRODUCTS_INPUT_SCHEMA } from "@/lib/brain/commercial/capability-gateway/selectProductsCapability";
import { getActiveCommercialLineItemsForOpportunity } from "@/lib/domains/commercial-line-items";
import type { CapabilityGatewayContext } from "@/lib/brain/commercial/capability-gateway/types";

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "main_management",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "main_management",
  DATABASE_USER: "crm_app",
  DATABASE_PASSWORD: "una_clave_local",
  DATABASE_URL: ""
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

function uniqueOpportunityId() {
  return 820000000 + Math.floor(Math.random() * 9999999);
}

function definition() {
  const def = resolveCapabilityGatewayDefinition("select_products");
  assert.ok(def, "select_products must be registered in the Capability Gateway");
  return def!;
}

test("registered in the Capability Gateway and exposed to the Native Agent Tool Loop with its input schema", () => {
  assert.ok(AGENT_LOOP_TOOL_POOL.includes("select_products"));
  const tool = buildToolDescriptions().find((t) => t.name === "select_products");
  assert.ok(tool);
  assert.deepEqual(tool!.inputSchema, SELECT_PRODUCTS_INPUT_SCHEMA);
  assert.equal(SELECT_PRODUCTS_INPUT_SCHEMA.additionalProperties, false);
  assert.equal(SELECT_PRODUCTS_INPUT_SCHEMA.properties.items.items.additionalProperties, false);
});

test("selected: persists and returns completed with the selection", async () => {
  const opportunityId = uniqueOpportunityId();
  const context: CapabilityGatewayContext = { correlationId: "corr-1", opportunityId };
  const outcome = await definition().execute({ items: [{ productId: "7", quantity: 2 }] }, context);

  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.data, { status: "selected", items: [{ productId: "7", combinationId: null, quantity: 2 }], changed: true });

  const rehydrated = await getActiveCommercialLineItemsForOpportunity(opportunityId);
  assert.deepEqual(rehydrated?.items, [{ productId: "7", combinationId: null, quantity: 2 }]);
});

test("combinationId is preserved when supplied", async () => {
  const opportunityId = uniqueOpportunityId();
  const context: CapabilityGatewayContext = { correlationId: "corr-2", opportunityId };
  const outcome = await definition().execute({ items: [{ productId: "13", combinationId: "5", quantity: 1 }] }, context);
  assert.equal(outcome.status, "completed");
  const data = outcome.data as { items: Array<{ combinationId: string | null }> };
  assert.equal(data.items[0].combinationId, "5");
});

test("a second call replaces the entire prior selection", async () => {
  const opportunityId = uniqueOpportunityId();
  await definition().execute({ items: [{ productId: "7", quantity: 1 }] }, { correlationId: "corr-3a", opportunityId });
  const outcome = await definition().execute({ items: [{ productId: "9", quantity: 2 }] }, { correlationId: "corr-3b", opportunityId });

  assert.equal(outcome.status, "completed");
  const rehydrated = await getActiveCommercialLineItemsForOpportunity(opportunityId);
  assert.deepEqual(
    rehydrated?.items.map((item) => item.productId),
    ["9"]
  );
});

test("invalid quantity (zero) is rejected before persistence", async () => {
  const opportunityId = uniqueOpportunityId();
  const context: CapabilityGatewayContext = { correlationId: "corr-4", opportunityId };
  const outcome = await definition().execute({ items: [{ productId: "7", quantity: 0 }] } as never, context);

  assert.equal(outcome.status, "invalid_arguments");
  assert.equal(outcome.data, null);
  assert.equal(await getActiveCommercialLineItemsForOpportunity(opportunityId), null);
});

test("empty items array is rejected", async () => {
  const context: CapabilityGatewayContext = { correlationId: "corr-5", opportunityId: uniqueOpportunityId() };
  const outcome = await definition().execute({ items: [] }, context);
  assert.equal(outcome.status, "invalid_arguments");
  assert.equal(outcome.errorCode, "items_required");
});

test("blank productId is rejected", async () => {
  const context: CapabilityGatewayContext = { correlationId: "corr-6", opportunityId: uniqueOpportunityId() };
  const outcome = await definition().execute({ items: [{ productId: "", quantity: 1 }] } as never, context);
  assert.equal(outcome.status, "invalid_arguments");
  assert.equal(outcome.errorCode, "items_required");
});

test("no active opportunity: denied, never persisted under an invented anchor", async () => {
  const context: CapabilityGatewayContext = { correlationId: "corr-7", opportunityId: null };
  const outcome = await definition().execute({ items: [{ productId: "7", quantity: 1 }] }, context);

  assert.equal(outcome.status, "denied");
  assert.equal(outcome.errorCode, "no_active_opportunity");
  assert.equal(outcome.data, null);
});

test("M: a fake communeId/price/carrier in the raw arguments is structurally impossible - the schema has no such properties", () => {
  const properties = SELECT_PRODUCTS_INPUT_SCHEMA.properties.items.items.properties as Record<string, unknown>;
  assert.equal(properties.price, undefined);
  assert.equal(properties.weightKg, undefined);
  assert.equal(properties.communeId, undefined);
  assert.equal(properties.carrier, undefined);
});

test("ToolObservation projection passes the selected outcome through to the model unchanged", async () => {
  const opportunityId = uniqueOpportunityId();
  const context: CapabilityGatewayContext = { correlationId: "corr-8", opportunityId };
  const outcome = await definition().execute({ items: [{ productId: "7", quantity: 2 }] }, context);

  const observation = buildToolObservation("select_products", {
    capability: "select_products",
    version: "capability-gateway.v1",
    availability: "available",
    status: outcome.status,
    data: outcome.data,
    errorCode: outcome.errorCode,
    retryable: outcome.retryable,
    evidence: outcome.evidence,
    warnings: [],
    retryCount: 0,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    executionPublicId: null
  });

  assert.equal(observation.status, "completed");
  assert.deepEqual(observation.data, { status: "selected", items: [{ productId: "7", combinationId: null, quantity: 2 }], changed: true });
});
