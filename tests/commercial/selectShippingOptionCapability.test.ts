import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, queryRows, safeExecute, safeQueryRows } from "@/lib/db";
import { resolveCapabilityGatewayDefinition } from "@/lib/brain/commercial/capability-gateway/registry";
import { AGENT_LOOP_TOOL_POOL, buildToolDescriptions } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";
import { SELECT_SHIPPING_OPTION_INPUT_SCHEMA } from "@/lib/brain/commercial/capability-gateway/selectShippingOptionCapability";
import { insertCapabilityExecution } from "@/lib/brain/commercial/capability-gateway/repository";
import { getActiveSelectedShippingOptionForOpportunity } from "@/lib/domains/selected-shipping-option";
import { buildSelectedShippingOptionRequestAnchor, SELECTED_SHIPPING_OPTION_FACT_KEY } from "@/lib/domains/selected-shipping-option/constants";
import { setCommercialLineItemsForOpportunity } from "@/lib/domains/commercial-line-items";
import { setShippingDestinationForOpportunity } from "@/lib/domains/shipping-destination";
import type { CommuneResolver } from "@/lib/domains/commune-resolution";
import type { CapabilityGatewayContext } from "@/lib/brain/commercial/capability-gateway/types";

/**
 * SALES-AGENT-R1-T2.1 (+ SALES-AGENT-R1-T2.1.1 staleness tests). Capability-
 * level tests for select_shipping_option - requires a live DB
 * (crm_capability_executions.opportunity_id/conversation_id carry real FKs to
 * crm_opportunities/conversation, unlike commercial_line_items/
 * shipping_destination's anchor-string facts), same environment dependency
 * already accepted by calculateShippingCapability.test.ts/
 * shippingDestinationCapability.test.ts - not runnable in this sandbox
 * (no MariaDB), verified via typecheck only.
 */

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

function uniqueSuffix() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function seedOpportunity(): Promise<number> {
  const key = `sales-agent-r1-t2-1-${uniqueSuffix()}`;
  await safeExecute(
    `INSERT INTO crm_opportunities (opportunity_key, requirements_json, missing_requirements_json, product_interests_json, objections_json, signals_json)
     VALUES (?, '{}', '[]', '[]', '[]', '[]')`,
    [key]
  );
  const rows = await queryRows<{ id: number }>(`SELECT id FROM crm_opportunities WHERE opportunity_key = ? LIMIT 1`, [key]);
  return rows[0].id;
}

async function seedConversation(): Promise<number> {
  const externalContactId = `t2-1-${uniqueSuffix()}`;
  await safeExecute(
    `INSERT INTO conversation (public_id, channel, provider, channel_account_id, external_contact_id) VALUES (UUID(), 'whatsapp', 'meta', ?, ?)`,
    ["t2-1-test-channel", externalContactId]
  );
  const rows = await queryRows<{ id: number }>(`SELECT id FROM conversation WHERE external_contact_id = ? LIMIT 1`, [externalContactId]);
  return rows[0].id;
}

type SeedOption = { carrierName: string; serviceType: string; totalCost: number; estimatedDelivery: string };

/**
 * SALES-AGENT-R1-T2.1.1. Real freshness anchors, not the fixed placeholder
 * strings T2.1 used - checkShippingEvidenceFreshness now compares
 * calculate_shipping's stored selectionFactId/destinationFactId against the
 * opportunity's ACTUAL current commercial_line_items/shipping_destination
 * facts, so a test must seed real facts and thread their real (DB-generated)
 * factIds through, or every existing "fresh" test would start failing closed.
 */
function fakeCommuneResolver(communeId: number, canonicalName: string): CommuneResolver {
  return { async resolve() { return { status: "resolved", communeId, canonicalName, matchedVia: "direct" }; } };
}

async function seedFreshFacts(opportunityId: number): Promise<{ selectionFactId: string; destinationFactId: string }> {
  const lineItems = await setCommercialLineItemsForOpportunity({
    opportunityId,
    items: [{ productId: "545", combinationId: null, quantity: 2 }]
  });
  assert.equal(lineItems.ok, true);
  if (!lineItems.ok) throw new Error("seedFreshFacts: commercial_line_items seed failed");

  const destination = await setShippingDestinationForOpportunity({ opportunityId, inputText: "Ñuñoa" }, { resolver: fakeCommuneResolver(99, "Ñuñoa") });
  assert.equal(destination.ok, true);
  if (!destination.ok) throw new Error("seedFreshFacts: shipping_destination seed failed");

  return { selectionFactId: lineItems.selection.factId, destinationFactId: destination.destination.factId };
}

async function seedCompletedCalculateShipping(
  opportunityId: number,
  conversationId: number,
  options: SeedOption[],
  factIds: { selectionFactId: string; destinationFactId: string }
) {
  const now = new Date().toISOString();
  const result = await insertCapabilityExecution({
    correlationId: `corr-${uniqueSuffix()}`,
    capabilityName: "calculate_shipping",
    capabilityVersion: "capability-gateway.v1",
    availabilityStatus: "available",
    executionStatus: "completed",
    retryCount: 0,
    retryable: false,
    errorCode: null,
    requestSummary: {},
    responseSummary: {
      status: "available",
      options: options.map((option, index) => ({ index, ...option })),
      selectionFactId: factIds.selectionFactId,
      destinationFactId: factIds.destinationFactId
    },
    evidence: [],
    opportunityId,
    conversationId,
    startedAt: now,
    completedAt: now
  });
  assert.equal(result.ok, true, result.error ?? undefined);
  return result.publicId!;
}

function definition() {
  const def = resolveCapabilityGatewayDefinition("select_shipping_option");
  assert.ok(def, "select_shipping_option must be registered in the Capability Gateway");
  return def!;
}

const TWO_OPTIONS: SeedOption[] = [
  { carrierName: "Chilexpress", serviceType: "standard", totalCost: 4990, estimatedDelivery: "3-5 dias habiles" },
  { carrierName: "Starken", serviceType: "express", totalCost: 6990, estimatedDelivery: "1-2 dias habiles" }
];

test("registered in the Capability Gateway and exposed to the Native Agent Tool Loop; schema structurally cannot carry carrier/price", () => {
  assert.ok(AGENT_LOOP_TOOL_POOL.includes("select_shipping_option"));
  const tool = buildToolDescriptions().find((t) => t.name === "select_shipping_option");
  assert.ok(tool);
  assert.deepEqual(tool!.inputSchema, SELECT_SHIPPING_OPTION_INPUT_SCHEMA);

  const properties = SELECT_SHIPPING_OPTION_INPUT_SCHEMA.properties as Record<string, unknown>;
  assert.deepEqual(Object.keys(properties), ["optionIndex"]);
  assert.equal(properties.totalCost, undefined);
  assert.equal(properties.carrierName, undefined);
  assert.equal(properties.serviceType, undefined);
  assert.equal(SELECT_SHIPPING_OPTION_INPUT_SCHEMA.additionalProperties, false);
});

test("no active opportunity/conversation: denied, never persisted under an invented anchor", async () => {
  const context: CapabilityGatewayContext = { correlationId: "corr-no-ctx", opportunityId: null, conversationId: null };
  const outcome = await definition().execute({ optionIndex: 0 }, context);

  assert.equal(outcome.status, "denied");
  assert.equal(outcome.errorCode, "no_active_opportunity");
  assert.equal(outcome.data, null);
});

test("resolved: selecting an observed optionIndex persists exactly that option, never a different one", async () => {
  const opportunityId = await seedOpportunity();
  const conversationId = await seedConversation();
  const factIds = await seedFreshFacts(opportunityId);
  await seedCompletedCalculateShipping(opportunityId, conversationId, TWO_OPTIONS, factIds);

  const context: CapabilityGatewayContext = { correlationId: "corr-select-1", opportunityId, conversationId };
  const outcome = await definition().execute({ optionIndex: 1 }, context);

  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.data, {
    status: "selected",
    carrierName: "Starken",
    serviceType: "express",
    totalCost: 6990,
    estimatedDelivery: "1-2 dias habiles",
    changed: true
  });

  const rehydrated = await getActiveSelectedShippingOptionForOpportunity(opportunityId);
  assert.equal(rehydrated?.carrierName, "Starken");
  assert.equal(rehydrated?.optionIndex, 1);
});

test("a nonexistent optionIndex fails closed, invalid_arguments, never persists anything", async () => {
  const opportunityId = await seedOpportunity();
  const conversationId = await seedConversation();
  // Evidence resolution rejects optionIndex=9 before the freshness check ever runs - no real commercial_line_items/shipping_destination facts needed here.
  await seedCompletedCalculateShipping(opportunityId, conversationId, TWO_OPTIONS, { selectionFactId: "unused-selection-fact", destinationFactId: "unused-destination-fact" });

  const context: CapabilityGatewayContext = { correlationId: "corr-select-2", opportunityId, conversationId };
  const outcome = await definition().execute({ optionIndex: 9 }, context);

  assert.equal(outcome.status, "invalid_arguments");
  assert.equal(outcome.errorCode, "shipping_option_index_out_of_range");
  assert.equal(outcome.data, null);
  assert.equal(await getActiveSelectedShippingOptionForOpportunity(opportunityId), null);
});

test("no recent calculate_shipping execution for this conversation: fails closed, never persists a guessed option", async () => {
  const opportunityId = await seedOpportunity();
  const conversationId = await seedConversation();

  const context: CapabilityGatewayContext = { correlationId: "corr-select-3", opportunityId, conversationId };
  const outcome = await definition().execute({ optionIndex: 0 }, context);

  assert.equal(outcome.status, "invalid_arguments");
  assert.equal(outcome.errorCode, "no_recent_shipping_calculation");
  assert.equal(await getActiveSelectedShippingOptionForOpportunity(opportunityId), null);
});

test("repeated identical selection is idempotent - changed:false on the second call", async () => {
  const opportunityId = await seedOpportunity();
  const conversationId = await seedConversation();
  const factIds = await seedFreshFacts(opportunityId);
  await seedCompletedCalculateShipping(opportunityId, conversationId, TWO_OPTIONS, factIds);
  const context: CapabilityGatewayContext = { correlationId: "corr-select-4", opportunityId, conversationId };

  const first = await definition().execute({ optionIndex: 0 }, context);
  assert.equal(first.status, "completed");
  assert.equal((first.data as { changed: boolean }).changed, true);

  const second = await definition().execute({ optionIndex: 0 }, context);
  assert.equal(second.status, "completed");
  assert.equal((second.data as { changed: boolean }).changed, false);
});

test("selecting a different option later supersedes the prior one - exactly one active fact remains", async () => {
  const opportunityId = await seedOpportunity();
  const conversationId = await seedConversation();
  const factIds = await seedFreshFacts(opportunityId);
  await seedCompletedCalculateShipping(opportunityId, conversationId, TWO_OPTIONS, factIds);
  const context: CapabilityGatewayContext = { correlationId: "corr-select-5", opportunityId, conversationId };

  await definition().execute({ optionIndex: 0 }, context);
  const changedOutcome = await definition().execute({ optionIndex: 1 }, context);
  assert.equal((changedOutcome.data as { changed: boolean; carrierName: string }).changed, true);
  assert.equal((changedOutcome.data as { carrierName: string }).carrierName, "Starken");

  const anchor = buildSelectedShippingOptionRequestAnchor(opportunityId);
  const activeRows = await safeQueryRows(
    "SELECT id FROM crm_request_facts WHERE request_id = ? AND fact_key = ? AND superseded_at IS NULL",
    [anchor, SELECTED_SHIPPING_OPTION_FACT_KEY]
  );
  assert.equal(activeRows.ok, true);
  assert.equal(activeRows.rows.length, 1);
});

// ---- SALES-AGENT-R1-T2.1.1: reject stale shipping selection at selection time ----

test("stale (selection_changed): commercial_line_items changed after calculate_shipping ran -> shipping_calculation_stale, zero writes", async () => {
  const opportunityId = await seedOpportunity();
  const conversationId = await seedConversation();
  const factIds = await seedFreshFacts(opportunityId);
  await seedCompletedCalculateShipping(opportunityId, conversationId, TWO_OPTIONS, factIds);

  // The product selection changes AFTER calculate_shipping ran - a new commercial_line_items factId.
  const changed = await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "999", combinationId: null, quantity: 1 }] });
  assert.equal(changed.ok, true);

  const context: CapabilityGatewayContext = { correlationId: "corr-select-stale-1", opportunityId, conversationId };
  const outcome = await definition().execute({ optionIndex: 0 }, context);

  assert.equal(outcome.status, "invalid_arguments");
  assert.equal(outcome.errorCode, "shipping_calculation_stale");
  assert.deepEqual(outcome.data, { status: "shipping_calculation_stale", reason: "selection_changed" });
  assert.equal(await getActiveSelectedShippingOptionForOpportunity(opportunityId), null);
});

test("stale (destination_changed): shipping_destination changed after calculate_shipping ran -> shipping_calculation_stale, zero writes", async () => {
  const opportunityId = await seedOpportunity();
  const conversationId = await seedConversation();
  const factIds = await seedFreshFacts(opportunityId);
  await seedCompletedCalculateShipping(opportunityId, conversationId, TWO_OPTIONS, factIds);

  // The destination changes AFTER calculate_shipping ran - a new shipping_destination factId (different communeId so the write is not a no-op).
  const changed = await setShippingDestinationForOpportunity({ opportunityId, inputText: "Providencia" }, { resolver: fakeCommuneResolver(50, "Providencia") });
  assert.equal(changed.ok, true);

  const context: CapabilityGatewayContext = { correlationId: "corr-select-stale-2", opportunityId, conversationId };
  const outcome = await definition().execute({ optionIndex: 0 }, context);

  assert.equal(outcome.status, "invalid_arguments");
  assert.equal(outcome.errorCode, "shipping_calculation_stale");
  assert.deepEqual(outcome.data, { status: "shipping_calculation_stale", reason: "destination_changed" });
  assert.equal(await getActiveSelectedShippingOptionForOpportunity(opportunityId), null);
});
