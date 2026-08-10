import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool } from "@/lib/db";
import { resolveCapabilityGatewayDefinition } from "@/lib/brain/commercial/capability-gateway/registry";
import { AGENT_LOOP_TOOL_POOL, buildToolDescriptions } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";
import { buildToolObservation } from "@/lib/brain/commercial/agent-loop/buildToolObservation";
import { SET_SHIPPING_DESTINATION_INPUT_SCHEMA, resetCommuneResolverForTests, setCommuneResolverForTests } from "@/lib/brain/commercial/capability-gateway/shippingDestinationCapability";
import { getActiveShippingDestinationForOpportunity } from "@/lib/domains/shipping-destination";
import { createCommuneResolver } from "@/lib/domains/commune-resolution";
import { comparisonKey } from "@/lib/domains/commune-resolution/normalize";
import type { CommuneCatalogEntry } from "@/lib/domains/commune-resolution/types";
import type { CommuneCatalogPort } from "@/lib/domains/commune-resolution/ports";
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

const REAL_ROWS: CommuneCatalogEntry[] = [
  { communeId: 99, canonicalName: "Ñuñoa" },
  { communeId: 86, canonicalName: "Santiago Centro" }
];

function fakeCatalog(entries: CommuneCatalogEntry[] = REAL_ROWS): CommuneCatalogPort {
  return {
    async findByNormalizedName(normalizedName) {
      return { ok: true, entries: entries.filter((entry) => comparisonKey(entry.canonicalName) === normalizedName) };
    }
  };
}

function erroringCatalog(): CommuneCatalogPort {
  return { async findByNormalizedName() { return { ok: false, reason: "timeout", detail: "pc_pos query timed out" }; } };
}

function uniqueOpportunityId() {
  return 810000000 + Math.floor(Math.random() * 99999999);
}

test.beforeEach(() => {
  setCommuneResolverForTests(createCommuneResolver(fakeCatalog()));
});
test.afterEach(() => {
  resetCommuneResolverForTests();
});

function definition() {
  const def = resolveCapabilityGatewayDefinition("set_shipping_destination");
  assert.ok(def, "set_shipping_destination must be registered in the Capability Gateway");
  return def!;
}

test("registered in the Capability Gateway and exposed to the Native Agent Tool Loop with its input schema", () => {
  assert.ok(AGENT_LOOP_TOOL_POOL.includes("set_shipping_destination"));
  const tool = buildToolDescriptions().find((t) => t.name === "set_shipping_destination");
  assert.ok(tool);
  assert.deepEqual(tool!.inputSchema, SET_SHIPPING_DESTINATION_INPUT_SCHEMA);
  // The agent can only ever supply free text - the schema has no communeId property and closes the object.
  assert.equal((SET_SHIPPING_DESTINATION_INPUT_SCHEMA.properties as Record<string, unknown>).communeId, undefined);
  assert.equal(SET_SHIPPING_DESTINATION_INPUT_SCHEMA.additionalProperties, false);
});

test("resolved: persists and returns completed with the resolved destination", async () => {
  const opportunityId = uniqueOpportunityId();
  const context: CapabilityGatewayContext = { correlationId: "corr-1", opportunityId };
  const outcome = await definition().execute({ destination: "Ñuñoa" }, context);

  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.data, { status: "resolved", destination: { communeId: 99, canonicalName: "Ñuñoa" }, persisted: true, changed: true });

  const rehydrated = await getActiveShippingDestinationForOpportunity(opportunityId);
  assert.equal(rehydrated?.communeId, 99);
});

test("N/E: a communeId supplied in the raw arguments is never trusted - the resolver's own catalog id always wins", async () => {
  const opportunityId = uniqueOpportunityId();
  const context: CapabilityGatewayContext = { correlationId: "corr-2", opportunityId };
  const outcome = await definition().execute({ destination: "Ñuñoa", communeId: 999999 } as never, context);

  assert.equal(outcome.status, "completed");
  const data = outcome.data as { destination: { communeId: number } };
  assert.equal(data.destination.communeId, 99);
});

test("needs_clarification: never persists, surfaces the clarification reason", async () => {
  const opportunityId = uniqueOpportunityId();
  const context: CapabilityGatewayContext = { correlationId: "corr-3", opportunityId };
  const outcome = await definition().execute({ destination: "Santiago" }, context);

  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.data, { status: "needs_clarification", input: "Santiago", reason: "city_or_conurbation_ambiguous" });
  assert.equal(await getActiveShippingDestinationForOpportunity(opportunityId), null);
});

test("not_found: never persists", async () => {
  const opportunityId = uniqueOpportunityId();
  const context: CapabilityGatewayContext = { correlationId: "corr-4", opportunityId };
  const outcome = await definition().execute({ destination: "asdfgh" }, context);

  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.data, { status: "not_found", input: "asdfgh" });
  assert.equal(await getActiveShippingDestinationForOpportunity(opportunityId), null);
});

test("empty destination is rejected before touching the resolver or persistence", async () => {
  const context: CapabilityGatewayContext = { correlationId: "corr-5", opportunityId: uniqueOpportunityId() };
  const outcome = await definition().execute({ destination: "   " }, context);

  assert.equal(outcome.status, "invalid_arguments");
  assert.equal(outcome.errorCode, "destination_required");
  assert.equal(outcome.data, null);
});

test("no active opportunity: denied, never persisted under an invented anchor", async () => {
  const context: CapabilityGatewayContext = { correlationId: "corr-6", opportunityId: null };
  const outcome = await definition().execute({ destination: "Ñuñoa" }, context);

  assert.equal(outcome.status, "denied");
  assert.equal(outcome.errorCode, "no_active_opportunity");
  assert.equal(outcome.data, null);
});

test("resolver technical failure: temporarily_blocked and retryable, never a false destination", async () => {
  setCommuneResolverForTests(createCommuneResolver(erroringCatalog()));
  const opportunityId = uniqueOpportunityId();
  const context: CapabilityGatewayContext = { correlationId: "corr-7", opportunityId };
  const outcome = await definition().execute({ destination: "Ñuñoa" }, context);

  assert.equal(outcome.status, "temporarily_blocked");
  assert.equal(outcome.errorCode, "timeout");
  assert.equal(outcome.retryable, true);
  assert.equal(await getActiveShippingDestinationForOpportunity(opportunityId), null);
});

test("ToolObservation projection passes the resolved outcome through to the model unchanged", async () => {
  const opportunityId = uniqueOpportunityId();
  const context: CapabilityGatewayContext = { correlationId: "corr-8", opportunityId };
  const outcome = await definition().execute({ destination: "Ñuñoa" }, context);

  const observation = buildToolObservation("set_shipping_destination", {
    capability: "set_shipping_destination",
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
  assert.deepEqual(observation.data, { status: "resolved", destination: { communeId: 99, canonicalName: "Ñuñoa" }, persisted: true, changed: true });
});
