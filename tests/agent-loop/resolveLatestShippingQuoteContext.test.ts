import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool, queryRows, safeExecute } from "@/lib/db";
import { resolveLatestShippingQuoteContext } from "@/lib/brain/commercial/agent-loop/resolveLatestShippingQuoteContext";
import { insertCapabilityExecution } from "@/lib/brain/commercial/capability-gateway/repository";
import { setCommercialLineItemsForOpportunity } from "@/lib/domains/commercial-line-items";
import { setShippingDestinationForOpportunity } from "@/lib/domains/shipping-destination";
import type { CommuneResolver } from "@/lib/domains/commune-resolution";

/**
 * SALES-AGENT-R3-SHIPPING-CONTEXT-PROJECTION-V1. Pre-decision evidence
 * projection tests - fixes TS005_PRIOR_OPTIONS_NOT_PROJECTED (calculate_shipping's
 * options were durable and validated post-decision by
 * resolveObservedShippingOption/select_shipping_option, but never visible to
 * the model BEFORE it decides the next AgentStep). Same DB dependency
 * already accepted by selectShippingOptionCapability.test.ts (whose seeding
 * helpers this file mirrors, never a second implementation of the same
 * fixtures).
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
  const key = `shipping-context-projection-${uniqueSuffix()}`;
  await safeExecute(
    `INSERT INTO crm_opportunities (opportunity_key, requirements_json, missing_requirements_json, product_interests_json, objections_json, signals_json)
     VALUES (?, '{}', '[]', '[]', '[]', '[]')`,
    [key]
  );
  const rows = await queryRows<{ id: number }>(`SELECT id FROM crm_opportunities WHERE opportunity_key = ? LIMIT 1`, [key]);
  return rows[0].id;
}

async function seedConversation(): Promise<number> {
  const externalContactId = `scp-${uniqueSuffix()}`;
  await safeExecute(
    `INSERT INTO conversation (public_id, channel, provider, channel_account_id, external_contact_id) VALUES (UUID(), 'whatsapp', 'meta', ?, ?)`,
    ["scp-test-channel", externalContactId]
  );
  const rows = await queryRows<{ id: number }>(`SELECT id FROM conversation WHERE external_contact_id = ? LIMIT 1`, [externalContactId]);
  return rows[0].id;
}

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

type SeedOption = { carrierName: string; serviceType: string; totalCost: number; estimatedDelivery: string };

const TWO_OPTIONS: SeedOption[] = [
  { carrierName: "Chilexpress", serviceType: "standard", totalCost: 4990, estimatedDelivery: "3-5 dias habiles" },
  { carrierName: "Starken", serviceType: "express", totalCost: 6990, estimatedDelivery: "1-2 dias habiles" }
];

async function seedCompletedCalculateShipping(
  opportunityId: number,
  conversationId: number,
  options: SeedOption[],
  factIds: { selectionFactId: string; destinationFactId: string },
  overrides: { completedAt?: string; responseSummary?: Record<string, unknown> } = {}
) {
  const now = overrides.completedAt ?? new Date().toISOString();
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
    responseSummary: overrides.responseSummary ?? {
      status: "available",
      destination: { communeId: 99, canonicalName: "Ñuñoa" },
      totalWeightKg: 12.5,
      totalBoleta: 29990,
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

// ---- A/B/C/G: real freshness against current durable facts ----

test("A. fresh quote (current selection/destination match the quote's anchors) is projected", async () => {
  const opportunityId = await seedOpportunity();
  const conversationId = await seedConversation();
  const factIds = await seedFreshFacts(opportunityId);
  const executionId = await seedCompletedCalculateShipping(opportunityId, conversationId, TWO_OPTIONS, factIds);

  const quote = await resolveLatestShippingQuoteContext({ conversationId, opportunityId });

  assert.ok(quote, "a fresh quote must be projected");
  assert.equal(quote!.sourceExecutionId, executionId);
  assert.deepEqual(quote!.destination, { communeId: 99, canonicalName: "Ñuñoa" });
  assert.equal(quote!.totalWeightKg, 12.5);
  assert.equal(quote!.totalBoleta, 29990);
  assert.deepEqual(quote!.options, [
    { index: 0, carrierName: "Chilexpress", serviceType: "standard", totalCost: 4990, estimatedDelivery: "3-5 dias habiles" },
    { index: 1, carrierName: "Starken", serviceType: "express", totalCost: 6990, estimatedDelivery: "1-2 dias habiles" }
  ]);
  // The internal staleness anchors never leave this projection - see task section 2.
  assert.equal((quote as unknown as Record<string, unknown>).selectionFactId, undefined);
  assert.equal((quote as unknown as Record<string, unknown>).destinationFactId, undefined);
});

test("B. selection changed after calculate_shipping ran -> absent", async () => {
  const opportunityId = await seedOpportunity();
  const conversationId = await seedConversation();
  const factIds = await seedFreshFacts(opportunityId);
  await seedCompletedCalculateShipping(opportunityId, conversationId, TWO_OPTIONS, factIds);

  const changed = await setCommercialLineItemsForOpportunity({ opportunityId, items: [{ productId: "999", combinationId: null, quantity: 1 }] });
  assert.equal(changed.ok, true);

  const quote = await resolveLatestShippingQuoteContext({ conversationId, opportunityId });
  assert.equal(quote, null);
});

test("C. destination changed after calculate_shipping ran -> absent", async () => {
  const opportunityId = await seedOpportunity();
  const conversationId = await seedConversation();
  const factIds = await seedFreshFacts(opportunityId);
  await seedCompletedCalculateShipping(opportunityId, conversationId, TWO_OPTIONS, factIds);

  const changed = await setShippingDestinationForOpportunity({ opportunityId, inputText: "Providencia" }, { resolver: fakeCommuneResolver(50, "Providencia") });
  assert.equal(changed.ok, true);

  const quote = await resolveLatestShippingQuoteContext({ conversationId, opportunityId });
  assert.equal(quote, null);
});

test("G. multiple historical executions: only the most recent completed one is ever considered", async () => {
  const opportunityId = await seedOpportunity();
  const conversationId = await seedConversation();
  const factIds = await seedFreshFacts(opportunityId);

  // Older execution, otherwise fresh-equivalent - must never resurface once a newer completed execution exists.
  await seedCompletedCalculateShipping(opportunityId, conversationId, TWO_OPTIONS, factIds, { completedAt: "2020-01-01T00:00:00.000Z" });
  // Newer execution: malformed (no options array) - the older, fresh-equivalent row must not resurface as a fallback.
  const newerId = await seedCompletedCalculateShipping(opportunityId, conversationId, TWO_OPTIONS, factIds, {
    completedAt: "2030-01-01T00:00:00.000Z",
    responseSummary: { status: "available", selectionFactId: factIds.selectionFactId, destinationFactId: factIds.destinationFactId }
  });
  void newerId;

  const quote = await resolveLatestShippingQuoteContext({ conversationId, opportunityId });
  assert.equal(quote, null, "the newest row is malformed - the older, otherwise-valid row must never resurface");
});

// ---- D/E/F: envelope-status/malformed fail-closed (DI-driven, no freshness reachable) ----

function fakeDataAccess(rows: Array<{ public_id?: string | null; correlation_id?: string | null; response_summary_json?: unknown; completed_at?: string | Date | null }>) {
  return { async queryRows() { return { ok: true as const, rows }; } };
}

function alwaysFresh() {
  return async () => ({ fresh: true as const });
}

test("D. failed shipping execution (no completed row at all) -> absent", async () => {
  const quote = await resolveLatestShippingQuoteContext({
    conversationId: 1,
    opportunityId: 1,
    dataAccess: fakeDataAccess([]),
    checkFreshness: alwaysFresh()
  });
  assert.equal(quote, null);
});

test("E. no_shipping_options status -> absent", async () => {
  const quote = await resolveLatestShippingQuoteContext({
    conversationId: 1,
    opportunityId: 1,
    dataAccess: fakeDataAccess([{ public_id: "exec-1", response_summary_json: { status: "no_shipping_options", options: [] }, completed_at: new Date().toISOString() }]),
    checkFreshness: alwaysFresh()
  });
  assert.equal(quote, null);
});

test("F. malformed response summary (unparseable JSON) -> absent, fail closed", async () => {
  const quote = await resolveLatestShippingQuoteContext({
    conversationId: 1,
    opportunityId: 1,
    dataAccess: fakeDataAccess([{ public_id: "exec-1", response_summary_json: "not json {", completed_at: new Date().toISOString() }]),
    checkFreshness: alwaysFresh()
  });
  assert.equal(quote, null);
});

test("F2. one malformed option among otherwise-valid options -> absent, never a partial list", async () => {
  const quote = await resolveLatestShippingQuoteContext({
    conversationId: 1,
    opportunityId: 1,
    dataAccess: fakeDataAccess([
      {
        public_id: "exec-1",
        response_summary_json: {
          status: "available",
          selectionFactId: "sel-1",
          destinationFactId: "dest-1",
          options: [
            { index: 0, carrierName: "Chilexpress", serviceType: "standard", totalCost: 4990, estimatedDelivery: "3-5 dias habiles" },
            { index: 1, carrierName: "Starken" /* missing serviceType/totalCost/estimatedDelivery */ }
          ]
        },
        completed_at: new Date().toISOString()
      }
    ]),
    checkFreshness: alwaysFresh()
  });
  assert.equal(quote, null);
});

test("blocked (temporarily_blocked/failed) executions are never read - excluded by execution_status='completed' at the SQL layer, mirrored here via an empty row set", async () => {
  const quote = await resolveLatestShippingQuoteContext({
    conversationId: 1,
    opportunityId: 1,
    dataAccess: fakeDataAccess([]),
    checkFreshness: alwaysFresh()
  });
  assert.equal(quote, null);
});
