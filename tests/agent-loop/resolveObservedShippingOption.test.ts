import assert from "node:assert/strict";
import test from "node:test";
import { resolveObservedShippingOption } from "@/lib/brain/commercial/agent-loop/resolveObservedShippingOption";

/**
 * SALES-AGENT-R1-T2.1. Evidence-gate tests for select_shipping_option - fully
 * DB-free via the injectable `dataAccess` point (mirrors
 * resolveObservedRecommendationSourceProduct.ts's own test style). Proves the
 * gate resolves ONLY against a real, most-recently-completed calculate_shipping
 * execution row for this conversation, and fails closed on every other input.
 */

type FakeRow = {
  public_id?: string | null;
  correlation_id?: string | null;
  response_summary_json?: unknown;
  completed_at?: string | Date | null;
};

function fakeDataAccess(rows: FakeRow[]) {
  return { async queryRows() { return { ok: true as const, rows }; } };
}

function availablePayload(overrides: Record<string, unknown> = {}) {
  return {
    status: "available",
    selectionFactId: "selection-fact-1",
    destinationFactId: "destination-fact-1",
    options: [
      { index: 0, carrierName: "Chilexpress", serviceType: "standard", totalCost: 4990, estimatedDelivery: "3-5 dias habiles" },
      { index: 1, carrierName: "Starken", serviceType: "express", totalCost: 6990, estimatedDelivery: "1-2 dias habiles" }
    ],
    ...overrides
  };
}

function completedRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    public_id: "exec-public-id-1",
    correlation_id: "corr-1",
    response_summary_json: availablePayload(),
    completed_at: "2026-08-10T12:00:00.000Z",
    ...overrides
  };
}

test("resolved: a real optionIndex from the most recent completed calculate_shipping execution resolves with full traceability", async () => {
  const result = await resolveObservedShippingOption({ conversationId: 1, optionIndex: 1, dataAccess: fakeDataAccess([completedRow()]) });

  assert.equal(result.status, "resolved");
  if (result.status !== "resolved") return;
  assert.equal(result.option.carrierName, "Starken");
  assert.equal(result.option.optionIndex, 1);
  assert.equal(result.option.shippingQuoteExecutionId, "exec-public-id-1");
  assert.equal(result.option.selectionFactId, "selection-fact-1");
  assert.equal(result.option.destinationFactId, "destination-fact-1");
});

test("no calculate_shipping execution at all for this conversation -> blocked, no_recent_shipping_calculation", async () => {
  const result = await resolveObservedShippingOption({ conversationId: 1, optionIndex: 0, dataAccess: fakeDataAccess([]) });
  assert.deepEqual(result, { status: "blocked", reason: "no_recent_shipping_calculation" });
});

test("a nonexistent optionIndex (out of range) fails closed, never falls back to a nearby option", async () => {
  const result = await resolveObservedShippingOption({ conversationId: 1, optionIndex: 5, dataAccess: fakeDataAccess([completedRow()]) });
  assert.deepEqual(result, { status: "blocked", reason: "shipping_option_index_out_of_range" });
});

test("a negative optionIndex fails closed", async () => {
  const result = await resolveObservedShippingOption({ conversationId: 1, optionIndex: -1, dataAccess: fakeDataAccess([completedRow()]) });
  assert.deepEqual(result, { status: "blocked", reason: "shipping_option_index_out_of_range" });
});

test("a non-integer optionIndex fails closed", async () => {
  const result = await resolveObservedShippingOption({ conversationId: 1, optionIndex: 0.5, dataAccess: fakeDataAccess([completedRow()]) });
  assert.deepEqual(result, { status: "blocked", reason: "shipping_option_index_out_of_range" });
});

test("a free-text/label optionIndex (never trusted as an index) fails closed", async () => {
  const result = await resolveObservedShippingOption({ conversationId: 1, optionIndex: "Chilexpress", dataAccess: fakeDataAccess([completedRow()]) });
  assert.deepEqual(result, { status: "blocked", reason: "shipping_option_index_out_of_range" });
});

test("the most recent completed execution had no shipping options (no_shipping_options outcome) -> blocked, shipping_calculation_not_available", async () => {
  const result = await resolveObservedShippingOption({
    conversationId: 1,
    optionIndex: 0,
    dataAccess: fakeDataAccess([completedRow({ response_summary_json: { status: "no_shipping_options", options: [] } })])
  });
  assert.deepEqual(result, { status: "blocked", reason: "shipping_calculation_not_available" });
});

test("a malformed/unparseable response payload fails closed, never a fabricated option", async () => {
  const result = await resolveObservedShippingOption({
    conversationId: 1,
    optionIndex: 0,
    dataAccess: fakeDataAccess([completedRow({ response_summary_json: "not json {" })])
  });
  assert.deepEqual(result, { status: "blocked", reason: "shipping_calculation_not_available" });
});

test("missing traceability anchors (selectionFactId/destinationFactId) on the stored execution fails closed", async () => {
  const result = await resolveObservedShippingOption({
    conversationId: 1,
    optionIndex: 0,
    dataAccess: fakeDataAccess([completedRow({ response_summary_json: availablePayload({ selectionFactId: null, destinationFactId: null }) })])
  });
  assert.deepEqual(result, { status: "blocked", reason: "shipping_calculation_not_available" });
});

test("only the row at position 0 (the real query's ORDER BY completed_at DESC, id DESC LIMIT 1) is ever considered - an older row never resurfaces", async () => {
  const older = completedRow({
    public_id: "exec-old",
    completed_at: "2026-08-09T00:00:00.000Z",
    response_summary_json: availablePayload({ options: [{ index: 0, carrierName: "OldCarrier", serviceType: "standard", totalCost: 1000, estimatedDelivery: "5 dias" }] })
  });
  const result = await resolveObservedShippingOption({ conversationId: 1, optionIndex: 0, dataAccess: fakeDataAccess([completedRow(), older]) });
  assert.equal(result.status, "resolved");
  if (result.status !== "resolved") return;
  assert.notEqual(result.option.carrierName, "OldCarrier");
  assert.equal(result.option.shippingQuoteExecutionId, "exec-public-id-1");
});
