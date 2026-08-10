import assert from "node:assert/strict";
import test from "node:test";
import { calculateShipping } from "@/lib/domains/shipping-calculation";
import type {
  CalculateShippingDeps,
  CarrierCoverageLookupResult,
  ShippingCalculationInput,
  ShippingCoverageProvider,
  ShippingRateProvider
} from "@/lib/domains/shipping-calculation";

function baseInput(overrides: Partial<ShippingCalculationInput> = {}): ShippingCalculationInput {
  return {
    opportunityId: 1,
    destination: { communeId: 99, canonicalName: "Ñuñoa", destinationFactId: "fact-1" },
    items: [{ productId: "7", combinationId: null, quantity: 1, unitWeightKg: 10 }],
    ...overrides
  };
}

function fakeCoverageProvider(result: CarrierCoverageLookupResult): ShippingCoverageProvider {
  return { async getCoverageForCommune() { return result; } };
}

const STARKEN_BLUE_PESAS = [
  { carrierId: 1, carrierKey: "starken", carrierName: "Starken", enabled: true, coverage: "covered" as const },
  { carrierId: 2, carrierKey: "blueexpress", carrierName: "Blue Express", enabled: true, coverage: "covered" as const },
  { carrierId: 3, carrierKey: "despacho directo", carrierName: "Pesas Chile", enabled: true, coverage: "covered" as const }
];

test("A: destination covered by at least one carrier, no rate provider -> available carriers, status partial (rate unconfirmed)", async () => {
  const deps: CalculateShippingDeps = { coverageProvider: fakeCoverageProvider({ ok: true, carriers: STARKEN_BLUE_PESAS }) };
  const result = await calculateShipping(baseInput(), deps);
  assert.equal(result.status, "partial");
  if (result.status !== "partial") return;
  assert.equal(result.totalWeightKg, 10);
  assert.equal(result.destination.communeId, 99);
  assert.equal(result.destination.destinationFactId, "fact-1");
  assert.equal(result.options.length, 3);
  for (const option of result.options) {
    assert.equal(option.rateStatus, "unavailable");
    assert.equal(option.rateUnavailableReason, "rate_source_unconfirmed");
    assert.equal(option.rate, null);
  }
});

test("B: no carrier covers the destination -> not_covered", async () => {
  const carriers = STARKEN_BLUE_PESAS.map((c) => ({ ...c, coverage: "not_covered" as const }));
  const deps: CalculateShippingDeps = { coverageProvider: fakeCoverageProvider({ ok: true, carriers }) };
  const result = await calculateShipping(baseInput(), deps);
  assert.equal(result.status, "not_covered");
});

test("C: multiple covered carriers -> multiple options returned, no arbitrary single selection", async () => {
  const deps: CalculateShippingDeps = { coverageProvider: fakeCoverageProvider({ ok: true, carriers: STARKEN_BLUE_PESAS }) };
  const result = await calculateShipping(baseInput(), deps);
  assert.equal(result.status, "partial");
  if (result.status !== "partial") return;
  const carrierIds = result.options.map((o) => o.carrierId).sort();
  assert.deepEqual(carrierIds, [1, 2, 3]);
});

test("distinguishes covered / not_covered / unknown per carrier - never collapses unknown into not_covered", async () => {
  const carriers = [
    { carrierId: 1, carrierKey: "starken", carrierName: "Starken", enabled: true, coverage: "unknown" as const },
    { carrierId: 2, carrierKey: "blueexpress", carrierName: "Blue Express", enabled: true, coverage: "covered" as const },
    { carrierId: 3, carrierKey: "despacho directo", carrierName: "Pesas Chile", enabled: true, coverage: "not_covered" as const }
  ];
  const deps: CalculateShippingDeps = { coverageProvider: fakeCoverageProvider({ ok: true, carriers }) };
  const result = await calculateShipping(baseInput(), deps);
  assert.equal(result.status, "partial");
  if (result.status !== "partial") return;
  const byId = new Map(result.options.map((o) => [o.carrierId, o.coverage]));
  assert.equal(byId.get(1), "unknown");
  assert.equal(byId.get(2), "covered");
  assert.equal(byId.get(3), "not_covered");
});

test("disabled carrier never appears as an option", async () => {
  const carriers = [
    { carrierId: 1, carrierKey: "starken", carrierName: "Starken", enabled: false, coverage: "covered" as const },
    { carrierId: 2, carrierKey: "blueexpress", carrierName: "Blue Express", enabled: true, coverage: "covered" as const }
  ];
  const deps: CalculateShippingDeps = { coverageProvider: fakeCoverageProvider({ ok: true, carriers }) };
  const result = await calculateShipping(baseInput(), deps);
  assert.equal(result.status, "partial");
  if (result.status !== "partial") return;
  assert.equal(result.options.length, 1);
  assert.equal(result.options[0].carrierId, 2);
});

test("E: Catalog Service unavailable (weightKg null upstream) -> weight_unavailable, never a fabricated rate, coverage never even queried", async () => {
  let coverageCalled = false;
  const coverageProvider: ShippingCoverageProvider = {
    async getCoverageForCommune() {
      coverageCalled = true;
      return { ok: true, carriers: STARKEN_BLUE_PESAS };
    }
  };
  const result = await calculateShipping(baseInput({ items: [{ productId: "7", combinationId: null, quantity: 1, unitWeightKg: null }] }), { coverageProvider });
  assert.equal(result.status, "weight_unavailable");
  assert.equal(coverageCalled, false);
});

test("F: pc_pos unavailable -> technical_error, no fabricated coverage", async () => {
  const deps: CalculateShippingDeps = { coverageProvider: fakeCoverageProvider({ ok: false, reason: "unavailable", detail: "connect ECONNREFUSED" }) };
  const result = await calculateShipping(baseInput(), deps);
  assert.equal(result.status, "technical_error");
});

test("pc_pos not configured (LOGISTICS_DB_ENABLED=false) -> configuration_unavailable, distinct from a technical outage", async () => {
  const deps: CalculateShippingDeps = { coverageProvider: fakeCoverageProvider({ ok: false, reason: "configuration_unavailable", detail: "LOGISTICS_DB_ENABLED is not true" }) };
  const result = await calculateShipping(baseInput(), deps);
  assert.equal(result.status, "configuration_unavailable");
});

test("G: rate source unavailable but coverage known -> status partial, coverage stays known, rate marked unavailable per-option", async () => {
  const rateProvider: ShippingRateProvider = { async getRate() { return { ok: false, reason: "no_real_provider_wired" }; } };
  const deps: CalculateShippingDeps = { coverageProvider: fakeCoverageProvider({ ok: true, carriers: STARKEN_BLUE_PESAS }), rateProvider };
  const result = await calculateShipping(baseInput(), deps);
  assert.equal(result.status, "partial");
  if (result.status !== "partial") return;
  for (const option of result.options) {
    assert.equal(option.coverage, "covered");
    assert.equal(option.rateStatus, "unavailable");
    assert.equal(option.rateUnavailableReason, "no_real_provider_wired");
  }
});

test("when every covered carrier has a confirmed rate -> status available", async () => {
  const rateProvider: ShippingRateProvider = { async getRate(carrierId) { return { ok: true, rate: { amount: 1000 * carrierId, currency: "CLP" } }; } };
  const deps: CalculateShippingDeps = { coverageProvider: fakeCoverageProvider({ ok: true, carriers: STARKEN_BLUE_PESAS }), rateProvider };
  const result = await calculateShipping(baseInput(), deps);
  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  assert.equal(result.options.every((o) => o.rateStatus === "available"), true);
});

test("H: LLM-supplied fake communeId/weight/rate cannot exist at this boundary - input is already a typed ShippingCalculationInput, not raw agent output", async () => {
  const deps: CalculateShippingDeps = { coverageProvider: fakeCoverageProvider({ ok: true, carriers: STARKEN_BLUE_PESAS }) };
  const invalidDestination = await calculateShipping(baseInput({ destination: { communeId: -1, canonicalName: "x", destinationFactId: "f" } }), deps);
  assert.equal(invalidDestination.status, "invalid_input");
});

test("D: destination change is caller-detectable via destinationFactId - the result always echoes back the fact id it was computed against", async () => {
  const deps: CalculateShippingDeps = { coverageProvider: fakeCoverageProvider({ ok: true, carriers: STARKEN_BLUE_PESAS }) };
  const result = await calculateShipping(baseInput({ destination: { communeId: 99, canonicalName: "Ñuñoa", destinationFactId: "fact-old" } }), deps);
  assert.equal(result.status, "partial");
  if (result.status !== "partial") return;
  assert.equal(result.destination.destinationFactId, "fact-old");
});
