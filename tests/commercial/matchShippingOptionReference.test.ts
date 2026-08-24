import assert from "node:assert/strict";
import test from "node:test";
import { matchShippingOptionReference, type ShippingOptionCandidate } from "@/lib/brain/commercial/work";

function option(index: number, carrierName: string, serviceType: string, totalCost: number, estimatedDelivery = "1 a 2 dias habiles"): ShippingOptionCandidate {
  return { index, carrierName, serviceType, totalCost, estimatedDelivery };
}

const TWO_CHILEXPRESS: ShippingOptionCandidate[] = [
  option(0, "Chilexpress", "Express", 8000),
  option(1, "Chilexpress", "Normal", 5000)
];

const MIXED: ShippingOptionCandidate[] = [option(0, "BlueExpress", "standard", 3990), option(1, "Starken", "standard", 4500)];

// SHIP07 - ordinal reference resolves against a real position.
test("SHIP07: 'la segunda' resolves to the second candidate by position", () => {
  const result = matchShippingOptionReference("la segunda", MIXED);
  assert.deepEqual(result, { status: "resolved", index: 1, matchKind: "position" });
});

test("SHIP07b: 'opcion 1' resolves to index 0 by position", () => {
  const result = matchShippingOptionReference("quiero la opcion 1", MIXED);
  assert.deepEqual(result, { status: "resolved", index: 0, matchKind: "position" });
});

// SHIP08 - a unique carrier name resolves.
test("SHIP08: a unique carrier name resolves by content", () => {
  const result = matchShippingOptionReference("Starken", MIXED);
  assert.deepEqual(result, { status: "resolved", index: 1, matchKind: "carrier" });
});

// SHIP09 - an ambiguous carrier (task's own Chilexpress Express/Normal example) never silently picks.
test("SHIP09: an ambiguous carrier with two service levels returns both real candidates, never picks", () => {
  const result = matchShippingOptionReference("Chilexpress", TWO_CHILEXPRESS);
  assert.equal(result.status, "ambiguous");
  if (result.status === "ambiguous") {
    assert.equal(result.candidates.length, 2);
    assert.deepEqual(result.candidates, TWO_CHILEXPRESS);
  }
});

test("SHIP09b: naming the service type on top of the carrier narrows an otherwise-ambiguous match", () => {
  const result = matchShippingOptionReference("Chilexpress Express", TWO_CHILEXPRESS);
  assert.deepEqual(result, { status: "resolved", index: 0, matchKind: "carrier" });
});

// SHIP10 - "la mas barata" resolves deterministically to min(totalCost).
test("SHIP10: 'la mas barata' resolves deterministically to the lowest totalCost", () => {
  const result = matchShippingOptionReference("la mas barata", MIXED);
  assert.deepEqual(result, { status: "resolved", index: 0, matchKind: "cheapest" });
});

test("SHIP10b: 'la mas barata' still resolves correctly when the cheapest option is not first", () => {
  const reversed = [option(0, "Starken", "standard", 9000), option(1, "BlueExpress", "standard", 3990)];
  const result = matchShippingOptionReference("cual es la mas economica", reversed);
  assert.deepEqual(result, { status: "resolved", index: 1, matchKind: "cheapest" });
});

// "mas rapida" is deliberately never built - estimatedDelivery is opaque, never parsed.
test("'mas rapida' is never auto-resolved - falls through to missing", () => {
  const result = matchShippingOptionReference("la mas rapida", MIXED);
  assert.deepEqual(result, { status: "missing" });
});

test("pure noise text resolves to missing, never invents", () => {
  const result = matchShippingOptionReference("no se cual quiero todavia", MIXED);
  assert.deepEqual(result, { status: "missing" });
});

// SHIP16 - no reference at all, or no options at all, never invents.
test("SHIP16: no reference given resolves to missing", () => {
  assert.deepEqual(matchShippingOptionReference(undefined, MIXED), { status: "missing" });
  assert.deepEqual(matchShippingOptionReference("", MIXED), { status: "missing" });
});

test("SHIP16b: a reference against an empty option list resolves to missing, never invents an index", () => {
  assert.deepEqual(matchShippingOptionReference("la primera", []), { status: "missing" });
});

test("a positional reference for a position that does not exist resolves to missing", () => {
  const result = matchShippingOptionReference("la quinta", MIXED);
  assert.deepEqual(result, { status: "missing" });
});
