import assert from "node:assert/strict";
import test from "node:test";
import { checkShippingEvidenceFreshness, checkShippingSelectionFreshness, setSelectedShippingOptionForOpportunity } from "@/lib/domains/selected-shipping-option";
import type { SelectedShippingOptionFactValue, SetSelectedShippingOptionInput } from "@/lib/domains/selected-shipping-option";
import type { RequestFact, UpsertRequestFactInput, UpsertRequestFactResult } from "@/lib/brain/commercial/request-facts";
import type { CommercialLineItemSelection } from "@/lib/domains/commercial-line-items";
import type { ShippingDestination } from "@/lib/domains/shipping-destination";

/**
 * SALES-AGENT-R1-T2.1. DB-free domain tests for the durable selected shipping
 * option - unlike shippingDestination.test.ts/commercialLineItems.test.ts
 * (which exercise the real crm_request_facts repository against a live DB),
 * setSelectedShippingOptionForOpportunity/checkShippingSelectionFreshness
 * both accept injectable dependencies, so the fact-store and sibling-fact
 * reads used here are in-memory fakes - no MariaDB required. Only
 * getActiveSelectedShippingOptionForOpportunity (real crm_request_facts
 * rehydration, no injection point) is intentionally out of scope here, same
 * gap already accepted for the sibling domains' own rehydration tests.
 */

function createFakeFactStore() {
  let seq = 0;
  const active = new Map<string, RequestFact>();
  return {
    store: active,
    async getActiveFact(requestId: string, factKey: string): Promise<RequestFact | null> {
      return active.get(`${requestId}:${factKey}`) ?? null;
    },
    async upsertFact(input: UpsertRequestFactInput): Promise<UpsertRequestFactResult> {
      seq += 1;
      const key = `${input.requestId}:${input.factKey}`;
      const existed = active.has(key);
      const now = new Date().toISOString();
      const fact: RequestFact = {
        factId: `fact-${seq}`,
        requestId: input.requestId,
        factKey: input.factKey,
        value: input.value,
        status: input.status ?? "inferred",
        sourceMessageId: input.sourceMessageId ?? null,
        sourceToolExecutionId: input.sourceToolExecutionId ?? null,
        confidence: input.confidence ?? null,
        createdAt: now,
        updatedAt: now,
        supersededAt: null
      };
      active.set(key, fact);
      return { ok: true, status: existed ? "versioned" : "created", fact };
    }
  };
}

function optionInput(overrides: Partial<Omit<SelectedShippingOptionFactValue, "selectedAt">> = {}): Omit<SelectedShippingOptionFactValue, "selectedAt"> {
  return {
    carrierName: "Chilexpress",
    serviceType: "standard",
    totalCost: 4990,
    estimatedDelivery: "3-5 dias habiles",
    optionIndex: 0,
    shippingQuoteExecutionId: "exec-1",
    shippingQuoteCorrelationId: "corr-1",
    selectionFactId: "selection-fact-1",
    destinationFactId: "destination-fact-1",
    calculatedAt: "2026-08-10T00:00:00.000Z",
    ...overrides
  };
}

test("selecting an observed option persists it as the confirmed active selection", async () => {
  const fakeStore = createFakeFactStore();
  const input: SetSelectedShippingOptionInput = { opportunityId: 1, option: optionInput() };

  const result = await setSelectedShippingOptionForOpportunity(input, { getActiveFact: fakeStore.getActiveFact, upsertFact: fakeStore.upsertFact });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.status, "selected");
  assert.equal(result.changed, true);
  assert.equal(result.selection.carrierName, "Chilexpress");
  assert.equal(result.selection.optionIndex, 0);
});

test("repeated identical selection is a no-op: changed:false, same factId, no new fact version", async () => {
  const fakeStore = createFakeFactStore();
  const input: SetSelectedShippingOptionInput = { opportunityId: 2, option: optionInput() };
  const deps = { getActiveFact: fakeStore.getActiveFact, upsertFact: fakeStore.upsertFact };

  const first = await setSelectedShippingOptionForOpportunity(input, deps);
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const second = await setSelectedShippingOptionForOpportunity(input, deps);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.changed, false);
  assert.equal(second.selection.factId, first.selection.factId);
});

test("selecting a different option supersedes the prior selection", async () => {
  const fakeStore = createFakeFactStore();
  const deps = { getActiveFact: fakeStore.getActiveFact, upsertFact: fakeStore.upsertFact };
  const opportunityId = 3;

  const first = await setSelectedShippingOptionForOpportunity({ opportunityId, option: optionInput({ optionIndex: 0, carrierName: "Chilexpress" }) }, deps);
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const second = await setSelectedShippingOptionForOpportunity(
    { opportunityId, option: optionInput({ optionIndex: 1, carrierName: "Starken", totalCost: 3990 }) },
    deps
  );
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.changed, true);
  assert.notEqual(second.selection.factId, first.selection.factId);
  assert.equal(second.selection.carrierName, "Starken");

  // Exactly one active row per opportunity - the fake store only ever holds one entry per (requestId, factKey) key, mirroring crm_request_facts' unique-active-row constraint.
  assert.equal(fakeStore.store.size, 1);
});

test("a persistence failure never returns a false success", async () => {
  const result = await setSelectedShippingOptionForOpportunity(
    { opportunityId: 4, option: optionInput() },
    { getActiveFact: async () => null, upsertFact: async () => ({ ok: false, status: "error", fact: null, warning: "simulated_db_failure" }) }
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, "persistence_failed");
});

function commercialSelection(factId: string): CommercialLineItemSelection {
  return { items: [{ productId: "545", combinationId: null, quantity: 2 }], factId, updatedAt: "2026-08-10T00:00:00.000Z" };
}

function shippingDestination(factId: string): ShippingDestination {
  return { communeId: 99, canonicalName: "Ñuñoa", matchedVia: "direct", factId, updatedAt: "2026-08-10T00:00:00.000Z" };
}

function selection(overrides: Partial<Parameters<typeof optionInput>[0]> = {}): Parameters<typeof checkShippingSelectionFreshness>[1] {
  return { ...optionInput(overrides), selectedAt: "2026-08-10T00:05:00.000Z", factId: "selected-option-fact-1", updatedAt: "2026-08-10T00:05:00.000Z" };
}

test("freshness: selection and destination unchanged since calculation -> fresh", async () => {
  const check = await checkShippingSelectionFreshness(1, selection({ selectionFactId: "sel-1", destinationFactId: "dest-1" }), {
    getCommercialLineItems: async () => commercialSelection("sel-1"),
    getShippingDestination: async () => shippingDestination("dest-1")
  });
  assert.deepEqual(check, { fresh: true });
});

test("freshness: commercial_line_items changed since the calculation this selection was evidenced against -> stale (selection_changed)", async () => {
  const check = await checkShippingSelectionFreshness(1, selection({ selectionFactId: "sel-1", destinationFactId: "dest-1" }), {
    getCommercialLineItems: async () => commercialSelection("sel-2"),
    getShippingDestination: async () => shippingDestination("dest-1")
  });
  assert.deepEqual(check, { fresh: false, reason: "selection_changed" });
});

test("freshness: shipping_destination changed since the calculation -> stale (destination_changed)", async () => {
  const check = await checkShippingSelectionFreshness(1, selection({ selectionFactId: "sel-1", destinationFactId: "dest-1" }), {
    getCommercialLineItems: async () => commercialSelection("sel-1"),
    getShippingDestination: async () => shippingDestination("dest-2")
  });
  assert.deepEqual(check, { fresh: false, reason: "destination_changed" });
});

test("freshness: commercial_line_items no longer exist at all -> stale (selection_changed), never treated as fresh by absence", async () => {
  const check = await checkShippingSelectionFreshness(1, selection({ selectionFactId: "sel-1", destinationFactId: "dest-1" }), {
    getCommercialLineItems: async () => null,
    getShippingDestination: async () => shippingDestination("dest-1")
  });
  assert.deepEqual(check, { fresh: false, reason: "selection_changed" });
});

/**
 * SALES-AGENT-R1-T2.1.1. checkShippingEvidenceFreshness is the pure freshness
 * rule extracted so selectShippingOptionCapability.ts can check freshness
 * BEFORE a SelectedShippingOption exists (evidence only - just the two
 * anchors, never carrierName/totalCost/etc.). checkShippingSelectionFreshness
 * above is now a thin delegate to this same function - these tests prove the
 * evidence-only entry point in isolation, never a second, diverging rule.
 */
test("evidence freshness: selection and destination anchors both match current facts -> fresh", async () => {
  const check = await checkShippingEvidenceFreshness(1, { selectionFactId: "sel-1", destinationFactId: "dest-1" }, {
    getCommercialLineItems: async () => commercialSelection("sel-1"),
    getShippingDestination: async () => shippingDestination("dest-1")
  });
  assert.deepEqual(check, { fresh: true });
});

test("evidence freshness: commercial_line_items changed since calculate_shipping ran -> stale (selection_changed)", async () => {
  const check = await checkShippingEvidenceFreshness(1, { selectionFactId: "sel-1", destinationFactId: "dest-1" }, {
    getCommercialLineItems: async () => commercialSelection("sel-2"),
    getShippingDestination: async () => shippingDestination("dest-1")
  });
  assert.deepEqual(check, { fresh: false, reason: "selection_changed" });
});

test("evidence freshness: shipping_destination changed since calculate_shipping ran -> stale (destination_changed)", async () => {
  const check = await checkShippingEvidenceFreshness(1, { selectionFactId: "sel-1", destinationFactId: "dest-1" }, {
    getCommercialLineItems: async () => commercialSelection("sel-1"),
    getShippingDestination: async () => shippingDestination("dest-2")
  });
  assert.deepEqual(check, { fresh: false, reason: "destination_changed" });
});

test("evidence freshness: both anchors changed -> stale, deterministically selection_changed (checked first), never both reported at once", async () => {
  const check = await checkShippingEvidenceFreshness(1, { selectionFactId: "sel-1", destinationFactId: "dest-1" }, {
    getCommercialLineItems: async () => commercialSelection("sel-2"),
    getShippingDestination: async () => shippingDestination("dest-2")
  });
  assert.deepEqual(check, { fresh: false, reason: "selection_changed" });
});
