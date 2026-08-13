import assert from "node:assert/strict";
import test from "node:test";
import { mergeCommercialIntents } from "@/lib/brain/commercial/multi-intent/pendingIntentState";
import type { PendingCommercialIntentRecord } from "@/lib/brain/commercial/multi-intent/types";

function pendingRecord(intent: PendingCommercialIntentRecord["intent"], missingRequirements: PendingCommercialIntentRecord["missingRequirements"] = []): PendingCommercialIntentRecord {
  return { intent, missingRequirements, savedAt: "2026-08-13T00:00:00.000Z" };
}

// Part 21 test 5 (continuation): a pending get_shipping_quote whose type is re-addressed this turn is replaced, never duplicated.
test("[MI-Merge-1] a new intent of the same type as a pending one replaces it, never duplicates", () => {
  const pending = [pendingRecord({ type: "get_shipping_quote" }, ["DESTINATION"])];
  const merged = mergeCommercialIntents(pending, [{ type: "get_shipping_quote", destination: "Ñuñoa" }]);
  assert.deepEqual(merged, [{ type: "get_shipping_quote", destination: "Ñuñoa" }]);
});

test("[MI-Merge-2] a pending intent this turn's message never addresses is carried forward unchanged", () => {
  const pending = [pendingRecord({ type: "get_shipping_quote" }, ["DESTINATION"])];
  const merged = mergeCommercialIntents(pending, [{ type: "select_products", productReference: "Classic", quantity: 1 }]);
  assert.deepEqual(merged, [{ type: "get_shipping_quote" }, { type: "select_products", productReference: "Classic", quantity: 1 }]);
});

test("[MI-Merge-3] no pending intents: the new plan passes through unchanged", () => {
  const merged = mergeCommercialIntents([], [{ type: "select_products", productReference: "Classic", quantity: 1 }]);
  assert.deepEqual(merged, [{ type: "select_products", productReference: "Classic", quantity: 1 }]);
});

test("[MI-Merge-4] an unsupported pending record is never carried forward - it is not a fact waiting for one more field", () => {
  const pending = [pendingRecord({ type: "unsupported", description: "arriendo" })];
  const merged = mergeCommercialIntents(pending, [{ type: "select_products", productReference: "Classic", quantity: 1 }]);
  assert.deepEqual(merged, [{ type: "select_products", productReference: "Classic", quantity: 1 }]);
});
